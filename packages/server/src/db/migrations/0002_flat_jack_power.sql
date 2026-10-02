PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_entity_relationships` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`from_entity_id` integer NOT NULL,
	`to_entity_id` integer NOT NULL,
	`description` text NOT NULL,
	`is_containment` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`from_entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_entity_relationships`("id", "from_entity_id", "to_entity_id", "description", "is_containment", "created_at") SELECT "id", "from_entity_id", "to_entity_id", "description", "is_containment", "created_at" FROM `entity_relationships`;--> statement-breakpoint
DROP TABLE `entity_relationships`;--> statement-breakpoint
ALTER TABLE `__new_entity_relationships` RENAME TO `entity_relationships`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `entity_relationships_one_containment_parent` ON `entity_relationships` (`from_entity_id`) WHERE "entity_relationships"."is_containment" = 1;