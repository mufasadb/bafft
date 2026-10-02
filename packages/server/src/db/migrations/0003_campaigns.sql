CREATE TABLE `campaigns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`game_system` text DEFAULT 'other' NOT NULL,
	`style_anchor` text,
	`setting_notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "campaigns_game_system_check" CHECK("campaigns"."game_system" in ('draw-steel', 'dnd-5e', 'shadowdark', 'other'))
);
--> statement-breakpoint
-- Seed the single campaign existing entities/sessions already point at (campaign_id defaults to 1).
INSERT INTO `campaigns` (`id`, `name`, `game_system`, `created_at`, `updated_at`) VALUES (1, 'My campaign', 'other', strftime('%s','now') * 1000, strftime('%s','now') * 1000);
