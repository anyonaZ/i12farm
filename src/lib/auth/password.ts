import 'server-only';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// scrypt from Node's standard library: no native add-ons to build on the
// server. Stored as scrypt$N$r$p$salt$hash (base64), so the cost can be
// raised later and old hashes still verify.

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, KEYLEN, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) {
    // Spend the same time as a real check so missing accounts aren't detectable by timing.
    await derive(password, randomBytes(16), N, R, P);
    return false;
  }
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await derive(password, Buffer.from(salt, 'base64'), Number(n), Number(r), Number(p));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export const PASSWORD_MIN = 8;

/** Returns a message key from auth.* when the password is too weak, else null. */
export function passwordProblem(password: string): 'passwordShort' | 'passwordCommon' | null {
  if (password.length < PASSWORD_MIN) return 'passwordShort';
  const lower = password.toLowerCase();
  if (/^(\d)\1+$/.test(password) || ['12345678', 'password', 'password1', 'qwertyui', 'i12farm1', '87654321'].includes(lower)) {
    return 'passwordCommon';
  }
  return null;
}
