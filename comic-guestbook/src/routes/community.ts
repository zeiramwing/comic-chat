import type { Env, RoomRow, UserRow } from '../types.ts';
import { fail, json, readJson, intParam } from '../lib/http.ts';
import { currentUser, requireOwner } from '../lib/auth.ts';
import { artIndex } from '../lib/art.ts';
import * as v from '../lib/validate.ts';

const unwrap = <T>(r: v.Result<T>): T => {
  if (!r.ok) throw fail(400, 'invalid', r.error);
  return r.value;
};

const roomDTO = (r: RoomRow, env: Env, entries: number) => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  topic: r.topic,
  motd: r.motd,
  defaultBackdrop: r.default_backdrop,
  sceneChanges: r.scene_changes === 1,
  rev: r.rev,
  entries,
  siteName: env.SITE_NAME ?? 'Comic Guestbook',
});

export async function room(env: Env, request: Request): Promise<Response> {
  const id = intParam(new URL(request.url), 'room', 1, 1, 1_000_000);
  const r = await env.DB.prepare('SELECT * FROM rooms WHERE id = ?1').bind(id).first<RoomRow>();
  if (!r) throw fail(404, 'not_found', 'no such room');
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM entries WHERE room_id = ?1 AND deleted = 0').bind(id).first<{ n: number }>();
  return json(roomDTO(r, env, n?.n ?? 0));
}

export async function updateRoom(env: Env, request: Request): Promise<Response> {
  await requireOwner(env, request);
  const body = await readJson(request);
  const sets: string[] = [];
  const args: unknown[] = [];
  const set = (col: string, val: unknown) => { args.push(val); sets.push(`${col} = ?${args.length}`); };

  if (body.name !== undefined) {
    const s = unwrap(v.displayName(body.name));
    set('name', s);
  }
  if (body.topic !== undefined) set('topic', unwrap(v.profile(body.topic)).slice(0, 200));
  if (body.motd !== undefined) set('motd', unwrap(v.profile(body.motd)));
  if (body.defaultBackdrop !== undefined) {
    const b = unwrap(v.slug(body.defaultBackdrop, 'backdrop'));
    if (!(await artIndex(env, request.url)).backdrops.has(b)) throw fail(400, 'invalid', 'unknown backdrop');
    set('default_backdrop', b);
  }
  if (body.sceneChanges !== undefined) set('scene_changes', body.sceneChanges ? 1 : 0);
  if (sets.length) {
    await env.DB.prepare(`UPDATE rooms SET ${sets.join(', ')}, rev = rev + 1 WHERE id = 1`).bind(...args).run();
  }
  return room(env, new Request(new URL('/api/room', request.url)));
}

// ---------------------------------------------------------------------------

type UserListRow = Pick<UserRow, 'id' | 'display_name' | 'character' | 'homepage' | 'role' | 'created_at' | 'last_seen_at' | 'banned'> & { posts: number };

const publicUser = (u: UserListRow, includeBanned: boolean) => ({
  id: u.id,
  name: u.display_name,
  character: u.character,
  homepage: u.homepage,
  owner: u.role === 'owner',
  since: u.created_at,
  lastSeen: u.last_seen_at,
  posts: u.posts,
  ...(includeBanned ? { banned: u.banned === 1 } : {}),
});

/** Directory of people who have signed (or can). Never reveals login names. */
export async function users(env: Env, request: Request): Promise<Response> {
  const viewer = await currentUser(env, request);
  const res = await env.DB.prepare(
    `SELECT u.id, u.display_name, u.character, u.homepage, u.role, u.created_at, u.last_seen_at, u.banned,
            (SELECT COUNT(*) FROM entries e WHERE e.user_id = u.id AND e.deleted = 0) AS posts
     FROM users u WHERE u.display_name NOT LIKE 'Departed #%' ORDER BY u.display_name COLLATE NOCASE LIMIT 1000`,
  ).all<UserListRow>();
  const owner = viewer?.role === 'owner';
  return json({ users: res.results.map((u) => publicUser(u, owner)) });
}

export async function userProfile(env: Env, request: Request, id: number): Promise<Response> {
  const viewer = await currentUser(env, request);
  const u = await env.DB.prepare(
    `SELECT u.*, (SELECT COUNT(*) FROM entries e WHERE e.user_id = u.id AND e.deleted = 0) AS posts FROM users u WHERE u.id = ?1`,
  ).bind(id).first<UserRow & { posts: number }>();
  if (!u || u.display_name.startsWith('Departed #')) throw fail(404, 'not_found', 'no such member');
  return json({
    user: { ...publicUser(u, viewer?.role === 'owner'), profile: u.profile },
  });
}

// ---------------------------------------------------------------------------
// Moderation (owner only): the guestbook equivalents of Kick / Ban / Host.

export async function ban(env: Env, request: Request, ban: boolean): Promise<Response> {
  const owner = await requireOwner(env, request);
  const body = await readJson(request);
  const id = Number(body.userId);
  if (!Number.isInteger(id) || id <= 0) throw fail(400, 'invalid', 'userId required');
  if (id === owner.id) throw fail(400, 'invalid', 'you cannot ban yourself');
  const reason = ban ? unwrap(v.profile(body.reason ?? '')).slice(0, 200) : '';
  const res = await env.DB.prepare('UPDATE users SET banned = ?1, ban_reason = ?2 WHERE id = ?3 AND role != \'owner\'')
    .bind(ban ? 1 : 0, reason, id).run();
  if (!res.meta.changes) throw fail(404, 'not_found', 'no such member');
  if (ban) {
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(id).run();
    if (body.removeEntries === true) {
      await env.DB.batch([
        env.DB.prepare('UPDATE entries SET deleted = 1 WHERE user_id = ?1').bind(id),
        env.DB.prepare('UPDATE rooms SET rev = rev + 1'),
      ]);
    }
  }
  return json({ ok: true });
}

export async function ping(): Promise<Response> {
  return json({ t: Date.now() });
}

export async function version(env: Env): Promise<Response> {
  return json({ name: env.SITE_NAME ?? 'Comic Guestbook', version: '0.1.0', phase: 1 });
}
