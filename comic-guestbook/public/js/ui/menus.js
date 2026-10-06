// The menu bar and toolbar. The structure follows Microsoft Chat 2.5's: File,
// Edit, View, Format, Room, Member, Favorites, Help. Items that belong to live
// chat (rooms, whispers, away…) are shown but disabled with a note, so it is
// clear what phase 2 brings; items that cannot exist on the web (NetMeeting,
// Create Shortcut, window tiling…) are left out.

import { h } from '../lib/dom.js';
import { state, bus, isOwner } from '../state.js';
import { setPrefs } from '../prefs.js';
import { clearHistory, showAllHistory, signOut, pingServer } from '../actions.js';

const SOON = 'Arrives with live chat in phase 2';

/** Build the menu model from current state. Called each time a menu opens. */
export function menuModel(app) {
  const me = state.me;
  const p = state.prefs;
  const owner = isOwner();
  const ev = (name, arg) => () => bus.emit(name, arg);
  const tog = (key) => () => setPrefs({ [key]: !p[key] });
  const ta = () => app.sayBar?.ta;
  const exec = (cmd) => () => { ta()?.focus(); document.execCommand(cmd); };

  return [
    { label: 'File', items: [
      me ? { label: 'Sign out', onclick: signOut } : { label: 'Sign in…', onclick: ev('open-auth', 'login') },
      me ? null : { label: 'Create an account…', onclick: ev('open-auth', 'register') },
      '-',
      { label: 'Save comic as picture…', onclick: ev('open-export', 'png') },
      { label: 'Save transcript as text…', onclick: ev('open-export', 'txt') },
      { label: 'Back up the guestbook (JSON)…', onclick: ev('open-export', 'json') },
      '-',
      { label: 'Print…', accel: 'Ctrl+P', onclick: ev('open-export', 'print') },
    ] },
    { label: 'Edit', items: [
      { label: 'Undo', accel: 'Ctrl+Z', disabled: !me, onclick: exec('undo') },
      { label: 'Cut', accel: 'Ctrl+X', disabled: !me, onclick: exec('cut') },
      { label: 'Copy', accel: 'Ctrl+C', onclick: () => document.execCommand('copy') },
      { label: 'Paste', accel: 'Ctrl+V', disabled: !me, onclick: async () => { ta()?.focus(); try { const t = await navigator.clipboard.readText(); ta()?.setRangeText(t, ta().selectionStart, ta().selectionEnd, 'end'); ta()?.dispatchEvent(new Event('input')); } catch { bus.emit('toast', { text: 'Use Ctrl+V to paste.' }); } } },
      { label: 'Select all', accel: 'Ctrl+A', onclick: () => { (me ? ta() : null)?.select(); } },
      '-',
      p.clearedBefore ? { label: 'Show all history', onclick: showAllHistory } : { label: 'Clear history', onclick: clearHistory },
    ] },
    { label: 'View', items: [
      { label: 'Toolbar', checked: p.showToolbar, onclick: tog('showToolbar') },
      { label: 'Member list', checked: p.showMembers, onclick: tog('showMembers') },
      { label: 'Status bar', checked: p.showStatus, onclick: tog('showStatus') },
      '-',
      { label: 'Comic strip', checked: p.view === 'comic', onclick: () => setPrefs({ view: 'comic' }) },
      { label: 'Plain text', checked: p.view === 'text', onclick: () => setPrefs({ view: 'text' }) },
      '-',
      { label: 'Member list as a list', checked: p.memberView === 'list', onclick: () => setPrefs({ memberView: 'list' }) },
      { label: 'Member list as icons', checked: p.memberView === 'icons', onclick: () => setPrefs({ memberView: 'icons' }) },
      '-',
      { label: 'Panels per row: fit window', checked: p.panelsPerRow === 0, onclick: () => setPrefs({ panelsPerRow: 0 }) },
      ...[1, 2, 3, 4].map((n) => ({ label: `Panels per row: ${n}`, checked: p.panelsPerRow === n, onclick: () => setPrefs({ panelsPerRow: n }) })),
      '-',
      { label: 'Message of the day', onclick: ev('show-motd') },
      { label: p.sounds ? 'Turn off sounds' : 'Turn on sounds', onclick: tog('sounds') },
      { label: 'Notifications…', onclick: ev('open-notifications') },
    ] },
    { label: 'Macros', items: [
      { label: 'Define macro…', onclick: ev('open-macros') },
      { label: 'Automation…', onclick: ev('open-rules') },
      '-',
      { label: 'Options…', onclick: ev('open-options') },
    ] },
    { label: 'Format', items: [
      { label: 'Color…', accel: 'Ctrl+K', disabled: !me, onclick: () => app.sayBar?.colorMenu(null) },
      { label: 'Bold', accel: 'Ctrl+B', disabled: !me, onclick: () => app.sayBar?.wrap('b') },
      { label: 'Italic', accel: 'Ctrl+I', disabled: !me, onclick: () => app.sayBar?.wrap('i') },
      { label: 'Underline', accel: 'Ctrl+U', disabled: !me, onclick: () => app.sayBar?.wrap('u') },
      { label: 'Fixed pitch font', disabled: !me, onclick: () => app.sayBar?.wrap('fixed') },
      { label: 'Symbol font', disabled: !me, onclick: () => app.sayBar?.wrap('sym') },
    ] },
    { label: 'Room', items: [
      { label: 'Enter room…', disabled: true, title: SOON },
      { label: 'Leave room', disabled: true, title: SOON },
      { label: 'Create room…', disabled: true, title: SOON },
      { label: 'Room list…', onclick: ev('open-roomlist') },
      '-',
      { label: owner ? 'Room properties…' : 'Room information…', onclick: ev('open-room-props') },
      owner ? { label: 'Sync backdrop (set the default scene)…', onclick: ev('open-room-props') } : null,
    ] },
    { label: 'Member', items: [
      { label: 'User list…', onclick: ev('open-userlist') },
      { label: 'Invite…', disabled: true, title: SOON },
      { label: 'Away from keyboard…', disabled: true, title: SOON },
      '-',
      { label: 'My profile…', disabled: !me, onclick: ev('open-my-profile') },
      { label: 'Get profile…', onclick: ev('open-userlist') },
      { label: 'Whisper box…', disabled: true, title: SOON },
      '-',
      { label: 'Ignored members…', onclick: ev('open-ignored') },
      { label: 'Lag time', onclick: () => pingServer().catch(() => bus.emit('toast', { text: 'The server did not answer.', error: true })) },
      { label: 'Version', onclick: ev('open-about') },
    ] },
    { label: 'Favorites', items: [
      { label: 'Add a member to favorites…', onclick: ev('open-userlist') },
      { label: 'Open favorites…', onclick: ev('open-favorites') },
    ] },
    { label: 'Help', items: [
      { label: 'Help topics', accel: 'F1', onclick: ev('open-help') },
      { label: 'Commands', onclick: ev('show-help') },
      { label: 'About Comic Guestbook', onclick: ev('open-about') },
    ] },
  ].map((m) => ({ ...m, items: m.items.filter(Boolean) }));
}

