import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client } from './server.mjs';

// OWNER_SETUP_TOKEN: nobody can claim the owner account without the secret.

test('without the setup token nobody can become the owner (no owner name configured)', async () => {
  const s = await startServer({ vars: { OWNER_SETUP_TOKEN: 's3cret-token' } });
  try {
    const first = new Client(s.base, '10.3.0.1');
    let r = await first.post('/api/register', { username: 'squatter', password: 'password123', display: 'Squatter' });
    assert.equal(r.status, 403);
    assert.equal(r.data.error, 'not_set_up');
    r = await first.post('/api/register', { username: 'squatter', password: 'password123', display: 'Squatter', ownerToken: 'wrong' });
    assert.equal(r.status, 403);

    const real = new Client(s.base, '10.3.0.2');
    r = await real.post('/api/register', { username: 'realowner', password: 'password123', display: 'Owner', ownerToken: 's3cret-token' });
    assert.equal(r.status, 201);
    assert.equal(r.data.user.role, 'owner');

    const member = new Client(s.base, '10.3.0.3');
    r = await member.post('/api/register', { username: 'friend', password: 'password123', display: 'Friend', ownerToken: 's3cret-token' });
    assert.equal(r.status, 201);
    assert.equal(r.data.user.role, 'member', 'only the first account is the owner, token or not');
  } finally { s.stop(); }
}, { timeout: 120000 });

test('with OWNER_USERNAME set, that name is reserved for whoever holds the token', async () => {
  const s = await startServer({ vars: { OWNER_USERNAME: 'boss', OWNER_SETUP_TOKEN: 's3cret-token' } });
  try {
    const a = new Client(s.base, '10.3.1.1');
    let r = await a.post('/api/register', { username: 'Boss', password: 'password123', display: 'Fake Boss' });
    assert.equal(r.status, 403);
    assert.equal(r.data.error, 'owner_reserved');
    r = await a.post('/api/register', { username: 'someone', password: 'password123', display: 'Someone' });
    assert.equal(r.status, 201);
    assert.equal(r.data.user.role, 'member');
    const b = new Client(s.base, '10.3.1.2');
    r = await b.post('/api/register', { username: 'boss', password: 'password123', display: 'The Boss', ownerToken: 's3cret-token' });
    assert.equal(r.status, 201);
    assert.equal(r.data.user.role, 'owner');
  } finally { s.stop(); }
}, { timeout: 120000 });

test('without any setup token the first account is the owner (documented default)', async () => {
  const s = await startServer();
  try {
    const r = await new Client(s.base, '10.3.2.1').post('/api/register', { username: 'first', password: 'password123', display: 'First' });
    assert.equal(r.data.user.role, 'owner');
  } finally { s.stop(); }
}, { timeout: 120000 });
