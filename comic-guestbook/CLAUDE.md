# CLAUDE.md — comic-guestbook

Web guestbook rendered as a Comic Chat strip. Cloudflare Workers + D1 backend,
vanilla-ES-module browser client (no bundler), TypeScript Worker.
Read `README.md` first; `docs/PARITY.md` maps every Microsoft Chat 2.5 feature
to its status; `docs/PHASE2.md` is the (unbuilt) live-chat design.

## Commands

```sh
npm install
npm run art            # regenerate public/art from ../v2.5-beta-1-modern (generated, committed)
npm run db:local       # apply migrations to the local D1
npm run dev            # wrangler dev → http://127.0.0.1:8787
npm test               # ALL tests (~1.5 min): unit, API, rate limit, Chromium e2e
node --test test/layout.test.mjs     # one file
npm run typecheck      # tsc --noEmit on src/ (strict)
node --test test/e2e.test.mjs        # needs Chromium (/opt/pw-browsers/chromium or $CHROME)
```

API and e2e tests start their own isolated `wrangler dev` with a throwaway D1
(`test/server.mjs`), so they never touch your local database. Run only what you
need while iterating; run `npm test` and `npm run typecheck` before finishing.

## The one design rule

**Store messages, not images.** The database holds text + metadata. Panel
grouping, cast placement, zoom, balloons are *computed in the browser from the
entry sequence* and must stay a pure deterministic function of it (seeded PRNG,
no clock, no fonts in grouping). That is why `public/js/shared/` is pure and
unit-tested in Node. Never store rendered panels.

## Layout

- `public/js/shared/` — engine, pure, no DOM: `layout.js` (entries → panels,
  ported from panel.cpp AddLine/OrderAvatars), `scene.js` (geometry: zoom,
  balloons; `measure` is injected), `emotion.js`, `rules.js`, `richtext.js`,
  `textwrap.js`. Imported by both the browser and Node tests, so no browser
  globals.
- `public/js/render/` — canvas drawing, art loading, fonts (browser only).
- `public/js/ui/` — interface modules; they talk through `bus` (events in
  `state.js`), not by importing each other's internals. `actions.js` holds user
  actions shared by menus/commands/context menus.
- `src/` — Worker. `lib/validate.ts` is the single place input is validated;
  `routes/*.ts` are handlers; `index.ts` is the router (CSRF check first).
- `migrations/` — D1 schema (0001 is still pre-release; add 0002+ once deployed).
- `tools/avb.mjs` / `convert-art.mjs` — `.avb`/`.bgb` reader and art baker.
- `test/` — `*.test.mjs` (node:test). `e2e.test.mjs` drives the real UI.

## Conventions and gotchas

- **Strict CSP** (`public/_headers`): no inline scripts, no `style=""`
  attributes in markup/HTML strings. Set styles through the CSSOM
  (`el.style.x = …`, `setProperty`) or classes. Build DOM with `h()` from
  `lib/dom.js`; never use `innerHTML` for user text.
- Worker TypeScript uses *erasable syntax only* (no enums/parameter
  properties) so Node can import `src/lib/*.ts` directly in tests.
- Mutating API calls need the `X-Requested-With: comic-guestbook` header.
- Rate limits are fixed windows in D1 (`src/lib/ratelimit.ts`); tests that
  burst must start early in a window (see `ratelimit.test.mjs`).
- Preferences (`state.prefs`) sync to the account via a debounced PATCH and are
  flushed on page hide; add new keys to `DEFAULT_PREFS` or they are dropped.
- Adding a UI feature: add the menu item in `ui/menus.js`, an event on `bus`,
  the dialog in `ui/dialogs.js` (or its own module), then a Chromium test.
- `public/art/` is generated but committed so `wrangler deploy` works as-is;
  rerun `npm run art` after changing `tools/` (the version hash changes, so
  caches update).
- Phase 2 hooks that already exist: `entries.kind='whisper'`, `rooms`,
  `room_id`, `StripBuilder` incremental `push`.
