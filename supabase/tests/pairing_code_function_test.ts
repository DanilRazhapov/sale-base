import { generatePairingCode, hashPairingCode } from "../functions/_shared/pairingCode.ts";
import { handleCreatePairingCode } from "../functions/create-terminal-pairing-code/handler.ts";

const owner = "10000000-0000-4000-8000-000000000001";
const store = "20000000-0000-4000-8000-000000000001";
const secret = "test-secret-only-01234567890123456789";
const expires = "2030-01-01T00:05:00Z";
const request = (payload: unknown = { store_id: store }) => new Request("https://example.test", {
  method: "POST", body: JSON.stringify(payload),
});
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

Deno.test("pairing code format and keyed hashing", async () => {
  for (let i = 0; i < 100; i++) assert(/^\d{7}$/.test(generatePairingCode()), "Seven digits");
  const hash = await hashPairingCode("0012345", secret);
  assert(/^[0-9a-f]{64}$/.test(hash), "SHA256-sized HMAC");
  assert(hash === await hashPairingCode("0012345", secret), "Stable lookup hash");
  assert(hash !== await hashPairingCode("0012345", secret + "different"), "Secret changes hash");
  assert(hash !== await hashPairingCode("0012346", secret), "Code changes hash");
});

Deno.test("pairing issuance uses authenticated owner, retries collision and stores only hash", async () => {
  let attempts = 0;
  let storedHash = "";
  const response = await handleCreatePairingCode(request({ store_id: store, owner_id: "attacker" }), owner, secret, args => {
    assert(args.p_owner_id === owner && args.p_store_id === store, "Verified owner identity");
    storedHash = args.p_code_hash;
    attempts++;
    return Promise.resolve(attempts === 1
      ? { data: null, error: { code: "23505", message: 'duplicate key violates "terminal_pairing_codes_code_hash_key"' } }
      : { data: expires, error: null });
  });
  const body = await response.json();
  assert(response.status === 201 && attempts === 2, "Collision retried");
  assert(body.expires_at === expires && /^\d{7}$/.test(body.code), "Client gets code and expiry");
  assert(storedHash === await hashPairingCode(body.code, secret), "Database gets HMAC of returned code");
  assert(!JSON.stringify(body).includes(storedHash), "Hash stays server-side");
  assert(response.headers.get("Cache-Control") === "no-store", "Response must not be cached");
});

Deno.test("pairing issuance rejects invalid requests, configuration and database failures", async () => {
  let calls = 0;
  const issue = () => { calls++; return Promise.resolve({ data: expires, error: null }); };
  assert((await handleCreatePairingCode(request(), undefined, secret, issue)).status === 401, "Authentication required");
  for (const payload of [null, [], {}, { store_id: "bad" }]) {
    assert((await handleCreatePairingCode(request(payload), owner, secret, issue)).status === 400, "Validate body");
  }
  assert((await handleCreatePairingCode(new Request("https://example.test", { method: "POST", body: "{" }), owner, secret, issue)).status === 400,
    "Malformed JSON rejected");
  assert((await handleCreatePairingCode(request(), owner, "", issue)).status === 500, "Missing secret fails closed");
  assert(calls === 0, "Rejected requests never call database");
  const forbidden = await handleCreatePairingCode(request(), owner, secret,
    () => Promise.resolve({ data: null, error: { code: "42501" } }));
  assert(forbidden.status === 403, "Inactive or foreign owner rejected by RPC");
  let collisions = 0;
  const exhausted = await handleCreatePairingCode(request(), owner, secret, () => {
    collisions++;
    return Promise.resolve({ data: null, error: { code: "23505", message: 'constraint "terminal_pairing_codes_code_hash_key"' } });
  });
  assert(exhausted.status === 503 && collisions === 10, "Retries bounded");
  let unrelated = 0;
  const failure = await handleCreatePairingCode(request(), owner, secret, () => {
    unrelated++;
    return Promise.resolve({ data: null, error: { code: "23505", message: 'constraint "another_key"' } });
  });
  assert(failure.status === 500 && unrelated === 1, "Other database errors are not retried");
  assert((await handleCreatePairingCode(new Request("https://example.test", { method: "OPTIONS" }), undefined, "", issue)).status === 204,
    "Handler accepts preflight");
});
