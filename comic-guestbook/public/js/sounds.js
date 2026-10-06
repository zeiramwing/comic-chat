// Small synthesised sounds (no audio files to load). Browsers only allow audio
// after a user gesture, so the AudioContext is created lazily on first use and
// every call is wrapped: sound must never break the page.

import { state } from './state.js';

let ctx = null;

function context() {
  if (!ctx) {
    const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone(c, freq, start, dur, { type = 'triangle', gain = 0.12 } = {}) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, c.currentTime + start);
  g.gain.setValueAtTime(0.0001, c.currentTime + start);
  g.gain.exponentialRampToValueAtTime(gain, c.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  o.connect(g).connect(c.destination);
  o.start(c.currentTime + start);
  o.stop(c.currentTime + start + dur + 0.05);
}

export const SOUNDS = {
  /** Someone else signed. */
  entry: (c) => { tone(c, 660, 0, 0.12); tone(c, 880, 0.1, 0.16); },
  /** A favorite signed, or you were mentioned. */
  attention: (c) => { tone(c, 784, 0, 0.12); tone(c, 988, 0.11, 0.12); tone(c, 1318, 0.22, 0.2); },
  /** The classic system beep. */
  beep: (c) => { tone(c, 440, 0, 0.18, { type: 'square', gain: 0.07 }); },
  /** You signed. */
  sent: (c) => { tone(c, 520, 0, 0.07, { gain: 0.08 }); },
  error: (c) => { tone(c, 220, 0, 0.2, { type: 'sawtooth', gain: 0.06 }); },
};

export function play(name, { force = false } = {}) {
  if (!force && !state.prefs.sounds) return;
  try {
    const c = context();
    if (c) SOUNDS[name]?.(c);
  } catch { /* ignore */ }
}

/** Beep n times (the "Beep" rule action). */
export function beep(times = 1) {
  const n = Math.max(1, Math.min(5, times | 0));
  for (let i = 0; i < n; i++) setTimeout(() => play('beep'), i * 260);
}
