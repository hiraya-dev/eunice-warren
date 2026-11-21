CREATE TABLE `households` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`display_name` text NOT NULL,
	`ticket_code` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`archived_at` text,
	`archived_by` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text,
	CONSTRAINT "households_label_length" CHECK(length(label) <= 80),
	CONSTRAINT "households_display_name_length" CHECK(length(display_name) <= 40),
	CONSTRAINT "households_status_check" CHECK(status IN ('active', 'archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `households_ticket_code_idx` ON `households` (`ticket_code`);--> statement-breakpoint
CREATE TABLE `invite_seats` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`household_id` text NOT NULL,
	`kind` text NOT NULL,
	`slot` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`retired_at` text,
	`retired_by` text,
	`invited_name` text,
	`name_key` text,
	`surname_key` text,
	`name` text,
	`named_by_kind` text,
	`named_by` text,
	`named_at` text,
	`named_in_response_id` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`named_in_response_id`) REFERENCES `responses`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invite_seats_slot_range" CHECK(slot BETWEEN 1 AND 12 OR slot IS NULL),
	CONSTRAINT "invite_seats_kind_check" CHECK(kind IN ('member', 'plus_one')),
	CONSTRAINT "invite_seats_status_check" CHECK(status IN ('active', 'retired')),
	CONSTRAINT "invite_seats_active_slot_check" CHECK((status = 'active' AND slot IS NOT NULL) OR (status = 'retired' AND slot IS NULL)),
	CONSTRAINT "invite_seats_member_fields_check" CHECK((kind = 'member' AND invited_name IS NOT NULL AND name_key IS NOT NULL AND surname_key IS NOT NULL AND name IS NOT NULL) OR (kind = 'plus_one' AND invited_name IS NULL AND name_key IS NULL AND surname_key IS NULL)),
	CONSTRAINT "invite_seats_named_by_kind_check" CHECK(named_by_kind IS NULL OR named_by_kind IN ('guest', 'host'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invite_seats_household_slot_idx` ON `invite_seats` (`household_id`,`slot`);--> statement-breakpoint
CREATE INDEX `invite_seats_name_key_idx` ON `invite_seats` (`name_key`);--> statement-breakpoint
CREATE INDEX `invite_seats_surname_key_idx` ON `invite_seats` (`surname_key`);--> statement-breakpoint
CREATE INDEX `invite_seats_kind_status_name_idx` ON `invite_seats` (`kind`,`status`,`name`);--> statement-breakpoint
CREATE INDEX `invite_seats_status_household_idx` ON `invite_seats` (`status`,`household_id`);--> statement-breakpoint
CREATE TABLE `reminders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`household_id` text NOT NULL,
	`channel` text NOT NULL,
	`sent_at` text NOT NULL,
	`sent_by` text NOT NULL,
	`note` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "reminders_channel_check" CHECK(channel IN ('email', 'messenger'))
);
--> statement-breakpoint
CREATE INDEX `reminders_household_sent_idx` ON `reminders` (`household_id`,`sent_at`);--> statement-breakpoint
CREATE TABLE `response_seats` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`response_id` integer NOT NULL,
	`seat_id` integer,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`attending` integer NOT NULL,
	`slipper_size` text,
	FOREIGN KEY (`response_id`) REFERENCES `responses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`seat_id`) REFERENCES `invite_seats`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `response_seats_response_seat_idx` ON `response_seats` (`response_id`,`seat_id`);--> statement-breakpoint
CREATE TABLE `responses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`household_id` text NOT NULL,
	`submitted_at` text NOT NULL,
	`respondent_name` text NOT NULL,
	`attending` integer NOT NULL,
	`guest_count` integer NOT NULL,
	`email` text NOT NULL,
	`note` text,
	`source` text DEFAULT 'guest' NOT NULL,
	`edited_by` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "responses_source_check" CHECK(source IN ('guest', 'host')),
	CONSTRAINT "responses_source_editor_check" CHECK((source = 'guest' AND edited_by IS NULL) OR (source = 'host' AND edited_by IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `responses_household_submitted_idx` ON `responses` (`household_id`,"submitted_at" desc,"id" desc);--> statement-breakpoint
CREATE INDEX `responses_submitted_idx` ON `responses` (`submitted_at`);--> statement-breakpoint
CREATE TABLE `seat_assignments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`table_id` integer NOT NULL,
	`seat_id` integer NOT NULL,
	`position` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`table_id`) REFERENCES `seating_tables`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`seat_id`) REFERENCES `invite_seats`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `seat_assignments_table_position_idx` ON `seat_assignments` (`table_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `seat_assignments_seat_idx` ON `seat_assignments` (`seat_id`);--> statement-breakpoint
CREATE TABLE `seating_tables` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`capacity` integer NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text,
	CONSTRAINT "seating_tables_kind_check" CHECK(kind IN ('head', 'round')),
	CONSTRAINT "seating_tables_capacity_check" CHECK(capacity > 0)
);
--> statement-breakpoint
CREATE TABLE `songs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`song` text NOT NULL,
	`artist` text,
	`dedication` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `songs_name_key_idx` ON `songs` (`name_key`);