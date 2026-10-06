// Rich text for messages.
//
// Authors type BBCode in a plain textarea ([b] [i] [u] [fixed] [sym] [color=#hex]).
// What is stored is the plain text plus a compact "fmt" array of segments that
// covers the text from start to end: [[length, flags, color|null], ...].
// A message with no formatting stores fmt = null.
//
// Flags mirror the Format menu of Microsoft Chat 2.5: bold, italic, underline,
// fixed-pitch and symbol font, plus a colour.

export const F = { BOLD: 1, ITALIC: 2, UNDERLINE: 4, FIXED: 8, SYMBOL: 16 };

const TAGS = { b: F.BOLD, i: F.ITALIC, u: F.UNDERLINE, fixed: F.FIXED, sym: F.SYMBOL };
const FLAG_TAG = [[F.BOLD, 'b'], [F.ITALIC, 'i'], [F.UNDERLINE, 'u'], [F.FIXED, 'fixed'], [F.SYMBOL, 'sym']];
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export const MAX_FMT_SEGMENTS = 64;

/**
 * Parse BBCode. Tags that have no matching partner, and unknown tags, stay as
 * literal text; "\\[" is an escaped literal bracket. Returns { text, fmt }.
 */
export function parseMarkup(src) {
  // 1. Tokenise.
  const tokens = []; // {t:'text',v} | {t:'open'|'close', name, color?, raw}
  let buf = '';
  const pushText = () => { if (buf) { tokens.push({ t: 'text', v: buf }); buf = ''; } };
  for (let i = 0; i < src.length;) {
    if (src[i] === '\\' && src[i + 1] === '[') { buf += '['; i += 2; continue; }
    if (src[i] === '[') {
      const end = src.indexOf(']', i);
      if (end > i) {
        const raw = src.slice(i, end + 1);
        const body = src.slice(i + 1, end).toLowerCase();
        let tok = null;
        if (TAGS[body] !== undefined) tok = { t: 'open', name: body };
        else if (body.startsWith('/') && (TAGS[body.slice(1)] !== undefined || body === '/color')) tok = { t: 'close', name: body.slice(1) };
        else {
          const cm = /^color=(#[0-9a-f]{6})$/.exec(body);
          if (cm) tok = { t: 'open', name: 'color', color: cm[1] };
        }
        if (tok) { pushText(); tokens.push({ ...tok, raw }); i = end + 1; continue; }
      }
    }
    buf += src[i++];
  }
  pushText();

  // 2. Pair opens with closes (nearest unmatched open of the same name).
  const stack = [];
  const paired = new Set();
  tokens.forEach((tok, idx) => {
    if (tok.t === 'open') stack.push(idx);
    else if (tok.t === 'close') {
      for (let k = stack.length - 1; k >= 0; k--) {
        if (tokens[stack[k]].name === tok.name) {
          paired.add(stack[k]);
          paired.add(idx);
          tok.partner = stack[k];
          stack.splice(k, 1);
          break;
        }
      }
    }
  });

  // 3. Walk, tracking active formatting.
  const segs = [];
  const counts = { b: 0, i: 0, u: 0, fixed: 0, sym: 0 };
  const colorStack = []; // token indexes of open colour tags
  const add = (text) => {
    if (!text) return;
    let flags = 0;
    for (const k of Object.keys(counts)) if (counts[k] > 0) flags |= TAGS[k];
    const color = colorStack.length ? tokens[colorStack[colorStack.length - 1]].color : null;
    const last = segs[segs.length - 1];
    if (last && last.flags === flags && last.color === color) last.text += text;
    else segs.push({ text, flags, color });
  };
  tokens.forEach((tok, idx) => {
    if (tok.t === 'text') add(tok.v);
    else if (!paired.has(idx)) add(tok.raw);
    else if (tok.t === 'open') {
      if (tok.name === 'color') colorStack.push(idx);
      else counts[tok.name]++;
    } else if (tok.name === 'color') {
      const at = colorStack.lastIndexOf(tok.partner);
      if (at >= 0) colorStack.splice(at, 1);
    } else counts[tok.name]--;
  });

  const text = segs.map((s) => s.text).join('');
  if (segs.every((s) => s.flags === 0 && !s.color)) return { text, fmt: null };
  const fmt = segs.map((s) => [s.text.length, s.flags, s.color]);
  return { text, fmt: fmt.length > MAX_FMT_SEGMENTS ? null : fmt };
}

/** Segments for rendering: [{ text, flags, color }]. */
export function segments(text, fmt) {
  if (!fmt || !fmt.length) return text ? [{ text, flags: 0, color: null }] : [];
  const out = [];
  let pos = 0;
  for (const [len, flags, color] of fmt) {
    if (pos >= text.length) break;
    out.push({ text: text.slice(pos, pos + len), flags: flags | 0, color: color || null });
    pos += len;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), flags: 0, color: null });
  return out;
}

