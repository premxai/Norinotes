import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

function scryptAsync(password: string, salt: Buffer, keylen: number, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, { N: n, r, p, maxmem: 128 * n * r * 2 + 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

/** scrypt with a random 16-byte salt. Format: scrypt$N$r$p$saltB64$hashB64. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEYLEN, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

/** A hash to compare against when the account does not exist, so a miss takes as long as a wrong password. */
let dummy: Promise<string> | null = null;
export const dummyPasswordHash = () => (dummy ??= hashPassword(randomBytes(16).toString("hex")));

/** Constant-time check. Unknown or malformed hashes return false after doing the same work. */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const parts = (stored ?? "").split("$");
  const valid = parts.length === 6 && parts[0] === "scrypt";
  const [n, r, p] = valid ? parts.slice(1, 4).map(Number) : [N, R, P];
  const salt = valid ? Buffer.from(parts[4] ?? "", "base64") : randomBytes(16);
  const expected = valid ? Buffer.from(parts[5] ?? "", "base64") : randomBytes(KEYLEN);
  if (!Number.isInteger(n) || !n || n < 2 || n > 1 << 20 || !Number.isInteger(r) || !r || !Number.isInteger(p) || !p) return false;
  const key = await scryptAsync(password, salt, expected.length || KEYLEN, n, r, p);
  return valid && key.length === expected.length && timingSafeEqual(key, expected);
}
