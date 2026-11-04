import { z } from "zod";
import { runCase, type RunCaseResult } from "@/agent/runCase";
import type { CaseStatus, DocumentType, Step } from "@/domain/schemas";
import { applyFixtureReplacement } from "@/fixtures/seed";
import type {
  CaseHistory,
  StoredDocumentVersion,
  StoredRun,
} from "@/repo/CaseRepository";
import type { AppContext } from "./context";
import {
  DOCUMENT_LABEL,
  DOCUMENT_ORDER,
  STATUS_LABEL,
  STATUS_RANK,
  formatDuration,
  formatWhen,
} from "./format";
import {
  buildClarificationDraft,
  describeFindings,
  mainIssueText,
  type ClarificationDraft,
  type FindingView,
} from "./findingView";

/** A message that is safe and sensible to show to the paralegal. */
export class UserFacingError extends Error {}

// ---------- Case queue ----------

export interface QueueItem {
  caseId: string;
  clientName: string;
  caseType: string;
  status: CaseStatus | null;
  mainIssue: string;
}

export interface CaseQueue {
  items: QueueItem[];
  counts: { blocked: number; needsAttention: number; ready: number; unchecked: number };
}

const latestCompleted = (history: CaseHistory): StoredRun | null =>
  [...history.runs].reverse().find((r) => r.outcome === "COMPLETED") ?? null;

export async function getCaseQueue(ctx: AppContext): Promise<CaseQueue> {
  const items: QueueItem[] = [];
  for (const c of await ctx.repo.listCases()) {
    const history = await ctx.repo.getCaseHistory(c.caseId);
    const run = history ? latestCompleted(history) : null;
    items.push({
      caseId: c.caseId,
      clientName: c.clientName,
      caseType: c.visaCategory,
      status: run?.caseStatus ?? null,
      mainIssue: run ? mainIssueText(describeFindings(run.findings, run.steps)) : "Not checked yet",
    });
  }
  // BLOCKED -> NEEDS_ATTENTION -> READY_FOR_REVIEW, unchecked last, then by name.
  const rank = (s: CaseStatus | null) => (s === null ? 3 : STATUS_RANK[s]);
  items.sort((a, b) => rank(a.status) - rank(b.status) || a.clientName.localeCompare(b.clientName));
  const count = (s: CaseStatus | null) => items.filter((i) => i.status === s).length;
  return {
    items,
    counts: {
      blocked: count("BLOCKED"),
      needsAttention: count("NEEDS_ATTENTION"),
      ready: count("READY_FOR_REVIEW"),
      unchecked: count(null),
    },
  };
}

// ---------- Case page ----------

export type ActionKind = "replace" | "rerun" | "clarify";

export interface StepView {
  number: number;
  label: string;
  outcome: "Done" | "Failed";
  duration: string;
  technical: { input: string; output: string; error: string | null };
}

export interface RunView {
  runId: string;
  number: number;
  when: string;
  status: CaseStatus | null;
  statusLabel: string;
  headline: string;
  documents: string[];
  failureNote: string | null;
  steps: StepView[];
}

export interface DocumentView {
  name: string;
  currentVersion: number;
  filename: string;
  earlierVersions: number;
}

export interface CaseView {
  caseId: string;
  clientName: string;
  caseType: string;
  status: CaseStatus | null;
  mainIssue: { title: string; explanation: string } | null;
  nextStep: string;
  primaryAction: ActionKind | null;
  rerunLabel: string;
  replace: { available: boolean; description: string };
  clarification: ClarificationDraft | null;
  /** True when a document changed after the latest completed check. */
  checkIsStale: boolean;
  notices: string[];
  /** One line per run, newest first: always visible, even with the audit trail closed. */
  runSummary: string[];
  findings: FindingView[];
  documents: DocumentView[];
  runs: RunView[];
}

const STEP_LABEL: Record<string, string> = {
  load_documents: "Loaded the current documents",
  check_document_completeness: "Checked that every required document is present",
  run_validators: "Compared names and dates across documents",
  assemble_packet: "Prepared the draft packet",
  derive_status: "Decided the case status",
};

