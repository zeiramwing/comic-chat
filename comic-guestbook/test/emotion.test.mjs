import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EM, GESTURE, TAU, emotionFromWheel, wheelPoint, emotionLabel, nearestEmotionIndex,
  bodyFromEmotion, bodyFromOpts, compileRules, optsFromText, subtractAngles,
} from '../public/js/shared/emotion.js';
import { loadCharacter } from './helpers.mjs';

const near = (a, b, eps = 0.02) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test('wheel centre is neutral (detente)', () => {
  assert.deepEqual(emotionFromWheel(2, 1, 50), { e: 0, i: 0 });
});

test('wheel directions match the original y-up convention', () => {
  // east = happy, north (screen up) = bored, west = sad, south = shout
  assert.equal(emotionLabel(emotionFromWheel(40, 0, 50)), 'Happy');
  assert.equal(emotionLabel(emotionFromWheel(0, -40, 50)), 'Bored');
  assert.equal(emotionLabel(emotionFromWheel(-40, 0, 50)), 'Sad');
  assert.equal(emotionLabel(emotionFromWheel(0, 40, 50)), 'Shout');
  assert.equal(emotionLabel(emotionFromWheel(30, -30, 50)), 'Coy');
  assert.equal(emotionLabel(emotionFromWheel(30, 30, 50)), 'Laugh');
});

test('intensity is distance from centre, capped at 1', () => {
  near(emotionFromWheel(25, 0, 50).i, 0.5);
  assert.equal(emotionFromWheel(500, 0, 50).i, 1);
});

test('wheelPoint inverts emotionFromWheel', () => {
  const em = emotionFromWheel(30, -20, 60);
  const p = wheelPoint(em, 60);
  near(p.x, 30, 1.5);
  near(p.y, -20, 1.5);
});

test('nearestEmotionIndex wraps', () => {
  assert.equal(nearestEmotionIndex(TAU - 0.1), 0);
  assert.equal(nearestEmotionIndex(EM.SAD), 4);
  near(subtractAngles(0.1, TAU - 0.1), 0.2);
});

test('complex character: neutral and happy choose different faces', () => {
  const anna = loadCharacter('anna');
  const n = bodyFromEmotion(anna, { e: 0, i: 0 });
  const h = bodyFromEmotion(anna, { e: EM.HAPPY, i: 1 });
  assert.ok(n.face && n.torso);
  assert.equal(n.face.i, 0);
  assert.ok(h.face.i > 0, "happy at full intensity should not pick a neutral face");
  assert.notEqual(n.face.p, h.face.p);
});

test('torso choice cycles with start for variety but is deterministic', () => {
  const anna = loadCharacter('anna');
  const picks = new Set();
  for (let s = 0; s < anna.torsos.length; s++) picks.add(bodyFromEmotion(anna, { e: 0, i: 0 }, s).torso.p);
  assert.ok(picks.size >= 1);
  assert.equal(bodyFromEmotion(anna, { e: 0, i: 0 }, 3).torso.p, bodyFromEmotion(anna, { e: 0, i: 0 }, 3).torso.p);
});

test('simple character returns its body', () => {
  const tux = loadCharacter('tux');
  const b = bodyFromEmotion(tux, { e: EM.ANGRY, i: 1 });
  assert.ok(b.body);
});

test('every converted character yields a pose for every wheel emotion', () => {
  for (const id of ['anna', 'bolo', 'cro', 'denise', 'kirby', 'jordan', 'xeno', 'tux', 'waf', 'susan']) {
    const av = loadCharacter(id);
    for (let k = 0; k < 8; k++) {
      for (const i of [0, 0.5, 1]) {
        const b = bodyFromEmotion(av, { e: k * TAU / 8, i });
        assert.ok(b.body || (b.face && b.torso), `${id} ${k} ${i}`);
        for (const key of [b.body?.p, b.face?.p, b.torso?.p].filter(Boolean)) {
          assert.ok(av.sprites[key], `${id}: missing sprite ${key}`);
        }
      }
    }
  }
});

// ---- text rules --------------------------------------------------------

const rules = compileRules();
const top = (text) => optsFromText(text, rules).sort((a, b) => b.priority - a.priority)[0];

test('ALL CAPS and !!! shout', () => {
  near(top('GET OFF MY LAWN').e, EM.SHOUT);
  near(top('what!!!').e, EM.SHOUT);
});

test('a single capital is not shouting', () => {
  assert.notEqual(top('A')?.e, EM.SHOUT);
});

test('smileys', () => {
  near(top('nice :)').e, EM.HAPPY);
  near(top('oh no :-(').e, EM.SAD);
  near(top('wink ;-)').e, EM.COY);
});

test('laughing needs whole words, case-insensitive', () => {
  near(top('that is lol').e, EM.LAUGH);
  near(top('ROTFL!').e, EM.LAUGH);
  assert.equal(optsFromText('lollipop', rules).length, 0);
  near(top('hehe ok').e, EM.LAUGH);
});

test('sentence starts trigger gestures', () => {
  assert.equal(top('Hi there').e, GESTURE.WAVE);
  assert.equal(top('hello everyone').e, GESTURE.WAVE);
  assert.equal(top('You should come').e, GESTURE.POINTOTHER);
  assert.equal(top('I like it').e, GESTURE.POINTSELF);
  assert.equal(optsFromText('History is fun', rules).length, 0); // "Hi" must end at a word
});

test('priority decides between competing rules', () => {
  // "HI!!!" -> shout (9) beats wave (2)
  const opts = optsFromText('HI!!!', rules);
  assert.equal(opts.length >= 2, true);
  near(opts.sort((a, b) => b.priority - a.priority)[0].e, EM.SHOUT);
});

test('options pick both a face and a gesture torso', () => {
  const anna = loadCharacter('anna');
  const hasWave = anna.torsos.some((t) => t.e === GESTURE.WAVE);
  const opts = optsFromText('HI!!!', rules);
  const b = bodyFromOpts(anna, opts);
  assert.ok(b.face && b.torso);
  if (hasWave) assert.equal(b.torso.e, GESTURE.WAVE);
});

test('no matching rule falls back to neutral', () => {
  const anna = loadCharacter('anna');
  const b = bodyFromOpts(anna, []);
  assert.equal(b.face.i, 0);
});
