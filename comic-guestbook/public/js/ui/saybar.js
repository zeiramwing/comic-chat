// The say bar: where a visitor picks who they are, what they look like, whom
// they are talking to, formats a message and signs the guestbook.

import { h } from '../lib/dom.js';
import { state, bus } from '../state.js';
import { parseMarkup } from '../shared/richtext.js';
import { submitText, inputHistory } from '../actions.js';
import { popupMenu } from './dialog.js';

const MAX = 1000;

// The classic 16 Windows colours, for the Color… picker.
const COLORS = [
  ['Black', '#000000'], ['Maroon', '#800000'], ['Green', '#008000'], ['Olive', '#808000'],
  ['Navy', '#000080'], ['Purple', '#800080'], ['Teal', '#008080'], ['Gray', '#808080'],
  ['Silver', '#c0c0c0'], ['Red', '#ff0000'], ['Lime', '#00ff00'], ['Yellow', '#ffff00'],
  ['Blue', '#0000ff'], ['Fuchsia', '#ff00ff'], ['Aqua', '#00ffff'], ['White', '#ffffff'],
];

export class SayBar {
  constructor(form, art) {
    this.form = form;
    this.art = art;
    this.histIdx = -1;
    this.coarse = matchMedia('(pointer: coarse)').matches;
    form.addEventListener('submit', (e) => e.preventDefault());
    bus.on('me', () => this.render());
    bus.on('composer', () => this.#syncChips());
    bus.on('users', () => this.#syncChips());
    bus.on('room', () => this.render());
    bus.on('sent', () => { this.ta.value = ''; this.#count(); this.ta.focus(); });
    this.render();
  }

  render() {
    this.form.replaceChildren();
    if (!state.me) {
      this.form.append(h('div.signin-prompt',
        h('span', 'Sign in to sign the guestbook:'),
        h('button.default', { type: 'button', onclick: () => bus.emit('open-auth', 'login') }, 'Sign in'),
        h('button', { type: 'button', onclick: () => bus.emit('open-auth', 'register') }, 'Create an account')));
      return;
    }

    this.charBtn = h('button.charbtn', { type: 'button', title: 'Choose your character', onclick: () => bus.emit('pick-character') });
    this.charCanvas = h('canvas', { width: 20, height: 26, 'aria-hidden': 'true' });
    this.charName = h('span');
    this.charBtn.append(this.charCanvas, this.charName);

    this.toBox = h('span.stack');
    this.toBtn = h('button', { type: 'button', onclick: (e) => this.#addressMenu(e), title: 'Talk to someone so your characters face each other' }, 'To…');

    this.bdBtn = h('button', { type: 'button', onclick: () => bus.emit('pick-backdrop'), title: 'Start a new scene with a different backdrop' }, 'Scene…');
    this.bdLabel = h('span.hint');

    const fmtBtn = (label, title, fn, extra = '') => h('button', { type: 'button', title, 'aria-label': title, class: extra, onclick: () => { fn(); this.ta.focus(); } }, label);
    this.counter = h('span.counter', { 'aria-live': 'off' }, `0 / ${MAX}`);

    this.ta = h('textarea', {
      rows: 2, maxlength: 4000, placeholder: state.room?.topic || 'Say something…',
      'aria-label': 'Your message', enterkeyhint: this.coarse ? 'enter' : 'send',
      oninput: () => { this.#count(); this.#grow(); },
      onkeydown: (e) => this.#key(e),
    });

    const send = (kind, label, title) => h('button', {
      type: 'button', title, class: kind === 'say' ? 'default' : '', onclick: () => this.#send(kind),
    }, label);

    this.form.append(
      h('div.row',
        this.charBtn, this.toBtn, this.toBox, this.bdBtn, this.bdLabel),
      h('div.row.fmt', { role: 'toolbar', 'aria-label': 'Formatting' },
        fmtBtn('B', 'Bold (Ctrl+B)', () => this.wrap('b'), 'b'),
        fmtBtn('I', 'Italic (Ctrl+I)', () => this.wrap('i'), 'i'),
        fmtBtn('U', 'Underline (Ctrl+U)', () => this.wrap('u'), 'u'),
        fmtBtn('Fixed', 'Fixed-pitch font', () => this.wrap('fixed')),
        fmtBtn('Σ', 'Symbol font', () => this.wrap('sym')),
        h('button', { type: 'button', title: 'Text color (Ctrl+K)', onclick: (e) => this.colorMenu(e) }, 'Color…'),
        this.counter),
      h('div.compose',
        h('div.grow', this.ta),
        h('div.sendcol',
          send('say', 'Say', 'Speech balloon (Enter)'),
          send('think', 'Think', 'Thought bubble'),
          send('action', 'Action', 'Narration box'))),
    );
    this.#syncChips();
    this.#grow();
  }

  focus() { this.ta?.focus(); }

  async #send(kind) {
    const raw = this.ta.value;
    if (!raw.trim()) { this.ta.focus(); return; }
    const sendBtns = this.form.querySelectorAll('.sendcol button');
    sendBtns.forEach((b) => { b.disabled = true; });
    try {
      const ok = await submitText(raw, kind);
      if (ok) { this.histIdx = -1; this.ta.value = ''; this.#count(); this.#grow(); }
    } finally {
      sendBtns.forEach((b) => { b.disabled = false; });
      this.ta.focus();
    }
  }

  #key(e) {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Enter' && !e.shiftKey && !mod && !this.coarse && !e.isComposing) {
      e.preventDefault();
      this.#send('say');
    } else if (e.key === 'Enter' && mod) {
      e.preventDefault();
      this.#send('say');
    } else if (mod && !e.altKey && !e.shiftKey && ['b', 'i', 'u', 'k'].includes(e.key.toLowerCase())) {
      e.preventDefault();
      const k = e.key.toLowerCase();
      if (k === 'k') this.colorMenu(null);
      else this.wrap(k);
    } else if (e.key === 'ArrowUp' && this.#caretOnFirstLine() && inputHistory.length) {
      // like DOSKEY: recall earlier lines
      e.preventDefault();
      this.histIdx = this.histIdx < 0 ? inputHistory.length - 1 : Math.max(0, this.histIdx - 1);
      this.ta.value = inputHistory[this.histIdx];
      this.#count();
    } else if (e.key === 'ArrowDown' && this.histIdx >= 0 && this.#caretOnLastLine()) {
      e.preventDefault();
      this.histIdx += 1;
      this.ta.value = this.histIdx >= inputHistory.length ? '' : inputHistory[this.histIdx];
      if (this.histIdx >= inputHistory.length) this.histIdx = -1;
      this.#count();
    }
  }

  #caretOnFirstLine() {
    const { selectionStart: s, value } = this.ta;
    return !value.slice(0, s).includes('\n');
  }
  #caretOnLastLine() {
    const { selectionEnd: s, value } = this.ta;
    return !value.slice(s).includes('\n');
  }

  /** Wrap the selection (or insert an empty pair) in a BBCode tag. */
  wrap(tag, attr = '') {
    const ta = this.ta;
    if (!ta) return;
    const open = `[${tag}${attr}]`;
    const close = `[/${tag}]`;
    const { selectionStart: a, selectionEnd: b, value } = ta;
    const sel = value.slice(a, b);
    ta.setRangeText(`${open}${sel}${close}`, a, b, 'end');
    if (!sel) ta.setSelectionRange(a + open.length, a + open.length);
    ta.dispatchEvent(new Event('input'));
  }

  colorMenu(ev) {
    const r = ev?.currentTarget?.getBoundingClientRect();
    const x = r ? r.left : (this.ta?.getBoundingClientRect().left ?? 100);
    const y = r ? r.bottom : (this.ta?.getBoundingClientRect().top ?? 100);
    const custom = h('input', {
      type: 'color', 'aria-label': 'Custom color', onchange: () => { this.wrap('color', `=${custom.value}`); this.ta.focus(); },
    });
    const items = COLORS.map(([name, hex]) => ({ label: `■ ${name}`, onclick: () => { this.wrap('color', `=${hex}`); this.ta.focus(); } }));
    popupMenu(x, y, [...items, '-', { label: 'Custom…', onclick: () => custom.click() }]);
    document.body.append(custom);
    custom.className = 'visually-hidden';
    setTimeout(() => custom.remove(), 60000);
  }

  #addressMenu(ev) {
    const r = ev.currentTarget.getBoundingClientRect();
    const people = [...state.users.values()].filter((u) => u.id !== state.me?.id && u.posts > 0 && !u.banned).slice(0, 80);
    if (!people.length) { bus.emit('toast', { text: 'Nobody else has signed yet.' }); return; }
    popupMenu(r.left, r.bottom, people.map((u) => ({
      label: `${state.composer.to.includes(u.id) ? '✓ ' : ''}${u.name}`,
      onclick: () => this.toggleTo(u.id),
    })));
  }

  toggleTo(id) {
    const to = new Set(state.composer.to);
    if (to.has(id)) to.delete(id);
    else if (to.size < 4) to.add(id);
    state.composer.to = [...to];
    bus.emit('composer');
  }

  #syncChips() {
    if (!this.toBox) return;
    this.toBox.replaceChildren(...state.composer.to.map((id) => {
      const name = state.users.get(id)?.name ?? `#${id}`;
      return h('span.chip', `→ ${name}`, h('button', {
        type: 'button', 'aria-label': `Stop addressing ${name}`, onclick: () => this.toggleTo(id),
      }, '✕'));
    }));
    const id = state.composer.character || state.me?.character;
    const info = this.art.index?.characters.find((c) => c.id === id);
    this.charName.textContent = info?.name ?? 'Pick a character';
    if (id) this.art.icons().then(() => this.art.drawIcon(this.charCanvas, id));
    const bd = state.composer.backdrop;
    this.bdLabel.textContent = bd ? `New scene: ${this.art.index?.backdrops.find((b) => b.id === bd)?.name ?? bd}` : '';
  }

  #count() {
    const { text } = parseMarkup(this.ta.value);
    const n = text.length;
    this.counter.textContent = `${n} / ${MAX}`;
    this.counter.classList.toggle('over', n > MAX);
  }

  #grow() {
    const ta = this.ta;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(140, Math.max(40, ta.scrollHeight + 2))}px`;
  }
}
