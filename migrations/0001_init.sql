-- nectr core schema (Phase 1). Comments and guests arrive with Phase 2.
-- IDs are 12-character random base64url strings made by the Worker.
-- Timestamps are Unix epoch milliseconds. deleted_at marks a soft delete;
-- a daily cron removes rows (and their R2 objects) 7 days later.

CREATE TABLE owner_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  photo_key TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  artist TEXT NOT NULL DEFAULT '',
  year INTEGER,
  label TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL,
  artwork_key TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  parent_id TEXT REFERENCES folders(id),
  name TEXT NOT NULL,
  icon TEXT NOT NULL,
  color TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX folders_by_project ON folders(project_id, parent_id, position);

CREATE TABLE tracks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  folder_id TEXT REFERENCES folders(id),
  title TEXT NOT NULL,
  position INTEGER NOT NULL,
  lyrics_lrc TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX tracks_by_project ON tracks(project_id, folder_id, position);

-- A version starts as 'pending' when the upload URL is issued and becomes
-- 'ready' after the Worker validated the object in R2 (see D9 in plano.md).
CREATE TABLE versions (
  id TEXT PRIMARY KEY,
  track_id TEXT NOT NULL REFERENCES tracks(id),
  number INTEGER NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('pending', 'ready')),
  r2_key TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('wav', 'mp3')),
  size_bytes INTEGER NOT NULL,
  duration_s REAL,
  sample_rate INTEGER,
  bit_depth INTEGER,
  channels INTEGER,
  bitrate_kbps INTEGER,
  lufs_integrated REAL,
  lufs_range REAL,
  true_peak_dbtp REAL,
  -- ~16k min/max pairs as int8, base64 (~44 KB); read only by the player.
  peaks TEXT,
  lyrics_lrc_override TEXT,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER,
  UNIQUE (track_id, number)
);
CREATE INDEX versions_pending ON versions(status, created_at);

CREATE TABLE share_links (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  folder_id TEXT REFERENCES folders(id),
  track_id TEXT REFERENCES tracks(id),
  version_mode TEXT NOT NULL CHECK (version_mode IN ('all', 'latest', 'selected')),
  password_hash TEXT,
  password_salt TEXT,
  password_iterations INTEGER,
  allow_download INTEGER NOT NULL DEFAULT 0,
  show_lyrics INTEGER NOT NULL DEFAULT 1,
  allow_comments INTEGER NOT NULL DEFAULT 1,
  expires_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  last_viewed_at INTEGER,
  CHECK (folder_id IS NULL OR track_id IS NULL)
);
CREATE INDEX share_links_by_project ON share_links(project_id);

CREATE TABLE share_link_versions (
  link_id TEXT NOT NULL REFERENCES share_links(id),
  version_id TEXT NOT NULL REFERENCES versions(id),
  PRIMARY KEY (link_id, version_id)
);
CREATE INDEX share_link_versions_by_version ON share_link_versions(version_id);
