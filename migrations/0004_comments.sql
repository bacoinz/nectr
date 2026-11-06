-- Phase 2: guests and comments (text or voice, threads one level deep).

-- A guest is a device on a link: the browser keeps the id and a random secret
-- (only its SHA-256 is stored) that lets it rename itself and delete its own comments.
CREATE TABLE guests (
  id TEXT PRIMARY KEY,
  link_id TEXT NOT NULL,
  name TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX guests_by_link ON guests(link_id);

-- guest_id NULL = the owner. A reply points at the top-level comment of its
-- thread (parent_id) and shares its version and time. Requests are top-level
-- guest comments; their status is open/done, done in resolved_in_version_id.
-- Owner notes can be private (never sent to a share link). Voice notes live
-- in R2 under voice/<id>.<ext>. guest_id, link_id and resolved_in_version_id
-- are plain references: the daily cron cleans what they point to.
CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES versions(id),
  parent_id TEXT REFERENCES comments(id),
  guest_id TEXT,
  link_id TEXT,
  body TEXT NOT NULL DEFAULT '',
  t_start REAL NOT NULL,
  t_end REAL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  resolved_in_version_id TEXT,
  is_private INTEGER NOT NULL DEFAULT 0,
  voice_key TEXT,
  voice_mime TEXT,
  voice_duration_s REAL,
  voice_size INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX comments_by_version ON comments(version_id, updated_at);
CREATE INDEX comments_by_parent ON comments(parent_id);
