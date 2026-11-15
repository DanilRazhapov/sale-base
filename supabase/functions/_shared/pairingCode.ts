const codeCount = 10_000_000;
// Reject the uneven tail of the uint32 range so every code is equally likely.
const randomLimit = Math.floor(2 ** 32 / codeCount) * codeCount;

export function generatePairingCode(): string {
  const random = new Uint32Array(1);
  do {
    crypto.getRandomValues(random);
  } while (random[0] >= randomLimit);
  // Keep the code as a string: "0012345" is a valid seven-digit code.
  return String(random[0] % codeCount).padStart(7, "0");
}

export async function hashPairingCode(code: string, secret: string): Promise<string> {
  if (!/^\d{7}$/.test(code)) throw new Error("Invalid pairing code");
  if (new TextEncoder().encode(secret).length < 32) {
    throw new Error("PAIRING_CODE_SECRET must contain at least 32 bytes");
  }
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  // The same secret and prefix must be used when the cashier redeems the code.
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`terminal-pairing:v1:${code}`));
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, "0")).join("");
}
