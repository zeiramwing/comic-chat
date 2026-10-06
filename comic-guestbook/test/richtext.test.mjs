import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkup, toMarkup, segments, cleanFmt, F } from '../public/js/shared/richtext.js';

test('plain text has no fmt', () => {
  assert.deepEqual(parseMarkup('hello'), { text: 'hello', fmt: null });
});

test('bold and italic runs cover the text', () => {
  const r = parseMarkup('[b]bold[/b] and [i]it[/i]');
  assert.equal(r.text, 'bold and it');
  assert.deepEqual(r.fmt, [[4, F.BOLD, null], [5, 0, null], [2, F.ITALIC, null]]);
});

test('nested tags combine flags', () => {
  const r = parseMarkup('[b][i]x[/i][/b]');
  assert.deepEqual(r.fmt, [[1, F.BOLD | F.ITALIC, null]]);
});

test('unmatched and unknown tags stay literal', () => {
  assert.equal(parseMarkup('[b]open only').text, '[b]open only');
  assert.equal(parseMarkup('[b]x[/i]').text, '[b]x[/i]');
  assert.equal(parseMarkup('[blink]x[/blink]').text, '[blink]x[/blink]');
});

test('backslash escapes a bracket', () => {
  assert.equal(parseMarkup('a \\[b] literal').text, 'a [b] literal');
});

test('colour runs', () => {
  const r = parseMarkup('[color=#FF0000]red[/color] plain');
  assert.deepEqual(r.fmt, [[3, 0, '#ff0000'], [6, 0, null]]);
  assert.equal(parseMarkup('[color=red]x[/color]').text, '[color=red]x[/color]');
});

test('round trips through markup', () => {
  const src = '[b]hi[/b] [color=#00ff00]there[/color] and \\[b] literal';
  const a = parseMarkup(src);
  const b = parseMarkup(toMarkup(a.text, a.fmt));
  assert.deepEqual(b, a);
});

test('segments tolerate short or long fmt', () => {
  assert.deepEqual(segments('abc', [[2, F.BOLD, null]]).map((s) => s.text), ['ab', 'c']);
  assert.deepEqual(segments('ab', [[2, 0, null], [5, 0, null]]).map((s) => s.text), ['ab']);
  assert.deepEqual(segments('', null), []);
});

test('cleanFmt rejects bad input', () => {
  assert.deepEqual(cleanFmt([[3, 1, null]], 3), [[3, 1, null]]);
  assert.equal(cleanFmt([[3, 1, null]], 4), null); // does not cover text
  assert.equal(cleanFmt([[3, 99, null]], 3), null); // unknown flag
  assert.equal(cleanFmt([[3, 1, 'javascript:x']], 3), null);
  assert.equal(cleanFmt('x', 3), null);
  assert.equal(cleanFmt(null, 3), null);
});

import { splitMessage, sliceFmt } from '../public/js/shared/richtext.js';

test('short messages are not split', () => {
  assert.deepEqual(splitMessage('hello', null, 50), [{ text: 'hello', fmt: null }]);
});

test('long messages split at sentence ends, then spaces', () => {
  const text = 'First sentence is here. Second sentence follows on. Third one closes it out.';
  const parts = splitMessage(text, null, 40);
  assert.ok(parts.length >= 2);
  assert.ok(parts.every((p) => p.text.length <= 40));
  assert.equal(parts.map((p) => p.text).join(' '), text);
  assert.ok(parts[0].text.endsWith('.'));
});

test('an enormous word is hard-cut', () => {
  const parts = splitMessage('x'.repeat(100), null, 30);
  assert.equal(parts.length, 4);
  assert.ok(parts.every((p) => p.text.length <= 30));
});

test('formatting follows its text across a split', () => {
  const r = parseMarkup('plain words here. [b]bold words after[/b]');
  const parts = splitMessage(r.text, r.fmt, 20);
  const bold = parts.find((p) => p.fmt && p.fmt.some(([, f]) => f === F.BOLD));
  assert.ok(bold);
  for (const p of parts) {
    if (p.fmt) assert.equal(p.fmt.reduce((n, [len]) => n + len, 0), p.text.length);
  }
});

test('sliceFmt returns null when the slice is plain', () => {
  assert.equal(sliceFmt([[3, 0, null], [3, 1, null]], 0, 3), null);
  assert.deepEqual(sliceFmt([[3, 0, null], [3, 1, null]], 2, 5), [[1, 0, null], [2, 1, null]]);
});
