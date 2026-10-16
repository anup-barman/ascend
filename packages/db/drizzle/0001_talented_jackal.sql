ALTER TABLE `raw_payloads` ADD `body_bytes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `raw_payloads` ADD `body_omitted` integer DEFAULT false NOT NULL;