#!/usr/bin/env node
// Converts Microsoft Comic Chat art (.avb characters, .bgb backdrops) into web
// assets: one PNG sprite atlas (+ one white "aura" halo atlas) per character, one
// JSON per character, and one PNG per backdrop.
//
//   node tools/convert-art.mjs [--out public/art] <dir-or-file>...
//
// Defaults to the art shipped in ../v2.5-beta-1-modern (comicart + artpack1).
//
// Compositing follows bodycam.cpp (CBodyDouble::DrawBody / CBodySingle::DrawBody):
// the original draws the aura with MERGEPAINT (a white halo), then for each
// part the mask with MERGEPAINT (silhouette -> white) and the drawing with
// SRCAND (so white drawing pixels are transparent when no mask is used).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseAvb, decodePose, decodeBackdrop, decodeBmpAt, emotionFromRaw, AT, FLAG,
} from './avb.mjs';
import { encodeRGBA, encodeIndexed } from './png.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const rgbAt = (img, i) => {
  if (img.rgb) return [img.rgb[i * 3], img.rgb[i * 3 + 1], img.rgb[i * 3 + 2]];
  return img.pal[img.idx[i]] ?? [0, 0, 0];
};
const isBlack = (c) => (c[0] + c[1] + c[2]) < 384; // average < 128
const isWhite = (c) => c[0] === 255 && c[1] === 255 && c[2] === 255;

/**
 * Bake one pose into { w, h, ink: RGBA, halo: RGBA|null }.
 * useMask: whether the mask silhouette should define opacity (head/torso flag).
 */
export function bakePose(layers, useMask) {
  const [draw, mask, aura] = layers;
  if (!draw) return null;
  const { w, h } = draw;
  const ink = new Uint8Array(w * h * 4);
  const maskOK = useMask && mask && mask.w === w && mask.h === h;
  for (let i = 0; i < w * h; i++) {
    const c = rgbAt(draw, i);
    const opaque = maskOK ? isBlack(rgbAt(mask, i)) : !isWhite(c);
    if (!opaque) continue;
    ink[i * 4] = c[0]; ink[i * 4 + 1] = c[1]; ink[i * 4 + 2] = c[2]; ink[i * 4 + 3] = 255;
  }
  let halo = null;
  if (aura && aura.w === w && aura.h === h) {
    halo = new Uint8Array(w * h * 4);
    let any = false;
    for (let i = 0; i < w * h; i++) {
      if (isBlack(rgbAt(aura, i))) {
        halo[i * 4] = halo[i * 4 + 1] = halo[i * 4 + 2] = 255;
        halo[i * 4 + 3] = 255;
        any = true;
      }
    }
    if (!any) halo = null;
  }
  return { w, h, ink, halo };
}

/** Shelf-pack sprites into one atlas. Returns { w, h, place: Map(key -> {x,y}) }. */
export function packSprites(items, maxWidth = 1024, pad = 2) {
  const sorted = [...items].sort((a, b) => b.h - a.h || b.w - a.w);
  const place = new Map();
  let x = 0, y = 0, rowH = 0, usedW = 0;
  for (const it of sorted) {
    if (x + it.w + pad > maxWidth) { x = 0; y += rowH + pad; rowH = 0; }
    place.set(it.key, { x, y });
    x += it.w + pad;
    rowH = Math.max(rowH, it.h);
    usedW = Math.max(usedW, x);
  }
  return { w: Math.max(usedW, 1), h: y + rowH, place };
}

function blit(dst, dw, src, sw, sh, ox, oy) {
  for (let y = 0; y < sh; y++) {
    dst.set(src.subarray(y * sw * 4, (y + 1) * sw * 4), ((oy + y) * dw + ox) * 4);
  }
}

const round3 = (n) => Math.round(n * 1000) / 1000;

