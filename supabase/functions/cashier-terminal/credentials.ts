const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

export function createToken() {
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashToken(token: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))));
}

export async function verifyPin(pin: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2_sha256" || parts[1] !== "310000" ||
    !/^[0-9a-f]{32}$/.test(parts[2]) || !/^[0-9a-f]{64}$/.test(parts[3])) return false;
  const salt = Uint8Array.from(parts[2].match(/../g)!, (value) => parseInt(value, 16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 310000 }, key, 256);
  const actual = hex(new Uint8Array(bits));
  let difference = 0;
  for (let i = 0; i < actual.length; i++) difference |= actual.charCodeAt(i) ^ parts[3].charCodeAt(i);
  return difference === 0;
}

export async function findCashierByPin<T extends { pin_hash: string }>(pin: string, candidates: T[]): Promise<T | null> {
  let match: T | null = null;
  let matches = 0;
  for (const candidate of candidates) {
    if (await verifyPin(pin, candidate.pin_hash)) { match = candidate; matches++; }
  }
  // Identical name/PIN pairs cannot safely identify one account. Never pick the first row.
  return matches === 1 ? match : null;
}
