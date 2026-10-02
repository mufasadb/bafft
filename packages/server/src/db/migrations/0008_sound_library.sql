CREATE TABLE `sound_assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`campaign_id` integer DEFAULT 1 NOT NULL,
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
	CONSTRAINT "sound_assets_category_check" CHECK("sound_assets"."category" in ('music', 'ambience', 'sfx')),
	CONSTRAINT "sound_assets_source_check" CHECK("sound_assets"."source" in ('upload', 'tabletop-audio', 'incompetech', 'freesound'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sound_assets_source_unique` ON `sound_assets` (`source`,`source_id`);--> statement-breakpoint
DROP TABLE `sound_clips`;