export class MenuBar {
  constructor(el, app) {
    this.el = el;
    this.app = app;
    this.open = null;
    this.burger = h('button.menu-burger', {
      type: 'button', 'aria-label': 'Menu', 'aria-expanded': 'false',
      onclick: () => { const o = !el.classList.contains('open'); el.classList.toggle('open', o); this.burger.setAttribute('aria-expanded', String(o)); },
    }, '☰ Menu');
    this.render();
    document.addEventListener('pointerdown', (e) => { if (!el.contains(e.target)) this.close(); });
    el.addEventListener('keydown', (e) => this.#key(e));
    bus.on('me', () => this.close());
  }

  render() {
    this.el.replaceChildren(this.burger);
    this.menus = menuModel(this.app).map((m) => {
      const btn = h('button.menu-btn', {
        type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false',
        onclick: () => this.toggle(m.label), onpointerenter: () => { if (this.open && this.open !== m.label) this.toggle(m.label, true); },
      }, m.label);
      const wrap = h('div.menu', btn);
      wrap.dataset.label = m.label;
      this.el.append(wrap);
      return { label: m.label, wrap, btn };
    });
  }

  toggle(label, force) {
    const wasOpen = this.open === label && !force;
    this.close();
    if (wasOpen) return;
    const entry = this.menus.find((m) => m.label === label);
    const model = menuModel(this.app).find((m) => m.label === label);
    if (!entry || !model) return;
    this.open = label;
    entry.btn.setAttribute('aria-expanded', 'true');
    const list = h('ul.menu-list', { role: 'menu' });
    for (const it of model.items) {
      if (it === '-') { list.append(h('li.menu-sep', { role: 'separator' })); continue; }
      list.append(h('li', { role: 'none' }, h('button.menu-item', {
        type: 'button', role: it.checked !== undefined ? 'menuitemcheckbox' : 'menuitem',
        'aria-checked': it.checked !== undefined ? String(!!it.checked) : null,
        disabled: it.disabled, title: it.title,
        onclick: () => { this.close(); this.el.classList.remove('open'); it.onclick?.(); },
      }, h('span.check', it.checked ? '✓' : ''), h('span', it.label), it.accel ? h('span.accel', it.accel) : null)));
    }
    entry.wrap.append(list);
    list.querySelector('button:not(:disabled)')?.focus();
  }

  close() {
    if (!this.open) return;
    const entry = this.menus.find((m) => m.label === this.open);
    entry?.wrap.querySelector('.menu-list')?.remove();
    entry?.btn.setAttribute('aria-expanded', 'false');
    this.open = null;
  }

  #key(e) {
    if (e.key === 'Escape' && this.open) {
      const b = this.menus.find((m) => m.label === this.open)?.btn;
      this.close();
      b?.focus();
      return;
    }
    const i = this.menus.findIndex((m) => m.btn === document.activeElement || m.wrap.contains(document.activeElement));
    if (i < 0) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const n = this.menus[(i + (e.key === 'ArrowRight' ? 1 : this.menus.length - 1)) % this.menus.length];
      if (this.open) this.toggle(n.label, true); else n.btn.focus();
    } else if (e.key === 'ArrowDown' && document.activeElement === this.menus[i].btn) {
      e.preventDefault();
      this.toggle(this.menus[i].label, true);
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && this.open) {
      e.preventDefault();
      const btns = [...this.menus[i].wrap.querySelectorAll('.menu-item:not(:disabled)')];
      const j = btns.indexOf(document.activeElement);
      btns[(j + (e.key === 'ArrowDown' ? 1 : btns.length - 1)) % btns.length]?.focus();
    }
  }
}

