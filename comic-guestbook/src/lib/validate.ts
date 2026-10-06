// Input validation. Pure functions: each returns { ok: true, value } or
// { ok: false, error } so handlers can report precise problems.

import { cleanFmt } from '../../public/js/shared/richtext.js';

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const bad = <T>(error: string): Result<T> => ({ ok: false, error });

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const BIDI = /[‪-‮⁦-⁩]/;

export const LIMITS = {
  USERNAME_MIN: 3,
  USERNAME_MAX: 24,
  PASSWORD_MIN: 8,
  PASSWORD_MAX: 200,
  DISPLAY_MAX: 32,
  TEXT_MAX: 1000,
  TEXT_LINES_MAX: 12,
  PROFILE_MAX: 500,
  HOMEPAGE_MAX: 200,
  PREFS_MAX_BYTES: 16 * 1024,
  TO_MAX: 4,
  LINKS_MAX: 3,
} as const;

export function username(v: unknown): Result<string> {
  if (typeof v !== 'string') return bad('username must be a string');
  const s = v.trim();
  if (s.length < LIMITS.USERNAME_MIN || s.length > LIMITS.USERNAME_MAX) {
    return bad(`username must be ${LIMITS.USERNAME_MIN}-${LIMITS.USERNAME_MAX} characters`);
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(s)) return bad('username may only use letters, digits, _ . -');
  return ok(s);
}

export function password(v: unknown): Result<string> {
  if (typeof v !== 'string') return bad('password must be a string');
  if (v.length < LIMITS.PASSWORD_MIN) return bad(`password must be at least ${LIMITS.PASSWORD_MIN} characters`);
  if (v.length > LIMITS.PASSWORD_MAX) return bad('password is too long');
  return ok(v);
}

export function displayName(v: unknown): Result<string> {
  if (typeof v !== 'string') return bad('display name must be a string');
  const s = v.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!s) return bad('display name is required');
  if (s.length > LIMITS.DISPLAY_MAX) return bad(`display name must be at most ${LIMITS.DISPLAY_MAX} characters`);
  if (CONTROL.test(s) || BIDI.test(s)) return bad('display name has invalid characters');
  if (/^departed #\d+$/i.test(s)) return bad('that display name is reserved');
  return ok(s);
}

export function profile(v: unknown): Result<string> {
  if (v === undefined || v === null) return ok('');
  if (typeof v !== 'string') return bad('profile must be a string');
  const s = v.replace(/\r\n?/g, '\n').trim();
  if (s.length > LIMITS.PROFILE_MAX) return bad(`profile must be at most ${LIMITS.PROFILE_MAX} characters`);
  if (CONTROL.test(s) || BIDI.test(s)) return bad('profile has invalid characters');
  return ok(s);
}

/** Only http(s) links are accepted, so a profile cannot carry a javascript: URL. */
export function homepage(v: unknown): Result<string> {
  if (v === undefined || v === null || v === '') return ok('');
  if (typeof v !== 'string' || v.length > LIMITS.HOMEPAGE_MAX) return bad('homepage is too long');
  let u: URL;
  try {
    u = new URL(v.trim());
  } catch {
    return bad('homepage must be a full http(s) address');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return bad('homepage must be http or https');
  return ok(u.toString());
}

export function slug(v: unknown, what: string): Result<string> {
  if (typeof v !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(v)) return bad(`${what} is not valid`);
  return ok(v);
}

export function messageText(v: unknown): Result<string> {
  if (typeof v !== 'string') return bad('text must be a string');
  let s = v.replace(/\r\n?/g, '\n');
  if (CONTROL.test(s) || BIDI.test(s)) return bad('text has invalid characters');
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!s) return bad('text is empty');
  if (s.length > LIMITS.TEXT_MAX) return bad(`text must be at most ${LIMITS.TEXT_MAX} characters`);
  if (s.split('\n').length > LIMITS.TEXT_LINES_MAX) return bad(`text may have at most ${LIMITS.TEXT_LINES_MAX} lines`);
  // a cheap guard against link spam
  if ((s.match(/https?:\/\//gi) ?? []).length > LIMITS.LINKS_MAX) return bad(`please keep it to ${LIMITS.LINKS_MAX} links or fewer`);
  return ok(s);
}

export type Kind = 'say' | 'think' | 'action' | 'whisper' | 'expression';
export function kind(v: unknown, allowWhisper = false): Result<Kind> {
  if (v === undefined) return ok('say');
  if (v === 'say' || v === 'think' || v === 'action' || v === 'expression') return ok(v);
  if (v === 'whisper' && allowWhisper) return ok(v);
  return bad('kind must be say, think, action or expression');
}

/** An explicit emotion from the wheel: e is radians (or a gesture code), i is 0..1. */
export function emotion(v: unknown): Result<{ e: number; i: number } | null> {
  if (v === undefined || v === null) return ok(null);
  if (typeof v !== 'object') return bad('emotion must be an object');
  const { e, i } = v as { e?: unknown; i?: unknown };
  if (typeof e !== 'number' || typeof i !== 'number' || !Number.isFinite(e) || !Number.isFinite(i)) {
    return bad('emotion needs numeric e and i');
  }
  if (i < 0 || i > 1) return bad('emotion intensity must be between 0 and 1');
  const gesture = Number.isInteger(e) && e >= 1001 && e <= 1008;
  if (!gesture && (e < 0 || e > Math.PI * 2 + 0.01)) return bad('emotion angle out of range');
  return ok({ e: Math.round(e * 1000) / 1000, i: Math.round(i * 100) / 100 });
}

export function fmt(v: unknown, textLength: number): Result<unknown[] | null> {
  if (v === undefined || v === null) return ok(null);
  const clean = cleanFmt(v, textLength);
  return clean ? ok(clean as unknown[]) : bad('formatting does not match the text');
}

export function toIds(v: unknown): Result<number[]> {
  if (v === undefined || v === null) return ok([]);
  if (!Array.isArray(v) || v.length > LIMITS.TO_MAX) return bad('to must be a short list of user ids');
  const out: number[] = [];
  for (const x of v) {
    if (!Number.isInteger(x) || (x as number) <= 0) return bad('to must contain user ids');
    if (!out.includes(x as number)) out.push(x as number);
  }
  return ok(out);
}

/** User preferences are an opaque JSON object with a size cap. */
export function prefs(v: unknown): Result<Record<string, unknown>> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return bad('prefs must be an object');
  const json = JSON.stringify(v);
  if (new TextEncoder().encode(json).length > LIMITS.PREFS_MAX_BYTES) return bad('prefs are too large');
  return ok(v as Record<string, unknown>);
}
