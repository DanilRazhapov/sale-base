type Env = {
  PRODUCT_IMAGES: {
    put(
      key: string,
      data: ArrayBuffer,
      options: { httpMetadata: { contentType: string } },
    ): Promise<unknown>;
    delete(key: string): Promise<void>;
  };
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_PUBLISHABLE_KEY?: string;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SIZE = 3 * 1024 * 1024;

function reply(data: object, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function imageType(bytes: Uint8Array) {
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) return { mime: "image/webp", ext: "webp" };

  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) return { mime: "image/jpeg", ext: "jpg" };

  if (
    bytes.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10]
      .every((b, i) => bytes[i] === b)
  ) return { mime: "image/png", ext: "png" };

  return null;
}

async function uploadImage(request: Request, env: Env) {
  const base = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (!base || !key) {
    return reply({ error: "API изображений не настроен." }, 503);
  }

  if (request.headers.get("Origin") !== new URL(request.url).origin) {
    return reply({ error: "Недопустимое происхождение запроса." }, 403);
  }

  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return reply({ error: "Необходима авторизация." }, 401);
  }

  const token = auth.slice(7);

  const sb = (path: string, options: RequestInit = {}) =>
    fetch(new URL(path, base), {
      ...options,
      headers: {
        apikey: key,
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });

  // Проверяем действительность сессии.
  const userResponse = await sb("/auth/v1/user");
  if (!userResponse.ok) {
    return reply({ error: "Сессия недействительна." }, 401);
  }

  const user = await userResponse.json() as { id?: string };
  if (!user.id || !uuid.test(user.id)) {
    return reply({ error: "Некорректная сессия." }, 401);
  }

  const profileResponse = await sb(
    `/rest/v1/profiles?select=id&id=eq.${user.id}&is_active=eq.true`,
  );

  if (!profileResponse.ok) {
    return reply({ error: "Ошибка проверки профиля." }, 502);
  }

  const profiles = await profileResponse.json() as unknown[];
  if (profiles.length !== 1) {
    return reply({ error: "Профиль владельца неактивен." }, 403);
  }

  // Принимаем только небольшие изображения.
  const contentLength = Number(request.headers.get("Content-Length"));
  if (contentLength > MAX_SIZE + 65536) {
    return reply({ error: "Файл слишком большой." }, 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return reply({ error: "Некорректные данные файла." }, 400);
  }

  const storeId = form.get("storeId");
  const productId = form.get("productId");
  const file = form.get("image");

  if (
    typeof storeId !== "string" || !uuid.test(storeId) ||
    typeof productId !== "string" || !uuid.test(productId)
  ) {
    return reply({ error: "Некорректный магазин или товар." }, 400);
  }

  if (!(file instanceof File) || !file.size || file.size > MAX_SIZE) {
    return reply({ error: "Изображение должно быть не больше 3 МБ." }, 413);
  }

  const buffer = await file.arrayBuffer();
  const detected = imageType(new Uint8Array(buffer));

  if (!detected || file.type !== detected.mime) {
    return reply({ error: "Допустимы только JPEG, PNG и WebP." }, 415);
  }

  // Проверка прав владельца на стороне Supabase.
  const accessResponse = await sb("/rest/v1/rpc/is_store_owner", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target_store_id: storeId }),
  });

  if (!accessResponse.ok) {
    return reply({ error: "Не удалось проверить права." }, 502);
  }

  if (await accessResponse.json() !== true) {
    return reply({ error: "Нет доступа к магазину." }, 403);
  }

  const productUrl = new URL("/rest/v1/products", base);
  productUrl.searchParams.set("select", "id,image_key");
  productUrl.searchParams.set("store_id", `eq.${storeId}`);
  productUrl.searchParams.set("id", `eq.${productId}`);
  productUrl.searchParams.set("is_active", "eq.true");

  const productResponse = await sb(productUrl.pathname + productUrl.search);

  if (!productResponse.ok) {
    return reply({ error: "Не удалось проверить товар." }, 502);
  }

  const products = await productResponse.json() as Array<{
    id: string;
    image_key: string | null;
  }>;

  if (products.length !== 1) {
    return reply({ error: "Товар не найден." }, 404);
  }

  const oldKey = products[0].image_key;
  const newKey =
    `stores/${storeId}/products/${productId}/` +
    `${crypto.randomUUID()}.${detected.ext}`;

  let uploaded = false;

  try {
    await env.PRODUCT_IMAGES.put(newKey, buffer, {
      httpMetadata: { contentType: detected.mime },
    });
    uploaded = true;

    // Сохраняем ключ только после успешной загрузки.
    const updateResponse = await sb(
  "/rest/v1/rpc/set_store_product_image",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_store_id: storeId,
      p_product_id: productId,
      p_expected_image_key: oldKey,
      p_new_image_key: newKey,
    }),
  },
);

const updated = updateResponse.ok
  && (await updateResponse.json()) === true;

if (!updated) {
  await env.PRODUCT_IMAGES.delete(newKey);
  uploaded = false;

  return reply(
    {
      error: "Не удалось сохранить фото. Обновите данные.",
    },
    updateResponse.ok ? 409 : 502,
  );
}

    // Старая фотография больше не используется.
    if (oldKey && oldKey.startsWith(`stores/${storeId}/products/${productId}/`)) {
      try {
        await env.PRODUCT_IMAGES.delete(oldKey);
      } catch {
        // Не мешаем успешному сохранению новой фотографии.
      }
    }

    return reply({ image_key: newKey });
  } catch {
    if (uploaded) {
      try {
        await env.PRODUCT_IMAGES.delete(newKey);
      } catch {
        // Возможный остаточный объект можно очистить позже.
      }
    }

    return reply({ error: "Не удалось загрузить фотографию." }, 502);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;

    if (path === "/api/product-image") {
      if (request.method !== "POST") {
        return reply({ error: "Method not allowed" }, 405);
      }

      try {
        return await uploadImage(request, env);
      } catch {
        return reply({ error: "Ошибка сервера изображений." }, 502);
      }
    }

    return env.ASSETS.fetch(request);
  },
};