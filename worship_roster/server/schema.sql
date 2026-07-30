-- Worship Team Roster — D1 (SQLite) schema.
-- Apply with:  wrangler d1 execute worship-roster --file=./schema.sql
--
-- Security notes:
--  * Secrets (invite codes, device tokens) are NEVER stored in the clear —
--    only their SHA-256 hex hash is persisted, so a database leak does not
--    reveal usable credentials.
--  * Every row is scoped by team_id; the Worker filters every query by the
--    caller's team, enforced server-side.

CREATE TABLE IF NOT EXISTS teams (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  invite_code_hash  TEXT NOT NULL,
  season_start      TEXT NOT NULL DEFAULT '2026-07-02',
  season_end        TEXT NOT NULL DEFAULT '2026-12-31',
  created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  id          TEXT PRIMARY KEY,
  team_id     TEXT NOT NULL,
  name        TEXT NOT NULL,
  is_leader   INTEGER NOT NULL DEFAULT 0,   -- admin privileges
  title       TEXT NOT NULL DEFAULT '',     -- optional display title, e.g. "Pastor"
  positions   TEXT NOT NULL DEFAULT '[]',   -- JSON array of position ids
  token_hash  TEXT NOT NULL,                -- SHA-256 of the device bearer token
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_members_team ON members(team_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_token ON members(token_hash);

CREATE TABLE IF NOT EXISTS assignments (
  team_id     TEXT NOT NULL,
  date        TEXT NOT NULL,               -- YYYY-MM-DD (a Sunday)
  position_id TEXT NOT NULL,
  member_id   TEXT,                        -- NULL = unassigned
  PRIMARY KEY (team_id, date, position_id)
);

-- One row per member per (month, practice type): enforces one vote per block.
CREATE TABLE IF NOT EXISTS votes (
  team_id   TEXT NOT NULL,
  month     TEXT NOT NULL,                 -- YYYY-MM
  type_id   TEXT NOT NULL,                 -- 'weekday' | 'afterchurch'
  member_id TEXT NOT NULL,
  date      TEXT NOT NULL,                 -- candidate date voted for
  PRIMARY KEY (team_id, month, type_id, member_id)
);

CREATE TABLE IF NOT EXISTS practice_locks (
  team_id     TEXT NOT NULL,
  month       TEXT NOT NULL,
  type_id     TEXT NOT NULL,
  locked_date TEXT NOT NULL,
  locked_by   TEXT,
  locked_at   TEXT,
  PRIMARY KEY (team_id, month, type_id)
);

CREATE TABLE IF NOT EXISTS songs (
  id         TEXT PRIMARY KEY,
  team_id    TEXT NOT NULL,
  month      TEXT NOT NULL,
  title      TEXT NOT NULL,
  key_sig    TEXT,
  link       TEXT NOT NULL DEFAULT '',   -- optional listening link (YouTube, etc.)
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_songs_team ON songs(team_id);

-- Song library: future songs to learn (lyrics, chords, listening link).
CREATE TABLE IF NOT EXISTS library_songs (
  id         TEXT PRIMARY KEY,
  team_id    TEXT NOT NULL,
  title      TEXT NOT NULL,
  artist     TEXT NOT NULL DEFAULT '',
  lyrics     TEXT NOT NULL DEFAULT '',
  chords     TEXT NOT NULL DEFAULT '',
  link       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_library_team ON library_songs(team_id);

-- Devotionals: title, video/blog link, scripture, application, prayer.
CREATE TABLE IF NOT EXISTS devotionals (
  id          TEXT PRIMARY KEY,
  team_id     TEXT NOT NULL,
  title       TEXT NOT NULL,
  author      TEXT NOT NULL DEFAULT '',
  link        TEXT NOT NULL DEFAULT '',
  scripture   TEXT NOT NULL DEFAULT '',
  application TEXT NOT NULL DEFAULT '',
  prayer      TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_devotionals_team ON devotionals(team_id);

-- Self-logged spiritual disciplines (prayer / word minutes), per member per day.
CREATE TABLE IF NOT EXISTS activity_log (
  id         TEXT PRIMARY KEY,
  team_id    TEXT NOT NULL,
  member_id  TEXT NOT NULL,
  date       TEXT NOT NULL,             -- YYYY-MM-DD
  kind       TEXT NOT NULL,             -- 'prayer' | 'word'
  minutes    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_member ON activity_log(team_id, member_id);

-- Daily app engagement: one row per member per day they open/use the app.
CREATE TABLE IF NOT EXISTS member_activity (
  team_id    TEXT NOT NULL,
  member_id  TEXT NOT NULL,
  date       TEXT NOT NULL,               -- YYYY-MM-DD (UTC)
  hits       INTEGER NOT NULL DEFAULT 0,  -- times active that day
  updated_at TEXT NOT NULL,
  PRIMARY KEY (team_id, member_id, date)
);
CREATE INDEX IF NOT EXISTS idx_member_activity ON member_activity(team_id, date);

-- Per-member boolean flags: devotion reads ("read:<id>") and weekly ministry
-- check-ins ("ministry:<sunday>:<marker>"). Presence = true.
CREATE TABLE IF NOT EXISTS member_flags (
  team_id    TEXT NOT NULL,
  member_id  TEXT NOT NULL,
  key        TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (team_id, member_id, key)
);
CREATE INDEX IF NOT EXISTS idx_flags_team_key ON member_flags(team_id, key);

-- Optional attached chord-sheet PDF for a song (base64, kept small).
CREATE TABLE IF NOT EXISTS song_pdfs (
  song_id    TEXT PRIMARY KEY,
  team_id    TEXT NOT NULL,
  filename   TEXT NOT NULL DEFAULT 'chords.pdf',
  data       TEXT NOT NULL,               -- base64url-encoded PDF bytes
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_song_pdfs_team ON song_pdfs(team_id);

-- Web Push subscriptions (one per installed device/browser).
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint   TEXT PRIMARY KEY,
  member_id  TEXT NOT NULL,
  team_id    TEXT NOT NULL,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_team ON push_subscriptions(team_id);

-- Idempotency ledger so a cron re-run never double-sends the same reminder.
CREATE TABLE IF NOT EXISTS reminder_log (
  team_id  TEXT NOT NULL,
  tag      TEXT NOT NULL,                  -- e.g. songlist:2026-07-05
  sent_at  TEXT NOT NULL,
  PRIMARY KEY (team_id, tag)
);
