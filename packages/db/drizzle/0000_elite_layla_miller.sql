CREATE TABLE `availability` (
	`weekday` integer PRIMARY KEY NOT NULL,
	`minutes` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `coach_decisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer NOT NULL,
	`kind` text NOT NULL,
	`decision` text NOT NULL,
	`reason` text NOT NULL,
	`evidence` text NOT NULL,
	`action` text,
	`expected_benefit` text,
	`target_topic_id` text,
	`baseline` text,
	`review_at` integer,
	`reviewed_at` integer,
	`outcome` text,
	`effectiveness` real,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`target_topic_id`) REFERENCES `topic_nodes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `coach_decisions_review_idx` ON `coach_decisions` (`review_at`);--> statement-breakpoint
CREATE INDEX `coach_decisions_at_idx` ON `coach_decisions` (`at`);--> statement-breakpoint
CREATE TABLE `coach_memory` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`weight` real DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `coach_memory_unique` ON `coach_memory` (`kind`,`key`);--> statement-breakpoint
CREATE TABLE `contest_results` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`contest_id` text NOT NULL,
	`participant_type` text NOT NULL,
	`rank` integer,
	`points` real,
	`penalty` integer,
	`solved_count` integer,
	`problem_count` integer,
	`rating_before` integer,
	`rating_after` integer,
	`performance` integer,
	`is_rated` integer DEFAULT false NOT NULL,
	`started_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`contest_id`) REFERENCES `contests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contest_results_unique` ON `contest_results` (`contest_id`,`participant_type`,`started_at`);--> statement-breakpoint
CREATE TABLE `contests` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`provider_contest_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`phase` text,
	`start_at` integer,
	`duration_seconds` integer,
	`is_icpc_style` integer DEFAULT false NOT NULL,
	`icpc_region` text,
	`country` text,
	`city` text,
	`season` text,
	`url` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `contests_provider_idx` ON `contests` (`provider`);--> statement-breakpoint
CREATE INDEX `contests_start_idx` ON `contests` (`start_at`);--> statement-breakpoint
CREATE INDEX `contests_icpc_idx` ON `contests` (`is_icpc_style`);--> statement-breakpoint
CREATE TABLE `goals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`text` text NOT NULL,
	`kind` text NOT NULL,
	`target` text NOT NULL,
	`progress` text,
	`status` text DEFAULT 'active' NOT NULL,
	`due_date` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE INDEX `goals_status_idx` ON `goals` (`status`);--> statement-breakpoint
CREATE TABLE `hint_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`attempt_id` integer NOT NULL,
	`level` text NOT NULL,
	`content` text,
	`llm_call_id` integer,
	`at` integer NOT NULL,
	FOREIGN KEY (`attempt_id`) REFERENCES `problem_attempts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`llm_call_id`) REFERENCES `llm_calls`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `hint_events_attempt_idx` ON `hint_events` (`attempt_id`);--> statement-breakpoint
CREATE TABLE `learning_log_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`topic_id` text NOT NULL,
	`note` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `topic_nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `learning_log_notes_topic_idx` ON `learning_log_notes` (`topic_id`);--> statement-breakpoint
CREATE TABLE `llm_calls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`purpose` text NOT NULL,
	`prompt_version` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`input` text NOT NULL,
	`output` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`latency_ms` integer,
	`ok` integer DEFAULT true NOT NULL,
	`error` text,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `llm_calls_purpose_idx` ON `llm_calls` (`purpose`);--> statement-breakpoint
CREATE INDEX `llm_calls_at_idx` ON `llm_calls` (`at`);--> statement-breakpoint
CREATE TABLE `mistake_occurrences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`mistake_id` integer NOT NULL,
	`problem_id` text,
	`submission_id` text,
	`at` integer NOT NULL,
	`notes` text,
	FOREIGN KEY (`mistake_id`) REFERENCES `mistakes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`problem_id`) REFERENCES `problems`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `mistake_occurrences_mistake_idx` ON `mistake_occurrences` (`mistake_id`);--> statement-breakpoint
CREATE TABLE `mistakes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category` text NOT NULL,
	`topic_id` text,
	`title` text NOT NULL,
	`cause` text,
	`lesson` text,
	`repetition_count` integer DEFAULT 0 NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `topic_nodes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `mistakes_category_idx` ON `mistakes` (`category`);--> statement-breakpoint
CREATE INDEX `mistakes_status_idx` ON `mistakes` (`status`);--> statement-breakpoint
CREATE TABLE `platform_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`handle` text NOT NULL,
	`verified_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `platform_accounts_provider_unique` ON `platform_accounts` (`provider`);--> statement-breakpoint
CREATE TABLE `problem_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`problem_id` text NOT NULL,
	`session_item_id` integer,
	`simulation_id` integer,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`active_phase` text,
	`phase_timings` text DEFAULT '{}' NOT NULL,
	`outcome` text DEFAULT 'in_progress' NOT NULL,
	`help_level` text DEFAULT 'none' NOT NULL,
	`abandon_reason` text,
	`first_submit_at` integer,
	`accepted_at` integer,
	`submission_count` integer DEFAULT 0 NOT NULL,
	`perceived_difficulty` integer,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`problem_id`) REFERENCES `problems`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_item_id`) REFERENCES `training_session_items`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`simulation_id`) REFERENCES `simulations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `problem_attempts_problem_idx` ON `problem_attempts` (`problem_id`);--> statement-breakpoint
