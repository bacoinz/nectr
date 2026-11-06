-- Failed password attempts per link and client, so a lock survives closed tabs
-- and private windows. `client` is a hash of the IP (IPv6 by its /64 prefix);
-- the raw IP is never stored. The daily cron removes rows idle for 2 days.
CREATE TABLE unlock_attempts (
  link_id TEXT NOT NULL,
  client TEXT NOT NULL,
  fails INTEGER NOT NULL,
  locked_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (link_id, client)
);
