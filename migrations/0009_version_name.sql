-- The name a version carries from the track it was, when a track is dragged
-- onto another and becomes one of its versions (often a title the owner gave
-- it). NULL: never named, the owner's lists show the file name. Owner only.
ALTER TABLE versions ADD COLUMN name TEXT;
