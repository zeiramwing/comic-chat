// Draws a scene (shared/scene.js) onto a canvas 2D context.
//
// Balloon styles follow Microsoft Chat's four kinds: speech (say), thought
// (think: a cloud with a trail of bubbles), whisper (speech, dashed) and a
// rectangular narration box (action).

import { F } from '../shared/richtext.js';
import { toSymbolFont } from '../shared/textwrap.js';
import { U } from '../shared/scene.js';
import { fontString } from './fonts.js';
import { prng } from '../shared/layout.js';

const INK = '#111';
const BORDER = 2.6; // panel units

// ---------------------------------------------------------------------------
// Smooth closed curve through points (quadratic through midpoints).
function smoothClosed(ctx, pts) {
  const n = pts.length;
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const start = mid(pts[n - 1], pts[0]);
  ctx.moveTo(start[0], start[1]);
  for (let i = 0; i < n; i++) {
    const m = mid(pts[i], pts[(i + 1) % n]);
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]);
  }
  ctx.closePath();
}

/** A hand-drawn-ish rounded balloon outline as points. */
export function balloonOutline(b, seed) {
  const rand = prng(seed ^ Math.round(b.x * 7 + b.y * 13));
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const rx = b.w / 2 * 1.04;
  const ry = b.h / 2 * 1.06;
  const N = 40;
  const n = 3.1; // superellipse exponent: between an ellipse and a rectangle
  const pts = [];
  let wob = 0;
  for (let k = 0; k < N; k++) {
    const t = (k / N) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    wob = wob * 0.55 + (rand() - 0.5) * 0.045;
    const f = 1 + wob;
    pts.push([
      cx + rx * f * Math.sign(c) * Math.abs(c) ** (2 / n),
      cy + ry * f * Math.sign(s) * Math.abs(s) ** (2 / n),
    ]);
  }
  return { pts, cx, cy, rx, ry, n };
}

/** y of the balloon's lower edge at x (superellipse). */
function bottomEdgeAt(o, x) {
  const u = Math.min(0.98, Math.abs((x - o.cx) / o.rx));
  return o.cy + o.ry * (1 - u ** o.n) ** (1 / o.n);
}

function drawTail(ctx, b, o, dashed) {
  const { baseX, tipX, tipY } = b.tail;
  const baseY = bottomEdgeAt(o, baseX) - 3;
  const half = Math.max(9, Math.min(22, b.w * 0.07));
  const dx = tipX - baseX;
  const mx = baseX + dx * 0.35;
  const my = baseY + (tipY - baseY) * 0.55;
  ctx.beginPath();
  ctx.moveTo(baseX - half, baseY);
  ctx.quadraticCurveTo(mx - half * 0.2, my, tipX, tipY);
  ctx.quadraticCurveTo(mx + half * 0.5, my, baseX + half, baseY);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.setLineDash(dashed ? [9, 7] : []);
  // Stroke the two sides only so the join with the balloon stays open.
  ctx.beginPath();
  ctx.moveTo(baseX - half, baseY - 1);
  ctx.quadraticCurveTo(mx - half * 0.2, my, tipX, tipY);
  ctx.quadraticCurveTo(mx + half * 0.5, my, baseX + half, baseY - 1);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawCloud(ctx, b, seed) {
  const rand = prng(seed ^ Math.round(b.x * 5 + b.y * 11));
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const rx = b.w / 2;
  const ry = b.h / 2;
  const bumps = Math.max(8, Math.round(Math.PI * (rx + ry) / (b.px * 0.95)));
  const pts = [];
  const ctrl = [];
  for (let k = 0; k < bumps; k++) {
    const t0 = (k / bumps) * Math.PI * 2;
    const t1 = ((k + 1) / bumps) * Math.PI * 2;
    const tm = (t0 + t1) / 2;
    const p = (t, f = 1) => [cx + rx * f * Math.cos(t), cy + ry * f * Math.sin(t)];
    pts.push(p(t0));
    ctrl.push(p(tm, 1.22 + (rand() - 0.5) * 0.08));
  }
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let k = 0; k < bumps; k++) {
    const nxt = pts[(k + 1) % bumps];
    ctx.quadraticCurveTo(ctrl[k][0], ctrl[k][1], nxt[0], nxt[1]);
  }
  ctx.closePath();
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.stroke();
}

