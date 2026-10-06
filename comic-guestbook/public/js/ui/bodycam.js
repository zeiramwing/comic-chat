// The "BodyCam": a preview of your character plus the emotion wheel, as in
// Microsoft Chat 2.5. Drag on the wheel: direction picks the emotion,
// distance from the centre picks its intensity (a dead zone in the middle is
// neutral). Freeze keeps your expression between messages.

import { h } from '../lib/dom.js';
import { state, bus } from '../state.js';
import {
  EMOTION_NAMES, NEUTRAL, emotionFromWheel, wheelPoint, emotionLabel, bodyFromEmotion, TAU,
} from '../shared/emotion.js';
import { characterGeometry } from '../shared/scene.js';

const SIZE = 190;
const CENTER = SIZE / 2;
const ICON_R = 80; // radius of the emotion icons
const DISC_R = 64; // radius of the draggable disc
const ICON_ORDER = [0, 1, 2, 3, 4, 5, 6, 7]; // sprite index == wheel index; 8 is neutral

export class BodyCam {
  constructor(el, art) {
    this.el = el;
    this.art = art;
    this.intensity = 0.8;
    this.#build();
    bus.on('composer', () => this.refresh());
    bus.on('me', () => this.refresh());
  }

  #build() {
    this.preview = h('canvas', { width: 220, height: 165, 'aria-hidden': 'true' });
    this.whoBtn = h('button.who-btn', { type: 'button', title: 'Choose your character', onclick: () => bus.emit('pick-character') }, 'Character');
    this.disc = h('div.disc');
    this.cursor = h('div.cursor', { hidden: true });
    this.wheel = h('div.wheel', { role: 'group', 'aria-label': 'Emotion wheel' }, this.disc, this.cursor);
    this.buttons = ICON_ORDER.map((k) => {
      const a = (k * TAU) / 8;
      const c = h('canvas', { width: 20, height: 26, 'aria-hidden': 'true' });
      const b = h('button.em', {
        type: 'button', title: EMOTION_NAMES[k], 'aria-label': EMOTION_NAMES[k], 'aria-pressed': 'false',
        onclick: () => this.#setEmotion({ e: a, i: this.intensity }),
      }, c);
      b.style.left = `${CENTER + ICON_R * Math.cos(a)}px`;
      b.style.top = `${CENTER - ICON_R * Math.sin(a)}px`;
      b.dataset.k = String(k);
      b.canvas = c;
      this.wheel.append(b);
      return b;
    });
    this.label = h('span.emo-label', 'Neutral');
    this.freeze = h('input', {
      type: 'checkbox', id: 'freeze-cb',
      onchange: () => { state.composer.frozen = this.freeze.checked; bus.emit('composer'); },
    });
    this.slider = h('input', {
      type: 'range', min: '20', max: '100', value: '80', 'aria-label': 'Expression intensity',
      oninput: () => {
        this.intensity = Number(this.slider.value) / 100;
        const em = state.composer.em;
        if (em.i > 0) this.#setEmotion({ e: em.e, i: this.intensity });
      },
    });
    this.neutralBtn = h('button', { type: 'button', onclick: () => this.#setEmotion(NEUTRAL) }, 'Neutral');
    this.exprBtn = h('button', {
      type: 'button', title: 'Show your character reacting, without saying anything',
      onclick: () => bus.emit('send-expression'),
    }, 'Send expression');

    this.el.append(
      h('div.preview', this.preview, this.whoBtn),
      this.wheel,
      h('div.row', this.label, h('label', this.freeze, ' Freeze')),
      h('div.row', this.slider, this.neutralBtn),
      h('div.row', this.exprBtn),
    );

    // Pointer dragging on the wheel (mouse, touch and pen).
    let dragging = false;
    const move = (ev) => {
      const r = this.wheel.getBoundingClientRect();
      const scale = r.width / SIZE;
      const dx = (ev.clientX - r.left) / scale - CENTER;
      const dy = (ev.clientY - r.top) / scale - CENTER;
      this.#setEmotion(emotionFromWheel(dx, dy, DISC_R));
    };
    this.wheel.addEventListener('pointerdown', (ev) => {
      if (ev.target.closest('.em')) return; // icon buttons handle themselves
      dragging = true;
      this.wheel.setPointerCapture(ev.pointerId);
      move(ev);
    });
    this.wheel.addEventListener('pointermove', (ev) => { if (dragging) move(ev); });
    const end = () => { dragging = false; };
    this.wheel.addEventListener('pointerup', end);
    this.wheel.addEventListener('pointercancel', end);
    this.wheel.addEventListener('dblclick', () => this.#setEmotion(NEUTRAL));

    this.art.emotions().then((img) => {
      if (!img) return;
      const w = this.art.index.ui.emotions.w;
      const hh = this.art.index.ui.emotions.h;
      this.buttons.forEach((b, i) => {
        const ctx = b.canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, i * w, 0, w, hh, 0, 0, w, hh);
      });
    });
    this.refresh();
  }

  #setEmotion(em) {
    state.composer.em = { e: em.e, i: em.i };
    bus.emit('composer');
  }

  /** Reset to neutral after sending, unless frozen. */
  afterSend() {
    if (!state.composer.frozen) this.#setEmotion(NEUTRAL);
  }

  refresh() {
    const { em, frozen } = state.composer;
    this.freeze.checked = frozen;
    this.label.textContent = emotionLabel(em);
    const p = wheelPoint(em, DISC_R);
    this.cursor.hidden = em.i === 0;
    this.cursor.style.left = `${CENTER + p.x}px`;
    this.cursor.style.top = `${CENTER + p.y}px`;
    const label = em.i === 0 ? null : emotionLabel(em);
    for (const b of this.buttons) b.setAttribute('aria-pressed', String(label === EMOTION_NAMES[Number(b.dataset.k)]));
    if (em.i > 0) { this.slider.value = String(Math.round(em.i * 100)); this.intensity = em.i; }
    const c = state.users.get(state.me?.id)?.character;
    const id = state.composer.character || c || '';
    const name = this.art.index?.characters.find((x) => x.id === id)?.name;
    this.whoBtn.textContent = name ? `${name} ▾` : 'Pick a character ▾';
    this.#drawPreview(id);
  }

  async #drawPreview(id) {
    const canvas = this.preview;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!id) return;
    const token = (this.token = (this.token ?? 0) + 1);
    const at = await this.art.character(id);
    if (token !== this.token || !at) return;
    const av = this.art.manifests.get(id);
    const pick = bodyFromEmotion(av, state.composer.em, 0);
    const geom = characterGeometry(av, pick);
    if (!geom) return;
    const W = canvas.width;
    const H = canvas.height;
    // Fit the whole body, bottom-aligned, as large as it will go.
    const scale = Math.min((H - 4) / geom.height, (W - 8) / geom.width);
    const ox = (W - geom.width * scale) / 2;
    const oy = H - geom.height * scale;
    ctx.imageSmoothingQuality = 'high';
    for (const layer of [at.halo, at.ink]) {
      if (!layer) continue;
      for (const p of geom.parts) {
        const s = av.sprites[p.key];
        if (s) ctx.drawImage(layer, s[0], s[1], s[2], s[3], ox + p.x * scale, oy + p.y * scale, p.w * scale, p.h * scale);
      }
    }
  }
}
