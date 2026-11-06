-- The library is organised by artist. What used to be a "project" is now an
-- artist; an artist's top-level folders are its projects (albums, EPs,
-- singles) and carry a cover and details; deeper folders stay plain folders.

-- Test data from before this change: keep the old artist field as the name.
UPDATE projects SET name = artist WHERE artist <> '';

ALTER TABLE projects RENAME TO artists;
ALTER TABLE artists DROP COLUMN artist;
ALTER TABLE artists DROP COLUMN year;
ALTER TABLE artists DROP COLUMN label;
ALTER TABLE artists RENAME COLUMN artwork_key TO photo_key;

ALTER TABLE folders RENAME COLUMN project_id TO artist_id;
-- Used when parent_id IS NULL (the folder is a project).
ALTER TABLE folders ADD COLUMN artwork_key TEXT;
ALTER TABLE folders ADD COLUMN year INTEGER;
ALTER TABLE folders ADD COLUMN label TEXT NOT NULL DEFAULT '';
ALTER TABLE folders ADD COLUMN description TEXT NOT NULL DEFAULT '';

ALTER TABLE tracks RENAME COLUMN project_id TO artist_id;
ALTER TABLE share_links RENAME COLUMN project_id TO artist_id;

DROP INDEX folders_by_project;
CREATE INDEX folders_by_artist ON folders(artist_id, parent_id, position);
DROP INDEX tracks_by_project;
CREATE INDEX tracks_by_artist ON tracks(artist_id, folder_id, position);
DROP INDEX share_links_by_project;
CREATE INDEX share_links_by_artist ON share_links(artist_id);
