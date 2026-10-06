# Comic Guestbook

A web guestbook where every entry becomes a panel in **one never-ending comic
strip**, drawn in the style of Microsoft Comic Chat (1996) — with the original
characters, backdrops, emotion wheel and balloon styles, rebuilt from scratch
for the web.

**Phase 1 (this release)** is the guestbook: accounts, a shared strip, the
Comic Chat feature set that makes sense without live presence. **Phase 2**
upgrades it to live persistent chat (rooms, whispers, presence) on the same
strip; see [docs/PHASE2.md](docs/PHASE2.md). The data model is already shaped
for it.

Runs entirely in the browser (desktop and phone), hosted on Cloudflare
(Workers + D1), no servers to babysit, no IRC, no Windows.

- **Visitors** pick a character, drag the emotion wheel, write a message, sign.
  Their entry is the next panel in the strip.
- **Everything is rendered at view time.** The database stores text and a few
  fields of metadata, never images, so improving the renderer improves the
  whole history. See [How it works](#how-it-works).
- **Faithful.** The panel-grouping rules, cast ordering, camera zoom,
  emotion-to-pose matching and text-to-expression rules are ports of the
  logic in [`../v2.5-beta-1-modern`](../v2.5-beta-1-modern). See
  [docs/PARITY.md](docs/PARITY.md) for every feature and its status.

## Quick start

Requires Node 22+.

```sh
cd comic-guestbook
npm install

npm run db:local      # create the local D1 database from migrations/
npm run dev           # http://127.0.0.1:8787  (Workers + D1 + static site)

npm test              # unit + API + rate-limit + browser end-to-end tests
npm run typecheck
```

The first account you register becomes the **owner** (host). To pin that to a
specific username instead, set `OWNER_USERNAME` in `wrangler.jsonc` *before*
deploying.

The browser tests need Chromium. They look at `/opt/pw-browsers/chromium` or the
`CHROME` environment variable and are skipped if neither exists.

## Deploy to Cloudflare

```sh
npx wrangler login
npx wrangler d1 create comic-guestbook
# paste the printed database_id into wrangler.jsonc ("d1_databases")

npm run db:remote                 # apply migrations/ to the real database
# set "vars.OWNER_USERNAME" in wrangler.jsonc to YOUR username (recommended)
npm run deploy
```

To serve it on your own domain, uncomment `routes` in `wrangler.jsonc` and put
your hostname in it (the domain's zone must be on your Cloudflare account):

```jsonc
"routes": [{ "pattern": "guestbook.example.com", "custom_domain": true }]
```

**Claiming the owner account.** The first account to register (or the one
named in `OWNER_USERNAME`) becomes the owner, so there is a window between
deploying and registering in which a stranger could claim it. Close it by
setting a secret that only you know:

```sh
npx wrangler secret put OWNER_SETUP_TOKEN        # type any long random string
npm run deploy
```

Then register at `https://your.site/#setup=THAT-STRING`. Without the token
nobody can create the owner account, and (if you set `OWNER_USERNAME`) that name
is reserved. Everyone else registers normally. If you skip the secret, just
register immediately after deploying.

### Cost

Static files (the page, the art, the fonts) are served by Cloudflare's asset
hosting. Only `/api/*` runs the Worker. A friend group fits comfortably in the
free plans: a page view costs a handful of API requests, an open tab polls once
every 12–15 seconds, polling reads almost no D1 rows, and returning visitors
keep the whole history cached in IndexedDB and only fetch what is new. (Check
Cloudflare's current free-tier limits for Workers and D1 before launch; they
change.)

## How it works

```
 browser                                          Cloudflare
 ───────                                          ──────────
 entries (text + metadata) ◄──── /api/entries ──── Worker ──► D1
        │
        ▼
 layout.js     group entries into panels, order & face the cast   (pure)
        ▼
 scene.js      camera zoom, pose choice, balloon placement        (pure)
        ▼
 draw.js       canvas: backdrop, characters, balloons, text
```

**Store messages, not images.** An entry is `{ author, character, emotion?,
kind, text, fmt?, backdrop?, to?, time }`. Panel boundaries, who stands where,
which way they face, the camera zoom and the balloon shapes are all computed in
the browser from the entry sequence, deterministically (seeded PRNG, no clock).
Fix a bug in the renderer and every old panel is fixed too. Cached exports
(PNG, print) are made on demand and never stored.

- **`public/js/shared/`** — the engine: `layout.js` (panels), `scene.js`
  (geometry), `emotion.js` (wheel, pose choice, text rules), `rules.js`
  (automation), `richtext.js` (BBCode ⇄ runs), `textwrap.js`. Pure functions,
  heavily unit-tested; they also run in Node.
- **`public/js/render/`** — canvas drawing, art loading, fonts.
- **`public/js/ui/`** — the Microsoft-Chat-style shell: menu bar, toolbar,
  strip, member list, BodyCam, say bar, dialogs.
- **`src/`** — the Worker (TypeScript): accounts, entries, moderation.
- **`migrations/`** — the D1 schema.
- **`tools/`** — converts Comic Chat art (`.avb`, `.bgb`) to web assets.

### The art

Characters and backdrops are the originals from Microsoft Comic Chat,
converted by `tools/convert-art.mjs`. The `.avb` format (including the 2-bit
masked-mono and dual-mask variants) was read from `avbfile.cpp` in the
repository; every one of the 44 shipped files decodes. Poses are baked
following the original draw rules (mask silhouette or white-keying, plus a
separate white "aura" halo layer) into one PNG atlas per character.

```sh
npm run art                      # re-convert ../v2.5-beta-1-modern/{comicart,artpack1}
node tools/convert-art.mjs --out public/art  path/to/more/art
```

To add your own characters, create `.avb` files with the original AvatarFiler
tool (`../artifacts/avtools`) and convert them the same way. Art URLs carry a
content hash (`?v=`), so they are cached for a year and still update at once.

> **Licensing.** The art is © Microsoft Corporation (character art credited to
> Jim Woodring) and is distributed in Microsoft's open-source Comic Chat
> repository under its MIT License; see `public/NOTICES.txt`. Whether that is
> enough for *your* public site is your call — if in doubt, ask a lawyer, or
> run the converter on art you own. This project is not affiliated with or
> endorsed by Microsoft.

## Security notes

- Passwords: PBKDF2-SHA256, 100,000 iterations (the Workers maximum), per-user
  random salt, constant-time comparison. Unknown usernames cost the same as
  wrong passwords. Sessions are random 256-bit tokens, stored only as SHA-256
  hashes, in `HttpOnly; SameSite=Lax; Secure` cookies.
- CSRF: every state-changing request needs the `X-Requested-With` header and a
  same-origin `Origin`.
- Abuse: failed logins are counted per username *and* address (so a stranger
  cannot lock you out), with a high per-username ceiling for distributed
  guessing; per-address limits on logins and registrations, per-user posting limits (12/minute, 300/day by default), a
  link cap per entry, input length and character validation (control and
  bidi-override characters are refused).
- Output: all text reaches the page through `textContent`/canvas, never
  `innerHTML`; links are http(s) only. A strict Content-Security-Policy
  (`script-src 'self'`, no inline styles or scripts) is set in `public/_headers`.
- Recovery without email: the owner can issue a one-time temporary password
  (Member → User list → Reset password).
- Client addresses are only ever stored as short hashes, and only Cloudflare's
  `CF-Connecting-IP` is trusted.
- There is no email, no tracking, no third-party requests.
- Known limit: signature names are unique case-insensitively, but look-alike
  Unicode names (a Cyrillic "а" for a Latin "a") are not detected. The owner can
  ban impersonators.

## Project layout

```
comic-guestbook/
  wrangler.jsonc        Worker, assets, D1 binding, owner
  migrations/           D1 schema
  src/                  Worker (TypeScript)
  public/               the site (served as static assets)
    js/shared/          engine (pure; tested in Node)
    js/render/ js/ui/   canvas + interface
    art/                converted Comic Chat art (generated; committed)
    fonts/              Comic Neue (OFL)
    _headers            CSP and cache headers
  tools/                .avb/.bgb → web art converter
  test/                 unit, API, rate-limit, and Chromium end-to-end tests
  docs/                 PARITY.md, PHASE2.md
```

## Troubleshooting

- *"The guestbook could not start."* — open the browser console; usually the
  Worker is not running (`npm run dev`) or the D1 migrations were not applied
  (`npm run db:local`).
- *Everything is blank gray after deploying* — the art lives in `public/art`;
  make sure it was committed/uploaded (`npm run art` regenerates it).
- *Locked out of the owner account* — there is no email reset, so recover it
  from the command line. This prints the SQL to set a new password (using the
  same hashing as the Worker) and then you run it against D1:

  ```sh
  node tools/set-password.mjs yourusername
  # copy the printed `npx wrangler d1 execute …` command and run it
  ```

  (Other members can ask the owner for a temporary password under Member → User
  list → Reset password.)
