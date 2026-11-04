import { createHash } from "node:crypto";
import { and, asc, eq, inArray, max } from "drizzle-orm";
import { z } from "zod";
import {
  CaseSchema,
  DocumentVersionSchema,
  RunSchema,
  type Case,
  type Run,
} from "@/domain/schemas";
import { deriveStatus } from "@/validators/status";
import {
  RepositoryError,
  type CaseHistory,
  type CaseRepository,
  type NewDocumentVersion,
  type StoredCase,
  type StoredDocumentVersion,
  type StoredRun,
} from "../CaseRepository";
import { openConnection, type Connection, type OpenOptions } from "./open";
import {
  cases,
  documentVersions,
  evidence,
  findings,
  runDocuments,
  runs,
  steps,
} from "./schema";

const NewDocumentVersionSchema = DocumentVersionSchema.omit({
  version: true,
}).extend({ caseId: z.string().min(1) });

type RunRow = typeof runs.$inferSelect;
type DocRow = typeof documentVersions.$inferSelect;

/** Writes that touch several tables take the write lock up front. */
const WRITE = { behavior: "immediate" } as const;

const toJson = (value: unknown): string => JSON.stringify(value ?? null);

function toStoredDocument(row: DocRow): StoredDocumentVersion {
  return {
    ...DocumentVersionSchema.parse({
      documentId: row.documentId,
      type: row.type,
      version: row.version,
      filename: row.filename,
      text: row.text,
    }),
    caseId: row.caseId,
    contentHash: row.contentHash,
    createdAt: row.createdAt,
  };
}

export class SqliteCaseRepository implements CaseRepository {
  private constructor(
    private readonly conn: Connection,
    private readonly now: () => Date,
  ) {}

  /** Open (creating and migrating if needed) a SQLite-backed repository. */
  static open(options: OpenOptions & { now?: () => Date }): SqliteCaseRepository {
    return new SqliteCaseRepository(
      openConnection(options),
      options.now ?? (() => new Date()),
    );
  }

  private get db() {
    return this.conn.db;
  }

  private stamp(): string {
    return this.now().toISOString();
  }

  /** Adapter-specific, for tests and diagnostics: the connection's active pragmas. */
  inspectPragmas() {
    const p = this.conn.sqlite;
    return {
      journalMode: String(p.pragma("journal_mode", { simple: true })),
      busyTimeoutMs: Number(p.pragma("busy_timeout", { simple: true })),
      foreignKeys: Number(p.pragma("foreign_keys", { simple: true })) === 1,
    };
  }

  // ---------- cases ----------

  async createCase(input: Case): Promise<StoredCase> {
    const c = CaseSchema.parse(input);
    const createdAt = this.stamp();
    return this.db.transaction((tx) => {
      const existing = tx.select().from(cases).where(eq(cases.caseId, c.caseId)).get();
      if (existing) {
        throw new RepositoryError("CASE_EXISTS", `Case ${c.caseId} already exists`);
      }
      tx.insert(cases).values({ ...c, createdAt }).run();
      return { ...c, createdAt };
    }, WRITE);
  }

  async getCase(caseId: string): Promise<StoredCase | null> {
    return this.readCase(this.db, caseId);
  }

  async listCases(): Promise<StoredCase[]> {
    return this.db
      .select()
      .from(cases)
      .orderBy(asc(cases.createdAt), asc(cases.caseId))
      .all()
      .map((r) => ({ ...CaseSchema.parse(r), createdAt: r.createdAt }));
  }

  private readCase(
    db: Pick<typeof this.db, "select">,
    caseId: string,
  ): StoredCase | null {
    const row = db.select().from(cases).where(eq(cases.caseId, caseId)).get();
    return row ? { ...CaseSchema.parse(row), createdAt: row.createdAt } : null;
  }

  // ---------- documents ----------

  async addDocumentVersion(input: NewDocumentVersion): Promise<StoredDocumentVersion> {
    const doc = NewDocumentVersionSchema.parse(input);
    const createdAt = this.stamp();
    return this.db.transaction((tx) => {
      if (!this.readCase(tx, doc.caseId)) {
        throw new RepositoryError("CASE_NOT_FOUND", `Case ${doc.caseId} not found`);
      }
      const latest = tx
        .select()
        .from(documentVersions)
        .where(
          and(
            eq(documentVersions.caseId, doc.caseId),
            eq(documentVersions.documentId, doc.documentId),
          ),
        )
        .orderBy(asc(documentVersions.version))
        .all()
        .at(-1);
      if (latest && latest.type !== doc.type) {
        throw new RepositoryError(
          "DOCUMENT_TYPE_MISMATCH",
          `Document ${doc.documentId} is ${latest.type}, cannot add a ${doc.type} version`,
        );
      }
      const row: DocRow = {
        caseId: doc.caseId,
        documentId: doc.documentId,
        version: (latest?.version ?? 0) + 1,
        type: doc.type,
        filename: doc.filename,
        text: doc.text,
        contentHash: createHash("sha256").update(doc.text).digest("hex"),
        createdAt,
      };
      tx.insert(documentVersions).values(row).run();
      return toStoredDocument(row);
    }, WRITE);
  }

