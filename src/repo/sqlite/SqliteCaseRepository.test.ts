import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Finding } from "@/domain/schemas";
import { loadFixture } from "@/fixtures/load";
import { RepositoryError } from "../CaseRepository";
import {
  buildRun,
  makeStep,
  recordFixtureRun,
  seedFixture,
  tempRepo,
  type TempRepo,
} from "../test-helpers";

let t: TempRepo;
beforeEach(() => {
  t = tempRepo();
});
afterEach(() => t.cleanup());

const CASE = { caseId: "case-1", clientName: "Test Client", visaCategory: "EB-2" } as const;

async function withCaseAndDoc() {
  await t.repo.createCase(CASE);
  await t.repo.addDocumentVersion({
    caseId: "case-1",
    documentId: "doc-a",
    type: "RESUME",
    filename: "resume.txt",
    text: "version one",
  });
}

const rejectsWith = async (p: Promise<unknown>, code: string) => {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(RepositoryError);
  expect((err as RepositoryError).code).toBe(code);
};

const sampleFinding: Finding = {
  type: "EMPLOYMENT_DATE_CONFLICT",
  severity: "BLOCKING",
  message: "dates differ",
  evidence: [
    {
      documentId: "doc-a",
      documentType: "RESUME",
      version: 1,
      field: "employmentStartDate",
      jobIndex: 0,
      value: "2021-03-15",
      snippet: "2021-03-15 to present",
    },
    {
      documentId: null,
      documentType: "PASSPORT",
      version: null,
      field: null,
      jobIndex: null,
      value: null,
      snippet: null,
    },
  ],
};

describe("connection settings", () => {
  it("uses WAL, a busy timeout, and enforces foreign keys", () => {
    expect(t.repo.inspectPragmas()).toEqual({
      journalMode: "wal",
      busyTimeoutMs: 5000,
      foreignKeys: true,
    });
  });

  it("honors a custom busy timeout and waits for a competing writer before failing", async () => {
    t.cleanup();
    t = tempRepo({ busyTimeoutMs: 150 });
    expect(t.repo.inspectPragmas().busyTimeoutMs).toBe(150);

    const other = new Database(t.dbPath);
    other.exec("BEGIN IMMEDIATE"); // hold the write lock
    const started = Date.now();
    await expect(t.repo.createCase(CASE)).rejects.toThrow(/locked|busy/i);
    expect(Date.now() - started).toBeGreaterThanOrEqual(100); // it waited
    other.exec("ROLLBACK");
    other.close();

    await expect(t.repo.createCase(CASE)).resolves.toMatchObject({ caseId: "case-1" });
  });

  it("persists across reopen and re-applying migrations is harmless", async () => {
    await withCaseAndDoc();
    await t.repo.close();
    t.repo = (await import("./SqliteCaseRepository")).SqliteCaseRepository.open({
      path: t.dbPath,
    });
    expect(await t.repo.getCase("case-1")).toMatchObject({ clientName: "Test Client" });
    expect(await t.repo.getDocumentVersions("case-1")).toHaveLength(1);
  });

  it("lets a second connection read committed data (WAL)", async () => {
    await withCaseAndDoc();
    const reader = (await import("./SqliteCaseRepository")).SqliteCaseRepository.open({
      path: t.dbPath,
    });
    expect(await reader.getCase("case-1")).not.toBeNull();
    await t.repo.createCase({ ...CASE, caseId: "case-2" });
    expect((await reader.listCases()).map((c) => c.caseId).sort()).toEqual(["case-1", "case-2"]);
    await reader.close();
  });
});

describe("cases", () => {
  it("creates, reads and lists cases with stable ids", async () => {
    const created = await t.repo.createCase(CASE);
    expect(created).toMatchObject(CASE);
    expect(Date.parse(created.createdAt)).not.toBeNaN();
    expect(await t.repo.getCase("case-1")).toEqual(created);
    expect(await t.repo.getCase("nope")).toBeNull();
    await t.repo.createCase({ ...CASE, caseId: "case-2" });
    expect((await t.repo.listCases()).map((c) => c.caseId)).toEqual(["case-1", "case-2"]);
  });

  it("rejects a duplicate case id and leaves the original untouched", async () => {
    await t.repo.createCase(CASE);
    await rejectsWith(t.repo.createCase({ ...CASE, clientName: "Impostor" }), "CASE_EXISTS");
    expect((await t.repo.getCase("case-1"))!.clientName).toBe("Test Client");
  });
});

