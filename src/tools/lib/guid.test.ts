import { describe, it, expect } from "vitest";
import { generateGuids } from "./guid";

describe("generateGuids", () => {
  it("generates the requested count", () => {
    expect(generateGuids({ count: 3, uppercase: false, hyphens: true, braces: false })).toHaveLength(3);
  });
  it("produces valid v4 shape with hyphens", () => {
    const [g] = generateGuids({ count: 1, uppercase: false, hyphens: true, braces: false });
    expect(g).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it("applies formatting options", () => {
    const [g] = generateGuids({ count: 1, uppercase: true, hyphens: false, braces: true });
    expect(g).toMatch(/^\{[0-9A-F]{32}\}$/);
  });
  it("produces unique values", () => {
    const set = new Set(generateGuids({ count: 50, uppercase: false, hyphens: true, braces: false }));
    expect(set.size).toBe(50);
  });
});
