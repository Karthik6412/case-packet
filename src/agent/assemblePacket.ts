import type { Packet } from "@/domain/packet";
import type {
  Case,
  ExtractedDocument,
  Finding,
} from "@/domain/schemas";
import type { StoredDocumentVersion } from "@/repo/CaseRepository";
import { LOW_CONFIDENCE_THRESHOLD } from "@/validators/config";
import { normalizeEmployer } from "@/validators/normalize";
import { usableValue } from "@/validators/shared";

/**
 * Deterministically assemble the draft packet from the current documents, their
 * extracted facts, and the findings. Pure: no I/O, no model calls.
 */
export function assemblePacket(args: {
  caseRecord: Case;
  documents: readonly StoredDocumentVersion[];
  extracted: readonly ExtractedDocument[];
  findings: readonly Finding[];
}): Packet {
  const { caseRecord, documents, extracted, findings } = args;
  const t = LOW_CONFIDENCE_THRESHOLD;

  const passport = extracted.find((d) => d.type === "PASSPORT");
  const resume = extracted.find((d) => d.type === "RESUME");

  const employmentHistory = (resume?.claimedJobs ?? []).map((job) => {
    const employer = usableValue(job, "employerName", t);
    const key = employer === null ? null : normalizeEmployer(employer);
    const supporting = extracted
      .filter(
        (d) =>
          (d.type === "EMPLOYMENT_VERIFICATION_LETTER" || d.type === "PAYROLL_RECORD") &&
          key !== null &&
          usableValue(d.extraction, "employerName", t) !== null &&
          normalizeEmployer(usableValue(d.extraction, "employerName", t) as string) === key,
      )
      .map((d) => ({ documentId: d.documentId, type: d.type, version: d.version }));
    return {
      employerName: job.employerName?.value ?? "(unknown)",
      jobTitle: usableValue(job, "jobTitle", t),
      startDate: usableValue(job, "employmentStartDate", t),
      endDate: usableValue(job, "employmentEndDate", t),
      supportingDocuments: supporting,
    };
  });

  const count = (severity: Finding["severity"]) =>
    findings.filter((f) => f.severity === severity).length;

  return {
    caseId: caseRecord.caseId,
    clientName: caseRecord.clientName,
    visaCategory: caseRecord.visaCategory,
    identity: {
      fullName: passport ? usableValue(passport.extraction, "fullName", t) : null,
      dateOfBirth: passport ? usableValue(passport.extraction, "dateOfBirth", t) : null,
      passportNumber: passport ? usableValue(passport.extraction, "passportNumber", t) : null,
    },
    documents: documents.map((d) => ({
      documentId: d.documentId,
      type: d.type,
      version: d.version,
      filename: d.filename,
      contentHash: d.contentHash,
    })),
    employmentHistory,
    complete: !findings.some((f) => f.type === "MISSING_REQUIRED_DOCUMENT"),
    findingCounts: {
      blocking: count("BLOCKING"),
      attention: count("ATTENTION"),
      info: count("INFO"),
    },
  };
}
