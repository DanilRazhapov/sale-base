import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "../owner/worker.ts";

const imageKey = "stores/11111111-1111-4111-8111-111111111111/products/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.png";

test("GET streams an image for cross-origin cashier cards without owner auth", async () => {
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const env = { PRODUCT_IMAGES: { async get(key) {
    assert.equal(key, imageKey);
    return { body: new Response(bytes).body, httpEtag: '"image-etag"' };
  } } };
  const response = await worker.fetch(new Request(`https://owner.example/api/product-image?key=${encodeURIComponent(imageKey)}`), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/png");
  assert.equal(response.headers.get("Cross-Origin-Resource-Policy"), "cross-origin");
  assert.match(response.headers.get("Cache-Control"), /immutable/);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
});

test("GET rejects arbitrary bucket keys before accessing R2", async () => {
  const env = { PRODUCT_IMAGES: { async get() { assert.fail("R2 must not be read"); } } };
  for (const key of ["", "private/document.pdf", "stores/../secret.png", imageKey.replace(".png", ".svg")]) {
    const response = await worker.fetch(new Request(`https://owner.example/api/product-image?key=${encodeURIComponent(key)}`), env);
    assert.equal(response.status, 400);
  }
});

test("GET returns 404 for deleted images", async () => {
  const response = await worker.fetch(new Request(`https://owner.example/api/product-image?key=${encodeURIComponent(imageKey)}`), {
    PRODUCT_IMAGES: { async get() { return null; } },
  });
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("GET revalidates cached images using ETag", async () => {
  const response = await worker.fetch(new Request(`https://owner.example/api/product-image?key=${encodeURIComponent(imageKey)}`, {
    headers: { "If-None-Match": '"image-etag"' },
  }), { PRODUCT_IMAGES: { async get() { return { body: null, httpEtag: '"image-etag"' }; } } });
  assert.equal(response.status, 304);
  assert.equal(await response.text(), "");
});

const storeId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";
const oldKey = `stores/${storeId}/products/${productId}/old.png`;

function request() {
  const form = new FormData();
  form.append("storeId", storeId);
  form.append("productId", productId);
  form.append("image", new File([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
  ], "product.png", { type: "image/png" }));
  return new Request("https://owner.example/api/product-image", {
    method: "POST",
    headers: { Origin: "https://owner.example", Authorization: "Bearer test" },
    body: form,
  });
}

function setup(t, { putFails = false, updateStatus = 200, updated = true, deleteFails = false } = {}) {
  const puts = [];
  const deletes = [];
  let updateBody;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const path = new URL(url).pathname;
    if (path === "/auth/v1/user") return Response.json({ id: storeId });
    if (path === "/rest/v1/profiles") return Response.json([{ id: storeId }]);
    if (path === "/rest/v1/rpc/is_store_owner") return Response.json(true);
    if (path === "/rest/v1/products") return Response.json([{ id: productId, image_key: oldKey }]);
    if (path === "/rest/v1/rpc/set_store_product_image") {
      updateBody = JSON.parse(options.body);
      return Response.json(updated, { status: updateStatus });
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  const env = {
    VITE_SUPABASE_URL: "https://supabase.example",
    VITE_SUPABASE_PUBLISHABLE_KEY: "test",
    PRODUCT_IMAGES: {
      async put(key) {
        if (putFails) throw new Error("R2 unavailable");
        puts.push(key);
      },
      async delete(key) {
        deletes.push(key);
        if (deleteFails) throw new Error("Cleanup failed");
      },
    },
  };
  return { env, puts, deletes, updateBody: () => updateBody };
}

test("missing R2 binding returns a configuration error", async (t) => {
  const { env } = setup(t);
  delete env.PRODUCT_IMAGES;
  const response = await worker.fetch(request(), env);
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /PRODUCT_IMAGES/);
});

test("R2 write failure is distinguished from Supabase failure", async (t) => {
  const { env, deletes, updateBody } = setup(t, { putFails: true });
  const response = await worker.fetch(request(), env);
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /записать фотографию в R2/);
  assert.equal(updateBody(), undefined);
  assert.deepEqual(deletes, []);
});

test("replacement saves the new key before deleting the old image", async (t) => {
  const { env, puts, deletes, updateBody } = setup(t);
  const response = await worker.fetch(request(), env);
  assert.equal(response.status, 200);
  const { image_key: imageKey } = await response.json();
  assert.match(imageKey, new RegExp(`^stores/${storeId}/products/${productId}/.*\\.png$`));
  assert.deepEqual(puts, [imageKey]);
  assert.deepEqual(deletes, [oldKey]);
  assert.deepEqual(updateBody(), {
    p_store_id: storeId,
    p_product_id: productId,
    p_expected_image_key: oldKey,
    p_new_image_key: imageKey,
  });
});

test("Supabase failure removes only the new image", async (t) => {
  const { env, puts, deletes } = setup(t, { updateStatus: 404 });
  const response = await worker.fetch(request(), env);
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /Supabase \(HTTP 404\)/);
  assert.deepEqual(deletes, puts);
  assert.ok(!deletes.includes(oldKey));
});

test("cleanup failure preserves the conflict diagnosis", async (t) => {
  const { env, puts, deletes } = setup(t, { updated: false, deleteFails: true });
  const response = await worker.fetch(request(), env);
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /уже изменена/);
  assert.deepEqual(deletes, puts);
});
