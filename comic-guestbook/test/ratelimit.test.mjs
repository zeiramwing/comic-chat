import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client } from './server.mjs';

// Runs against a server with the DEFAULT limits.
//
// The limiter uses fixed windows, so a burst of requests that straddles a window
// boundary would legitimately get two allowances. Start bursts early in a window.
async function startOfWindow(windowMs, needMs) {
  const into = Date.now() % windowMs;
  if (windowMs - into < needMs) await new Promise((r) => setTimeout(r, windowMs - into + 50));
}

let server;
before(async () => { server = await startServer(); }, { timeout: 120000 });
after(() => server?.stop());

test('posts are limited to 12 a minute per user', async () => {
  await startOfWindow(60_000, 20_000);
  const c = new Client(server.base, '10.2.0.1');
  assert.equal((await c.post('/api/register', { username: 'spammer', password: 'spamspam1', display: 'Spammer' })).status, 201);
  const codes = [];
  for (let i = 0; i < 15; i++) codes.push((await c.post('/api/entries', { text: `spam ${i}`, character: 'anna' })).status);
  assert.equal(codes.filter((s) => s === 201).length, 12);
  assert.equal(codes.filter((s) => s === 429).length, 3);
});

test('registration is limited per address', async () => {
  await startOfWindow(3_600_000, 30_000);
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

test('long-window counters survive pruning of short windows (daily post limit holds)', async () => {
  // Regression: pruning used to compare window indexes across window sizes and
  // could delete live hourly/daily counters, silently disabling those limits.
  const sec = Math.floor(Date.now() / 1000) % 86400;
  if (sec < 600 || sec > 86400 - 600) return; // too close to the daily window rollover to assert exactly
  const own = await startServer({ vars: { POST_LIMIT_PER_MIN: 100000, POST_LIMIT_PER_DAY: 100 } });
  try {
    const c = new Client(own.base, '10.2.1.1');
    assert.equal((await c.post('/api/register', { username: 'daily', password: 'passw0rd!!', display: 'Daily' })).status, 201);
    let ok = 0;
    for (let i = 0; i < 160; i++) {
      const r = await c.post('/api/entries', { text: `msg ${i}`, character: 'anna' });
      if (r.status === 201) ok++;
    }
    assert.equal(ok, 100, `the daily limit of 100 should hold across ~3 prune passes, got ${ok}`);
  } finally {
    own.stop();
  }
});
