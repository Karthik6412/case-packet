import { describe, expect, it } from "vitest";
import {
  FindingSchema,
  type CaseSnapshot,
  type CaseStatus,
  type FindingType,
} from "@/domain/schemas";
import { baseSnapshot, deepFreeze } from "./test-helpers";
import { deriveStatus } from "./status";
import { validateCase } from "./validateCase";

interface Row {
  name: string;
  snapshot: CaseSnapshot;
  types: FindingType[];
  status: CaseStatus;
}

const rows: Row[] = [
  {
    name: "consistent packet",
    snapshot: baseSnapshot(),
    types: [],
    status: "READY_FOR_REVIEW",
  },
  {
    name: "name formatting differences are normalized away",
    snapshot: baseSnapshot({
      letter: { fullName: "Amára  Okafor" },
      payroll: { fullName: "AMARA OKAFOR" },
    }),
    types: [],
    status: "READY_FOR_REVIEW",
  },
  {
    name: "different surname -> identity mismatch",
    snapshot: baseSnapshot({ letter: { fullName: "Amara Okonkwo" } }),
    types: ["IDENTITY_MISMATCH"],
    status: "BLOCKED",
  },
  {
    name: "date of birth differs -> identity mismatch",
    snapshot: baseSnapshot({ payroll: { dateOfBirth: "1990-12-04" } }),
    types: ["IDENTITY_MISMATCH"],
    status: "BLOCKED",
  },
  {
    name: "start dates 170 days apart -> material conflict",
    snapshot: baseSnapshot({ letter: { employmentStartDate: "2021-03-15" } }),
    types: ["EMPLOYMENT_DATE_CONFLICT"],
    status: "BLOCKED",
  },
  {
    name: "start dates 8 days apart -> just over tolerance",
    snapshot: baseSnapshot({ letter: { employmentStartDate: "2021-08-24" } }),
    types: ["EMPLOYMENT_DATE_CONFLICT"],
    status: "BLOCKED",
  },
  {
    name: "start dates 7 days apart -> within tolerance, no finding",
    snapshot: baseSnapshot({ letter: { employmentStartDate: "2021-08-25" } }),
    types: [],
    status: "READY_FOR_REVIEW",
  },
  {
    name: "missing payroll record -> missing required document",
    snapshot: baseSnapshot({ omit: ["PAYROLL_RECORD"] }),
    types: ["MISSING_REQUIRED_DOCUMENT"],
    status: "BLOCKED",
  },
  {
    name: "two documents missing -> one finding each",
    snapshot: baseSnapshot({ omit: ["PAYROLL_RECORD", "PASSPORT"] }),
    types: ["MISSING_REQUIRED_DOCUMENT", "MISSING_REQUIRED_DOCUMENT"],
    status: "BLOCKED",
  },
  {
    name: "low-confidence start date -> attention, and no spurious conflict",
    snapshot: baseSnapshot({
      letter: { employmentStartDate: ["2021-03-15", 0.4] },
    }),
    types: ["EXTRACTION_LOW_CONFIDENCE"],
    status: "NEEDS_ATTENTION",
  },
  {
    name: "field not found -> low confidence",
    snapshot: baseSnapshot({ passport: { passportNumber: null } }),
    types: ["EXTRACTION_LOW_CONFIDENCE"],
    status: "NEEDS_ATTENTION",
  },
  {
    name: "unparseable date -> low confidence",
    snapshot: baseSnapshot({
      letter: { employmentStartDate: "last spring" },
    }),
    types: ["EXTRACTION_LOW_CONFIDENCE"],
    status: "NEEDS_ATTENTION",
  },
  {
    name: "employer names differ -> ambiguous match",
    snapshot: baseSnapshot({ payroll: { employerName: "Northwind Data Corp" } }),
    types: ["AMBIGUOUS_EMPLOYER_MATCH"],
    status: "NEEDS_ATTENTION",
  },
  {
    name: "blocking finding outranks attention finding",
    snapshot: baseSnapshot({
      letter: {
        employmentStartDate: "2021-03-15",
        employerName: ["Northwind Analytics, Inc.", 0.3],
      },
    }),
    types: ["EMPLOYMENT_DATE_CONFLICT", "EXTRACTION_LOW_CONFIDENCE"],
    status: "BLOCKED",
  },
];

describe("validateCase + deriveStatus", () => {
  it.each(rows)("$name", ({ snapshot, types, status }) => {
    const findings = validateCase(snapshot);
    expect(findings.map((f) => f.type).sort()).toEqual([...types].sort());
    expect(deriveStatus(findings)).toBe(status);
    for (const f of findings) {
      expect(FindingSchema.safeParse(f).success).toBe(true); // C5: evidence >= 1
    }
  });
});

describe("finding evidence", () => {
  it("date conflict cites both documents, both values, and the delta", () => {
    const [f] = validateCase(
      baseSnapshot({ letter: { employmentStartDate: "2021-03-15" } }),
    );
    expect(f.evidence.map((e) => e.documentType).sort()).toEqual([
      "EMPLOYMENT_VERIFICATION_LETTER",
      "PAYROLL_RECORD",
    ]);
    expect(f.evidence.map((e) => e.value).sort()).toEqual([
      "2021-03-15",
      "2021-09-01",
    ]);
    expect(f.message).toContain("170 days");
  });

  it("missing document cites the absent type with a null document id", () => {
    const [f] = validateCase(baseSnapshot({ omit: ["PAYROLL_RECORD"] }));
    expect(f.evidence).toEqual([
      expect.objectContaining({ documentId: null, documentType: "PAYROLL_RECORD" }),
    ]);
  });
});

describe("purity (C1)", () => {
  it("does not mutate input and is repeatable", () => {
    const snap = deepFreeze(
      baseSnapshot({ letter: { employmentStartDate: "2021-03-15" } }),
    );
    const first = validateCase(snap);
    const second = validateCase(snap);
    expect(second).toEqual(first);
  });

  it("honors custom thresholds", () => {
    const snap = baseSnapshot({ letter: { employmentStartDate: "2021-08-25" } });
    expect(validateCase(snap, { dateToleranceDays: 3 }).map((f) => f.type)).toEqual([
      "EMPLOYMENT_DATE_CONFLICT",
    ]);
  });
});
