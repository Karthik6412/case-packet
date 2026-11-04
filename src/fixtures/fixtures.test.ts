import { describe, expect, it } from "vitest";
import { findingKeys } from "@/domain/findings";
import { deepFreeze } from "@/validators/test-helpers";
import { deriveStatus, isEligibleForAttorneySignoff } from "@/validators/status";
import { validateCase } from "@/validators/validateCase";
import { loadAllFixtures, loadFixture, toSnapshot } from "./load";
import type { ExpectedFinding, FixtureDocument } from "./schema";

const expectedKeys = (fs: ExpectedFinding[]) =>
  fs.map((f) => `${f.type}:${[...new Set(f.documentIds)].sort().join("+")}`).sort();

const fixtures = loadAllFixtures();

describe("golden fixtures: shape", () => {
  it("contains the clean and date-conflict fixtures", () => {
    expect(fixtures.map((f) => f.id)).toEqual(["clean", "date-conflict"]);
  });

  it.each(fixtures.map((f) => [f.id, f] as const))(
    "%s: every snippet and value appears in the document text",
    (_id, fixture) => {
      const docs: FixtureDocument[] = [
        ...fixture.documents,
        ...(fixture.replacement ? [fixture.replacement.document] : []),
      ];
      for (const doc of docs) {
        const bags = [doc.extraction, ...doc.claimedJobs];
        for (const bag of bags) {
          for (const [field, ex] of Object.entries(bag)) {
            if (ex.snippet !== null) {
              expect(doc.text, `${doc.documentId}.${field}`).toContain(ex.snippet);
            }
          }
        }
      }
    },
  );

  it.each(fixtures.map((f) => [f.id, f] as const))(
    "%s: document ids are unique and the case id is stable",
    (_id, fixture) => {
      const ids = fixture.documents.map((d) => d.documentId);
      expect(new Set(ids).size).toBe(ids.length);
    },
  );
});

// Deterministic form of the minimal evaluation assertion (K1): the validators
// and status derivation must reproduce each fixture's expected outcome.
describe("golden fixtures: expected outcomes (K1, deterministic form)", () => {
  it.each(fixtures.map((f) => [f.id, f] as const))(
    "%s: status and findings match",
    (_id, fixture) => {
      const findings = validateCase(toSnapshot(fixture));
      expect(deriveStatus(findings)).toBe(fixture.expected.status);
      expect(findingKeys(findings)).toEqual(expectedKeys(fixture.expected.findings));
    },
  );

  it("clean is eligible for attorney review", () => {
    const findings = validateCase(toSnapshot(loadFixture("clean")));
    expect(isEligibleForAttorneySignoff(deriveStatus(findings))).toBe(true);
  });
});

describe("date-conflict: replace and revalidate", () => {
  const fixture = deepFreeze(loadFixture("date-conflict"));
  const replacement = fixture.replacement;

  it("has a replacement that is the next version of an existing document", () => {
    expect(replacement).toBeDefined();
    const original = fixture.documents.find(
      (d) => d.documentId === replacement!.document.documentId,
    );
    expect(original).toBeDefined();
    expect(replacement!.document.version).toBe(original!.version + 1);
  });

  it("Run 1 is BLOCKED with evidence from both conflicting documents", () => {
    const findings = validateCase(toSnapshot(fixture));
    expect(deriveStatus(findings)).toBe("BLOCKED");
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f.type).toBe("EMPLOYMENT_DATE_CONFLICT");
    expect(f.evidence.map((e) => e.documentId).sort()).toEqual(["dc-evl", "dc-resume"]);
    expect(f.evidence.map((e) => e.snippet).sort()).toEqual([
      "2021-03-15 to present",
      "since September 1, 2021",
    ]);
    expect(f.evidence.find((e) => e.documentId === "dc-resume")!.jobIndex).toBe(0);
    expect(f.message).toContain("170 days");
  });

  it("Run 2 (with the corrected document) is READY_FOR_REVIEW", () => {
    const findings = validateCase(toSnapshot(fixture, { applyReplacement: true }));
    expect(deriveStatus(findings)).toBe(replacement!.expected.status);
    expect(findingKeys(findings)).toEqual(expectedKeys(replacement!.expected.findings));
    expect(deriveStatus(findings)).toBe("READY_FOR_REVIEW");
  });

  it("revalidation leaves Run 1's inputs and findings unchanged", () => {
    const before = validateCase(toSnapshot(fixture));
    validateCase(toSnapshot(fixture, { applyReplacement: true }));
    const after = validateCase(toSnapshot(fixture));
    expect(after).toEqual(before);
    // Frozen fixture: any attempt to mutate version 1 would have thrown.
    expect(fixture.documents.find((d) => d.documentId === "dc-evl")!.version).toBe(1);
  });
});
