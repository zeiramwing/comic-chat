// Turns a sequence of entries into comic panels.
//
// Ported from CUnitPanelPage::AddLine and the avatar-ordering code in
// v2.5-beta-1-modern/panel.cpp. The result is a pure function of the entry
// sequence: no fonts, no images, no randomness except a seeded PRNG, so the
// same history always lays out the same way and improving this file improves
// the whole strip.
//
// What happens to each entry (see StripBuilder.push):
//   * it is split into chunks if it is long (the original's "ForceFit" leftovers);
//   * a chunk joins the current panel unless it must start a new one:
//       - an action (narration box) always starts a new panel,
//       - the speaker is already in the panel, speaking or addressed (one
//         appearance per character, like CPanel::AvatarInPanel),
//       - the panel already holds MAX_BALLOONS balloons,
//       - the cast would exceed MAX_CAST,
//       - the balloons would no longer plausibly fit (LINE_BUDGET),
//       - the entry changes the backdrop;
//   * an "expression" (a character reacting with no words, the original's
//     AddReaction) never adds a balloon: it joins the current panel and changes
//     that character's pose, or starts a new panel if there is no room;
//   * the cast of the panel (speakers plus anyone they address) is ordered
//     left to right and given a facing direction with the original's greedy
//     "who faces whom" penalty, remembering last panel's arrangement so
//     characters do not shuffle needlessly.

import { splitMessage } from './richtext.js';

export const LIMITS = {
  MAX_BALLOONS: 5, // elements per panel before a new one starts
  MAX_CAST: 5, // "don't add more than 5 people to the panel"
  CHUNK_CHARS: 190, // longest single balloon
  CHARS_PER_LINE: 26, // rough balloon line length used for the budget only
  LINE_BUDGET: 13, // balloon lines that fit in the top half of a panel
};

export const estimateLines = (text) => Math.max(1, Math.ceil(text.length / LIMITS.CHARS_PER_LINE));

