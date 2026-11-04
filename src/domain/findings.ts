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

export function findingKeys(
  findings: readonly {
    type: FindingType;
    evidence: readonly Pick<Evidence, "documentId" | "documentType">[];
  }[],
): string[] {
  return findings.map(findingKey).sort();
}
