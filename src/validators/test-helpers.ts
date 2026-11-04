import type {
  CaseSnapshot,
  DocumentType,
  ExtractedDocument,
  Extraction,
  FieldName,
} from "@/domain/schemas";

/** string = confident value; [value, confidence] = explicit confidence; null = not found. */
export type FieldSpec = string | [string, number] | null;
export type FieldSpecs = Partial<Record<FieldName, FieldSpec>>;

export function toExtraction(fields: FieldSpecs): Extraction {
  const out: Extraction = {};
  for (const [name, spec] of Object.entries(fields) as [FieldName, FieldSpec][]) {
    if (spec === null) {
      out[name] = { value: null, confidence: 0, snippet: null };
    } else if (typeof spec === "string") {
      out[name] = { value: spec, confidence: 0.95, snippet: `${name}: ${spec}` };
    } else {
      out[name] = { value: spec[0], confidence: spec[1], snippet: `${name}: ${spec[0]}` };
    }
  }
  return out;
}

export function makeDoc(
  type: DocumentType,
  fields: FieldSpecs,
  documentId: string = type.toLowerCase(),
  claimedJobs: FieldSpecs[] = [],
): ExtractedDocument {
  return {
    documentId,
    type,
    version: 1,
    extraction: toExtraction(fields),
    claimedJobs: claimedJobs.map(toExtraction),
  };
}

export const NORTHWIND_JOB: FieldSpecs = {
  employerName: "Northwind Analytics Inc",
  employmentStartDate: "2021-09-01",
};
export const NORTHWIND_LETTER: FieldSpecs = {
  fullName: "Amara C. Okafor",
  employerName: "Northwind Analytics, Inc.",
  employmentStartDate: "2021-09-01",
};

interface Overrides {
  passport?: FieldSpecs;
  resume?: FieldSpecs;
  /** Merged into the default (first) claimed job. */
  job?: FieldSpecs;
  /** Replaces all claimed jobs. */
  jobs?: FieldSpecs[];
  offer?: FieldSpecs;
  /** Merged into the default (first) verification letter. */
  letter?: FieldSpecs;
  /** Replaces all verification letters. */
  letters?: FieldSpecs[];
  /** Adds an optional payroll record. */
  payroll?: FieldSpecs;
  omit?: DocumentType[];
}

/**
 * A fully consistent EB-2 snapshot: passport, resume with one claimed job,
 * sponsor offer letter, and a matching verification letter. Override pieces to
 * create defects.
 */
export function baseSnapshot(o: Overrides = {}): CaseSnapshot {
  const jobs = o.jobs ?? [{ ...NORTHWIND_JOB, ...o.job }];
  const letters = o.letters ?? [{ ...NORTHWIND_LETTER, ...o.letter }];
  const docs: ExtractedDocument[] = [
    makeDoc("PASSPORT", {
      fullName: "OKAFOR, AMARA CHIDI",
      dateOfBirth: "1990-04-12",
      passportNumber: "XK4471902",
      ...o.passport,
    }),
    makeDoc("RESUME", { fullName: "Amara Okafor", ...o.resume }, "resume", jobs),
    makeDoc("OFFER_LETTER", {
      fullName: "Amara Okafor",
      employerName: "Cobalt Systems, Inc.",
      jobTitle: "Principal Data Engineer",
      ...o.offer,
    }),
    ...letters.map((l, i) =>
      makeDoc("EMPLOYMENT_VERIFICATION_LETTER", l, `evl-${i + 1}`),
    ),
    ...(o.payroll
      ? [
          makeDoc("PAYROLL_RECORD", {
            fullName: "Amara Okafor",
            employerName: "Northwind Analytics Inc",
            employmentStartDate: "2021-09-01",
            ...o.payroll,
          }),
        ]
      : []),
  ].filter((d) => !o.omit?.includes(d.type));
  return { caseId: "case-test", visaCategory: "EB-2", documents: docs };
}

export function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === "object" && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const v of Object.values(obj as object)) deepFreeze(v);
  }
  return obj;
}
