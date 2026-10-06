// Modal dialogs on top of the native <dialog> element (focus trap, Esc, inert
// background, all for free).

import { h } from '../lib/dom.js';

/**
 * openDialog({ title, body, actions: [{label, primary, onclick(close)}], onclose })
 * Returns { el, close }.
 */
export function openDialog({ title, body, actions = [], onclose, wide = false, closeLabel = 'Close' }) {
  const dlg = h('dialog', { 'aria-label': title });
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    dlg.close();
    dlg.remove();
    onclose?.(result);
  };
  const buttons = actions.map((a) => h('button', {
    type: 'button',
    class: `${a.primary ? 'default' : ''} ${a.danger ? 'danger' : ''}`,
    disabled: a.disabled,
    onclick: async (ev) => {
      const btn = ev.currentTarget;
      if (a.onclick) {
        btn.disabled = true;
        try { await a.onclick(close, btn); } finally { if (!closed) btn.disabled = false; }
      } else close(a.label);
    },
  }, a.label));
  dlg.append(
    h('div.dlg-title', h('span', title), h('button', { type: 'button', 'aria-label': closeLabel, onclick: () => close() }, '✕')),
    h('div.dlg-body', { class: wide ? 'wide' : '' }, body),
    buttons.length ? h('div.dlg-actions', buttons) : null,
  );
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  document.body.append(dlg);
  dlg.showModal();
  const first = dlg.querySelector('[autofocus], input:not([type=hidden]), textarea, select');
  (first ?? dlg.querySelector('.dlg-actions .default, .dlg-actions button'))?.focus();
  return { el: dlg, close };
}

export function confirmDialog(message, { title = 'Please confirm', yes = 'OK', no = 'Cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    openDialog({
      title,
      body: h('p', message),
      onclose: (r) => resolve(r === 'yes'),
      actions: [
        { label: yes, primary: !danger, danger, onclick: (close) => close('yes') },
        { label: no, onclick: (close) => close('no') },
      ],
    });
  });
}

export function alertDialog(message, title = 'Comic Guestbook') {
  return new Promise((resolve) => {
    openDialog({
      title,
      body: typeof message === 'string' ? h('p', message) : message,
      onclose: () => resolve(),
      actions: [{ label: 'OK', primary: true, onclick: (close) => close('ok') }],
    });
  });
}

/** Floating menu at a point (context menus). items: [{label, onclick, disabled, danger}|'-'] */
export function popupMenu(x, y, items, { onclose } = {}) {
  const list = h('ul.menu-list', { role: 'menu' });
  const wrap = h('div.popup', { role: 'presentation' }, list);
  const close = () => {
    wrap.remove();
    document.removeEventListener('pointerdown', away, true);
    document.removeEventListener('keydown', key, true);
    onclose?.();
  };
  const away = (e) => { if (!wrap.contains(e.target)) close(); };
  const key = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const btns = [...list.querySelectorAll('button:not(:disabled)')];
      const i = btns.indexOf(document.activeElement);
      const n = e.key === 'ArrowDown' ? (i + 1) % btns.length : (i - 1 + btns.length) % btns.length;
      btns[n]?.focus();
    }
  };
  for (const it of items) {
    if (it === '-') { list.append(h('li.menu-sep', { role: 'separator' })); continue; }
    list.append(h('li', { role: 'none' }, h('button.menu-item', {
      type: 'button', role: 'menuitem', disabled: it.disabled, class: it.danger ? 'danger' : '',
      onclick: () => { close(); it.onclick?.(); },
    }, h('span', it.label), it.accel ? h('span.accel', it.accel) : null)));
  }
  document.body.append(wrap);
  const r = wrap.getBoundingClientRect();
  wrap.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`;
  wrap.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 4))}px`;
  setTimeout(() => {
    document.addEventListener('pointerdown', away, true);
    document.addEventListener('keydown', key, true);
    list.querySelector('button:not(:disabled)')?.focus();
  });
  return { close };
}
