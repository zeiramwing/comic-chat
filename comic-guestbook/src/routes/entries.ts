import type { Env, EntryDTO, EntryRow } from '../types.ts';
import { fail, json, readJson, intParam } from '../lib/http.ts';
import { requireUser } from '../lib/auth.ts';
import { hit } from '../lib/ratelimit.ts';
import { artIndex } from '../lib/art.ts';
import { safeParse } from './account.ts';
import * as v from '../lib/validate.ts';

const COLS = 'id, user_id, author, character, emotion, intensity, kind, text, fmt, backdrop, to_ids, created_at';

export function entryDTO(r: EntryRow): EntryDTO {
  return {
    id: r.id,
    userId: r.user_id,
    author: r.author,
    character: r.character,
    em: r.emotion === null ? null : { e: r.emotion, i: r.intensity ?? 1 },
    kind: r.kind,
    text: r.text,
    fmt: safeParse(r.fmt, null),
    backdrop: r.backdrop,
    to: safeParse<number[]>(r.to_ids, []),
    ts: r.created_at,
  };
}

const unwrap = <T>(r: v.Result<T>): T => {
  if (!r.ok) throw fail(400, 'invalid', r.error);
  return r.value;
};

export async function list(env: Env, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const room = intParam(url, 'room', 1, 1, 1_000_000);
  const limit = intParam(url, 'limit', 500, 1, 1000);
  const afterRaw = url.searchParams.get('after');
  const beforeRaw = url.searchParams.get('before');

  const roomRow = await env.DB.prepare('SELECT rev FROM rooms WHERE id = ?1').bind(room).first<{ rev: number }>();
  if (!roomRow) throw fail(404, 'not_found', 'no such room');

  let rows: EntryRow[];
  if (beforeRaw !== null) {
    const before = intParam(url, 'before', 0, 0, Number.MAX_SAFE_INTEGER);
    const res = await env.DB.prepare(
      `SELECT ${COLS} FROM entries WHERE room_id = ?1 AND deleted = 0 AND id < ?2 ORDER BY id DESC LIMIT ?3`,
    ).bind(room, before, limit + 1).all<EntryRow>();
    rows = res.results.reverse();
    const more = rows.length > limit;
    if (more) rows.shift();
    return json({ rev: roomRow.rev, entries: rows.map(entryDTO), more });
  }
  const after = afterRaw === null ? 0 : intParam(url, 'after', 0, 0, Number.MAX_SAFE_INTEGER);
  const res = await env.DB.prepare(
    `SELECT ${COLS} FROM entries WHERE room_id = ?1 AND deleted = 0 AND id > ?2 ORDER BY id ASC LIMIT ?3`,
  ).bind(room, after, limit + 1).all<EntryRow>();
  rows = res.results;
  const more = rows.length > limit;
  if (more) rows.pop();
  return json({ rev: roomRow.rev, entries: rows.map(entryDTO), more });
}

export async function create(env: Env, request: Request): Promise<Response> {
  const user = await requireUser(env, request);
  if (user.banned) throw fail(403, 'banned', user.ban_reason ? `you have been banned: ${user.ban_reason}` : 'you have been banned');
  await hit(env, `post:${user.id}`, Number(env.POST_LIMIT_PER_MIN) || 12, 60);
  await hit(env, `post-day:${user.id}`, Number(env.POST_LIMIT_PER_DAY) || 300, 86400);

  const body = await readJson(request);
  const kind = unwrap(v.kind(body.kind));
  const em = unwrap(v.emotion(body.em));
  // An expression is your character reacting with no words: it needs an
  // explicit emotion and carries no text.
  const isExpression = kind === 'expression';
  if (isExpression && !em) throw fail(400, 'invalid', 'an expression needs an emotion');
  const text = isExpression ? '' : unwrap(v.messageText(body.text));
  const fmt = isExpression ? null : unwrap(v.fmt(body.fmt, text.length));
  const to = unwrap(v.toIds(body.to));

  const art = await artIndex(env, request.url);
  const character = unwrap(v.slug(body.character ?? user.character, 'character'));
  if (!art.characters.has(character)) throw fail(400, 'invalid', 'unknown character');

  const room = await env.DB.prepare('SELECT id, scene_changes FROM rooms WHERE id = ?1')
    .bind(Number(body.room ?? 1)).first<{ id: number; scene_changes: number }>();
  if (!room) throw fail(404, 'not_found', 'no such room');

  let backdrop: string | null = null;
  if (body.backdrop !== undefined && body.backdrop !== null && body.backdrop !== '') {
    backdrop = unwrap(v.slug(body.backdrop, 'backdrop'));
    if (!art.backdrops.has(backdrop)) throw fail(400, 'invalid', 'unknown backdrop');
    if (!room.scene_changes && user.role !== 'owner') throw fail(403, 'forbidden', 'scene changes are turned off');
  }

  if (to.length) {
    const marks = to.map((_, i) => `?${i + 1}`).join(',');
    const found = await env.DB.prepare(`SELECT id FROM users WHERE id IN (${marks})`).bind(...to).all<{ id: number }>();
    if (found.results.length !== to.length) throw fail(400, 'invalid', 'to contains an unknown user');
  }

  const row = await env.DB.prepare(
    `INSERT INTO entries (room_id, user_id, author, character, emotion, intensity, kind, text, fmt, backdrop, to_ids, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12) RETURNING ${COLS}`,
  ).bind(
    room.id, user.id, user.display_name, character, em ? em.e : null, em ? em.i : null, kind, text,
    fmt ? JSON.stringify(fmt) : null, backdrop, to.length ? JSON.stringify(to) : null, Date.now(),
  ).first<EntryRow>();
  if (!row) throw fail(500, 'internal', 'could not save entry');

  // Remember the character the visitor last used.
  if (user.character !== character) {
    await env.DB.prepare('UPDATE users SET character = ?1 WHERE id = ?2').bind(character, user.id).run();
  }
  return json({ entry: entryDTO(row) }, { status: 201 });
}

export async function remove(env: Env, request: Request, id: number): Promise<Response> {
  const user = await requireUser(env, request);
  const row = await env.DB.prepare('SELECT user_id FROM entries WHERE id = ?1 AND deleted = 0').bind(id).first<{ user_id: number }>();
  if (!row) throw fail(404, 'not_found', 'no such entry');
  if (row.user_id !== user.id && user.role !== 'owner') throw fail(403, 'forbidden', 'you can only remove your own entries');
  await env.DB.batch([
    env.DB.prepare('UPDATE entries SET deleted = 1 WHERE id = ?1').bind(id),
    env.DB.prepare('UPDATE rooms SET rev = rev + 1'),
  ]);
  return json({ ok: true });
}
