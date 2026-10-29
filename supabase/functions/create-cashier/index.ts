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

    const { store_id, name, pin } = payload as Record<string, unknown>;
    if (
      typeof store_id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(store_id) ||
      typeof name !== "string" || name.trim() === "" || name.trim().length > 120 ||
      typeof pin !== "string" || !/^\d{4,12}$/.test(pin)
    ) {
      return jsonResponse({
        error: "A valid store_id UUID, a name up to 120 characters, and a 4-12 digit PIN are required",
      }, 400);
    }

    const { data: profile, error: profileError } = await ctx.supabase
      .from("profiles")
      .select("is_active")
      .eq("id", userId)
      .maybeSingle();

    if (profileError) {
      console.error("Failed to load caller profile:", profileError);
      return jsonResponse({ error: "Could not verify caller permissions" }, 500);
    }

    if (!profile || profile.is_active !== true) {
      return jsonResponse({ error: "Only an active store owner can create cashiers" }, 403);
    }

    const { data: membership, error: membershipError } = await ctx.supabaseAdmin
      .from("store_members")
      .select("store_id")
      .eq("store_id", store_id)
      .eq("user_id", userId)
      .eq("role", "owner")
      .eq("is_active", true)
      .maybeSingle();

    if (membershipError) {
      console.error("Failed to verify store ownership:", membershipError);
      return jsonResponse({ error: "Could not verify store ownership" }, 500);
    }

    if (!membership) {
      return jsonResponse({ error: "Store not found or does not belong to this owner" }, 404);
    }

    const pinSalt = crypto.getRandomValues(new Uint8Array(16));
    const pinKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(pin),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    const pinBits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: pinSalt, iterations: 310_000 },
      pinKey,
      256,
    );
    const toHex = (bytes: Uint8Array) =>
      Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    const pinHash = `pbkdf2_sha256$310000$${toHex(pinSalt)}$${toHex(new Uint8Array(pinBits))}`;

    const { data: cashier, error: cashierError } = await ctx.supabaseAdmin
      .from("cashiers")
      .insert({
        store_id: membership.store_id,
        name: name.trim(),
        pin_hash: pinHash,
        is_active: true,
        created_by: userId,
      })
      .select("id, store_id, name, is_active, created_by, created_at")
      .single();

    if (cashierError) {
      console.error("Failed to create cashier:", cashierError);
      return jsonResponse({ error: "Could not create cashier" }, 500);
    }

    return jsonResponse({ cashier }, 201);
  }),
};
