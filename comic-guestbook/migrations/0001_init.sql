-- Comic Guestbook schema.
--
-- Principle: store messages, not images. An entry is text plus a little
-- metadata; panels are drawn in the browser every time they are viewed.
--
-- Phase 2 (live chat) is additive: `rooms` already exists, entries carry a
-- room_id and a `kind` that includes 'whisper', and users have a JSON prefs bag
-- for macros, rule sets, favourites, etc.

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,   -- login name, never shown
  display_name  TEXT    NOT NULL UNIQUE COLLATE NOCASE,   -- the name that signs entries
  pass_hash     TEXT    NOT NULL,                         -- base64 PBKDF2-SHA256
  pass_salt     TEXT    NOT NULL,
  pass_iter     INTEGER NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'owner')),
  character     TEXT    NOT NULL DEFAULT '',              -- preferred character id
  profile       TEXT    NOT NULL DEFAULT '',              -- "This person is too lazy to create a profile entry."
  homepage      TEXT    NOT NULL DEFAULT '',
  prefs         TEXT    NOT NULL DEFAULT '{}',            -- JSON: ignore list, macros, favourites, options
  banned        INTEGER NOT NULL DEFAULT 0,
  ban_reason    TEXT    NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash  TEXT    PRIMARY KEY,                        -- sha-256 of the cookie token
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE rooms (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  slug              TEXT    NOT NULL UNIQUE,
  name              TEXT    NOT NULL,
  topic             TEXT    NOT NULL DEFAULT '',
  motd              TEXT    NOT NULL DEFAULT '',          -- message of the day
  default_backdrop  TEXT    NOT NULL DEFAULT 'pastoral',
  scene_changes     INTEGER NOT NULL DEFAULT 1,           -- may visitors change the backdrop?
  rev               INTEGER NOT NULL DEFAULT 0,           -- bumped when history is edited/deleted
  created_at        INTEGER NOT NULL
);
INSERT INTO rooms (id, slug, name, topic, created_at)
VALUES (1, 'guestbook', 'The Guestbook', 'Sign in, pick a character, say something.', 0);

CREATE TABLE entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id     INTEGER NOT NULL DEFAULT 1 REFERENCES rooms(id),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  author      TEXT    NOT NULL,                           -- signature at the time of signing
  character   TEXT    NOT NULL,
  emotion     REAL,                                       -- NULL = choose from the text at render time
  intensity   REAL,
  kind        TEXT    NOT NULL DEFAULT 'say' CHECK (kind IN ('say', 'think', 'action', 'whisper', 'expression')),
  text        TEXT    NOT NULL,                           -- empty for 'expression'
  fmt         TEXT,                                       -- JSON formatting runs, NULL if plain
  backdrop    TEXT,                                       -- scene change, NULL = keep
  to_ids      TEXT,                                       -- JSON array of user ids addressed
  created_at  INTEGER NOT NULL,
  deleted     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX entries_room_id ON entries(room_id, id);
CREATE INDEX entries_user ON entries(user_id, id);

-- Tiny fixed-window counters for rate limiting. `exp` is when the window ends
-- (unix seconds), so rows of every window size can be pruned with one rule.
CREATE TABLE rate (
  k       TEXT    NOT NULL,
  window  INTEGER NOT NULL,
  n       INTEGER NOT NULL,
  exp     INTEGER NOT NULL,
  PRIMARY KEY (k, window)
);
CREATE INDEX rate_exp ON rate(exp);
