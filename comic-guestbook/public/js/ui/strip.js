// The scrolling comic strip. Panels are cheap placeholders until they come
// near the viewport; only then are they laid out and drawn onto a canvas, and
// they are released again once far away. A history of thousands of panels
// therefore costs a few dozen canvases.

import { h, debounce } from '../lib/dom.js';
import { state } from '../state.js';
import { buildScene, U } from '../shared/scene.js';
import { drawScene } from '../render/draw.js';
import { measure } from '../render/fonts.js';

const MIN_PANEL = 300; // px, for auto-fit columns
const MAX_COLS = 4;

export function panelLabel(panel) {
  const bits = panel.lines.map((l) => {
    const who = l.author || 'Someone';
    if (l.kind === 'action') return `${who} ${l.text}`;
    if (l.kind === 'think') return `${who} thinks: ${l.text}`;
    if (l.kind === 'whisper') return `${who} whispers: ${l.text}`;
    return `${who} says: ${l.text}`;
  });
  for (const r of panel.reactions ?? []) bits.push(`${r.author} reacts.`);
  return `Panel ${panel.index + 1}. ${bits.join(' ')}`;
}

export class StripView {
  /**
   * @param {HTMLElement} el scroll container (#strip)
   * @param {import('../render/art.js').Art} art
   * @param {{ onPick(info, ev): void }} hooks
   */
  constructor(el, art, hooks = {}) {
    this.el = el;
    this.art = art;
    this.hooks = hooks;
    this.items = [];
    this.visible = new Set();
    this.dpr = Math.min(globalThis.devicePixelRatio || 1, 2);

    this.io = new IntersectionObserver((entries) => this.#onIntersect(entries), { root: el, rootMargin: '700px 0px' });
    this.ro = new ResizeObserver(debounce(() => this.layout(), 80));
    this.ro.observe(el);
    el.addEventListener('click', (ev) => this.#onClick(ev));
    el.addEventListener('contextmenu', (ev) => this.#onClick(ev, true));
    this.layout();
  }

  /** Number of columns for the current width and preference. */
  columns() {
    const pref = state.prefs.panelsPerRow;
    if (pref > 0) return Math.min(pref, MAX_COLS);
    const w = this.el.clientWidth - 24;
    return Math.max(1, Math.min(MAX_COLS, Math.floor((w + 12) / (MIN_PANEL + 12))));
  }

  layout() {
    const cols = this.columns();
    const changed = this.el.style.getPropertyValue('--cols') !== String(cols);
    this.el.style.setProperty('--cols', String(cols));
    // Canvas size follows the panel width; redraw drawn panels if it changed.
    for (const it of this.items) {
      if (it.canvas && (changed || Math.abs(it.drawnW - it.el.clientWidth) > 2)) this.#draw(it);
    }
  }

  /** Synchronise placeholders with the builder's panels from index `from` on. */
  update(panels, from = 0, reset = false) {
    const atBottom = this.isNearBottom();
    const prevTop = this.el.scrollTop;
    if (reset) {
      for (const it of this.items) this.#release(it, true);
      this.items = [];
      this.el.replaceChildren();
      from = 0;
    }
    // drop surplus
    while (this.items.length > panels.length) {
      const it = this.items.pop();
      this.#release(it, true);
      it.el.remove();
    }
    for (let i = from; i < panels.length; i++) {
      const panel = panels[i];
      let it = this.items[i];
      if (!it) {
        it = this.#makeItem(panel);
        this.items[i] = it;
        this.el.append(it.el);
        this.io.observe(it.el);
      } else if (it.panel !== panel || it.sig !== signature(panel)) {
        it.panel = panel;
        it.sig = signature(panel);
        it.el.setAttribute('aria-label', panelLabel(panel));
        it.token++;
        if (it.canvas) this.#draw(it);
      }
    }
    if (!panels.length) this.#showEmpty();
    else this.el.querySelector('.empty')?.remove();
    if (reset) this.el.scrollTop = atBottom ? this.el.scrollHeight : prevTop;
  }

  #showEmpty() {
    if (this.el.querySelector('.empty')) return;
    this.el.replaceChildren(h('div.empty', h('strong', 'The strip is empty.'), 'Be the first to sign the guestbook!'));
  }

  #makeItem(panel) {
    const el = h('div.panel', { role: 'img', 'aria-label': panelLabel(panel), dataset: { index: panel.index } },
      h('span.panel-no', `#${panel.index + 1}`));
    return { panel, el, canvas: null, scene: null, token: 0, sig: signature(panel), drawnW: 0 };
  }

  #onIntersect(entries) {
    for (const e of entries) {
      const it = this.items[Number(e.target.dataset.index)];
      if (!it) continue;
      if (e.isIntersecting) { this.visible.add(it); this.#draw(it); }
      else { this.visible.delete(it); this.#release(it); }
    }
  }

  #release(it, force = false) {
    if (!it.canvas && !force) return;
    it.canvas?.remove();
    it.canvas = null;
    it.scene = null;
    it.token++;
    this.visible.delete(it);
    if (force) this.io.unobserve(it.el);
  }

  async #draw(it) {
    const token = ++it.token;
    const panel = it.panel;
    await this.art.ensurePanel(panel);
    if (token !== it.token || !it.el.isConnected) return;
    const scene = buildScene(panel, {
      characters: this.art.manifests,
      measure,
      autoExpressions: state.prefs.autoExpress,
      fontPx: state.prefs.bigText ? 54 : 46,
    });
    const size = it.el.clientWidth || 300;
    const px = Math.max(64, Math.round(size * this.dpr));
    let canvas = it.canvas;
    if (!canvas) {
      canvas = h('canvas', { 'aria-hidden': 'true' });
      it.el.prepend(canvas);
      it.canvas = canvas;
    }
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(px / U, 0, 0, px / U, 0, 0);
    drawScene(ctx, scene, { backdrop: this.art.backdrops.get(panel.backdrop) ?? null, atlases: this.art.atlases }, {
      names: state.prefs.showNames, halo: state.prefs.halo,
    });
    it.scene = scene;
    it.drawnW = size;
  }

