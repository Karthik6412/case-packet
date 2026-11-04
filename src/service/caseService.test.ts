import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFixtureExtractor, type DocumentExtractor } from "@/agent/extractor";
import { loadAllFixtures, loadFixture } from "@/fixtures/load";
import type { Fixture } from "@/fixtures/schema";
import { SqliteCaseRepository } from "@/repo";
import {
  UserFacingError,
  getCaseQueue,
  getCaseView,
  replaceDocument,
  rerunValidation,
  type CaseView,
} from "./caseService";
import type { AppContext } from "./context";
import { daysBetween, formatDate } from "./format";
import { seedDemo } from "./seedDemo";

let dir: string;
let ctx: AppContext;

function makeCtx(extra: Fixture[] = []): AppContext {
  const fixtures = [...loadAllFixtures(), ...extra];
  return {
    repo: SqliteCaseRepository.open({ path: path.join(dir, "app.db") }),
    extractor: createFixtureExtractor(fixtures),
    fixtures,
  };
}

/** The clean case with one unreliable date: ends NEEDS_ATTENTION. */
function attentionFixture(): Fixture {
  const f = structuredClone(loadFixture("clean"));
  f.id = "attention";
  f.case = { caseId: "case-attention-001", clientName: "Zed Attention", visaCategory: "EB-2" };
  const resume = f.documents.find((d) => d.type === "RESUME")!;
  resume.claimedJobs[0].employmentStartDate!.confidence = 0.4;
  return f;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "case-packet-service-"));
});
afterEach(async () => {
  await ctx?.repo.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const CONFLICT = "case-dateconflict-001";
const CLEAN = "case-clean-001";

describe("seed", () => {
  it("loads both fixtures with a first check, and is safe to repeat", async () => {
    ctx = makeCtx();
    const first = await seedDemo(ctx);
    expect(first.map((r) => [r.caseId, r.runNumber, r.status])).toEqual([
      [CLEAN, 1, "READY_FOR_REVIEW"],
      [CONFLICT, 1, "BLOCKED"],
    ]);
    const again = await seedDemo(ctx);
    expect(again.every((r) => r.skipped)).toBe(true);
    expect((await ctx.repo.getCaseHistory(CONFLICT))!.runs).toHaveLength(1);
  });
});

describe("case queue", () => {
  it("counts by status and sorts BLOCKED, NEEDS_ATTENTION, READY_FOR_REVIEW, then unchecked", async () => {
    ctx = makeCtx([attentionFixture()]);
    await seedDemo(ctx);
    await ctx.repo.createCase({ caseId: "case-new", clientName: "New Client", visaCategory: "EB-2" });

    const { items, counts } = await getCaseQueue(ctx);
    expect(items.map((i) => [i.clientName, i.status])).toEqual([
      ["Lena Höffmann", "BLOCKED"],
      ["Zed Attention", "NEEDS_ATTENTION"],
      ["Amara Okafor", "READY_FOR_REVIEW"],
      ["New Client", null],
    ]);
    expect(counts).toEqual({ blocked: 1, needsAttention: 1, ready: 1, unchecked: 1 });
  });

  it("shows each row's main issue in plain language", async () => {
    ctx = makeCtx([attentionFixture()]);
    await seedDemo(ctx);
    const byId = Object.fromEntries((await getCaseQueue(ctx)).items.map((i) => [i.caseId, i]));
    expect(byId[CONFLICT]).toMatchObject({ caseType: "EB-2", mainIssue: "Employment dates don't match" });
    expect(byId["case-attention-001"].mainIssue).toBe("A detail couldn't be read reliably");
    expect(byId[CLEAN].mainIssue).toBe("No open issues");
  });
});

describe("blocked case page", () => {
  it("leads with the main blocker, its next step, and side-by-side evidence", async () => {
    ctx = makeCtx();
    await seedDemo(ctx);
    const v = (await getCaseView(ctx, CONFLICT))!;

    expect(v).toMatchObject({
      clientName: "Lena Höffmann",
      caseId: CONFLICT,
      status: "BLOCKED",
      primaryAction: "replace",
      checkIsStale: false,
      rerunLabel: "Re-run validation",
    });
    expect(v.mainIssue!.title).toBe("Employment dates don't match");
    expect(v.nextStep).toBe("Replace the resume with the corrected version, then re-run validation.");
    expect(v.replace.available).toBe(true);

    const [f] = v.findings;
    expect(f.severityLabel).toBe("Must be resolved");
    expect(f.explanation).toContain("Brightwater Logistics LLC");
    expect(f.explanation).toContain("170 days");
    expect(f.recommendation).toMatch(/Ask the client/);
    expect(f.sides.map((s) => [s.document, s.version, s.label, s.value, s.quote])).toEqual([
      ["Resume", "version 1", "Start date", "March 15, 2021", "2021-03-15 to present"],
      ["Employment verification letter", "version 1", "Start date", "September 1, 2021", "since September 1, 2021"],
    ]);
  });

  it("previews a clarification message naming the documents and dates, and does not send", async () => {
    ctx = makeCtx();
    await seedDemo(ctx);
    const draft = (await getCaseView(ctx, CONFLICT))!.clarification!;
    expect(draft.subject).toBe("Please confirm your employment dates");
    expect(draft.body).toContain("Dear Lena Höffmann");
    expect(draft.body).toContain("resume");
    expect(draft.body).toContain("employment verification letter");
    expect(draft.body).toContain("March 15, 2021");
    expect(draft.body).toContain("September 1, 2021");
    expect(draft.body).toContain("Brightwater Logistics LLC");
  });

  it("lists documents in a sensible order", async () => {
    ctx = makeCtx();
    await seedDemo(ctx);
    const v = (await getCaseView(ctx, CLEAN))!;
    expect(v.documents.map((d) => d.name)).toEqual([
      "Resume",
      "Passport (biographical page)",
      "Sponsor offer letter",
      "Employment verification letter",
      "Employment verification letter",
    ]);
  });
});

describe("demo flow: Run 1 BLOCKED -> replace document -> Run 2 READY_FOR_REVIEW", () => {
  it("keeps Run 1 unchanged and visible", async () => {
    ctx = makeCtx();
    await seedDemo(ctx);
    const before = (await getCaseView(ctx, CONFLICT))!;
    expect(before.runs).toHaveLength(1);
    const run1Before = before.runs[0];

    // Replace document: a new version, no new run, status honestly unchanged.
    expect(await replaceDocument(ctx, CONFLICT)).toEqual({ added: true, version: 2 });
    const replaced = (await getCaseView(ctx, CONFLICT))!;
    expect(replaced.status).toBe("BLOCKED");
    expect(replaced.checkIsStale).toBe(true);
    expect(replaced.primaryAction).toBe("rerun");
    expect(replaced.replace.available).toBe(false);
    expect(replaced.nextStep).toMatch(/Re-run validation/);
    expect(replaced.runs).toHaveLength(1);
    expect(replaced.documents.find((d) => d.name === "Resume")).toMatchObject({
      currentVersion: 2,
      earlierVersions: 1,
    });

    // Replacing again changes nothing.
    expect(await replaceDocument(ctx, CONFLICT)).toEqual({ added: false, version: 2 });
    expect(await ctx.repo.getDocumentVersions(CONFLICT, "dc-resume")).toHaveLength(2);

    // Re-run validation: Run 2 is ready; Run 1 stays exactly as it was.
    const result = await rerunValidation(ctx, CONFLICT);
    expect(result.run.runNumber).toBe(2);
    const after = (await getCaseView(ctx, CONFLICT))!;
    expect(after.status).toBe("READY_FOR_REVIEW");
    expect(after.mainIssue).toBeNull();
    expect(after.findings).toEqual([]);
    expect(after.primaryAction).toBeNull();
    expect(after.checkIsStale).toBe(false);
    expect(after.notices).toEqual([
      "Run 2 changed the status from Blocked to Ready for review. Earlier runs are unchanged.",
    ]);
    expect(after.runs.map((r) => [r.number, r.statusLabel])).toEqual([
      [2, "Ready for review"],
      [1, "Blocked"],
    ]);
    expect(after.runs[1]).toEqual(run1Before);
    expect(after.runSummary).toEqual([
      "Run 2 · Ready for review · No open issues",
      "Run 1 · Blocked · Employment dates don't match",
    ]);

    const queue = await getCaseQueue(ctx);
    expect(queue.counts).toMatchObject({ blocked: 0, ready: 2 });
  });

  it("re-running without a change records another run and keeps the status", async () => {
    ctx = makeCtx();
    await seedDemo(ctx);
    await rerunValidation(ctx, CONFLICT);
    const v = (await getCaseView(ctx, CONFLICT))!;
    expect(v.status).toBe("BLOCKED");
    expect(v.runs).toHaveLength(2);
    expect(v.notices).toEqual(["Run 2 finished. The status is still Blocked."]);
  });
});

describe("guards", () => {
  it("rejects actions that make no sense, with a message fit to show", async () => {
    ctx = makeCtx();
    await seedDemo(ctx);
    await expect(replaceDocument(ctx, CLEAN)).rejects.toThrow(new UserFacingError("No corrected document is available for this case."));
    await expect(replaceDocument(ctx, "ghost")).rejects.toBeInstanceOf(UserFacingError);
    await expect(rerunValidation(ctx, "ghost")).rejects.toBeInstanceOf(UserFacingError);
    expect(await getCaseView(ctx, "ghost")).toBeNull();
  });

  it("a check that did not finish is shown as such and does not change the status", async () => {
    ctx = makeCtx();
    await seedDemo(ctx);
    const broken: DocumentExtractor = { extract: () => Promise.reject(new Error("boom")) };
    await rerunValidation({ ...ctx, extractor: broken }, CONFLICT);

    const v = (await getCaseView(ctx, CONFLICT))!;
    expect(v.status).toBe("BLOCKED");
    expect(v.notices[0]).toBe("The most recent check (Run 2) did not finish. The results below are from Run 1.");
    expect(v.runs[0]).toMatchObject({ number: 2, statusLabel: "Did not finish" });
    expect(v.runs[0].headline).toMatch(/did not finish/);
    expect(v.runs[0].failureNote).toContain("boom"); // engineering detail lives in the audit trail
    expect((await getCaseQueue(ctx)).items.find((i) => i.caseId === CONFLICT)!.status).toBe("BLOCKED");
  });

  it("an unchecked case offers to run validation first", async () => {
    ctx = makeCtx();
    await ctx.repo.createCase({ caseId: "case-new", clientName: "New Client", visaCategory: "EB-2" });
    const v = (await getCaseView(ctx, "case-new"))!;
    expect(v).toMatchObject({ status: null, primaryAction: "rerun", rerunLabel: "Run validation" });
    expect(v.nextStep).toBe("Run validation to check this case's documents.");
  });
});

describe("plain language on every screen", () => {
  // Internal vocabulary must stay out of the main view; it belongs in the audit trail.
  const INTERNAL = /trace|span|workflow|json|[A-Z]{3,}_[A-Z_]+|[a-z]+[A-Z][a-z]+(?:Date|Name|Id)\b|documentId|run_[a-z_]+|extract_document/;

  const userFacing = (v: CaseView): string[] => [
    v.clientName,
    v.caseType,
    v.mainIssue?.title ?? "",
    v.mainIssue?.explanation ?? "",
    v.nextStep,
    v.rerunLabel,
    v.replace.description,
    v.clarification?.subject ?? "",
    v.clarification?.body ?? "",
    ...v.notices,
    ...v.runSummary,
    ...v.documents.flatMap((d) => [d.name]),
    ...v.findings.flatMap((f) => [
      f.severityLabel,
      f.title,
      f.explanation,
      f.recommendation,
      ...f.sides.flatMap((s) => [s.document, s.version ?? "", s.label, s.value]),
    ]),
  ];

  it("no internal terms appear in what the paralegal reads", async () => {
    ctx = makeCtx([attentionFixture()]);
    await seedDemo(ctx);
    await ctx.repo.createCase({ caseId: "case-empty", clientName: "Empty Case", visaCategory: "EB-2" });
    await rerunValidation(ctx, "case-empty"); // missing documents
    await replaceDocument(ctx, CONFLICT);
    await rerunValidation(ctx, CONFLICT);

    for (const c of await ctx.repo.listCases()) {
      const v = (await getCaseView(ctx, c.caseId))!;
      for (const text of userFacing(v)) {
        expect(text, `${c.caseId}: ${text}`).not.toMatch(INTERNAL);
      }
    }
    const queue = await getCaseQueue(ctx);
    for (const i of queue.items) expect(i.mainIssue).not.toMatch(INTERNAL);
  });

  it("missing documents are explained in plain words", async () => {
    ctx = makeCtx();
    await ctx.repo.createCase({ caseId: "case-empty", clientName: "Empty Case", visaCategory: "EB-2" });
    await rerunValidation(ctx, "case-empty");
    const v = (await getCaseView(ctx, "case-empty"))!;
    expect(v.status).toBe("BLOCKED");
    expect(v.findings.map((f) => f.explanation)).toEqual([
      "No resume has been received for this case.",
      "No passport has been received for this case.",
      "No sponsor offer letter has been received for this case.",
    ]);
    expect(v.clarification!.body).toContain("Please send us your resume.");
  });
});

describe("formatting", () => {
  it.each([
    ["2021-03-15", "March 15, 2021"],
    ["2021-09-01", "September 1, 2021"],
    ["not a date", "not a date"],
  ])("formatDate(%s)", (iso, expected) => expect(formatDate(iso)).toBe(expected));

  it("daysBetween counts whole days either way", () => {
    expect(daysBetween("2021-03-15", "2021-09-01")).toBe(170);
    expect(daysBetween("2021-09-01", "2021-03-15")).toBe(170);
    expect(daysBetween("2021-09-01", "x")).toBeNull();
  });
});

describe("independence", () => {
  it("the service layer does not import Next.js or React", () => {
    const offenders = fs
      .readdirSync(path.join(process.cwd(), "src", "service"))
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .filter((f) =>
        /from\s+["'](next|react|react-dom)(\/[^"']*)?["']/.test(
          fs.readFileSync(path.join(process.cwd(), "src", "service", f), "utf8"),
        ),
      );
    expect(offenders).toEqual([]);
  });

});
