CREATE TABLE `sound_clips` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`board_id` integer NOT NULL,
	`asset_id` integer NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'one-shot' NOT NULL,
	`clip_group` text,
	`volume` real DEFAULT 0.8 NOT NULL,
	`fade_in_ms` integer DEFAULT 0 NOT NULL,
	`colour` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`board_id`) REFERENCES `soundboards`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`asset_id`) REFERENCES `sound_assets`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sound_clips_kind_check" CHECK("sound_clips"."kind" in ('loop', 'one-shot'))
);
