import { Emitter } from './lib/events.js';

export const bus = new Emitter();

export const DEFAULT_PREFS = {
  view: 'comic', // 'comic' | 'text'
  panelsPerRow: 0, // 0 = fit the window
  showNames: true,
  autoExpress: true, // choose expressions from the text
  halo: true, // white aura around characters
  sounds: true,
  bigText: false,
  memberView: 'list', // 'list' | 'icons'
  showMembers: true,
  showToolbar: true,
  showStatus: true,
  ignore: [], // user ids
  favorites: [], // user ids
  macros: {}, // name -> text
  rules: [], // automation rule sets (see rules.js)
  clearedBefore: 0, // "Clear history": hide entries up to this id
  seenMotd: '',
  notifyFavorites: true, // chime + toast when a favorite signs
  notifyMentions: true, // ... or someone @mentions you
};

export const state = {
  site: { title: 'Comic Guestbook' },
  room: null,
  me: null,
  users: new Map(), // id -> member
  entries: [], // raw entries, oldest first
  rev: 0,
  lastId: 0,
  prefs: { ...DEFAULT_PREFS },
  composer: {
    character: '',
    em: { e: 0, i: 0 },
    frozen: false,
    to: [],
    backdrop: null,
    kind: 'say',
  },
  online: true,
};

export const isOwner = () => state.me?.role === 'owner';
export const isIgnored = (id) => state.prefs.ignore.includes(id);
export const isFavorite = (id) => state.prefs.favorites.includes(id);
