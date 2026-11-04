import type {
  Case,
  CaseStatus,
  DocumentVersion,
  Run,
} from "@/domain/schemas";

/*
 * Storage-agnostic repository contract. Nothing outside src/repo/sqlite may
 * import Drizzle or better-sqlite3 (enforced by a test), so a Postgres adapter
 * can implement this interface without touching the runner or the UI.
 *
 * The interface is async on purpose: SQLite is synchronous but Postgres is not.
 *
 * It is append-only by construction: there is no update or delete method.
 * Corrections are new document versions and new runs.
 */

export type StoredCase = Case & { createdAt: string };

/** Input for a new document version. The repository assigns the version number. */
export type NewDocumentVersion = Omit<DocumentVersion, "version"> & {
  caseId: string;
};

export type StoredDocumentVersion = DocumentVersion & {
  caseId: string;
  /** SHA-256 of the text, hex. */
  contentHash: string;
  createdAt: string;
};

/**
 * A recorded run. step.input / step.output that were `undefined` are returned
 * as `null`; everything else must be JSON-serializable.
 */
export type StoredRun = Run & {
  /** 1, 2, 3 ... within the case. */
  runNumber: number;
  recordedAt: string;
};

export interface CaseHistory {
  case: StoredCase;
  /** Every version of every document, ordered by documentId then version. */
  documents: StoredDocumentVersion[];
  /** Oldest first. Each run keeps its original findings, steps and document versions. */
  runs: StoredRun[];
  /**
   * Status of the most recent COMPLETED run, or null if none. A later FAILED
   * run does not change it.
   */
  latestStatus: CaseStatus | null;
}

export type RepositoryErrorCode =
  | "CASE_EXISTS"
  | "CASE_NOT_FOUND"
  | "DOCUMENT_TYPE_MISMATCH"
  | "DOCUMENT_VERSION_NOT_FOUND"
  | "RUN_EXISTS"
  | "INVALID_RUN";

export class RepositoryError extends Error {
  constructor(
    readonly code: RepositoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RepositoryError";
  }
}

export interface CaseRepository {
  /** Create a case. The caseId is stable for its lifetime. Throws CASE_EXISTS on a duplicate. */
  createCase(input: Case): Promise<StoredCase>;
  getCase(caseId: string): Promise<StoredCase | null>;
  listCases(): Promise<StoredCase[]>;

  /**
   * Store a document as the next version (1 for a new documentId, otherwise
   * previous + 1). Earlier versions are untouched. Throws CASE_NOT_FOUND, or
   * DOCUMENT_TYPE_MISMATCH if the documentId already exists with another type.
   */
  addDocumentVersion(input: NewDocumentVersion): Promise<StoredDocumentVersion>;
  /** All versions, optionally for one document. */
  getDocumentVersions(
    caseId: string,
    documentId?: string,
  ): Promise<StoredDocumentVersion[]>;
  /** The latest version of each document. */
  getCurrentDocuments(caseId: string): Promise<StoredDocumentVersion[]>;

  /**
   * Atomically store a finished run with the document versions it used, its
   * findings (with evidence) and its trace steps: all of it or none of it.
   * Throws RUN_EXISTS for a reused runId, CASE_NOT_FOUND,
   * DOCUMENT_VERSION_NOT_FOUND, or INVALID_RUN (schema violation, caseStatus not
   * matching the findings, or non-contiguous step indexes).
   */
  recordRun(run: Run): Promise<StoredRun>;
  getRun(runId: string): Promise<StoredRun | null>;

  /** Full history for a case, or null if the case does not exist. */
  getCaseHistory(caseId: string): Promise<CaseHistory | null>;

  close(): Promise<void>;
}
