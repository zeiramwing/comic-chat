// Panel scene builder: given a laid-out panel (layout.js), character manifests
// and a text-measuring function, produce plain drawable geometry in a
// 1000 x 1000 panel space (y down). No canvas, no DOM, deterministic.
//
// Character placement is ported from CUnitPanel::LayoutAvatars, GetBodyBox and
// GetDimInfo (panel.cpp, bodycam.cpp, avatar.cpp). Balloon placement is a
// simplified take on CUnitPanel::LayoutBalloon: balloons stack from the top of
// the panel in speaking order, sit near the speaker, and avoid the "tail
// corridors" of the balloons above them.

import { segments } from './richtext.js';
import { wrapText, widestWord } from './textwrap.js';
import { bodyFromEmotion, bodyFromOpts, neutralBody, optsFromText, compileRules } from './emotion.js';
import { hash, prng } from './layout.js';

export const U = 1000;
const MAX_BODY = U / 1.9; // maxBodyHeight in the original
const TORSOFIRST = 4;

export const BALLOON = {
  MARGIN: 34,
  TOP: 26,
  BOTTOM: U / 2, // balloons live in the top half
  GAP: 14,
  PX: 46, // base font size
  MIN_PX: 24,
  PAD: 0.62, // padding as a multiple of px
  LINE: 1.2,
  TAIL_HALF: 24, // half width of the tail corridor
  MIN_HOOK: 26, // least visible tail length
};

// Stand-in figure for a character whose art is missing (parts is empty).
const PLACEHOLDER = Object.freeze({ width: 200, height: 420, headHeight: 120, faceX: 100, parts: [] });

// ---------------------------------------------------------------------------
// One character's pose -> sprite parts relative to its own bitmap box.

export function characterGeometry(av, pick) {
  if (av.type === 'simple') {
    const s = av.sprites[pick.body.p];
    if (!s) return null;
    const [, , w, h] = s;
    return {
      width: w, height: h, headHeight: h / 2, faceX: pick.body.fx,
      parts: [{ layer: 'body', key: pick.body.p, x: 0, y: 0, w, h }],
    };
  }
  const hs = av.sprites[pick.face.p];
  const ts = av.sprites[pick.torso.p];
  if (!hs || !ts) return null;
  const hw = hs[2], hh = hs[3], tw = ts[2], th = ts[3];
  const xo = pick.torso.cx + pick.face.dx - pick.face.cx;
  const yo = pick.torso.cy + pick.face.dy - pick.face.cy;
  const left = Math.min(0, xo);
  const right = Math.max(tw, xo + hw);
  const top = Math.min(0, yo);
  const bottom = Math.max(th, yo + hh);
  const head = { layer: 'head', key: pick.face.p, x: xo - left, y: yo - top, w: hw, h: hh };
  const torso = { layer: 'torso', key: pick.torso.p, x: -left, y: -top, w: tw, h: th };
  return {
    width: right - left,
    height: bottom - top,
    headHeight: yo + hh - top,
    faceX: pick.face.fx + xo - left,
    parts: (av.flags & TORSOFIRST) ? [torso, head] : [head, torso],
  };
}

function choosePose(av, member, line, ctx, panel) {
  const reaction = panel.reactions?.find((r) => r.userId === member.userId);
  const start = hash(line ? line.entryId : reaction ? reaction.entryId : panel.id, member.userId) % 97;
  if (reaction) return bodyFromEmotion(av, reaction.em, start); // a wordless reaction wins
  if (!line) return neutralBody(av, start); // addressed but silent: neutral
  if (line.em) return bodyFromEmotion(av, line.em, start);
  if (ctx.autoExpressions === false) return neutralBody(av, start);
  const opts = optsFromText(line.text, ctx.rules);
  return opts.length ? bodyFromOpts(av, opts, start) : neutralBody(av, start);
}

// ---------------------------------------------------------------------------

