import type {
  Evidence,
  ExtractedDocument,
  Extraction,
  FieldName,
  Finding,
  FindingType,
} from "@/domain/schemas";
import { DATE_FIELDS, FINDING_SEVERITY } from "./config";
import { parseIsoDay } from "./normalize";

export interface ValidationOptions {
  /** Below this extraction confidence a value is treated as uncertain. */
  confidenceThreshold?: number;
  /** Largest date difference (days) that is INFO rather than BLOCKING. */
  minorDiscrepancyMaxDays?: number;
}

/**
 * A bag of extracted fields with its origin: a whole document, or one claimed
 * job on a resume (jobIndex set).
 */
export interface Source {
  doc: ExtractedDocument;
  jobIndex: number | null;
  fields: Extraction;
}

export interface Entry {
  source: Source;
  value: string;
}

export function docSource(doc: ExtractedDocument): Source {
  return { doc, jobIndex: null, fields: doc.extraction };
}

export function jobSources(resume: ExtractedDocument): Source[] {
  return resume.claimedJobs.map((fields, i) => ({
    doc: resume,
    jobIndex: i,
    fields,
  }));
}

export function evidenceFor(source: Source, field: FieldName): Evidence {
  const f = source.fields[field];
  return {
    documentId: source.doc.documentId,
    documentType: source.doc.type,
    version: source.doc.version,
    field,
    jobIndex: source.jobIndex,
    value: f?.value ?? null,
    snippet: f?.snippet ?? null,
  };
}

export function sourceLabel(source: Source): string {
  return source.jobIndex === null
    ? source.doc.type
    : `${source.doc.type} job #${source.jobIndex + 1}`;
}

export function finding(
  type: FindingType,
  message: string,
  evidence: Evidence[],
): Finding {
  return { type, severity: FINDING_SEVERITY[type], message, evidence };
}

/** A field value usable for comparison: present, confident, and well-formed. */
export function usableValue(
  fields: Extraction,
  field: FieldName,
  threshold: number,
): string | null {
  const f = fields[field];
  if (!f || f.value === null || f.value.trim() === "") return null;
  if (f.confidence < threshold) return null;
  if (DATE_FIELDS.has(field) && parseIsoDay(f.value) === null) return null;
  return f.value;
}

/** True when a value was extracted for the field, usable or not. */
export function hasValue(fields: Extraction, field: FieldName): boolean {
  const v = fields[field]?.value;
  return v !== undefined && v !== null && v.trim() !== "";
}

export function entriesFor(
  sources: readonly Source[],
  field: FieldName,
  threshold: number,
): Entry[] {
  const out: Entry[] = [];
  for (const source of sources) {
    const value = usableValue(source.fields, field, threshold);
    if (value !== null) out.push({ source, value });
  }
  return out;
}

/** Pair every later entry with the first (reference) entry. */
export function pairsAgainstReference(
  entries: readonly Entry[],
): Array<[Entry, Entry]> {
  const [ref, ...rest] = entries;
  return ref ? rest.map((e): [Entry, Entry] => [ref, e]) : [];
}
