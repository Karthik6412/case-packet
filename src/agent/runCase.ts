import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Packet } from "@/domain/packet";
import {
  ExtractionSchema,
  type CaseStatus,
  type DocumentType,
  type ExtractedDocument,
  type Finding,
  type Run,
  type Step,
} from "@/domain/schemas";
import {
  RepositoryError,
  type CaseRepository,
  type StoredDocumentVersion,
  type StoredRun,
} from "@/repo/CaseRepository";
import { checkDocumentCompleteness } from "@/validators/completeness";
import { validateConsistency } from "@/validators/consistency";
import { deriveStatus } from "@/validators/status";
import { assemblePacket } from "./assemblePacket";
import type { DocumentExtractor } from "./extractor";

/*
 * The single entry point for executing a case. The application and the
 * evaluation harness both call this function; there is no second pipeline.
 *
 * It is deliberately independent of Next.js: it needs only a repository, an
 * extractor, and (optionally) a clock, an id generator and limits.
 *
 * The pipeline is a FIXED workflow, so every step is recorded with
 * kind "workflow". Nothing here is chosen by a model; `kind: "agent"` is
 * reserved for real model-selected tool calls, of which there are none yet.
 *
 *   load_documents
 *   extract_document        (once per document, in canonical order)
 *   check_document_completeness
 *   run_validators          (identity, employment dates, unreadable fields)
 *   assemble_packet
 *   derive_status
 *
 * Extraction precedes the completeness check because the per-job letter
 * requirement depends on the jobs claimed on the resume, which come from
 * extraction.
 *
 * The run is persisted once, at the end, in a single repository call (atomic).
 * Failures during the workflow still produce a persisted FAILED run.
 */

export const DEFAULT_MAX_STEPS = 20;
export const DEFAULT_TIMEOUT_MS = 30_000;

export interface Clock {
  now(): Date;
  /** Monotonic milliseconds, for durations and the deadline. */
  monotonicMs(): number;
}

const systemClock: Clock = {
  now: () => new Date(),
  monotonicMs: () => performance.now(),
};

export interface RunCaseDeps {
  repo: CaseRepository;
  extractor: DocumentExtractor;
  clock?: Clock;
  /** Must return a value unique across all runs ever recorded. */
  newRunId?: () => string;
  limits?: { maxSteps?: number; timeoutMs?: number };
}

export interface RunCaseResult {
  runId: string;
  caseId: string;
  outcome: Run["outcome"];
  /** Null when the run FAILED. */
  caseStatus: CaseStatus | null;
  failureReason: string | null;
  findings: Finding[];
  /** Null when the run FAILED before the packet was assembled. */
  packet: Packet | null;
  /** The executed steps, in order, exactly as persisted. */
  trace: Step[];
  /** The persisted run record. */
  run: StoredRun;
}

/** Aborts the workflow; carries the reason stored on the FAILED run. */
class RunAborted extends Error {}
class StepTimeout extends Error {}

const TYPE_ORDER: readonly DocumentType[] = [
  "RESUME",
  "PASSPORT",
  "OFFER_LETTER",
  "EMPLOYMENT_VERIFICATION_LETTER",
  "PAYROLL_RECORD",
];

/** Canonical order, so the same documents always produce the same trace. */
function orderDocuments(docs: readonly StoredDocumentVersion[]): StoredDocumentVersion[] {
  return [...docs].sort(
    (a, b) =>
      TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) ||
      a.documentId.localeCompare(b.documentId),
  );
}

