import type {
  DocumentType,
  FieldName,
  FindingType,
  Severity,
  VisaCategory,
} from "@/domain/schemas";

/** Extraction confidence below this is treated as uncertain. */
export const LOW_CONFIDENCE_THRESHOLD = 0.7;

/** Start dates differing by more than this many days are a material conflict. */
export const EMPLOYMENT_DATE_TOLERANCE_DAYS = 7;

/** Required document types per visa category. Deterministic; never an LLM call. */
export const REQUIRED_DOCUMENTS: Record<VisaCategory, readonly DocumentType[]> = {
  "EB-2": ["PASSPORT", "EMPLOYMENT_VERIFICATION_LETTER", "PAYROLL_RECORD"],
};

/** Fields that must be extractable (and confident) for each document type. */
export const REQUIRED_FIELDS: Record<DocumentType, readonly FieldName[]> = {
  PASSPORT: ["fullName", "dateOfBirth", "passportNumber"],
  EMPLOYMENT_VERIFICATION_LETTER: [
    "fullName",
    "employerName",
    "employmentStartDate",
  ],
  PAYROLL_RECORD: [
    "fullName",
    "dateOfBirth",
    "employerName",
    "employmentStartDate",
  ],
};

export const DATE_FIELDS: ReadonlySet<FieldName> = new Set([
  "dateOfBirth",
  "employmentStartDate",
]);

/**
 * Severity per finding type. BLOCKING -> BLOCKED (known defect),
 * ATTENTION -> NEEDS_ATTENTION (uncertainty).
 */
export const FINDING_SEVERITY: Record<FindingType, Severity> = {
  MISSING_REQUIRED_DOCUMENT: "BLOCKING",
  IDENTITY_MISMATCH: "BLOCKING",
  EMPLOYMENT_DATE_CONFLICT: "BLOCKING",
  EXTRACTION_LOW_CONFIDENCE: "ATTENTION",
  AMBIGUOUS_EMPLOYER_MATCH: "ATTENTION",
};
