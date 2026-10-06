// The member list (Microsoft Chat's "Member list": list or large-icon view).

import { h } from '../lib/dom.js';
import { state, bus, isOwner, isFavorite, isIgnored } from '../state.js';
import { setPrefs } from '../prefs.js';
import { popupMenu } from './dialog.js';
import { ignoreUser, setFavorite, banMember, unbanMember } from '../actions.js';
import { safeUrl } from './dialogs.js';

const ACTIVE_MS = 5 * 60 * 1000;

export class Members {
  constructor(el, art) {
    this.el = el;
    this.art = art;
    bus.on('users', () => this.render());
    bus.on('prefs', () => this.render());
    bus.on('me', () => this.render());
    this.render();
  }

  list() {
    return [...state.users.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  render() {
    const icons = state.prefs.memberView === 'icons';
    this.el.classList.toggle('icons', icons);
    const people = this.list();
    const now = Date.now();
    const ul = h('ul', { role: 'list' });
    for (const u of people) {
      const canvas = h('canvas.mi', { width: 40, height: 40, 'aria-hidden': 'true' });
      if (u.character) this.art.icons().then(() => this.art.drawIcon(canvas, u.character));
      const active = now - u.lastSeen < ACTIVE_MS;
      ul.append(h('li', h('button', {
        type: 'button',
        class: `${isFavorite(u.id) ? 'fav' : ''}`,
        title: `${u.name}${u.owner ? ' (host)' : ''}${active ? ' — active just now' : ''}`,
        onclick: (e) => this.menu(u, e),
        oncontextmenu: (e) => { e.preventDefault(); this.menu(u, e); },
      },
      canvas,
      h('span.nm', { class: isIgnored(u.id) ? 'ignored' : '' }, `${active ? '● ' : ''}${u.name}`),
      u.owner ? h('span.badge', 'Host') : null,
      u.banned ? h('span.badge', 'Banned') : null)));
    }
    this.el.replaceChildren(
      h('div.head',
        h('strong', `Members (${people.length})`),
        h('span', { class: 'viewtoggle' },
          h('button', {
            type: 'button', title: state.prefs.memberView === 'icons' ? 'Show as a list' : 'Show as large icons',
            onclick: () => setPrefs({ memberView: icons ? 'list' : 'icons' }),
          }, icons ? '☰' : '▦'))),
      h('div.scroll', people.length ? ul : h('p.none', 'No one has signed yet.')),
    );
  }

  menu(u, ev) {
    const r = ev.currentTarget.getBoundingClientRect();
    const me = state.me?.id === u.id;
    const items = [
      { label: 'Get profile…', onclick: () => bus.emit('show-profile', u.id) },
      { label: `Talk to ${u.name}`, disabled: me || !state.me, onclick: () => bus.emit('address', u.id) },
      '-',
      isFavorite(u.id)
        ? { label: 'Remove from favorites', onclick: () => setFavorite(u.id, false) }
        : { label: 'Add to favorites', disabled: me, onclick: () => setFavorite(u.id, true) },
      isIgnored(u.id)
        ? { label: 'Stop ignoring', onclick: () => ignoreUser(u.id, false) }
        : { label: 'Ignore', disabled: me, onclick: () => ignoreUser(u.id, true) },
      { label: 'Visit home page', disabled: !safeUrl(u.homepage), onclick: () => window.open(safeUrl(u.homepage), '_blank', 'noopener,noreferrer') },
    ];
    if (isOwner() && !u.owner && !me) {
      items.push('-', u.banned
        ? { label: 'Lift ban', onclick: () => unbanMember(u.id) }
        : { label: 'Ban…', danger: true, onclick: () => banMember(u.id) });
    }
    popupMenu(r.left + 8, r.bottom, items);
  }
}