  async getDocumentVersions(
    caseId: string,
    documentId?: string,
  ): Promise<StoredDocumentVersion[]> {
    return this.readDocuments(this.db, caseId, documentId);
  }

  async getCurrentDocuments(caseId: string): Promise<StoredDocumentVersion[]> {
    const latest = new Map<string, StoredDocumentVersion>();
    for (const d of this.readDocuments(this.db, caseId)) latest.set(d.documentId, d); // ascending
    return [...latest.values()];
  }

  private readDocuments(
    db: Pick<typeof this.db, "select">,
    caseId: string,
    documentId?: string,
  ): StoredDocumentVersion[] {
    return db
      .select()
      .from(documentVersions)
      .where(
        documentId === undefined
          ? eq(documentVersions.caseId, caseId)
          : and(
              eq(documentVersions.caseId, caseId),
              eq(documentVersions.documentId, documentId),
            ),
      )
      .orderBy(asc(documentVersions.documentId), asc(documentVersions.version))
      .all()
      .map(toStoredDocument);
  }

  // ---------- runs ----------

  async recordRun(input: Run): Promise<StoredRun> {
    const parsed = RunSchema.safeParse(input);
    if (!parsed.success) {
      throw new RepositoryError("INVALID_RUN", `Run failed validation: ${parsed.error.message}`);
    }
    const run = parsed.data;
    this.assertRunInvariants(run);
    const recordedAt = this.stamp();

    const runNumber = this.db.transaction((tx) => {
      if (!this.readCase(tx, run.caseId)) {
        throw new RepositoryError("CASE_NOT_FOUND", `Case ${run.caseId} not found`);
      }
      if (tx.select().from(runs).where(eq(runs.runId, run.runId)).get()) {
        throw new RepositoryError("RUN_EXISTS", `Run ${run.runId} already exists`);
      }
      for (const dv of run.documentVersions) {
        const found = tx
          .select()
          .from(documentVersions)
          .where(
            and(
              eq(documentVersions.caseId, run.caseId),
              eq(documentVersions.documentId, dv.documentId),
              eq(documentVersions.version, dv.version),
            ),
          )
          .get();
        if (!found) {
          throw new RepositoryError(
            "DOCUMENT_VERSION_NOT_FOUND",
            `Case ${run.caseId} has no ${dv.documentId} version ${dv.version}`,
          );
        }
      }

      const last = tx
        .select({ n: max(runs.runNumber) })
        .from(runs)
        .where(eq(runs.caseId, run.caseId))
        .get();
      const runNumber = (last?.n ?? 0) + 1;

      tx.insert(runs)
        .values({
          runId: run.runId,
          caseId: run.caseId,
          runNumber,
          startedAt: run.startedAt,
          durationMs: run.durationMs,
          totalCostUsd: run.totalCostUsd,
          outcome: run.outcome,
          failureReason: run.failureReason,
          caseStatus: run.caseStatus,
          recordedAt,
        })
        .run();

      if (run.documentVersions.length > 0) {
        tx.insert(runDocuments)
          .values(
            run.documentVersions.map((dv) => ({
              runId: run.runId,
              caseId: run.caseId,
              documentId: dv.documentId,
              version: dv.version,
            })),
          )
          .run();
      }

      run.findings.forEach((f, position) => {
        tx.insert(findings)
          .values({
            runId: run.runId,
            position,
            type: f.type,
            severity: f.severity,
            message: f.message,
          })
          .run();
        tx.insert(evidence)
          .values(
            f.evidence.map((e, i) => ({
              runId: run.runId,
              findingPosition: position,
              position: i,
              documentId: e.documentId,
              documentType: e.documentType,
              version: e.version,
              field: e.field,
              jobIndex: e.jobIndex,
              value: e.value,
              snippet: e.snippet,
            })),
          )
          .run();
      });

      // Steps last: serializing arbitrary input/output is the likeliest thing to
      // fail, and the transaction rolls everything above back if it does.
      for (const s of run.steps) {
        tx.insert(steps)
          .values({
            runId: run.runId,
            stepIndex: s.index,
            kind: s.kind,
            name: s.name,
            inputJson: toJson(s.input),
            outputJson: toJson(s.output),
            startedAt: s.startedAt,
            durationMs: s.durationMs,
            costUsd: s.costUsd,
            model: s.model,
            error: s.error,
          })
          .run();
      }
      return runNumber;
    }, WRITE);

    const stored = await this.getRun(run.runId);
    if (!stored || stored.runNumber !== runNumber) {
      throw new Error(`Run ${run.runId} was not readable after commit`);
    }
    return stored;
  }

