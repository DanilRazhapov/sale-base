import { handleRedeemPairingCode } from "../functions/redeem-terminal-pairing-code/handler.ts";
import { hashPairingCode } from "../functions/_shared/pairingCode.ts";
import { hashToken } from "../functions/_shared/tokens.ts";

const secret = "test-secret-only-01234567890123456789";
const device = { id: "device-id", store_id: "store-id", name: "Till" };
const request = (body: unknown = { code: "0012345", name: " Till " }) => new Request("https://example.test", {
  method: "POST", body: JSON.stringify(body),
});
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

Deno.test("redemption hashes code and random token before saving; returns token only on success", async () => {
  let savedTokenHash = "";
  let attempts = 0;
  const response = await handleRedeemPairingCode(request(), secret, {
    attempt: () => { attempts++; return Promise.resolve({ data: true, error: null }); },
    redeem: async args => {
      assert(attempts === 1, "Attempt committed first");
      assert(args.p_code_hash === await hashPairingCode("0012345", secret), "Same code HMAC as issuance");
      assert(args.p_name === "Till", "Trimmed device name");
      savedTokenHash = args.p_token_hash;
      return { data: [{ ...device, paired_by: "owner-id" }], error: null };
    },
  });
  const body = await response.json();
  assert(response.status === 201 && /^[0-9a-f]{64}$/.test(body.token), "Raw 256-bit token returned");
  assert(savedTokenHash === await hashToken(body.token) && savedTokenHash !== body.token, "Only token hash stored");
  assert(!JSON.stringify(body).includes(savedTokenHash) && !body.device.paired_by, "Return minimal device metadata");
  assert(response.headers.get("Cache-Control") === "no-store", "No token caching");
});

Deno.test("redemption fails closed for throttle errors and never checks codes when blocked", async () => {
  let redeemed = 0;
  const redeem = () => { redeemed++; return Promise.resolve({ data: [device], error: null }); };
  const response = await handleRedeemPairingCode(request(), secret, {
    attempt: () => Promise.resolve({ data: false, error: null }), redeem,
  });
  assert(response.status === 429 && response.headers.get("Retry-After") === "60", "Throttle response");
  const unavailable = await handleRedeemPairingCode(request(), secret, {
    attempt: () => Promise.resolve({ data: null, error: { code: "DB_DOWN" } }), redeem,
  });
  assert(unavailable.status === 503 && redeemed === 0, "Database failure never bypasses throttle");
});

Deno.test("redemption validates input and hides database errors and unavailable-code details", async () => {
  let redeemed = 0;
  const db = {
    attempt: () => Promise.resolve({ data: true, error: null }),
    redeem: () => { redeemed++; return Promise.resolve({ data: [], error: null }); },
  };
  for (const body of [null, [], {}, { code: 1234567, name: "Till" },
    { code: "123456", name: "Till" }, { code: "0012345", name: " " }]) {
    assert((await handleRedeemPairingCode(request(body), secret, db)).status === 400, "Bad payload rejected");
  }
  assert((await handleRedeemPairingCode(request(), "", db)).status === 500, "Missing secret fails closed");
  assert(redeemed === 0, "Invalid input never reaches redemption");
  const invalid = await handleRedeemPairingCode(request(), secret, db);
  assert(invalid.status === 400 && !(await invalid.text()).includes("token"), "Unavailable code has no token");
  const failure = await handleRedeemPairingCode(request(), secret, {
    ...db, redeem: () => Promise.resolve({ data: null, error: { code: "42501" } }),
  });
  assert(failure.status === 500 && !(await failure.text()).includes("42501"), "Database details hidden");
  for (const method of ["GET", "OPTIONS"]) {
    const response = await handleRedeemPairingCode(new Request("https://example.test", { method }), secret, {
      attempt: () => { throw new Error("Must not access database"); }, redeem: db.redeem,
    });
    assert(response.status === (method === "GET" ? 405 : 204), "Method and preflight handled first");
  }
});
