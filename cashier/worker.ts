import { onRequest } from "./functions/api/cashier";

type Env = {
  VITE_SUPABASE_URL: string;
  VITE_SUPABASE_PUBLISHABLE_KEY: string;
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const pathname = new URL(request.url).pathname;

    if (pathname === "/api/cashier") {
      return onRequest({ request, env });
    }

    return env.ASSETS.fetch(request);
  },
};