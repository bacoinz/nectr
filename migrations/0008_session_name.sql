-- The name of the track's project in the owner's DAW (e.g. the Ableton Live
-- Set), often different from the song title. Owner only: never sent to links.
ALTER TABLE tracks ADD COLUMN session_name TEXT NOT NULL DEFAULT '';
