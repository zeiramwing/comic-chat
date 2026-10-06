// Automation (Macros → Automation…): the editor for rule sets, and the code
// that carries out the effects the pure engine (shared/rules.js) returns.

import { h } from '../lib/dom.js';
import { state, bus, isOwner } from '../state.js';
import { setPrefs } from '../prefs.js';
import { rebuild } from '../data.js';
import { openDialog, confirmDialog } from './dialog.js';
import {
  EVENTS, ACTIONS, SOUND_NAMES, MAX_RULESETS, MAX_RULES, MAX_ACTIONS,
  newRule, newRuleSet, sanitizeRuleSets, evaluate, viewEffects, activeSet,
} from '../shared/rules.js';
import { play, beep } from '../sounds.js';
import { ignoreUser, submitText, pingServer, banMember } from '../actions.js';

const toast = (text, error = false) => bus.emit('toast', { text, error });

// ---------------------------------------------------------------------------
// Engine glue

const sets = () => sanitizeRuleSets(state.prefs.rules);
const context = () => ({
  meId: state.me?.id ?? null,
  meName: state.me?.display ?? '',
  roomName: state.room?.name ?? '',
  isHost: isOwner(),
  macros: state.prefs.macros,
});

let cachedKey = '';
let cachedSets = [];
function currentSets() {
  const key = JSON.stringify(state.prefs.rules);
  if (key !== cachedKey) { cachedKey = key; cachedSets = sanitizeRuleSets(state.prefs.rules); }
  return cachedSets;
}

/** The view hook: hide / replace / highlight entries per the active rule set. */
export function viewByRules(e) {
  const s = currentSets();
  if (!activeSet(s)) return e;
  const fx = viewEffects(e, s, context());
  if (fx.hide) return null;
  if (fx.text !== null) return { ...e, text: fx.text, fmt: null, hl: fx.highlight };
  return fx.highlight ? { ...e, hl: true } : e;
}

const fired = new Map();
const autoPosts = []; // timestamps, to keep automatic posts well inside the server's limits
const AUTO_GAP_MS = 20_000;
const AUTO_PER_10MIN = 6;

function allowAutoPost() {
  const now = Date.now();
  while (autoPosts.length && now - autoPosts[0] > 600_000) autoPosts.shift();
  if (autoPosts.length >= AUTO_PER_10MIN) return false;
  if (autoPosts.length && now - autoPosts.at(-1) < AUTO_GAP_MS) return false;
  autoPosts.push(now);
  return true;
}

async function perform(effect) {
  switch (effect.type) {
    case 'beep': beep(effect.count); break;
    case 'playSound': play(effect.sound); break;
    case 'notifyDialog': toast(effect.text); break;
    case 'ignore': if (effect.userId !== state.me?.id) ignoreUser(effect.userId, true); break;
    case 'getProfile': bus.emit('show-profile', effect.userId); break;
    case 'getLagTime': await pingServer().catch(() => {}); break;
    case 'ban': await banMember(effect.userId); break;
    case 'activateRuleSet': {
      const all = sets();
      if (!all.some((s) => s.name === effect.set)) break;
      setPrefs({ rules: all.map((s) => ({ ...s, active: s.name === effect.set })) });
      rebuild();
      toast(`Rule set “${effect.set}” is now active.`);
      break;
    }
    case 'executeMacro':
      if (state.me && allowAutoPost()) await submitText(`/${effect.macro}`);
      break;
    case 'sendMessage': case 'sendThought': case 'sendAction': {
      if (!state.me || !effect.text.trim() || !allowAutoPost()) break;
      const kind = effect.type === 'sendThought' ? 'think' : effect.type === 'sendAction' ? 'action' : 'say';
      await submitText(effect.text, kind);
      break;
    }
    case 'sendFileLine':
      if (state.me && effect.text && allowAutoPost()) await submitText(effect.text, 'say');
      break;
    default: break;
  }
}

/** Run side-effect rules for entries other people just signed. */
export function runRules(entries) {
  const s = currentSets();
  if (!activeSet(s)) return;
  const ctx = context();
  for (const e of entries) {
    if (e.userId === ctx.meId) continue;
    const event = { type: 'onMessage', userId: e.userId, author: e.author, text: e.text };
    for (const { effect } of evaluate(event, s, ctx, fired)) {
      perform(effect).catch((err) => console.error('rule action failed', err));
    }
  }
}

/** Fire "a new member joins" when the member directory grows. */
export function watchJoins() {
  let known = new Set(state.users.keys());
  bus.on('users', () => {
    const s = currentSets();
    const ctx = context();
    for (const [id, u] of state.users) {
      if (known.has(id)) continue;
      known.add(id);
      if (!activeSet(s) || id === ctx.meId) continue;
      for (const { effect } of evaluate({ type: 'onJoin', userId: id, author: u.name, text: '' }, s, ctx, fired)) {
        perform(effect).catch(() => {});
      }
    }
    known = new Set([...known].filter((id) => state.users.has(id)));
  });
}