const ExtractInput = z.object({ type: z.string(), version: z.number() });

function stepLabel(s: Step): string {
  if (s.name === "extract_document") {
    const input = ExtractInput.safeParse(s.input);
    if (input.success && input.data.type in DOCUMENT_LABEL) {
      return `Read the ${DOCUMENT_LABEL[input.data.type as DocumentType].toLowerCase()} (version ${input.data.version})`;
    }
    return "Read a document";
  }
  return STEP_LABEL[s.name] ?? s.name;
}

const pretty = (v: unknown) => JSON.stringify(v, null, 2) ?? "null";

function toStepViews(steps: readonly Step[]): StepView[] {
  return steps.map((s) => ({
    number: s.index + 1,
    label: stepLabel(s),
    outcome: s.error === null ? "Done" : "Failed",
    duration: formatDuration(s.durationMs),
    technical: { input: pretty(s.input), output: pretty(s.output), error: s.error },
  }));
}

function docName(type: DocumentType, version: number) {
  return `${DOCUMENT_LABEL[type]} (version ${version})`;
}

function toRunView(run: StoredRun, history: CaseHistory): RunView {
  const typeOf = new Map(history.documents.map((d) => [d.documentId, d.type]));
  const completed = run.outcome === "COMPLETED";
  return {
    runId: run.runId,
    number: run.runNumber,
    when: formatWhen(run.startedAt),
    status: run.caseStatus,
    statusLabel: run.caseStatus ? STATUS_LABEL[run.caseStatus] : "Did not finish",
    headline: completed
      ? mainIssueText(describeFindings(run.findings, run.steps))
      : "This check did not finish, so it did not change the case status.",
    documents: [...run.documentVersions]
      .sort(
        (a, b) =>
          DOCUMENT_ORDER.indexOf(typeOf.get(a.documentId) ?? "RESUME") -
            DOCUMENT_ORDER.indexOf(typeOf.get(b.documentId) ?? "RESUME") ||
          a.documentId.localeCompare(b.documentId),
      )
      .map((d) => {
        const type = typeOf.get(d.documentId);
        return type ? docName(type, d.version) : d.documentId;
      }),
    failureNote: run.failureReason,
    steps: toStepViews(run.steps),
  };
}

function currentDocuments(history: CaseHistory): StoredDocumentVersion[] {
  const latest = new Map<string, StoredDocumentVersion>();
  for (const d of history.documents) latest.set(d.documentId, d); // ascending versions
  return [...latest.values()].sort(
    (a, b) =>
      DOCUMENT_ORDER.indexOf(a.type) - DOCUMENT_ORDER.indexOf(b.type) ||
      a.documentId.localeCompare(b.documentId),
  );
}

