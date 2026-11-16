import { supabase } from "./supabase";

const MAX_IMAGE_SIZE = 3 * 1024 * 1024;

const allowedTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

export async function uploadProductImage(
  storeId: string,
  productId: string,
  image: File,
): Promise<string> {
  if (
    !allowedTypes.includes(image.type) ||
    image.size === 0 ||
    image.size > MAX_IMAGE_SIZE
  ) {
    throw new Error(
      "Выберите JPEG, PNG или WebP размером до 3 МБ.",
    );
  }

  const { data, error } = await supabase.auth.getSession();

  if (error || !data.session?.access_token) {
    throw new Error("Войдите в аккаунт владельца снова.");
  }

  const form = new FormData();
  form.append("storeId", storeId);
  form.append("productId", productId);
  form.append("image", image);

  const response = await fetch("/api/product-image", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
    },
    body: form,
  });

  const result = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      typeof result?.error === "string"
        ? result.error
        : `API загрузки фотографии вернул HTTP ${response.status}. Проверьте, что запрос /api/product-image обрабатывается Worker Owner.`,
    );
  }

  if (typeof result?.image_key !== "string") {
    throw new Error("Сервер не подтвердил сохранение фотографии.");
  }

  return result.image_key;
}
