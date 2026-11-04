import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";

/*
 * Every table here is append-only. The migration `immutability_triggers`
 * additionally makes UPDATE and DELETE fail at the database level, so history
 * cannot be rewritten even by code that bypasses the repository.
 */

export const cases = sqliteTable("cases", {
  caseId: text("case_id").primaryKey(),
  clientName: text("client_name").notNull(),
  visaCategory: text("visa_category").notNull(),
  createdAt: text("created_at").notNull(),
});

/** Content of one version of one document. A correction is a new row, never an edit. */
export const documentVersions = sqliteTable(
  "document_versions",
  {
    caseId: text("case_id")
      .notNull()
      .references(() => cases.caseId),
    documentId: text("document_id").notNull(),
    version: integer("version").notNull(),
    type: text("type").notNull(),
    filename: text("filename").notNull(),
    text: text("text").notNull(),
    contentHash: text("content_hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.caseId, t.documentId, t.version] }),
    check("document_versions_version_positive", sql`${t.version} >= 1`),
  ],
);

/** One agent execution of a case. Rows are written once, already complete. */
export const runs = sqliteTable(
  "runs",
  {
    runId: text("run_id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => cases.caseId),
    /** 1, 2, 3 ... within the case; gives history a stable order. */
    runNumber: integer("run_number").notNull(),
    startedAt: text("started_at").notNull(),
    durationMs: real("duration_ms").notNull(),
    totalCostUsd: real("total_cost_usd").notNull(),
    outcome: text("outcome").notNull(),
    failureReason: text("failure_reason"),
    caseStatus: text("case_status"),
    recordedAt: text("recorded_at").notNull(),
  },
  (t) => [
    unique("runs_case_run_number").on(t.caseId, t.runNumber),
    // Lets child tables prove a run belongs to a given case.
    unique("runs_run_case").on(t.runId, t.caseId),
    check("runs_outcome", sql`${t.outcome} in ('COMPLETED', 'FAILED')`),
    check(
      "runs_case_status",
      sql`${t.caseStatus} is null or ${t.caseStatus} in ('BLOCKED', 'NEEDS_ATTENTION', 'READY_FOR_REVIEW')`,
    ),
    check(
      "runs_outcome_fields",
      sql`(${t.outcome} = 'COMPLETED' and ${t.caseStatus} is not null)
        or (${t.outcome} = 'FAILED' and ${t.failureReason} is not null)`,
    ),
  ],
);

/** Which exact document versions a run used. */
export const runDocuments = sqliteTable(
  "run_documents",
  {
    runId: text("run_id").notNull(),
    caseId: text("case_id").notNull(),
    documentId: text("document_id").notNull(),
    version: integer("version").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.documentId] }),
    foreignKey({
      columns: [t.runId, t.caseId],
      foreignColumns: [runs.runId, runs.caseId],
    }),
    foreignKey({
      columns: [t.caseId, t.documentId, t.version],
      foreignColumns: [
        documentVersions.caseId,
        documentVersions.documentId,
        documentVersions.version,
      ],
    }),
  ],
);

export const findings = sqliteTable(
  "findings",
  {
    runId: text("run_id")
      .notNull()
      .references(() => runs.runId),
    position: integer("position").notNull(),
    type: text("type").notNull(),
    severity: text("severity").notNull(),
    message: text("message").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.position] }),
    check("findings_severity", sql`${t.severity} in ('BLOCKING', 'ATTENTION', 'INFO')`),
  ],
);

/**
 * Provenance of a finding. document_id is null for an absent document; there
 * is deliberately no foreign key on it for that reason.
 */
export const evidence = sqliteTable(
  "evidence",
  {
    runId: text("run_id").notNull(),
    findingPosition: integer("finding_position").notNull(),
    position: integer("position").notNull(),
    documentId: text("document_id"),
    documentType: text("document_type").notNull(),
    version: integer("version"),
    field: text("field"),
    jobIndex: integer("job_index"),
    value: text("value"),
    snippet: text("snippet"),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.findingPosition, t.position] }),
    foreignKey({
      columns: [t.runId, t.findingPosition],
      foreignColumns: [findings.runId, findings.position],
    }),
  ],
);

/** The trace: one row per executed event, in order. */
export const steps = sqliteTable(
  "steps",
  {
    runId: text("run_id")
      .notNull()
      .references(() => runs.runId),
    stepIndex: integer("step_index").notNull(),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    inputJson: text("input_json").notNull(),
    outputJson: text("output_json").notNull(),
    startedAt: text("started_at").notNull(),
    durationMs: real("duration_ms").notNull(),
    costUsd: real("cost_usd").notNull(),
    model: text("model"),
    error: text("error"),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.stepIndex] }),
    check("steps_kind", sql`${t.kind} in ('workflow', 'agent')`),
  ],
);
