import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expectedFindingKeys, findingKeys } from "@/domain/findings";
import { PacketSchema } from "@/domain/packet";
import { RunSchema } from "@/domain/schemas";
import { loadAllFixtures, loadFixture } from "@/fixtures/load";
import { applyFixtureReplacement, seedFixtureCase } from "@/fixtures/seed";
import { RepositoryError, type CaseRepository } from "@/repo/CaseRepository";
import { tempRepo, type TempRepo } from "@/repo/test-helpers";
import { createFixtureExtractor, type DocumentExtractor } from "./extractor";
import { runCase, type RunCaseDeps } from "./runCase";

let t: TempRepo;
const fixtures = loadAllFixtures();
const extractor = createFixtureExtractor(fixtures);
const clean = loadFixture("clean");
const conflict = loadFixture("date-conflict");

const deps = (over: Partial<RunCaseDeps> = {}): RunCaseDeps => ({
  repo: t.repo,
  extractor,
  ...over,
});
const pathOf = (fx: typeof clean) => fx.expected.workflowPath.map((p) => `${p.kind}:${p.name}`);

beforeEach(() => {
  t = tempRepo();
});
afterEach(() => t.cleanup());

/** A repository whose chosen methods are replaced; everything else is real. */
function wrapRepo(repo: CaseRepository, overrides: Partial<CaseRepository>): CaseRepository {
  return new Proxy(repo, {
    get(target, prop, receiver) {
      if (prop in overrides) return overrides[prop as keyof CaseRepository];
      const v = Reflect.get(target, prop, receiver) as unknown;
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

describe("clean case", () => {
  it("ends READY_FOR_REVIEW with no findings and a complete packet", async () => {
    await seedFixtureCase(t.repo, clean);
    const r = await runCase({ caseId: clean.case.caseId }, deps());

    expect(r.outcome).toBe("COMPLETED");
    expect(r.caseStatus).toBe("READY_FOR_REVIEW");
    expect(r.findings).toEqual([]);
    expect(r.failureReason).toBeNull();
    expect(r.trace.map((s) => `${s.kind}:${s.name}`)).toEqual(pathOf(clean));

    const packet = PacketSchema.parse(r.packet);
    expect(packet).toMatchObject({
      caseId: clean.case.caseId,
      complete: true,
      identity: { fullName: "OKAFOR, AMARA CHIDI", dateOfBirth: "1990-04-12", passportNumber: "XK4471902" },
      findingCounts: { blocking: 0, attention: 0, info: 0 },
    });
    expect(packet.documents).toHaveLength(5);
    expect(packet.employmentHistory.map((j) => [j.employerName, j.startDate, j.endDate])).toEqual([
      ["Northwind Analytics Inc", "2021-09-01", null],
      ["Orion Freight Ltd", "2016-06-01", "2021-08-31"],
    ]);
    expect(
      packet.employmentHistory.map((j) => j.supportingDocuments.map((d) => d.documentId)),
    ).toEqual([["clean-evl-northwind"], ["clean-evl-orion"]]);
  });

  it("persists exactly what it returns", async () => {
    await seedFixtureCase(t.repo, clean);
    const r = await runCase({ caseId: clean.case.caseId }, deps());
    const stored = await t.repo.getRun(r.runId);
    expect(stored).toEqual(r.run);
    expect(stored!.steps).toEqual(r.trace);
    expect(RunSchema.safeParse(stored).success).toBe(true);
  });
});

describe("date conflict and correction", () => {
  it("Run 1 is BLOCKED with evidence from both documents", async () => {
    await seedFixtureCase(t.repo, conflict);
    const r = await runCase({ caseId: conflict.case.caseId }, deps());

    expect(r.caseStatus).toBe("BLOCKED");
    expect(findingKeys(r.findings)).toEqual(expectedFindingKeys(conflict.expected.findings));
    const [f] = r.findings;
    expect(f).toMatchObject({ type: "EMPLOYMENT_DATE_CONFLICT", severity: "BLOCKING" });
    expect(f.evidence.map((e) => [e.documentId, e.version, e.field, e.value]).sort()).toEqual([
      ["dc-evl", 1, "employmentStartDate", "2021-09-01"],
      ["dc-resume", 1, "employmentStartDate", "2021-03-15"],
    ]);
    expect(f.message).toContain("170 days");
    expect(r.packet).not.toBeNull(); // a blocked case still gets a draft packet
    expect(r.packet!.findingCounts.blocking).toBe(1);
  });

  it("corrected resume v2 gives a new READY_FOR_REVIEW run; Run 1 is untouched", async () => {
    await seedFixtureCase(t.repo, conflict);
    const caseId = conflict.case.caseId;
    const run1 = await runCase({ caseId }, deps());
    const run1Snapshot = await t.repo.getRun(run1.runId);

    const v2 = await applyFixtureReplacement(t.repo, conflict);
    expect(v2.version).toBe(2);
    const run2 = await runCase({ caseId }, deps());

    expect(run2.runId).not.toBe(run1.runId);
    expect(run2.caseId).toBe(run1.caseId); // stable Case ID
    expect(run2.caseStatus).toBe("READY_FOR_REVIEW");
    expect(run2.findings).toEqual([]);
    expect(run2.run.documentVersions).toContainEqual({ documentId: "dc-resume", version: 2 });
    expect(run2.run.documentVersions).toContainEqual({ documentId: "dc-evl", version: 1 });

    // Previous run is identical after the correction.
    expect(await t.repo.getRun(run1.runId)).toEqual(run1Snapshot);
    expect(run1Snapshot!.documentVersions).toContainEqual({ documentId: "dc-resume", version: 1 });

    const history = (await t.repo.getCaseHistory(caseId))!;
    expect(history.runs.map((r) => [r.runNumber, r.caseStatus])).toEqual([
      [1, "BLOCKED"],
      [2, "READY_FOR_REVIEW"],
    ]);
    expect(history.latestStatus).toBe("READY_FOR_REVIEW");
  });

  it("uses the latest version of each document", async () => {
    await seedFixtureCase(t.repo, conflict);
    await applyFixtureReplacement(t.repo, conflict);
    const r = await runCase({ caseId: conflict.case.caseId }, deps());
    const load = r.trace[0];
    expect(load.name).toBe("load_documents");
    const loaded = (load.output as { documents: { documentId: string; version: number }[] }).documents;
    expect(loaded.filter((d) => d.documentId === "dc-resume")).toEqual([
      expect.objectContaining({ documentId: "dc-resume", version: 2 }),
    ]);
    const resumeExtract = r.trace.find(
      (s) => s.name === "extract_document" && (s.input as { documentId: string }).documentId === "dc-resume",
    );
    expect((resumeExtract!.input as { version: number }).version).toBe(2);
  });
});

describe("run identity", () => {
  it("every execution gets a unique Run ID under one stable Case ID; nothing is overwritten", async () => {
    await seedFixtureCase(t.repo, clean);
    const results = [];
    for (let i = 0; i < 3; i++) results.push(await runCase({ caseId: clean.case.caseId }, deps()));

    expect(new Set(results.map((r) => r.runId)).size).toBe(3);
    expect(new Set(results.map((r) => r.caseId))).toEqual(new Set([clean.case.caseId]));
    const history = (await t.repo.getCaseHistory(clean.case.caseId))!;
    expect(history.runs.map((r) => r.runNumber)).toEqual([1, 2, 3]);
    expect(history.runs.map((r) => r.runId)).toEqual(results.map((r) => r.runId));
  });

  it("refuses to reuse a run id", async () => {
    await seedFixtureCase(t.repo, clean);
    const fixedId = () => "run-fixed";
    await runCase({ caseId: clean.case.caseId }, deps({ newRunId: fixedId }));
    const before = await t.repo.getRun("run-fixed");
    await expect(runCase({ caseId: clean.case.caseId }, deps({ newRunId: fixedId }))).rejects.toMatchObject({
      code: "RUN_EXISTS",
    });
    expect(await t.repo.getRun("run-fixed")).toEqual(before);
  });

  it("rejects an unknown case without recording anything", async () => {
    await expect(runCase({ caseId: "ghost" }, deps())).rejects.toBeInstanceOf(RepositoryError);
    expect(await t.repo.getCaseHistory("ghost")).toBeNull();
  });
});

describe("trace", () => {
  it("records ordered, honest workflow steps", async () => {
    await seedFixtureCase(t.repo, clean);
    const { trace } = await runCase({ caseId: clean.case.caseId }, deps());

    expect(trace.map((s) => s.index)).toEqual(trace.map((_, i) => i));
    expect(trace.map((s) => s.name)).toEqual(clean.expected.workflowPath.map((p) => p.name));
    expect(trace[0].name).toBe("load_documents");
    expect(trace.at(-2)!.name).toBe("assemble_packet");
    expect(trace.at(-1)!.name).toBe("derive_status");

    for (const s of trace) {
      expect(s.kind, s.name).toBe("workflow"); // nothing is labeled as agent-selected
      expect(s.error, s.name).toBeNull();
      expect(s.costUsd, s.name).toBe(0);
      expect(s.model, s.name).toBeNull();
      expect(s.durationMs, s.name).toBeGreaterThanOrEqual(0);
      expect(s.input, s.name).toBeDefined();
      expect(s.output, s.name).not.toBeNull();
    }
    const starts = trace.map((s) => Date.parse(s.startedAt));
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it("derive_status records the status the run reports", async () => {
    await seedFixtureCase(t.repo, conflict);
    const r = await runCase({ caseId: conflict.case.caseId }, deps());
    expect(r.trace.at(-1)!.output).toEqual({ status: "BLOCKED" });
  });
});

describe("limits", () => {
  const STEPS_FOR_CLEAN = 10; // load + 5 extracts + completeness + validators + assemble + status

  it("completes at exactly the step cap and fails one below it", async () => {
    await seedFixtureCase(t.repo, clean);
    const ok = await runCase(
      { caseId: clean.case.caseId },
      deps({ limits: { maxSteps: STEPS_FOR_CLEAN } }),
    );
    expect(ok.outcome).toBe("COMPLETED");
    expect(ok.trace).toHaveLength(STEPS_FOR_CLEAN);

    const capped = await runCase(
      { caseId: clean.case.caseId },
      deps({ limits: { maxSteps: STEPS_FOR_CLEAN - 1 } }),
    );
    expect(capped.outcome).toBe("FAILED");
    expect(capped.trace).toHaveLength(STEPS_FOR_CLEAN - 1);
    expect(capped.trace.at(-1)!.name).toBe("assemble_packet");
    expect(capped.failureReason).toMatch(/step limit exceeded.*derive_status/);
  });

  it("a capped run is a FAILED record with no status, findings or packet, and history is intact", async () => {
    await seedFixtureCase(t.repo, clean);
    const good = await runCase({ caseId: clean.case.caseId }, deps());
    const goodBefore = await t.repo.getRun(good.runId);

    const capped = await runCase({ caseId: clean.case.caseId }, deps({ limits: { maxSteps: 3 } }));
    expect(capped).toMatchObject({ outcome: "FAILED", caseStatus: null, packet: null, findings: [] });
    expect(capped.trace.map((s) => s.name)).toEqual([
      "load_documents",
      "extract_document",
      "extract_document",
    ]);
    expect(capped.run.runNumber).toBe(2);

    const history = (await t.repo.getCaseHistory(clean.case.caseId))!;
    expect(history.runs.map((r) => r.outcome)).toEqual(["COMPLETED", "FAILED"]);
    expect(history.latestStatus).toBe("READY_FOR_REVIEW"); // the failure did not change it
    expect(await t.repo.getRun(good.runId)).toEqual(goodBefore);
  });

  it("enforces the execution timeout and records the step that timed out", async () => {
    await seedFixtureCase(t.repo, clean);
    const slow: DocumentExtractor = {
      async extract(doc) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return extractor.extract(doc);
      },
    };
    const started = Date.now();
    const r = await runCase(
      { caseId: clean.case.caseId },
      deps({ extractor: slow, limits: { timeoutMs: 60 } }),
    );
    expect(Date.now() - started).toBeLessThan(250); // did not wait for the slow extractor
    expect(r.outcome).toBe("FAILED");
    expect(r.failureReason).toMatch(/execution timeout/);
    expect(r.caseStatus).toBeNull();
    const last = r.trace.at(-1)!;
    expect(last).toMatchObject({ name: "extract_document", output: null });
    expect(last.error).toMatch(/timed out/);
    expect(r.trace.slice(0, -1).every((s) => s.error === null)).toBe(true);
  });

  it("does not start a step after the deadline has passed", async () => {
    await seedFixtureCase(t.repo, clean);
    let tick = 0;
    const clock = {
      now: () => new Date("2026-11-04T10:00:00.000Z"),
      // each reading advances 100ms, so the 250ms deadline passes after a few steps
      monotonicMs: () => (tick += 100),
    };
    const r = await runCase({ caseId: clean.case.caseId }, deps({ clock, limits: { timeoutMs: 250 } }));
    expect(r.outcome).toBe("FAILED");
    expect(r.failureReason).toMatch(/execution timeout: 250 ms exceeded before step/);
    expect(r.trace.every((s) => s.error === null)).toBe(true); // the late step was never recorded
  });
});

describe("failures", () => {
  it("a failing extractor yields a persisted FAILED run that keeps the executed steps", async () => {
    await seedFixtureCase(t.repo, clean);
    const good = await runCase({ caseId: clean.case.caseId }, deps());
    const broken: DocumentExtractor = {
      async extract(doc) {
        if (doc.type === "PASSPORT") throw new Error("could not read passport");
        return extractor.extract(doc);
      },
    };
    const r = await runCase({ caseId: clean.case.caseId }, deps({ extractor: broken }));

    expect(r).toMatchObject({ outcome: "FAILED", caseStatus: null, packet: null, findings: [] });
    expect(r.failureReason).toBe('step "extract_document" failed: could not read passport');
    expect(r.trace.map((s) => s.name)).toEqual([
      "load_documents",
      "extract_document", // resume
      "extract_document", // passport: fails
    ]);
    expect(r.trace.at(-1)).toMatchObject({ error: "could not read passport", output: null });
    expect(r.trace.at(-1)!.input).toMatchObject({ type: "PASSPORT" });

    const history = (await t.repo.getCaseHistory(clean.case.caseId))!;
    expect(history.runs).toHaveLength(2);
    expect(history.runs[0].runId).toBe(good.runId);
    expect(history.latestStatus).toBe("READY_FOR_REVIEW");
  });

  it("rejects malformed extractor output instead of trusting it", async () => {
    await seedFixtureCase(t.repo, clean);
    const garbage: DocumentExtractor = {
      extract: async () => ({ extraction: { fullName: { value: 7 } }, claimedJobs: [] }) as never,
    };
    const r = await runCase({ caseId: clean.case.caseId }, deps({ extractor: garbage }));
    expect(r.outcome).toBe("FAILED");
    expect(r.trace.at(-1)!.error).toBeTruthy();
  });

  it("refuses to apply fixture facts to a document whose content differs", async () => {
    await seedFixtureCase(t.repo, conflict);
    await t.repo.addDocumentVersion({
      caseId: conflict.case.caseId,
      documentId: "dc-resume",
      type: "RESUME",
      filename: "edited.txt",
      text: "an unreviewed edit the fixtures know nothing about",
    });
    const r = await runCase({ caseId: conflict.case.caseId }, deps());
    expect(r.outcome).toBe("FAILED");
    expect(r.failureReason).toMatch(/does not match its fixture content/);
  });

  it("a case with no documents is BLOCKED by missing documents, not an error", async () => {
    await t.repo.createCase({ caseId: "empty", clientName: "Empty", visaCategory: "EB-2" });
    const r = await runCase({ caseId: "empty" }, deps());
    expect(r.outcome).toBe("COMPLETED");
    expect(r.caseStatus).toBe("BLOCKED");
    expect(r.findings.map((f) => f.type)).toEqual([
      "MISSING_REQUIRED_DOCUMENT",
      "MISSING_REQUIRED_DOCUMENT",
      "MISSING_REQUIRED_DOCUMENT",
    ]);
    expect(r.packet!.complete).toBe(false);
  });
});

describe("persistence failure leaves no partial writes", () => {
  it("propagates the error and records nothing when the write is rejected", async () => {
    await seedFixtureCase(t.repo, clean);
    const failing = wrapRepo(t.repo, {
      recordRun: () => Promise.reject(new Error("disk full")),
    });
    await expect(runCase({ caseId: clean.case.caseId }, deps({ repo: failing }))).rejects.toThrow("disk full");
    expect((await t.repo.getCaseHistory(clean.case.caseId))!.runs).toEqual([]);
  });

  it("rolls the whole run back when a late insert fails inside the database transaction", async () => {
    await seedFixtureCase(t.repo, conflict);
    const poisoned = wrapRepo(t.repo, {
      // Corrupt the last step so serialization fails after the run, document
      // links, findings and evidence have already been inserted.
      recordRun: (run) =>
        t.repo.recordRun({
          ...run,
          steps: run.steps.map((s, i) =>
            i === run.steps.length - 1 ? { ...s, output: { n: BigInt(1) } } : s,
          ),
        }),
    });
    await expect(runCase({ caseId: conflict.case.caseId }, deps({ repo: poisoned }))).rejects.toThrow(/BigInt/);

    const history = (await t.repo.getCaseHistory(conflict.case.caseId))!;
    expect(history.runs).toEqual([]); // no run, findings, evidence or steps survived
    expect(history.latestStatus).toBeNull();

    // The case is healthy: the next run is run number 1.
    const ok = await runCase({ caseId: conflict.case.caseId }, deps());
    expect(ok.run.runNumber).toBe(1);
    expect(ok.findings).toHaveLength(1);
  });
});

describe("runner independence", () => {
  it("src/agent does not import Next.js or React", () => {
    const dir = path.join(process.cwd(), "src", "agent");
    const offenders = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .filter((f) =>
        /from\s+["'](next|react|react-dom)(\/[^"']*)?["']/.test(fs.readFileSync(path.join(dir, f), "utf8")),
      );
    expect(offenders).toEqual([]);
  });
});
