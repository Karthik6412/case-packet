import { describe, expect, it } from "vitest";
import {
  namesMatch,
  normalizeEmployer,
  parseIsoDay,
} from "./normalize";

describe("namesMatch", () => {
  it.each([
    ["Jose Garcia", "José  GARCIA", true], // case, diacritics, whitespace
    ["OKAFOR, AMARA CHIDI", "Amara C. Okafor", true], // order, initial
    ["Amara Okafor", "Amara Chidi Okafor", true], // middle name omitted
    ["Lena Höffmann", "HOFFMANN, LENA SOPHIE", true],
    ["Jose Garcia", "Jose Garza", false], // different surname
    ["Jose Garcia", "Joel Garcia", false], // different given name
    ["", "Jose Garcia", false],
  ])("%s vs %s -> %s", (a, b, expected) => {
    expect(namesMatch(a, b)).toBe(expected);
  });
});

describe("normalizeEmployer", () => {
  it.each([
    ["Northwind Analytics, Inc.", "Northwind Analytics Inc", true],
    ["Brightwater Logistics LLC", "Brightwater Logistics", true],
    ["ACME Corp.", "acme corporation", true],
    ["Northwind Analytics", "Northwind Data", false],
  ])("%s vs %s -> equal=%s", (a, b, equal) => {
    expect(normalizeEmployer(a) === normalizeEmployer(b)).toBe(equal);
  });
});

describe("parseIsoDay", () => {
  it("parses valid ISO dates and differences are in whole days", () => {
    const a = parseIsoDay("2021-03-15") as number;
    const b = parseIsoDay("2021-09-01") as number;
    expect(b - a).toBe(170);
  });

  it.each(["2021-02-30", "2021-13-01", "March 15, 2021", "2021-3-5", ""])(
    "rejects %j",
    (raw) => {
      expect(parseIsoDay(raw)).toBeNull();
    },
  );
});