/** Back to editable BBCode. */
export function toMarkup(text, fmt) {
  const esc = (s) => s.replace(/\[/g, '\\[');
  let out = '';
  for (const seg of segments(text, fmt)) {
    let open = '';
    let close = '';
    if (seg.color) { open += `[color=${seg.color}]`; close = '[/color]' + close; }
    for (const [flag, tag] of FLAG_TAG) {
      if (seg.flags & flag) { open += `[${tag}]`; close = `[/${tag}]` + close; }
    }
    out += open + esc(seg.text) + close;
  }
  return out;
}

/** Validate a stored fmt array (server side). Returns a clean array or null. */
export function cleanFmt(fmt, textLength) {
  if (fmt == null) return null;
  if (!Array.isArray(fmt) || fmt.length > MAX_FMT_SEGMENTS) return null;
  let total = 0;
  const out = [];
  for (const seg of fmt) {
    if (!Array.isArray(seg) || seg.length < 2) return null;
    const [len, flags, color] = seg;
    if (!Number.isInteger(len) || len <= 0 || !Number.isInteger(flags) || flags < 0 || flags > 31) return null;
    if (color != null && !(typeof color === 'string' && COLOR_RE.test(color))) return null;
    total += len;
    out.push([len, flags, color ? color.toLowerCase() : null]);
  }
  if (total !== textLength) return null;
  return out;
}

/** Strip formatting tags, leaving what a plain-text reader would see. */
export function stripMarkup(src) {
  return parseMarkup(src).text;
}

/** Slice a fmt array to the character range [from, to). Returns null if plain. */
export function sliceFmt(fmt, from, to) {
  if (!fmt) return null;
  const out = [];
  let pos = 0;
  for (const [len, flags, color] of fmt) {
    const a = Math.max(from, pos);
    const b = Math.min(to, pos + len);
    if (b > a) {
      const last = out[out.length - 1];
      if (last && last[1] === flags && last[2] === color) last[0] += b - a;
      else out.push([b - a, flags, color]);
    }
    pos += len;
  }
  return out.every(([, f, c]) => f === 0 && !c) ? null : out;
}

/**
 * Split a long message into chunks of at most maxChars, preferring sentence
 * ends, then spaces. A chunk keeps its formatting. Never returns an empty list.
 */
export function splitMessage(text, fmt, maxChars) {
  if (text.length <= maxChars) return [{ text, fmt: fmt ?? null }];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    if (text.length - start <= maxChars) {
      chunks.push([start, text.length]);
      break;
    }
    const window = text.slice(start, start + maxChars + 1);
    let cut = -1;
    // last sentence end in the back half of the window
    const re = /[.!?]["')\]]*\s/g;
    for (let m = re.exec(window); m; m = re.exec(window)) {
      if (m.index + m[0].length > maxChars * 0.4) cut = m.index + m[0].length;
    }
    if (cut < 0) cut = window.lastIndexOf(' ', maxChars);
    if (cut <= 0) cut = maxChars; // one enormous word
    chunks.push([start, start + cut]);
    start += cut;
  }
  return chunks.map(([a, b]) => {
    // trim whitespace at the seam but keep fmt aligned to the trimmed range
    let s = a, e = b;
    while (s < e && /\s/.test(text[s])) s++;
    while (e > s && /\s/.test(text[e - 1])) e--;
    return { text: text.slice(s, e), fmt: sliceFmt(fmt, s, e) };
  }).filter((c) => c.text.length > 0);
}
