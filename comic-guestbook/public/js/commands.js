// Slash commands and macros typed into the say box, in the spirit of the
// commands in Microsoft Chat ("Commands need to start with a slash").
//
// parseInput() is pure: it turns a line of input into an action description
// that the say bar then executes. That keeps it easy to test.

/** Commands that become a spoken line of a given kind. */
const SPEECH = { say: 'say', me: 'action', action: 'action', think: 'think', thought: 'think' };

export const HELP = [
  ['/me <text>', 'Narrate an action: “Anna waves.” in a caption box'],
  ['/think <text>', 'Show a thought bubble'],
  ['/say <text>', 'Say something (the default)'],
  ['/to <name> <text>', 'Say something to a member, so the characters face each other'],
  ['/macro <name>', 'Run one of your macros (or just /<name>)'],
  ['/ignore <name>  /unignore <name>', 'Hide or show a member’s entries'],
  ['/fav <name>  /unfav <name>', 'Add or remove a member from your favorites'],
  ['/profile <name>', 'Show a member’s profile'],
  ['/nick <new name>', 'Change the name you sign with'],
  ['/ping', 'Measure the lag to the server'],
  ['/clear', 'Clear history (hides everything up to now, only for you)'],
  ['/help', 'Show this list'],
];

/**
 * @param {string} raw the input line
 * @param {{ macros: Record<string,string> }} ctx
 * @returns {{ type: 'speech', kind: string, text: string, to?: string }
 *   | { type: 'command', name: string, args: string }
 *   | { type: 'macro', name: string, lines: string[] }
 *   | { type: 'error', message: string }
 *   | { type: 'plain', text: string }}
 */
export function parseInput(raw, ctx = { macros: {} }) {
  const line = raw.replace(/\r\n?/g, '\n');
  if (!line.startsWith('/')) return { type: 'plain', text: line };
  if (line.startsWith('//')) return { type: 'plain', text: line.slice(1) }; // "//" escapes a leading slash
  const m = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(line.trim());
  if (!m) return { type: 'error', message: 'Type a command after the slash. /help lists them.' };
  const name = m[1].toLowerCase();
  const args = (m[2] ?? '').trim();

  if (name in SPEECH) {
    if (!args) return { type: 'error', message: `/${name} needs some text.` };
    return { type: 'speech', kind: SPEECH[name], text: args };
  }
  if (name === 'to') {
    const mm = /^("([^"]+)"|(\S+))\s+([\s\S]+)$/.exec(args);
    if (!mm) return { type: 'error', message: 'Use /to <name> <text>.' };
    return { type: 'speech', kind: 'say', text: mm[4], to: mm[2] ?? mm[3] };
  }
  if (name === 'macro') {
    if (!args) return { type: 'error', message: 'Which macro? Use /macro <name>.' };
    return macroResult(args.toLowerCase(), ctx);
  }
  if (['ignore', 'unignore', 'fav', 'unfav', 'profile', 'nick', 'ping', 'clear', 'help', 'whisper', 'away', 'join', 'leave', 'topic'].includes(name)) {
    return { type: 'command', name, args };
  }
  const macroKey = Object.keys(ctx.macros ?? {}).find((k) => k.toLowerCase() === name);
  if (macroKey) return macroResult(macroKey, ctx);
  return { type: 'error', message: `Unknown command “/${name}”. Type /help for the list.` };
}

function macroResult(key, ctx) {
  const name = Object.keys(ctx.macros ?? {}).find((k) => k.toLowerCase() === key.toLowerCase());
  if (!name) return { type: 'error', message: `There is no macro called “${key}”.` };
  const lines = String(ctx.macros[name]).split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { type: 'error', message: `The macro “${name}” is empty.` };
  return { type: 'macro', name, lines };
}

/**
 * Find users whose display name is mentioned as @Name. Longer names are tried
 * first and consume their span, so "@Bob Jr" does not also mention "Bob".
 */
export function findMentions(text, users, selfId) {
  const found = [];
  const taken = []; // [start, end) spans already matched
  const list = [...users.values()].filter((u) => u.id !== selfId).sort((a, b) => b.name.length - a.name.length);
  const lower = text.toLowerCase();
  for (const u of list) {
    const needle = `@${u.name.toLowerCase()}`;
    for (let from = 0; ;) {
      const at = lower.indexOf(needle, from);
      if (at < 0) break;
      const end = at + needle.length;
      const after = lower[end];
      const overlaps = taken.some(([s, e]) => at < e && end > s);
      if (!overlaps && (!after || !/[\p{L}\p{N}_]/u.test(after))) {
        found.push(u.id);
        taken.push([at, end]);
        break;
      }
      from = at + 1;
    }
    if (found.length >= 4) break;
  }
  return found;
}

/** Resolve a typed name (case-insensitive, unique prefix allowed) to a member. */
export function findUserByName(name, users) {
  const n = name.replace(/^@/, '').toLowerCase();
  const all = [...users.values()];
  return all.find((u) => u.name.toLowerCase() === n)
    ?? (all.filter((u) => u.name.toLowerCase().startsWith(n)).length === 1 ? all.find((u) => u.name.toLowerCase().startsWith(n)) : undefined);
}