const ExtractorOutputSchema = z.object({
  extraction: ExtractionSchema,
  claimedJobs: z.array(ExtractionSchema),
});

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function runCase(
  input: { caseId: string },
  deps: RunCaseDeps,
): Promise<RunCaseResult> {
  const { repo, extractor } = deps;
  const clock = deps.clock ?? systemClock;
  const maxSteps = deps.limits?.maxSteps ?? DEFAULT_MAX_STEPS;
  const timeoutMs = deps.limits?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // A run can only be recorded against an existing case.
  const caseRecord = await repo.getCase(input.caseId);
  if (!caseRecord) {
    throw new RepositoryError("CASE_NOT_FOUND", `Case ${input.caseId} not found`);
  }

  const runId = (deps.newRunId ?? (() => `run_${randomUUID()}`))();
  const startedAt = clock.now().toISOString();
  const t0 = clock.monotonicMs();
  const deadline = t0 + timeoutMs;
  const steps: Step[] = [];

  /**
   * Execute and record one workflow step. `fn` returns the value used by later
   * steps plus the (summarized) output stored in the trace. A step that throws
   * or times out is recorded with its error and aborts the run. A step that
   * would exceed the step cap or the deadline is not started, so it is never
   * recorded as executed.
   */
  async function step<T>(
    name: string,
    stepInput: unknown,
    fn: () => Promise<{ value: T; output: unknown }> | { value: T; output: unknown },
  ): Promise<T> {
    if (steps.length >= maxSteps) {
      throw new RunAborted(
        `step limit exceeded: ${maxSteps} steps executed, "${name}" was not run`,
      );
    }
    const remaining = deadline - clock.monotonicMs();
    if (remaining <= 0) {
      throw new RunAborted(
        `execution timeout: ${timeoutMs} ms exceeded before step "${name}"`,
      );
    }

    const index = steps.length;
    const stepStartedAt = clock.now().toISOString();
    const s0 = clock.monotonicMs();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        Promise.resolve().then(fn),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new StepTimeout()), remaining);
        }),
      ]);
      steps.push({
        index,
        kind: "workflow",
        name,
        input: stepInput,
        output: result.output,
        startedAt: stepStartedAt,
        durationMs: clock.monotonicMs() - s0,
        costUsd: 0, // deterministic and fixture-backed: no model cost yet
        model: null,
        error: null,
      });
      return result.value;
    } catch (e) {
      const timedOut = e instanceof StepTimeout;
      const error = timedOut ? `step timed out (execution limit ${timeoutMs} ms)` : message(e);
      steps.push({
        index,
        kind: "workflow",
        name,
        input: stepInput,
        output: null,
        startedAt: stepStartedAt,
        durationMs: clock.monotonicMs() - s0,
        costUsd: 0,
        model: null,
        error,
      });
      throw new RunAborted(
        timedOut
          ? `execution timeout: step "${name}" did not finish within ${timeoutMs} ms`
          : `step "${name}" failed: ${error}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  let documentVersions: Run["documentVersions"] = [];
  let findings: Finding[] = [];
  let packet: Packet | null = null;
  let caseStatus: CaseStatus | null = null;
  let failureReason: string | null = null;

  try {
    // 1. Load the latest version of each document.
    const documents = orderDocuments(
      await step("load_documents", { caseId: caseRecord.caseId }, async () => {
        const docs = await repo.getCurrentDocuments(caseRecord.caseId);
        return {
          value: docs,
          output: {
            documents: orderDocuments(docs).map((d) => ({
              documentId: d.documentId,
              type: d.type,
              version: d.version,
              filename: d.filename,
              contentHash: d.contentHash,
            })),
          },
        };
      }),
    );
    documentVersions = documents.map((d) => ({
      documentId: d.documentId,
      version: d.version,
    }));

    // 2. Extract facts from each document (fixture-backed for now).
    const extracted: ExtractedDocument[] = [];
    for (const doc of documents) {
      extracted.push(
        await step(
          "extract_document",
          { documentId: doc.documentId, version: doc.version, type: doc.type },
          async () => {
            const parsed = ExtractorOutputSchema.parse(await extractor.extract(doc));
            return {
              value: {
                documentId: doc.documentId,
                type: doc.type,
                version: doc.version,
                extraction: parsed.extraction,
                claimedJobs: parsed.claimedJobs,
              },
              output: {
                extraction: parsed.extraction,
                claimedJobs: parsed.claimedJobs,
              },
            };
          },
        ),
      );
    }
    const snapshot = {
      caseId: caseRecord.caseId,
      visaCategory: caseRecord.visaCategory,
      documents: extracted,
    };

    // 3. Deterministic completeness (required documents, one letter per claimed job).
    const completeness = await step(
      "check_document_completeness",
      { documents: documentVersions },
      () => {
        const f = checkDocumentCompleteness(snapshot);
        return { value: f, output: { findings: f } };
      },
    );

    // 4. Deterministic identity / employment-date / readability checks.
    const consistency = await step(
      "run_validators",
      { documents: documentVersions },
      () => {
        const f = validateConsistency(snapshot);
        return { value: f, output: { findings: f } };
      },
    );
    const allFindings = [...completeness, ...consistency];

    // 5. Assemble the draft packet.
    const draft = await step(
      "assemble_packet",
      { findingCount: allFindings.length },
      () => {
        const p = assemblePacket({
          caseRecord,
          documents,
          extracted,
          findings: allFindings,
        });
        return { value: p, output: { packet: p } };
      },
    );

    // 6. Derive the status from the findings. Code decides, never a model.
    const status = await step(
      "derive_status",
      { findingCount: allFindings.length },
      () => {
        const s = deriveStatus(allFindings);
        return { value: s, output: { status: s } };
      },
    );

    findings = allFindings;
    packet = draft;
    caseStatus = status;
  } catch (e) {
    if (!(e instanceof RunAborted)) throw e; // a bug, not a workflow failure
    failureReason = e.message;
    // A failed run publishes no findings, packet or status.
    findings = [];
    packet = null;
    caseStatus = null;
  }

  const run: Run = {
    runId,
    caseId: caseRecord.caseId,
    startedAt,
    durationMs: clock.monotonicMs() - t0,
    totalCostUsd: steps.reduce((sum, s) => sum + s.costUsd, 0),
    outcome: failureReason === null ? "COMPLETED" : "FAILED",
    failureReason,
    documentVersions,
    caseStatus,
    findings,
    steps,
  };

  // One atomic write. If it fails nothing is stored and the error propagates;
  // earlier runs are never touched.
  const stored = await repo.recordRun(run);

  return {
    runId: stored.runId,
    caseId: stored.caseId,
    outcome: stored.outcome,
    caseStatus: stored.caseStatus,
    failureReason: stored.failureReason,
    findings: stored.findings,
    packet,
    trace: stored.steps,
    run: stored,
  };
}
