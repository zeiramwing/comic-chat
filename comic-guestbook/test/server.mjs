// Starts an isolated `wrangler dev` (own persisted D1) for integration tests.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  s.on('error', reject);
});

export async function startServer({ vars = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-test-'));
  const mig = spawnSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'comic-guestbook', '--local', '--persist-to', dir], { cwd: ROOT, encoding: 'utf8' });
  if (mig.status !== 0) throw new Error(`migration failed:\n${mig.stdout}\n${mig.stderr}`);
  const port = await freePort();
  const args = ['wrangler', 'dev', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', dir, '--inspector-port', String(await freePort())];
  for (const [k, val] of Object.entries(vars)) args.push('--var', `${k}:${val}`);
  const proc = spawn('npx', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(`${base}/api/ping`); if (r.ok) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
    if (i === 119) throw new Error(`wrangler dev did not start:\n${log}`);
  }
  return {
    base,
    stop() {
      try { process.kill(-proc.pid, 'SIGTERM'); } catch { /* already gone */ }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** A tiny fetch wrapper with a cookie jar and the CSRF header. */
export class Client {
  constructor(base, ip = '10.0.0.1') {
    this.base = base;
    this.cookie = '';
    this.ip = ip;
  }
  async req(method, url, body, headers = {}) {
    const h = { 'cf-connecting-ip': this.ip, ...headers };
    if (this.cookie) h.cookie = this.cookie;
    let payload;
    if (body !== undefined) {
      payload = typeof body === 'string' ? body : JSON.stringify(body);
      h['content-type'] ??= 'application/json';
    }
    if (method !== 'GET') {
      if (h['x-requested-with'] === undefined) h['x-requested-with'] = 'comic-guestbook';
      else if (h['x-requested-with'] === null) delete h['x-requested-with'];
    }
    const res = await fetch(this.base + url, { method, headers: h, body: payload });
    const set = res.headers.get('set-cookie');
    if (set) {
      const pair = set.split(';')[0];
      this.cookie = pair.endsWith('=') ? '' : pair;
    }
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  }
  get(url) { return this.req('GET', url); }
  post(url, body, headers) { return this.req('POST', url, body, headers); }
  patch(url, body) { return this.req('PATCH', url, body); }
  del(url, body) { return this.req('DELETE', url, body); }
}
