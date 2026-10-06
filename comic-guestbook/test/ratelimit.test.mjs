import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client } from './server.mjs';

// Runs against a server with the DEFAULT limits.
let server;
before(async () => { server = await startServer(); }, { timeout: 120000 });
after(() => server?.stop());

test('posts are limited to 12 a minute per user', async () => {
  const c = new Client(server.base, '10.2.0.1');
  assert.equal((await c.post('/api/register', { username: 'spammer', password: 'spamspam1', display: 'Spammer' })).status, 201);
  const codes = [];
  for (let i = 0; i < 15; i++) codes.push((await c.post('/api/entries', { text: `spam ${i}`, character: 'anna' })).status);
  assert.equal(codes.filter((s) => s === 201).length, 12);
  assert.equal(codes.filter((s) => s === 429).length, 3);
});

test('registration is limited per address', async () => {
  const codes = [];
  for (let i = 0; i < 7; i++) {
    const c = new Client(server.base, '10.2.0.2');
    codes.push((await c.post('/api/register', { username: `user${i}x`, password: 'passw0rd!!', display: `User ${i}` })).status);
  }
  assert.equal(codes.filter((s) => s === 201).length, 5);
  assert.equal(codes.filter((s) => s === 429).length, 2);
  // a different address is unaffected
  const other = new Client(server.base, '10.2.0.3');
  assert.equal((await other.post('/api/register', { username: 'someoneelse', password: 'passw0rd!!', display: 'Else' })).status, 201);
});
