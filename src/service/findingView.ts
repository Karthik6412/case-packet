import { z } from "zod";
import {
  ExtractionSchema,
  type Evidence,
  type Finding,
  type Severity,
  type Step,
} from "@/domain/schemas";
import {
  DOCUMENT_LABEL,
  DOCUMENT_NOUN,
  FIELD_LABEL,
  daysBetween,
  formatValue,
  plural,
} from "./format";

/** One side of a comparison: what a document says, and where it says it. */
export interface Side {
  document: string;
  version: string | null;
  label: string;
  value: string;
  /** Wording from the document itself, when available. */
  quote: string | null;
}

export interface FindingView {
  key: string;
  severity: Severity;
  severityLabel: string;
  title: string;
  explanation: string;
  recommendation: string;
  sides: Side[];
  /** Whether a message to the client could resolve this. */
  clarifiable: boolean;
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  BLOCKING: "Must be resolved",
  ATTENTION: "Needs confirmation",
  INFO: "For your information",
};

export const SEVERITY_RANK: Record<Severity, number> = {
  BLOCKING: 0,
  ATTENTION: 1,
  INFO: 2,
};

const ExtractStepInput = z.object({ documentId: z.string(), version: z.number() });
const ExtractStepOutput = z.object({
  extraction: ExtractionSchema,
  claimedJobs: z.array(ExtractionSchema),
});

/**
 * The employer a piece of evidence belongs to, read from what was extracted in
 * the same run. Findings only cite the disputed values, so this adds context.
 */
function employerFor(e: Evidence, steps: readonly Step[]): string | null {
  for (const s of steps) {
    if (s.name !== "extract_document") continue;
    const input = ExtractStepInput.safeParse(s.input);
    if (!input.success || input.data.documentId !== e.documentId || input.data.version !== e.version) {
      continue;
    }
    const out = ExtractStepOutput.safeParse(s.output);
    if (!out.success) return null;
    const fields = e.jobIndex === null ? out.data.extraction : out.data.claimedJobs[e.jobIndex];
    return fields?.employerName?.value ?? null;
  }
  return null;
}

function sideOf(e: Evidence): Side {
  if (e.documentId === null) {
    return {
      document: DOCUMENT_LABEL[e.documentType],
      version: null,
      label: "Status",
      value: "Not received",
      quote: null,
    };
  }
  return {
    document: DOCUMENT_LABEL[e.documentType],
    version: e.version === null ? null : `version ${e.version}`,
    label: e.field ? FIELD_LABEL[e.field] : "Detail",
    value: formatValue(e.field, e.value),
    quote: e.snippet,
  };
}

const quoted = (s: string | null) => `“${s ?? "unknown"}”`;

function describeDates(f: Finding, steps: readonly Step[]): FindingView {
  const [a, b] = f.evidence;
  const isEnd = a.field === "employmentEndDate";
  const word = isEnd ? "end date" : "start date";
  const employer = employerFor(a, steps) ?? employerFor(b, steps);
  const days = a.value && b.value ? daysBetween(a.value, b.value) : null;
  const gap = days === null ? "" : `, a difference of ${plural(days, "day")}`;
  const where = employer ? ` for ${employer}` : "";
  const claim =
    `The ${DOCUMENT_NOUN[a.documentType]} gives ${formatValue(a.field, a.value)} as the ${word}${where}, ` +
    `but the ${DOCUMENT_NOUN[b.documentType]} gives ${formatValue(b.field, b.value)}${gap}.`;

  if (f.type === "EMPLOYMENT_DATE_CONFLICT") {
    return {
      key: "",
      severity: f.severity,
      severityLabel: SEVERITY_LABEL[f.severity],
      title: "Employment dates don't match",
      explanation: claim,
      recommendation:
        "Ask the client which date is correct. Replace the document that is wrong, then re-run validation.",
      sides: f.evidence.map(sideOf),
      clarifiable: true,
    };
  }
  return {
    key: "",
    severity: f.severity,
    severityLabel: SEVERITY_LABEL[f.severity],
    title: "Employment dates differ slightly",
    explanation: `${claim} A small difference like this does not block the case.`,
    recommendation: "No action is required. Confirm with the client if the exact date matters for this filing.",
    sides: f.evidence.map(sideOf),
    clarifiable: false,
  };
}

