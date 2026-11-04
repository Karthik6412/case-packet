import type { Extraction } from "@/domain/schemas";
import type { Fixture, FixtureDocument } from "@/fixtures/schema";
import type { StoredDocumentVersion } from "@/repo/CaseRepository";

/** Facts extracted from one stored document version. */
export interface ExtractionResult {
  extraction: Extraction;
  /** Resumes only: one extraction per claimed job. */
  claimedJobs: Extraction[];
}

/**
 * The seam where a model-backed extractor plugs in later (plan step 7). The
 * runner depends only on this interface.
 */
export interface DocumentExtractor {
  extract(doc: StoredDocumentVersion): Promise<ExtractionResult>;
}

/**
 * Fixture-backed extraction: returns the pre-baked facts stored in the golden
 * fixtures. It refuses to answer if the stored document's text differs from the
 * fixture's, so facts are never applied to different content.
 */
export function createFixtureExtractor(fixtures: readonly Fixture[]): DocumentExtractor {
  const key = (caseId: string, documentId: string, version: number) =>
    `${caseId}/${documentId}/v${version}`;
  const index = new Map<string, FixtureDocument>();
  for (const f of fixtures) {
    const docs = [...f.documents, ...(f.replacement ? [f.replacement.document] : [])];
    for (const d of docs) index.set(key(f.case.caseId, d.documentId, d.version), d);
  }

  return {
    async extract(doc) {
      const k = key(doc.caseId, doc.documentId, doc.version);
      const entry = index.get(k);
      if (!entry) throw new Error(`no fixture extraction for ${k}`);
      if (entry.type !== doc.type || entry.text !== doc.text) {
        throw new Error(`stored document ${k} does not match its fixture content`);
      }
      return { extraction: entry.extraction, claimedJobs: entry.claimedJobs };
    },
  };
}
