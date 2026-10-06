# Phase 2 — live persistent chat

Phase 1 is a guestbook: the strip is a function of the stored entries, read by
polling. Phase 2 makes the same strip live, adds the rest of Microsoft Chat's
rooms-and-people features, and keeps every phase-1 entry as history ("the strip
carries over").

Nothing here is built yet. This document records the design so phase 1 does not
paint it into a corner, and lists what is already in place.

## Already in place

- `rooms` table; `entries.room_id`; the guestbook is room 1. Every API takes a
  `room` parameter.
- `entries.kind` already allows `whisper`; the renderer draws dashed whisper
  balloons; the validator rejects whispers until phase 2.
- `users.prefs` (JSON, 16 KB) holds macros, rule sets, favourites, ignore list.
- The layout engine is an incremental fold (`StripBuilder.push`): a live message
  only ever changes the *last* panel, which is exactly what `strip.update(from)`
  re-renders.
- The rule engine has all 11 events and 30 actions; phase 2 enables the rest.
- The UI already has the menu items, shown disabled with "Arrives with live
  chat in phase 2".

## Architecture

```
browser ── WebSocket ──► Worker ──► Room Durable Object (one per room)
   │                                   │  presence, roles, mode flags
   │                                   │  fan-out, ordering, rate limits
   └── HTTPS /api/* ──► Worker ──► D1 ◄┘  history, accounts, rooms
```

- **One Durable Object per room** (SQLite-backed). It owns the member list,
  roles and modes, assigns ordering, fans messages out to its WebSockets and
  writes them to D1. Using the WebSocket Hibernation API means an idle room
  costs nothing.
- **Auth**: the existing session cookie authenticates the WebSocket upgrade
  (same-origin `Origin` check). No tokens in URLs.
- **Reads stay HTTP.** History is still `GET /api/entries?after=` (and cached in
  IndexedDB); the socket only carries *new* events, so a dropped connection
  falls back to polling with no special case.
- **Presence** lives in the room DO, not D1, so it never costs a write.

## Protocol (JSON frames)

Client → server: `hello {room, since}`, `say {kind, text, fmt, em, character, to, backdrop}`,
`expression`, `whisper {to, text}`, `away {msg|null}`, `typing`, `ping {t}`,
`invite {userId}`, `kick {userId, reason}`, `ban`, `mode {…}`, `topic`,
`role {userId, role}`.

Server → client: `welcome {members, modes, rev}`, `entry {…}` (same shape the
HTTP API returns), `whisper`, `join`, `leave`, `away`, `kicked`, `invite`,
`modes`, `topic`, `role`, `pong`, `error {code}`.

An entry is delivered by the DO only after D1 accepted it, so the socket and the
history can never disagree. Ids are D1 row ids, so the strip's order is the
same on every client and `after=` catch-up after a reconnect is exact.

## Schema additions

```sql
ALTER TABLE rooms ADD COLUMN owner_id INTEGER REFERENCES users(id);
ALTER TABLE rooms ADD COLUMN moderated INTEGER NOT NULL DEFAULT 0;   -- only speakers talk
ALTER TABLE rooms ADD COLUMN private INTEGER NOT NULL DEFAULT 0;     -- not in the room list
ALTER TABLE rooms ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rooms ADD COLUMN invite_only INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rooms ADD COLUMN topic_anyone INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rooms ADD COLUMN max_members INTEGER;
ALTER TABLE rooms ADD COLUMN no_whispers INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rooms ADD COLUMN password_hash TEXT;                      -- PBKDF2, like accounts

CREATE TABLE room_members (        -- standing roles and bans, not presence
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  role    TEXT NOT NULL CHECK (role IN ('host','speaker','member','spectator')),
  banned  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (room_id, user_id)
);
CREATE TABLE invites (room_id INTEGER, from_user INTEGER, to_user INTEGER, created_at INTEGER);
```

Whispers are stored in `entries` with `kind='whisper'` and a `to_ids` of exactly
the recipients; the history API filters them to sender and recipients. Layout
treats them like any other balloon (dashed), but only the people involved ever
receive them.

## Features and where they land

| Feature | Design |
|---|---|
| Rooms: enter, leave, create, list | room DO per room; tab bar (View → Tab bar); room list from D1 excluding private/hidden |
| Room properties (all of Microsoft Chat's) | columns above, edited by hosts |
| Whispers, whisper box | `whisper` frame; a per-room whisper log tab |
| Member list with presence | `welcome`/`join`/`leave` |
| Away from keyboard | `away` frame; shown in the list; auto-reply optional |
| Invite | `invite` frame to an online user, stored for offline ones |
| Host, speaker, spectator, moderated rooms | `room_members.role`, enforced in the DO |
| Kick | DO closes the socket with a reason; ban persists in `room_members` |
| Logon notifications | `join` events matched against favourites |
| Lag time | `ping`/`pong` over the socket |
| Local time | client sends its UTC offset in `hello` |
| Rule events: connect, disconnect, join, leave, kick, new host, new room, invitation, whisper, whisper-in-room | emitted by the same client code from frames |
| Rule actions: join/leave/kick/make host/invite/connect/disconnect/whisper/send sound/identity/local time/version | executed against the socket |
| Send file | optional: R2 upload with a signed link, size-capped; otherwise dropped |

## Cost and limits

SQLite-backed Durable Objects and WebSocket hibernation are designed so an idle
room is free; a friend group's traffic is a few thousand messages a day. Message
fan-out is the DO's CPU time, not D1 reads. Check the current Workers/DO/D1 free
limits before launch; if they are ever exceeded the site can fall back to
phase-1 polling (the socket is an optimisation, history is HTTP).

## Security

- WebSocket upgrade: session cookie + `Origin` check; refuse otherwise.
- Per-connection and per-user message rate limits inside the DO (token bucket),
  in addition to the HTTP limits.
- Frame size cap; JSON schema validation shared with HTTP (`validate.ts`).
- Room passwords are hashed like account passwords and compared in constant
  time; never echoed.
- Hosts can only moderate their own rooms; the site owner can moderate all.

## Build order

1. Room DO + `hello`/`entry` fan-out for room 1 only; client uses the socket
   when available and keeps polling as the fallback. (Everything else is
   unchanged — the guestbook becomes live.)
2. Presence, away, member list from the socket; ping.
3. Multiple rooms: create, list, tabs, properties, passwords, invites.
4. Whispers and the whisper box.
5. Roles, moderation, kick/ban, moderated rooms.
6. Enable the remaining rule events and actions.
7. Optional: file sending.

Each step ships with tests like phase 1's: pure-function unit tests, API/WS
integration tests against `wrangler dev`, and Chromium end-to-end tests that
drive two browsers at once.