/** Turn a stored finding into plain-language text and side-by-side evidence. */
export function describeFinding(f: Finding, steps: readonly Step[], index = 0): FindingView {
  const base = { severity: f.severity, severityLabel: SEVERITY_LABEL[f.severity] };
  const sides = f.evidence.map(sideOf);
  const key = `${index}-${f.type}`;
  const [a, b] = f.evidence;

  switch (f.type) {
    case "EMPLOYMENT_DATE_CONFLICT":
    case "EMPLOYMENT_DATE_DISCREPANCY":
      return { ...describeDates(f, steps), key };

    case "MISSING_REQUIRED_DOCUMENT": {
      const absent = f.evidence.find((e) => e.documentId === null) ?? a;
      const employer = absent.value;
      const isLetter = absent.documentType === "EMPLOYMENT_VERIFICATION_LETTER";
      return {
        ...base,
        key,
        title: "Required document missing",
        explanation: isLetter
          ? `No employment verification letter has been received for ${employer ?? "a past employer"}, which the resume lists as a past job.`
          : `No ${DOCUMENT_NOUN[absent.documentType]} has been received for this case.`,
        recommendation: isLetter
          ? "Request the letter from the client or the former employer."
          : "Request this document from the client.",
        sides: isLetter && b ? [sideOf(a), { ...sideOf(absent), label: "Verification letter" }] : sides,
        clarifiable: true,
      };
    }

    case "IDENTITY_MISMATCH": {
      const isDob = a.field === "dateOfBirth";
      return {
        ...base,
        key,
        title: isDob ? "Date of birth doesn't match" : "Name doesn't match",
        explanation: `The ${DOCUMENT_NOUN[a.documentType]} shows ${isDob ? formatValue(a.field, a.value) : quoted(a.value)}, but the ${DOCUMENT_NOUN[b.documentType]} shows ${isDob ? formatValue(b.field, b.value) : quoted(b.value)}.`,
        recommendation:
          "Confirm the correct spelling or date with the client, and replace the document that is wrong.",
        sides,
        clarifiable: true,
      };
    }

    case "AMBIGUOUS_EMPLOYER_MATCH": {
      const fromResume = a.documentType === "RESUME";
      const others = f.evidence.slice(1).map((e) => quoted(e.value)).join(" and ");
      return {
        ...base,
        key,
        title: "Employer name needs confirmation",
        explanation: fromResume
          ? `The resume lists ${quoted(a.value)}, but no verification letter names that employer. The letters received name ${others}.`
          : `The verification letter is for ${quoted(a.value)}, which is not a job listed on the resume.`,
        recommendation: "Confirm with the client whether these are the same employer, and obtain the right letter if not.",
        sides,
        clarifiable: true,
      };
    }

    case "EXTRACTION_LOW_CONFIDENCE": {
      const field = a.field ? FIELD_LABEL[a.field].toLowerCase() : "details";
      return {
        ...base,
        key,
        title: "A detail couldn't be read reliably",
        explanation: `We could not reliably read the ${field} on the ${DOCUMENT_NOUN[a.documentType]}.`,
        recommendation: "Check the document yourself, or ask the client for a clearer copy.",
        sides,
        clarifiable: true,
      };
    }
  }
}

export function describeFindings(findings: readonly Finding[], steps: readonly Step[]): FindingView[] {
  return findings
    .map((f, i) => describeFinding(f, steps, i))
    .sort((x, y) => SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity]);
}

/** "Employment dates don't match (+1 more)" or "No open issues". */
export function mainIssueText(views: readonly FindingView[]): string {
  const open = views.filter((v) => v.severity !== "INFO");
  if (open.length === 0) {
    const notes = views.length;
    return notes === 0 ? "No open issues" : `No open issues (${plural(notes, "note")})`;
  }
  return open.length === 1 ? open[0].title : `${open[0].title} (+${open.length - 1} more)`;
}

