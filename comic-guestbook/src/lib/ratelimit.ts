import type { Env } from '../types.ts';
import { fail } from './http.ts';
import { sha256Hex } from './crypto.ts';

/**
 * Fixed-window counter in D1. Increments and throws 429 when over the limit.
 * Cheap and good enough for a friend-group site; old windows are pruned lazily.
 */
export async function hit(env: Env, key: string, limit: number, windowSeconds: number): Promise<void> {
  const window = Math.floor(Date.now() / 1000 / windowSeconds);
  const row = await env.DB.prepare(
    'INSERT INTO rate (k, window, n) VALUES (?1, ?2, 1) ON CONFLICT (k, window) DO UPDATE SET n = n + 1 RETURNING n',
  ).bind(key, window).first<{ n: number }>();
  if (Math.random() < 0.02) {
    // prune: anything older than a day of the largest window we use
    await env.DB.prepare('DELETE FROM rate WHERE window < ?1').bind(Math.floor(Date.now() / 1000 / windowSeconds) - 2).run();
  }
  if (row && row.n > limit) throw fail(429, 'rate_limited', 'too many requests, try again later');
}

/** Peek without incrementing (used to check failed-login counts). */
export async function count(env: Env, key: string, windowSeconds: number): Promise<number> {
  const window = Math.floor(Date.now() / 1000 / windowSeconds);
  const row = await env.DB.prepare('SELECT n FROM rate WHERE k = ?1 AND window = ?2').bind(key, window).first<{ n: number }>();
  return row?.n ?? 0;
}

/** Short stable hash of the client address, so raw IPs are not stored. */
export async function clientKey(request: Request): Promise<string> {
  const ip = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for') ?? 'unknown';
  return (await sha256Hex(`ip:${ip}`)).slice(0, 16);
}
