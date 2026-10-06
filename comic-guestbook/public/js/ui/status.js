import { h } from '../lib/dom.js';
import { state, bus } from '../state.js';
import { emotionLabel } from '../shared/emotion.js';

export class StatusBar {
  constructor(el) {
    this.el = el;
    this.msg = h('span', { role: 'status', 'aria-live': 'polite' }, 'Ready');
    this.count = h('span');
    this.members = h('span');
    this.net = h('span');
    el.append(this.msg, this.count, this.members, this.net);
    bus.on('composer', () => { this.msg.textContent = `Emotion is ${emotionLabel(state.composer.em)}${state.composer.frozen ? ' (frozen)' : ''}`; });
    bus.on('entries', () => this.refresh());
    bus.on('panels', () => this.refresh());
    bus.on('users', () => this.refresh());
    bus.on('online', () => this.refresh());
    bus.on('status', (t) => { this.msg.textContent = t; });
    bus.on('prefs', () => { el.hidden = !state.prefs.showStatus; });
    this.refresh();
  }

  refresh() {
    this.count.textContent = `${state.entries.length} entries`;
    this.members.textContent = `${state.users.size} members`;
    this.net.textContent = state.online ? 'Connected' : 'Offline — retrying…';
    this.el.hidden = !state.prefs.showStatus;
  }
}
