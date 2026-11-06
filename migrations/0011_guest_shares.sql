-- Guests may share a track or folder of a link, where the owner allows it.
ALTER TABLE share_links ADD COLUMN allow_share INTEGER NOT NULL DEFAULT 0;

-- A share made by a guest: a link of its own whose parent is the link it came
-- from (a plain reference; the cron removes orphans). It never allows downloads,
-- has no password, follows its parent's versions, lyrics and comments, and stops
-- when the parent is revoked or expires. created_by_guest_id: who shared it.
ALTER TABLE share_links ADD COLUMN parent_link_id TEXT;
ALTER TABLE share_links ADD COLUMN created_by_guest_id TEXT;
CREATE INDEX share_links_by_parent ON share_links(parent_link_id);