export function buildScene(panel, ctx) {
  const rules = ctx.rules ?? compileRules();
  const c = { ...ctx, rules };
  const members = [];
  for (const m of panel.cast) {
    const av = ctx.characters.get(m.character);
    const line = panel.lines.find((l) => l.userId === m.userId) ?? null;
    const pick = av ? choosePose(av, m, line, c, panel) : null;
    const geom = pick ? characterGeometry(av, pick) : null;
    // A character whose art is unknown or unloaded still takes a slot, drawn as
    // a placeholder silhouette, so balloons and tails keep working.
    members.push(geom
      ? { ...m, line, av, pick, geom }
      : { ...m, line, missing: true, geom: PLACEHOLDER });
  }
  const drawn = members;

  // --- LayoutAvatars ------------------------------------------------------
  const items = drawn.map((m) => {
    const scale = MAX_BODY / m.geom.height;
    let faceX = m.geom.faceX;
    if (m.flip) faceX = m.geom.width - faceX;
    return {
      m,
      h: MAX_BODY,
      w: Math.round(m.geom.width * scale),
      headH: m.geom.headHeight * scale,
      arrowFrac: faceX / m.geom.width,
      scale,
    };
  });
  let sumW = items.reduce((n, it) => n + it.w, 0);
  let zoom = 1;
  if (items.length) {
    if (sumW > U) {
      const r = U / sumW;
      for (const it of items) { it.h = Math.round(it.h * r); it.w = Math.round(it.w * r); it.scale *= r; }
    }
    for (const it of items) it.topY = U - it.h; // before any zoom
    if (sumW <= U && panel.index !== 0) { // establishing shot: no zoom on the very first panel
      const maxHead = Math.max(...items.map((it) => it.headH));
      zoom = Math.min(U / sumW, MAX_BODY / (maxHead * 1.2));
      if (zoom < 1.1) zoom = 1;
      for (const it of items) { it.h = Math.round(it.h * zoom); it.w = Math.round(it.w * zoom); it.scale *= zoom; }
    }
    sumW = items.reduce((n, it) => n + it.w, 0);
  }
  const margin = items.length ? (U - sumW) / (items.length + 1) : 0;
  let x = margin;
  for (const it of items) {
    const { m } = it;
    const bbox = { x, y: it.topY, w: it.w, h: it.h };
    // Parts are placed inside the bbox, mirrored when the character faces left.
    const parts = m.geom.parts.map((p) => {
      const px = p.x * it.scale;
      const pw = p.w * it.scale;
      return {
        layer: p.layer, key: p.key,
        x: bbox.x + (m.flip ? it.w - px - pw : px),
        y: bbox.y + p.y * it.scale,
        w: pw, h: p.h * it.scale, flip: m.flip,
      };
    });
    m.bbox = bbox;
    m.parts = parts;
    m.arrowX = bbox.x + Math.round(it.arrowFrac * it.w);
    x += it.w + margin;
  }

  // Zoom crops the backdrop about the fixed point, like AdjustArtToCoord.
  const fixed = (U - MAX_BODY) / U; // 0.474
  const crop = zoom > 1
    ? { x: 0, y: fixed * (1 - 1 / zoom), w: 1 / zoom, h: 1 / zoom }
    : { x: 0, y: 0, w: 1, h: 1 };

  const balloons = layoutBalloons(panel, members, c);
  return { U, backdrop: panel.backdrop, crop, zoom, members, balloons, seed: panel.seed };
}

// ---------------------------------------------------------------------------
// Balloons

function freeIntervals(corridors, lo, hi) {
  let free = [[lo, hi]];
  for (const [a, b] of corridors) {
    const next = [];
    for (const [s, e] of free) {
      if (b <= s || a >= e) { next.push([s, e]); continue; }
      if (a > s) next.push([s, a]);
      if (b < e) next.push([b, e]);
    }
    free = next;
  }
  return free;
}

function balloonText(line) {
  if (line.kind === 'action') {
    const base = segments(line.text, line.fmt);
    return [{ text: `${line.author} `, flags: 1, color: null }, ...base];
  }
  return segments(line.text, line.fmt);
}

