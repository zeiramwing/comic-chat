// Reader for Microsoft Comic Chat .avb (avatar) and .bgb (backdrop) files.
//
// Format reverse-read from v2.5-beta-1-modern/avbfile.{h,cpp}. Everything is
// little-endian and byte-packed. A file is a header, a stream of tagged
// records, then (after AK_STARTDATA) resource data that the records point at
// by absolute file offset.
//
// This module only decodes. Compositing/atlas packing lives in convert-art.mjs.

import zlib from 'node:zlib';

export const AF_MAGIC_OLD = 0x81;
export const AF_MAGIC_NEW = 0x8181;
export const AT = { SIMPLE: 1, COMPLEX: 2, BACKDROP: 3 };
export const AIF = { DIB: 0, LZDEFLATE: 1 };
export const AIP = {
  NONE: 0,
  GLOBAL: 1,
  LOCAL: 2,
  MONO: 3,
  MASKEDMONO: 4,
  DUALMASK: 5,
};
export const AK = {
  NAME: 1, FLAGS: 2, ICON: 3, NFACES: 4, NTORSOS: 5, STARTDATA: 6, ENDDATA: 7,
  STYLE: 8, NBODIES: 9, NFACES2: 10, NTORSOS2: 11, NBODIES2: 12,
  ICON_NEW: 256, COLORPALETTE: 257, BACKDROP: 258, COPYRIGHT: 259,
  ORIGINAL_URL: 260, OVERRIDE_URL: 261, USAGE_FLAGS: 262, OFFSET_ADJUSTMENT: 263,
};
// Avatar flag bits (avatar.h).
export const FLAG = { HEADMASK: 1, TORSOMASK: 2, TORSOFIRST: 4, OTHERMAPPED: 8 };

const MONO_PALETTE = [[255, 255, 255], [0, 0, 0]];
const MAX_PALETTE = 2048;
const MAX_BUFFER = 2048 * 1024;

class Cursor {
  constructor(buf, pos = 0) {
    this.buf = buf;
    this.pos = pos;
  }
  need(n) {
    if (this.pos + n > this.buf.length) throw new Error(`read past end at ${this.pos}+${n}`);
  }
  u8() { this.need(1); return this.buf[this.pos++]; }
  u16() { this.need(2); const v = this.buf.readUInt16LE(this.pos); this.pos += 2; return v; }
  u32() { this.need(4); const v = this.buf.readUInt32LE(this.pos); this.pos += 4; return v; }
  i32() { this.need(4); const v = this.buf.readInt32LE(this.pos); this.pos += 4; return v; }
  bytes(n) { this.need(n); const b = this.buf.subarray(this.pos, this.pos + n); this.pos += n; return b; }
  // Mirrors CAvatarStream::ReadString: stops at NUL or when the buffer fills.
  cstr(max) {
    let s = '';
    let left = max;
    for (;;) {
      const c = this.u8();
      left -= 1;
      if (c === 0) break;
      s += String.fromCharCode(c);
      if (left <= 1) break;
    }
    return s;
  }
}

function readPalette(c) {
  const n = c.u16();
  if (n > MAX_PALETTE) throw new Error('palette too big');
  const pal = [];
  for (let i = 0; i < n; i++) pal.push([c.u8(), c.u8(), c.u8()]); // file order is R,G,B
  return pal;
}

// Record layouts, byte-packed. `old` records carry 16 padding bytes instead of
// the three format bytes + three palette-type bytes.
function readImageRefs(c, old) {
  const offsets = [c.u32(), c.u32(), c.u32()];
  return { offsets, old };
}

function readBodyRec(c, old) {
  const { offsets } = readImageRefs(c, old);
  const emotion = c.u16();
  const intensity = c.u8();
  const x = c.u16();
  const y = c.u16();
  return { offsets, emotion, intensity, x, y, ...readFormats(c, old) };
}

