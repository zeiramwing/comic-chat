// User actions shared by menus, the say bar, context menus and commands.

import { state, bus, isOwner } from './state.js';
import { api, post, del, ApiError } from './api.js';
import { setPrefs } from './prefs.js';
import { postEntry, rebuild, removeEntryLocally, loadUsers, loadRoom } from './data.js';
import { parseMarkup } from './shared/richtext.js';
import { parseInput, findMentions, findUserByName, HELP } from './commands.js';
import { NEUTRAL } from './shared/emotion.js';
import { confirmDialog } from './ui/dialog.js';

const toast = (text, error = false) => bus.emit('toast', { text, error });
const history = [];

export const inputHistory = history;

/** Build the payload for one spoken line from the composer state. */
function payloadFor(kind, rawMarkup, extra = {}) {
  const { text, fmt } = parseMarkup(rawMarkup);
  const c = state.composer;
  const explicit = c.frozen || c.em.i > 0;
  const to = [...new Set([...(extra.to ?? c.to), ...findMentions(text, state.users, state.me?.id)])].slice(0, 4);
  return {
    text, fmt, kind,
    character: c.character || state.me?.character || undefined,
    em: explicit ? c.em : null,
    to,
    backdrop: c.backdrop || null,
  };
}

function explain(e) {
  if (e instanceof ApiError) {
    if (e.status === 429) return 'Slow down a little — you are posting too fast.';
    if (e.status === 401) { bus.emit('me-expired'); return 'Your session ended. Please sign in again.'; }
    return e.message;
  }
  return 'Something went wrong. Please try again.';
}

async function say(kind, raw, extra) {
  const payload = payloadFor(kind, raw, extra);
  if (!payload.text) throw new ApiError(400, 'invalid', 'Type something first.');
  await postEntry(payload);
  state.composer.to = [];
  state.composer.backdrop = null;
  bus.emit('composer');
  bus.emit('sent');
}

/**
 * Submit what the visitor typed. `kind` is the button pressed (say/think/action).
 * Returns true if the input was consumed (so the box should be cleared).
 */
export async function submitText(raw, kind = 'say') {
  if (!state.me) { bus.emit('open-auth', 'login'); return false; }
  const line = raw.trim();
  if (!line) return false;
  history.push(raw);
  if (history.length > 60) history.shift();
  try {
    const parsed = parseInput(line, { macros: state.prefs.macros });
    switch (parsed.type) {
      case 'plain': await say(kind, parsed.text); break;
      case 'speech': {
        let to;
        if (parsed.to) {
          const u = findUserByName(parsed.to, state.users);
          if (!u) throw new ApiError(400, 'invalid', `Nobody called “${parsed.to}” has signed yet.`);
          to = [u.id];
        }
        await say(parsed.kind, parsed.text, { to });
        break;
      }
      case 'macro':
        for (const l of parsed.lines) {
          const sub = parseInput(l, { macros: {} });
          if (sub.type === 'plain') await say('say', sub.text);
          else if (sub.type === 'speech') await say(sub.kind, sub.text);
          else if (sub.type === 'command') await runCommand(sub.name, sub.args);
          else if (sub.type === 'error') throw new ApiError(400, 'invalid', sub.message);
        }
        break;
      case 'command': await runCommand(parsed.name, parsed.args); break;
      case 'error': toast(parsed.message, true); return false;
    }
    return true;
  } catch (e) {
    toast(explain(e), true);
    return false;
  }
}

/** Send your character reacting with no words ("Send Expression"). */
export async function sendExpression() {
  if (!state.me) { bus.emit('open-auth', 'login'); return; }
  const c = state.composer;
  if (c.em.i === 0 && !c.frozen) { toast('Drag on the emotion wheel first, then send the expression.', true); return; }
  try {
    await postEntry({ kind: 'expression', text: '', character: c.character || undefined, em: c.em, to: c.to });
    state.composer.to = [];
    bus.emit('composer');
    bus.emit('sent');
  } catch (e) { toast(explain(e), true); }
}

