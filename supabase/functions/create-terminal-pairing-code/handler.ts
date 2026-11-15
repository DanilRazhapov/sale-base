import { generatePairingCode, hashPairingCode } from "../_shared/pairingCode.ts";

type IssueCode = (args: { p_owner_id: string; p_store_id: string; p_code_hash: string }) => PromiseLike<{
  data: unknown;
  error: { code?: string; message?: string } | null;
}>;

const responseHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};

function json(body: object, status: number): Response {
  return Response.json(body, { status, headers: responseHeaders });
}

export async function handleCreatePairingCode(
  request: Request,
  ownerId: string | undefined,
  secret: string,
  issueCode: IssueCode,
): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!ownerId) return json({ error: "Authentication required" }, 401);

  let payload: unknown;
  try {
    const body = await request.text();
    if (body.length > 2048) return json({ error: "Request body too large" }, 413);
    payload = JSON.parse(body);
  } catch {
    return json({ error: "Request body must be valid JSON" }, 400);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return json({ error: "Request body must be a JSON object" }, 400);
  }
  const { store_id } = payload as Record<string, unknown>;
  if (typeof store_id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(store_id)) {
    return json({ error: "A valid store_id UUID is required" }, 400);
  }

  try {
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = generatePairingCode();
      const codeHash = await hashPairingCode(code, secret);
      
      const { data: expiresAt, error } = await issueCode({
        p_owner_id: ownerId, p_store_id: store_id, p_code_hash: codeHash,
      });
      if (error) {
        if (error.code === "23505" && error.message?.includes("terminal_pairing_codes_code_hash_key")) continue;
        if (error.code === "42501") return json({ error: "Active store owner required" }, 403);
        // Do not send database errors (which may contain hashes) to the client.
        return json({ error: "Could not create pairing code" }, 500);
      }
      if (typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt))) {
        return json({ error: "Could not create pairing code" }, 500);
      }
      return json({ code, expires_at: expiresAt }, 201);
    }
    return json({ error: "Could not allocate a code. Try again." }, 503);
  } catch {
    return json({ error: "Could not create pairing code" }, 500);
  }
}
