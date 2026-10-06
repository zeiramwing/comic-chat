// Macro editor (Macros → Define macro). A macro is a named list of lines; each
// line is typed text or a command. Run one by typing /name.

import { h } from '../lib/dom.js';
import { state, bus } from '../state.js';
import { setPrefs } from '../prefs.js';
import { openDialog } from './dialog.js';
import { submitText } from '../actions.js';

const RESERVED = new Set(['me', 'say', 'think', 'thought', 'action', 'to', 'macro', 'ignore', 'unignore', 'fav', 'unfav', 'profile', 'nick', 'ping', 'clear', 'help', 'whisper', 'away', 'join', 'leave', 'topic']);
const NAME_RE = /^[A-Za-z0-9_-]{1,20}$/;
const MAX_MACROS = 30;

export function openMacros() {
  let selected = Object.keys(state.prefs.macros)[0] ?? null;
  const err = h('div.error', { role: 'alert' });
  const list = h('ul');
  const name = h('input', { type: 'text', id: 'mc-name', maxlength: 20, placeholder: 'name', autocapitalize: 'off', spellcheck: false });
  const body = h('textarea', { id: 'mc-body', rows: 6, maxlength: 1000, placeholder: 'One line per entry, for example:\nHi everyone!\n/me waves' });
  const draw = () => {
    list.replaceChildren(...Object.keys(state.prefs.macros).sort().map((k) => h('li', { class: k === selected ? 'sel' : '' },
      h('button', { type: 'button', onclick: () => { selected = k; load(); draw(); } }, `/${k}`))));
    if (!list.children.length) list.append(h('li', h('span.hint', 'No macros yet')));
  };
  const load = () => {
    name.value = selected ?? '';
    body.value = selected ? state.prefs.macros[selected] : '';
    err.textContent = '';
  };
  const save = () => {
    err.textContent = '';
    const key = name.value.trim();
    if (!NAME_RE.test(key)) { err.textContent = 'Use 1–20 letters, digits, - or _ for the name.'; return false; }
    if (RESERVED.has(key.toLowerCase())) { err.textContent = `“${key}” is already a command.`; return false; }
    if (!body.value.trim()) { err.textContent = 'The macro is empty.'; return false; }
    const macros = { ...state.prefs.macros };
    if (selected && selected !== key) delete macros[selected];
    if (!(key in macros) && Object.keys(macros).length >= MAX_MACROS) { err.textContent = `You can keep up to ${MAX_MACROS} macros.`; return false; }
    macros[key] = body.value.trim();
    setPrefs({ macros });
    selected = key;
    draw();
    return true;
  };
  load();
  draw();
  const dlg = openDialog({
    title: 'Define macro',
    wide: true,
    body: h('div',
      h('div.form-grid',
        h('div.list-box', list),
        h('div', h('label', { for: 'mc-name' }, 'Name'), h('div', name), h('label', { for: 'mc-body' }, 'Lines'), h('div', body), err)),
      h('div.row-actions',
        h('button', { type: 'button', onclick: () => { selected = null; load(); draw(); name.focus(); } }, 'New'),
        h('button', {
          type: 'button',
          onclick: () => {
            if (!selected) return;
            const macros = { ...state.prefs.macros };
            delete macros[selected];
            setPrefs({ macros });
            selected = Object.keys(macros)[0] ?? null;
            load();
            draw();
          },
        }, 'Delete'),
        h('button', {
          type: 'button', disabled: !state.me,
          title: state.me ? 'Run it now' : 'Sign in to run macros',
          onclick: async () => { if (save()) { dlg.close(); await submitText(`/${selected}`); } },
        }, 'Run now')),
      h('p.hint', 'Run a macro by typing /name in the say box. Macros are saved with your account.')),
    actions: [
      { label: 'Save', primary: true, onclick: () => { save(); } },
      { label: 'Close', onclick: (c) => c() },
    ],
  });
  void bus;
}