// ---------------------------------------------------------------------------
// Editor

const WHO = [['anyone', 'Anyone'], ['me', 'Me'], ['anyoneButMe', 'Anyone but me']];

function describe(rule) {
  const ev = EVENTS[rule.event]?.label ?? rule.event;
  const who = WHO.find(([k]) => k === rule.who)?.[1]
    ?? (rule.who.startsWith('user:') ? (state.users.get(Number(rule.who.slice(5)))?.name ?? 'a member') : rule.who);
  const acts = rule.actions.map((a) => ACTIONS[a.type]?.label ?? a.type).join(', ') || 'nothing';
  return `${ev} — ${who}${rule.contains ? ` — containing “${rule.contains}”` : ''} → ${acts}`;
}

export function openRules() {
  let all = sets();
  let selectedSet = Math.max(0, all.findIndex((s) => s.active));
  const save = () => { setPrefs({ rules: all }); rebuild(); bus.emit('rules-changed'); };
  const body = h('div');
  let dlg;

  const draw = () => {
    const cur = all[selectedSet];
    const setList = h('ul', ...all.map((s, i) => h('li', { class: i === selectedSet ? 'sel' : '' },
      h('label', h('input', {
        type: 'radio', name: 'active-set', checked: s.active, title: 'Make this the active rule set',
        onchange: () => { all.forEach((x, j) => { x.active = j === i; }); save(); draw(); },
      }), ' '),
      h('button', { type: 'button', onclick: () => { selectedSet = i; draw(); } }, s.name))));
    const ruleList = cur ? h('ul', ...cur.rules.map((r, i) => h('li',
      h('label', h('input', { type: 'checkbox', checked: r.enabled, onchange: (e) => { r.enabled = e.target.checked; save(); } }), ' ', h('strong', r.name), h('br'), h('span.hint', describe(r))),
      h('span.row-actions',
        h('button', { type: 'button', onclick: () => editRule(r, (nr) => { cur.rules[i] = nr; save(); draw(); }) }, 'Edit'),
        h('button', { type: 'button', 'aria-label': 'Move up', disabled: i === 0, onclick: () => { [cur.rules[i - 1], cur.rules[i]] = [cur.rules[i], cur.rules[i - 1]]; save(); draw(); } }, '▲'),
        h('button.danger', { type: 'button', onclick: () => { cur.rules.splice(i, 1); save(); draw(); } }, 'Delete'))))) : null;

    body.replaceChildren(
      h('p.hint', 'Rules run in your browser while this page is open. Only the active rule set (the selected radio button) is used. Automatic posts are limited to one every 20 seconds.'),
      h('div.form-grid',
        h('div',
          h('strong', 'Rule sets'),
          h('div.list-box', setList.children.length ? setList : h('p.none', 'No rule sets yet.')),
          h('div.row-actions',
            h('button', { type: 'button', disabled: all.length >= MAX_RULESETS, onclick: () => { all.push(newRuleSet(`Rule set ${all.length + 1}`)); selectedSet = all.length - 1; if (all.length === 1) all[0].active = true; save(); draw(); } }, 'New'),
            h('button', { type: 'button', disabled: !cur, onclick: () => { const n = prompt('Rename rule set', cur.name); if (n?.trim()) { cur.name = n.trim().slice(0, 40); save(); draw(); } } }, 'Rename'),
            h('button.danger', { type: 'button', disabled: !cur, onclick: async () => { if (await confirmDialog(`Delete the rule set “${cur.name}”?`, { yes: 'Delete', danger: true })) { all.splice(selectedSet, 1); selectedSet = 0; save(); draw(); } } }, 'Delete'))),
        h('div',
          h('strong', cur ? `Rules in “${cur.name}”` : 'Rules'),
          h('div.list-box', ruleList && ruleList.children.length ? ruleList : h('p.none', cur ? 'No rules yet.' : 'Create a rule set first.')),
          h('div.row-actions',
            h('button', {
              type: 'button', disabled: !cur || cur.rules.length >= MAX_RULES,
              onclick: () => editRule(newRule(), (nr) => { cur.rules.push(nr); save(); draw(); }),
            }, 'New rule…')))));
  };
  draw();
  dlg = openDialog({ title: 'Automation', wide: true, body, actions: [{ label: 'Close', primary: true, onclick: (c) => c() }] });
  return dlg;
}

