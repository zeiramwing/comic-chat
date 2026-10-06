// Comic Guestbook — application entry point.

import { $, h, sleep } from './lib/dom.js';
import { state, bus, isOwner, isFavorite } from './state.js';
import { get } from './api.js';
import { loadPrefs, setPrefs } from './prefs.js';
import {
  loadRoom, loadUsers, loadEntries, panels, poll, rebuild, setViewHook,
} from './data.js';
import { Art } from './render/art.js';
import { loadFonts } from './render/fonts.js';
import { StripView } from './ui/strip.js';
import { TextView } from './ui/textview.js';
import { Members } from './ui/members.js';
import { BodyCam } from './ui/bodycam.js';
import { SayBar } from './ui/saybar.js';
import { MenuBar, Toolbar } from './ui/menus.js';
import { StatusBar } from './ui/status.js';
import { openAuth, openMyProfile } from './ui/auth.js';
import { openCharacterPicker, openBackdropPicker } from './ui/pickers.js';
import { popupMenu } from './ui/dialog.js';
import {
  openProfile, openUserList, openFavorites, openIgnored, openRoomProps, openRoomList,
  openMotd, openOptions, openHelp, openAbout,
} from './ui/dialogs.js';
import { openMacros } from './ui/macros.js';
import { openRules, runRules, viewByRules, watchJoins } from './ui/rules.js';
import { openExport } from './ui/export.js';
import {
  ignoreUser, setFavorite, deleteEntry, banMember, sendExpression,
} from './actions.js';
import { play } from './sounds.js';
import './ui/toast.js';

const art = new Art('/art/');
const app = { art };
globalThis.__comicGuestbook = app; // handy for debugging and tests

const RENDER_PREFS = ['halo', 'showNames', 'autoExpress', 'bigText', 'panelsPerRow'];
let lastRender = '';
let unread = 0;
let baseTitle = document.title;

function setLoading(text) {
  const el = $('#loading-text');
  if (el) el.textContent = text;
}

async function boot() {
  setLoading('Loading characters…');
  const [, , meRes] = await Promise.all([
    loadFonts(),
    art.init(),
    get('/api/me').catch(() => null),
  ]);
  state.me = meRes?.user ?? null;
  loadPrefs();
  if (state.me?.character) state.composer.character = state.me.character;

  setLoading('Reading the guestbook…');
  await loadRoom();
  await loadUsers().catch(() => {});
  document.title = state.site.title;
  baseTitle = state.site.title;
  $('#site-title').textContent = state.site.title;
  setViewHook(viewByRules);

  setLoading('Drawing the first panel…');
  await loadEntries((n) => setLoading(`Reading the guestbook… ${n} entries`));

  buildUi();
  $('#app').hidden = false;
  $('#loading').remove();
  applyPrefs(true);
  app.strip.update(panels(), 0, true);
  app.textView.render();
  app.strip.scrollToBottom();
  revealFromHash();
  maybeShowMotd();
  startPolling();
}

function buildUi() {
  app.strip = new StripView($('#strip'), art, { onPick: stripPick });
  app.textView = new TextView($('#textlog'));
  app.members = new Members($('#members'), art);
  app.bodyCam = new BodyCam($('#bodycam'), art);
  app.sayBar = new SayBar($('#saybar'), art);
  app.menuBar = new MenuBar($('#menubar'), app);
  app.toolbar = new Toolbar($('#toolbar'));
  app.status = new StatusBar($('#statusbar'));
  updateWhoami();

  $('#side-back').addEventListener('click', () => document.body.classList.remove('show-side'));
  const jump = $('#jump-new');
  jump.addEventListener('click', () => { app.strip.scrollToBottom(); jump.hidden = true; });
  $('#strip').addEventListener('scroll', () => { if (app.strip.isNearBottom(80)) jump.hidden = true; }, { passive: true });

  wireBus();
  wireKeys();
  watchJoins();
}

