// Minimal PNG encoder (no dependencies). Supports 8-bit RGBA and 8-bit indexed.
import zlib from 'node:zlib';

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

function ihdr(w, h, colorType) {
  const b = Buffer.alloc(13);
  b.writeUInt32BE(w, 0);
  b.writeUInt32BE(h, 4);
  b[8] = 8; // bit depth
  b[9] = colorType;
  return chunk('IHDR', b);
}

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Sub filter (type 1) per row: cheap and compresses these flat images well.
function filterRows(raw, w, h, bpp) {
  const stride = w * bpp;
  const out = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (stride + 1);
    out[o] = 1;
    for (let i = 0; i < stride; i++) {
      const left = i >= bpp ? raw[y * stride + i - bpp] : 0;
      out[o + 1 + i] = (raw[y * stride + i] - left) & 0xff;
    }
  }
  return out;
}

/** rgba: Uint8Array/Buffer of w*h*4. */
export function encodeRGBA(w, h, rgba) {
  const data = zlib.deflateSync(filterRows(rgba, w, h, 4), { level: 9 });
  return Buffer.concat([SIG, ihdr(w, h, 6), chunk('IDAT', data), chunk('IEND', Buffer.alloc(0))]);
}

/** idx: one palette index per pixel; pal: [[r,g,b]...] (<=256). */
export function encodeIndexed(w, h, idx, pal) {
  const plte = Buffer.alloc(pal.length * 3);
  pal.forEach((c, i) => { plte[i * 3] = c[0]; plte[i * 3 + 1] = c[1]; plte[i * 3 + 2] = c[2]; });
  const data = zlib.deflateSync(filterRows(idx, w, h, 1), { level: 9 });
  return Buffer.concat([SIG, ihdr(w, h, 3), chunk('PLTE', plte), chunk('IDAT', data), chunk('IEND', Buffer.alloc(0))]);
}

/** Minimal decoder for our own output (used by tests): returns {w,h,rgba}. */
export function decodePNG(buf) {
  let p = 8;
  let w = 0, h = 0, colorType = 0;
  const idat = [];
  let plte = null;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === 'PLTE') plte = data;
    else if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = colorType === 6 ? 4 : 1;
  const stride = w * bpp;
  const px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const left = i >= bpp ? px[y * stride + i - bpp] : 0;
      const up = y > 0 ? px[(y - 1) * stride + i] : 0;
      const ul = y > 0 && i >= bpp ? px[(y - 1) * stride + i - bpp] : 0;
      const v = raw[y * (stride + 1) + 1 + i];
      let a = 0;
      if (f === 1) a = left;
      else if (f === 2) a = up;
      else if (f === 3) a = (left + up) >> 1;
      else if (f === 4) {
        const pa = Math.abs(up - ul), pb = Math.abs(left - ul), pc = Math.abs(left + up - 2 * ul);
        a = pa <= pb && pa <= pc ? left : pb <= pc ? up : ul;
      }
      px[y * stride + i] = (v + a) & 0xff;
    }
  }
  if (colorType === 6) return { w, h, rgba: px };
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = plte[px[i] * 3]; rgba[i * 4 + 1] = plte[px[i] * 3 + 1];
    rgba[i * 4 + 2] = plte[px[i] * 3 + 2]; rgba[i * 4 + 3] = 255;
  }
  return { w, h, rgba };
}
