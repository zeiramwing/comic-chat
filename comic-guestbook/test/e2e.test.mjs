// End-to-end tests: real UI in headless Chromium against a real `wrangler dev`.
// Skipped automatically when no Chromium can be found (set CHROME to point at one).

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer, Client } from './server.mjs';

let chromium = null;
let executablePath = process.env.CHROME || '/opt/pw-browsers/chromium';
try { ({ chromium } = await import('playwright-core')); } catch { /* not installed */ }
const haveBrowser = !!chromium && fs.existsSync(executablePath);
const opts = { skip: haveBrowser ? false : 'no Chromium available (set CHROME)' };

let server, browser;
const seeded = {}; // username -> { client, id }
const problems = [];

before(async () => {
  if (!haveBrowser) return;
  server = await startServer({ vars: { POST_LIMIT_PER_MIN: 1000, POST_LIMIT_PER_DAY: 100000 } });
  browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
  let n = 0;
  for (const [u, ch, d] of [['host', 'anna', 'Hostess'], ['bob', 'bolo', 'Bob'], ['cathy', 'cro', 'Cathy']]) {
    const c = new Client(server.base, `10.8.0.${++n}`);
    const r = await c.post('/api/register', { username: u, password: 'password123', display: d, character: ch });
    assert.equal(r.status, 201);
    seeded[u] = { client: c, id: r.data.user.id, display: d };
  }
}, { timeout: 150000 });

after(async () => {
  await browser?.close();
  server?.stop();
});

async function open(user, { width = 1280, height = 800, touch = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await page.goto(`${server.base}/`);
  if (user) {
    await page.waitForSelector('#app:not([hidden])');
    await page.evaluate(async (u) => {
      const r = await fetch('/api/login', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'comic-guestbook' },
        body: JSON.stringify({ username: u, password: 'password123' }),
      });
      if (!r.ok) throw new Error('login failed');
    }, user);
    await page.reload();
  }
  await page.waitForSelector('#app:not([hidden])');
  return { page, ctx };
}

const apiEntries = async () => (await seeded.host.client.get('/api/entries?limit=1000')).data.entries;
const panelCount = (page) => page.locator('.panel').count();
const say = async (page, text) => {
  await page.fill('.saybar textarea', text);
  await page.keyboard.press('Enter');
};
/** Where to click on the strip to hit the balloon that contains `text`. */
async function balloonPoint(page, text) {
  const info = await page.evaluate((needle) => {
    const strip = globalThis.__comicGuestbook.strip;
    const it = strip.items.find((x) => x.panel.lines.some((l) => l.text.includes(needle)));
    if (!it) return null;
    it.el.scrollIntoView({ block: 'center' });
    return { index: it.panel.index };
  }, text);
  assert.ok(info, `no panel contains ${text}`);
  await page.waitForFunction((i) => !!globalThis.__comicGuestbook.strip.items[i]?.scene, info.index);
  await page.waitForTimeout(150);
  return page.evaluate(({ index, needle }) => {
    const it = globalThis.__comicGuestbook.strip.items[index];
    const line = it.panel.lines.find((l) => l.text.includes(needle));
    const b = it.scene.balloons.find((x) => x.entryId === line.entryId);
    const r = it.el.getBoundingClientRect();
    return { x: r.left + ((b.x + b.w / 2) / 1000) * r.width, y: r.top + ((b.y + b.h / 2) / 1000) * r.height };
  }, { index: info.index, needle: text });
}

test('the page loads quietly: no console errors, strict security headers', opts, async () => {
  const { page, ctx } = await open(null);
  assert.equal(await page.title(), 'Comic Guestbook');
  assert.match(await page.textContent('#strip'), /strip is empty/);
  const res = await page.request.get(`${server.base}/`);
  const csp = res.headers()['content-security-policy'];
  assert.ok(csp && csp.includes("script-src 'self'") && csp.includes("frame-ancestors 'none'"), `csp: ${csp}`);
  assert.equal(res.headers()['x-content-type-options'], 'nosniff');
  assert.deepEqual(problems, []);
  await ctx.close();
});