export async function getCaseView(ctx: AppContext, caseId: string): Promise<CaseView | null> {
  const history = await ctx.repo.getCaseHistory(caseId);
  if (!history) return null;

  const fixture = ctx.fixtures.find((f) => f.case.caseId === caseId);
  const latest = latestCompleted(history);
  const lastRun = history.runs.at(-1) ?? null;
  const docs = currentDocuments(history);

  // A document changed since the latest completed check.
  const used = new Map((latest?.documentVersions ?? []).map((d) => [d.documentId, d.version]));
  const checkIsStale = latest !== null && docs.some((d) => used.get(d.documentId) !== d.version);

  const replacement = fixture?.replacement?.document;
  const currentOf = replacement ? docs.find((d) => d.documentId === replacement.documentId) : undefined;
  const canReplace = !!replacement && (currentOf?.version ?? 0) < replacement.version;

  const findings = latest ? describeFindings(latest.findings, latest.steps) : [];
  const status = history.latestStatus;
  const open = findings.filter((f) => f.severity !== "INFO");
  const top = open[0] ?? null;
  const clarification =
    latest && status !== "READY_FOR_REVIEW"
      ? buildClarificationDraft(history.case.clientName, latest.findings, latest.steps)
      : null;

  // Choose the one action that moves the case forward.
  let primaryAction: ActionKind | null;
  if (latest === null || checkIsStale) primaryAction = "rerun";
  else if (status === "READY_FOR_REVIEW") primaryAction = null;
  else if (canReplace) primaryAction = "replace";
  else if (clarification) primaryAction = "clarify";
  else primaryAction = "rerun";

  let nextStep: string;
  if (latest === null) nextStep = "Run validation to check this case's documents.";
  else if (checkIsStale) nextStep = "A document changed since the last check. Re-run validation to update the status.";
  else if (status === "READY_FOR_REVIEW") {
    nextStep = "No open issues. This case is ready for attorney review. Approval happens outside this tool.";
  } else if (canReplace && replacement) {
    nextStep = `Replace the ${DOCUMENT_LABEL[replacement.type].toLowerCase()} with the corrected version, then re-run validation.`;
  } else nextStep = top?.recommendation ?? "Review the findings below.";

  const notices: string[] = [];
  if (lastRun && lastRun.outcome === "FAILED") {
    notices.push(
      `The most recent check (Run ${lastRun.runNumber}) did not finish. ${latest ? `The results below are from Run ${latest.runNumber}.` : "There are no results yet."}`,
    );
  }
  const completed = history.runs.filter((r) => r.outcome === "COMPLETED");
  const [previous, current] = [completed.at(-2), completed.at(-1)];
  if (previous && current && previous.caseStatus && current.caseStatus) {
    notices.push(
      previous.caseStatus === current.caseStatus
        ? `Run ${current.runNumber} finished. The status is still ${STATUS_LABEL[current.caseStatus]}.`
        : `Run ${current.runNumber} changed the status from ${STATUS_LABEL[previous.caseStatus]} to ${STATUS_LABEL[current.caseStatus]}. Earlier runs are unchanged.`,
    );
  }

  const runs = [...history.runs].reverse().map((r) => toRunView(r, history));
  return {
    caseId: history.case.caseId,
    clientName: history.case.clientName,
    caseType: history.case.visaCategory,
    status,
    mainIssue: top ? { title: top.title, explanation: top.explanation } : null,
    nextStep,
    primaryAction,
    rerunLabel: latest === null ? "Run validation" : "Re-run validation",
    replace: {
      available: canReplace,
      description: replacement
        ? `Adds the corrected ${DOCUMENT_LABEL[replacement.type].toLowerCase()} as version ${replacement.version}. The original is kept.`
        : "",
    },
    clarification,
    checkIsStale,
    notices,
    runSummary: runs.map(
      (r) => `Run ${r.number} · ${r.statusLabel} · ${r.headline}`,
    ),
    findings,
    documents: docs.map((d) => ({
      name: DOCUMENT_LABEL[d.type],
      currentVersion: d.version,
      filename: d.filename,
      earlierVersions: d.version - 1,
    })),
    runs,
  };
}

// ---------- Actions ----------

async function requireCase(ctx: AppContext, caseId: string) {
  const c = await ctx.repo.getCase(caseId);
  if (!c) throw new UserFacingError("That case could not be found.");
  return c;
}

/**
 * Replace a document with the corrected version supplied with the case's
 * fixture. The corrected content never comes from the client. Idempotent: if
 * the correction is already stored, nothing is added.
 */
export async function replaceDocument(
  ctx: AppContext,
  caseId: string,
): Promise<{ added: boolean; version: number }> {
  await requireCase(ctx, caseId);
  const fixture = ctx.fixtures.find((f) => f.case.caseId === caseId);
  const replacement = fixture?.replacement?.document;
  if (!fixture || !replacement) {
    throw new UserFacingError("No corrected document is available for this case.");
  }
  const versions = await ctx.repo.getDocumentVersions(caseId, replacement.documentId);
  const current = versions.at(-1)?.version ?? 0;
  if (current >= replacement.version) return { added: false, version: current };
  const stored = await applyFixtureReplacement(ctx.repo, fixture);
  return { added: true, version: stored.version };
}

/** Validate the case again. Always creates a new run; earlier runs are untouched. */
export async function rerunValidation(ctx: AppContext, caseId: string): Promise<RunCaseResult> {
  await requireCase(ctx, caseId);
  return runCase({ caseId }, { repo: ctx.repo, extractor: ctx.extractor });
}