/** Deterministic PRNG (mulberry32). */
export function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 32-bit string/number hash (FNV-1a). */
export function hash(...parts) {
  let h = 0x811c9dc5;
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= 0x7c;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Ordering the cast of one panel (OrderAvatars / EvalPlacement / EvalPair).
//
// flip === false means the character faces right (its art's native direction),
// flip === true faces left.

function evalPair(b1, b2, deltaPlacement) {
  let desiredFlip;
  let delta = deltaPlacement;
  if (delta > 0) desiredFlip = false;
  else {
    desiredFlip = true;
    delta = -delta;
  }
  let rating = 0;
  if (b1.talkTos.length === 0) {
    if (b1.flip !== desiredFlip) rating += 4; // talking to the world, not facing the others
    if (b2.flip === desiredFlip) rating += 2; // ... and the other faces away from me
  } else if (b1.talkTos.includes(b2.userId)) {
    if (b1.flip === desiredFlip) rating += 4 * (delta - 1); // facing them: prefer adjacency
    else rating += 40; // facing away from the person I address
    if (b2.flip === desiredFlip) rating += 4; // they face away while I talk to them
  }
  return rating;
}

function displacementPenalty(order, state) {
  let penalty = 0;
  for (let i = 0; i < order.length; i++) {
    const st = state.get(order[i].userId);
    if (i > 0 && (st?.lastRight ?? null) !== order[i - 1].userId) penalty++;
    if (i < order.length - 1 && (st?.lastLeft ?? null) !== order[i + 1].userId) penalty++;
  }
  return penalty;
}

function evalPlacement(placed, rec, index, state) {
  const order = placed.slice();
  order.splice(index, 0, rec);
  const penalty = displacementPenalty(order, state);
  const rate = (flip) => {
    rec.flip = flip;
    let r = penalty;
    for (let i = 0; i < order.length; i++) {
      for (let j = i + 1; j < order.length; j++) {
        r += evalPair(order[i], order[j], j - i) + evalPair(order[j], order[i], i - j);
      }
    }
    return r;
  };
  const ratingR = rate(false);
  const ratingL = rate(true);
  if (ratingR < ratingL) return { rating: ratingR, flip: false };
  if (ratingR > ratingL) return { rating: ratingL, flip: true };
  return { rating: ratingR, flip: state.get(rec.userId)?.lastDir ?? false };
}

/**
 * records: [{ userId, character, requested, talkTos:[userId] }] in speaking
 * order. Returns the cast left to right with .flip decided, and updates
 * `state` (per-user lastDir/lastLeft/lastRight) like UpdateHistoresis.
 */
export function orderCast(records, state) {
  const recs = records.map((r) => ({ ...r, flip: false }));
  const placed = [];
  for (const rec of recs) {
    let best = { rating: 1000, index: 0, flip: false };
    for (let j = 0; j <= placed.length; j++) {
      const ev = evalPlacement(placed, rec, j, state);
      if (ev.rating < best.rating) best = { rating: ev.rating, index: j, flip: ev.flip };
    }
    rec.flip = best.flip;
    placed.splice(best.index, 0, rec);
  }
  placed.forEach((r, i) => {
    const st = state.get(r.userId) ?? {};
    st.lastDir = r.flip;
    if (i > 0) st.lastRight = placed[i - 1].userId;
    if (i < placed.length - 1) st.lastLeft = placed[i + 1].userId;
    state.set(r.userId, st);
  });
  return placed;
}

// ---------------------------------------------------------------------------

/**
 * Entry shape the layout understands:
 * { id, userId, author, character, em: {e,i}|null, kind: 'say'|'think'|'action'|'whisper',
 *   text, fmt, backdrop: string|null, to: [userId], ts }
 */
export class StripBuilder {
  constructor(opts = {}) {
    this.opts = { defaultBackdrop: null, ...opts };
    this.panels = [];
    this.state = new Map(); // per user ordering memory
    this.lastCharacter = new Map(); // userId -> last character used
    this.names = new Map(); // userId -> last display name
    this.currentBackdrop = this.opts.defaultBackdrop;
  }

  get last() {
    return this.panels[this.panels.length - 1];
  }

  push(entry) {
    this.lastCharacter.set(entry.userId, entry.character);
    this.names.set(entry.userId, entry.author);
    if (entry.kind === 'expression') {
      this.#addReaction({
        entryId: entry.id, userId: entry.userId, author: entry.author, character: entry.character,
        em: entry.em ?? { e: 0, i: 0 }, ts: entry.ts, backdrop: entry.backdrop ?? null,
      });
      return;
    }
    const chunks = splitMessage(entry.text, entry.fmt, LIMITS.CHUNK_CHARS);
    chunks.forEach((chunk, ci) => {
      this.#addLine({
        entryId: entry.id,
        userId: entry.userId,
        author: entry.author,
        character: entry.character,
        kind: entry.kind,
        em: entry.em ?? null,
        text: chunk.text,
        fmt: chunk.fmt,
        to: entry.to ?? [],
        ts: entry.ts,
        chunk: ci,
        chunks: chunks.length,
        backdrop: ci === 0 ? entry.backdrop ?? null : null,
      });
    });
  }

  #needsNewPanel(line) {
    const p = this.last;
    if (!p) return true;
    if (line.kind === 'action') return true;
    if (p.lines.length >= LIMITS.MAX_BALLOONS) return true;
    if (p.cast.some((c) => c.userId === line.userId)) return true;
    if (line.backdrop && line.backdrop !== p.backdrop) return true;
    const cast = new Set(p.lines.map((l) => l.userId));
    cast.add(line.userId);
    for (const t of line.to) cast.add(t);
    for (const l of p.lines) for (const t of l.to) cast.add(t);
    if (cast.size > LIMITS.MAX_CAST) return true;
    const used = p.lines.reduce((n, l) => n + estimateLines(l.text) + 1, 0);
    if (used + estimateLines(line.text) + 1 > LIMITS.LINE_BUDGET) return true;
    return false;
  }

  #newPanel(entryId) {
    const panel = {
      index: this.panels.length,
      id: entryId,
      seed: hash(entryId, this.panels.length),
      backdrop: this.currentBackdrop,
      lines: [],
      reactions: [],
      cast: [],
    };
    this.panels.push(panel);
    return panel;
  }

  #addLine(line) {
    if (line.backdrop) this.currentBackdrop = line.backdrop;
    const panel = this.#needsNewPanel(line) ? this.#newPanel(line.entryId) : this.last;
    panel.lines.push(line);
    this.#arrange(panel);
  }

  #addReaction(r) {
    if (r.backdrop) this.currentBackdrop = r.backdrop;
    const p = this.last;
    const inCast = p?.cast.some((c) => c.userId === r.userId);
    const roomFor = p && (inCast || p.cast.length < LIMITS.MAX_CAST);
    const sameScene = !r.backdrop || r.backdrop === p?.backdrop;
    const panel = roomFor && sameScene ? p : this.#newPanel(r.entryId);
    // a later reaction by the same person replaces the earlier one
    panel.reactions = panel.reactions.filter((x) => x.userId !== r.userId);
    panel.reactions.push(r);
    this.#arrange(panel);
  }

  #arrange(panel) {
    // Speakers in speaking order, then everyone they address.
    const records = [];
    for (const l of panel.lines) {
      records.push({
        userId: l.userId,
        character: l.character,
        requested: true,
        talkTos: l.to.filter((t) => t !== l.userId),
      });
    }
    const speakers = new Set(records.map((r) => r.userId));
    for (const r of panel.reactions) {
      if (speakers.has(r.userId)) continue;
      speakers.add(r.userId);
      records.push({ userId: r.userId, character: r.character, requested: true, talkTos: [] });
    }
    for (const l of panel.lines) {
      for (const t of l.to) {
        if (records.length >= LIMITS.MAX_CAST) break;
        if (speakers.has(t) || !this.lastCharacter.has(t)) continue;
        speakers.add(t);
        records.push({ userId: t, character: this.lastCharacter.get(t), requested: false, talkTos: [] });
      }
    }
    panel.cast = orderCast(records, this.state).map(({ userId, character, requested, flip }) => ({
      userId, character, requested, flip, name: this.names.get(userId) ?? '',
    }));
  }
}

/** Convenience: lay out a whole history. */
export function buildPanels(entries, opts) {
  const b = new StripBuilder(opts);
  for (const e of entries) b.push(e);
  return b.panels;
}
