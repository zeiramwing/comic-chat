import type { Env, UserRow } from '../types.ts';
import { fail, getCookie } from './http.ts';
import { newToken, sha256Hex } from './crypto.ts';

export const SESSION_SECONDS = 30 * 24 * 3600;

export async function createSession(env: Env, userId: number): Promise<string> {
  const token = newToken();
  const now = Date.now();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)')
    .bind(await sha256Hex(token), userId, now, now + SESSION_SECONDS * 1000).run();
  return token;
}

export async function destroySession(env: Env, token: string): Promise<void> {
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(await sha256Hex(token)).run();
}

export async function destroyAllSessions(env: Env, userId: number): Promise<void> {
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(userId).run();
}

/** The signed-in user, or null. Touches last_seen at most once a minute. */
export async function currentUser(env: Env, request: Request): Promise<UserRow | null> {
  const token = getCookie(request, 'cg_session');
  if (!token) return null;
  const now = Date.now();
  const row = await env.DB.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?1 AND s.expires_at > ?2`,
  ).bind(await sha256Hex(token), now).first<UserRow>();
  if (!row) return null;
  if (now - row.last_seen_at > 60_000) {
    await env.DB.prepare('UPDATE users SET last_seen_at = ?1 WHERE id = ?2').bind(now, row.id).run();
  }
  return row;
}

export async function requireUser(env: Env, request: Request): Promise<UserRow> {
  const u = await currentUser(env, request);
  if (!u) throw fail(401, 'unauthorized', 'sign in first');
  return u;
}

export async function requireOwner(env: Env, request: Request): Promise<UserRow> {
  const u = await requireUser(env, request);
  if (u.role !== 'owner') throw fail(403, 'forbidden', 'owner only');
  return u;
}

/**
 * Cross-site request forgery guard for anything that changes state:
 * require a same-origin Origin header (when sent) and a custom header, which
 * a cross-origin page cannot add without a CORS preflight we never grant.
 */
export function checkCsrf(request: Request): void {
  const method = request.method;
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) throw fail(403, 'bad_origin', 'cross-origin request refused');
  if (request.headers.get('x-requested-with') !== 'comic-guestbook') {
    throw fail(403, 'csrf', 'missing X-Requested-With header');
  }
}
