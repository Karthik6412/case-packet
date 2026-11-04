import fs from "node:fs";
import path from "node:path";
import type { CaseSnapshot } from "@/domain/schemas";
import { FixtureSchema, type Fixture } from "./schema";

const FIXTURES_DIR = path.join(process.cwd(), "fixtures");

export function loadFixture(id: string): Fixture {
  const raw = fs.readFileSync(path.join(FIXTURES_DIR, `${id}.json`), "utf8");
  return FixtureSchema.parse(JSON.parse(raw));
}

export function loadAllFixtures(): Fixture[] {
  return fs
    .readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => loadFixture(f.replace(/\.json$/, "")));
}

/**
 * The case's current document versions as validators see them.
 * With `applyReplacement`, the replacement supersedes the document with the same
 * documentId. The fixture itself is never mutated (documents are immutable).
 */
export function toSnapshot(
  fixture: Fixture,
  { applyReplacement = false } = {},
): CaseSnapshot {
  const replacement = applyReplacement ? fixture.replacement?.document : undefined;
  const docs = fixture.documents.map((d) =>
    replacement && d.documentId === replacement.documentId ? replacement : d,
  );
  return {
    caseId: fixture.case.caseId,
    visaCategory: fixture.case.visaCategory,
    documents: docs.map((d) => ({
      documentId: d.documentId,
      type: d.type,
      version: d.version,
      extraction: d.extraction,
    })),
  };
}