// ---------------------------------------------------------------------------
// Preferences -> layout

function applyPrefs(first = false) {
  const p = state.prefs;
  const text = p.view === 'text';
  $('#strip').hidden = text;
  $('#textlog').hidden = !text;
  $('#main').classList.toggle('no-side', !p.showMembers);
  if (text && !first) app.textView.render();
  const sig = RENDER_PREFS.map((k) => p[k]).join('|');
  if (sig !== lastRender) {
    lastRender = sig;
    app.strip?.layout();
    app.strip?.redrawVisible();
  }
  if (!text && !first) requestAnimationFrame(() => app.strip.layout());
}

function updateWhoami() {
  $('#whoami').textContent = state.me ? `Signed in as ${state.me.display}${state.me.role === 'owner' ? ' (host)' : ''}` : 'Not signed in';
}

// ---------------------------------------------------------------------------
// Event wiring

function wireBus() {
  bus.on('prefs', () => applyPrefs());

  bus.on('panels', ({ from, reset }) => {
    const near = app.strip.isNearBottom();
    app.strip.update(panels(), from, reset);
    if (!reset && near) app.strip.scrollToBottom();
    if (reset && !near) { /* strip keeps its place */ }
    if (!$('#textlog').hidden && reset) app.textView.render();
  });

  bus.on('entries', (added) => {
    app.textView.append(added);
    onNewEntries(added);
  });

  bus.on('sent', () => {
    app.strip.scrollToBottom();
    app.bodyCam.afterSend();
    play('sent');
  });

  bus.on('me', async () => {
    updateWhoami();
    app.menuBar.render();
    if (state.me) {
      state.composer.character ||= state.me.character;
    } else {
      loadPrefs();
    }
    rebuild();
    applyPrefs();
    await loadUsers().catch(() => {});
  });

  bus.on('me-expired', () => { state.me = null; bus.emit('me', null); });
  bus.on('reload-all', async () => { await loadRoom(); await loadEntries(); await loadUsers().catch(() => {}); });
  bus.on('reloaded', () => { app.strip.update(panels(), 0, true); app.textView.render(); });
  bus.on('online', () => {});

  bus.on('room', (r) => {
    $('#site-title').textContent = r.siteName;
    baseTitle = r.siteName;
  });

  // dialogs and pickers
  bus.on('open-auth', (mode) => openAuth(mode));
  bus.on('open-my-profile', () => openMyProfile());
  bus.on('show-profile', (id) => openProfile(id, art));
  bus.on('pick-character', () => (state.me ? openCharacterPicker(art) : openAuth('register')));
  bus.on('pick-backdrop', () => (state.me ? openBackdropPicker(art) : openAuth('login')));
  bus.on('open-options', () => openOptions());
  bus.on('open-help', () => openHelp(false));
  bus.on('show-help', () => openHelp(true));
  bus.on('open-about', () => openAbout(art));
  bus.on('open-macros', () => openMacros());
  bus.on('open-rules', () => openRules());
  bus.on('open-userlist', () => openUserList(art));
  bus.on('open-favorites', () => openFavorites(art));
  bus.on('open-notifications', () => openFavorites(art));
  bus.on('open-ignored', () => openIgnored(art));
  bus.on('open-room-props', () => openRoomProps(art));
  bus.on('open-roomlist', () => openRoomList());
  bus.on('show-motd', () => openMotd());
  bus.on('open-export', (kind) => openExport(kind, art));
  bus.on('address', (id) => { if (!state.composer.to.includes(id)) app.sayBar.toggleTo(id); app.sayBar.focus(); });
  bus.on('send-expression', () => sendExpression());
}

function wireKeys() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F1') { e.preventDefault(); openHelp(false); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') { e.preventDefault(); openExport('print', art); }
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { unread = 0; document.title = baseTitle; poll(); }
  });
}

// ---------------------------------------------------------------------------
// Clicking the strip

