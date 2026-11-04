import type { CaseStatus, DocumentType, FieldName } from "@/domain/schemas";

/*
 * Plain-language labels and formatting for the screens. Anything a paralegal
 * reads comes from here, never from internal names.
 */

export const STATUS_LABEL: Record<CaseStatus, string> = {
  BLOCKED: "Blocked",
  NEEDS_ATTENTION: "Needs attention",
  READY_FOR_REVIEW: "Ready for review",
};

/** Queue order: most urgent first. */
export const STATUS_RANK: Record<CaseStatus, number> = {
  BLOCKED: 0,
  NEEDS_ATTENTION: 1,
  READY_FOR_REVIEW: 2,
};

export const DOCUMENT_LABEL: Record<DocumentType, string> = {
  RESUME: "Resume",
  PASSPORT: "Passport (biographical page)",
  OFFER_LETTER: "Sponsor offer letter",
  EMPLOYMENT_VERIFICATION_LETTER: "Employment verification letter",
  PAYROLL_RECORD: "Payroll record",
};

/** The order documents are listed in: identity and history first, supporting evidence last. */
export const DOCUMENT_ORDER: readonly DocumentType[] = [
  "RESUME",
  "PASSPORT",
  "OFFER_LETTER",
  "EMPLOYMENT_VERIFICATION_LETTER",
  "PAYROLL_RECORD",
];

/** Lower-case form for use inside sentences. */
export const DOCUMENT_NOUN: Record<DocumentType, string> = {
  RESUME: "resume",
  PASSPORT: "passport",
  OFFER_LETTER: "sponsor offer letter",
  EMPLOYMENT_VERIFICATION_LETTER: "employment verification letter",
  PAYROLL_RECORD: "payroll record",
};

export const FIELD_LABEL: Record<FieldName, string> = {
  fullName: "Name",
  dateOfBirth: "Date of birth",
  passportNumber: "Passport number",
  employerName: "Employer",
  employmentStartDate: "Start date",
  employmentEndDate: "End date",
  jobTitle: "Job title",
};

const DATE_FIELDS: ReadonlySet<FieldName> = new Set([
  "dateOfBirth",
  "employmentStartDate",
  "employmentEndDate",
]);

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2021-03-15" -> "March 15, 2021". Anything else is returned unchanged. */
export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}, ${m[1]}` : iso;
}

export function formatValue(field: FieldName | null, value: string | null): string {
  if (value === null || value.trim() === "") return "Not found";
  return field !== null && DATE_FIELDS.has(field) ? formatDate(value) : value;
}

/** Whole days between two ISO dates, or null if either is not a date. */
export function daysBetween(a: string, b: string): number | null {
  const parse = (s: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  };
  const x = parse(a);
  const y = parse(b);
  return x === null || y === null ? null : Math.round(Math.abs(x - y) / 86_400_000);
}

export const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatDuration(ms: number): string {
  return ms < 1 ? "under 1 ms" : `${Math.round(ms)} ms`;
}