test('register, pick a character and sign the guestbook', opts, async () => {
  const { page, ctx } = await open(null);
  await page.click('text=Create an account');
  await page.fill('#au-user', 'newcomer');
  await page.fill('#au-pass', 'sup3rsecret!');
  await page.fill('#au-name', 'New Comer');
  await page.click('dialog button[type=submit]');
  await page.waitForSelector('.char-grid');
  await page.click('.char-grid button[title="Anna"]');
  await page.waitForSelector('.saybar textarea');
  assert.match(await page.textContent('#whoami'), /Signed in as New Comer/);

  await say(page, 'Hello, [b]world[/b]!');
  await page.waitForSelector('.panel canvas');
  const label = await page.getAttribute('.panel', 'aria-label');
  assert.match(label, /New Comer says: Hello, world!/);

  const mine = (await apiEntries()).find((e) => e.author === 'New Comer');
  assert.equal(mine.text, 'Hello, world!');
  assert.deepEqual(mine.fmt, [[7, 0, null], [5, 1, null], [1, 0, null]]);
  assert.equal(mine.character, 'anna');
  assert.equal(mine.em, null, 'no wheel emotion chosen: the renderer reads the text');
  await ctx.close();
});

test('wrong password and duplicate names produce readable errors', opts, async () => {
  const { page, ctx } = await open(null);
  await page.click('button:has-text("Sign in")');
  await page.fill('#au-user', 'host');
  await page.fill('#au-pass', 'not-the-password');
  await page.click('dialog button[type=submit]');
  await page.waitForSelector('.error:has-text("wrong username or password")');
  await page.click('dialog [role=tab]:has-text("Create account")');
  await page.fill('#au-user', 'someone');
  await page.fill('#au-pass', 'sup3rsecret!');
  await page.fill('#au-name', 'bob');
  await page.click('dialog button[type=submit]');
  await page.waitForSelector('.error:has-text("signature name is taken")');
  await ctx.close();
});

test('the emotion wheel: drag, keyboard buttons, freeze, and it is sent with the entry', opts, async () => {
  const { page, ctx } = await open('bob');
  const wheel = await page.locator('.wheel').boundingBox();
  const cx = wheel.x + wheel.width / 2;
  const cy = wheel.y + wheel.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 52, cy, { steps: 3 }); // east = happy
  await page.mouse.up();
  assert.equal(await page.textContent('.emo-label'), 'Happy');
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy + 52, { steps: 3 }); // south = shout
  await page.mouse.up();
  assert.equal(await page.textContent('.emo-label'), 'Shout');
  await page.dblclick('.wheel .disc');
  assert.equal(await page.textContent('.emo-label'), 'Neutral');

  await page.click('.wheel button[aria-label="Sad"]');
  assert.equal(await page.textContent('.emo-label'), 'Sad');
  await page.check('#freeze-cb');
  await say(page, 'frozen and sad');
  await page.waitForFunction(() => /frozen and sad/.test(document.querySelector('#strip').textContent) || document.querySelector('.panel:last-child')?.getAttribute('aria-label')?.includes('frozen and sad'));
  assert.equal(await page.textContent('.emo-label'), 'Sad', 'frozen keeps the expression');
  const e = (await apiEntries()).find((x) => x.text === 'frozen and sad');
  assert.ok(e.em && Math.abs(e.em.e - Math.PI) < 0.01 && e.em.i > 0.5, JSON.stringify(e.em));

  await page.uncheck('#freeze-cb');
  await page.click('button:has-text("Neutral")');
  await say(page, 'not frozen');
  await page.waitForFunction(() => document.querySelector('.panel:last-child')?.getAttribute('aria-label')?.includes('not frozen'));
  const e2 = (await apiEntries()).find((x) => x.text === 'not frozen');
  assert.equal(e2.em, null);
  await ctx.close();
});

test('commands, think and action, errors, macros and input history', opts, async () => {
  const { page, ctx } = await open('bob');
  await say(page, '/me juggles');
  await page.waitForFunction(() => document.querySelector('.panel:last-child')?.getAttribute('aria-label')?.includes('Bob juggles'));
  await say(page, '/think hmm');
  await say(page, '/to nobody hi');
  await page.waitForSelector('.toast:has-text("Nobody called")');
  await say(page, '/bogus');
  await page.waitForSelector('.toast:has-text("Unknown command")');
  await say(page, '//not a command');
  await page.waitForFunction(() => document.querySelector('.panel:last-child')?.getAttribute('aria-label')?.includes('/not a command'));

  await page.click('.menu-btn:has-text("Macros")');
  await page.click('.menu-item:has-text("Define macro")');
  await page.fill('#mc-name', 'greet');
  await page.fill('#mc-body', 'Hello from a macro\n/me waves');
  await page.click('dialog button:has-text("Save")');
  await page.click('dialog button:has-text("Close")');
  await say(page, '/greet');
  await page.waitForFunction(() => /Bob waves/.test([...document.querySelectorAll('.panel')].map((p) => p.getAttribute('aria-label')).join(' ')));
  const texts = (await apiEntries()).map((e) => `${e.kind}:${e.text}`);
  assert.ok(texts.includes('say:Hello from a macro') && texts.includes('action:waves'), texts.join('|'));

  await page.click('.saybar textarea');
  await page.keyboard.press('ArrowUp');
  assert.equal(await page.inputValue('.saybar textarea'), '/greet', 'Up recalls the last line');
  await ctx.close();
});

