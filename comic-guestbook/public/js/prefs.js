// Preferences live on the server when you are signed in (so they follow you
// between devices) and in localStorage otherwise.

import { state, bus, DEFAULT_PREFS } from './state.js';
import { patch } from './api.js';
import { debounce } from './lib/dom.js';

const KEY = 'cg:prefs';

function readLocal() {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; }
}
function writeLocal(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage unavailable */ }
}

/** Merge stored preferences over the defaults, ignoring unknown or mistyped keys. */
export function mergePrefs(stored) {
  const out = structuredClone(DEFAULT_PREFS);
  for (const [k, def] of Object.entries(DEFAULT_PREFS)) {
    const v = stored?.[k];
    if (v === undefined || v === null) continue;
    if (Array.isArray(def) ? Array.isArray(v) : typeof v === typeof def && !Array.isArray(v)) out[k] = v;
  }
  return out;
}

export function loadPrefs() {
  state.prefs = mergePrefs(state.me ? state.me.prefs : readLocal());
  bus.emit('prefs', state.prefs);
}

let dirty = false;

async function saveNow(keepalive = false) {
  if (!state.me || !dirty) return;
  dirty = false;
  try {
    const { user } = await patch('/api/me', { prefs: state.prefs }, { keepalive });
    state.me.prefs = user.prefs;
  } catch (e) {
    dirty = true;
    if (!keepalive) bus.emit('toast', { text: `Could not save your settings: ${e.message}`, error: true });
  }
}

const flushRemote = debounce(() => saveNow(), 800);

// Do not lose a setting changed just before the visitor leaves or reloads.
addEventListener('pagehide', () => { flushRemote.cancel(); saveNow(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { flushRemote.cancel(); saveNow(true); } });

/** Change one or more preferences and persist them. */
export function setPrefs(changes) {
  Object.assign(state.prefs, changes);
  if (state.me) { dirty = true; flushRemote(); }
  else writeLocal(state.prefs);
  bus.emit('prefs', state.prefs);
}

/** Signing in: keep local choices if the account has none yet. */
export function adoptLocalPrefsIfNew() {
  if (!state.me) return;
  const server = state.me.prefs ?? {};
  if (Object.keys(server).length === 0) {
    state.prefs = mergePrefs(readLocal());
    dirty = true;
    flushRemote();
  } else {
    state.prefs = mergePrefs(server);
  }
  bus.emit('prefs', state.prefs);
}
