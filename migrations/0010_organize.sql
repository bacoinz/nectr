-- Projects get a kind: a release (album, EP, single: with a cover) or a
-- working folder (WIP, a live project, anything else) shown with an icon,
-- like folders. Only top-level folders use it.
ALTER TABLE folders ADD COLUMN kind TEXT NOT NULL DEFAULT 'release' CHECK (kind IN ('release', 'wip', 'live', 'other'));

-- A track can have a cover of its own (otherwise its project's is used).
ALTER TABLE tracks ADD COLUMN artwork_key TEXT;

-- The owner orders the artists on the home page. Until now they came newest-updated first.
ALTER TABLE artists ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
UPDATE artists SET position = (
  SELECT COUNT(*) FROM artists b WHERE b.updated_at > artists.updated_at OR (b.updated_at = artists.updated_at AND b.id < artists.id)
);
