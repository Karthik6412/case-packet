import type {
  CaseSnapshot,
  FieldName,
  Finding,
} from "@/domain/schemas";
import {
  JOB_OPTIONAL_FIELDS,
  JOB_REQUIRED_FIELDS,
  LOW_CONFIDENCE_THRESHOLD,
  MINOR_DISCREPANCY_MAX_DAYS,
  OPTIONAL_FIELDS,
  REQUIRED_FIELDS,
} from "./config";
import { namesMatch, normalizeEmployer, parseIsoDay } from "./normalize";
import {
  docSource,
  entriesFor,
  evidenceFor,
  finding,
  hasValue,
  jobSources,
  pairsAgainstReference,
  sourceLabel,
  usableValue,
  type Source,
  type ValidationOptions,
} from "./shared";

const SOURCE_RANK: Record<string, number> = {
  RESUME: 0,
  EMPLOYMENT_VERIFICATION_LETTER: 1,
  PAYROLL_RECORD: 2,
};

/**
 * Deterministic consistency checks (the `run_validators` workflow step):
 * unreadable fields, identity, and employment dates. Pure: no I/O, no model
 * calls, no input mutation.
 */
export function validateConsistency(
  snapshot: CaseSnapshot,
  options: ValidationOptions = {},
): Finding[] {
  const threshold = options.confidenceThreshold ?? LOW_CONFIDENCE_THRESHOLD;
  const maxMinor = options.minorDiscrepancyMaxDays ?? MINOR_DISCREPANCY_MAX_DAYS;
  const docs = snapshot.documents;
  const findings: Finding[] = [];

  // 1. Required fields that are absent or unreliable; optional fields that
  //    carry a value but are unreliable.
  const checkFields = (
    source: Source,
    required: readonly FieldName[],
    optional: readonly FieldName[],
  ) => {
    for (const field of [...required, ...optional]) {
      const isRequired = required.includes(field);
      const unusable = usableValue(source.fields, field, threshold) === null;
      if (!unusable) continue;
      if (!isRequired && !hasValue(source.fields, field)) continue;
      const conf = source.fields[field]?.confidence;
      findings.push(
        finding(
          "EXTRACTION_LOW_CONFIDENCE",
          `${sourceLabel(source)}: "${field}" is missing, unreadable, or low confidence` +
            (conf === undefined ? "" : ` (confidence ${conf})`),
          [evidenceFor(source, field)],
        ),
      );
    }
  };

  for (const doc of docs) {
    const src = docSource(doc);
    checkFields(src, REQUIRED_FIELDS[doc.type], OPTIONAL_FIELDS[doc.type]);
    if (doc.type === "RESUME") {
      if (doc.claimedJobs.length === 0) {
        findings.push(
          finding(
            "EXTRACTION_LOW_CONFIDENCE",
            "RESUME: no employment history could be extracted, so claimed jobs cannot be verified",
            [evidenceFor(src, "fullName")],
          ),
        );
      }
      for (const job of jobSources(doc)) {
        checkFields(job, JOB_REQUIRED_FIELDS, JOB_OPTIONAL_FIELDS);
      }
    }
  }

  // 2. Identity across documents: name, then date of birth.
  const docSources = docs.map(docSource);
  for (const [a, b] of pairsAgainstReference(
    entriesFor(docSources, "fullName", threshold),
  )) {
    if (namesMatch(a.value, b.value)) continue;
    findings.push(
      finding(
        "IDENTITY_MISMATCH",
        `Name differs: ${sourceLabel(a.source)} has "${a.value}", ${sourceLabel(b.source)} has "${b.value}"`,
        [evidenceFor(a.source, "fullName"), evidenceFor(b.source, "fullName")],
      ),
    );
  }
  for (const [a, b] of pairsAgainstReference(
    entriesFor(docSources, "dateOfBirth", threshold),
  )) {
    if (a.value === b.value) continue;
    findings.push(
      finding(
        "IDENTITY_MISMATCH",
        `Date of birth differs: ${sourceLabel(a.source)} has ${a.value}, ${sourceLabel(b.source)} has ${b.value}`,
        [evidenceFor(a.source, "dateOfBirth"), evidenceFor(b.source, "dateOfBirth")],
      ),
    );
  }

  // 3. Employment dates, per employer, across resume claims, EVLs and payroll.
  //    0 days: nothing. 1..maxMinor: INFO discrepancy. Beyond: BLOCKING conflict.
  const employmentSources: Source[] = [
    ...docs.filter((d) => d.type === "RESUME").flatMap(jobSources),
    ...docs.filter((d) => d.type in SOURCE_RANK && d.type !== "RESUME").map(docSource),
  ].sort((x, y) => SOURCE_RANK[x.doc.type] - SOURCE_RANK[y.doc.type]);

  const byEmployer = new Map<string, Source[]>();
  for (const s of employmentSources) {
    const employer = usableValue(s.fields, "employerName", threshold);
    if (employer === null) continue;
    const key = normalizeEmployer(employer);
    byEmployer.set(key, [...(byEmployer.get(key) ?? []), s]);
  }

  for (const group of byEmployer.values()) {
    for (const field of ["employmentStartDate", "employmentEndDate"] as const) {
      const label = field === "employmentStartDate" ? "start" : "end";
      for (const [a, b] of pairsAgainstReference(entriesFor(group, field, threshold))) {
        const delta = Math.abs(
          (parseIsoDay(a.value) as number) - (parseIsoDay(b.value) as number),
        );
        if (delta === 0) continue;
        const detail =
          `Employment ${label} date differs by ${delta} day${delta === 1 ? "" : "s"}: ` +
          `${sourceLabel(a.source)} says ${a.value}, ${sourceLabel(b.source)} says ${b.value}`;
        findings.push(
          finding(
            delta <= maxMinor ? "EMPLOYMENT_DATE_DISCREPANCY" : "EMPLOYMENT_DATE_CONFLICT",
            detail,
            [evidenceFor(a.source, field), evidenceFor(b.source, field)],
          ),
        );
      }
    }
  }

  return findings;
}
