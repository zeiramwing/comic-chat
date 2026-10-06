import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInput, findMentions, findUserByName } from '../public/js/commands.js';

const ctx = { macros: { Hello: 'Hi there!\n/me waves', Empty: '  ' } };

test('plain text passes through; // escapes a slash', () => {
  assert.deepEqual(parseInput('hello', ctx), { type: 'plain', text: 'hello' });
  assert.deepEqual(parseInput('//not a command', ctx), { type: 'plain', text: '/not a command' });
});

test('speech commands', () => {
  assert.deepEqual(parseInput('/me waves', ctx), { type: 'speech', kind: 'action', text: 'waves' });
  assert.deepEqual(parseInput('/think hmm', ctx), { type: 'speech', kind: 'think', text: 'hmm' });
  assert.deepEqual(parseInput('/say  hi  ', ctx), { type: 'speech', kind: 'say', text: 'hi' });
  assert.equal(parseInput('/me', ctx).type, 'error');
});

test('/to takes a plain or quoted name', () => {
  assert.deepEqual(parseInput('/to anna hello you', ctx), { type: 'speech', kind: 'say', text: 'hello you', to: 'anna' });
  assert.deepEqual(parseInput('/to "Mary Jane" hi', ctx), { type: 'speech', kind: 'say', text: 'hi', to: 'Mary Jane' });
  assert.equal(parseInput('/to anna', ctx).type, 'error');
});

test('macros run by name or /macro, case-insensitively, one command per line', () => {
  const r = parseInput('/hello', ctx);
  assert.equal(r.type, 'macro');
  assert.deepEqual(r.lines, ['Hi there!', '/me waves']);
  assert.equal(parseInput('/macro HELLO', ctx).type, 'macro');
  assert.equal(parseInput('/macro nothing', ctx).type, 'error');
  assert.equal(parseInput('/empty', ctx).type, 'error');
});

test('known commands and unknown ones', () => {
  assert.deepEqual(parseInput('/ignore Bob', ctx), { type: 'command', name: 'ignore', args: 'Bob' });
  assert.deepEqual(parseInput('/ping', ctx), { type: 'command', name: 'ping', args: '' });
  assert.equal(parseInput('/frobnicate', ctx).type, 'error');
  assert.equal(parseInput('/', ctx).type, 'error');
});

const users = new Map([[1, { id: 1, name: 'Alice' }], [2, { id: 2, name: 'Bob' }], [3, { id: 3, name: 'Bob Jr' }], [4, { id: 4, name: 'Zed' }]]);

test('@mentions match whole names, prefer the longest, and skip yourself', () => {
  assert.deepEqual(findMentions('hi @Alice and @bob!', users, 4).sort(), [1, 2]);
  assert.deepEqual(findMentions('hello @Bob Jr', users, 4), [3]);
  assert.deepEqual(findMentions('@Alicex is not a mention', users, 4), []);
  assert.deepEqual(findMentions('@Zed talking to myself', users, 4), []);
});

test('findUserByName: exact, then unique prefix', () => {
  assert.equal(findUserByName('alice', users).id, 1);
  assert.equal(findUserByName('@Zed', users).id, 4);
  assert.equal(findUserByName('al', users).id, 1);
  assert.equal(findUserByName('bo', users), undefined, 'ambiguous prefix');
  assert.equal(findUserByName('nobody', users), undefined);
});
