import type { Env, UserRow } from '../types.ts';
import { fail, json, readJson, sessionCookie, clearCookie, getCookie } from '../lib/http.ts';
import { hashPassword, verifyPassword } from '../lib/crypto.ts';
import { createSession, destroySession, destroyAllSessions, requireUser, SESSION_SECONDS } from '../lib/auth.ts';
import { hit, count, clientKey } from '../lib/ratelimit.ts';
import { artIndex } from '../lib/art.ts';
import * as v from '../lib/validate.ts';

export const userDTO = (u: UserRow) => ({
  id: u.id,
  username: u.username,
  display: u.display_name,
  role: u.role,
  character: u.character,
  profile: u.profile,
  homepage: u.homepage,
  prefs: safeParse(u.prefs, {}),
  createdAt: u.created_at,
});

export function safeParse<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function unwrap<T>(r: v.Result<T>): T {
  if (!r.ok) throw fail(400, 'invalid', r.error);
  return r.value;
}

// A pre-computed record so unknown usernames cost the same as known ones.
let dummy: Promise<{ hash: string; salt: string; iter: number }> | null = null;

export async function register(env: Env, request: Request): Promise<Response> {
  await hit(env, `reg:${await clientKey(request)}`, 5, 3600);
  const body = await readJson(request);
  const username = unwrap(v.username(body.username));
  const password = unwrap(v.password(body.password));
  const display = unwrap(v.displayName(body.display ?? body.username));
  let character = '';
  if (body.character !== undefined && body.character !== '') {
    character = unwrap(v.slug(body.character, 'character'));
    if (!(await artIndex(env, request.url)).characters.has(character)) throw fail(400, 'invalid', 'unknown character');
  }

  const rec = await hashPassword(password);
  const now = Date.now();
  const ownerName = (env.OWNER_USERNAME ?? '').trim().toLowerCase();
  // The very first account (when no OWNER_USERNAME is configured) or the
  // configured owner becomes the owner. Decided inside the INSERT so two
  // simultaneous first registrations cannot both win.
  const roleSql = ownerName
    ? "CASE WHEN lower(?1) = ?2 THEN 'owner' ELSE 'member' END"
    : "CASE WHEN (SELECT COUNT(*) FROM users) = 0 THEN 'owner' ELSE 'member' END";
  let row: UserRow | null;
  try {
    const stmt = env.DB.prepare(
      `INSERT INTO users (username, display_name, pass_hash, pass_salt, pass_iter, role, character, created_at, last_seen_at)
       VALUES (?1, ?3, ?4, ?5, ?6, ${roleSql}, ?7, ?8, ?8) RETURNING *`,
    );
    row = await stmt.bind(username, ownerName, display, rec.hash, rec.salt, rec.iter, character, now).first<UserRow>();
  } catch (e) {
    const msg = String((e as Error).message);
    if (/UNIQUE/i.test(msg) && /username/i.test(msg)) throw fail(409, 'username_taken', 'that username is taken');
    if (/UNIQUE/i.test(msg) && /display_name/i.test(msg)) throw fail(409, 'name_taken', 'that signature name is taken');
    throw e;
  }
  if (!row) throw fail(500, 'internal', 'could not create account');
  const token = await createSession(env, row.id);
  return json({ user: userDTO(row) }, { status: 201, headers: { 'set-cookie': sessionCookie(token, request, SESSION_SECONDS) } });
}

export async function login(env: Env, request: Request): Promise<Response> {
  const ip = await clientKey(request);
  await hit(env, `login-ip:${ip}`, 30, 900);
  const body = await readJson(request);
  const name = typeof body.username === 'string' ? body.username.trim().toLowerCase().slice(0, 64) : '';
  const pass = typeof body.password === 'string' ? body.password.slice(0, 200) : '';
  if (!name || !pass) throw fail(400, 'invalid', 'username and password are required');
  if ((await count(env, `login-fail:${name}`, 900)) >= 8) throw fail(429, 'rate_limited', 'too many failed attempts, wait a few minutes');

  const row = await env.DB.prepare('SELECT * FROM users WHERE username = ?1').bind(name).first<UserRow>();
  dummy ??= hashPassword('not-a-real-password');
  const rec = row ? { hash: row.pass_hash, salt: row.pass_salt, iter: row.pass_iter } : await dummy;
  const good = await verifyPassword(pass, rec);
  if (!row || !good) {
    await hit(env, `login-fail:${name}`, 1000, 900);
    throw fail(401, 'bad_credentials', 'wrong username or password');
  }
  const token = await createSession(env, row.id);
  return json({ user: userDTO(row) }, { headers: { 'set-cookie': sessionCookie(token, request, SESSION_SECONDS) } });
}

