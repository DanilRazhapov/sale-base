
type Env = {
  PRODUCT_IMAGES: {
    list(options: { limit: number }): Promise<unknown>;
  };
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;

    if (path === "/api/r2-check") {
      if (request.method !== "GET") {
        return new Response("Method Not Allowed", { status: 405 });
      }

      try {
        await env.PRODUCT_IMAGES.list({ limit: 1 });
        return Response.json({ connected: true });
      } catch {
        return Response.json({ connected: false }, { status: 503 });
      }
    }

    return env.ASSETS.fetch(request);
  },
};