describe("document versions", () => {
  it("assigns increasing versions and never alters earlier ones", async () => {
    await withCaseAndDoc();
    const [v1] = await t.repo.getDocumentVersions("case-1", "doc-a");
    expect(v1.version).toBe(1);
    expect(v1.contentHash).toBe(createHash("sha256").update("version one").digest("hex"));

    const v2 = await t.repo.addDocumentVersion({
      caseId: "case-1",
      documentId: "doc-a",
      type: "RESUME",
      filename: "resume_corrected.txt",
      text: "version two, corrected",
    });
    expect(v2.version).toBe(2);
    expect(v2.contentHash).not.toBe(v1.contentHash);

    const all = await t.repo.getDocumentVersions("case-1", "doc-a");
    expect(all.map((d) => d.version)).toEqual([1, 2]);
    expect(all[0]).toEqual(v1); // byte-for-byte unchanged
    expect((await t.repo.getCurrentDocuments("case-1")).map((d) => [d.documentId, d.version])).toEqual([
      ["doc-a", 2],
    ]);
  });

  it("versions each document independently", async () => {
    await withCaseAndDoc();
    const b = await t.repo.addDocumentVersion({
      caseId: "case-1",
      documentId: "doc-b",
      type: "PASSPORT",
      filename: "p.txt",
      text: "passport",
    });
    expect(b.version).toBe(1);
  });

  it("rejects an unknown case and a changed document type", async () => {
    await rejectsWith(
      t.repo.addDocumentVersion({ caseId: "ghost", documentId: "d", type: "RESUME", filename: "f", text: "t" }),
      "CASE_NOT_FOUND",
    );
    await withCaseAndDoc();
    await rejectsWith(
      t.repo.addDocumentVersion({ caseId: "case-1", documentId: "doc-a", type: "PASSPORT", filename: "f", text: "t" }),
      "DOCUMENT_TYPE_MISMATCH",
    );
    expect(await t.repo.getDocumentVersions("case-1", "doc-a")).toHaveLength(1);
  });
});

describe("runs", () => {
  it("round-trips a run with findings, evidence and trace steps", async () => {
    await withCaseAndDoc();
    const run = buildRun({
      runId: "run-1",
      caseId: "case-1",
      documentVersions: [{ documentId: "doc-a", version: 1 }],
      findings: [sampleFinding],
      steps: [makeStep(0), makeStep(1, "run_validators"), makeStep(2, "finalize_case")],
    });
    const stored = await t.repo.recordRun(run);
    expect(stored).toEqual({ ...run, runNumber: 1, recordedAt: expect.any(String) });
    expect(stored.caseStatus).toBe("BLOCKED");
    expect(await t.repo.getRun("run-1")).toEqual(stored);
    expect(await t.repo.getRun("missing")).toBeNull();
  });

  it("numbers runs per case and keeps run ids unique", async () => {
    await withCaseAndDoc();
    await t.repo.createCase({ ...CASE, caseId: "case-2" });
    const docs = [{ documentId: "doc-a", version: 1 }];
    const r1 = await t.repo.recordRun(buildRun({ runId: "run-1", caseId: "case-1", documentVersions: docs }));
    const r2 = await t.repo.recordRun(buildRun({ runId: "run-2", caseId: "case-1", documentVersions: docs }));
    const other = await t.repo.recordRun(buildRun({ runId: "run-3", caseId: "case-2", documentVersions: [] }));
    expect([r1.runNumber, r2.runNumber, other.runNumber]).toEqual([1, 2, 1]);

    await rejectsWith(
      t.repo.recordRun(buildRun({ runId: "run-1", caseId: "case-1", documentVersions: docs, findings: [sampleFinding] })),
      "RUN_EXISTS",
    );
    expect(await t.repo.getRun("run-1")).toEqual(r1); // original untouched
  });

  it("stores a FAILED run without a status", async () => {
    await withCaseAndDoc();
    const failed = {
      ...buildRun({ runId: "run-f", caseId: "case-1", documentVersions: [] }),
      outcome: "FAILED" as const,
      failureReason: "step limit exceeded",
      caseStatus: null,
    };
    const stored = await t.repo.recordRun(failed);
    expect(stored).toMatchObject({ outcome: "FAILED", failureReason: "step limit exceeded", caseStatus: null });
  });

  it("normalizes undefined step input/output to null", async () => {
    await withCaseAndDoc();
    const step = { ...makeStep(0), input: undefined, output: undefined };
    const stored = await t.repo.recordRun(
      buildRun({ runId: "run-u", caseId: "case-1", documentVersions: [], steps: [step] }),
    );
    expect(stored.steps[0]).toMatchObject({ input: null, output: null });
  });

  describe("rejects invalid runs", () => {
    const base = () =>
      buildRun({
        runId: "run-x",
        caseId: "case-1",
        documentVersions: [{ documentId: "doc-a", version: 1 }],
        findings: [sampleFinding],
      });

    beforeEach(withCaseAndDoc);

    it.each<[string, () => unknown, string]>([
      ["unknown case", () => ({ ...base(), caseId: "ghost" }), "CASE_NOT_FOUND"],
      [
        "document version that does not exist",
        () => ({ ...base(), documentVersions: [{ documentId: "doc-a", version: 2 }] }),
        "DOCUMENT_VERSION_NOT_FOUND",
      ],
      [
        "two versions of the same document",
        () => ({
          ...base(),
          documentVersions: [
            { documentId: "doc-a", version: 1 },
            { documentId: "doc-a", version: 2 },
          ],
        }),
        "INVALID_RUN",
      ],
      ["caseStatus that contradicts the findings", () => ({ ...base(), caseStatus: "READY_FOR_REVIEW" }), "INVALID_RUN"],
      ["non-contiguous step indexes", () => ({ ...base(), steps: [makeStep(0), makeStep(2)] }), "INVALID_RUN"],
      ["COMPLETED run with a failureReason", () => ({ ...base(), failureReason: "oops" }), "INVALID_RUN"],
      ["FAILED run with a status", () => ({ ...base(), outcome: "FAILED", failureReason: "x" }), "INVALID_RUN"],
      ["schema violation", () => ({ ...base(), durationMs: -1 }), "INVALID_RUN"],
    ])("%s -> %s", async (_name, make, code) => {
      await rejectsWith(t.repo.recordRun(make() as never), code);
      expect(await t.repo.getRun("run-x")).toBeNull();
    });

    it("rejects a document version that belongs to a different case", async () => {
      await t.repo.createCase({ ...CASE, caseId: "case-2" });
      await rejectsWith(
        t.repo.recordRun({ ...base(), caseId: "case-2" }),
        "DOCUMENT_VERSION_NOT_FOUND",
      );
    });
  });

  it("is atomic: a failure while writing steps rolls back the run, findings and evidence", async () => {
    await withCaseAndDoc();
    const poisoned = makeStep(1, "run_validators");
    poisoned.input = { n: BigInt(10) }; // BigInt cannot be serialized to JSON
    await expect(
      t.repo.recordRun(
        buildRun({
          runId: "run-atomic",
          caseId: "case-1",
          documentVersions: [{ documentId: "doc-a", version: 1 }],
          findings: [sampleFinding],
          steps: [makeStep(0), poisoned],
        }),
      ),
    ).rejects.toThrow(/BigInt/);

    expect(await t.repo.getRun("run-atomic")).toBeNull();
    const raw = new Database(t.dbPath, { readonly: true });
    for (const table of ["runs", "run_documents", "findings", "evidence", "steps"]) {
      const row = raw.prepare(`select count(*) as n from ${table}`).get() as { n: number };
      expect(row.n, table).toBe(0);
    }
    raw.close();

    // The run number was not consumed by the failed attempt.
    const next = await t.repo.recordRun(
      buildRun({ runId: "run-ok", caseId: "case-1", documentVersions: [] }),
    );
    expect(next.runNumber).toBe(1);
  });
});