test('formatting buttons, shortcuts and the character counter', opts, async () => {
  const { page, ctx } = await open('cathy');
  await page.fill('.saybar textarea', 'make this bold');
  await page.evaluate(() => { const t = document.querySelector('.saybar textarea'); t.setSelectionRange(5, 9); });
  await page.click('.fmt button[aria-label^="Bold"]');
  assert.equal(await page.inputValue('.saybar textarea'), 'make [b]this[/b] bold');
  assert.match(await page.textContent('.saybar .counter'), /^14 \/ 1000$/);
  await page.keyboard.press('Control+i');
  assert.match(await page.inputValue('.saybar textarea'), /\[i\]\[\/i\]/);
  await page.fill('.saybar textarea', '');
  await ctx.close();
});

test('the plain-text view mirrors the strip and highlights mentions', opts, async () => {
  await seeded.bob.client.post('/api/entries', { text: `hey @Cathy are you there?`, character: 'bolo' });
  const { page, ctx } = await open('cathy');
  await page.click('.toolbar button[aria-label="Plain text view"]');
  await page.waitForSelector('#textlog .line');
  const mention = page.locator('#textlog .line', { hasText: 'are you there' });
  assert.ok((await mention.getAttribute('class')).includes('hl'));
  assert.equal(await page.isHidden('#strip'), true);
  await page.click('.toolbar button[aria-label="Comic strip view"]');
  assert.equal(await page.isVisible('#strip'), true);
  await ctx.close();
});

test('new entries from other people arrive without reloading', opts, async () => {
  const { page, ctx } = await open('cathy');
  const before = await panelCount(page);
  await seeded.bob.client.post('/api/entries', { text: 'a brand new entry from Bob', character: 'bolo' });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); // triggers a poll
  await page.waitForFunction((n) => document.querySelectorAll('.panel').length > n || document.querySelector('.panel:last-child')?.getAttribute('aria-label')?.includes('brand new entry'), before, { timeout: 8000 });
  assert.match(await page.locator('.panel').last().getAttribute('aria-label'), /brand new entry/);
  await ctx.close();
});

test('ignoring a member hides their entries and un-ignoring restores them', opts, async () => {
  await seeded.bob.client.post('/api/entries', { text: 'IGNORE-ME-MARKER', character: 'bolo' });
  const { page, ctx } = await open('cathy');
  const hasMarker = () => page.evaluate(() => [...document.querySelectorAll('.panel')].some((p) => p.getAttribute('aria-label').includes('IGNORE-ME-MARKER')));
  assert.equal(await hasMarker(), true);
  await page.locator('.members li button', { hasText: 'Bob' }).click();
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/me') && r.request().method() === 'PATCH');
  await page.click('.menu-item:has-text("Ignore")');
  await page.waitForFunction(() => ![...document.querySelectorAll('.panel')].some((p) => p.getAttribute('aria-label').includes('IGNORE-ME-MARKER')));
  await saved; // preferences are saved shortly after a change
  await page.reload();
  await page.waitForSelector('#app:not([hidden])');
  assert.equal(await hasMarker(), false, 'ignore list persists with the account');
  await page.click('.menu-btn:has-text("Member")');
  await page.click('.menu-item:has-text("Ignored members")');
  await page.click('dialog button:has-text("Stop ignoring")');
  await page.click('dialog button:has-text("Close")');
  await page.waitForFunction(() => [...document.querySelectorAll('.panel')].some((p) => p.getAttribute('aria-label').includes('IGNORE-ME-MARKER')));
  await ctx.close();
});

