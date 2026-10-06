// Sign-in / registration, and the "My profile" dialog.

import { h } from '../lib/dom.js';
import { state, bus } from '../state.js';
import { post, patch, del, ApiError } from '../api.js';
import { adoptLocalPrefsIfNew } from '../prefs.js';
import { loadUsers } from '../data.js';
import { openDialog, confirmDialog } from './dialog.js';
import { signOut } from '../actions.js';

function field(label, input, hint) {
  return [h('label', { for: input.id }, label), h('div', input, hint ? h('div.hint', hint) : null)];
}

async function afterAuth(user) {
  state.me = user;
  adoptLocalPrefsIfNew();
  if (user.character) state.composer.character = user.character;
  bus.emit('me', state.me);
  await loadUsers().catch(() => {});
}

export function openAuth(mode = 'login') {
  let current = mode;
  const err = h('div.error', { role: 'alert' });
  const username = h('input', { type: 'text', id: 'au-user', autocomplete: 'username', autocapitalize: 'off', spellcheck: false, required: true, maxlength: 24 });
  const password = h('input', { type: 'password', id: 'au-pass', required: true, maxlength: 200 });
  const display = h('input', { type: 'text', id: 'au-name', autocomplete: 'nickname', maxlength: 32 });
  const body = h('div');
  const tabs = h('div.tabs', { role: 'tablist' });
  const grid = h('form.form-grid', { novalidate: false });
  let dlg;

  const submitBtn = h('button.default', { type: 'submit' }, 'Sign in');

  const draw = () => {
    const reg = current === 'register';
    password.autocomplete = reg ? 'new-password' : 'current-password';
    submitBtn.textContent = reg ? 'Create account' : 'Sign in';
    tabs.replaceChildren(
      h('button', { type: 'button', role: 'tab', 'aria-selected': String(!reg), onclick: () => { current = 'login'; err.textContent = ''; draw(); } }, 'Sign in'),
      h('button', { type: 'button', role: 'tab', 'aria-selected': String(reg), onclick: () => { current = 'register'; err.textContent = ''; draw(); } }, 'Create account'),
    );
    grid.replaceChildren(
      ...field('Username', username, reg ? '3–24 letters, digits, _ . -  (never shown to others)' : null),
      ...field('Password', password, reg ? 'At least 8 characters.' : null),
      ...(reg ? field('Sign as', display, 'The name that appears on your entries. Leave blank to use your username.') : []),
      h('div.full', err),
      h('div.full', { class: 'dlg-actions-inline' }, submitBtn),
    );
  };

  grid.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.textContent = '';
    submitBtn.disabled = true;
    try {
      const reg = current === 'register';
      const payload = { username: username.value.trim(), password: password.value };
      if (reg) {
        payload.display = display.value.trim() || username.value.trim();
        const c = state.composer.character;
        if (c) payload.character = c;
      }
      const { user } = await post(reg ? '/api/register' : '/api/login', payload);
      await afterAuth(user);
      dlg.close();
      bus.emit('toast', { text: reg ? `Welcome, ${user.display}! Pick a character and say hello.` : `Welcome back, ${user.display}.` });
      if (reg && !user.character) bus.emit('pick-character');
    } catch (e) {
      err.textContent = e instanceof ApiError ? e.message : 'Something went wrong. Please try again.';
    } finally {
      submitBtn.disabled = false;
    }
  });

  body.append(tabs, h('div.tabpane', grid));
  draw();
  dlg = openDialog({ title: 'Comic Guestbook account', body });
  return dlg;
}