export class Toolbar {
  constructor(el) {
    this.el = el;
    bus.on('prefs', () => this.render());
    bus.on('me', () => this.render());
    this.render();
  }

  render() {
    const p = state.prefs;
    const btn = (icon, label, title, onclick, pressed, cls = '') => h('button', {
      type: 'button', title, class: cls, 'aria-pressed': pressed === undefined ? null : String(pressed), onclick,
    }, h('span.ico', { 'aria-hidden': 'true' }, icon), h('span.label', label));
    this.el.hidden = !p.showToolbar;
    this.el.replaceChildren(
      btn('💬', 'Comic', 'Comic strip view', () => setPrefs({ view: 'comic' }), p.view === 'comic'),
      btn('📃', 'Text', 'Plain text view', () => setPrefs({ view: 'text' }), p.view === 'text'),
      h('span.sep'),
      btn('👥', 'Members', 'Show or hide the member list', () => {
        if (matchMedia('(max-width: 860px)').matches) document.body.classList.toggle('show-side');
        else setPrefs({ showMembers: !p.showMembers });
      }, p.showMembers),
      btn(p.sounds ? '🔔' : '🔕', 'Sounds', p.sounds ? 'Sounds are on' : 'Sounds are off', () => setPrefs({ sounds: !p.sounds }), p.sounds),
      h('span.sep'),
      btn('🎭', 'Character', 'Choose your character', () => bus.emit('pick-character'), undefined, 'hide-sm'),
      btn('🖼', 'Scene', 'Start a new scene', () => bus.emit('pick-backdrop'), undefined, 'hide-sm'),
      h('span.sep'),
      btn('💾', 'Save', 'Save the comic as a picture', () => bus.emit('open-export', 'png')),
      btn('🖨', 'Print', 'Print', () => bus.emit('open-export', 'print'), undefined, 'hide-sm'),
      btn('⚙', 'Options', 'Options', () => bus.emit('open-options')),
      btn('❔', 'Help', 'Help', () => bus.emit('open-help'), undefined, 'hide-sm'),
    );
  }
}
