import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client } from './server.mjs';

let server;
let owner, alice, bob;
before(async () => {
  server = await startServer({ vars: { POST_LIMIT_PER_MIN: 1000, POST_LIMIT_PER_DAY: 100000 } });
}, { timeout: 120000 });
after(() => server?.stop());

const mk = (ip) => new Client(server.base, ip);
const entry = (over = {}) => ({ text: 'hello world', character: 'anna', ...over });

test('static art index is served and the dev harness is not', async () => {
  const c = mk('10.1.0.1');
  const r = await c.get('/art/index.json');
  assert.equal(r.status, 200);
  assert.ok(r.data.characters.length >= 30);
  assert.equal((await c.get('/dev/render.html')).status, 404);
});

test('the first account becomes the owner', async () => {
  owner = mk('10.1.0.2');
  const r = await owner.post('/api/register', { username: 'zoe', password: 'correct horse', display: 'Zoe' });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.role, 'owner');
  assert.ok(owner.cookie.startsWith('cg_session='));
  assert.equal((await owner.get('/api/me')).data.user.display, 'Zoe');
});

test('later accounts are members', async () => {
  alice = mk('10.1.0.3');
  const r = await alice.post('/api/register', { username: 'alice', password: 'wonderland1', display: 'Alice', character: 'anna' });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.role, 'member');
  assert.equal(r.data.user.character, 'anna');
  bob = mk('10.1.0.4');
  assert.equal((await bob.post('/api/register', { username: 'bob', password: 'builder123', display: 'Bob' })).status, 201);
});

test('duplicate username or signature is refused, case-insensitively', async () => {
  const c = mk('10.1.0.5');
  let r = await c.post('/api/register', { username: 'ALICE', password: 'whatever123', display: 'Someone' });
  assert.equal(r.status, 409);
  assert.equal(r.data.error, 'username_taken');
  r = await c.post('/api/register', { username: 'carol', password: 'whatever123', display: 'alice' });
  assert.equal(r.status, 409);
  assert.equal(r.data.error, 'name_taken');
});

test('registration validates input', async () => {
  let n = 0;
  for (const body of [
    { username: 'ab', password: 'longenough', display: 'x' },
    { username: 'bad name!', password: 'longenough', display: 'x' },
    { username: 'validname', password: 'short', display: 'x' },
    { username: 'validname', password: 'longenough', display: '' },
    { username: 'validname', password: 'longenough', display: 'x'.repeat(40) },
    { username: 'validname', password: 'longenough', display: 'evil‮name' },
    { username: 'validname', password: 'longenough', display: 'ok', character: 'no-such-char' },
    { username: 'validname', password: 'longenough', display: 'Departed #4' },
  ]) {
    const c = mk(`10.1.6.${++n}`); // registration is rate limited per address
    const r = await c.post('/api/register', body);
    assert.equal(r.status, 400, JSON.stringify(body));
  }
});

test('state-changing requests need the CSRF header and a same-origin Origin', async () => {
  const c = mk('10.1.0.7');
  let r = await c.req('POST', '/api/login', { username: 'alice', password: 'wonderland1' }, { 'x-requested-with': null });
  assert.equal(r.status, 403);
  r = await c.req('POST', '/api/login', { username: 'alice', password: 'wonderland1' }, { origin: 'https://evil.example' });
  assert.equal(r.status, 403);
  r = await c.req('POST', '/api/login', 'not json', { 'content-type': 'text/plain' });
  assert.equal(r.status, 415);
  r = await c.req('POST', '/api/login', '{"username":', {});
  assert.equal(r.status, 400);
});

test('login: right password works, wrong password and unknown user look identical', async () => {
  const c = mk('10.1.0.8');
  const bad1 = await c.post('/api/login', { username: 'alice', password: 'wrong-password' });
  const bad2 = await c.post('/api/login', { username: 'nobody', password: 'wrong-password' });
  assert.equal(bad1.status, 401);
  assert.deepEqual(bad1.data, bad2.data);
  const ok = await c.post('/api/login', { username: 'Alice', password: 'wonderland1' });
  assert.equal(ok.status, 200);
  assert.equal((await c.get('/api/me')).status, 200);
});

