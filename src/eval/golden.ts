import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFixtureExtractor } from "@/agent/extractor";
import { runCase, type RunCaseResult } from "@/agent/runCase";
import { expectedFindingKeys, findingKeys } from "@/domain/findings";
import type { CaseStatus } from "@/domain/schemas";
import { loadAllFixtures } from "@/fixtures/load";
import type { Fixture } from "@/fixtures/schema";
import { applyFixtureReplacement, seedFixtureCase } from "@/fixtures/seed";
import { SqliteCaseRepository, type CaseRepository } from "@/repo";

/*
 * Minimal golden-fixture assertion (Milestone A). It calls the same `runCase`
 * the application uses, against a throwaway database, and compares status,
 * findings and the executed step path with each fixture's expected values.
 * The full metrics report, dashboard and judge arrive in Milestone B.
 */

export interface GoldenRow {
  fixture: string;
  expectedStatus: CaseStatus;
  actualStatus: CaseStatus | null;
  findingsMatch: boolean;
  pathMatch: boolean;
  pass: boolean;
}

const stepPath = (r: RunCaseResult) => r.trace.map((s) => `${s.kind}:${s.name}`);

function compare(
  label: string,
  result: RunCaseResult,
  expected: { status: CaseStatus; findings: Fixture["expected"]["findings"] },
  expectedPath: Fixture["expected"]["workflowPath"],
): GoldenRow {
  const findingsMatch =
    JSON.stringify(findingKeys(result.findings)) ===
    JSON.stringify(expectedFindingKeys(expected.findings));
  const pathMatch =
    JSON.stringify(stepPath(result)) ===
    JSON.stringify(expectedPath.map((p) => `${p.kind}:${p.name}`));
  const statusMatch = result.outcome === "COMPLETED" && result.caseStatus === expected.status;
  return {
    fixture: label,
    expectedStatus: expected.status,
    actualStatus: result.caseStatus,
    findingsMatch,
    pathMatch,
    pass: statusMatch && findingsMatch && pathMatch,
  };
}

/**
 * Run every golden fixture through `runCase`. A fixture with a replacement
 * document is run twice: as given, then again after storing the corrected
 * document as the next version.
 */
export async function runGoldenEval(
  options: { fixtures?: Fixture[]; repo?: CaseRepository } = {},
): Promise<GoldenRow[]> {
  const fixtures = options.fixtures ?? loadAllFixtures();
  let cleanup = () => {};
  let repo = options.repo;
  if (!repo) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "case-packet-eval-"));
    const sqlite = SqliteCaseRepository.open({ path: path.join(dir, "eval.db") });
    repo = sqlite;
    cleanup = () => {
      void sqlite.close();
      fs.rmSync(dir, { recursive: true, force: true });
    };
  }

  try {
    const deps = { repo, extractor: createFixtureExtractor(fixtures) };
    const rows: GoldenRow[] = [];
    for (const fixture of fixtures) {
      await seedFixtureCase(repo, fixture);
      const first = await runCase({ caseId: fixture.case.caseId }, deps);
      rows.push(compare(fixture.id, first, fixture.expected, fixture.expected.workflowPath));

      if (fixture.replacement) {
        await applyFixtureReplacement(repo, fixture);
        const second = await runCase({ caseId: fixture.case.caseId }, deps);
        rows.push(
          compare(
            `${fixture.id} (corrected)`,
            second,
            fixture.replacement.expected,
            fixture.expected.workflowPath,
          ),
        );
      }
    }
    return rows;
  } finally {
    cleanup();
  }
}

export function formatGoldenTable(rows: readonly GoldenRow[]): string {
  const header = ["fixture", "expected status", "actual status", "findings match", "path match", "result"];
  const body = rows.map((r) => [
    r.fixture,
    r.expectedStatus,
    r.actualStatus ?? "FAILED",
    r.findingsMatch ? "yes" : "NO",
    r.pathMatch ? "yes" : "NO",
    r.pass ? "PASS" : "FAIL",
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  return [line(header), line(widths.map((w) => "-".repeat(w))), ...body.map(line)].join("\n");
}