export async function logout(env: Env, request: Request): Promise<Response> {
  const token = getCookie(request, 'cg_session');
  if (token) await destroySession(env, token);
  return json({ ok: true }, { headers: { 'set-cookie': clearCookie(request) } });
}

export async function me(env: Env, request: Request): Promise<Response> {
  const u = await requireUser(env, request);
  return json({ user: userDTO(u) });
}

export async function updateMe(env: Env, request: Request): Promise<Response> {
  const u = await requireUser(env, request);
  const body = await readJson(request);
  const sets: string[] = [];
  const args: unknown[] = [];
  const set = (col: string, val: unknown) => { args.push(val); sets.push(`${col} = ?${args.length}`); };

  if (body.display !== undefined) set('display_name', unwrap(v.displayName(body.display)));
  if (body.profile !== undefined) set('profile', unwrap(v.profile(body.profile)));
  if (body.homepage !== undefined) set('homepage', unwrap(v.homepage(body.homepage)));
  if (body.character !== undefined) {
    const c = body.character === '' ? '' : unwrap(v.slug(body.character, 'character'));
    if (c && !(await artIndex(env, request.url)).characters.has(c)) throw fail(400, 'invalid', 'unknown character');
    set('character', c);
  }
  if (body.prefs !== undefined) set('prefs', JSON.stringify(unwrap(v.prefs(body.prefs))));
  if (!sets.length) return json({ user: userDTO(u) });
  args.push(u.id);
  try {
    const row = await env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?${args.length} RETURNING *`)
      .bind(...args).first<UserRow>();
    return json({ user: userDTO(row ?? u) });
  } catch (e) {
    if (/UNIQUE/i.test(String((e as Error).message))) throw fail(409, 'name_taken', 'that signature name is taken');
    throw e;
  }
}

export async function changePassword(env: Env, request: Request): Promise<Response> {
  const u = await requireUser(env, request);
  await hit(env, `pw:${u.id}`, 10, 900);
  const body = await readJson(request);
  const oldPass = typeof body.oldPassword === 'string' ? body.oldPassword : '';
  const newPass = unwrap(v.password(body.newPassword));
  if (!(await verifyPassword(oldPass, { hash: u.pass_hash, salt: u.pass_salt, iter: u.pass_iter }))) {
    throw fail(401, 'bad_credentials', 'current password is wrong');
  }
  const rec = await hashPassword(newPass);
  await env.DB.prepare('UPDATE users SET pass_hash = ?1, pass_salt = ?2, pass_iter = ?3 WHERE id = ?4')
    .bind(rec.hash, rec.salt, rec.iter, u.id).run();
  // Sign out everywhere else, then issue this browser a fresh session.
  await destroyAllSessions(env, u.id);
  const token = await createSession(env, u.id);
  return json({ ok: true }, { headers: { 'set-cookie': sessionCookie(token, request, SESSION_SECONDS) } });
}

/** Close the account. History stays (anonymised) unless deleteEntries is set. */
export async function deleteMe(env: Env, request: Request): Promise<Response> {
  const u = await requireUser(env, request);
  await hit(env, `pw:${u.id}`, 10, 900);
  const body = await readJson(request);
  const pass = typeof body.password === 'string' ? body.password : '';
  if (!(await verifyPassword(pass, { hash: u.pass_hash, salt: u.pass_salt, iter: u.pass_iter }))) {
    throw fail(401, 'bad_credentials', 'password is wrong');
  }
  if (u.role === 'owner') throw fail(400, 'invalid', 'the owner account cannot be closed');
  const statements = [
    env.DB.prepare(
      `UPDATE users SET username = ?1, display_name = ?2, pass_hash = '', pass_salt = '', profile = '', homepage = '',
              prefs = '{}', character = '', banned = 1, ban_reason = 'account closed' WHERE id = ?3`,
    ).bind(`closed-${u.id}`, `Departed #${u.id}`, u.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(u.id),
  ];
  if (body.deleteEntries === true) {
    statements.push(env.DB.prepare('UPDATE entries SET deleted = 1 WHERE user_id = ?1').bind(u.id));
    statements.push(env.DB.prepare('UPDATE rooms SET rev = rev + 1'));
  } else {
    statements.push(env.DB.prepare('UPDATE entries SET author = ?1 WHERE user_id = ?2').bind(`Departed #${u.id}`, u.id));
    statements.push(env.DB.prepare('UPDATE rooms SET rev = rev + 1'));
  }
  await env.DB.batch(statements);
  return json({ ok: true }, { headers: { 'set-cookie': clearCookie(request) } });
}