// ---------- Request clarification: a templated message to the client ----------

export interface ClarificationDraft {
  subject: string;
  body: string;
}

function requestFor(f: Finding, steps: readonly Step[]): string | null {
  const [a, b] = f.evidence;
  switch (f.type) {
    case "EMPLOYMENT_DATE_CONFLICT": {
      const employer = employerFor(a, steps) ?? employerFor(b, steps);
      const word = a.field === "employmentEndDate" ? "end date" : "start date";
      return (
        `Your ${DOCUMENT_NOUN[a.documentType]} gives ${formatValue(a.field, a.value)} as your ${word}` +
        `${employer ? ` at ${employer}` : ""}, but your ${DOCUMENT_NOUN[b.documentType]} gives ` +
        `${formatValue(b.field, b.value)}. Please tell us which date is correct and, if one of the documents is wrong, send us a corrected copy.`
      );
    }
    case "MISSING_REQUIRED_DOCUMENT": {
      const absent = f.evidence.find((e) => e.documentId === null) ?? a;
      return absent.documentType === "EMPLOYMENT_VERIFICATION_LETTER"
        ? `Please send us an employment verification letter from ${absent.value ?? "your former employer"}.`
        : `Please send us your ${DOCUMENT_NOUN[absent.documentType]}.`;
    }
    case "IDENTITY_MISMATCH":
      return a.field === "dateOfBirth"
        ? `Your ${DOCUMENT_NOUN[a.documentType]} shows a date of birth of ${formatValue(a.field, a.value)}, but your ${DOCUMENT_NOUN[b.documentType]} shows ${formatValue(b.field, b.value)}. Please confirm the correct date.`
        : `Your ${DOCUMENT_NOUN[a.documentType]} shows your name as ${quoted(a.value)}, but your ${DOCUMENT_NOUN[b.documentType]} shows ${quoted(b.value)}. Please confirm the correct spelling.`;
    case "AMBIGUOUS_EMPLOYER_MATCH":
      return a.documentType === "RESUME"
        ? `Your resume lists ${quoted(a.value)}, but the letters we received name ${f.evidence.slice(1).map((e) => quoted(e.value)).join(" and ")}. Please confirm whether these are the same employer.`
        : `We received a verification letter from ${quoted(a.value)}, which is not a job on your resume. Please confirm whether it belongs in your case.`;
    case "EXTRACTION_LOW_CONFIDENCE":
      return `Please send a clearer copy of your ${DOCUMENT_NOUN[a.documentType]}; we could not read the ${a.field ? FIELD_LABEL[a.field].toLowerCase() : "details"} reliably.`;
    case "EMPLOYMENT_DATE_DISCREPANCY":
      return null; // informational only
  }
}

/**
 * A preview of the message the paralegal could send. Nothing is sent: the
 * screen labels sending as planned.
 */
export function buildClarificationDraft(
  clientName: string,
  findings: readonly Finding[],
  steps: readonly Step[],
): ClarificationDraft | null {
  const items = findings
    .filter((f) => f.severity !== "INFO")
    .sort((x, y) => SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity])
    .map((f) => requestFor(f, steps))
    .filter((s): s is string => s !== null);
  if (items.length === 0) return null;

  const only = findings.filter((f) => f.severity !== "INFO");
  const subject =
    items.length > 1
      ? "Information needed for your case"
      : only[0].type === "EMPLOYMENT_DATE_CONFLICT"
        ? "Please confirm your employment dates"
        : only[0].type === "MISSING_REQUIRED_DOCUMENT"
          ? "A document is needed for your case"
          : "Information needed for your case";

  const list = items.length === 1 ? items[0] : items.map((s) => `• ${s}`).join("\n\n");
  const lead =
    items.length === 1
      ? "While preparing your immigration case packet, we found something we need your help with:"
      : "While preparing your immigration case packet, we found the following that we need your help with:";
  return {
    subject,
    body: `Dear ${clientName},\n\n${lead}\n\n${list}\n\nPlease reply to this message with the information or documents above.\n\nThank you,\nYour immigration team`,
  };
}

