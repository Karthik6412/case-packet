import type { CaseRepository } from "@/repo/CaseRepository";
import type { Fixture } from "./schema";

/**
 * Create the fixture's case and store each of its documents as version 1.
 * Used by tests, the eval, and later the UI's seed command.
 */
export async function seedFixtureCase(
  repo: CaseRepository,
  fixture: Fixture,
): Promise<void> {
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

/** Store the fixture's corrected document as its next version. */
export async function applyFixtureReplacement(
  repo: CaseRepository,
  fixture: Fixture,
) {
  const r = fixture.replacement?.document;
  if (!r) throw new Error(`fixture ${fixture.id} has no replacement document`);
  return repo.addDocumentVersion({
    caseId: fixture.case.caseId,
    documentId: r.documentId,
    type: r.type,
    filename: r.filename,
    text: r.text,
  });
}