async function runCommand(name, args) {
  const need = (cond, msg) => { if (!cond) throw new ApiError(400, 'invalid', msg); };
  const member = () => {
    const u = findUserByName(args, state.users);
    need(u, `Nobody called “${args}” has signed yet.`);
    return u;
  };
  switch (name) {
    case 'ignore': ignoreUser(member().id, true); break;
    case 'unignore': ignoreUser(member().id, false); break;
    case 'fav': setFavorite(member().id, true); break;
    case 'unfav': setFavorite(member().id, false); break;
    case 'profile': bus.emit('show-profile', member().id); break;
    case 'nick': {
      need(args, 'Use /nick <new name>.');
      const { user } = await api('PATCH', '/api/me', { display: args });
      state.me = { ...state.me, ...user };
      bus.emit('me', state.me);
      loadUsers().catch(() => {});
      toast(`You now sign as ${user.display}.`);
      break;
    }
    case 'ping': await pingServer(); break;
    case 'clear': clearHistory(); break;
    case 'help': bus.emit('show-help', HELP); break;
    case 'topic': {
      need(isOwner(), 'Only the owner can change the topic.');
      await api('PATCH', '/api/room', { topic: args });
      await loadRoom();
      toast('Topic changed.');
      break;
    }
    case 'whisper': case 'away': case 'join': case 'leave':
      toast('That needs live rooms, which arrive in phase 2.', true);
      break;
    default: toast(`/${name} is not available yet.`, true);
  }
}

export function ignoreUser(id, on) {
  const list = new Set(state.prefs.ignore);
  if (on) list.add(id); else list.delete(id);
  setPrefs({ ignore: [...list] });
  rebuild();
  const name = state.users.get(id)?.name ?? 'that member';
  toast(on ? `Ignoring ${name}. Their entries are hidden for you.` : `No longer ignoring ${name}.`);
}

export function setFavorite(id, on) {
  const list = new Set(state.prefs.favorites);
  if (on) list.add(id); else list.delete(id);
  setPrefs({ favorites: [...list] });
  const name = state.users.get(id)?.name ?? 'that member';
  toast(on ? `${name} added to your favorites.` : `${name} removed from your favorites.`);
}

export function clearHistory() {
  setPrefs({ clearedBefore: state.lastId });
  rebuild();
  toast('History cleared — for you only. “Show all history” in the View menu brings it back.');
}

export function showAllHistory() {
  setPrefs({ clearedBefore: 0 });
  rebuild();
}

export async function deleteEntry(entryId) {
  const ok = await confirmDialog('Remove this entry from the guestbook?', { title: 'Remove entry', yes: 'Remove', danger: true });
  if (!ok) return;
  try {
    await del(`/api/entries/${entryId}`);
    state.rev += 1; // the server bumped it; stay in sync so we do not reload
    removeEntryLocally(entryId);
  } catch (e) { toast(explain(e), true); }
}

export async function banMember(id) {
  const name = state.users.get(id)?.name ?? 'this member';
  const ok = await confirmDialog(`Ban ${name}? They will be signed out and can no longer post.`, { title: 'Ban member', yes: 'Ban', danger: true });
  if (!ok) return;
  try {
    await post('/api/admin/ban', { userId: id, reason: 'banned by the owner' });
    await loadUsers();
    toast(`${name} is banned.`);
  } catch (e) { toast(explain(e), true); }
}

export async function unbanMember(id) {
  try {
    await post('/api/admin/unban', { userId: id });
    await loadUsers();
    toast('Ban lifted.');
  } catch (e) { toast(explain(e), true); }
}

export async function pingServer() {
  const t0 = performance.now();
  await api('GET', '/api/ping');
  const ms = Math.round(performance.now() - t0);
  toast(`Lag time: ${ms} ms`);
  return ms;
}

export async function signOut() {
  try { await post('/api/logout'); } catch { /* already gone */ }
  state.me = null;
  state.composer = { ...state.composer, to: [], backdrop: null, em: { ...NEUTRAL }, frozen: false };
  bus.emit('me', null);
}

export { explain };
