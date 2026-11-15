# Redeem terminal pairing code

Read `index.ts` (server wiring), `handler.ts` (request flow), then the shared
`pairingCode.ts` and `tokens.ts` crypto helpers.

## Setup

Apply the terminal pairing migrations, including
`20261114000000_terminal_pairing_attempt_limit.sql`. Configure the same
`PAIRING_CODE_SECRET` used by `create-terminal-pairing-code`. Never send this
secret or the service-role key to the browser.

From `frontend`:

```powershell
supabase db push --dry-run
supabase db push
supabase functions deploy redeem-terminal-pairing-code
```

The function config disables owner-JWT verification: a valid one-time code
authorizes device enrollment. SQL RPCs remain service-role-only.

POST body:

```json
{ "code": "0012345", "name": "Касса №1" }
```

Success (201) returns `device: { id, store_id, name }` and `token`, a random
256-bit device credential. Only its SHA-256 hash is stored. Do not log the token.
There is no cashier login or permission to sell in this response.

## Attempt budget

A separate committed database RPC counts POST requests before parsing the code.
The budget is global: 30 attempts in a 60-second fixed window across all Edge
instances and shops. It does not trust caller-controlled IP headers. Exhaustion
returns 429 with Retry-After: 60; limiter failure returns 503. This is a bounded
baseline for the current deployment, not a substitute for upstream traffic
protection: one client can consume the shared budget and delay other shops.
Distributed callers must not be able to increase code guesses without a global
bound; a future trusted gateway can additionally enforce per-client limits.

Wrong, expired, already-used and deauthorized codes produce the same 400 response.
OPTIONS is supported for browser CORS; other methods return 405.

## Integration still required

The cashier application's server proxy should store the token in a secure HttpOnly
cookie and provide the UI with non-secret store/device metadata. UI/storage and
device-scoped cashier login are not implemented here. A lost response after a
successful transaction leaves a registered device; do not automatically retry
redemption with the consumed code. Have the owner revoke that device and issue
a new code if the credential cannot be recovered.
