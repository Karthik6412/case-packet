CREATE TABLE `cases` (
	`case_id` text PRIMARY KEY NOT NULL,
	`client_name` text NOT NULL,
	`visa_category` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `document_versions` (
	`case_id` text NOT NULL,
	`document_id` text NOT NULL,
	`version` integer NOT NULL,
	`type` text NOT NULL,
	`filename` text NOT NULL,
	`text` text NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`case_id`, `document_id`, `version`),
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`case_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "document_versions_version_positive" CHECK("document_versions"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE `evidence` (
	`run_id` text NOT NULL,
	`finding_position` integer NOT NULL,
	`position` integer NOT NULL,
	`document_id` text,
	`document_type` text NOT NULL,
	`version` integer,
	`field` text,
	`job_index` integer,
	`value` text,
	`snippet` text,
	PRIMARY KEY(`run_id`, `finding_position`, `position`),
	FOREIGN KEY (`run_id`,`finding_position`) REFERENCES `findings`(`run_id`,`position`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `findings` (
	`run_id` text NOT NULL,
	`position` integer NOT NULL,
	`type` text NOT NULL,
	`severity` text NOT NULL,
	`message` text NOT NULL,
	PRIMARY KEY(`run_id`, `position`),
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`run_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "findings_severity" CHECK("findings"."severity" in ('BLOCKING', 'ATTENTION', 'INFO'))
);
--> statement-breakpoint
CREATE TABLE `run_documents` (
	`run_id` text NOT NULL,
	`case_id` text NOT NULL,
	`document_id` text NOT NULL,
	`version` integer NOT NULL,
	PRIMARY KEY(`run_id`, `document_id`),
	FOREIGN KEY (`run_id`,`case_id`) REFERENCES `runs`(`run_id`,`case_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`case_id`,`document_id`,`version`) REFERENCES `document_versions`(`case_id`,`document_id`,`version`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`run_id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`run_number` integer NOT NULL,
	`started_at` text NOT NULL,
	`duration_ms` real NOT NULL,
	`total_cost_usd` real NOT NULL,
	`outcome` text NOT NULL,
	`failure_reason` text,
	`case_status` text,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`case_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "runs_outcome" CHECK("runs"."outcome" in ('COMPLETED', 'FAILED')),
	CONSTRAINT "runs_case_status" CHECK("runs"."case_status" is null or "runs"."case_status" in ('BLOCKED', 'NEEDS_ATTENTION', 'READY_FOR_REVIEW')),
	CONSTRAINT "runs_outcome_fields" CHECK(("runs"."outcome" = 'COMPLETED' and "runs"."case_status" is not null)
        or ("runs"."outcome" = 'FAILED' and "runs"."failure_reason" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runs_case_run_number` ON `runs` (`case_id`,`run_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `runs_run_case` ON `runs` (`run_id`,`case_id`);--> statement-breakpoint
CREATE TABLE `steps` (
	`run_id` text NOT NULL,
	`step_index` integer NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`input_json` text NOT NULL,
	`output_json` text NOT NULL,
	`started_at` text NOT NULL,
	`duration_ms` real NOT NULL,
	`cost_usd` real NOT NULL,
	`model` text,
	`error` text,
	PRIMARY KEY(`run_id`, `step_index`),
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`run_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "steps_kind" CHECK("steps"."kind" in ('workflow', 'agent'))
);
