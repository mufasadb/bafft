ALTER TABLE `entities` ADD `tags` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `entities` ADD `quirks` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `entities` ADD `image_path` text;