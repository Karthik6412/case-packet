import type {
  DocumentType,
  FieldName,
  FindingType,
  Severity,
  VisaCategory,
} from "@/domain/schemas";

/*
 * PROTOTYPE HEURISTICS, not calibrated guarantees. These values were chosen
 * for the demo; production would tune them against attorney-labeled cases.
 */

/** Extraction confidence below this is treated as uncertain. */
export const LOW_CONFIDENCE_THRESHOLD = 0.7;

/**
 * Date differences, in days, between two sources for the same employer:
 *   0                       -> no finding
 *   1..MINOR_DISCREPANCY_MAX_DAYS -> INFO discrepancy (recorded, no status effect)
 *   above that              -> BLOCKING conflict
 */
export const MINOR_DISCREPANCY_MAX_DAYS = 7;

/** Single required documents per visa category (deterministic; never an LLM call). */
export const REQUIRED_DOCUMENTS: Record<VisaCategory, readonly DocumentType[]> = {
  "EB-2": ["RESUME", "PASSPORT", "OFFER_LETTER"],
};

/** Additionally required: one of these per claimed job on the resume. */
export const PER_JOB_DOCUMENT: DocumentType = "EMPLOYMENT_VERIFICATION_LETTER";

/** Optional supporting evidence. Absence is never a finding. */
export const OPTIONAL_DOCUMENTS: readonly DocumentType[] = ["PAYROLL_RECORD"];

/** Fields that must be extractable (and confident) for each document type. */
export const REQUIRED_FIELDS: Record<DocumentType, readonly FieldName[]> = {
  RESUME: ["fullName"],
  PASSPORT: ["fullName", "dateOfBirth", "passportNumber"],
  OFFER_LETTER: ["fullName", "employerName", "jobTitle"],
  EMPLOYMENT_VERIFICATION_LETTER: ["fullName", "employerName", "employmentStartDate"],
  PAYROLL_RECORD: ["fullName", "employerName", "employmentStartDate"],
};

/** Fields that may legitimately be absent, but are flagged if present and unreliable. */
export const OPTIONAL_FIELDS: Record<DocumentType, readonly FieldName[]> = {
  RESUME: [],
  PASSPORT: [],
  OFFER_LETTER: [],
  EMPLOYMENT_VERIFICATION_LETTER: ["employmentEndDate"],
  PAYROLL_RECORD: ["dateOfBirth", "employmentEndDate"],
};

/** Required and optional fields of each claimed job on a resume. */
export const JOB_REQUIRED_FIELDS: readonly FieldName[] = [
  "employerName",
  "employmentStartDate",
];
export const JOB_OPTIONAL_FIELDS: readonly FieldName[] = ["employmentEndDate"];

export const DATE_FIELDS: ReadonlySet<FieldName> = new Set([
  "dateOfBirth",
  "employmentStartDate",
  "employmentEndDate",
]);

/**
 * Severity per finding type. BLOCKING -> BLOCKED (known defect),
 * ATTENTION -> NEEDS_ATTENTION (uncertainty), INFO -> no status effect.
 */
export const FINDING_SEVERITY: Record<FindingType, Severity> = {
  MISSING_REQUIRED_DOCUMENT: "BLOCKING",
  IDENTITY_MISMATCH: "BLOCKING",
  EMPLOYMENT_DATE_CONFLICT: "BLOCKING",
  EMPLOYMENT_DATE_DISCREPANCY: "INFO",
  EXTRACTION_LOW_CONFIDENCE: "ATTENTION",
  AMBIGUOUS_EMPLOYER_MATCH: "ATTENTION",
};