function readFaceRec(c, old) {
  const { offsets } = readImageRefs(c, old);
  const emotion = c.u16();
  const intensity = c.u8();
  const s16 = () => { const v = c.u16(); return v > 0x7fff ? v - 0x10000 : v; };
  const xCX = s16(), yCX = s16(), dX = s16(), dY = s16();
  const x = c.u16(), y = c.u16();
  return { offsets, emotion, intensity, xCX, yCX, dX, dY, x, y, ...readFormats(c, old) };
}

function readTorsoRec(c, old) {
  const { offsets } = readImageRefs(c, old);
  const emotion = c.u16();
  const intensity = c.u8();
  const s16 = () => { const v = c.u16(); return v > 0x7fff ? v - 0x10000 : v; };
  const xCX = s16(), yCX = s16();
  return { offsets, emotion, intensity, xCX, yCX, ...readFormats(c, old) };
}

function readFormats(c, old) {
  if (old) {
    c.bytes(16);
    return { formats: [AIF.DIB, 0, 0], palTypes: [AIP.NONE, 0, 0] };
  }
  const formats = [c.u8(), c.u8(), c.u8()];
  const palTypes = [c.u8(), c.u8(), c.u8()];
  return { formats, palTypes };
}

// Emotion table (avatario.cpp emFloats). Records store an index into it:
// 0 and 9 are 0.0 (neutral when intensity is 0), 1..8 are the eight wheel
// emotions at radians k*2pi/8 (happy, coy, bored, scared, sad, angry, shout,
// laugh), 10..17 are body gestures coded 1001..1008.
export const EM_NAMES = ['happy', 'coy', 'bored', 'scared', 'sad', 'angry', 'shout', 'laugh'];
export const GESTURES = {
  1001: 'wave', 1002: 'pointother', 1003: 'pointself', 1004: 'doublepoint',
  1005: 'shrug', 1006: '3qrwalk', 1007: 'sidewalk', 1008: '3qfwalk',
};
export function emotionFromRaw(raw) {
  if (raw >= 1 && raw <= 8) return (raw - 1) * 2 * Math.PI / 8;
  if (raw >= 10 && raw <= 17) return 1001 + (raw - 10);
  return 0;
}

/**
 * Parse an .avb/.bgb header. Returns metadata plus pose reference tables; call
 * decodePose() to turn a pose into pixels.
 */
