-- MP3 loudness was measured on audio the browser had clipped at 0 dBFS, so the
-- true peak of loud masters read low. Clearing it makes the owner's browser
-- measure each MP3 again (now decoded by mpg123) the next time it is opened.
UPDATE versions SET lufs_integrated = NULL, lufs_range = NULL, true_peak_dbtp = NULL WHERE format = 'mp3';
