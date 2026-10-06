import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPanels, StripBuilder, LIMITS, orderCast, prng, hash } from '../public/js/shared/layout.js';

let nextId = 1;
const e = (userId, text, extra = {}) => ({
  id: nextId++, userId, author: `U${userId}`, character: `c${userId}`, em: null,
  kind: 'say', text, fmt: null, backdrop: null, to: [], ts: nextId, ...extra,
});

test('first entry makes the first panel', () => {
  const p = buildPanels([e(1, 'hello')]);
  assert.equal(p.length, 1);
  assert.equal(p[0].lines.length, 1);
  assert.equal(p[0].cast.length, 1);
});

test('different speakers share a panel', () => {
  const p = buildPanels([e(1, 'hi'), e(2, 'hello'), e(3, 'hey')]);
  assert.equal(p.length, 1);
  assert.deepEqual(p[0].lines.map((l) => l.userId), [1, 2, 3]);
  assert.equal(p[0].cast.length, 3);
});

test('a speaker already in the panel starts a new one', () => {
  const p = buildPanels([e(1, 'a'), e(2, 'b'), e(1, 'c')]);
  assert.equal(p.length, 2);
  assert.deepEqual(p[1].lines.map((l) => l.userId), [1]);
});

test('the same person posting twice gets two panels', () => {
  const p = buildPanels([e(1, 'one'), e(1, 'two')]);
  assert.equal(p.length, 2);
});

test('no more than MAX_BALLOONS per panel', () => {
  const entries = Array.from({ length: 7 }, (_, i) => e(i + 1, 'x'));
  const p = buildPanels(entries);
  assert.ok(p.every((x) => x.lines.length <= LIMITS.MAX_BALLOONS));
  assert.equal(p.reduce((n, x) => n + x.lines.length, 0), 7);
});

test('actions always start a new panel but later lines can join it', () => {
  const p = buildPanels([e(1, 'a'), e(2, 'waves', { kind: 'action' }), e(3, 'b')]);
  assert.equal(p.length, 2);
  assert.equal(p[1].lines[0].kind, 'action');
  assert.equal(p[1].lines.length, 2);
});

test('long messages split across panels without losing text', () => {
  const text = 'This is a sentence that goes on. '.repeat(20).trim();
  const p = buildPanels([e(1, text)]);
  assert.ok(p.length > 1);
  const joined = p.flatMap((x) => x.lines.map((l) => l.text)).join(' ');
  assert.equal(joined.replace(/\s+/g, ' '), text.replace(/\s+/g, ' '));
  assert.ok(p.every((x) => x.lines.every((l) => l.text.length <= LIMITS.CHUNK_CHARS)));
});

test('the line budget pushes a wordy panel onward', () => {
  const wordy = 'w '.repeat(90).trim(); // ~ 180 chars, ~7 lines each
  const p = buildPanels([e(1, wordy), e(2, wordy), e(3, wordy)]);
  assert.ok(p.length >= 2);
});

test('backdrop changes start a new panel and stick afterwards', () => {
  const p = buildPanels([
    e(1, 'a', { backdrop: 'space' }), e(2, 'b'), e(3, 'c', { backdrop: 'field' }), e(4, 'd'),
  ], { defaultBackdrop: 'pastoral' });
  assert.deepEqual(p.map((x) => x.backdrop), ['space', 'field']);
  assert.deepEqual(p[1].lines.map((l) => l.userId), [3, 4]);
});

test('the default backdrop applies until changed', () => {
  const p = buildPanels([e(1, 'a')], { defaultBackdrop: 'pastoral' });
  assert.equal(p[0].backdrop, 'pastoral');
});

test('people addressed with `to` join the panel if they have posted before', () => {
  // user 2 spoke in an earlier panel; user 3 holds the current one
  const p = buildPanels([e(2, 'a'), e(2, 'b'), e(3, 'c'), e(3, 'd'), e(1, 'hey you', { to: [2] })]);
  const panel = p[p.length - 1];
  assert.deepEqual(panel.cast.map((c) => c.userId).sort(), [1, 2, 3]);
  assert.equal(panel.cast.find((c) => c.userId === 2).requested, false);
  assert.equal(panel.cast.find((c) => c.userId === 3).requested, true);
});

test('addressing someone already speaking in the panel keeps them a speaker', () => {
  const p = buildPanels([e(2, 'earlier'), e(1, 'hey you', { to: [2] })]);
  assert.equal(p.length, 1);
  assert.equal(p[0].cast.find((c) => c.userId === 2).requested, true);
});

test('strangers addressed with `to` are ignored (never seen, no character)', () => {
  const p = buildPanels([e(1, 'hello?', { to: [99] })]);
  assert.deepEqual(p[0].cast.map((c) => c.userId), [1]);
});

