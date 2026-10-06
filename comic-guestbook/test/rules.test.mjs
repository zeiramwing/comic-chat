import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENTS, ACTIONS, newRule, newRuleSet, sanitizeRuleSets, matches, evaluate, viewEffects, pickLine, expand,
} from '../public/js/shared/rules.js';

const ctx = { meId: 1, meName: 'Me', roomName: 'Room', isHost: false, macros: { greet: 'Hello!\nHi there!\nWelcome!' } };
const msg = (userId, text, author = `U${userId}`) => ({ type: 'onMessage', userId, author, text });
const set = (...rules) => [{ ...newRuleSet('s'), active: true, rules }];
const rule = (over) => ({ ...newRule(), ...over });

test('the vocabulary matches Microsoft Chat 2.5 (11 events, 30 actions)', () => {
  assert.equal(Object.keys(EVENTS).length, 11);
  assert.equal(Object.keys(ACTIONS).length, 30);
});

test('phase-1 actions are exactly the ones that make sense without live rooms', () => {
  const live = Object.entries(ACTIONS).filter(([, a]) => a.phase === 2).map(([k]) => k);
  for (const k of ['joinRoom', 'kick', 'sendWhisper', 'connect', 'invite']) assert.ok(live.includes(k), k);
  assert.ok(!live.includes('beep'));
});

test('who: anyone / me / anyoneButMe / a specific member', () => {
  const e = msg(2, 'hi');
  assert.ok(matches(rule({ who: 'anyone' }), e, ctx));
  assert.ok(matches(rule({ who: 'anyoneButMe' }), e, ctx));
  assert.ok(!matches(rule({ who: 'me' }), e, ctx));
  assert.ok(matches(rule({ who: 'me' }), msg(1, 'hi'), ctx));
  assert.ok(!matches(rule({ who: 'anyoneButMe' }), msg(1, 'hi'), ctx));
  assert.ok(matches(rule({ who: 'user:2' }), e, ctx));
  assert.ok(!matches(rule({ who: 'user:3' }), e, ctx));
  assert.ok(!matches(rule({ who: 'bogus' }), e, ctx));
});

test('contains is case-insensitive; disabled rules and other events never match', () => {
  assert.ok(matches(rule({ contains: 'HELLO' }), msg(2, 'say hello there'), ctx));
  assert.ok(!matches(rule({ contains: 'bye' }), msg(2, 'say hello there'), ctx));
  assert.ok(!matches(rule({ enabled: false }), msg(2, 'x'), ctx));
  assert.ok(!matches(rule({ event: 'onJoin' }), msg(2, 'x'), ctx));
});

test('evaluate returns side effects with placeholders expanded', () => {
  const s = set(rule({ actions: [{ type: 'beep', count: 3 }, { type: 'notifyDialog', text: '{name} said {message} in {room} to {me}' }] }));
  const out = evaluate(msg(2, 'hi', 'Bob'), s, ctx);
  assert.deepEqual(out.map((o) => o.effect.type), ['beep', 'notifyDialog']);
  assert.equal(out[0].effect.count, 3);
  assert.equal(out[1].effect.text, 'Bob said hi in Room to Me');
});

test('beep count and sound names are clamped to safe values', () => {
  const s = set(rule({ actions: [{ type: 'beep', count: 999 }, { type: 'playSound', sound: '../evil' }] }));
  const [a, b] = evaluate(msg(2, 'x'), s, ctx).map((o) => o.effect);
  assert.equal(a.count, 5);
  assert.equal(b.sound, 'attention');
});

test('only the active rule set runs', () => {
  const sets = [
    { ...newRuleSet('a'), active: false, rules: [rule({ actions: [{ type: 'beep' }] })] },
    { ...newRuleSet('b'), active: true, rules: [rule({ actions: [{ type: 'playSound', sound: 'beep' }] })] },
  ];
  const out = evaluate(msg(2, 'x'), sets, ctx);
  assert.deepEqual(out.map((o) => o.effect.type), ['playSound']);
  assert.deepEqual(evaluate(msg(2, 'x'), [], ctx), []);
});

