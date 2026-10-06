import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPanels } from '../public/js/shared/layout.js';
import { buildScene, characterGeometry, U, BALLOON } from '../public/js/shared/scene.js';
import { wrapText, widestWord, toSymbolFont } from '../public/js/shared/textwrap.js';
import { segments } from '../public/js/shared/richtext.js';
import { neutralBody } from '../public/js/shared/emotion.js';
import { loadCharacter, loadIndex } from './helpers.mjs';

const measure = (flags, px, text) => text.length * px * 0.5 * (flags & 1 ? 1.1 : 1);
const index = loadIndex();
const chars = new Map(index.characters.map((c) => [c.id, loadCharacter(c.id)]));
const ids = [...chars.keys()];

let nid = 1;
const e = (userId, text, extra = {}) => ({
  id: nid++, userId, author: `User${userId}`, character: ids[userId % ids.length], em: null,
  kind: 'say', text, fmt: null, backdrop: null, to: [], ts: nid, ...extra,
});
const scene = (entries, i = 0, ctx = {}) => {
  const panels = buildPanels(entries);
  return buildScene(panels[i], { characters: chars, measure, ...ctx });
};

test('wrapText wraps at the width and never drops words', () => {
  const lines = wrapText(segments('the quick brown fox jumps over the lazy dog', null), 100, 10, measure);
  assert.ok(lines.length > 1);
  assert.ok(lines.every((l) => l.width <= 100 + 1e-6));
  assert.equal(lines.map((l) => l.runs.map((r) => r.text).join('')).join(' '), 'the quick brown fox jumps over the lazy dog');
});

test('wrapText breaks an over-long word by character', () => {
  const lines = wrapText(segments('x'.repeat(50), null), 60, 10, measure);
  assert.ok(lines.length >= 4);
  assert.ok(lines.every((l) => l.width <= 60));
});

test('wrapText honours newlines and keeps run styles', () => {
  const lines = wrapText([{ text: 'a\nb ', flags: 0, color: null }, { text: 'bold', flags: 1, color: '#f00' }], 500, 10, measure);
  assert.equal(lines.length, 2);
  assert.equal(lines[1].runs.at(-1).flags, 1);
  assert.equal(lines[1].runs.at(-1).color, '#f00');
});

test('widestWord and symbol font', () => {
  assert.equal(widestWord(segments('a bbbb cc', null), 10, measure), 20);
  assert.equal(toSymbolFont('abc'), 'αβχ');
});

test('every converted character has valid neutral geometry', () => {
  for (const [id, av] of chars) {
    const g = characterGeometry(av, neutralBody(av));
    assert.ok(g && g.width > 0 && g.height > 0, id);
    assert.ok(g.faceX >= 0 && g.faceX <= g.width, `${id} faceX ${g.faceX}/${g.width}`);
    assert.ok(g.headHeight > 0 && g.headHeight <= g.height + 1, id);
    for (const p of g.parts) assert.ok(av.sprites[p.key], `${id} ${p.key}`);
  }
});

test('single speaker: first panel is an establishing shot, later panels zoom', () => {
  const entries = [e(1, 'hello'), e(1, 'again'), e(1, 'and again')];
  const panels = buildPanels(entries);
  const first = buildScene(panels[0], { characters: chars, measure });
  const second = buildScene(panels[1], { characters: chars, measure });
  assert.equal(first.zoom, 1);
  assert.ok(second.zoom >= 1);
  assert.ok(second.zoom > 1, 'a lone character fills the panel');
  assert.ok(second.crop.w < 1 && second.crop.w > 0.4);
  assert.deepEqual(first.crop, { x: 0, y: 0, w: 1, h: 1 });
});

test('characters stay inside the panel horizontally and sit on the bottom edge', () => {
  const s = scene([e(1, 'a'), e(2, 'b'), e(3, 'c'), e(4, 'd')]);
  assert.equal(s.members.length, 4);
  for (const m of s.members) {
    assert.ok(m.bbox.x >= -1 && m.bbox.x + m.bbox.w <= U + 1, `x ${m.bbox.x}+${m.bbox.w}`);
    assert.ok(m.bbox.y + m.bbox.h >= U - 1, 'feet at or below the bottom edge');
  }
});

test('cast keeps left-to-right order with no overlap', () => {
  const s = scene([e(1, 'a'), e(2, 'b'), e(3, 'c')]);
  const xs = s.members.map((m) => m.bbox);
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i].x >= xs[i - 1].x + xs[i - 1].w - 1);
});