export function convertAvatar(buf, id, pack) {
  const av = parseAvb(buf);
  if (av.type === AT.BACKDROP) throw new Error('backdrop, not avatar');
  const simple = av.type === AT.SIMPLE;

  // Which role each pose plays decides whether the mask is honoured.
  const roles = new Map(); // key -> { poseId, role }
  const claim = (role, poseId) => roles.set(`${role}${poseId}`, { poseId, role });
  av.bodies.forEach((r) => claim('b', r.poseId));
  av.faces.forEach((r) => claim('f', r.poseId));
  av.torsos.forEach((r) => claim('t', r.poseId));
  if (av.icon) claim('i', av.icon);

  const baked = [];
  const cache = new Map(); // poseId -> decoded layers
  for (const [key, { poseId, role }] of roles) {
    const pose = av.poses[poseId - 1];
    if (!cache.has(poseId)) cache.set(poseId, decodePose(buf, pose, av.palette));
    const layers = cache.get(poseId);
    let useMask = false;
    if (role === 'f') useMask = (av.flags & FLAG.HEADMASK) !== 0;
    if (role === 't') useMask = (av.flags & FLAG.TORSOMASK) !== 0;
    let b;
    if (role === 'i') {
      // Icons are plain opaque pictures.
      const d = layers[0];
      const ink = new Uint8Array(d.w * d.h * 4);
      for (let i = 0; i < d.w * d.h; i++) {
        const c = rgbAt(d, i);
        ink[i * 4] = c[0]; ink[i * 4 + 1] = c[1]; ink[i * 4 + 2] = c[2]; ink[i * 4 + 3] = 255;
      }
      b = { w: d.w, h: d.h, ink, halo: null };
    } else {
      b = bakePose(layers, useMask);
    }
    if (b) baked.push({ key, ...b });
  }

  const packed = packSprites(baked.map((b) => ({ key: b.key, w: b.w, h: b.h })));
  const inkAtlas = new Uint8Array(packed.w * packed.h * 4);
  const haloAtlas = new Uint8Array(packed.w * packed.h * 4);
  const sprites = {};
  let hasHalo = false;
  for (const b of baked) {
    const { x, y } = packed.place.get(b.key);
    blit(inkAtlas, packed.w, b.ink, b.w, b.h, x, y);
    if (b.halo) { blit(haloAtlas, packed.w, b.halo, b.w, b.h, x, y); hasHalo = true; }
    sprites[b.key] = [x, y, b.w, b.h];
  }

  const meta = {
    id,
    name: prettyName(av.name || id),
    pack,
    type: simple ? 'simple' : 'complex',
    flags: av.flags,
    copyright: av.copyright || undefined,
    atlas: `${id}.png`,
    halo: hasHalo ? `${id}.halo.png` : undefined,
    size: [packed.w, packed.h],
    icon: av.icon ? `i${av.icon}` : undefined,
    sprites,
  };
  const em = (r) => ({ e: round3(emotionFromRaw(r.emotion)), i: round3(r.intensity / 255) });
  if (simple) {
    meta.bodies = av.bodies.map((r) => ({ p: `b${r.poseId}`, ...em(r), fx: r.x & 0xff, fy: r.y & 0xff }));
  } else {
    meta.faces = av.faces.map((r) => ({
      p: `f${r.poseId}`, ...em(r), cx: r.xCX, cy: r.yCX, dx: r.dX, dy: r.dY, fx: r.x & 0xff, fy: r.y & 0xff,
    }));
    meta.torsos = av.torsos.map((r) => ({ p: `t${r.poseId}`, ...em(r), cx: r.xCX, cy: r.yCX }));
  }
  return {
    meta,
    inkPng: encodeRGBA(packed.w, packed.h, inkAtlas),
    haloPng: hasHalo ? encodeRGBA(packed.w, packed.h, haloAtlas) : null,
  };
}

export function convertBackdrop(buf, id, pack) {
  const { image, meta } = decodeBackdrop(buf);
  let png;
  if (image.rgb) {
    const rgba = new Uint8Array(image.w * image.h * 4);
    for (let i = 0; i < image.w * image.h; i++) {
      rgba[i * 4] = image.rgb[i * 3]; rgba[i * 4 + 1] = image.rgb[i * 3 + 1];
      rgba[i * 4 + 2] = image.rgb[i * 3 + 2]; rgba[i * 4 + 3] = 255;
    }
    png = encodeRGBA(image.w, image.h, rgba);
  } else {
    png = encodeIndexed(image.w, image.h, image.idx, image.pal);
  }
  return {
    meta: { id, name: prettyName(id), pack, w: image.w, h: image.h, file: `${id}.png`, copyright: meta.copyright || undefined },
    png,
  };
}

function prettyName(s) {
  const t = s.trim();
  return t === t.toUpperCase() ? t[0] + t.slice(1).toLowerCase() : t;
}

