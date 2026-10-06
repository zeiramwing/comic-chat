// Character and backdrop pickers.

import { h } from '../lib/dom.js';
import { state, bus, isOwner } from '../state.js';
import { openDialog } from './dialog.js';
import { patch } from '../api.js';

export function openCharacterPicker(art) {
  const chars = art.index.characters;
  const current = state.composer.character || state.me?.character || '';
  const grid = h('div.char-grid', { role: 'group', 'aria-label': 'Characters' });
  let dlg;
  const info = h('p.hint');
  for (const c of chars) {
    const canvas = h('canvas', { width: 40, height: 40, 'aria-hidden': 'true' });
    art.icons().then(() => art.drawIcon(canvas, c.id));
    grid.append(h('button', {
      type: 'button', 'aria-pressed': String(c.id === current), title: c.name,
      onclick: async () => {
        state.composer.character = c.id;
        bus.emit('composer');
        dlg.close();
        if (state.me && state.me.character !== c.id) {
          try { await patch('/api/me', { character: c.id }); state.me.character = c.id; } catch { /* saved with the next post anyway */ }
        }
      },
    }, canvas, h('span.cn', c.name)));
  }
  info.textContent = 'Characters from Microsoft Comic Chat, by Jim Woodring and others.';
  dlg = openDialog({
    title: 'Choose your character',
    body: h('div', grid, info),
    actions: [{ label: 'Cancel', onclick: (c) => c() }],
  });
}

export function openBackdropPicker(art) {
  const room = state.room;
  const allowed = room?.sceneChanges || isOwner();
  const grid = h('div.backdrop-grid', { role: 'group', 'aria-label': 'Backdrops' });
  let dlg;
  const pick = (id) => { state.composer.backdrop = id; bus.emit('composer'); dlg.close(); };
  for (const b of art.index.backdrops) {
    grid.append(h('button', {
      type: 'button', disabled: !allowed, title: b.name, 'aria-pressed': String(state.composer.backdrop === b.id),
      onclick: () => pick(b.id),
    }, h('img', { src: art.url(`backdrops/${b.file}`), alt: '', width: 90, height: 90, loading: 'lazy' }), h('span', b.name)));
  }
  dlg = openDialog({
    title: 'Start a new scene',
    body: h('div',
      h('p', allowed
        ? 'Your next entry will start a new panel in front of this backdrop. Later entries keep it until someone changes it.'
        : 'The host has turned off scene changes.'),
      grid),
    actions: [
      { label: 'Keep the current scene', onclick: () => pick(null) },
      { label: 'Cancel', onclick: (c) => c() },
    ],
  });
}
