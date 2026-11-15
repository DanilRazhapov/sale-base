# Create terminal pairing code

Owner-only endpoint. Apply the terminal pairing database migrations first.

## Files to read

1. `index.ts` authenticates through the project's existing `withSupabase` wrapper.
2. `handler.ts` validates input, calls the database and maps errors to HTTP responses.
3. `../_shared/pairingCode.ts` generates the random code and computes its HMAC.

## Configuration

Set `PAIRING_CODE_SECRET` in Supabase Edge Function secrets to a cryptographically
random secret with at least 32 bytes of entropy (for example, 32 random bytes
encoded as 64 hexadecimal characters). Do not use a human password. The runtime
checks minimum encoded length; it cannot verify the entropy of your chosen value.
Do not put it in a `VITE_` variable, frontend code, git, or logs.
The future redemption function must use the same secret and HMAC prefix.
Changing the secret invalidates outstanding codes; device tokens are independent.

From `frontend`, deploy with:

```powershell
supabase functions deploy create-terminal-pairing-code
```

## Contract

An authenticated owner sends a POST body:

```json
{ "store_id": "20000000-0000-4000-8000-000000000001" }
```

Success (HTTP 201):

```json
{ "code": "0012345", "expires_at": "2030-01-01T00:05:00Z" }
```

The database, rather than the client, determines expiry and verifies current
ownership. Owner identity always comes from authentication. Codes include leading
zeroes and must remain strings. Global code-hash collisions are retried up to ten
times; other database errors are not retried. Responses disable caching.

This endpoint only issues codes. It does not connect devices, change cashier
login, or provide application-level issuance throttling. Add throttling when
integrating the owner UI; the unauthenticated redemption endpoint must also have
its own server-side attempt limits before it is exposed.
