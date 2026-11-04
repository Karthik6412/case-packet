import { z } from "zod";

// ---------- Vocabulary ----------

export const DOCUMENT_TYPES = [
  "RESUME",
  "PASSPORT",
  "OFFER_LETTER", // sponsor offer letter
  "EMPLOYMENT_VERIFICATION_LETTER", // one per claimed job
  "PAYROLL_RECORD", // optional supporting evidence
] as const;
export const DocumentTypeSchema = z.enum(DOCUMENT_TYPES);
export type DocumentType = z.infer<typeof DocumentTypeSchema>;

export const VisaCategorySchema = z.enum(["EB-2"]);
export type VisaCategory = z.infer<typeof VisaCategorySchema>;

export const FIELD_NAMES = [
  "fullName",
  "dateOfBirth",
  "passportNumber",
  "employerName",
  "employmentStartDate",
  "employmentEndDate",
  "jobTitle",
] as const;
export const FieldNameSchema = z.enum(FIELD_NAMES);
export type FieldName = z.infer<typeof FieldNameSchema>;

/** BLOCKED = known defect; NEEDS_ATTENTION = uncertainty; READY_FOR_REVIEW = no open findings. */
export const CaseStatusSchema = z.enum([
  "BLOCKED",
  "NEEDS_ATTENTION",
  "READY_FOR_REVIEW",
]);
export type CaseStatus = z.infer<typeof CaseStatusSchema>;

export const FindingTypeSchema = z.enum([
  "MISSING_REQUIRED_DOCUMENT",
  "IDENTITY_MISMATCH",
  "EMPLOYMENT_DATE_CONFLICT",
  "EMPLOYMENT_DATE_DISCREPANCY",
  "EXTRACTION_LOW_CONFIDENCE",
  "AMBIGUOUS_EMPLOYER_MATCH",
]);
export type FindingType = z.infer<typeof FindingTypeSchema>;

/** BLOCKING -> BLOCKED, ATTENTION -> NEEDS_ATTENTION, INFO -> recorded, no status effect. */
export const SeveritySchema = z.enum(["BLOCKING", "ATTENTION", "INFO"]);
export type Severity = z.infer<typeof SeveritySchema>;

// ---------- Case and documents ----------

export const CaseSchema = z.object({
  caseId: z.string().min(1),
  clientName: z.string().min(1),
  visaCategory: VisaCategorySchema,
});
export type Case = z.infer<typeof CaseSchema>;

/** One field as extracted from a document. value is null when not found. */
export const ExtractedFieldSchema = z.object({
  value: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  snippet: z.string().nullable(),
});
export type ExtractedField = z.infer<typeof ExtractedFieldSchema>;

export const ExtractionSchema = z.partialRecord(
  FieldNameSchema,
  ExtractedFieldSchema,
);
export type Extraction = z.infer<typeof ExtractionSchema>;

/** Immutable once stored: a replacement is a new version, never an edit. */
export const DocumentVersionSchema = z.object({
  documentId: z.string().min(1),
  type: DocumentTypeSchema,
  version: z.number().int().min(1),
  filename: z.string().min(1),
  text: z.string().min(1),
});
export type DocumentVersion = z.infer<typeof DocumentVersionSchema>;

/**
 * What validators consume: a document version plus its extraction.
 * A resume also carries claimedJobs, one extraction per job listed
 * (employerName, jobTitle, employmentStartDate, employmentEndDate).
 */
export const ExtractedDocumentSchema = z.object({
  documentId: z.string().min(1),
  type: DocumentTypeSchema,
  version: z.number().int().min(1),
  extraction: ExtractionSchema,
  claimedJobs: z.array(ExtractionSchema).default([]),
});
export type ExtractedDocument = z.infer<typeof ExtractedDocumentSchema>;

/** The current document versions of a case, as seen by one validation. */
export const CaseSnapshotSchema = z.object({
  caseId: z.string().min(1),
  visaCategory: VisaCategorySchema,
  documents: z.array(ExtractedDocumentSchema),
});
export type CaseSnapshot = z.infer<typeof CaseSnapshotSchema>;

// ---------- Findings ----------

/** Points at the source of a finding. Null ids describe a document that is absent. */
export const EvidenceSchema = z.object({
  documentId: z.string().nullable(),
  documentType: DocumentTypeSchema,
  version: z.number().int().min(1).nullable(),
  field: FieldNameSchema.nullable(),
  /** Which resume claim (index into claimedJobs) this evidence comes from, if any. */
  jobIndex: z.number().int().min(0).nullable(),
  value: z.string().nullable(),
  snippet: z.string().nullable(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const FindingSchema = z.object({
  type: FindingTypeSchema,
  severity: SeveritySchema,
  message: z.string().min(1),
  evidence: z.array(EvidenceSchema).min(1),
});
export type Finding = z.infer<typeof FindingSchema>;

// ---------- Trace: run -> steps ----------

/**
 * workflow = fixed, code-ordered pipeline event (may call an LLM internally).
 * agent    = an invocation selected by an LLM.
 * Workflow steps must never be labeled as agent decisions.
 */
export const StepKindSchema = z.enum(["workflow", "agent"]);
export type StepKind = z.infer<typeof StepKindSchema>;

export const StepSchema = z.object({
  index: z.number().int().min(0),
  kind: StepKindSchema,
  name: z.string().min(1),
  input: z.unknown(),
  output: z.unknown(),
  startedAt: z.iso.datetime(),
  durationMs: z.number().min(0),
  costUsd: z.number().min(0),
  model: z.string().nullable(),
  error: z.string().nullable(),
});
export type Step = z.infer<typeof StepSchema>;

export const RunSchema = z
  .object({
    runId: z.string().min(1),
    caseId: z.string().min(1),
    startedAt: z.iso.datetime(),
    durationMs: z.number().min(0),
    totalCostUsd: z.number().min(0),
    outcome: z.enum(["COMPLETED", "FAILED"]),
    failureReason: z.string().nullable(),
    documentVersions: z.array(
      z.object({ documentId: z.string(), version: z.number().int().min(1) }),
    ),
    caseStatus: CaseStatusSchema.nullable(),
    findings: z.array(FindingSchema),
    steps: z.array(StepSchema),
  })
  .superRefine((run, ctx) => {
    if (run.outcome === "COMPLETED" && run.caseStatus === null) {
      ctx.addIssue({ code: "custom", message: "COMPLETED run needs caseStatus" });
    }
    if (run.outcome === "FAILED" && run.failureReason === null) {
      ctx.addIssue({ code: "custom", message: "FAILED run needs failureReason" });
    }
  });
export type Run = z.infer<typeof RunSchema>;
