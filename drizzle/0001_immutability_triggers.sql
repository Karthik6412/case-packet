-- History is append-only: reject any UPDATE or DELETE on every table, even from
-- code that bypasses the repository. Corrections are new rows (new document
-- versions, new runs), never edits.
CREATE TRIGGER `cases_no_update` BEFORE UPDATE ON `cases`
BEGIN SELECT RAISE(ABORT, 'cases is immutable: UPDATE is not allowed'); END;
--> statement-breakpoint
CREATE TRIGGER `cases_no_delete` BEFORE DELETE ON `cases`
BEGIN SELECT RAISE(ABORT, 'cases is immutable: DELETE is not allowed'); END;
--> statement-breakpoint
CREATE TRIGGER `document_versions_no_update` BEFORE UPDATE ON `document_versions`
BEGIN SELECT RAISE(ABORT, 'document_versions is immutable: UPDATE is not allowed'); END;
--> statement-breakpoint
CREATE TRIGGER `document_versions_no_delete` BEFORE DELETE ON `document_versions`
BEGIN SELECT RAISE(ABORT, 'document_versions is immutable: DELETE is not allowed'); END;
--> statement-breakpoint
CREATE TRIGGER `runs_no_update` BEFORE UPDATE ON `runs`
BEGIN SELECT RAISE(ABORT, 'runs is immutable: UPDATE is not allowed'); END;
--> statement-breakpoint
CREATE TRIGGER `runs_no_delete` BEFORE DELETE ON `runs`
BEGIN SELECT RAISE(ABORT, 'runs is immutable: DELETE is not allowed'); END;
--> statement-breakpoint
CREATE TRIGGER `run_documents_no_update` BEFORE UPDATE ON `run_documents`
BEGIN SELECT RAISE(ABORT, 'run_documents is immutable: UPDATE is not allowed'); END;
--> statement-breakpoint
CREATE TRIGGER `run_documents_no_delete` BEFORE DELETE ON `run_documents`
BEGIN SELECT RAISE(ABORT, 'run_documents is immutable: DELETE is not allowed'); END;
--> statement-breakpoint
CREATE TRIGGER `findings_no_update` BEFORE UPDATE ON `findings`
BEGIN SELECT RAISE(ABORT, 'findings is immutable: UPDATE is not allowed'); END;
--> statement-breakpoint
CREATE TRIGGER `findings_no_delete` BEFORE DELETE ON `findings`
BEGIN SELECT RAISE(ABORT, 'findings is immutable: DELETE is not allowed'); END;
--> statement-breakpoint
CREATE TRIGGER `evidence_no_update` BEFORE UPDATE ON `evidence`
BEGIN SELECT RAISE(ABORT, 'evidence is immutable: UPDATE is not allowed'); END;
--> statement-breakpoint
CREATE TRIGGER `evidence_no_delete` BEFORE DELETE ON `evidence`
BEGIN SELECT RAISE(ABORT, 'evidence is immutable: DELETE is not allowed'); END;
--> statement-breakpoint
CREATE TRIGGER `steps_no_update` BEFORE UPDATE ON `steps`
BEGIN SELECT RAISE(ABORT, 'steps is immutable: UPDATE is not allowed'); END;
--> statement-breakpoint
CREATE TRIGGER `steps_no_delete` BEFORE DELETE ON `steps`
BEGIN SELECT RAISE(ABORT, 'steps is immutable: DELETE is not allowed'); END;