export function parseAvb(buf) {
  const c = new Cursor(buf);
  const magic = c.u16();
  if (magic !== AF_MAGIC_OLD && magic !== AF_MAGIC_NEW) throw new Error('not an avatar file');
  const type = c.u16();
  const version = c.u16();
  if ((version >>> 16) !== 0) throw new Error('unsupported version');
  if (type !== AT.SIMPLE && type !== AT.COMPLEX && type !== AT.BACKDROP) {
    throw new Error(`invalid avatar type ${type}`);
  }

  const av = {
    type, version, name: '', flags: 0, style: 0, copyright: '', url: '',
    palette: [], icon: null, bodies: [], faces: [], torsos: [], poses: [],
    backdrop: null,
  };
  let adjust = 0;
  const adj = (o) => (o ? o + adjust : o);

  // Pose table, de-duplicated the same way the C++ does it: a record whose
  // image offset equals the previous record's reuses that record's pose.
  const makePose = (offsets, formats, palTypes) => {
    av.poses.push({
      offsets: offsets.map(adj),
      formats: [...formats],
      palTypes: [...palTypes],
    });
    return av.poses.length; // 1-based, like the C++ (0 = INVALID_POSE_ID)
  };
  const readRecs = (count, reader, old, store) => {
    let prev = 0;
    let prevId = 0;
    for (let i = 0; i < count; i++) {
      const r = reader(c, old);
      if (r.offsets[0] !== prev) {
        r.poseId = makePose(r.offsets, r.formats, r.palTypes);
        prev = r.offsets[0];
        prevId = r.poseId;
      } else {
        r.poseId = prevId;
      }
      store.push(r);
    }
  };

  for (;;) {
    const tag = c.u16();
    let size = 0;
    if (tag >= AK.ICON_NEW) size = c.u16();
    if (tag === AK.STARTDATA) break;

    switch (tag) {
      case AK.NAME: av.name = c.cstr(60); break;
      case AK.ORIGINAL_URL: av.url = c.cstr(512); break;
      case AK.OVERRIDE_URL: c.cstr(512); break;
      case AK.COPYRIGHT: av.copyright = c.cstr(256); break;
      case AK.STYLE: av.style = c.u16() & 0xff; break;
      case AK.FLAGS: av.flags = c.u16() & 0xff; break;
      case AK.USAGE_FLAGS: c.u8(); break;
      case AK.ICON: {
        const off = c.u32();
        av.icon = makePose([off, 0, 0], [AIF.DIB, 0, 0], [AIP.NONE, 0, 0]);
        break;
      }
      case AK.ICON_NEW: {
        const off = c.u32();
        const fmt = c.u8();
        const pal = c.u8();
        av.icon = makePose([off, 0, 0], [fmt, 0, 0], [pal, 0, 0]);
        break;
      }
      case AK.COLORPALETTE: av.palette = readPalette(c); break;
      case AK.OFFSET_ADJUSTMENT: adjust += c.i32(); break;
      case AK.NBODIES:
      case AK.NBODIES2:
        if (type !== AT.SIMPLE) throw new Error('body record in non-simple avatar');
        readRecs(c.u16(), readBodyRec, tag === AK.NBODIES, av.bodies);
        break;
      case AK.NFACES:
      case AK.NFACES2:
        readRecs(c.u16(), readFaceRec, tag === AK.NFACES, av.faces);
        break;
      case AK.NTORSOS:
      case AK.NTORSOS2:
        readRecs(c.u16(), readTorsoRec, tag === AK.NTORSOS, av.torsos);
        break;
      case AK.BACKDROP: {
        const off = c.u32();
        const fmt = c.u8();
        const pal = c.u8();
        if (pal !== AIP.LOCAL && pal !== AIP.NONE) throw new Error('backdrop palette type');
        av.backdrop = { offset: adj(off), format: fmt, palType: pal };
        break;
      }
      default:
        if (tag >= AK.ICON_NEW) c.pos += size;
        else throw new Error(`unrecognised old tag ${tag}`);
    }
  }
  return av;
}

// ---------------------------------------------------------------------------
// Image decoding

// Result: { w, h, bpp, pal: [[r,g,b]...], idx: Uint8Array (top-down, one byte
// per pixel, palette index) } or, for 24/32 bpp, { rgb: Uint8Array(w*h*3) }.

const storageWidth = (w, bpp) => (((w * bpp + 31) >> 5) << 2);

function unpackIndices(bits, w, h, bpp, bottomUp) {
  const stride = storageWidth(w, bpp);
  const idx = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const srcRow = (bottomUp ? h - 1 - y : y) * stride;
    for (let x = 0; x < w; x++) {
      let v;
      if (bpp === 8) v = bits[srcRow + x];
      else if (bpp === 4) v = (bits[srcRow + (x >> 1)] >> ((x & 1) ? 0 : 4)) & 0xf;
      else if (bpp === 2) v = (bits[srcRow + (x >> 2)] >> (6 - 2 * (x & 3))) & 3;
      else if (bpp === 1) v = (bits[srcRow + (x >> 3)] >> (7 - (x & 7))) & 1;
      else throw new Error(`unsupported bpp ${bpp}`);
      idx[y * w + x] = v;
    }
  }
  return idx;
}

