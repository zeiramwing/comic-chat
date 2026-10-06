// Word-wrapping of rich-text segments. Pure: the caller injects `measure`.
//
//   measure(flags, px, text) -> width in the same units as px
//
// A line is { runs: [{ text, flags, color, width }], width }. Whitespace at a
// wrap point is dropped; a word longer than the line is broken by character.

const isSpace = (c) => c === ' ' || c === '\t' || c === '\n';

/** Split segments into tokens: words and single spaces, keeping style. */
function tokenize(segs) {
  const out = [];
  for (const seg of segs) {
    let i = 0;
    const t = seg.text;
    while (i < t.length) {
      if (t[i] === '\n') { out.push({ nl: true, flags: seg.flags, color: seg.color }); i++; continue; }
      let j = i;
      const space = isSpace(t[i]);
      while (j < t.length && t[j] !== '\n' && isSpace(t[j]) === space) j++;
      out.push({ text: t.slice(i, j), space, flags: seg.flags, color: seg.color });
      i = j;
    }
  }
  return out;
}

export function wrapText(segs, maxWidth, px, measure) {
  const lines = [];
  let cur = { runs: [], width: 0 };
  const pushRun = (text, flags, color, width) => {
    const last = cur.runs[cur.runs.length - 1];
    if (last && last.flags === flags && last.color === color) {
      last.text += text;
      last.width += width;
    } else cur.runs.push({ text, flags, color, width });
    cur.width += width;
  };
  const endLine = () => {
    // trim trailing space
    while (cur.runs.length) {
      const last = cur.runs[cur.runs.length - 1];
      const trimmed = last.text.replace(/\s+$/, '');
      if (trimmed === last.text) break;
      cur.width -= last.width;
      if (!trimmed) cur.runs.pop();
      else {
        last.text = trimmed;
        last.width = measure(last.flags, px, trimmed);
        cur.width += last.width;
      }
    }
    lines.push(cur);
    cur = { runs: [], width: 0 };
  };

  for (const tok of tokenize(segs)) {
    if (tok.nl) { endLine(); continue; }
    const w = measure(tok.flags, px, tok.text);
    if (tok.space) {
      if (cur.width === 0) continue; // no leading space on a line
      if (cur.width + w > maxWidth) { endLine(); continue; }
      pushRun(tok.text, tok.flags, tok.color, w);
      continue;
    }
    if (cur.width + w <= maxWidth) { pushRun(tok.text, tok.flags, tok.color, w); continue; }
    if (cur.width > 0) endLine();
    if (w <= maxWidth) { pushRun(tok.text, tok.flags, tok.color, w); continue; }
    // a single word wider than the line: break by character
    let chunk = '';
    for (const ch of tok.text) {
      const test = chunk + ch;
      if (chunk && measure(tok.flags, px, test) > maxWidth) {
        pushRun(chunk, tok.flags, tok.color, measure(tok.flags, px, chunk));
        endLine();
        chunk = ch;
      } else chunk = test;
    }
    if (chunk) pushRun(chunk, tok.flags, tok.color, measure(tok.flags, px, chunk));
  }
  if (cur.runs.length || !lines.length) endLine();
  return lines;
}

/** Total plain length, used for sizing estimates. */
export const plainLength = (segs) => segs.reduce((n, s) => n + s.text.length, 0);

/** The widest unbreakable word (the balloon can never be narrower). */
export function widestWord(segs, px, measure) {
  let best = 0;
  for (const tok of tokenize(segs)) {
    if (tok.nl || tok.space) continue;
    best = Math.max(best, measure(tok.flags, px, tok.text));
  }
  return best;
}

// The Windows "Symbol" font shows Greek letters for Latin keys. Browsers do not
// have it, so map the common ones so the Format > Symbol option still works.
const SYMBOL = {
  a: 'α', b: 'β', c: 'χ', d: 'δ', e: 'ε', f: 'φ', g: 'γ', h: 'η', i: 'ι', k: 'κ', l: 'λ',
  m: 'μ', n: 'ν', o: 'ο', p: 'π', q: 'θ', r: 'ρ', s: 'σ', t: 'τ', u: 'υ', w: 'ω', x: 'ξ',
  y: 'ψ', z: 'ζ',
  A: 'Α', B: 'Β', C: 'Χ', D: 'Δ', E: 'Ε', F: 'Φ', G: 'Γ', H: 'Η', I: 'Ι', K: 'Κ', L: 'Λ',
  M: 'Μ', N: 'Ν', O: 'Ο', P: 'Π', Q: 'Θ', R: 'Ρ', S: 'Σ', T: 'Τ', U: 'Υ', W: 'Ω', X: 'Ξ',
  Y: 'Ψ', Z: 'Ζ',
};
export const toSymbolFont = (s) => s.replace(/[A-Za-z]/g, (c) => SYMBOL[c] ?? c);