  /** Invariants the schema alone cannot express. */
  private assertRunInvariants(run: Run): void {
    const fail = (why: string): never => {
      throw new RepositoryError("INVALID_RUN", `Run ${run.runId}: ${why}`);
    };
    if (run.outcome === "COMPLETED") {
      if (run.failureReason !== null) fail("a COMPLETED run cannot have a failureReason");
      const expected = deriveStatus(run.findings);
      if (run.caseStatus !== expected) {
        fail(`caseStatus ${run.caseStatus} does not match its findings (${expected})`);
      }
    } else if (run.caseStatus !== null) {
      fail("a FAILED run cannot set a caseStatus");
    }
    if (!run.steps.every((s, i) => s.index === i)) {
      fail("step indexes must be 0..n-1 in order");
    }
    const ids = run.documentVersions.map((d) => d.documentId);
    if (new Set(ids).size !== ids.length) {
      fail("a run can use only one version of each document");
    }
  }

  async getRun(runId: string): Promise<StoredRun | null> {
    return this.db.transaction((tx) => {
      const row = tx.select().from(runs).where(eq(runs.runId, runId)).get();
      return row ? (this.assembleRuns(tx, [row])[0] ?? null) : null;
    });
  }

  // ---------- history ----------

  async getCaseHistory(caseId: string): Promise<CaseHistory | null> {
    // One read transaction: a consistent snapshot across all the queries.
    return this.db.transaction((tx) => {
      const c = this.readCase(tx, caseId);
      if (!c) return null;
      const runRows = tx
        .select()
        .from(runs)
        .where(eq(runs.caseId, caseId))
        .orderBy(asc(runs.runNumber))
        .all();
      const history = this.assembleRuns(tx, runRows);
      const latestCompleted = [...history].reverse().find((r) => r.outcome === "COMPLETED");
      return {
        case: c,
        documents: this.readDocuments(tx, caseId),
        runs: history,
        latestStatus: latestCompleted?.caseStatus ?? null,
      };
    });
  }

  private assembleRuns(
    db: Pick<typeof this.db, "select">,
    rows: RunRow[],
  ): StoredRun[] {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.runId);

    const group = <T extends { runId: string }>(items: T[]) => {
      const m = new Map<string, T[]>();
      for (const it of items) m.set(it.runId, [...(m.get(it.runId) ?? []), it]);
      return m;
    };
    const docs = group(
      db
        .select()
        .from(runDocuments)
        .where(inArray(runDocuments.runId, ids))
        .orderBy(asc(runDocuments.documentId))
        .all(),
    );
    const finds = group(
      db
        .select()
        .from(findings)
        .where(inArray(findings.runId, ids))
        .orderBy(asc(findings.position))
        .all(),
    );
    const evid = group(
      db
        .select()
        .from(evidence)
        .where(inArray(evidence.runId, ids))
        .orderBy(asc(evidence.findingPosition), asc(evidence.position))
        .all(),
    );
    const stepRows = group(
      db
        .select()
        .from(steps)
        .where(inArray(steps.runId, ids))
        .orderBy(asc(steps.stepIndex))
        .all(),
    );

    return rows.map((r) => {
      const run = RunSchema.parse({
        runId: r.runId,
        caseId: r.caseId,
        startedAt: r.startedAt,
        durationMs: r.durationMs,
        totalCostUsd: r.totalCostUsd,
        outcome: r.outcome,
        failureReason: r.failureReason,
        documentVersions: (docs.get(r.runId) ?? []).map((d) => ({
          documentId: d.documentId,
          version: d.version,
        })),
        caseStatus: r.caseStatus,
        findings: (finds.get(r.runId) ?? []).map((f) => ({
          type: f.type,
          severity: f.severity,
          message: f.message,
          evidence: (evid.get(r.runId) ?? [])
            .filter((e) => e.findingPosition === f.position)
            .map((e) => ({
              documentId: e.documentId,
              documentType: e.documentType,
              version: e.version,
              field: e.field,
              jobIndex: e.jobIndex,
              value: e.value,
              snippet: e.snippet,
            })),
        })),
        steps: (stepRows.get(r.runId) ?? []).map((s) => ({
          index: s.stepIndex,
          kind: s.kind,
          name: s.name,
          input: JSON.parse(s.inputJson) as unknown,
          output: JSON.parse(s.outputJson) as unknown,
          startedAt: s.startedAt,
          durationMs: s.durationMs,
          costUsd: s.costUsd,
          model: s.model,
          error: s.error,
        })),
      });
      return { ...run, runNumber: r.runNumber, recordedAt: r.recordedAt };
    });
  }

  async close(): Promise<void> {
    this.conn.sqlite.close();
  }
}
