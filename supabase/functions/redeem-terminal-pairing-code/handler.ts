import { hashPairingCode } from "../_shared/pairingCode.ts";
import { createToken, hashToken } from "../_shared/tokens.ts";

type RpcReply = { data: unknown; error: { code?: string } | null };
type Dependencies = {
  attempt(): PromiseLike<RpcReply>;
  redeem(args: { p_code_hash: string; p_token_hash: string; p_name: string }): PromiseLike<RpcReply>;
};
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
const json = (body: object, status: number) => Response.json(body, { status, headers });

export async function handleRedeemPairingCode(
  request: Request, secret: string, db: Dependencies,
): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const limit = await db.attempt();
    if (limit.error || typeof limit.data !== "boolean") {
      return json({ error: "Pairing temporarily unavailable" }, 503);
    }
    if (!limit.data) {
      const response = json({ error: "Too many pairing attempts. Try again in a minute." }, 429);
      response.headers.set("Retry-After", "60");
      return response;
    }

    let payload: unknown;
    try {
      const text = await request.text();
      if (text.length > 2048) return json({ error: "Request body too large" }, 413);
      payload = JSON.parse(text);
    } catch {
      return json({ error: "Request body must be valid JSON" }, 400);
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return json({ error: "Request body must be a JSON object" }, 400);
    }
    const { code, name } = payload as Record<string, unknown>;
    if (typeof code !== "string" || !/^\d{7}$/.test(code) ||
      typeof name !== "string" || name.trim().length < 1 || name.trim().length > 120) {
      return json({ error: "A seven-digit code and a device name up to 120 characters are required" }, 400);
    }

    const codeHash = await hashPairingCode(code, secret);
    const token = createToken();
    const { data, error } = await db.redeem({
      p_code_hash: codeHash, 
      p_token_hash: await hashToken(token), 
      p_name: name.trim(),
    });

    if (error || !Array.isArray(data)) return json({ error: "Could not pair device" }, 500);
    if (data.length === 0) return json({ error: "Invalid or unavailable pairing code" }, 400);
    if (data.length !== 1) return json({ error: "Could not pair device" }, 500);

    const device = data[0];
    if (!device 
      || typeof device.id !== "string" 
      || typeof device.store_id !== "string" 
      || typeof device.name !== "string"
    ) return json({ error: "Could not pair device" }, 500);

    return json({ device: { id: device.id, store_id: device.store_id, name: device.name }, token }, 201);
  } catch {
    return json({ error: "Could not pair device" }, 500);
  }
}