test('repeated failures lock a username out for a while', async () => {
  const c = mk('10.1.0.9');
  let last;
  for (let i = 0; i < 10; i++) last = await c.post('/api/login', { username: 'locked-out-user', password: 'nope-nope-nope' });
  assert.equal(last.status, 429);
  // The lockout is per username, so a different account is unaffected.
  const other = await mk('10.1.0.10').post('/api/login', { username: 'bob', password: 'builder123' });
  assert.equal(other.status, 200);
});

test('logout ends the session', async () => {
  const c = mk('10.1.0.11');
  await c.post('/api/login', { username: 'alice', password: 'wonderland1' });
  assert.equal((await c.get('/api/me')).status, 200);
  const old = c.cookie;
  await c.post('/api/logout', {});
  assert.equal((await c.get('/api/me')).status, 401);
  c.cookie = old;
  assert.equal((await c.get('/api/me')).status, 401, 'the old token no longer works');
});

test('posting requires sign-in', async () => {
  assert.equal((await mk('10.1.0.12').post('/api/entries', entry())).status, 401);
});

test('entries are validated', async () => {
  const bads = [
    entry({ text: '' }), entry({ text: '   ' }), entry({ text: 'x'.repeat(1001) }),
    entry({ text: 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\nm' }),
    entry({ character: 'nope' }), entry({ character: '../etc' }),
    entry({ kind: 'whisper' }), entry({ kind: 'shout' }),
    entry({ fmt: [[3, 1, null]] }), entry({ fmt: [[11, 99, null]] }), entry({ fmt: [[11, 1, 'red']] }),
    entry({ em: { e: 99, i: 0.5 } }), entry({ em: { e: 1, i: 2 } }), entry({ em: 'happy' }),
    entry({ backdrop: 'nope' }), entry({ to: [1, 2, 3, 4, 5] }), entry({ to: ['x'] }), entry({ to: [99999] }),
    entry({ text: 'bad \u0000 char' }), entry({ text: 'bidi ‮ trick' }),
  ];
  for (const b of bads) {
    const r = await alice.post('/api/entries', b);
    assert.equal(r.status, 400, JSON.stringify(b).slice(0, 80));
  }
});

test('a good entry is stored and returned', async () => {
  const text = 'Hello <b>there</b> & "friends"; DROP TABLE entries;--';
  const r = await alice.post('/api/entries', entry({
    text, kind: 'think',
    fmt: [[6, 0, null], [12, 1, null], [text.length - 18, 0, '#ff0000']], em: { e: 0.785, i: 0.6 }, backdrop: 'space',
  }));
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const e = r.data.entry;
  assert.equal(e.author, 'Alice');
  assert.equal(e.kind, 'think');
  assert.equal(e.backdrop, 'space');
  assert.deepEqual(e.em, { e: 0.785, i: 0.6 });
  assert.equal(e.text, text);
});

test('entries list in order with paging in both directions', async () => {
  for (let i = 1; i <= 7; i++) {
    const c = i % 2 ? alice : bob;
    const r = await c.post('/api/entries', entry({ text: `message ${i}` }));
    assert.equal(r.status, 201, JSON.stringify(r.data));
  }
  const all = (await alice.get('/api/entries?limit=100')).data;
  assert.equal(all.entries.length, 8);
  const ids = all.entries.map((e) => e.id);
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b));

  const p1 = (await alice.get('/api/entries?limit=3')).data;
  assert.equal(p1.entries.length, 3);
  assert.equal(p1.more, true);
  const p2 = (await alice.get(`/api/entries?limit=3&after=${p1.entries.at(-1).id}`)).data;
  assert.deepEqual(p2.entries.map((e) => e.id), ids.slice(3, 6));
  const p3 = (await alice.get(`/api/entries?limit=3&after=${p2.entries.at(-1).id}`)).data;
  assert.equal(p3.more, false);
  assert.deepEqual([...p1.entries, ...p2.entries, ...p3.entries].map((e) => e.id), ids);

  const older = (await alice.get(`/api/entries?limit=3&before=${ids.at(-1)}`)).data;
  assert.deepEqual(older.entries.map((e) => e.id), ids.slice(-4, -1));
  assert.equal(older.more, true);
  assert.equal((await alice.get('/api/entries?limit=abc')).status, 400);
});

