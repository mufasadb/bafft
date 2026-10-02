-- bafft-c4d.10: Tower folder tracks are now a Find more source, added to the
-- library one at a time. The bulk-imported ones leave the library unless a
-- board uses them; they're still in Find more to add back.
DELETE FROM `sound_assets` WHERE `source` = 'folder' AND `id` NOT IN (SELECT `asset_id` FROM `sound_clips`);
