import type { Evidence, FindingType } from "./schemas";

/**
 * Stable identity of a finding for comparisons (fixtures, evals):
 * type plus the sorted unique documents involved. An absent document is
 * written as "missing:<DOCUMENT_TYPE>".
 */
export function findingKey(f: {
  type: FindingType;
  evidence: readonly Pick<Evidence, "documentId" | "documentType">[];
}): string {
  const ids = new Set(
    f.evidence.map((e) => e.documentId ?? `missing:${e.documentType}`),
  );
  return `${f.type}:${[...ids].sort().join("+")}`;
}

/** Keys for a fixture's expected findings, comparable with findingKeys(). */
export function expectedFindingKeys(
  expected: readonly { type: FindingType; documentIds: readonly string[] }[],
): string[] {
  return expected
    .map((e) => `${e.type}:${[...new Set(e.documentIds)].sort().join("+")}`)
    .sort();
}

export function findingKeys(
  findings: readonly {
    type: FindingType;
    evidence: readonly Pick<Evidence, "documentId" | "documentType">[];
  }[],
): string[] {
  return findings.map(findingKey).sort();
}
