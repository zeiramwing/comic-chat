// Emotions, the emotion wheel, picking a character pose, and the automatic
// text-to-expression rules. Ported from v2.5-beta-1-modern (bodycam.cpp,
// avatar.cpp, textpose.cpp, and the ID_RULE_* strings in chat.rc).
//
// An emotion is { e, i }: e is an angle in radians for the eight wheel
// emotions (or a gesture code >= 1001), i is intensity 0..1. Intensity 0 means
// neutral whatever the angle.

export const PI = Math.PI;
export const TAU = Math.PI * 2;
export const NEMOTIONS = 8;
const STEP = TAU / NEMOTIONS;

// Wheel order and angles. The original wheel is y-up: happy at 0 (east), then
// counter-clockwise: coy, bored (north), scared, sad (west), angry, shout
// (south), laugh.
export const EMOTION_NAMES = ['Happy', 'Coy', 'Bored', 'Scared', 'Sad', 'Angry', 'Shout', 'Laugh'];
export const NEUTRAL_NAME = 'Neutral';
export const EM = {
  HAPPY: 0, COY: STEP, BORED: 2 * STEP, SCARED: 3 * STEP,
  SAD: 4 * STEP, ANGRY: 5 * STEP, SHOUT: 6 * STEP, LAUGH: 7 * STEP,
};
export const GESTURE = {
  WAVE: 1001, POINTOTHER: 1002, POINTSELF: 1003, DOUBLEPOINT: 1004, SHRUG: 1005,
  WALK_3QR: 1006, WALK_SIDE: 1007, WALK_3QF: 1008,
};
export const NEUTRAL = Object.freeze({ e: 0, i: 0 });

const EPS = 0.01;
const same = (a, b) => Math.abs(a - b) < EPS;
const isGesture = (e) => e >= 1000;
const isNeutralRec = (r) => same(r.e, 0) && r.i === 0;

/** value_to_angle: wrap into (-pi, pi]. */
export function valueToAngle(v) {
  if (v > -PI && v <= PI) return v;
  let t = v % TAU;
  if (t < 0) t += TAU;
  return t <= PI ? t : t - TAU;
}
export const subtractAngles = (a, b) => valueToAngle(a - b);

// ---------------------------------------------------------------------------
// The wheel

/** Pointer offset from the wheel centre (screen px, y down) -> emotion. */
export function emotionFromWheel(dx, dyDown, radius) {
  const mag = Math.hypot(dx, dyDown);
  let i = Math.min(1, mag / radius);
  if (i < 0.2) i = 0; // the "detente" in the middle
  if (i === 0) return { e: 0, i: 0 };
  let e = Math.atan2(-dyDown, dx); // flip to y-up
  if (e < 0) e += TAU;
  return { e: Math.round(e * 1000) / 1000, i: Math.round(i * 100) / 100 };
}

/** Inverse of emotionFromWheel: emotion -> pointer offset (screen px, y down). */
export function wheelPoint(em, radius) {
  if (!em || em.i === 0 || isGesture(em.e)) return { x: 0, y: 0 };
  return { x: Math.cos(em.e) * em.i * radius, y: -Math.sin(em.e) * em.i * radius };
}

/** Index 0..7 of the wheel emotion nearest to angle e. */
export function nearestEmotionIndex(e) {
  const a = valueToAngle(e);
  const k = Math.round((a < 0 ? a + TAU : a) / STEP) % NEMOTIONS;
  return k;
}

/** Human label, like the status bar "Emotion is %1". */
export function emotionLabel(em) {
  if (!em || em.i === 0) return NEUTRAL_NAME;
  if (isGesture(em.e)) {
    return Object.entries(GESTURE).find(([, v]) => v === em.e)?.[0].toLowerCase() ?? NEUTRAL_NAME;
  }
  return EMOTION_NAMES[nearestEmotionIndex(em.e)];
}

// ---------------------------------------------------------------------------
// Picking poses. `av` is a character manifest from convert-art.mjs.
//
// `start` replaces the original's m_lastTorso/m_lastBody state: the search over
// torsos begins after it, so repeated messages cycle through equally good
// poses instead of always choosing the first. Callers pass a deterministic
// value (e.g. derived from the entry id) so a rendered history never changes.

function cyc(n, start, i) {
  return (((start | 0) + 1 + i) % n + n) % n;
}

function nearestFace(faces, em) {
  let nearestAngle = 3 * PI;
  let nearestIntensity = 2;
  let found = -1;
  faces.forEach((f, idx) => {
    if (isGesture(f.e)) return;
    const a = Math.abs(subtractAngles(f.e, em.e));
    if (a <= nearestAngle) {
      const di = Math.abs(em.i - f.i);
      if (a === nearestAngle && di >= nearestIntensity) return;
      nearestAngle = a;
      nearestIntensity = di;
      found = idx;
    }
  });
  return found;
}

