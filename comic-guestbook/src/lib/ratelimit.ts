import type { Env } from '../types.ts';
import { fail } from './http.ts';
import { sha256Hex } from './crypto.ts';

const nowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * Fixed-window counter in D1. Increments and throws 429 when over the limit.
 * Cheap and good enough for a friend-group site. Every row records when its
 * window ends (`exp`), so expired rows of any window size are pruned the same
 * way: comparing window *indexes* across different window sizes would delete
 * live hourly and daily counters.
 */
export async function hit(env: Env, key: string, limit: number, windowSeconds: number): Promise<void> {
  const now = nowSeconds();
  const window = Math.floor(now / windowSeconds);
  const exp = (window + 1) * windowSeconds;
  const row = await env.DB.prepare(
    `INSERT INTO rate (k, window, n, exp) VALUES (?1, ?2, 1, ?3)
     ON CONFLICT (k, window) DO UPDATE SET n = n + 1 RETURNING n`,
  ).bind(key, window, exp).first<{ n: number }>();
  if (Math.random() < 0.02) {
    await env.DB.prepare('DELETE FROM rate WHERE exp < ?1').bind(now).run();
  }
  if (row && row.n > limit) throw fail(429, 'rate_limited', 'too many requests, try again later');
}

/** Peek without incrementing (used to check failed-login counts). */
export async function count(env: Env, key: string, windowSeconds: number): Promise<number> {
  const window = Math.floor(nowSeconds() / windowSeconds);
  const row = await env.DB.prepare('SELECT n FROM rate WHERE k = ?1 AND window = ?2').bind(key, window).first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * Short stable hash of the client address, so raw IPs are not stored. Only
 * Cloudflare's own CF-Connecting-IP is trusted (clients cannot set it on the
 * edge); X-Forwarded-For is client-controlled and is ignored.
 */
export async function clientKey(request: Request): Promise<string> {
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  return (await sha256Hex(`ip:${ip}`)).slice(0, 16);
}