function paramInput(def, action, onchange) {
  const set = (v) => { action[def.key] = v; onchange?.(); };
  switch (def.kind) {
    case 'number':
      return h('input', { type: 'number', min: def.min ?? 0, max: def.max ?? 999, value: action[def.key] ?? def.def ?? 1, 'aria-label': def.label, oninput: (e) => set(Number(e.target.value)) });
    case 'sound':
      return h('select', { 'aria-label': def.label, onchange: (e) => { set(e.target.value); play(e.target.value, { force: true }); } },
        ...SOUND_NAMES.map((n) => h('option', { value: n, selected: (action[def.key] ?? def.def) === n }, n)));
    case 'macro':
      return h('select', { 'aria-label': def.label, onchange: (e) => set(e.target.value) },
        h('option', { value: '' }, '(choose a macro)'),
        ...Object.keys(state.prefs.macros).sort().map((n) => h('option', { value: n, selected: action[def.key] === n }, n)));
    case 'ruleset':
      return h('select', { 'aria-label': def.label, onchange: (e) => set(e.target.value) },
        h('option', { value: '' }, '(choose a rule set)'),
        ...sets().map((s) => h('option', { value: s.name, selected: action[def.key] === s.name }, s.name)));
    default:
      return h('input', { type: 'text', maxlength: 200, 'aria-label': def.label, placeholder: def.label, value: action[def.key] ?? def.def ?? '', oninput: (e) => set(e.target.value) });
  }
}

function editRule(original, onsave) {
  const rule = structuredClone(original);
  const err = h('div.error', { role: 'alert' });
  const name = h('input', { type: 'text', id: 'ru-name', value: rule.name, maxlength: 40, oninput: () => { rule.name = name.value; } });
  const event = h('select', { id: 'ru-event', onchange: () => { rule.event = event.value; } },
    ...Object.entries(EVENTS).map(([k, v]) => h('option', { value: k, disabled: v.phase !== 1, selected: rule.event === k }, v.phase === 1 ? v.label : `${v.label} (live chat)`)));
  const members = [...state.users.values()].sort((a, b) => a.name.localeCompare(b.name));
  const who = h('select', { id: 'ru-who', onchange: () => { rule.who = who.value; } },
    ...WHO.map(([k, t]) => h('option', { value: k, selected: rule.who === k }, t)),
    ...members.map((u) => h('option', { value: `user:${u.id}`, selected: rule.who === `user:${u.id}` }, u.name)));
  const contains = h('input', { type: 'text', id: 'ru-contains', value: rule.contains, maxlength: 100, placeholder: 'any text', oninput: () => { rule.contains = contains.value; } });
  const delay = h('input', { type: 'number', id: 'ru-delay', min: 0, max: 86400, value: rule.minDelay, oninput: () => { rule.minDelay = Number(delay.value) || 0; } });
  const actionsBox = h('div');

  const drawActions = () => {
    actionsBox.replaceChildren(...rule.actions.map((a, i) => {
      const def = ACTIONS[a.type];
      const sel = h('select', {
        'aria-label': 'Action',
        onchange: () => { rule.actions[i] = { type: sel.value }; for (const p of ACTIONS[sel.value].params) if (p.def !== undefined) rule.actions[i][p.key] = p.def; drawActions(); },
      }, ...Object.entries(ACTIONS).map(([k, v]) => h('option', { value: k, disabled: v.phase !== 1 || (v.hostOnly && !isOwner()), selected: a.type === k },
        v.phase === 1 ? v.label : `${v.label} (live chat)`)));
      return h('div.row-actions', sel, ...def.params.map((p) => paramInput(p, a)),
        h('button.danger', { type: 'button', 'aria-label': 'Remove action', onclick: () => { rule.actions.splice(i, 1); drawActions(); } }, '✕'));
    }));
    if (!rule.actions.length) actionsBox.append(h('p.hint', 'No actions yet.'));
  };
  drawActions();

  const form = h('form.form-grid', { onsubmit: (e) => e.preventDefault() },
    h('label', { for: 'ru-name' }, 'Name'), name,
    h('label', { for: 'ru-event' }, 'When'), event,
    h('label', { for: 'ru-who' }, 'Who'), who,
    h('label', { for: 'ru-contains' }, 'Containing'), contains,
    h('label', { for: 'ru-delay' }, 'Wait at least (seconds)'), delay,
    h('label', 'Do'), h('div', actionsBox,
      h('button', { type: 'button', onclick: () => { if (rule.actions.length < MAX_ACTIONS) { rule.actions.push({ type: 'beep', count: 1 }); drawActions(); } } }, 'Add action')),
    h('div.full', h('p.hint', 'In text you can use {name} (who signed), {message}, {me} and {room}.')),
    h('div.full', err));
  openDialog({
    title: 'Rule', wide: true, body: form,
    actions: [
      {
        label: 'OK', primary: true,
        onclick: (close, btn) => {
          const clean = sanitizeRuleSets([{ name: 'x', active: false, rules: [rule] }])[0]?.rules[0];
          if (!clean) { err.textContent = 'That rule is not valid.'; btn.disabled = false; return; }
          if (!clean.actions.length) { err.textContent = 'Add at least one action.'; btn.disabled = false; return; }
          onsave({ ...clean, id: original.id });
          close();
        },
      },
      { label: 'Cancel', onclick: (c) => c() },
    ],
  });
}
