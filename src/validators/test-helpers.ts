import type {
  CaseSnapshot,
  DocumentType,
  ExtractedDocument,
  FieldName,
} from "@/domain/schemas";

/** string = confident value; [value, confidence] = explicit confidence; null = not found. */
export type FieldSpec = string | [string, number] | null;

export function makeDoc(
  type: DocumentType,
  fields: Partial<Record<FieldName, FieldSpec>>,
  documentId: string = type.toLowerCase(),
): ExtractedDocument {
  const extraction: ExtractedDocument["extraction"] = {};
  for (const [name, spec] of Object.entries(fields) as [FieldName, FieldSpec][]) {
    if (spec === null) {
      extraction[name] = { value: null, confidence: 0, snippet: null };
    } else if (typeof spec === "string") {
      extraction[name] = { value: spec, confidence: 0.95, snippet: spec };
    } else {
      extraction[name] = { value: spec[0], confidence: spec[1], snippet: spec[0] };
    }
  }
  return { documentId, type, version: 1, extraction };
}

/** A fully consistent EB-2 snapshot; override fields per document to create defects. */
export function baseSnapshot(
  overrides: {
    passport?: Partial<Record<FieldName, FieldSpec>>;
    letter?: Partial<Record<FieldName, FieldSpec>>;
    payroll?: Partial<Record<FieldName, FieldSpec>>;
    omit?: DocumentType[];
  } = {},
): CaseSnapshot {
  const docs = [
    makeDoc("PASSPORT", {
      fullName: "OKAFOR, AMARA CHIDI",
      dateOfBirth: "1990-04-12",
      passportNumber: "XK4471902",
      ...overrides.passport,
    }),
    makeDoc("EMPLOYMENT_VERIFICATION_LETTER", {
      fullName: "Amara C. Okafor",
      employerName: "Northwind Analytics, Inc.",
      employmentStartDate: "2021-09-01",
      ...overrides.letter,
    }),
    makeDoc("PAYROLL_RECORD", {
      fullName: "Amara Okafor",
      dateOfBirth: "1990-04-12",
      employerName: "Northwind Analytics Inc",
      employmentStartDate: "2021-09-01",
      ...overrides.payroll,
    }),
  ].filter((d) => !overrides.omit?.includes(d.type));
  return { caseId: "case-test", visaCategory: "EB-2", documents: docs };
}

export function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === "object" && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const v of Object.values(obj as object)) deepFreeze(v);
  }
  return obj;
}
