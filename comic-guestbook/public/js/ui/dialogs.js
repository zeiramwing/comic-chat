// Informational and settings dialogs.

import { h, formatTime, ago } from '../lib/dom.js';
import { state, bus, isOwner, isFavorite, isIgnored } from '../state.js';
import { get, patch } from '../api.js';
import { setPrefs } from '../prefs.js';
import { loadRoom, rebuild } from '../data.js';
import { openDialog } from './dialog.js';
import { ignoreUser, setFavorite, banMember, unbanMember } from '../actions.js';
import { HELP } from '../commands.js';
import { linkify } from './textview.js';

const toast = (text, error = false) => bus.emit('toast', { text, error });

/** Only ever link to http(s) addresses, whatever the server says. */
export function safeUrl(u) {
  try {
    const url = new URL(u);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Profiles

export async function openProfile(id, art) {
  let u = state.users.get(id);
  try { u = (await get(`/api/users/${id}`)).user; } catch { /* fall back to the directory entry */ }
  if (!u) { toast('That member is not here any more.', true); return; }
  const canvas = h('canvas', { width: 40, height: 40, 'aria-hidden': 'true' });
  if (u.character) art.icons().then(() => art.drawIcon(canvas, u.character));
  const charName = art.index.characters.find((c) => c.id === u.character)?.name;
  const me = state.me?.id === u.id;
  const dl = h('dl.kv',
    h('dt', 'Character'), h('dd', charName ?? '—'),
    h('dt', 'Member since'), h('dd', formatTime(u.since)),
    h('dt', 'Last seen'), h('dd', ago(u.lastSeen)),
    h('dt', 'Entries'), h('dd', String(u.posts ?? 0)),
    h('dt', 'Home page'), h('dd', safeUrl(u.homepage) ? h('a', { href: safeUrl(u.homepage), target: '_blank', rel: 'noopener noreferrer nofollow' }, u.homepage) : '—'));
  const dlg = openDialog({
    title: `Profile — ${u.name}`,
    body: h('div',
      h('div.row-actions', canvas, h('strong', u.name), u.owner ? h('span.badge', 'Host') : null),
      dl,
      h('h3', 'About'),
      h('p', { class: 'profile-text' }, ...(u.profile ? linkify(u.profile) : ['This person is too lazy to create a profile entry.'])),
    ),
    actions: [
      me ? null : { label: isFavorite(u.id) ? 'Unfavorite' : 'Favorite', onclick: (c) => { setFavorite(u.id, !isFavorite(u.id)); c(); } },
      me ? null : { label: isIgnored(u.id) ? 'Stop ignoring' : 'Ignore', onclick: (c) => { ignoreUser(u.id, !isIgnored(u.id)); c(); } },
      me || !state.me ? null : { label: `Talk to ${u.name}`, onclick: (c) => { bus.emit('address', u.id); c(); } },
      { label: 'Close', primary: true, onclick: (c) => c() },
    ].filter(Boolean),
  });
  return dlg;
}

// ---------------------------------------------------------------------------
// Lists of members

function memberList({ filter, empty, art, actions }) {
  const people = [...state.users.values()].filter(filter).sort((a, b) => a.name.localeCompare(b.name));
  const ul = h('ul');
  for (const u of people) {
    const canvas = h('canvas', { width: 40, height: 40, class: 'mi', 'aria-hidden': 'true' });
    if (u.character) art.icons().then(() => art.drawIcon(canvas, u.character));
    ul.append(h('li',
      h('span.row-actions', canvas, h('span', u.name)),
      h('span.row-actions', ...actions(u))));
  }
  return h('div.list-box', people.length ? ul : h('p.none', empty));
}

export function openUserList(art) {
  const search = h('input', { type: 'search', placeholder: 'Find a member…', 'aria-label': 'Find a member' });
  const holder = h('div');
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    holder.replaceChildren(memberList({
      art, empty: 'No members match.',
      filter: (u) => !q || u.name.toLowerCase().includes(q),
      actions: (u) => [
        h('button', { type: 'button', onclick: () => openProfile(u.id, art) }, 'Profile'),
        isFavorite(u.id)
          ? h('button', { type: 'button', onclick: () => { setFavorite(u.id, false); draw(); } }, '★')
          : h('button', { type: 'button', title: 'Add to favorites', onclick: () => { setFavorite(u.id, true); draw(); } }, '☆'),
        isOwner() && !u.owner && u.id !== state.me?.id
          ? (u.banned
            ? h('button', { type: 'button', onclick: async () => { await unbanMember(u.id); draw(); } }, 'Unban')
            : h('button.danger', { type: 'button', onclick: async () => { await banMember(u.id); draw(); } }, 'Ban'))
          : null,
      ],
    }));
  };
  search.addEventListener('input', draw);
  draw();
  openDialog({ title: `User list (${state.users.size})`, body: h('div', search, holder), actions: [{ label: 'Close', primary: true, onclick: (c) => c() }] });
}

export function openFavorites(art) {
  const holder = h('div');
  const notify = h('input', { type: 'checkbox', id: 'nf-fav', checked: state.prefs.notifyFavorites, onchange: () => setPrefs({ notifyFavorites: notify.checked }) });
  const mention = h('input', { type: 'checkbox', id: 'nf-men', checked: state.prefs.notifyMentions, onchange: () => setPrefs({ notifyMentions: mention.checked }) });
  const draw = () => holder.replaceChildren(memberList({
    art, empty: 'No favorites yet. Choose a member in the member list and pick “Add to favorites”.',
    filter: (u) => isFavorite(u.id),
    actions: (u) => [
      h('button', { type: 'button', onclick: () => openProfile(u.id, art) }, 'Profile'),
      h('button', { type: 'button', onclick: () => { setFavorite(u.id, false); draw(); } }, 'Remove'),
    ],
  }));
  draw();
  openDialog({
    title: 'Favorites & notifications',
    body: h('div', holder,
      h('h3', 'Tell me when…'),
      h('p', h('label', notify, ' a favorite signs the guestbook')),
      h('p', h('label', mention, ' someone mentions me with @' + (state.me?.display ?? 'my name')))),
    actions: [{ label: 'Close', primary: true, onclick: (c) => c() }],
  });
}

export function openIgnored(art) {
  const holder = h('div');
  const draw = () => holder.replaceChildren(memberList({
    art, empty: 'You are not ignoring anyone.',
    filter: (u) => isIgnored(u.id),
    actions: (u) => [h('button', { type: 'button', onclick: () => { ignoreUser(u.id, false); draw(); } }, 'Stop ignoring')],
  }));
  draw();
  openDialog({
    title: 'Ignored members',
    body: h('div', h('p.hint', 'Entries from ignored members are hidden from your strip. Only you are affected.'), holder),
    actions: [{ label: 'Close', primary: true, onclick: (c) => c() }],
  });
}

// ---------------------------------------------------------------------------
// Room

export function openRoomProps(art) {
  const r = state.room;
  const owner = isOwner();
  const err = h('div.error', { role: 'alert' });
  const name = h('input', { type: 'text', id: 'rp-name', value: r.name, maxlength: 32, disabled: !owner });
  const topic = h('input', { type: 'text', id: 'rp-topic', value: r.topic, maxlength: 200, disabled: !owner });
  const motd = h('textarea', { id: 'rp-motd', rows: 4, maxlength: 500, disabled: !owner }, r.motd);
  const backdrop = h('select', { id: 'rp-bd', disabled: !owner },
    ...art.index.backdrops.map((b) => h('option', { value: b.id, selected: b.id === r.defaultBackdrop }, b.name)));
  const scenes = h('input', { type: 'checkbox', id: 'rp-sc', checked: r.sceneChanges, disabled: !owner });
  const row = (label, input) => [h('label', { for: input.id }, label), input];
  const body = h('form.form-grid', { onsubmit: (e) => e.preventDefault() },
    ...row('Room name', name), ...row('Topic', topic), ...row('Message of the day', motd),
    ...row('Default backdrop', backdrop),
    h('div.full', h('label', scenes, ' Let members start new scenes (change the backdrop)')),
    h('div.full', h('p.hint', `${r.entries} entries in this room. ${owner ? '' : 'Only the host can change these settings.'}`)),
    h('div.full', err));
  openDialog({
    title: owner ? 'Room properties' : 'Room information',
    body,
    actions: owner ? [
      {
        label: 'Save', primary: true,
        onclick: async (close, btn) => {
          try {
            await patch('/api/room', {
              name: name.value, topic: topic.value, motd: motd.value,
              defaultBackdrop: backdrop.value, sceneChanges: scenes.checked,
            });
            await loadRoom();
            rebuild();
            toast('Room settings saved.');
            close();
          } catch (e) { err.textContent = e.message; btn.disabled = false; }
        },
      },
      { label: 'Cancel', onclick: (c) => c() },
    ] : [{ label: 'Close', primary: true, onclick: (c) => c() }],
  });
}

export function openRoomList() {
  const r = state.room;
  openDialog({
    title: 'Room list',
    body: h('div',
      h('div.list-box', h('ul', h('li.sel', h('span', `# ${r.name}`), h('span', `${r.entries} entries · ${state.users.size} members`)))),
      h('p.hint', 'Live rooms — create your own, invite friends, whisper — arrive with phase 2. For now there is one room: this guestbook.')),
    actions: [{ label: 'Close', primary: true, onclick: (c) => c() }],
  });
}

export function openMotd(auto = false) {
  const r = state.room;
  if (!r.motd) { if (!auto) toast('There is no message of the day.'); return; }
  openDialog({
    title: 'Message of the day',
    body: h('p', { class: 'motd-text' }, ...linkify(r.motd)),
    actions: [{ label: 'OK', primary: true, onclick: (c) => { setPrefs({ seenMotd: r.motd }); c(); } }],
  });
}

// ---------------------------------------------------------------------------
// Options

export function openOptions() {
  const p = state.prefs;
  const check = (key, label, hint) => h('div.full',
    h('label', h('input', { type: 'checkbox', checked: p[key], onchange: (e) => setPrefs({ [key]: e.target.checked }) }), ` ${label}`),
    hint ? h('div.hint', hint) : null);
  const perRow = h('select', { id: 'op-cols', onchange: () => setPrefs({ panelsPerRow: Number(perRow.value) }) },
    ...[[0, 'Fit to the window'], [1, '1'], [2, '2'], [3, '3'], [4, '4']].map(([v, t]) => h('option', { value: v, selected: p.panelsPerRow === v }, t)));
  openDialog({
    title: 'Options',
    body: h('form.form-grid', { onsubmit: (e) => e.preventDefault() },
      h('label', { for: 'op-cols' }, 'Panels per row'), perRow,
      check('showNames', 'Show names under characters'),
      check('autoExpress', 'Choose expressions from what I type', 'Shouting in CAPITALS, :) smileys, “lol”, “Hi”, “I”, “you”… make your character react. The emotion wheel always wins.'),
      check('halo', 'White aura around characters'),
      check('bigText', 'Larger balloon text'),
      check('sounds', 'Play sounds'),
      h('div.full', h('hr')),
      h('div.full', h('button', {
        type: 'button',
        onclick: () => { setPrefs({ clearedBefore: 0, ignore: [] }); rebuild(); toast('History and ignore list restored.'); },
      }, 'Show all history and stop ignoring everyone')),
    ),
    actions: [{ label: 'Close', primary: true, onclick: (c) => c() }],
  });
}

// ---------------------------------------------------------------------------
// Help and About

export function openHelp(commands = false) {
  const cmdList = h('dl.kv', ...HELP.flatMap(([c, d]) => [h('dt', h('code', c)), h('dd', d)]));
  openDialog({
    title: commands ? 'Commands' : 'Help',
    wide: true,
    body: commands ? cmdList : h('div.help',
      h('h3', 'Signing the guestbook'),
      h('p', 'Create an account, pick a character, type a message and press Say. Your entry becomes the next panel in the strip. Think shows a thought bubble; Action shows a narration box.'),
      h('h3', 'The emotion wheel'),
      h('p', 'Drag on the wheel under the member list: the direction chooses the emotion (happy, coy, bored, scared, sad, angry, shout, laugh) and the distance from the centre chooses how strongly. The middle is neutral. Freeze keeps your expression for the next message; “Send expression” shows your character reacting without a word.'),
      h('p', 'Leave the wheel alone and Comic Guestbook reads your message instead: SHOUTING, “!!!”, “:)”, “;)”, “lol”, “Hi”, “I…” and “You…” all change how your character looks.'),
      h('h3', 'Formatting'),
      h('p', 'Use the B I U buttons, Fixed, Σ (symbol font) and Color, or type BBCode: [b]bold[/b], [i]italic[/i], [u]underline[/u], [fixed]fixed[/fixed], [sym]symbol[/sym], [color=#ff0000]red[/color]. Write \\[ for a literal bracket.'),
      h('h3', 'Talking to someone'),
      h('p', 'Choose To… or type @Name. The characters turn to face each other and the person you address joins the panel.'),
      h('h3', 'Commands, macros and shortcuts'),
      h('p', 'Type /help for commands. Define macros in Macros → Define macro, then run one by typing /name. Up and Down recall what you typed before. Ctrl+B / I / U / K format text. F1 opens this help.'),
      h('h3', 'Plain text view'),
      h('p', 'View → Plain text shows the same entries as a chat log: good for screen readers, copying, and slow connections.'),
      h('h3', 'Privacy'),
      h('p', 'The guestbook stores your message text, your chosen character and expression, your signature name and the time. Passwords are stored only as salted hashes. Pictures of the panels are drawn in your browser and are never saved on the server.'),
    ),
    actions: [{ label: 'Close', primary: true, onclick: (c) => c() }],
  });
}

export function openAbout(art) {
  const credit = [...new Set(art.index.characters.map((c) => c.name))].slice(0, 60);
  openDialog({
    title: 'About Comic Guestbook',
    wide: true,
    body: h('div.help',
      h('p', h('strong', state.site.title), ' · version 0.1 (phase 1: the guestbook)'),
      h('p', 'A guestbook where every entry becomes a panel in one never-ending comic strip, in the style of Microsoft Comic Chat (1996).'),
      h('h3', 'Credits'),
      h('p', 'Characters, backdrops and the emotion-wheel faces are from Microsoft Comic Chat, © Microsoft Corporation 1995–1998 (character art by Jim Woodring and others), as published in Microsoft’s open-source Comic Chat repository (MIT License). See NOTICES.txt.'),
      h('p', `Characters: ${credit.join(', ')}.`),
      h('p', 'Balloon text is set in Comic Neue (SIL Open Font License 1.1).'),
      h('p', 'Not affiliated with or endorsed by Microsoft.')),
    actions: [{ label: 'OK', primary: true, onclick: (c) => c() }],
  });
}