function nearestTorso(torsos, em, start) {
  let best = 2;
  let found = -1;
  const n = torsos.length;
  for (let i = 0; i < n; i++) {
    const idx = cyc(n, start, i);
    const t = torsos[idx];
    if (isGesture(t.e)) continue;
    const a = Math.abs(subtractAngles(t.e, em.e));
    if (a < PI / NEMOTIONS || isNeutralRec(t)) {
      const di = Math.abs(em.i - t.i);
      if (di < best) { best = di; found = idx; }
    }
  }
  return found;
}

function neutralIndex(recs, start) {
  const n = recs.length;
  for (let i = 0; i < n; i++) {
    const idx = cyc(n, start, i);
    if (isNeutralRec(recs[idx])) return idx;
  }
  return 0;
}

function nearestSimple(bodies, em, start) {
  let nearestIntensity = 2;
  let found = -1;
  const n = bodies.length;
  for (let i = 0; i < n; i++) {
    const idx = cyc(n, start, i);
    const b = bodies[idx];
    if (isGesture(b.e)) continue;
    const a = Math.abs(subtractAngles(b.e, em.e));
    const firstNeutral = isNeutralRec(b) && found === -1;
    if (a < PI / NEMOTIONS || firstNeutral) {
      const di = firstNeutral && em.i > 0 ? 1.5 : Math.abs(em.i - b.i);
      if (di < nearestIntensity) { nearestIntensity = di; found = idx; }
    }
  }
  return found;
}

/**
 * Choose a pose for an explicit wheel emotion. Returns
 * { face, torso } (complex) or { body } (simple), each a record from the manifest.
 */
export function bodyFromEmotion(av, em, start = 0) {
  const e = em ?? NEUTRAL;
  if (av.type === 'simple') {
    let idx = nearestSimple(av.bodies, e, start);
    if (idx < 0) idx = neutralIndex(av.bodies, start);
    return { body: av.bodies[idx] };
  }
  let fi = nearestFace(av.faces, e);
  if (fi < 0) fi = neutralIndex(av.faces, start);
  let ti = nearestTorso(av.torsos, e, start);
  if (ti < 0) ti = neutralIndex(av.torsos, start);
  return { face: av.faces[fi], torso: av.torsos[ti] };
}

export const neutralBody = (av, start = 0) => bodyFromEmotion(av, NEUTRAL, start);

/** Options -> pose, highest priority first (CAvatar*::GetBodyFromEmotion(CEmotionOpts&)). */
export function bodyFromOpts(av, opts, start = 0) {
  const list = opts.map((o) => ({ ...o }));
  const pick = () => {
    let best = -1;
    let min = 0;
    list.forEach((o, idx) => { if (o.priority > min) { min = o.priority; best = idx; } });
    return best;
  };

  if (av.type === 'simple') {
    for (let k = pick(); k >= 0; k = pick()) {
      const o = list[k];
      o.priority = 0;
      let idx = -1;
      if (o.e <= TAU) {
        // nearest by angle then intensity
        let na = 3 * PI;
        let ni = 2;
        av.bodies.forEach((b, j) => {
          if (isGesture(b.e)) return;
          const a = Math.abs(subtractAngles(b.e, o.e));
          if (a <= na) {
            const di = Math.abs(o.i - b.i);
            if (a === na && di >= ni) return;
            na = a; ni = di; idx = j;
          }
        });
      } else {
        idx = av.bodies.findIndex((b) => same(b.e, o.e));
      }
      if (idx >= 0) return { body: av.bodies[idx] };
    }
    return neutralBody(av, start);
  }

  let fi = -1;
  let ti = -1;
  for (let k = pick(); k >= 0 && !(fi >= 0 && ti >= 0); k = pick()) {
    const o = list[k];
    o.priority = 0;
    if (o.e <= TAU) {
      if (fi < 0) fi = nearestFace(av.faces, o);
    } else if (ti < 0) {
      ti = av.torsos.findIndex((t) => same(t.e, o.e));
    }
  }
  if (fi < 0) fi = neutralIndex(av.faces, start);
  if (ti < 0) ti = neutralIndex(av.torsos, start);
  return { face: av.faces[fi], torso: av.torsos[ti] };
}

// ---------------------------------------------------------------------------
// Automatic expressions from text (textpose.cpp). Each rule is one line of the
// form  Function("arg");priority  exactly as in the original string table.