// The nine emotion-wheel face icons (res/fc_*_l.bmp), in wheel order: happy,
// coy, bored, scared, sad, angry, shout, laugh, neutral. Their flat gray
// (210,210,210) background is keyed out.
export function convertEmotionIcons(resDir) {
  const names = ['hap', 'coy', 'bor', 'sca', 'sad', 'ang', 'sho', 'laf', 'neu'];
  const icons = names.map((n) => decodeBmpAt(fs.readFileSync(path.join(resDir, `fc_${n}_l.bmp`)), 0));
  const { w, h } = icons[0];
  const rgba = new Uint8Array(w * icons.length * h * 4);
  icons.forEach((im, k) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = im.pal[im.idx[y * w + x]];
        const o = (y * w * icons.length + k * w + x) * 4;
        if (c[0] === 210 && c[1] === 210 && c[2] === 210) continue;
        rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255;
      }
    }
  });
  return { w, h, count: icons.length, png: encodeRGBA(w * icons.length, h, rgba) };
}

function walk(p) {
  const st = fs.statSync(p);
  if (st.isFile()) return [p];
  return fs.readdirSync(p).sort().flatMap((f) => walk(path.join(p, f)));
}

function main() {
  const args = process.argv.slice(2);
  let out = path.join(HERE, '..', 'public', 'art');
  const inputs = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out') out = path.resolve(args[++i]);
    else inputs.push(path.resolve(args[i]));
  }
  if (!inputs.length) {
    const base = path.join(HERE, '..', '..', 'v2.5-beta-1-modern');
    inputs.push(path.join(base, 'comicart'), path.join(base, 'artpack1'));
  }

  const charDir = path.join(out, 'characters');
  const bdDir = path.join(out, 'backdrops');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(charDir, { recursive: true });
  fs.mkdirSync(bdDir, { recursive: true });

  const characters = [];
  const backdrops = [];
  const seen = new Set();
  const files = inputs.flatMap(walk)
    .filter((f) => /\.(avb|bgb)$/i.test(f) && !f.includes(`${path.sep}archive${path.sep}`));
  let bytes = 0;
  for (const f of files) {
    const stem = path.basename(f).replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const pack = path.basename(path.dirname(f));
    let id = stem;
    if (seen.has(`${path.extname(f).toLowerCase()}:${id}`)) id = `${stem}-${pack}`;
    seen.add(`${path.extname(f).toLowerCase()}:${stem}`);
    try {
      const buf = fs.readFileSync(f);
      if (/\.bgb$/i.test(f)) {
        const r = convertBackdrop(buf, id, pack);
        fs.writeFileSync(path.join(bdDir, r.meta.file), r.png);
        backdrops.push(r.meta);
        bytes += r.png.length;
      } else {
        const r = convertAvatar(buf, id, pack);
        fs.writeFileSync(path.join(charDir, r.meta.atlas), r.inkPng);
        if (r.haloPng) fs.writeFileSync(path.join(charDir, r.meta.halo), r.haloPng);
        fs.writeFileSync(path.join(charDir, `${id}.json`), JSON.stringify(r.meta));
        const [x, y, w, h] = r.meta.sprites[r.meta.icon] ?? [0, 0, 0, 0];
        characters.push({
          id, name: r.meta.name, pack, type: r.meta.type,
          icon: { x, y, w, h },
        });
        bytes += r.inkPng.length + (r.haloPng?.length ?? 0);
      }
    } catch (e) {
      console.error(`skip ${f}: ${e.message}`);
    }
  }
  const resDir = path.join(HERE, '..', '..', 'v2.5-beta-1-modern', 'res');
  const ui = { };
  if (fs.existsSync(path.join(resDir, 'fc_hap_l.bmp'))) {
    const e = convertEmotionIcons(resDir);
    fs.mkdirSync(path.join(out, 'ui'), { recursive: true });
    fs.writeFileSync(path.join(out, 'ui', 'emotions.png'), e.png);
    ui.emotions = { file: 'ui/emotions.png', w: e.w, h: e.h, count: e.count };
  }
  fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify({ characters, backdrops, ui }, null, 1));
  console.log(`${characters.length} characters, ${backdrops.length} backdrops, ${(bytes / 1024).toFixed(0)} KiB of PNG -> ${out}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
