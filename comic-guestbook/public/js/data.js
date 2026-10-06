// Loading, caching and incrementally extending the strip.

import { state, bus } from './state.js';
import { get, post } from './api.js';
import { loadCache, saveCache } from './cache.js';
import { StripBuilder } from './shared/layout.js';

let builder = null;
let viewHook = null; // automation rules may hide, replace or highlight entries

/** fn(entry) -> null to hide, or the entry (possibly a modified copy) to show. */
export const setViewHook = (fn) => { viewHook = fn; };

/** What this viewer should see for a raw entry: null when hidden. */
export function view(e) {
  if (e.id <= state.prefs.clearedBefore) return null;
  if (state.prefs.ignore.includes(e.userId)) return null;
  return viewHook ? viewHook(e) : e;
}

export const isVisible = (e) => view(e) !== null;

export const panels = () => builder?.panels ?? [];

function newBuilder() {
  return new StripBuilder({ defaultBackdrop: state.room?.defaultBackdrop ?? 'pastoral' });
}

/** Lay out everything again (after ignoring someone, clearing history, etc). */
export function rebuild() {
  builder = newBuilder();
  for (const e of state.entries) {
    const v = view(e);
    if (v) builder.push(v);
  }
  bus.emit('panels', { from: 0, reset: true });
}

export async function loadRoom() {
  state.room = await get('/api/room');
  state.site.title = state.room.siteName;
  bus.emit('room', state.room);
}

export async function loadUsers() {
  const { users } = await get('/api/users');
  state.users = new Map(users.map((u) => [u.id, u]));
  bus.emit('users', state.users);
}

async function fetchAfter(after, onProgress) {
  const out = [];
  let rev = state.rev;
  for (let guard = 0; guard < 500; guard++) {
    const page = await get(`/api/entries?after=${after}&limit=1000`);
    rev = page.rev;
    out.push(...page.entries);
    if (page.entries.length) after = page.entries.at(-1).id;
    onProgress?.(out.length);
    if (!page.more) break;
  }
  return { entries: out, rev };
}

/** Initial load: use the cache when it is still valid, then fetch the rest. */
export async function loadEntries(onProgress) {
  const cached = await loadCache(state.room.id);
  let entries = [];
  let after = 0;
  if (cached && cached.rev === state.room.rev && Array.isArray(cached.entries)) {
    entries = cached.entries;
    after = cached.lastId ?? 0;
  }
  const fresh = await fetchAfter(after, (n) => onProgress?.(entries.length + n));
  entries = entries.concat(fresh.entries);
  state.entries = entries;
  state.rev = fresh.rev;
  state.lastId = entries.at(-1)?.id ?? 0;
  saveCache(state.room.id, { rev: state.rev, lastId: state.lastId, entries });
  rebuild();
}

/** Add entries to the end; returns the ones actually new. */
export function appendEntries(list) {
  const added = [];
  for (const e of list) {
    if (e.id <= state.lastId) continue;
    state.entries.push(e);
    state.lastId = e.id;
    added.push(e);
  }
  if (!added.length) return added;
  const before = builder.panels.length;
  const startIdx = Math.max(0, before - 1); // the last panel may gain a balloon
  for (const e of added) {
    const v = view(e);
    if (v) builder.push(v);
  }
  bus.emit('panels', { from: startIdx, reset: false });
  bus.emit('entries', added);
  persistSoon();
  return added;
}

let persistTimer = 0;
function persistSoon() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    saveCache(state.room.id, { rev: state.rev, lastId: state.lastId, entries: state.entries });
  }, 3000);
}

/** Poll for new entries. If history was edited (rev changed) start over. */
export async function poll() {
  try {
    const page = await get(`/api/entries?after=${state.lastId}&limit=1000`);
    state.online = true;
    if (page.rev !== state.rev) {
      state.rev = page.rev;
      await loadRoom();
      await loadEntries();
      bus.emit('reloaded');
      return [];
    }
    let entries = page.entries;
    let more = page.more;
    while (more) {
      const next = await get(`/api/entries?after=${entries.at(-1).id}&limit=1000`);
      entries = entries.concat(next.entries);
      more = next.more;
    }
    return appendEntries(entries);
  } catch (e) {
    if (e.code === 'offline') state.online = false;
    bus.emit('online', state.online);
    return [];
  } finally {
    bus.emit('online', state.online);
  }
}

export async function postEntry(payload) {
  const { entry } = await post('/api/entries', payload);
  appendEntries([entry]);
  if (!state.users.has(entry.userId)) loadUsers().catch(() => {});
  return entry;
}

export function removeEntryLocally(id) {
  state.entries = state.entries.filter((e) => e.id !== id);
  rebuild();
  saveCache(state.room.id, { rev: state.rev, lastId: state.lastId, entries: state.entries });
}