export const DEFAULT_RULE_TEXT = {
  [EM.SHOUT]: 'AllCaps("");9\nFindString("!!!");9',
  [EM.LAUGH]: 'CheckWord*("ROTFL");11\nCheckWord*("LOL");11\nFindString*("HEHE");11',
  [EM.HAPPY]: 'FindString(":)");10\nFindString(":-)");10',
  [EM.SAD]: 'FindString(":(");10\nFindString(":-(");10',
  [GESTURE.POINTOTHER]: 'CheckStart*("You");4\nCheckWord*("are you");8\nCheckWord*("will you");8\nCheckWord*("did you");8\nCheckWord*("aren\'t you");8\nCheckWord*("don\'t you");8',
  [GESTURE.POINTSELF]: 'CheckStart*("I");3\nCheckWord*("i\'m");7\nCheckWord*("i will");7\nCheckWord*("i\'ll");7\nCheckWord*("i am");7',
  [GESTURE.WAVE]: 'CheckStart*("Hi");2\nCheckStart*("Bye");3\nCheckStart*("Hello");5\nCheckStart*("Welcome");5\nCheckStart*("Howdy");5',
  [EM.COY]: 'FindString(";-)");10\nFindString(";)");10',
};

export function compileRules(ruleText = DEFAULT_RULE_TEXT) {
  const rules = { caps: null, general: [], word: [], sentence: [] };
  for (const [emKey, text] of Object.entries(ruleText)) {
    const emotion = Number(emKey);
    for (const line of String(text).split('\n')) {
      const m = /^\s*([A-Za-z*]+)\("(.*)"\);\s*(\d+)\s*$/.exec(line);
      if (!m) continue;
      const [, fn, arg, strength] = m;
      const f = fn.toLowerCase();
      const caseSensitive = !f.endsWith('*');
      const unit = {
        emotion, strength: Number(strength), caseSensitive,
        arg: caseSensitive ? arg : arg.toLowerCase(), length: arg.length,
      };
      const base = f.replace('*', '');
      if (base === 'allcaps') rules.caps = { emotion, strength: unit.strength };
      else if (base === 'findstring') rules.general.push(unit);
      else if (base === 'checkword') rules.word.push(unit);
      else if (base === 'checkstart') rules.sentence.push(unit);
    }
  }
  return rules;
}

const isSpace = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r';
const isAlnum = (c) => /[A-Za-z0-9]/.test(c);
const isPunct = (c) => /[!-/:-@[-`{-~]/.test(c);

function checkForUppers(s) {
  let uppers = 0;
  for (const c of s) {
    if (c >= 'a' && c <= 'z') return false;
    if (c >= 'A' && c <= 'Z') uppers++;
  }
  return uppers > 1;
}

function checkWord(s, sub) {
  let from = 0;
  for (;;) {
    const at = s.indexOf(sub, from);
    if (at < 0) return false;
    if (at === 0 || isSpace(s[at - 1])) {
      const after = s[at + sub.length];
      if (after === undefined || isSpace(after) || isPunct(after)) return true;
    }
    from = at + 1;
  }
}

const startCompare = (sent, sub, len) => sent.startsWith(sub) && !(sent[len] !== undefined && isAlnum(sent[len]));

function nextSentenceStart(s) {
  const at = s.search(/[.!?]/);
  if (at < 0) return null;
  let p = at;
  while (p < s.length && (isPunct(s[p]) || isSpace(s[p]))) p++;
  return p;
}

/** Collect expression options { e, i, priority } from text. */
export function optsFromText(text, rules = compileRules()) {
  const opts = [];
  const add = (e, i, priority) => {
    const hit = opts.find((o) => o.e === e);
    if (hit) {
      if (hit.priority < priority) { hit.priority = priority; hit.i = i; }
      return;
    }
    if (opts.length < 10) opts.push({ e, i, priority });
  };
  const lower = text.toLowerCase();

  if (rules.caps && checkForUppers(text)) add(rules.caps.emotion, 1, rules.caps.strength);
  for (const u of rules.general) {
    if ((u.caseSensitive ? text : lower).includes(u.arg)) add(u.emotion, 1, u.strength);
  }
  for (const u of rules.word) {
    if (checkWord(u.caseSensitive ? text : lower, u.arg)) add(u.emotion, 1, u.strength);
  }
  // Sentence starts. (The original re-tests the whole buffer's start each
  // sentence; here each sentence is tested at its own start, which is the
  // evident intent.)
  let p = 0;
  while (p < text.length && isSpace(text[p])) p++;
  while (p !== null && p < text.length) {
    for (const u of rules.sentence) {
      const hay = (u.caseSensitive ? text : lower).slice(p);
      if (startCompare(hay, u.arg, u.length)) add(u.emotion, 1, u.strength);
    }
    const rel = nextSentenceStart(text.slice(p));
    p = rel === null ? null : p + rel;
  }
  return opts;
}
