import type { Env } from './types.ts';
import { HttpError, json, fail } from './lib/http.ts';
import { checkCsrf } from './lib/auth.ts';
import * as account from './routes/account.ts';
import * as entries from './routes/entries.ts';
import * as community from './routes/community.ts';

type Handler = (env: Env, request: Request, params: string[]) => Promise<Response>;

interface Route {
  method: string;
  pattern: RegExp;
  handler: Handler;
}

const routes: Route[] = [
  { method: 'POST', pattern: /^\/api\/register$/, handler: (e, r) => account.register(e, r) },
  { method: 'POST', pattern: /^\/api\/login$/, handler: (e, r) => account.login(e, r) },
  { method: 'POST', pattern: /^\/api\/logout$/, handler: (e, r) => account.logout(e, r) },
  { method: 'GET', pattern: /^\/api\/me$/, handler: (e, r) => account.me(e, r) },
  { method: 'PATCH', pattern: /^\/api\/me$/, handler: (e, r) => account.updateMe(e, r) },
  { method: 'POST', pattern: /^\/api\/me\/password$/, handler: (e, r) => account.changePassword(e, r) },
  { method: 'DELETE', pattern: /^\/api\/me$/, handler: (e, r) => account.deleteMe(e, r) },

  { method: 'GET', pattern: /^\/api\/entries$/, handler: (e, r) => entries.list(e, r) },
  { method: 'POST', pattern: /^\/api\/entries$/, handler: (e, r) => entries.create(e, r) },
  { method: 'DELETE', pattern: /^\/api\/entries\/(\d+)$/, handler: (e, r, p) => entries.remove(e, r, Number(p[0])) },

  { method: 'GET', pattern: /^\/api\/room$/, handler: (e, r) => community.room(e, r) },
  { method: 'PATCH', pattern: /^\/api\/room$/, handler: (e, r) => community.updateRoom(e, r) },
  { method: 'GET', pattern: /^\/api\/users$/, handler: (e, r) => community.users(e, r) },
  { method: 'GET', pattern: /^\/api\/users\/(\d+)$/, handler: (e, r, p) => community.userProfile(e, r, Number(p[0])) },
  { method: 'POST', pattern: /^\/api\/admin\/ban$/, handler: (e, r) => community.ban(e, r, true) },
  { method: 'POST', pattern: /^\/api\/admin\/unban$/, handler: (e, r) => community.ban(e, r, false) },
  { method: 'POST', pattern: /^\/api\/admin\/reset-password$/, handler: (e, r) => community.resetPassword(e, r) },

  { method: 'GET', pattern: /^\/api\/ping$/, handler: () => community.ping() },
  { method: 'GET', pattern: /^\/api\/version$/, handler: (e) => community.version(e) },
];

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  checkCsrf(request);
  let pathMatched = false;
  for (const r of routes) {
    const m = r.pattern.exec(url.pathname);
    if (!m) continue;
    pathMatched = true;
    if (r.method !== request.method) continue;
    return r.handler(env, request, m.slice(1));
  }
  if (pathMatched) throw fail(405, 'method_not_allowed', 'method not allowed');
  throw fail(404, 'not_found', 'no such endpoint');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const res = await handle(request, env);
      const headers = new Headers(res.headers);
      headers.set('x-content-type-options', 'nosniff');
      return new Response(res.body, { status: res.status, headers });
    } catch (e) {
      if (e instanceof HttpError) {
        return json({ error: e.code, message: e.message }, { status: e.status });
      }
      console.error('unhandled', e);
      return json({ error: 'internal', message: 'something went wrong' }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