/** "My profile": signature name, profile text, home page, password, closing the account. */
export function openMyProfile() {
  const me = state.me;
  if (!me) { openAuth('login'); return; }
  const err = h('div.error', { role: 'alert' });
  const name = h('input', { type: 'text', id: 'mp-name', value: me.display, maxlength: 32 });
  const prof = h('textarea', { id: 'mp-prof', rows: 4, maxlength: 500 }, me.profile ?? '');
  const home = h('input', { type: 'url', id: 'mp-home', value: me.homepage ?? '', placeholder: 'https://', maxlength: 200 });
  const form = h('form.form-grid',
    ...field('Signature name', name, 'Shown on your entries. Changing it does not rewrite old entries.'),
    ...field('Profile', prof, 'Up to 500 characters. Shown when someone chooses “Get profile”.'),
    ...field('Home page', home),
    h('div.full', err));
  let dlg;
  const save = async (close, btn) => {
    err.textContent = '';
    try {
      const { user } = await patch('/api/me', { display: name.value, profile: prof.value, homepage: home.value });
      state.me = { ...state.me, ...user };
      bus.emit('me', state.me);
      await loadUsers().catch(() => {});
      bus.emit('toast', { text: 'Profile saved.' });
      close();
    } catch (e) { err.textContent = e.message; btn.disabled = false; }
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); save(dlg.close, form.querySelector('button')); });
  dlg = openDialog({
    title: 'My profile',
    body: h('div', form,
      h('div.row-actions',
        h('button', { type: 'button', onclick: () => { dlg.close(); openChangePassword(); } }, 'Change password…'),
        h('button.danger', { type: 'button', onclick: () => { dlg.close(); openCloseAccount(); } }, 'Close my account…'))),
    actions: [
      { label: 'Save', primary: true, onclick: save },
      { label: 'Cancel', onclick: (c) => c() },
    ],
  });
}

function openChangePassword() {
  const err = h('div.error', { role: 'alert' });
  const oldP = h('input', { type: 'password', id: 'cp-old', autocomplete: 'current-password' });
  const newP = h('input', { type: 'password', id: 'cp-new', autocomplete: 'new-password' });
  openDialog({
    title: 'Change password',
    body: h('form.form-grid', { onsubmit: (e) => e.preventDefault() },
      ...field('Current password', oldP), ...field('New password', newP, 'At least 8 characters. You will stay signed in here; other devices are signed out.'), h('div.full', err)),
    actions: [
      {
        label: 'Change password', primary: true,
        onclick: async (close, btn) => {
          try {
            await post('/api/me/password', { oldPassword: oldP.value, newPassword: newP.value });
            bus.emit('toast', { text: 'Password changed.' });
            close();
          } catch (e) { err.textContent = e.message; btn.disabled = false; }
        },
      },
      { label: 'Cancel', onclick: (c) => c() },
    ],
  });
}

function openCloseAccount() {
  const err = h('div.error', { role: 'alert' });
  const pass = h('input', { type: 'password', id: 'ca-pass', autocomplete: 'current-password' });
  const wipe = h('input', { type: 'checkbox', id: 'ca-wipe' });
  openDialog({
    title: 'Close my account',
    body: h('div',
      h('p', 'Your account will be closed and you will be signed out. Your entries stay in the strip under the name “Departed”, unless you choose to remove them.'),
      h('form.form-grid', { onsubmit: (e) => e.preventDefault() },
        ...field('Password', pass),
        h('div.full', h('label', wipe, ' Also remove all my entries from the guestbook')),
        h('div.full', err))),
    actions: [
      {
        label: 'Close account', danger: true,
        onclick: async (close, btn) => {
          if (!(await confirmDialog('This cannot be undone. Close your account?', { yes: 'Close account', danger: true }))) { btn.disabled = false; return; }
          try {
            await del('/api/me', { password: pass.value, deleteEntries: wipe.checked });
            state.me = null;
            bus.emit('me', null);
            close();
            bus.emit('reload-all');
            bus.emit('toast', { text: 'Your account is closed. Goodbye!' });
          } catch (e) { err.textContent = e.message; btn.disabled = false; }
        },
      },
      { label: 'Keep my account', onclick: (c) => c() },
    ],
  });
}

export { signOut };
