// Automation rules ("Macros → Automation…"), after Microsoft Chat 2.5's rule
// sets (rules.h): an EVENT, who it concerns, optional text it must contain, and a
// list of ACTIONS. The vocabulary below is the original's. Each item says
// whether it works in phase 1 (the guestbook) or needs live chat (phase 2).
//
// The engine is pure. evaluate() returns a list of effect objects; the UI layer
// carries them out. Effects fall in two groups:
//   view effects   (hide, replace, highlight) describe how an entry is shown
//                  and must be repeatable, so they ignore the delay exception;
//   side effects   (everything else) run once per event and honour it.

export const EVENTS = {
  onMessage: { label: 'Someone signs the guestbook (a message)', phase: 1 },
  onJoin: { label: 'A new member joins', phase: 1 },
  onNewHost: { label: 'The host changes', phase: 2 },
  onConnect: { label: 'I connect', phase: 2 },
  onDisconnect: { label: 'I disconnect', phase: 2 },
  onInvitation: { label: 'I am invited to a room', phase: 2 },
  onKick: { label: 'Someone is kicked', phase: 2 },
  onLeave: { label: 'Someone leaves a room', phase: 2 },
  onNewRoom: { label: 'A new room is created', phase: 2 },
  onWhisper: { label: 'Someone whispers to me', phase: 2 },
  onWhisperInRoom: { label: 'Someone whispers in the room', phase: 2 },
};

// param kinds: text | number | sound | macro | ruleset | line
export const ACTIONS = {
  beep: { label: 'Beep', params: [{ key: 'count', kind: 'number', label: 'Times', def: 1, min: 1, max: 5 }], phase: 1 },
  playSound: { label: 'Play a sound', params: [{ key: 'sound', kind: 'sound', label: 'Sound', def: 'attention' }], phase: 1 },
  highlightMessage: { label: 'Highlight the message', params: [], phase: 1, view: true },
  doNotDisplay: { label: 'Do not display the message', params: [], phase: 1, view: true },
  replaceMessage: { label: 'Replace the message with…', params: [{ key: 'text', kind: 'text', label: 'New text' }], phase: 1, view: true },
  notifyDialog: { label: 'Show a notice', params: [{ key: 'text', kind: 'text', label: 'Notice', def: '{name}: {message}' }], phase: 1 },
  ignore: { label: 'Ignore the member', params: [], phase: 1 },
  getProfile: { label: 'Get the member’s profile', params: [], phase: 1 },
  getLagTime: { label: 'Measure lag time', params: [], phase: 1 },
  executeMacro: { label: 'Run a macro', params: [{ key: 'macro', kind: 'macro', label: 'Macro' }], phase: 1 },
  sendMessage: { label: 'Say…', params: [{ key: 'text', kind: 'text', label: 'Text', def: 'Hello {name}!' }], phase: 1, posts: true },
  sendThought: { label: 'Think…', params: [{ key: 'text', kind: 'text', label: 'Text' }], phase: 1, posts: true },
  sendAction: { label: 'Do an action…', params: [{ key: 'text', kind: 'text', label: 'Text', def: 'waves at {name}' }], phase: 1, posts: true },
  sendFileLine: {
    label: 'Say a line from a macro',
    params: [{ key: 'macro', kind: 'macro', label: 'Macro' }, { key: 'line', kind: 'line', label: 'Line (number or RND)', def: 'RND' }],
    phase: 1, posts: true,
  },
  activateRuleSet: { label: 'Switch to rule set', params: [{ key: 'set', kind: 'ruleset', label: 'Rule set' }], phase: 1 },
  ban: { label: 'Ban the member (host only)', params: [], phase: 1, hostOnly: true },
  // live chat
  joinRoom: { label: 'Join a room', params: [], phase: 2 },
  leaveRoom: { label: 'Leave the room', params: [], phase: 2 },
  kick: { label: 'Kick the member', params: [], phase: 2 },
  makeHost: { label: 'Make the member a host', params: [], phase: 2 },
  invite: { label: 'Invite the member', params: [], phase: 2 },
  connect: { label: 'Connect', params: [], phase: 2 },
  disconnect: { label: 'Disconnect', params: [], phase: 2 },
  sendWhisper: { label: 'Whisper…', params: [], phase: 2 },
  sendWhisperInRoom: { label: 'Whisper in the room…', params: [], phase: 2 },
  whisperFileLine: { label: 'Whisper a line from a macro', params: [], phase: 2 },
  sendSound: { label: 'Send a sound', params: [], phase: 2 },
  getIdentity: { label: 'Get the member’s identity', params: [], phase: 2 },
  getLocalTime: { label: 'Get the member’s local time', params: [], phase: 2 },
  getVersion: { label: 'Get the member’s version', params: [], phase: 2 },
};

export const SOUND_NAMES = ['entry', 'attention', 'beep', 'sent', 'error'];
export const MAX_RULESETS = 10;
export const MAX_RULES = 30;
export const MAX_ACTIONS = 4;

export function newRuleSet(name = 'My rules') {
  return { name, active: false, rules: [] };
}

export function newRule() {
  return {
    id: Math.random().toString(36).slice(2, 10),
    name: 'New rule',
    enabled: true,
    event: 'onMessage',
    who: 'anyoneButMe', // anyone | me | anyoneButMe | user:<id>
    contains: '',
    minDelay: 0, // seconds between firings (the original's "minimum delay" exception)
    actions: [{ type: 'beep', count: 1 }],
  };
}