CREATE INDEX `problem_attempts_started_idx` ON `problem_attempts` (`started_at`);--> statement-breakpoint
CREATE INDEX `problem_attempts_outcome_idx` ON `problem_attempts` (`outcome`);--> statement-breakpoint
CREATE TABLE `problem_tags` (
	`problem_id` text NOT NULL,
	`tag` text NOT NULL,
	PRIMARY KEY(`problem_id`, `tag`),
	FOREIGN KEY (`problem_id`) REFERENCES `problems`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `problem_tags_tag_idx` ON `problem_tags` (`tag`);--> statement-breakpoint
CREATE TABLE `problem_topics` (
	`problem_id` text NOT NULL,
	`topic_id` text NOT NULL,
	`confidence` real NOT NULL,
	`source` text NOT NULL,
	`model` text,
	`prompt_version` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`problem_id`, `topic_id`),
	FOREIGN KEY (`problem_id`) REFERENCES `problems`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topic_id`) REFERENCES `topic_nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `problem_topics_topic_idx` ON `problem_topics` (`topic_id`);--> statement-breakpoint
CREATE TABLE `problems` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`contest_id` text,
	`index` text NOT NULL,
	`name` text NOT NULL,
	`platform_rating` integer,
	`rating_source` text,
	`rating_is_experimental` integer DEFAULT false NOT NULL,
	`points` real,
	`solved_count` integer,
	`time_limit_ms` integer,
	`memory_limit_bytes` integer,
	`url` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`contest_id`) REFERENCES `contests`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `problems_provider_idx` ON `problems` (`provider`);--> statement-breakpoint
CREATE INDEX `problems_contest_idx` ON `problems` (`contest_id`);--> statement-breakpoint
CREATE INDEX `problems_rating_idx` ON `problems` (`platform_rating`);--> statement-breakpoint
CREATE TABLE `rating_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`contest_id` text,
	`contest_name` text,
	`rank` integer,
	`rating_before` integer,
	`rating_after` integer,
	`performance` integer,
	`at` integer NOT NULL,
	FOREIGN KEY (`contest_id`) REFERENCES `contests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rating_events_unique` ON `rating_events` (`provider`,`contest_id`);--> statement-breakpoint
CREATE TABLE `raw_payloads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`endpoint` text NOT NULL,
	`request_key` text DEFAULT '' NOT NULL,
	`http_status` integer,
	`fetched_at` integer NOT NULL,
	`body` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `raw_payloads_request_unique` ON `raw_payloads` (`provider`,`endpoint`,`request_key`);--> statement-breakpoint