test('minimum delay suppresses a rule until it has passed', () => {
  const s = set(rule({ id: 'r1', minDelay: 30, actions: [{ type: 'beep' }] }));
  const fired = new Map();
  assert.equal(evaluate(msg(2, 'x'), s, ctx, fired, 1000).length, 1);
  assert.equal(evaluate(msg(2, 'x'), s, ctx, fired, 20_000).length, 0);
  assert.equal(evaluate(msg(2, 'x'), s, ctx, fired, 31_001).length, 1);
});

test('phase-2 actions and view actions never produce side effects', () => {
  const s = set(rule({ actions: [{ type: 'kick' }, { type: 'doNotDisplay' }, { type: 'highlightMessage' }, { type: 'sendWhisper' }] }));
  assert.deepEqual(evaluate(msg(2, 'x'), s, ctx), []);
});

test('ban is only for the host', () => {
  const s = set(rule({ actions: [{ type: 'ban' }] }));
  assert.equal(evaluate(msg(2, 'x'), s, ctx).length, 0);
  assert.equal(evaluate(msg(2, 'x'), s, { ...ctx, isHost: true }).length, 1);
});

test('sendFileLine picks lines by number, range or RND', () => {
  const text = 'one\ntwo\nthree';
  assert.equal(pickLine(text, '2'), 'two');
  assert.equal(pickLine(text, '9'), null);
  assert.equal(pickLine(text, '2-3', () => 0), 'two');
  assert.equal(pickLine(text, '2-3', () => 0.99), 'three');
  assert.equal(pickLine(text, 'RND', () => 0), 'one');
  assert.equal(pickLine('', 'RND'), null);
  const s = set(rule({ actions: [{ type: 'sendFileLine', macro: 'greet', line: '2' }] }));
  assert.equal(evaluate(msg(2, 'x'), s, ctx)[0].effect.text, 'Hi there!');
  const missing = set(rule({ actions: [{ type: 'sendFileLine', macro: 'nope', line: '1' }] }));
  assert.equal(evaluate(msg(2, 'x'), missing, ctx).length, 0);
});

test('view effects are pure: hide, highlight and replace', () => {
  const s = set(
    rule({ contains: 'spoiler', actions: [{ type: 'doNotDisplay' }] }),
    rule({ who: 'user:5', actions: [{ type: 'highlightMessage' }] }),
    rule({ contains: 'darn', actions: [{ type: 'replaceMessage', text: '{name} said something rude' }] }),
  );
  assert.equal(viewEffects({ userId: 2, author: 'B', text: 'big SPOILER ahead' }, s, ctx).hide, true);
  assert.equal(viewEffects({ userId: 5, author: 'E', text: 'hello' }, s, ctx).highlight, true);
  assert.equal(viewEffects({ userId: 2, author: 'B', text: 'oh darn' }, s, ctx).text, 'B said something rude');
  assert.deepEqual(viewEffects({ userId: 2, author: 'B', text: 'fine' }, s, ctx), { hide: false, highlight: false, text: null });
  assert.equal(viewEffects({ userId: 2, author: 'B', text: 'x' }, [], ctx).hide, false);
});

test('expand leaves unknown braces alone', () => {
  assert.equal(expand('a {nope} {name}', msg(2, 'x', 'Z'), ctx), 'a {nope} Z');
});

test('sanitizeRuleSets repairs corrupt preferences', () => {
  assert.deepEqual(sanitizeRuleSets('nonsense'), []);
  const raw = [
    { name: 'a', active: true, rules: [{ event: 'onMessage', actions: [{ type: 'beep' }, { type: 'bogus' }, null], who: 'anyone', minDelay: -5 }, { event: 'nope' }, 7] },
    { name: 'b', active: true, rules: [] },
    null,
  ];
  const clean = sanitizeRuleSets(raw);
  assert.equal(clean.length, 2);
  assert.equal(clean.filter((s) => s.active).length, 1, 'at most one active set');
  assert.equal(clean[0].rules.length, 1);
  assert.deepEqual(clean[0].rules[0].actions, [{ type: 'beep' }]);
  assert.equal(clean[0].rules[0].minDelay, 0);
});