/** Clean a rule loaded from storage so a corrupt pref cannot break the engine. */
export function sanitizeRuleSets(sets) {
  if (!Array.isArray(sets)) return [];
  const out = [];
  for (const s of sets.slice(0, MAX_RULESETS)) {
    if (!s || typeof s !== 'object') continue;
    const rules = [];
    for (const r of (Array.isArray(s.rules) ? s.rules : []).slice(0, MAX_RULES)) {
      if (!r || typeof r !== 'object' || !(r.event in EVENTS)) continue;
      const actions = (Array.isArray(r.actions) ? r.actions : [])
        .filter((a) => a && typeof a === 'object' && a.type in ACTIONS)
        .slice(0, MAX_ACTIONS);
      rules.push({
        id: String(r.id ?? Math.random().toString(36).slice(2, 10)).slice(0, 16),
        name: String(r.name ?? 'Rule').slice(0, 40),
        enabled: r.enabled !== false,
        event: r.event,
        who: typeof r.who === 'string' ? r.who.slice(0, 20) : 'anyone',
        contains: String(r.contains ?? '').slice(0, 100),
        minDelay: Math.max(0, Math.min(86400, Number(r.minDelay) || 0)),
        actions,
      });
    }
    out.push({ name: String(s.name ?? 'Rules').slice(0, 40), active: !!s.active, rules });
  }
  // at most one active set
  let seen = false;
  for (const s of out) { if (s.active && seen) s.active = false; seen ||= s.active; }
  return out;
}

export const activeSet = (sets) => sets.find((s) => s.active) ?? null;

/** Does this rule apply to this event? */
export function matches(rule, event, ctx) {
  if (!rule.enabled || rule.event !== event.type) return false;
  const actor = event.userId;
  const me = ctx.meId ?? null;
  switch (rule.who) {
    case 'anyone': break;
    case 'me': if (actor !== me) return false; break;
    case 'anyoneButMe': if (actor === me) return false; break;
    default:
      if (rule.who.startsWith('user:')) { if (String(actor) !== rule.who.slice(5)) return false; }
      else return false;
  }
  if (rule.contains) {
    const text = (event.text ?? '').toLowerCase();
    if (!text.includes(rule.contains.toLowerCase())) return false;
  }
  return true;
}

/** Fill {name}, {me}, {message}, {room} in action text. */
export function expand(text, event, ctx) {
  return String(text ?? '')
    .replaceAll('{name}', event.author ?? '')
    .replaceAll('{me}', ctx.meName ?? '')
    .replaceAll('{message}', event.text ?? '')
    .replaceAll('{room}', ctx.roomName ?? '');
}

/** Pick a line from a macro: by 1-based number, a range "2-4", or RND. */
export function pickLine(macroText, spec, rand = Math.random) {
  const lines = String(macroText ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const s = String(spec ?? 'RND').trim().toUpperCase();
  if (s === 'RND' || s === '') return lines[Math.floor(rand() * lines.length)];
  const range = /^(\d+)\s*-\s*(\d+)$/.exec(s);
  if (range) {
    const a = Math.max(1, Number(range[1]));
    const b = Math.min(lines.length, Number(range[2]));
    if (a > b) return null;
    return lines[a - 1 + Math.floor(rand() * (b - a + 1))];
  }
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 && n <= lines.length ? lines[n - 1] : null;
}

/**
 * Pure view effects for an entry: { hide, highlight, text }. Used while laying
 * out the strip, so it must not depend on time or randomness.
 */
export function viewEffects(entry, sets, ctx) {
  const set = activeSet(sets);
  const out = { hide: false, highlight: false, text: null };
  if (!set) return out;
  const event = { type: 'onMessage', userId: entry.userId, author: entry.author, text: entry.text };
  for (const rule of set.rules) {
    if (!matches(rule, event, ctx)) continue;
    for (const a of rule.actions) {
      if (a.type === 'doNotDisplay') out.hide = true;
      else if (a.type === 'highlightMessage') out.highlight = true;
      else if (a.type === 'replaceMessage') out.text = expand(a.text, event, ctx);
    }
  }
  return out;
}

/**
 * Side effects for a new event. `state.lastFired` (Map rule id -> ms) enforces
 * each rule's minimum delay. Returns [{ ruleId, effect }].
 */
export function evaluate(event, sets, ctx, fired = new Map(), now = Date.now(), rand = Math.random) {
  const set = activeSet(sets);
  if (!set) return [];
  const out = [];
  for (const rule of set.rules) {
    if (!matches(rule, event, ctx)) continue;
    const last = fired.get(rule.id);
    if (rule.minDelay > 0 && last !== undefined && now - last < rule.minDelay * 1000) continue;
    let did = false;
    for (const a of rule.actions) {
      const def = ACTIONS[a.type];
      if (!def || def.phase !== 1 || def.view) continue;
      if (def.hostOnly && !ctx.isHost) continue;
      const effect = { type: a.type };
      switch (a.type) {
        case 'beep': effect.count = Math.max(1, Math.min(5, Number(a.count) || 1)); break;
        case 'playSound': effect.sound = SOUND_NAMES.includes(a.sound) ? a.sound : 'attention'; break;
        case 'notifyDialog': effect.text = expand(a.text, event, ctx); break;
        case 'sendMessage': case 'sendThought': case 'sendAction': effect.text = expand(a.text, event, ctx); break;
        case 'sendFileLine': {
          const line = pickLine(ctx.macros?.[a.macro], a.line, rand);
          if (line === null) continue;
          effect.text = expand(line, event, ctx);
          break;
        }
        case 'executeMacro': effect.macro = a.macro; break;
        case 'activateRuleSet': effect.set = a.set; break;
        default: break; // ignore, getProfile, getLagTime, ban: no parameters
      }
      effect.userId = event.userId;
      out.push({ ruleId: rule.id, effect });
      did = true;
    }
    if (did) fired.set(rule.id, now);
  }
  return out;
}
