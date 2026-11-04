import { describe, expect, it } from "vitest";
import type { CaseStatus, FindingType, Severity } from "@/domain/schemas";
import { FINDING_SEVERITY } from "./config";
import { deriveStatus, isEligibleForAttorneySignoff } from "./status";

const sev = (...s: Severity[]) => s.map((severity) => ({ severity }));

describe("deriveStatus", () => {
  it.each<[string, Severity[], CaseStatus]>([
    ["no findings", [], "READY_FOR_REVIEW"],
    ["one attention", ["ATTENTION"], "NEEDS_ATTENTION"],
    ["several attention", ["ATTENTION", "ATTENTION"], "NEEDS_ATTENTION"],
    ["one blocking", ["BLOCKING"], "BLOCKED"],
    ["blocking + attention", ["ATTENTION", "BLOCKING"], "BLOCKED"],
    ["several blocking", ["BLOCKING", "BLOCKING"], "BLOCKED"],
    ["info only", ["INFO"], "READY_FOR_REVIEW"],
    ["info + attention", ["INFO", "ATTENTION"], "NEEDS_ATTENTION"],
    ["info + blocking", ["INFO", "BLOCKING"], "BLOCKED"],
  ])("%s -> %s", (_name, severities, expected) => {
    expect(deriveStatus(sev(...severities))).toBe(expected);
  });
});

describe("finding type -> case status policy", () => {
  it.each<[FindingType, CaseStatus]>([
    ["EMPLOYMENT_DATE_CONFLICT", "BLOCKED"],
    ["EMPLOYMENT_DATE_DISCREPANCY", "READY_FOR_REVIEW"],
    ["IDENTITY_MISMATCH", "BLOCKED"],
    ["MISSING_REQUIRED_DOCUMENT", "BLOCKED"],
    ["EXTRACTION_LOW_CONFIDENCE", "NEEDS_ATTENTION"],
    ["AMBIGUOUS_EMPLOYER_MATCH", "NEEDS_ATTENTION"],
  ])("%s alone -> %s", (type, expected) => {
    expect(deriveStatus([{ severity: FINDING_SEVERITY[type] }])).toBe(expected);
  });
});

describe("isEligibleForAttorneySignoff", () => {
  it.each<[CaseStatus, boolean]>([
    ["READY_FOR_REVIEW", true],
    ["NEEDS_ATTENTION", false],
    ["BLOCKED", false],
  ])("%s -> %s", (status, eligible) => {
    expect(isEligibleForAttorneySignoff(status)).toBe(eligible);
  });
});