function layoutBalloons(panel, members, ctx) {
  const { measure } = ctx;
  const B = BALLOON;
  const byUser = new Map(members.map((m) => [m.userId, m]));
  const lines = panel.lines;
  const maxW = U - 2 * B.MARGIN;

  const attempt = (px) => {
    const rand = prng(panel.seed); // reseed so every attempt is reproducible
    const pad = px * B.PAD;
    const lineH = px * B.LINE;
    const out = [];
    const corridors = [];
    let y = B.TOP;
    for (const line of lines) {
      const segs = balloonText(line);
      const isBox = line.kind === 'action';
      const speaker = byUser.get(line.userId);
      const total = wrapText(segs, 1e9, px, measure)[0]?.width ?? 0;
      const longest = widestWord(segs, px, measure);
      const minW = Math.min(maxW, longest + 2 * pad);

      // Pick a width: one line if it fits comfortably, else a pleasant aspect.
      const wideEnough = (limit) => {
        let w;
        if (total + 2 * pad <= limit * 0.8) w = total + 2 * pad;
        else {
          const area = (total + 2 * pad) * (lineH + 2 * pad);
          const aspect = 1.5 + rand() * 0.9;
          w = Math.sqrt(area * aspect);
        }
        return Math.max(minW, Math.min(limit, w));
      };
      let allowed = [[B.MARGIN, U - B.MARGIN]];
      if (!isBox) allowed = freeIntervals(corridors, B.MARGIN, U - B.MARGIN).filter(([s, e]) => e - s >= minW);
      if (!allowed.length) allowed = [[B.MARGIN, U - B.MARGIN]]; // give up avoiding

      // Prefer the free interval nearest the speaker.
      const target = speaker?.arrowX ?? U / 2;
      allowed.sort((a, b) => Math.abs(clampTo(target, a) - target) - Math.abs(clampTo(target, b) - target));
      const [lo, hi] = allowed[0];
      const w = isBox ? Math.min(maxW, Math.max(minW, wideEnough(maxW))) : wideEnough(hi - lo);
      const wrapped = wrapText(segs, w - 2 * pad, px, measure);
      const h = wrapped.length * lineH + 2 * pad;

      let bx;
      if (isBox) bx = B.MARGIN;
      else {
        const left = Math.max(lo, Math.min(target - w, hi - w));
        const right = Math.max(lo, Math.min(target, hi - w));
        bx = left + rand() * Math.max(0, right - left); // always overlaps the speaker
        bx = Math.max(lo, Math.min(bx, hi - w));
      }
      const balloon = {
        kind: line.kind, entryId: line.entryId, userId: line.userId,
        x: bx, y, w, h, px, lineH, pad, lines: wrapped, tail: null,
      };
      if (!isBox && speaker) {
        const r = Math.min(w / 2, 0.12 * w + 14);
        const baseX = Math.max(bx + r, Math.min(speaker.arrowX, bx + w - r));
        const tipY = Math.max(y + h + B.MIN_HOOK, speaker.bbox.y + speaker.bbox.h * 0.03);
        balloon.tail = { baseX, tipX: speaker.arrowX, tipY };
        corridors.push([Math.min(baseX, speaker.arrowX) - B.TAIL_HALF, Math.max(baseX, speaker.arrowX) + B.TAIL_HALF]);
      }
      out.push(balloon);
      y += h + B.GAP;
    }
    const bottom = y - B.GAP;
    return { out, fits: bottom <= B.BOTTOM };
  };

  let px = (ctx.fontPx ?? B.PX);
  let result = attempt(px);
  for (let i = 0; i < 12 && !result.fits && px > B.MIN_PX; i++) {
    px = Math.max(B.MIN_PX, px * 0.92);
    result = attempt(px);
  }
  return result.out;
}

function clampTo(v, [lo, hi]) {
  return Math.max(lo, Math.min(v, hi));
}