function stripPick(info, ev) {
  const { type, line, userId } = info;
  const u = state.users.get(userId);
  const name = u?.name ?? line?.author ?? 'this member';
  const mine = state.me?.id === userId;
  const items = [
    { label: `Get ${name}’s profile…`, onclick: () => openProfile(userId, art) },
    { label: `Talk to ${name}`, disabled: mine || !state.me, onclick: () => bus.emit('address', userId) },
  ];
  if (type === 'balloon' && line) {
    items.push('-',
      { label: 'Copy text', onclick: () => copy(line.text) },
      { label: 'Copy link to this entry', onclick: () => copy(`${location.origin}${location.pathname}#e${line.entryId}`) });
  }
  items.push('-',
    isFavorite(userId)
      ? { label: 'Remove from favorites', onclick: () => setFavorite(userId, false) }
      : { label: 'Add to favorites', disabled: mine, onclick: () => setFavorite(userId, true) },
    { label: 'Ignore', disabled: mine, onclick: () => ignoreUser(userId, true) });
  if (type === 'balloon' && line && (mine || isOwner())) {
    items.push('-', { label: 'Remove this entry…', danger: true, onclick: () => deleteEntry(line.entryId) });
  }
  if (isOwner() && !mine && u && !u.owner) items.push({ label: `Ban ${name}…`, danger: true, onclick: () => banMember(userId) });
  popupMenu(ev.clientX, ev.clientY, items);
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); bus.emit('toast', { text: 'Copied.' }); } catch { bus.emit('toast', { text: 'Could not copy.', error: true }); }
}

function revealFromHash() {
  const m = /^#e(\d+)$/.exec(location.hash);
  if (m) setTimeout(() => app.strip.reveal(Number(m[1])), 300);
}

function maybeShowMotd() {
  const motd = state.room?.motd;
  const box = $('#motd');
  if (!motd || state.prefs.seenMotd === motd) { box.hidden = true; return; }
  box.hidden = false;
  box.replaceChildren(
    h('span', motd),
    h('button', { type: 'button', 'aria-label': 'Dismiss message of the day', onclick: () => { box.hidden = true; setPrefs({ seenMotd: motd }); } }, '✕'));
}

// ---------------------------------------------------------------------------
// New entries from other people

function onNewEntries(added) {
  const me = state.me;
  const mine = (e) => me && e.userId === me.id;
  const others = added.filter((e) => !mine(e));
  if (!others.length) return;

  const myName = me?.display?.toLowerCase();
  let attention = null;
  for (const e of others) {
    if (state.prefs.ignore.includes(e.userId)) continue;
    const mention = myName && e.text.toLowerCase().includes(`@${myName}`);
    if ((mention && state.prefs.notifyMentions) || (isFavorite(e.userId) && state.prefs.notifyFavorites)) attention = e;
  }
  runRules(others);

  if (attention) {
    bus.emit('toast', { text: `${attention.author}: ${attention.text.slice(0, 120) || '…'}` });
    play('attention');
  } else if (!document.hidden) {
    play('entry');
  }
  if (document.hidden) {
    unread += others.length;
    document.title = `(${unread}) ${baseTitle}`;
  } else if (!app.strip.isNearBottom(120) && $('#textlog').hidden) {
    $('#jump-new').hidden = false;
  }
}

// ---------------------------------------------------------------------------
// Polling

async function startPolling() {
  let n = 0;
  for (;;) {
    await sleep((document.hidden ? 60000 : 12000) + Math.random() * 3000);
    await poll();
    if (++n % 5 === 0) loadUsers().catch(() => {});
  }
}

boot().catch((e) => {
  console.error(e);
  const box = $('#loading');
  if (box) {
    box.replaceChildren(h('div.loading-box', h('div', h('p', 'Sorry — the guestbook could not start.'), h('p.hint', String(e.message ?? e)), h('button', { type: 'button', onclick: () => location.reload() }, 'Try again'))));
  }
});
