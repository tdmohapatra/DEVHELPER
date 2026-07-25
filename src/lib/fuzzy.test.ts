import { describe, it, expect } from "vitest";
import { fuzzyMatch, scoreTool } from "./fuzzy";

describe("fuzzyMatch", () => {
  it("matches an in-order subsequence and records positions", () => {
    const r = fuzzyMatch("jf", "JSON Formatter");
    expect(r).not.toBeNull();
    expect(r!.positions).toEqual([0, 5]); // J and the F of Formatter
  });
  it("returns null when not all chars appear in order", () => {
    expect(fuzzyMatch("zzz", "JSON Formatter")).toBeNull();
    expect(fuzzyMatch("fj", "JSON Formatter")).toBeNull(); // wrong order
  });
  it("empty query matches everything with zero score", () => {
    expect(fuzzyMatch("", "anything")).toEqual({ score: 0, positions: [] });
  });
  it("ranks word-boundary / prefix matches above scattered ones", () => {
    const boundary = fuzzyMatch("db", "Database Toolkit")!; // D(prefix) + b? actually 'd','b'
    const scattered = fuzzyMatch("db", "Feedback Builder")!;
    expect(boundary.score).toBeGreaterThan(scattered.score);
  });
  it("rewards contiguous runs", () => {
    const contig = fuzzyMatch("json", "JSON Tools")!;
    const split = fuzzyMatch("json", "Jason Ordered Steel Nodes")!;
    expect(contig.score).toBeGreaterThan(split.score);
  });
});

describe("scoreTool", () => {
  it("prefers a name match and returns its highlight positions", () => {
    const r = scoreTool("json", "JSON Formatter", ["format", "pretty"], "Format JSON");
    expect(r).not.toBeNull();
    expect(r!.positions).toEqual([0, 1, 2, 3]);
  });
  it("still matches via keywords (no highlight positions)", () => {
    const r = scoreTool("uuid", "GUID Generator", ["uuid", "identifier"], "Generate ids");
    expect(r).not.toBeNull();
    expect(r!.positions).toEqual([]);
  });
  it("returns null when nothing matches", () => {
    expect(scoreTool("zzzq", "JSON Formatter", ["format"], "x")).toBeNull();
  });
});
