// Plain-text view of the strip, like Microsoft Chat's "Plain Text" mode. It is
// also the accessible, copy-friendly alternative to the comic view.

import { h, formatClock, formatDay } from '../lib/dom.js';
import { state, bus, isFavorite } from '../state.js';
import { view } from '../data.js';
import { segments, F } from '../shared/richtext.js';
import { toSymbolFont } from '../shared/textwrap.js';
import { emotionLabel } from '../shared/emotion.js';

const PAGE = 400;
const URL_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi;

/** Turn text into nodes, linking http(s) addresses. Never uses innerHTML. */
export function linkify(text, className = '') {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(h('a', { href: m[0], target: '_blank', rel: 'noopener noreferrer nofollow', class: className }, m[0]));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Rich text runs as DOM nodes. */
export function richNodes(text, fmt) {
  return segments(text, fmt).map((seg) => {
    const t = (seg.flags & F.SYMBOL) ? toSymbolFont(seg.text) : seg.text;
    if (!seg.flags && !seg.color) return linkify(t);
    const el = h('span', {
      class: `${seg.flags & F.BOLD ? 'b ' : ''}${seg.flags & F.ITALIC ? 'i ' : ''}${seg.flags & F.UNDERLINE ? 'u ' : ''}${seg.flags & F.FIXED ? 'fixed' : ''}`,
    }, ...linkify(t));
    if (seg.flags & F.BOLD) el.style.fontWeight = '700';
    if (seg.flags & F.ITALIC) el.style.fontStyle = 'italic';
    if (seg.flags & F.UNDERLINE) el.style.textDecoration = 'underline';
    if (seg.color) el.style.color = seg.color;
    return el;
  });
}

export class TextView {
  constructor(el) {
    this.el = el;
    this.shown = PAGE;
    bus.on('prefs', () => { if (!this.el.hidden) this.render(); });
  }

  #lines() {
    return state.entries.map(view).filter(Boolean);
  }

  line(e, mentions) {
    const who = h('span.who', e.author);
    const time = h('span.time', { title: new Date(e.ts).toLocaleString() }, formatClock(e.ts));
    let body;
    switch (e.kind) {
      case 'action': body = [h('span.who.action', `* ${e.author}`), ' ', ...richNodes(e.text, e.fmt)]; break;
      case 'think': body = [who, ' . o O ( ', ...richNodes(e.text, e.fmt), ' )']; break;
      case 'whisper': body = [who, ' whispers: ', ...richNodes(e.text, e.fmt)]; break;
      case 'expression': body = [h('span.who.action', `* ${e.author}`), ` looks ${emotionLabel(e.em).toLowerCase()}.`]; break;
      default: body = [who, ': ', ...richNodes(e.text, e.fmt)];
    }
    const hl = e.hl || isFavorite(e.userId) || mentions(e);
    return h('div.line', { class: `${e.kind} ${hl ? 'hl' : ''}`, dataset: { id: e.id } }, time, ...body);
  }

  render() {
    const entries = this.#lines();
    const start = Math.max(0, entries.length - this.shown);
    const me = state.me?.display?.toLowerCase();
    const mentions = (e) => !!me && e.userId !== state.me.id && e.text.toLowerCase().includes(`@${me}`);
    const nodes = [];
    if (start > 0) {
      nodes.push(h('button', { type: 'button', onclick: () => { this.shown += PAGE; this.render(); } }, `Show ${Math.min(PAGE, start)} earlier entries`));
    }
    let day = '';
    for (const e of entries.slice(start)) {
      const d = formatDay(e.ts);
      if (d !== day) { day = d; nodes.push(h('div.day', d)); }
      nodes.push(this.line(e, mentions));
    }
    if (!entries.length) nodes.push(h('p', 'The strip is empty. Be the first to sign the guestbook!'));
    const nearBottom = this.el.scrollHeight - this.el.scrollTop - this.el.clientHeight < 80;
    this.el.replaceChildren(...nodes);
    if (nearBottom || !this.rendered) this.el.scrollTop = this.el.scrollHeight;
    this.rendered = true;
  }

  append(entries) {
    if (this.el.hidden) return;
    const nearBottom = this.el.scrollHeight - this.el.scrollTop - this.el.clientHeight < 80;
    const me = state.me?.display?.toLowerCase();
    const mentions = (e) => !!me && e.userId !== state.me.id && e.text.toLowerCase().includes(`@${me}`);
    for (const raw of entries) {
      const e = view(raw);
      if (e) this.el.append(this.line(e, mentions));
    }
    if (nearBottom) this.el.scrollTop = this.el.scrollHeight;
  }
}