test('reading the strip does not need an account', async () => {
  const r = await mk('10.1.0.13').get('/api/entries');
  assert.equal(r.status, 200);
  assert.ok(r.data.entries.length >= 8);
});

test('you can remove your own entry but not someone elses; the owner can remove any', async () => {
  const mine = (await alice.post('/api/entries', entry({ text: 'to delete' }))).data.entry;
  assert.equal((await bob.del(`/api/entries/${mine.id}`)).status, 403);
  assert.equal((await alice.del(`/api/entries/${mine.id}`)).status, 200);
  assert.equal((await alice.del(`/api/entries/${mine.id}`)).status, 404);
  const other = (await bob.post('/api/entries', entry({ text: 'bobs words' }))).data.entry;
  assert.equal((await owner.del(`/api/entries/${other.id}`)).status, 200);
  const ids = (await alice.get('/api/entries?limit=1000')).data.entries.map((e) => e.id);
  assert.ok(!ids.includes(mine.id) && !ids.includes(other.id));
});

test('deleting bumps the room revision so cached clients know to refetch', async () => {
  const before = (await alice.get('/api/room')).data.rev;
  const e = (await alice.post('/api/entries', entry({ text: 'rev check' }))).data.entry;
  assert.equal((await alice.get('/api/room')).data.rev, before, 'posting does not bump rev');
  await alice.del(`/api/entries/${e.id}`);
  assert.equal((await alice.get('/api/room')).data.rev, before + 1);
});

test('profiles: homepage must be http(s); signature names stay unique', async () => {
  let r = await alice.patch('/api/me', { homepage: 'javascript:alert(1)' });
  assert.equal(r.status, 400);
  r = await alice.patch('/api/me', { homepage: 'https://example.com/alice' });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.homepage, 'https://example.com/alice');
  r = await alice.patch('/api/me', { display: 'bob' });
  assert.equal(r.status, 409);
  r = await alice.patch('/api/me', { profile: 'I like tea.', prefs: { ignore: [99], macros: { hi: '/say hi' } } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.user.prefs.ignore, [99]);
  r = await alice.patch('/api/me', { prefs: { big: 'x'.repeat(20000) } });
  assert.equal(r.status, 400);
  r = await alice.patch('/api/me', { character: 'nope' });
  assert.equal(r.status, 400);
});

test('the member directory never exposes login names', async () => {
  const r = await alice.get('/api/users');
  assert.equal(r.status, 200);
  const text = JSON.stringify(r.data);
  assert.ok(!text.includes('"username"'));
  assert.ok(!/pass/i.test(text));
  const alicePub = r.data.users.find((u) => u.name === 'Alice');
  assert.ok(alicePub && alicePub.posts >= 1);
  const prof = await alice.get(`/api/users/${alicePub.id}`);
  assert.equal(prof.data.user.profile, 'I like tea.');
});

test('moderation: only the owner can ban; banned users cannot post', async () => {
  const bobId = (await alice.get('/api/users')).data.users.find((u) => u.name === 'Bob').id;
  assert.equal((await alice.post('/api/admin/ban', { userId: bobId })).status, 403);
  assert.equal((await owner.post('/api/admin/ban', { userId: bobId, reason: 'being rude' })).status, 200);
  const r = await bob.post('/api/entries', entry());
  assert.equal(r.status, 401, 'ban also ends their sessions');
  const relog = mk('10.1.0.20');
  await relog.post('/api/login', { username: 'bob', password: 'builder123' });
  const r2 = await relog.post('/api/entries', entry());
  assert.equal(r2.status, 403);
  assert.match(r2.data.message, /being rude/);
  assert.equal((await owner.post('/api/admin/unban', { userId: bobId })).status, 200);
  assert.equal((await relog.post('/api/entries', entry({ text: 'back again' }))).status, 201);
});

