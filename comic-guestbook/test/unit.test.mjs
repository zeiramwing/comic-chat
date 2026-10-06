import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { hashPassword, verifyPassword, timingSafeEqual, temporaryPassword, newToken, sha256Hex } from '../src/lib/crypto.ts';
import * as v from '../src/lib/validate.ts';

test('passwords hash with a random salt and verify', async () => {
  const a = await hashPassword('correct horse battery', 1000);
  const b = await hashPassword('correct horse battery', 1000);
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.hash, b.hash);
  assert.equal(await verifyPassword('correct horse battery', a), true);
  assert.equal(await verifyPassword('correct horse batterz', a), false);
  assert.equal(await verifyPassword('', a), false);
  assert.equal(await verifyPassword('x', { hash: '', salt: '', iter: 1000 }), false, 'closed accounts never verify');
});

test('timingSafeEqual', () => {
  assert.equal(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])), true);
  assert.equal(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])), false);
  assert.equal(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3])), false);
});

test('tokens and temporary passwords are random and well-formed', async () => {
  assert.match(newToken(), /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(newToken(), newToken());
  const p = temporaryPassword(14);
  assert.match(p, /^[A-HJ-NP-Za-km-z2-9]{14}$/, 'no look-alike characters (0 O 1 l I)');
  assert.equal((await sha256Hex('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('tools/set-password.mjs prints SQL whose hash verifies', async () => {
  const out = execFileSync('node', ['tools/set-password.mjs', 'zoe', 'a-new-password-1'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  const m = /pass_hash='([^']+)', pass_salt='([^']+)', pass_iter=(\d+) WHERE username='zoe'/.exec(out);
  assert.ok(m, out);
  assert.equal(await verifyPassword('a-new-password-1', { hash: m[1], salt: m[2], iter: Number(m[3]) }), true);
  assert.equal(await verifyPassword('wrong', { hash: m[1], salt: m[2], iter: Number(m[3]) }), false);
  assert.throws(() => execFileSync('node', ['tools/set-password.mjs', 'x; DROP TABLE users'], { cwd: new URL('..', import.meta.url), stdio: 'pipe' }));
});

// ---- validation ---------------------------------------------------------

const ok = (r) => assert.equal(r.ok, true, JSON.stringify(r));
const bad = (r) => assert.equal(r.ok, false, JSON.stringify(r));

test('usernames', () => {
  ok(v.username('good_name-1.x')); bad(v.username('ab')); bad(v.username('x'.repeat(25))); bad(v.username('has space')); bad(v.username("o'brien")); bad(v.username(5));
});

test('display names: trimmed, collapsed, no control or bidi characters', () => {
  assert.equal(v.displayName('  Mary   Jane  ').value, 'Mary Jane');
  bad(v.displayName('')); bad(v.displayName('a\u0007b')); bad(v.displayName('a‮b')); bad(v.displayName('Departed #12')); bad(v.displayName('x'.repeat(33)));
  ok(v.displayName('Zoë 🎭'));
});

test('homepage: http(s) only', () => {
  assert.equal(v.homepage('').value, '');
  ok(v.homepage('https://example.com/a?b=c'));
  bad(v.homepage('javascript:alert(1)')); bad(v.homepage('data:text/html,hi')); bad(v.homepage('ftp://x.example')); bad(v.homepage('not a url'));
});

test('message text: length, lines, control characters, links', () => {
  assert.equal(v.messageText('  hi \r\n there  ').value, 'hi\n there');
  bad(v.messageText('   ')); bad(v.messageText('x'.repeat(1001))); bad(v.messageText('a\u0000b'));
  bad(v.messageText(Array(20).fill('x').join('\n')));
  bad(v.messageText('http://a.example http://b.example http://c.example http://d.example'));
  ok(v.messageText('http://a.example http://b.example http://c.example'));
  assert.equal(v.messageText('a\n\n\n\n\nb').value, 'a\n\nb');
});

test('emotion: angles, gestures, intensity', () => {
  assert.equal(v.emotion(undefined).value, null);
  ok(v.emotion({ e: 0, i: 0 })); ok(v.emotion({ e: 3.14159, i: 0.5 })); ok(v.emotion({ e: 1003, i: 1 }));
  bad(v.emotion({ e: 7, i: 0.5 })); bad(v.emotion({ e: 1, i: 1.5 })); bad(v.emotion({ e: 1500, i: 1 })); bad(v.emotion({ e: NaN, i: 0 })); bad(v.emotion('x')); bad(v.emotion({ e: '1', i: 0 }));
});

test('kind: whisper is phase 2', () => {
  ok(v.kind('say')); ok(v.kind('expression')); bad(v.kind('whisper')); ok(v.kind('whisper', true)); bad(v.kind('yell')); assert.equal(v.kind(undefined).value, 'say');
});

test('to ids and prefs', () => {
  assert.deepEqual(v.toIds([1, 2, 2, 3]).value, [1, 2, 3]);
  bad(v.toIds([1, 2, 3, 4, 5])); bad(v.toIds([0])); bad(v.toIds(['1'])); bad(v.toIds('1'));
  ok(v.prefs({ a: 1 })); bad(v.prefs([])); bad(v.prefs(null)); bad(v.prefs({ big: 'x'.repeat(20000) }));
});

test('slugs', () => {
  ok(v.slug('anna-artpack1', 'x')); bad(v.slug('Anna', 'x')); bad(v.slug('../x', 'x')); bad(v.slug('', 'x')); bad(v.slug('a'.repeat(41), 'x'));
});
