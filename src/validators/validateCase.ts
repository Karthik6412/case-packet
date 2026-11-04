import type {
  CaseSnapshot,
  Evidence,
  ExtractedDocument,
  FieldName,
  Finding,
  FindingType,
} from "@/domain/schemas";
import {
  DATE_FIELDS,
  EMPLOYMENT_DATE_TOLERANCE_DAYS,
  FINDING_SEVERITY,
  LOW_CONFIDENCE_THRESHOLD,
  REQUIRED_DOCUMENTS,
  REQUIRED_FIELDS,
} from "./config";
import { namesMatch, normalizeEmployer, parseIsoDay } from "./normalize";

export interface ValidationOptions {
  confidenceThreshold?: number;
  dateToleranceDays?: number;
}

interface Entry {
  doc: ExtractedDocument;
  value: string;
}

function evidenceFor(doc: ExtractedDocument, field: FieldName): Evidence {
  const f = doc.extraction[field];
  return {
    documentId: doc.documentId,
    documentType: doc.type,
    version: doc.version,
    field,
    value: f?.value ?? null,
    snippet: f?.snippet ?? null,
  };
}

function finding(
  type: FindingType,
  message: string,
  evidence: Evidence[],
): Finding {
  return { type, severity: FINDING_SEVERITY[type], message, evidence };
}

/** A field value usable for cross-document comparison, or null. */
function usableValue(
  doc: ExtractedDocument,
  field: FieldName,
  threshold: number,
): string | null {
  const f = doc.extraction[field];
  if (!f || f.value === null || f.value.trim() === "") return null;
  if (f.confidence < threshold) return null;
  if (DATE_FIELDS.has(field) && parseIsoDay(f.value) === null) return null;
  return f.value;
}

function entriesFor(
  docs: readonly ExtractedDocument[],
  field: FieldName,
  threshold: number,
): Entry[] {
  const out: Entry[] = [];
  for (const doc of docs) {
    const value = usableValue(doc, field, threshold);
    if (value !== null) out.push({ doc, value });
  }
  return out;
}

/** Compare every later entry with the first (reference) entry. */
function pairsDiffering(
  entries: readonly Entry[],
  differs: (a: string, b: string) => boolean,
): Array<[Entry, Entry]> {
  const [ref, ...rest] = entries;
  if (!ref) return [];
  return rest.filter((e) => differs(ref.value, e.value)).map((e) => [ref, e]);
}

/**
 * Deterministic validation of a case snapshot. Pure: no I/O, no model calls,
 * no mutation of the input. Output order is stable.
 */
export function validateCase(
  snapshot: CaseSnapshot,
  options: ValidationOptions = {},
): Finding[] {
  const threshold = options.confidenceThreshold ?? LOW_CONFIDENCE_THRESHOLD;
  const tolerance = options.dateToleranceDays ?? EMPLOYMENT_DATE_TOLERANCE_DAYS;
  const docs = snapshot.documents;
  const findings: Finding[] = [];

  // 1. Required-document completeness.
  for (const type of REQUIRED_DOCUMENTS[snapshot.visaCategory]) {
    if (!docs.some((d) => d.type === type)) {
      findings.push(
        finding(
          "MISSING_REQUIRED_DOCUMENT",
          `Required document missing: ${type}`,
          [
            {
              documentId: null,
              documentType: type,
              version: null,
              field: null,
              value: null,
              snippet: null,
            },
          ],
        ),
      );
    }
  }

  // 2. Required fields that are absent or uncertain.
  for (const doc of docs) {
    for (const field of REQUIRED_FIELDS[doc.type]) {
      if (usableValue(doc, field, threshold) === null) {
        const conf = doc.extraction[field]?.confidence;
        findings.push(
          finding(
            "EXTRACTION_LOW_CONFIDENCE",
            `${doc.type}: "${field}" is missing, unreadable, or low confidence` +
              (conf === undefined ? "" : ` (confidence ${conf})`),
            [evidenceFor(doc, field)],
          ),
        );
      }
    }
  }

  // 3. Identity: name, then date of birth.
  for (const [a, b] of pairsDiffering(
    entriesFor(docs, "fullName", threshold),
    (x, y) => !namesMatch(x, y),
  )) {
    findings.push(
      finding(
        "IDENTITY_MISMATCH",
        `Name differs: ${a.doc.type} has "${a.value}", ${b.doc.type} has "${b.value}"`,
        [evidenceFor(a.doc, "fullName"), evidenceFor(b.doc, "fullName")],
      ),
    );
  }
  for (const [a, b] of pairsDiffering(
    entriesFor(docs, "dateOfBirth", threshold),
    (x, y) => x !== y,
  )) {
    findings.push(
      finding(
        "IDENTITY_MISMATCH",
        `Date of birth differs: ${a.doc.type} has ${a.value}, ${b.doc.type} has ${b.value}`,
        [evidenceFor(a.doc, "dateOfBirth"), evidenceFor(b.doc, "dateOfBirth")],
      ),
    );
  }

  // 4. Employment start date: material conflicts only.
  const startDelta = (x: string, y: string) =>
    Math.abs((parseIsoDay(x) as number) - (parseIsoDay(y) as number));
  for (const [a, b] of pairsDiffering(
    entriesFor(docs, "employmentStartDate", threshold),
    (x, y) => startDelta(x, y) > tolerance,
  )) {
    findings.push(
      finding(
        "EMPLOYMENT_DATE_CONFLICT",
        `Employment start date differs by ${startDelta(a.value, b.value)} days: ` +
          `${a.doc.type} says ${a.value}, ${b.doc.type} says ${b.value}`,
        [
          evidenceFor(a.doc, "employmentStartDate"),
          evidenceFor(b.doc, "employmentStartDate"),
        ],
      ),
    );
  }

  // 5. Employer name: unresolved differences are uncertain, not defects.
  for (const [a, b] of pairsDiffering(
    entriesFor(docs, "employerName", threshold),
    (x, y) => normalizeEmployer(x) !== normalizeEmployer(y),
  )) {
    findings.push(
      finding(
        "AMBIGUOUS_EMPLOYER_MATCH",
        `Employer names do not match after normalization: ${a.doc.type} has ` +
          `"${a.value}", ${b.doc.type} has "${b.value}"`,
        [evidenceFor(a.doc, "employerName"), evidenceFor(b.doc, "employerName")],
      ),
    );
  }

  return findings;
}
