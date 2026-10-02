CREATE TABLE `app_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `entities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`campaign_id` integer DEFAULT 1 NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`aliases` text NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "entities_type_check" CHECK("entities"."type" in ('player', 'character', 'npc', 'item', 'location'))
);
--> statement-breakpoint
CREATE TABLE `entity_relationships` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`from_entity_id` integer NOT NULL,
	`to_entity_id` integer NOT NULL,
	`description` text NOT NULL,
	`is_containment` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`from_entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entity_relationships_one_containment_parent` ON `entity_relationships` (`from_entity_id`) WHERE "entity_relationships"."is_containment" = 1;--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`campaign_id` integer DEFAULT 1 NOT NULL,
	`title` text NOT NULL,
	`session_date` text NOT NULL,
	`audio_path` text,
	`status` text DEFAULT 'uploaded' NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "sessions_status_check" CHECK("sessions"."status" in ('uploaded', 'transcribing', 'transcribed', 'labelled'))
);
--> statement-breakpoint
CREATE TABLE `transcript_words` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`speaker_label` text NOT NULL,
	`text` text NOT NULL,
	`start_ms` integer NOT NULL,
	`end_ms` integer NOT NULL,
	`confidence` real NOT NULL,
	`is_uncertain` integer NOT NULL,
	`corrected` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
