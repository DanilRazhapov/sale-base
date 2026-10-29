import { withSupabase } from "@supabase/server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const userId = ctx.userClaims?.id;
    if (!userId) {
      return jsonResponse({ error: "Authentication required" }, 401);
    }

    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      return jsonResponse({ error: "Request body must be valid JSON" }, 400);
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return jsonResponse({ error: "Request body must be a JSON object" }, 400);
    }

    const { name, address } = payload as Record<string, unknown>;
    if (
      typeof name !== "string" || !name.trim() || name.trim().length > 120 ||
      typeof address !== "string" || !address.trim() || address.trim().length > 500
    ) {
      return jsonResponse({
        error: "A name up to 120 characters and an address up to 500 characters are required",
      }, 400);
    }

    try {
      const { data: store, error } = await ctx.supabaseAdmin.rpc("create_store_with_owner", {
        p_user_id: userId,
        p_name: name.trim(),
        p_address: address.trim(),
      });

      if (error) {
        if (error.code === "42501") {
          return jsonResponse({ error: "An active profile is required to create a store" }, 403);
        }
        if (error.code === "22023") {
          return jsonResponse({ error: "Invalid store name or address" }, 400);
        }
        console.error("Failed to create store:", error);
        return jsonResponse({ error: "Could not create store" }, 500);
      }

      return jsonResponse({ store }, 201);
    } catch (error) {
      console.error("Create store request failed:", error);
      return jsonResponse({ error: "Could not create store" }, 500);
    }
  }),
};
