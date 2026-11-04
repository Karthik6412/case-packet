import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Finding, Run, Step } from "@/domain/schemas";
import type { Fixture } from "@/fixtures/schema";
import { toSnapshot } from "@/fixtures/load";
import { deriveStatus } from "@/validators/status";
import { validateCase } from "@/validators/validateCase";
import { SqliteCaseRepository } from "./sqlite/SqliteCaseRepository";

export interface TempRepo {
  repo: SqliteCaseRepository;
  dbPath: string;
  cleanup: () => void;
}

/** A repository on a fresh temporary SQLite file (WAL needs a real file). */
export function tempRepo(options: { busyTimeoutMs?: number } = {}): TempRepo {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "case-packet-test-"));
  const dbPath = path.join(dir, "test.db");
  const repo = SqliteCaseRepository.open({ path: dbPath, ...options });
  return {
    repo,
    dbPath,
    cleanup: () => {
      void repo.close().catch(() => undefined);
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function makeStep(index: number, name = "extract_document"): Step {
  return {
    index,
    kind: "workflow",
    name,
    input: { documentId: "doc", nested: { list: [1, 2, 3] } },
    output: { ok: true, fields: ["fullName"] },
    startedAt: "2026-11-04T10:00:00.000Z",
    durationMs: 12.5,
    costUsd: 0.0004,
    model: index === 0 ? "claude-haiku-5-5" : null,
    error: null,
  };
}

export function buildRun(o: {
  runId: string;
  caseId: string;
  documentVersions: Array<{ documentId: string; version: number }>;
  findings?: Finding[];
  steps?: Step[];
}): Run {
  const findings = o.findings ?? [];
  const steps = o.steps ?? [makeStep(0), makeStep(1, "run_validators")];
  return {
    runId: o.runId,
    caseId: o.caseId,
    startedAt: "2026-11-04T10:00:00.000Z",
    durationMs: steps.reduce((t, s) => t + s.durationMs, 0),
    totalCostUsd: steps.reduce((t, s) => t + s.costUsd, 0),
    outcome: "COMPLETED",
    failureReason: null,
    documentVersions: o.documentVersions,
    caseStatus: deriveStatus(findings),
    findings,
    steps,
  };
}

/** Create the case and store every fixture document as version 1. */
export async function seedFixture(repo: SqliteCaseRepository, fixture: Fixture) {
  await repo.createCase(fixture.case);
  for (const d of fixture.documents) {
    await repo.addDocumentVersion({
      caseId: fixture.case.caseId,
      documentId: d.documentId,
      type: d.type,
      filename: d.filename,
      text: d.text,
    });
  }
}

/**
 * Validate the fixture (optionally with its replacement applied) and record the
 * result as a run, using the fixture's expected workflow path as the trace.
 */
export function recordFixtureRun(
  repo: SqliteCaseRepository,
  fixture: Fixture,
  runId: string,
  applyReplacement = false,
) {
  const snapshot = toSnapshot(fixture, { applyReplacement });
  return repo.recordRun(
    buildRun({
      runId,
      caseId: fixture.case.caseId,
      documentVersions: snapshot.documents.map((d) => ({
        documentId: d.documentId,
        version: d.version,
      })),
      findings: validateCase(snapshot),
      steps: fixture.expected.workflowPath.map((p, i) => ({
        ...makeStep(i, p.name),
        kind: p.kind,
      })),
    }),
  );
}