test('you can remove your own entry from the strip; others cannot', opts, async () => {
  await seeded.cathy.client.post('/api/entries', { text: 'CATHY-REMOVE-ME', character: 'cro' });
  const { page, ctx } = await open('bob');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForFunction(() => [...document.querySelectorAll('.panel')].some((p) => p.getAttribute('aria-label').includes('CATHY-REMOVE-ME')));
  // Bob clicks Cathy's balloon: no "Remove this entry" for him.
  const pt = await balloonPoint(page, 'CATHY-REMOVE-ME');
  await page.mouse.click(pt.x, pt.y);
  const menuText = (await page.locator('.popup').allTextContents()).join(' ');
  assert.ok(menuText.includes('Get Cathy'), menuText);
  assert.ok(!menuText.includes('Remove this entry'), menuText);
  await page.keyboard.press('Escape');
  await ctx.close();

  const own = (await seeded.bob.client.post('/api/entries', { text: 'BOB-REMOVE-ME', character: 'bolo' })).data.entry;
  const bobPage = await open('bob');
  await bobPage.page.waitForFunction(() => [...document.querySelectorAll('.panel')].some((p) => p.getAttribute('aria-label').includes('BOB-REMOVE-ME')));
  const pt2 = await balloonPoint(bobPage.page, 'BOB-REMOVE-ME');
  await bobPage.page.mouse.click(pt2.x, pt2.y);
  await bobPage.page.click('.menu-item:has-text("Remove this entry")');
  await bobPage.page.click('dialog button:has-text("Remove")');
  await bobPage.page.waitForFunction(() => ![...document.querySelectorAll('.panel')].some((p) => p.getAttribute('aria-label').includes('BOB-REMOVE-ME')));
  assert.ok(!(await apiEntries()).some((e) => e.id === own.id));
  await bobPage.ctx.close();
});

test('the host can ban and unban; a banned member sees why', opts, async () => {
  const { page, ctx } = await open('host');
  await page.locator('.members li button', { hasText: 'Cathy' }).click();
  await page.click('.menu-item:has-text("Ban")');
  await page.click('dialog button:has-text("Ban")');
  await page.waitForSelector('.members .badge:has-text("Banned")');
  const r = await seeded.cathy.client.post('/api/entries', { text: 'let me in', character: 'cro' });
  assert.equal(r.status, 401);
  const relog = new Client(server.base, '10.8.9.9');
  await relog.post('/api/login', { username: 'cathy', password: 'password123' });
  assert.equal((await relog.post('/api/entries', { text: 'let me in', character: 'cro' })).status, 403);
  await page.locator('.members li button', { hasText: 'Cathy' }).click();
  await page.click('.menu-item:has-text("Lift ban")');
  await page.waitForFunction(() => !document.querySelector('.members .badge')?.textContent.includes('Banned') || document.querySelectorAll('.members .badge').length === 1);
  assert.equal((await relog.post('/api/entries', { text: 'thanks', character: 'cro' })).status, 201);
  await ctx.close();
});

test('exports: transcript text and JSON backup download', opts, async () => {
  const { page, ctx } = await open('host');
  let [download] = await Promise.all([page.waitForEvent('download'), (async () => { await page.click('.menu-btn:has-text("File")'); await page.click('.menu-item:has-text("transcript")'); })()]);
  assert.match(download.suggestedFilename(), /^guestbook-\d{4}-\d{2}-\d{2}\.txt$/);
  const text = fs.readFileSync(await download.path(), 'utf8');
  assert.match(text, /Bob: hey @Cathy are you there\?/);
  [download] = await Promise.all([page.waitForEvent('download'), (async () => { await page.click('.menu-btn:has-text("File")'); await page.click('.menu-item:has-text("Back up")'); })()]);
  const json = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
  assert.ok(json.entries.length > 5);
  await ctx.close();
});

test('save as picture renders a real, non-blank PNG', opts, async () => {
  const { page, ctx } = await open('host');
  await page.click('.menu-btn:has-text("File")');
  await page.click('.menu-item:has-text("Save comic as picture")');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('dialog button:has-text("Save picture")')]);
  const buf = fs.readFileSync(await download.path());
  assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.ok(buf.length > 20000, `png is only ${buf.length} bytes`);
  await ctx.close();
});