function drawThoughtTrail(ctx, b) {
  const { baseX, tipX, tipY } = b.tail;
  const cy = b.y + b.h;
  const sizes = [0.34, 0.24, 0.15];
  const along = [0.3, 0.6, 0.86];
  sizes.forEach((r, i) => {
    const x = baseX + (tipX - baseX) * along[i];
    const y = cy + (tipY - cy) * along[i] * 0.9 + 6;
    ctx.beginPath();
    ctx.arc(x, y, b.px * r, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.stroke();
  });
}

function drawBalloonText(ctx, b) {
  b.lines.forEach((line, i) => {
    let x = b.x + (b.w - line.width) / 2;
    const base = b.y + b.pad + (i + 0.5) * b.lineH + b.px * 0.3;
    for (const run of line.runs) {
      ctx.font = fontString(run.flags, b.px);
      ctx.fillStyle = run.color || INK;
      const text = (run.flags & F.SYMBOL) ? toSymbolFont(run.text) : run.text;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(text, x, base);
      if (run.flags & F.UNDERLINE) {
        ctx.fillRect(x, base + b.px * 0.1, run.width, Math.max(1.5, b.px * 0.055));
      }
      x += run.width;
    }
  });
}

function drawBalloon(ctx, b, seed) {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = INK;
  ctx.lineWidth = BORDER;
  ctx.fillStyle = '#fff';
  if (b.kind === 'action') {
    ctx.fillStyle = '#fffdf2';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.lineWidth = BORDER * 1.2;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
  } else if (b.kind === 'think') {
    drawCloud(ctx, b, seed);
    if (b.tail) drawThoughtTrail(ctx, b);
  } else {
    const o = balloonOutline(b, seed);
    if (b.kind === 'whisper') ctx.setLineDash([9, 7]);
    ctx.beginPath();
    smoothClosed(ctx, o.pts);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    if (b.tail) drawTail(ctx, b, o, b.kind === 'whisper');
  }
  drawBalloonText(ctx, b);
}

// ---------------------------------------------------------------------------

function blitPart(ctx, atlas, sprite, part) {
  const [sx, sy, sw, sh] = sprite;
  if (!part.flip) {
    ctx.drawImage(atlas, sx, sy, sw, sh, part.x, part.y, part.w, part.h);
    return;
  }
  ctx.save();
  ctx.translate(part.x + part.w, part.y);
  ctx.scale(-1, 1);
  ctx.drawImage(atlas, sx, sy, sw, sh, 0, 0, part.w, part.h);
  ctx.restore();
}

function drawPlaceholder(ctx, m) {
  const { x, y, w, h } = m.bbox;
  ctx.save();
  ctx.fillStyle = 'rgba(120,120,120,0.55)';
  ctx.strokeStyle = INK;
  ctx.lineWidth = BORDER;
  ctx.beginPath();
  ctx.ellipse(x + w / 2, y + h * 0.16, w * 0.22, h * 0.13, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillRect(x + w * 0.25, y + h * 0.3, w * 0.5, h * 0.7);
  ctx.fillStyle = '#fff';
  ctx.font = fontString(1, h * 0.14);
  ctx.textAlign = 'center';
  ctx.fillText('?', x + w / 2, y + h * 0.2);
  ctx.restore();
}

function drawNameTag(ctx, m) {
  const name = m.name;
  if (!name) return;
  const px = 26;
  ctx.save();
  ctx.font = fontString(1, px);
  const w = Math.min(m.bbox.w, ctx.measureText(name).width + 22);
  const x = Math.max(6, Math.min(U - w - 6, m.bbox.x + (m.bbox.w - w) / 2));
  const y = U - px - 16;
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, px + 10, 8);
  else ctx.rect(x, y, w, px + 10); // older browsers: square corners
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(name, x + w / 2, y + px * 0.88 + 3, w - 14);
  ctx.restore();
}

/**
 * Draw a scene into ctx. The caller sets up the transform so that (0,0)-(U,U)
 * maps to the panel; this function only draws in panel units.
 * assets: { backdrop: Image|null, atlases: Map(id -> {ink, halo}) }
 */
export function drawScene(ctx, scene, assets, opts = {}) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, U, U);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Backdrop (cropped when the camera zooms in).
  ctx.fillStyle = '#d9d9d9';
  ctx.fillRect(0, 0, U, U);
  const bd = assets.backdrop;
  if (bd) {
    const c = scene.crop;
    ctx.drawImage(bd, c.x * bd.width, c.y * bd.height, c.w * bd.width, c.h * bd.height, 0, 0, U, U);
  }

  // Aura halos first, then bodies (the original's "nimbus" pass).
  if (opts.halo !== false) {
    for (const m of scene.members) {
      if (m.missing) continue;
      const at = assets.atlases.get(m.character);
      if (!at?.halo) continue;
      for (const p of m.parts) {
        const s = m.av.sprites[p.key];
        if (s) blitPart(ctx, at.halo, s, p);
      }
    }
  }
  for (const m of scene.members) {
    if (m.missing) { drawPlaceholder(ctx, m); continue; }
    const at = assets.atlases.get(m.character);
    if (!at) continue;
    for (const p of m.parts) {
      const s = m.av.sprites[p.key];
      if (s) blitPart(ctx, at.ink, s, p);
    }
  }

  if (opts.names) for (const m of scene.members) if (m.requested) drawNameTag(ctx, m);

  // Later balloons first so earlier ones sit on top.
  for (let i = scene.balloons.length - 1; i >= 0; i--) drawBalloon(ctx, scene.balloons[i], scene.seed);

  ctx.restore();

  // Panel border.
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.lineWidth = BORDER * 2;
  ctx.strokeRect(0, 0, U, U);
  ctx.restore();
}
