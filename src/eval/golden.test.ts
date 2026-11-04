import { describe, expect, it } from "vitest";
import { loadFixture } from "@/fixtures/load";
import { formatGoldenTable, runGoldenEval } from "./golden";

describe("golden fixtures through runCase (minimal eval)", () => {
  it("every golden fixture matches its expected status, findings and step path", async () => {
    const rows = await runGoldenEval();
    expect(rows.map((r) => r.fixture)).toEqual([
      "clean",
      "date-conflict",
      "date-conflict (corrected)",
    ]);
    for (const r of rows) {
      expect(r, r.fixture).toMatchObject({ findingsMatch: true, pathMatch: true, pass: true });
    }
    expect(rows.map((r) => r.actualStatus)).toEqual(["READY_FOR_REVIEW", "BLOCKED", "READY_FOR_REVIEW"]);
  });

  it("flags a fixture whose expectations are wrong", async () => {
    const wrong = structuredClone(loadFixture("date-conflict"));
    wrong.expected.status = "NEEDS_ATTENTION";
    wrong.expected.findings = [];
    wrong.expected.workflowPath = wrong.expected.workflowPath.slice(1);
    const rows = await runGoldenEval({ fixtures: [wrong] });
    expect(rows[0]).toMatchObject({
      expectedStatus: "NEEDS_ATTENTION",
      actualStatus: "BLOCKED",
      findingsMatch: false,
      pathMatch: false,
      pass: false,
    });
  });

  it("prints a table with the requested columns", async () => {
    const table = formatGoldenTable(await runGoldenEval());
    const [header] = table.split("\n");
    for (const col of ["fixture", "expected status", "actual status", "findings match", "path match"]) {
      expect(header).toContain(col);
    }
    expect(table).toContain("PASS");
    expect(table).not.toContain("FAIL");
  });
});