test('rules: hide and highlight from the active rule set, and the editor creates one', opts, async () => {
  const { page, ctx } = await open('host');
  await seeded.bob.client.post('/api/entries', { text: 'a SPOILER-WORD entry', character: 'bolo' });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const has = (needle) => page.evaluate((n) => [...document.querySelectorAll('.panel')].some((p) => p.getAttribute('aria-label').includes(n)), needle);
  await page.waitForFunction(() => [...document.querySelectorAll('.panel')].some((p) => p.getAttribute('aria-label').includes('SPOILER-WORD')));

  await page.click('.menu-btn:has-text("Macros")');
  await page.click('.menu-item:has-text("Automation")');
  await page.click('dialog button:has-text("New"):not(:has-text("rule"))');
  await page.click('dialog button:has-text("New rule")');
  await page.fill('#ru-name', 'hide spoilers');
  await page.selectOption('#ru-who', 'anyone');
  await page.fill('#ru-contains', 'spoiler-word');
  await page.selectOption('dialog select[aria-label="Action"]', 'doNotDisplay');
  await page.click('dialog:last-of-type button:has-text("OK")');
  await page.waitForFunction(() => !document.querySelector('.panel') || ![...document.querySelectorAll('.panel')].some((p) => p.getAttribute('aria-label').includes('SPOILER-WORD')));
  assert.equal(await has('SPOILER-WORD'), false);
  const prefs = (await page.evaluate(() => fetch('/api/me').then((r) => r.json()))).user.prefs;
  await new Promise((r) => setTimeout(r, 1200)); // prefs save is debounced
  const saved = (await (await page.request.get(`${server.base}/api/me`)).json()).user.prefs;
  assert.ok(Array.isArray(saved.rules) || Array.isArray(prefs.rules));
  await ctx.close();
});

test('options change the layout: panels per row', opts, async () => {
  const { page, ctx } = await open('host');
  await page.click('.menu-btn:has-text("View")');
  await page.click('.menu-item:has-text("Panels per row: 1")');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#strip')).getPropertyValue('--cols').trim() === '1');
  const widths = await page.$$eval('.panel', (els) => els.slice(0, 3).map((e) => Math.round(e.getBoundingClientRect().width)));
  assert.ok(widths.every((w) => w > 600), widths.join());
  await page.click('.menu-btn:has-text("View")');
  await page.click('.menu-item:has-text("Panels per row: fit window")');
  await ctx.close();
});

test('canvases actually contain artwork (not blank)', opts, async () => {
  const { page, ctx } = await open('host');
  await page.waitForSelector('.panel canvas');
  await page.waitForTimeout(800);
  const stats = await page.$$eval('.panel canvas', (cs) => cs.slice(0, 4).map((c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const seen = new Set();
    for (let i = 0; i < d.length; i += 4 * 97) seen.add((d[i] >> 5) * 64 + (d[i + 1] >> 5) * 8 + (d[i + 2] >> 5));
    return seen.size;
  }));
  assert.ok(stats.length > 0 && stats.every((n) => n > 6), `distinct colours per canvas: ${stats}`);
  await ctx.close();
});

test('offline: the page says so and recovers', opts, async () => {
  const { page, ctx } = await open('host');
  await ctx.setOffline(true);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForFunction(() => /Offline/.test(document.querySelector('#statusbar').textContent), null, { timeout: 8000 });
  await ctx.setOffline(false);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForFunction(() => /Connected/.test(document.querySelector('#statusbar').textContent), null, { timeout: 8000 });
  await ctx.close();
});

test('phone layout: no sideways scroll, burger menu, member overlay and back button', opts, async () => {
  const { page, ctx } = await open('host', { width: 390, height: 844, touch: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.ok(overflow <= 0, `page scrolls sideways by ${overflow}px`);
  assert.equal(await page.isVisible('.menubar .menu-btn'), false);
  await page.click('.menu-burger');
  assert.equal(await page.isVisible('.menubar .menu-btn:has-text("File")'), true);
  await page.click('.menu-burger');
  await page.click('.toolbar button[aria-label="Show or hide the member list"]');
  assert.equal(await page.isVisible('.members'), true);
  await page.click('#side-back');
  assert.equal(await page.isVisible('.members'), false);
  const bad = await page.$$eval('button', (bs) => bs.filter((b) => b.offsetParent && (b.getBoundingClientRect().height < 24)).length);
  assert.equal(bad, 0, 'tap targets are at least 24px tall');
  await ctx.close();
});

test('no unexpected console errors were produced by any of the above', opts, async () => {
  // 4xx responses are expected in the error-path tests, and ERR_INTERNET_DISCONNECTED
  // comes from the deliberate offline test.
  const meaningful = problems.filter((p) => !/status of 4\d\d|ERR_INTERNET_DISCONNECTED/.test(p));
  assert.deepEqual(meaningful, []);
});