describe("immutability", () => {
  it("the repository interface has no update, delete or edit methods", () => {
    const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(t.repo));
    const mutators = proto.filter((n) => /^(update|delete|remove|set|edit|patch|replace)/i.test(n));
    expect(mutators).toEqual([]);
  });

  it("the database rejects UPDATE and DELETE on every table, even via raw SQL", async () => {
    await withCaseAndDoc();
    await t.repo.recordRun(
      buildRun({
        runId: "run-1",
        caseId: "case-1",
        documentVersions: [{ documentId: "doc-a", version: 1 }],
        findings: [sampleFinding],
      }),
    );
    const raw = new Database(t.dbPath);
    const statements = [
      "update cases set client_name = 'x'",
      "delete from cases",
      "update document_versions set text = 'tampered'",
      "delete from document_versions",
      "update runs set case_status = 'READY_FOR_REVIEW'",
      "delete from runs",
      "update run_documents set version = 9",
      "delete from run_documents",
      "update findings set severity = 'INFO'",
      "delete from findings",
      "update evidence set value = 'x'",
      "delete from evidence",
      "update steps set name = 'x'",
      "delete from steps",
    ];
    for (const sql of statements) {
      expect(() => raw.prepare(sql).run(), sql).toThrow(/immutable/);
    }
    raw.close();

    // Nothing changed.
    const [doc] = await t.repo.getDocumentVersions("case-1");
    expect(doc.text).toBe("version one");
    expect((await t.repo.getRun("run-1"))!.caseStatus).toBe("BLOCKED");
  });

  it("the database enforces foreign keys and run/case consistency", async () => {
    await withCaseAndDoc();
    await t.repo.recordRun(
      buildRun({ runId: "run-1", caseId: "case-1", documentVersions: [{ documentId: "doc-a", version: 1 }] }),
    );
    const raw = new Database(t.dbPath);
    raw.pragma("foreign_keys = ON");
    // run_documents pointing at a document version that does not exist
    expect(() =>
      raw
        .prepare("insert into run_documents (run_id, case_id, document_id, version) values ('run-1','case-1','doc-b',7)")
        .run(),
    ).toThrow(/FOREIGN KEY/);
    // a step for a run that does not exist
    expect(() =>
      raw
        .prepare(
          "insert into steps (run_id, step_index, kind, name, input_json, output_json, started_at, duration_ms, cost_usd) values ('ghost',0,'workflow','x','null','null','t',1,0)",
        )
        .run(),
    ).toThrow(/FOREIGN KEY/);
    // a step with a kind that is neither workflow nor agent
    expect(() =>
      raw
        .prepare(
          "insert into steps (run_id, step_index, kind, name, input_json, output_json, started_at, duration_ms, cost_usd) values ('run-1',5,'magic','x','null','null','t',1,0)",
        )
        .run(),
    ).toThrow(/CHECK/);
    raw.close();
  });
});

