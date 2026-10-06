import { h, $ } from '../lib/dom.js';
import { bus } from '../state.js';

export function toast(text, { error = false, ms = 4500 } = {}) {
  const box = $('#toasts');
  if (!box) return;
  const el = h('div.toast', { class: error ? 'err' : '', role: error ? 'alert' : 'status' }, text);
  box.append(el);
  setTimeout(() => el.remove(), ms);
}

bus.on('toast', ({ text, error }) => toast(text, { error }));
