import { describe, it, expect } from "vitest";
import { parseUnixTimestamp, buildTimeView, relativeTime } from "./time";

describe("parseUnixTimestamp", () => {
  it("detects seconds", () => {
    const r = parseUnixTimestamp("1516239022");
    expect(r.detectedUnit).toBe("seconds");
    expect(r.date.getUTCFullYear()).toBe(2018);
  });
  it("detects milliseconds", () => {
    const r = parseUnixTimestamp("1516239022000");
    expect(r.detectedUnit).toBe("milliseconds");
    expect(r.date.getUTCFullYear()).toBe(2018);
  });
  it("throws on non-numeric", () => {
    expect(() => parseUnixTimestamp("abc")).toThrow();
  });
});

describe("buildTimeView", () => {
  it("produces ISO and unix values", () => {
    const v = buildTimeView(new Date("2018-01-18T01:30:22Z"));
    expect(v.unixSeconds).toBe(1516239022);
    expect(v.iso).toBe("2018-01-18T01:30:22.000Z");
    expect(v.ist).toContain("IST");
  });
});

describe("relativeTime", () => {
  it("formats past and future", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(relativeTime(new Date(now - 120000), now)).toMatch(/minute/);
    expect(relativeTime(new Date(now + 3 * 3600000), now)).toMatch(/hour/);
  });
});