describe("case history: date-conflict fixture, replace and revalidate", () => {
  it("keeps Run 1 and its findings and trace unchanged after the document is corrected", async () => {
    const fixture = loadFixture("date-conflict");
    const caseId = fixture.case.caseId;
    await seedFixture(t.repo, fixture);

    // Run 1: BLOCKED by the resume-vs-letter conflict.
    const run1 = await recordFixtureRun(t.repo, fixture, "run-1");
    expect(run1.caseStatus).toBe("BLOCKED");
    expect(run1.findings.map((f) => f.type)).toEqual(["EMPLOYMENT_DATE_CONFLICT"]);
    expect(run1.documentVersions).toContainEqual({ documentId: "dc-resume", version: 1 });
    const run1Before = await t.repo.getRun("run-1");

    // Store the corrected resume as version 2, then revalidate as Run 2.
    const repl = fixture.replacement!.document;
    const v2 = await t.repo.addDocumentVersion({
      caseId,
      documentId: repl.documentId,
      type: repl.type,
      filename: repl.filename,
      text: repl.text,
    });
    expect(v2.version).toBe(repl.version);
    const run2 = await recordFixtureRun(t.repo, fixture, "run-2", true);
    expect(run2.caseStatus).toBe("READY_FOR_REVIEW");
    expect(run2.findings).toEqual([]);
    expect(run2.documentVersions).toContainEqual({ documentId: "dc-resume", version: 2 });

    const history = (await t.repo.getCaseHistory(caseId))!;
    expect(history.case.caseId).toBe(caseId); // one stable Case ID
    expect(history.runs.map((r) => [r.runId, r.runNumber, r.caseStatus])).toEqual([
      ["run-1", 1, "BLOCKED"],
      ["run-2", 2, "READY_FOR_REVIEW"],
    ]);
    expect(new Set(history.runs.map((r) => r.runId)).size).toBe(2); // unique run ids
    expect(history.runs[0]).toEqual(run1Before); // Run 1: findings, trace, doc versions, all intact
    expect(history.runs[0].findings[0].evidence.map((e) => e.documentId).sort()).toEqual(["dc-evl", "dc-resume"]);
    expect(history.runs[0].steps.map((s) => s.name)).toEqual(
      fixture.expected.workflowPath.map((p) => p.name),
    );
    expect(history.latestStatus).toBe("READY_FOR_REVIEW");

    const resumeVersions = history.documents.filter((d) => d.documentId === "dc-resume");
    expect(resumeVersions.map((d) => d.version)).toEqual([1, 2]);
    expect(resumeVersions[0].text).toBe(fixture.documents.find((d) => d.documentId === "dc-resume")!.text);
    expect(resumeVersions[0].text).toContain("2021-03-15"); // the original claim is preserved
    expect(resumeVersions[1].text).toContain("2021-09-01");
  });

  it("a later FAILED run does not change the latest status", async () => {
    const fixture = loadFixture("clean");
    await seedFixture(t.repo, fixture);
    await recordFixtureRun(t.repo, fixture, "run-1");
    await t.repo.recordRun({
      ...buildRun({ runId: "run-2", caseId: fixture.case.caseId, documentVersions: [] }),
      outcome: "FAILED",
      failureReason: "step limit exceeded",
      caseStatus: null,
    });
    const history = (await t.repo.getCaseHistory(fixture.case.caseId))!;
    expect(history.runs.map((r) => r.outcome)).toEqual(["COMPLETED", "FAILED"]);
    expect(history.latestStatus).toBe("READY_FOR_REVIEW");
  });

  it("returns null history for an unknown case and empty history for a new one", async () => {
    expect(await t.repo.getCaseHistory("ghost")).toBeNull();
    await t.repo.createCase(CASE);
    expect(await t.repo.getCaseHistory("case-1")).toMatchObject({
      documents: [],
      runs: [],
      latestStatus: null,
    });
  });
});
