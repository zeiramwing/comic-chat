// Password hashing and session tokens, using only WebCrypto so the same code
// runs in Workers and in Node (for tests).

// Workers' PBKDF2 implementation is capped at 100,000 iterations.
export const PBKDF2_ITERATIONS = 100_000;

const enc = new TextEncoder();

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
export function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
const toBase64Url = (bytes: Uint8Array) => toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export interface PasswordRecord {
  hash: string;
  salt: string;
  iter: number;
}

export async function hashPassword(password: string, iterations = PBKDF2_ITERATIONS): Promise<PasswordRecord> {
  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  const hash = await derive(password, salt, iterations);
  return { hash: toBase64(hash), salt: toBase64(salt), iter: iterations };
}

/** Constant-time comparison of two byte arrays. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export async function verifyPassword(password: string, rec: PasswordRecord): Promise<boolean> {
  if (!rec.hash || !rec.salt) return false;
  const expect = fromBase64(rec.hash);
  const got = await derive(password, fromBase64(rec.salt), rec.iter);
  return timingSafeEqual(expect, got);
}

/** A 256-bit random session token (base64url) for the cookie. */
export function newToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A readable temporary password (no look-alike characters), e.g. for owner-issued resets. */
export function temporaryPassword(length = 12): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
  let out = '';
  for (const b of bytes) {
    if (b >= 256 - (256 % alphabet.length)) continue; // avoid modulo bias
    out += alphabet[b % alphabet.length];
    if (out.length === length) break;
  }
  return out.length === length ? out : temporaryPassword(length);
}