test('the owner cannot ban themselves', async () => {
  const ownerId = (await owner.get('/api/me')).data.user.id;
  assert.equal((await owner.post('/api/admin/ban', { userId: ownerId })).status, 400);
});

test('room settings are owner-only and validated', async () => {
  assert.equal((await alice.patch('/api/room', { motd: 'hax' })).status, 403);
  let r = await owner.patch('/api/room', { motd: 'Welcome!', defaultBackdrop: 'space', topic: 'Chat away' });
  assert.equal(r.status, 200);
  assert.equal(r.data.motd, 'Welcome!');
  assert.equal(r.data.defaultBackdrop, 'space');
  assert.equal((await owner.patch('/api/room', { defaultBackdrop: 'nope' })).status, 400);
  r = await owner.patch('/api/room', { sceneChanges: false });
  assert.equal(r.data.sceneChanges, false);
  assert.equal((await alice.post('/api/entries', entry({ backdrop: 'field' }))).status, 403);
  assert.equal((await owner.post('/api/entries', entry({ backdrop: 'field' }))).status, 201, 'owner may still change scenes');
  await owner.patch('/api/room', { sceneChanges: true });
});

test('changing a password signs out other sessions', async () => {
  const a = mk('10.1.0.30');
  const b = mk('10.1.0.31');
  await a.post('/api/register', { username: 'dana', password: 'oldpassword1', display: 'Dana' });
  await b.post('/api/login', { username: 'dana', password: 'oldpassword1' });
  assert.equal((await b.get('/api/me')).status, 200);
  assert.equal((await a.post('/api/me/password', { oldPassword: 'wrong', newPassword: 'newpassword1' })).status, 401);
  assert.equal((await a.post('/api/me/password', { oldPassword: 'oldpassword1', newPassword: 'newpassword1' })).status, 200);
  assert.equal((await b.get('/api/me')).status, 401, 'other session ended');
  assert.equal((await a.get('/api/me')).status, 200, 'this session continues');
  assert.equal((await mk('10.1.0.32').post('/api/login', { username: 'dana', password: 'oldpassword1' })).status, 401);
  assert.equal((await mk('10.1.0.33').post('/api/login', { username: 'dana', password: 'newpassword1' })).status, 200);
});

test('closing an account anonymises it and keeps the strip intact', async () => {
  const c = mk('10.1.0.40');
  await c.post('/api/register', { username: 'leaver', password: 'leaving1234', display: 'Leaver' });
  await c.post('/api/entries', entry({ text: 'I was here' }));
  assert.equal((await c.del('/api/me', { password: 'wrong' })).status, 401);
  assert.equal((await c.del('/api/me', { password: 'leaving1234' })).status, 200);
  assert.equal((await c.get('/api/me')).status, 401);
  assert.equal((await mk('10.1.0.41').post('/api/login', { username: 'leaver', password: 'leaving1234' })).status, 401);
  const list = (await alice.get('/api/entries?limit=1000')).data.entries;
  const left = list.find((e) => e.text === 'I was here');
  assert.ok(left);
  assert.match(left.author, /^Departed #/);
  const names = (await alice.get('/api/users')).data.users.map((u) => u.name);
  assert.ok(!names.some((n) => n.startsWith('Departed')));
  assert.equal((await owner.del('/api/me', { password: 'correct horse' })).status, 400, 'owner cannot close');
});

test('unknown endpoints and methods are handled', async () => {
  const c = mk('10.1.0.50');
  assert.equal((await c.get('/api/nope')).status, 404);
  assert.equal((await c.req('PUT', '/api/entries', {})).status, 405);
  const ping = await c.get('/api/ping');
  assert.ok(Math.abs(ping.data.t - Date.now()) < 60000);
  assert.equal((await c.get('/api/version')).data.phase, 1);
});