test('flipped characters mirror their parts inside the bbox', () => {
  const s = scene([e(1, 'a'), e(2, 'b')]);
  for (const m of s.members) {
    for (const p of m.parts) {
      assert.equal(p.flip, m.flip);
      assert.ok(p.x >= m.bbox.x - 1 && p.x + p.w <= m.bbox.x + m.bbox.w + 1, `${p.layer} inside bbox`);
    }
  }
});

test('balloons stay inside the top half and do not overlap', () => {
  const s = scene([e(1, 'Hello there everyone, how is it going today?'), e(2, 'Pretty good, thanks for asking!'), e(3, 'Same here.')]);
  assert.equal(s.balloons.length, 3);
  for (const b of s.balloons) {
    assert.ok(b.x >= BALLOON.MARGIN - 1 && b.x + b.w <= U - BALLOON.MARGIN + 1, `x ${b.x}+${b.w}`);
    assert.ok(b.y >= BALLOON.TOP - 1);
  }
  const last = s.balloons.at(-1);
  assert.ok(last.y + last.h <= BALLOON.BOTTOM + 1, `bottom ${last.y + last.h}`);
  for (let i = 1; i < s.balloons.length; i++) {
    assert.ok(s.balloons[i].y >= s.balloons[i - 1].y + s.balloons[i - 1].h, 'stacked in order');
  }
});

test('later balloons keep out of earlier balloons tail corridors', () => {
  const s = scene([e(1, 'first'), e(2, 'second'), e(3, 'third')]);
  const [a, b, c] = s.balloons;
  for (const lower of [b, c]) {
    for (const upper of [a, b].filter((u) => u.y < lower.y)) {
      if (!upper.tail) continue;
      const lo = Math.min(upper.tail.baseX, upper.tail.tipX) - BALLOON.TAIL_HALF;
      const hi = Math.max(upper.tail.baseX, upper.tail.tipX) + BALLOON.TAIL_HALF;
      const overlap = lower.x < hi && lower.x + lower.w > lo;
      assert.equal(overlap, false, 'lower balloon intersects an upper tail');
    }
  }
});

test('every balloon overlaps its speaker horizontally and its tail points at them', () => {
  const s = scene([e(1, 'one'), e(2, 'two'), e(3, 'three')]);
  for (const b of s.balloons) {
    const who = s.members.find((m) => m.userId === b.userId);
    assert.equal(b.tail.tipX, who.arrowX);
    assert.ok(b.tail.tipY > b.y + b.h, 'tail leaves the bottom of the balloon');
  }
});

test('action lines become a left-aligned box with the author in front and no tail', () => {
  const s = scene([e(1, 'waves hello', { kind: 'action' })]);
  const b = s.balloons[0];
  assert.equal(b.kind, 'action');
  assert.equal(b.tail, null);
  assert.equal(b.x, BALLOON.MARGIN);
  assert.ok(b.lines[0].runs[0].text.startsWith('User1'));
});

test('very long text shrinks the font until it fits', () => {
  const long = 'word '.repeat(37).trim();
  const s = scene([e(1, long)]);
  const b = s.balloons[0];
  assert.ok(b.y + b.h <= BALLOON.BOTTOM + 1, `fits (${b.y + b.h})`);
  assert.ok(b.px <= BALLOON.PX);
});

test('scenes are deterministic', () => {
  const entries = [e(1, 'alpha beta gamma delta'), e(2, 'epsilon zeta eta theta')];
  assert.deepEqual(scene(entries), scene(entries));
});

test('explicit emotion overrides text rules; auto expressions can be disabled', () => {
  const av = chars.get(ids[1]);
  const shout = scene([e(1, 'GET OFF')]);
  const neutral = scene([e(1, 'GET OFF')], 0, { autoExpressions: false });
  const happyEntry = scene([e(1, 'GET OFF', { em: { e: 0, i: 1 } })]);
  const key = (s) => s.members[0].parts.map((p) => p.key).join();
  assert.ok(av);
  assert.notEqual(key(shout), key(neutral));
  assert.notEqual(key(happyEntry), key(shout));
});

test('unknown characters are reported missing instead of crashing', () => {
  const entries = [e(1, 'hi', { character: 'no-such-character' })];
  const panels = buildPanels(entries);
  const s = buildScene(panels[0], { characters: chars, measure });
  assert.equal(s.members[0].missing, true);
  assert.equal(s.balloons.length, 1);
});