function decodeRle(data, w, h, bpp) {
  // Output is an uncompressed, bottom-up, DWORD-aligned buffer like BI_RGB.
  const stride = storageWidth(w, bpp);
  const out = new Uint8Array(stride * h);
  let x = 0, y = 0, p = 0;
  const put = (px, py, v) => {
    if (px >= w || py >= h) return;
    if (bpp === 8) out[py * stride + px] = v;
    else out[py * stride + (px >> 1)] |= (px & 1) ? v : v << 4;
  };
  while (p < data.length) {
    const n = data[p++];
    const v = data[p++];
    if (n > 0) {
      for (let i = 0; i < n; i++) {
        const val = bpp === 8 ? v : (i & 1) ? v & 0xf : v >> 4;
        put(x++, y, val);
      }
    } else if (v === 0) { x = 0; y++; }
    else if (v === 1) break;
    else if (v === 2) { x += data[p++]; y += data[p++]; }
    else {
      const count = v;
      for (let i = 0; i < count; i++) {
        let val;
        if (bpp === 8) val = data[p + i];
        else { const b = data[p + (i >> 1)]; val = (i & 1) ? b & 0xf : b >> 4; }
        put(x++, y, val);
      }
      const bytes = bpp === 8 ? count : (count + 1) >> 1;
      p += bytes + (bytes & 1);
    }
  }
  return out;
}

function finishDib(info, tableRgb, bits) {
  const { w, h, bpp, bottomUp, compression } = info;
  if (bpp > 8) {
    if (bpp !== 24 && bpp !== 32) throw new Error(`unsupported bpp ${bpp}`);
    const stride = storageWidth(w, bpp);
    const bytes = bpp / 8;
    const rgb = new Uint8Array(w * h * 3);
    for (let y = 0; y < h; y++) {
      const row = (bottomUp ? h - 1 - y : y) * stride;
      for (let x = 0; x < w; x++) {
        const o = row + x * bytes;
        const d = (y * w + x) * 3;
        rgb[d] = bits[o + 2]; rgb[d + 1] = bits[o + 1]; rgb[d + 2] = bits[o];
      }
    }
    return { w, h, bpp, rgb };
  }
  let data = bits;
  if (compression === 1 || compression === 2) data = decodeRle(bits, w, h, compression === 1 ? 8 : 4);
  const idx = unpackIndices(data, w, h, bpp, bottomUp);
  return { w, h, bpp, pal: tableRgb, idx };
}

export function decodeBmpAt(buf, off) {
  const c = new Cursor(buf, off);
  if (c.u16() !== 0x4d42) throw new Error('not a BMP');
  const bfSize = c.u32();
  c.u32(); // reserved
  const bfOffBits = c.u32();
  const hdrSize = c.u32();
  let w, h, planes, bpp, compression = 0, clrUsed = 0;
  if (hdrSize === 12) {
    w = c.u16(); h = c.u16(); planes = c.u16(); bpp = c.u16();
  } else {
    w = c.i32(); h = c.i32(); planes = c.u16(); bpp = c.u16();
    compression = c.u32();
    c.u32(); c.i32(); c.i32(); clrUsed = c.u32(); c.u32();
    c.pos = off + 14 + hdrSize;
  }
  void planes;
  if (bpp === 0) throw new Error('bad bpp');
  const bottomUp = h > 0;
  h = Math.abs(h);
  const colors = bpp <= 8 ? (clrUsed || (1 << bpp)) : 0;
  const pal = [];
  for (let i = 0; i < colors; i++) {
    if (hdrSize === 12) { const b = c.u8(), g = c.u8(), r = c.u8(); pal.push([r, g, b]); }
    else { const b = c.u8(), g = c.u8(), r = c.u8(); c.u8(); pal.push([r, g, b]); }
  }
  const bitsLen = bfSize - bfOffBits;
  const bits = buf.subarray(off + bfOffBits, off + bfOffBits + bitsLen);
  return finishDib({ w, h, bpp, bottomUp, compression }, pal, bits);
}

function paletteFor(c, palType, globalPal) {
  switch (palType) {
    case AIP.NONE: return null;
    case AIP.GLOBAL: return globalPal;
    case AIP.LOCAL: {
      const tag = c.u16();
      c.u16(); // size
      if (tag !== AK.COLORPALETTE) throw new Error('no local palette');
      return readPalette(c);
    }
    case AIP.MONO: return MONO_PALETTE;
    case AIP.MASKEDMONO:
    case AIP.DUALMASK:
      return [[255, 255, 255], [0, 0, 0], [128, 0, 0], [0, 0, 128]];
    default: throw new Error(`palette type ${palType}`);
  }
}

