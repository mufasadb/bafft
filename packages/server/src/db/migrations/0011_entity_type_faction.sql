PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_entities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`campaign_id` integer DEFAULT 1 NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`aliases` text NOT NULL,
	`sounds_like` text DEFAULT '[]' NOT NULL,
	`notes` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`quirks` text DEFAULT '[]' NOT NULL,
	`image_path` text,
	`profile` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "entities_type_check" CHECK("__new_entities"."type" in ('player', 'character', 'npc', 'item', 'location', 'faction'))
);
--> statement-breakpoint
INSERT INTO `__new_entities`("id", "campaign_id", "type", "name", "aliases", "sounds_like", "notes", "tags", "quirks", "image_path", "profile", "created_at", "updated_at") SELECT "id", "campaign_id", "type", "name", "aliases", "sounds_like", "notes", "tags", "quirks", "image_path", "profile", "created_at", "updated_at" FROM `entities`;--> statement-breakpoint
DROP TABLE `entities`;--> statement-breakpoint
ALTER TABLE `__new_entities` RENAME TO `entities`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_sound_assets` (
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
	CONSTRAINT "sound_assets_category_check" CHECK("__new_sound_assets"."category" in ('music', 'ambience', 'sfx')),
	CONSTRAINT "sound_assets_source_check" CHECK("__new_sound_assets"."source" in ('upload', 'tabletop-audio', 'incompetech', 'freesound', 'folder'))
);
--> statement-breakpoint
INSERT INTO `__new_sound_assets`("id", "campaign_id", "title", "category", "tags", "source", "source_id", "licence", "attribution", "duration_ms", "audio_path", "created_at") SELECT "id", "campaign_id", "title", "category", "tags", "source", "source_id", "licence", "attribution", "duration_ms", "audio_path", "created_at" FROM `sound_assets`;--> statement-breakpoint
DROP TABLE `sound_assets`;--> statement-breakpoint
ALTER TABLE `__new_sound_assets` RENAME TO `sound_assets`;--> statement-breakpoint
CREATE UNIQUE INDEX `sound_assets_source_unique` ON `sound_assets` (`source`,`source_id`);