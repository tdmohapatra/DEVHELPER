import { describe, it, expect } from "vitest";
import { parseCron, parseField, matches, nextRuns } from "./cron";

describe("parseField", () => {
  it("expands * and ranges and steps and lists", () => {
    expect(parseField("*", 0, 5).values).toEqual(new Set([0, 1, 2, 3, 4, 5]));
    expect(parseField("1-3", 0, 9).values).toEqual(new Set([1, 2, 3]));
    expect(parseField("*/15", 0, 59).values).toEqual(new Set([0, 15, 30, 45]));
    expect(parseField("0-10/5", 0, 59).values).toEqual(new Set([0, 5, 10]));
    expect(parseField("1,5,9", 0, 9).values).toEqual(new Set([1, 5, 9]));
  });
  it("accepts month and day names, and 7 as Sunday", () => {
    expect([...parseField("jan-mar", 1, 12, ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]).values]).toEqual([1, 2, 3]);
    expect(parseField("7", 0, 6, ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]).values).toEqual(new Set([0]));
  });
  it("rejects out-of-range and malformed fields", () => {
    expect(() => parseField("70", 0, 59)).toThrow();
    expect(() => parseField("5-1", 0, 59)).toThrow();
    expect(() => parseField("*/0", 0, 59)).toThrow();
  });
});

describe("parseCron", () => {
  it("requires 5 or 6 fields", () => {
    expect(() => parseCron("* * * *")).toThrow();
    expect(parseCron("* * * * *").hasSeconds).toBe(false);
    expect(parseCron("0 * * * * *").hasSeconds).toBe(true);
  });
});

describe("matches", () => {
  it("matches daily midnight", () => {
    const c = parseCron("0 0 * * *");
    expect(matches(new Date(2024, 0, 1, 0, 0), c)).toBe(true);
    expect(matches(new Date(2024, 0, 1, 0, 1), c)).toBe(false);
  });
  it("uses OR semantics when both DOM and DOW are restricted", () => {
    const c = parseCron("0 0 13 * FRI"); // the 13th OR any Friday
    expect(matches(new Date(2024, 0, 13, 0, 0), c)).toBe(true); // Jan 13 2024 (Sat) — DOM hit
    expect(matches(new Date(2024, 0, 5, 0, 0), c)).toBe(true); // Jan 5 2024 is a Friday — DOW hit
    expect(matches(new Date(2024, 0, 6, 0, 0), c)).toBe(false); // Sat, not the 13th
  });
});

describe("nextRuns", () => {
  it("computes the next daily-midnight runs", () => {
    const c = parseCron("0 0 * * *");
    const runs = nextRuns(c, new Date(2024, 0, 1, 12, 0), 3);
    expect(runs).toHaveLength(3);
    expect(runs[0].getDate()).toBe(2);
    expect(runs[0].getHours()).toBe(0);
    expect(runs[1].getDate()).toBe(3);
  });
  it("computes every-15-minute runs", () => {
    const c = parseCron("*/15 * * * *");
    const runs = nextRuns(c, new Date(2024, 0, 1, 9, 7), 2);
    expect(runs[0].getMinutes()).toBe(15);
    expect(runs[1].getMinutes()).toBe(30);
  });
});
