PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `sound_assets_new` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`campaign_id` integer NOT NULL DEFAULT 1,
	`title` text NOT NULL,
	`category` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`source` text DEFAULT 'upload' NOT NULL,
	`source_id` text,
	`licence` text,
	`attribution` text,
	`duration_ms` integer,
	`audio_path` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "sound_assets_category_check" CHECK("category" in ('music', 'ambience', 'sfx')),
	CONSTRAINT "sound_assets_source_check" CHECK("source" in ('upload', 'tabletop-audio', 'incompetech', 'freesound', 'folder'))
);
--> statement-breakpoint
INSERT INTO `sound_assets_new` SELECT `id`,`campaign_id`,`title`,`category`,`tags`,`source`,`source_id`,`licence`,`attribution`,`duration_ms`,`audio_path`,`created_at` FROM `sound_assets`;
--> statement-breakpoint
DROP TABLE `sound_assets`;
--> statement-breakpoint
ALTER TABLE `sound_assets_new` RENAME TO `sound_assets`;
--> statement-breakpoint
CREATE UNIQUE INDEX `sound_assets_source_unique` ON `sound_assets` (`source`,`source_id`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