  /** Redraw everything currently on screen (after a preference change). */
  redrawVisible() {
    for (const it of this.visible) this.#draw(it);
  }

  // ---- interaction ------------------------------------------------------

  #onClick(ev, context = false) {
    const panelEl = ev.target.closest('.panel');
    if (!panelEl) return;
    const it = this.items[Number(panelEl.dataset.index)];
    if (!it?.scene) return;
    const r = panelEl.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / r.width) * U;
    const y = ((ev.clientY - r.top) / r.height) * U;
    const info = this.hit(it, x, y);
    if (!info) return;
    if (context) ev.preventDefault();
    this.hooks.onPick?.({ ...info, panel: it.panel, context }, ev);
  }

  hit(it, x, y) {
    const { scene, panel } = it;
    for (const b of scene.balloons) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        const line = panel.lines.find((l) => l.entryId === b.entryId && l.userId === b.userId);
        return { type: 'balloon', line, userId: b.userId, entryId: b.entryId };
      }
    }
    for (const m of [...scene.members].reverse()) {
      const bb = m.bbox;
      if (x >= bb.x && x <= bb.x + bb.w && y >= bb.y && y <= bb.y + bb.h) {
        return { type: 'character', userId: m.userId, line: m.line, member: m };
      }
    }
    return null;
  }

  // ---- scrolling --------------------------------------------------------

  isNearBottom(slack = 160) {
    return this.el.scrollHeight - this.el.scrollTop - this.el.clientHeight < slack;
  }

  scrollToBottom() {
    this.el.scrollTop = this.el.scrollHeight;
  }

  /** Scroll to the panel containing an entry and flash it. */
  reveal(entryId) {
    const it = this.items.find((x) => x.panel.lines.some((l) => l.entryId === entryId));
    if (!it) return false;
    it.el.scrollIntoView({ block: 'center' });
    it.el.classList.add('hl');
    setTimeout(() => it.el.classList.remove('hl'), 1800);
    return true;
  }

  /** Panels whose canvases are ready, for export. */
  get count() { return this.items.length; }
}

function signature(panel) {
  return (panel.reactions ?? []).map((r) => `r${r.entryId}`).join('') + panel.lines.map((l) => `${l.entryId}:${l.chunk}:${l.text.length}`).join('|') + `|${panel.cast.map((c) => `${c.userId}${c.flip ? 'f' : ''}`).join(',')}|${panel.backdrop}`;
}