CREATE TABLE `readiness_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`overall` real,
	`dimensions` text NOT NULL,
	`evidence` text,
	`phase` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `readiness_snapshots_date_unique` ON `readiness_snapshots` (`date`);--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`structured` text NOT NULL,
	`body_md` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reviews_kind_idx` ON `reviews` (`kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_period_unique` ON `reviews` (`kind`,`period_start`,`period_end`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `simulation_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`simulation_id` integer NOT NULL,
	`at` integer NOT NULL,
	`type` text NOT NULL,
	`problem_id` text,
	`payload` text,
	FOREIGN KEY (`simulation_id`) REFERENCES `simulations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`problem_id`) REFERENCES `problems`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `simulation_events_sim_idx` ON `simulation_events` (`simulation_id`);--> statement-breakpoint
CREATE TABLE `simulations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`contest_id` text,
	`duration_minutes` integer NOT NULL,
	`objective` text NOT NULL,
	`problem_set` text NOT NULL,
	`started_at` integer,
	`ended_at` integer,
	`status` text DEFAULT 'planned' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`contest_id`) REFERENCES `contests`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `simulations_status_idx` ON `simulations` (`status`);--> statement-breakpoint
CREATE TABLE `submission_sources` (
	`submission_id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`byte_length` integer NOT NULL,
	`fetched_at` integer NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`provider_submission_id` text NOT NULL,
	`problem_id` text NOT NULL,
	`contest_id` text,
	`verdict` text NOT NULL,
	`language` text,
	`submitted_at` integer NOT NULL,
	`relative_time_seconds` integer,
	`participant_type` text,
	`time_consumed_ms` integer,
	`memory_consumed_bytes` integer,
	`passed_test_count` integer,
	`ingested_at` integer NOT NULL,
	FOREIGN KEY (`problem_id`) REFERENCES `problems`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contest_id`) REFERENCES `contests`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `submissions_problem_idx` ON `submissions` (`problem_id`);--> statement-breakpoint
CREATE INDEX `submissions_contest_idx` ON `submissions` (`contest_id`);--> statement-breakpoint
CREATE INDEX `submissions_submitted_idx` ON `submissions` (`submitted_at`);--> statement-breakpoint
CREATE INDEX `submissions_verdict_idx` ON `submissions` (`verdict`);--> statement-breakpoint
CREATE TABLE `sync_state` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`resource` text NOT NULL,
	`cursor` text,
	`status` text DEFAULT 'never_synced' NOT NULL,
	`last_attempt_at` integer,
	`last_success_at` integer,
	`error` text,
	`items_synced` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_state_unique` ON `sync_state` (`provider`,`resource`);--> statement-breakpoint
CREATE TABLE `target_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`date` text NOT NULL,
	`location` text,
	`notes` text,
	`is_active` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `target_events_active_idx` ON `target_events` (`is_active`);--> statement-breakpoint
CREATE TABLE `team_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`codeforces_handle` text,
	`atcoder_handle` text,
	`strengths` text,
	`weaknesses` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `topic_mastery` (
	`topic_id` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`mastery` real DEFAULT 0 NOT NULL,
	`confidence` real DEFAULT 0 NOT NULL,
	`evidence_count` integer DEFAULT 0 NOT NULL,
	`solved_count` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`contest_proven_count` integer DEFAULT 0 NOT NULL,
	`last_practiced_at` integer,
	`last_failed_at` integer,
	`next_review_at` integer,
	`interval_days` real DEFAULT 0 NOT NULL,
	`ease` real DEFAULT 2.5 NOT NULL,
	`forgetting_risk` real DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`topic_id`) REFERENCES `topic_nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `topic_mastery_review_idx` ON `topic_mastery` (`next_review_at`);--> statement-breakpoint
CREATE INDEX `topic_mastery_state_idx` ON `topic_mastery` (`state`);--> statement-breakpoint
CREATE TABLE `topic_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`depth` integer DEFAULT 0 NOT NULL,
	`icpc_relevance` real DEFAULT 0.5 NOT NULL,
	`priority_class` text NOT NULL,
	`prerequisites` text DEFAULT '[]' NOT NULL,
	`typical_rating_floor` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`description` text,
	FOREIGN KEY (`parent_id`) REFERENCES `topic_nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `topic_nodes_parent_idx` ON `topic_nodes` (`parent_id`);--> statement-breakpoint
CREATE INDEX `topic_nodes_priority_idx` ON `topic_nodes` (`priority_class`);--> statement-breakpoint
CREATE TABLE `training_session_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`problem_id` text,
	`topic_id` text,
	`planned_minutes` integer NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`outcome` text,
	`notes` text,
	`reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `training_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`problem_id`) REFERENCES `problems`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`topic_id`) REFERENCES `topic_nodes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `training_session_items_session_idx` ON `training_session_items` (`session_id`);--> statement-breakpoint
CREATE TABLE `training_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date` text NOT NULL,
	`mode` text NOT NULL,
	`type` text NOT NULL,
	`objective` text NOT NULL,
	`mission` text NOT NULL,
	`planned_minutes` integer NOT NULL,
	`actual_minutes` integer,
	`status` text DEFAULT 'planned' NOT NULL,
	`skip_reason` text,
	`rationale` text,
	`phase` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE INDEX `training_sessions_date_idx` ON `training_sessions` (`date`);--> statement-breakpoint
CREATE INDEX `training_sessions_status_idx` ON `training_sessions` (`status`);--> statement-breakpoint
CREATE TABLE `user_profile` (
	`id` integer PRIMARY KEY NOT NULL,
	`display_name` text,
	`team_name` text,
	`onboarded_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `weaknesses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`topic_id` text,
	`dimension` text,
	`title` text NOT NULL,
	`severity` real NOT NULL,
	`confidence` real NOT NULL,
	`why` text NOT NULL,
	`evidence` text NOT NULL,
	`detected_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`topic_id`) REFERENCES `topic_nodes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `weaknesses_kind_idx` ON `weaknesses` (`kind`);--> statement-breakpoint
CREATE INDEX `weaknesses_topic_idx` ON `weaknesses` (`topic_id`);--> statement-breakpoint
CREATE INDEX `weaknesses_open_idx` ON `weaknesses` (`resolved_at`);