function decodeZlibAt(buf, off, palType, globalPal) {
  const c = new Cursor(buf, off);
  const pal = paletteFor(c, palType, globalPal) ?? [];
  const hdrSize = c.u32();
  if (hdrSize < 40 || hdrSize > 240) throw new Error('bad info header size');
  const hdr = Buffer.concat([Buffer.alloc(4), c.bytes(hdrSize - 4)]);
  const w = hdr.readInt32LE(4);
  let h = hdr.readInt32LE(8);
  const bpp = hdr.readUInt16LE(14);
  const compression = hdr.readUInt32LE(16);
  if (bpp === 0) throw new Error('bad bpp');
  const bottomUp = h > 0;
  h = Math.abs(h);
  const uncompressed = c.u32();
  const compressed = c.u32();
  if (uncompressed === 0) throw new Error('empty image');
  if (uncompressed > MAX_BUFFER || compressed > MAX_BUFFER) throw new Error('buffer too big');
  const bits = zlib.inflateSync(c.bytes(compressed));
  if (bits.length !== storageWidth(w, bpp) * h) throw new Error('image size mismatch');
  return finishDib({ w, h, bpp, bottomUp, compression }, pal, bits);
}

export function decodeImage(buf, offset, format, palType, globalPal) {
  if (format === AIF.DIB) return decodeBmpAt(buf, offset);
  if (format === AIF.LZDEFLATE) return decodeZlibAt(buf, offset, palType, globalPal);
  throw new Error(`image format ${format}`);
}

/**
 * Decode a pose into three optional layers: drawing (colour), mask, aura. A
 * layer is { w, h, pal, idx } as above. Handles the two packed 2-bpp variants
 * exactly like CPose::ConvertMasksCommon.
 */
export function decodePose(buf, pose, globalPal) {
  const layers = [null, null, null];
  for (let i = 0; i < 3; i++) {
    if (pose.offsets[i] === 0) continue;
    layers[i] = decodeImage(buf, pose.offsets[i], pose.formats[i], pose.palTypes[i], globalPal);
  }
  const unpack = (img, fn) => {
    const out = new Uint8Array(img.w * img.h);
    for (let i = 0; i < out.length; i++) out[i] = fn(img.idx[i]) ? 1 : 0;
    return { w: img.w, h: img.h, pal: MONO_PALETTE, idx: out };
  };
  if (pose.palTypes[0] === AIP.MASKEDMONO && layers[0]) {
    // v: 0 blank, 1 aura only, 2 white fill, 3 black ink. After the original's
    // `image &= mask`, ink is v==3, mask (silhouette) is v>=2, aura is v!=0.
    const src = layers[0];
    return [
      unpack(src, (v) => v === 3),
      unpack(src, (v) => v >= 2),
      unpack(src, (v) => v !== 0),
    ];
  }
  if (pose.palTypes[1] === AIP.DUALMASK && layers[1]) {
    const src = layers[1];
    return [layers[0], unpack(src, (v) => (v & 1) !== 0), unpack(src, (v) => (v & 2) !== 0)];
  }
  return layers;
}

/** Decode a backdrop file (.bgb avatar-format, or a plain BMP). */
export function decodeBackdrop(buf) {
  if (buf.readUInt16LE(0) === 0x4d42) return { image: decodeBmpAt(buf, 0), meta: {} };
  const av = parseAvb(buf);
  if (av.type !== AT.BACKDROP || !av.backdrop) throw new Error('not a backdrop');
  const { offset, format, palType } = av.backdrop;
  return {
    image: decodeImage(buf, offset, format, palType, av.palette),
    meta: { copyright: av.copyright, url: av.url },
  };
}
