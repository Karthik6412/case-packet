import { describe, expect, it } from "vitest";
import {
  FindingSchema,
  type CaseSnapshot,
  type CaseStatus,
  type FindingType,
} from "@/domain/schemas";
import { checkDocumentCompleteness } from "./completeness";
import { validateConsistency } from "./consistency";
import { baseSnapshot, deepFreeze, NORTHWIND_JOB, NORTHWIND_LETTER } from "./test-helpers";
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
      resume: { fullName: "Amára  Okafor" },
      offer: { fullName: "AMARA OKAFOR" },
    }),
    types: [],
    status: "READY_FOR_REVIEW",
  },
  {
    name: "different surname -> identity mismatch",
    snapshot: baseSnapshot({ offer: { fullName: "Amara Okonkwo" } }),
    types: ["IDENTITY_MISMATCH"],
    status: "BLOCKED",
  },
  {
    name: "date of birth differs between passport and payroll -> identity mismatch",
    snapshot: baseSnapshot({ payroll: { dateOfBirth: "1990-12-04" } }),
    types: ["IDENTITY_MISMATCH"],
    status: "BLOCKED",
  },
  // --- required documents (EB-2) ---
  { name: "missing resume", snapshot: baseSnapshot({ omit: ["RESUME"] }),
    types: ["MISSING_REQUIRED_DOCUMENT"], status: "BLOCKED" },
  { name: "missing passport", snapshot: baseSnapshot({ omit: ["PASSPORT"] }),
    types: ["MISSING_REQUIRED_DOCUMENT"], status: "BLOCKED" },
  { name: "missing sponsor offer letter", snapshot: baseSnapshot({ omit: ["OFFER_LETTER"] }),
    types: ["MISSING_REQUIRED_DOCUMENT"], status: "BLOCKED" },
  {
    name: "claimed job without a verification letter -> missing",
    snapshot: baseSnapshot({ letters: [] }),
    types: ["MISSING_REQUIRED_DOCUMENT"],
    status: "BLOCKED",
  },
  {
    name: "two claimed jobs, one letter -> one missing",
    snapshot: baseSnapshot({
      jobs: [NORTHWIND_JOB, { employerName: "Orion Freight Ltd", employmentStartDate: "2016-06-01" }],
    }),
    types: ["MISSING_REQUIRED_DOCUMENT"],
    status: "BLOCKED",
  },
  {
    name: "two claimed jobs, two letters (suffixes differ) -> complete",
    snapshot: baseSnapshot({
      jobs: [NORTHWIND_JOB, { employerName: "Orion Freight Ltd", employmentStartDate: "2016-06-01" }],
      letters: [
        NORTHWIND_LETTER,
        { fullName: "Amara Okafor", employerName: "Orion Freight Limited", employmentStartDate: "2016-06-01" },
      ],
    }),
    types: [],
    status: "READY_FOR_REVIEW",
  },
  {
    name: "payroll record is optional: absent -> no finding (baseline) ",
    snapshot: baseSnapshot({ omit: ["PAYROLL_RECORD"] }),
    types: [],
    status: "READY_FOR_REVIEW",
  },
  {
    name: "payroll record present and consistent -> no finding",
    snapshot: baseSnapshot({ payroll: {} }),
    types: [],
    status: "READY_FOR_REVIEW",
  },
  {
    name: "letter employer cannot be paired with claimed job -> ambiguous, not missing",
    snapshot: baseSnapshot({ letter: { employerName: "Northwind Data Corp" } }),
    types: ["AMBIGUOUS_EMPLOYER_MATCH"],
    status: "NEEDS_ATTENTION",
  },
  {
    name: "extra letter for an employer not on the resume -> ambiguous",
    snapshot: baseSnapshot({
      letters: [
        NORTHWIND_LETTER,
        { fullName: "Amara Okafor", employerName: "Zenith Textiles", employmentStartDate: "2010-01-04" },
      ],
    }),
    types: ["AMBIGUOUS_EMPLOYER_MATCH"],
    status: "NEEDS_ATTENTION",
  },
  // --- extraction quality ---
  {
    name: "low-confidence start date -> attention, and no spurious conflict",
    snapshot: baseSnapshot({ job: { employmentStartDate: ["2021-03-15", 0.4] } }),
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
    snapshot: baseSnapshot({ letter: { employmentStartDate: "last spring" } }),
    types: ["EXTRACTION_LOW_CONFIDENCE"],
    status: "NEEDS_ATTENTION",
  },
  {
    name: "optional end date present but low confidence -> attention",
    snapshot: baseSnapshot({ letter: { employmentEndDate: ["2021-08-31", 0.3] } }),
    types: ["EXTRACTION_LOW_CONFIDENCE"],
    status: "NEEDS_ATTENTION",
  },
  {
    name: "resume with no extractable jobs -> low confidence",
    snapshot: baseSnapshot({ jobs: [], letters: [] }),
    types: ["EXTRACTION_LOW_CONFIDENCE"],
    status: "NEEDS_ATTENTION",
  },
  {
    name: "blocking outranks attention",
    snapshot: baseSnapshot({
      job: { employmentStartDate: "2021-03-15" },
      passport: { passportNumber: null },
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

describe("employment-date tolerance boundaries (resume claim vs verification letter)", () => {
  // Resume claims 2021-09-01. The letter's start date is shifted by `delta` days.
  const letterStart = (iso: string) =>
    baseSnapshot({ letter: { employmentStartDate: iso } });

  it.each<[string, number, string, FindingType | null, CaseStatus]>([
    ["0 days", 0, "2021-09-01", null, "READY_FOR_REVIEW"],
    ["1 day later", 1, "2021-09-02", "EMPLOYMENT_DATE_DISCREPANCY", "READY_FOR_REVIEW"],
    ["7 days later", 7, "2021-09-08", "EMPLOYMENT_DATE_DISCREPANCY", "READY_FOR_REVIEW"],
    ["8 days later", 8, "2021-09-09", "EMPLOYMENT_DATE_CONFLICT", "BLOCKED"],
    ["7 days earlier", 7, "2021-08-25", "EMPLOYMENT_DATE_DISCREPANCY", "READY_FOR_REVIEW"],
    ["8 days earlier", 8, "2021-08-24", "EMPLOYMENT_DATE_CONFLICT", "BLOCKED"],
    ["170 days", 170, "2021-03-15", "EMPLOYMENT_DATE_CONFLICT", "BLOCKED"],
  ])("%s", (_name, delta, iso, expectedType, expectedStatus) => {
    const findings = validateCase(letterStart(iso));
    expect(findings.map((f) => f.type)).toEqual(expectedType ? [expectedType] : []);
    expect(deriveStatus(findings)).toBe(expectedStatus);
    if (expectedType) {
      expect(findings[0].message).toContain(`${delta} day`);
    }
  });

  it("a 1-7 day discrepancy is never silently dropped: both values and provenance are recorded", () => {
    const [f] = validateCase(letterStart("2021-09-04"));
    expect(f.type).toBe("EMPLOYMENT_DATE_DISCREPANCY");
    expect(f.severity).toBe("INFO");
    expect(f.evidence).toEqual([
      expect.objectContaining({
        documentId: "resume",
        documentType: "RESUME",
        version: 1,
        field: "employmentStartDate",
        jobIndex: 0,
        value: "2021-09-01",
        snippet: "employmentStartDate: 2021-09-01",
      }),
      expect.objectContaining({
        documentId: "evl-1",
        documentType: "EMPLOYMENT_VERIFICATION_LETTER",
        version: 1,
        field: "employmentStartDate",
        jobIndex: null,
        value: "2021-09-04",
      }),
    ]);
  });

  it("applies the same rules to end dates", () => {
    const withEnds = (resumeEnd: string, letterEnd: string) =>
      validateCase(
        baseSnapshot({
          job: { employmentEndDate: resumeEnd },
          letter: { employmentEndDate: letterEnd },
        }),
      ).map((f) => f.type);
    expect(withEnds("2021-08-31", "2021-08-31")).toEqual([]);
    expect(withEnds("2021-08-31", "2021-09-07")).toEqual(["EMPLOYMENT_DATE_DISCREPANCY"]);
    expect(withEnds("2021-08-31", "2021-09-08")).toEqual(["EMPLOYMENT_DATE_CONFLICT"]);
  });

  it("compares payroll against the verification letter for the same employer", () => {
    expect(
      validateCase(baseSnapshot({ payroll: { employmentStartDate: "2021-09-20" } })).map(
        (f) => f.type,
      ),
    ).toEqual(["EMPLOYMENT_DATE_CONFLICT"]);
  });

  it("does not compare dates across different employers", () => {
    const findings = validateCase(
      baseSnapshot({
        jobs: [NORTHWIND_JOB, { employerName: "Orion Freight Ltd", employmentStartDate: "2016-06-01" }],
        letters: [
          NORTHWIND_LETTER,
          { fullName: "Amara Okafor", employerName: "Orion Freight Limited", employmentStartDate: "2016-06-01" },
        ],
      }),
    );
    expect(findings).toEqual([]);
  });
});

describe("finding evidence", () => {
  it("date conflict cites both documents, both values, and the delta", () => {
    const [f] = validateCase(baseSnapshot({ job: { employmentStartDate: "2021-03-15" } }));
    expect(f.evidence.map((e) => e.documentType).sort()).toEqual([
      "EMPLOYMENT_VERIFICATION_LETTER",
      "RESUME",
    ]);
    expect(f.evidence.map((e) => e.value).sort()).toEqual(["2021-03-15", "2021-09-01"]);
    expect(f.message).toContain("170 days");
  });

  it("missing single document cites the absent type with a null document id", () => {
    const [f] = validateCase(baseSnapshot({ omit: ["OFFER_LETTER"] }));
    expect(f.evidence).toEqual([
      expect.objectContaining({ documentId: null, documentType: "OFFER_LETTER" }),
    ]);
  });

  it("missing letter cites the resume claim and the absent letter", () => {
    const [f] = validateCase(baseSnapshot({ letters: [] }));
    expect(f.evidence).toEqual([
      expect.objectContaining({ documentId: "resume", jobIndex: 0, field: "employerName" }),
      expect.objectContaining({
        documentId: null,
        documentType: "EMPLOYMENT_VERIFICATION_LETTER",
        value: "Northwind Analytics Inc",
      }),
    ]);
  });
});

describe("pipeline split", () => {
  it("completeness and consistency are disjoint and compose into validateCase", () => {
    const snap = baseSnapshot({ omit: ["OFFER_LETTER"], job: { employmentStartDate: "2021-03-15" } });
    const c = checkDocumentCompleteness(snap).map((f) => f.type);
    const v = validateConsistency(snap).map((f) => f.type);
    expect(c).toEqual(["MISSING_REQUIRED_DOCUMENT"]);
    expect(v).toEqual(["EMPLOYMENT_DATE_CONFLICT"]);
    expect(validateCase(snap).map((f) => f.type)).toEqual([...c, ...v]);
  });
});

describe("purity (C1)", () => {
  it("does not mutate input and is repeatable", () => {
    const snap = deepFreeze(baseSnapshot({ job: { employmentStartDate: "2021-03-15" } }));
    const first = validateCase(snap);
    expect(validateCase(snap)).toEqual(first);
  });

  it("honors a custom minor-discrepancy window", () => {
    const snap = baseSnapshot({ letter: { employmentStartDate: "2021-09-04" } });
    expect(validateCase(snap, { minorDiscrepancyMaxDays: 2 }).map((f) => f.type)).toEqual([
      "EMPLOYMENT_DATE_CONFLICT",
    ]);
  });
});