test('cast never exceeds MAX_CAST', () => {
  const prior = Array.from({ length: 8 }, (_, i) => e(i + 10, 'hi'));
  const p = buildPanels([...prior, e(1, 'everyone', { to: [10, 11, 12, 13, 14, 15, 16, 17] })]);
  assert.ok(p.every((x) => x.cast.length <= LIMITS.MAX_CAST));
});

test('layout is deterministic and incremental building matches batch', () => {
  nextId = 1;
  const entries = [];
  for (let i = 0; i < 60; i++) entries.push(e((i * 7) % 5 + 1, `message number ${i} `.repeat(1 + (i % 4)), { to: i % 3 === 0 ? [((i + 1) % 5) + 1] : [] }));
  const a = buildPanels(entries);
  const b = buildPanels(entries);
  assert.deepEqual(a, b);
  const inc = new StripBuilder();
  entries.forEach((x) => inc.push(x));
  assert.deepEqual(inc.panels, a);
});

test('appending never rewrites panels before the last', () => {
  nextId = 1;
  const entries = Array.from({ length: 30 }, (_, i) => e((i % 4) + 1, `m${i}`));
  const before = buildPanels(entries.slice(0, 20));
  const after = buildPanels(entries);
  const stable = before.slice(0, -1);
  assert.deepEqual(after.slice(0, stable.length), stable);
});

// ---- ordering ----------------------------------------------------------

test('two characters who address each other face each other', () => {
  const state = new Map();
  const cast = orderCast([
    { userId: 1, character: 'a', requested: true, talkTos: [2] },
    { userId: 2, character: 'b', requested: true, talkTos: [1] },
  ], state);
  assert.equal(cast.length, 2);
  const [left, right] = cast;
  assert.equal(left.flip, false, 'left one faces right');
  assert.equal(right.flip, true, 'right one faces left');
});

test('a lone character keeps facing the way it faced last time (hysteresis)', () => {
  const state = new Map([[1, { lastDir: true }]]);
  const cast = orderCast([{ userId: 1, character: 'a', requested: true, talkTos: [] }], state);
  assert.equal(cast[0].flip, true);
});

test('prng and hash are stable', () => {
  const r = prng(123);
  assert.deepEqual([r(), r(), r()].map((x) => Math.round(x * 1e6)), (() => { const q = prng(123); return [q(), q(), q()].map((x) => Math.round(x * 1e6)); })());
  assert.equal(hash('a', 1), hash('a', 1));
  assert.notEqual(hash('a', 1), hash('a', 2));
});

// ---- expressions (wordless reactions) -----------------------------------

const expr = (userId, em = { e: 0, i: 1 }, extra = {}) => e(userId, '', { kind: 'expression', em, ...extra });

test('an expression adds no balloon and changes the speaker pose in the same panel', () => {
  const p = buildPanels([e(1, 'hi'), expr(1, { e: 3.14, i: 1 })]);
  assert.equal(p.length, 1);
  assert.equal(p[0].lines.length, 1);
  assert.equal(p[0].reactions.length, 1);
  assert.equal(p[0].cast.length, 1);
});

test('an expression by someone new brings them into the panel', () => {
  const p = buildPanels([e(1, 'hi'), expr(2)]);
  assert.equal(p.length, 1);
  assert.deepEqual(p[0].cast.map((c) => c.userId).sort(), [1, 2]);
  assert.equal(p[0].lines.length, 1);
});

test('a lone expression starts a panel with no balloons', () => {
  const p = buildPanels([expr(1)]);
  assert.equal(p.length, 1);
  assert.equal(p[0].lines.length, 0);
  assert.equal(p[0].cast.length, 1);
});

test('a later reaction by the same person replaces the earlier one', () => {
  const p = buildPanels([e(1, 'hi'), expr(1, { e: 1, i: 1 }), expr(1, { e: 2, i: 1 })]);
  assert.equal(p[0].reactions.length, 1);
  assert.equal(p[0].reactions[0].em.e, 2);
});

test('a full panel pushes a new person’s expression onto a new panel', () => {
  const p = buildPanels([e(1, 'a'), e(2, 'b'), e(3, 'c'), e(4, 'd'), e(5, 'e'), expr(6)]);
  assert.equal(p.length, 2);
  assert.equal(p[1].cast[0].userId, 6);
});

test('someone who reacted cannot also speak in the same panel (they are already in it)', () => {
  const p = buildPanels([expr(1), e(1, 'now I speak')]);
  assert.equal(p.length, 2);
});

test('people who were only addressed also start a new panel when they speak', () => {
  const p = buildPanels([e(2, 'x'), e(2, 'y'), e(3, 'z'), e(3, 'w'), e(1, 'hey', { to: [2] }), e(2, 'hi back')]);
  const last = p.at(-1);
  assert.deepEqual(last.lines.map((l) => l.userId), [2]);
});
