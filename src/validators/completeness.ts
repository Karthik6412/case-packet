import type { CaseSnapshot, Evidence, Finding } from "@/domain/schemas";
import {
  LOW_CONFIDENCE_THRESHOLD,
  PER_JOB_DOCUMENT,
  REQUIRED_DOCUMENTS,
} from "./config";
import { normalizeEmployer } from "./normalize";
import {
  docSource,
  evidenceFor,
  finding,
  jobSources,
  usableValue,
  type Source,
  type ValidationOptions,
} from "./shared";

function absentDocument(
  type: Evidence["documentType"],
  employer: string | null,
): Evidence {
  return {
    documentId: null,
    documentType: type,
    version: null,
    field: employer === null ? null : "employerName",
    jobIndex: null,
    value: employer,
    snippet: null,
  };
}

/**
 * Deterministic document-completeness check (the `check_document_completeness`
 * workflow step). Pure: no I/O, no model calls.
 *
 * Required: each single required document for the visa category, plus one
 * employment verification letter (EVL) per claimed job on the resume. Payroll
 * records are optional and never reported missing.
 */
export function checkDocumentCompleteness(
  snapshot: CaseSnapshot,
  options: ValidationOptions = {},
): Finding[] {
  const threshold = options.confidenceThreshold ?? LOW_CONFIDENCE_THRESHOLD;
  const docs = snapshot.documents;
  const findings: Finding[] = [];

  for (const type of REQUIRED_DOCUMENTS[snapshot.visaCategory]) {
    if (!docs.some((d) => d.type === type)) {
      findings.push(
        finding("MISSING_REQUIRED_DOCUMENT", `Required document missing: ${type}`, [
          absentDocument(type, null),
        ]),
      );
    }
  }

  // Without a resume there are no claimed jobs to pair letters with; the missing
  // resume is already reported above.
  if (!docs.some((d) => d.type === "RESUME")) return findings;

  // Claimed jobs whose employer could be read; unreadable ones are reported
  // as low-confidence by the consistency checks, not as missing here.
  const jobs: Source[] = docs
    .filter((d) => d.type === "RESUME")
    .flatMap(jobSources)
    .filter((j) => usableValue(j.fields, "employerName", threshold) !== null);

  const letters: Source[] = docs
    .filter((d) => d.type === PER_JOB_DOCUMENT)
    .map(docSource);

  const employerKey = (s: Source): string | null => {
    const v = usableValue(s.fields, "employerName", threshold);
    return v === null ? null : normalizeEmployer(v);
  };

  // Pair each claimed job with at most one unused letter of the same employer.
  const unmatchedLetters = [...letters];
  const unmatchedJobs: Source[] = [];
  for (const job of jobs) {
    const key = employerKey(job);
    const i = unmatchedLetters.findIndex((l) => employerKey(l) === key);
    if (i === -1) unmatchedJobs.push(job);
    else unmatchedLetters.splice(i, 1);
  }

  if (unmatchedJobs.length > 0 && unmatchedLetters.length > 0) {
    for (const job of unmatchedJobs) {
      const employer = job.fields.employerName?.value ?? "";
      findings.push(
        finding(
          "AMBIGUOUS_EMPLOYER_MATCH",
          `Claimed employer "${employer}" has no verification letter with a matching ` +
            `employer name, but unmatched letters exist; a person must confirm the pairing`,
          [
            evidenceFor(job, "employerName"),
            ...unmatchedLetters.map((l) => evidenceFor(l, "employerName")),
          ],
        ),
      );
    }
  } else if (unmatchedJobs.length > 0) {
    for (const job of unmatchedJobs) {
      const employer = job.fields.employerName?.value ?? "";
      findings.push(
        finding(
          "MISSING_REQUIRED_DOCUMENT",
          `Required document missing: ${PER_JOB_DOCUMENT} for claimed employer "${employer}"`,
          [evidenceFor(job, "employerName"), absentDocument(PER_JOB_DOCUMENT, employer)],
        ),
      );
    }
  } else {
    for (const letter of unmatchedLetters) {
      findings.push(
        finding(
          "AMBIGUOUS_EMPLOYER_MATCH",
          `Verification letter employer does not match any job claimed on the resume`,
          [evidenceFor(letter, "employerName")],
        ),
      );
    }
  }

  return findings;
}
