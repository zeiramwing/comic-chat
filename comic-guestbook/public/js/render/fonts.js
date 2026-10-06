// Font handling shared by layout (measuring) and drawing.
//
// Balloon layout depends on text widths, so every viewer must lay text out with
// the same font. We bundle Comic Neue and wait for it before measuring.

import { F } from '../shared/richtext.js';

export const FAMILY = '"Comic Neue", "Comic Sans MS", "Chalkboard SE", "Marker Felt", cursive, sans-serif';
export const FIXED_FAMILY = '"Courier New", Courier, monospace';

const FACES = [
  ['400', 'normal', 'comic-neue-latin-400-normal.woff2'],
  ['400', 'italic', 'comic-neue-latin-400-italic.woff2'],
  ['700', 'normal', 'comic-neue-latin-700-normal.woff2'],
  ['700', 'italic', 'comic-neue-latin-700-italic.woff2'],
];

let loading = null;

/** Load the bundled font once; resolves even if it fails (we fall back). */
export function loadFonts(base = '/fonts/') {
  if (loading) return loading;
  loading = (async () => {
    try {
      const faces = FACES.map(([weight, style, file]) => {
        const face = new FontFace('Comic Neue', `url(${base}${file}) format("woff2")`, { weight, style });
        document.fonts.add(face);
        return face.load();
      });
      await Promise.all(faces);
    } catch {
      /* fall back to system comic fonts */
    }
  })();
  return loading;
}

export function fontString(flags, px) {
  const family = (flags & F.FIXED) ? FIXED_FAMILY : FAMILY;
  return `${(flags & F.ITALIC) ? 'italic ' : ''}${(flags & F.BOLD) ? '700 ' : '400 '}${px}px ${family}`;
}

let mctx = null;
const cache = new Map();

/** measure(flags, px, text) for wrapText. Cached; px is in layout units. */
export function measure(flags, px, text) {
  if (!mctx) mctx = new OffscreenCanvas(8, 8).getContext('2d');
  // Measure at a fixed large size and scale: stable across zoom levels.
  const key = `${flags & 25}|${text}`;
  let w = cache.get(key);
  if (w === undefined) {
    mctx.font = fontString(flags, 100);
    w = mctx.measureText(text).width / 100;
    if (cache.size > 20000) cache.clear();
    cache.set(key, w);
  }
  return w * px;
}
