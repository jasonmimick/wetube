-- wetube schema — Turso (libSQL / SQLite 3.47)
--
-- Replaces the Firestore collections documented in app/src/lib/paths.ts.
-- Timestamps are ISO-8601 TEXT throughout, matching what the existing code
-- already writes (`new Date().toISOString()`), so the migration doesn't have
-- to reformat anything. Booleans are INTEGER 0/1 (SQLite has no bool).

-- masses/{massId} -> masses
CREATE TABLE IF NOT EXISTS masses (
  id                     TEXT PRIMARY KEY,
  title                  TEXT NOT NULL,
  visibility             TEXT NOT NULL DEFAULT 'private',  -- private | public
  status                 TEXT NOT NULL,                    -- starting|live|stopping|ended|error
  embed_url              TEXT,
  watch_url              TEXT,
  youtube_video_id       TEXT,
  youtube_mocked         INTEGER NOT NULL DEFAULT 0,
  last_error             TEXT,
  auto_shutoff_disabled  INTEGER NOT NULL DEFAULT 0,
  created_by_name        TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);

-- Serves both useActiveMass() (status in starting/live/stopping) and the
-- paginated Broadcast History query (status='ended' order by created_at desc).
-- Same shape as the composite index in firestore.indexes.json.
CREATE INDEX IF NOT EXISTS idx_masses_status_created
  ON masses (status, created_at DESC);

-- commands/latest -> commands
--
-- Deliberately append-only with an autoincrement id, rather than the
-- single-doc mailbox Firestore used. The agent tracks the last id it
-- processed, which replaces the issued_at/consumed_at string comparison in
-- agent.js tick() — that comparison assumed lexicographic ISO ordering and
-- had to be re-checked on every restart via lastProcessedIssuedAt.
CREATE TABLE IF NOT EXISTS commands (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  type         TEXT NOT NULL,                  -- start | stop
  mass_id      TEXT NOT NULL,
  issued_at    TEXT NOT NULL,
  issued_by    TEXT NOT NULL,
  consumed_at  TEXT,
  result_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_commands_unconsumed
  ON commands (id) WHERE consumed_at IS NULL;

-- agent/status -> agent_status (single row, id always 1)
--
-- This is the hot path that caused the Firestore outage. The write is
-- throttled server-side in /api/agent/poll: the agent may poll every 3s for
-- responsiveness, but this row is only rewritten when a field actually
-- changed or last_heartbeat_at is older than the heartbeat interval.
-- See docs/DESIGN-drop-firebase.md.
CREATE TABLE IF NOT EXISTS agent_status (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),
  last_heartbeat_at  TEXT,
  vmix_connected     INTEGER,
  streaming          INTEGER NOT NULL DEFAULT 0,
  last_command       TEXT,
  last_error         TEXT
);

INSERT OR IGNORE INTO agent_status (id, streaming) VALUES (1, 0);

-- activityLog/{id} -> activity_log
CREATE TABLE IF NOT EXISTS activity_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  action    TEXT NOT NULL,            -- start | stop | override | auto-shutoff
  mass_id   TEXT,
  title     TEXT,
  watch_url TEXT,
  by_uid    TEXT,
  by_name   TEXT,
  by_role   TEXT,
  at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activity_at ON activity_log (at DESC);

-- config/{passcode,emailAccess} -> config
--
-- Now holds the scrypt hashes for the two passcodes that replace Firebase
-- Auth entirely: 'owner_passcode' (Jason) and 'controller_passcode' (shared,
-- given to volunteers). Hash format is unchanged from lib/passcode.ts —
-- "{salt}:{scrypt}" — so that module is reused as-is.
--
-- config/emailAccess is intentionally NOT carried over: email-link sign-in
-- and the Google path are both being dropped.
CREATE TABLE IF NOT EXISTS config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,           -- JSON
  updated_at TEXT NOT NULL
);
