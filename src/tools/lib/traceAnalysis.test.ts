import { describe, it, expect } from "vitest";
import type { DebugEvent } from "./debugSession";
import {
  ambiguousOrder,
  cascadeErrors,
  eventEnd,
  repeatedSteps,
  shareOfSpan,
  slowestEvents,
  traceGaps,
  traceInsights,
  traceSpan,
  waterfall,
} from "./traceAnalysis";

let n = 0;
const ev = (over: Partial<DebugEvent> & { at: number }): DebugEvent => ({
  id: `e${++n}`,
  source: "api",
  title: "step",
  status: "info",
  ...over,
});

describe("eventEnd", () => {
  it("adds the duration when there is one", () => {
    expect(eventEnd(ev({ at: 100, durationMs: 50 }))).toBe(150);
  });

  it("treats an event with no duration as instantaneous", () => {
    expect(eventEnd(ev({ at: 100 }))).toBe(100);
  });
});

describe("traceSpan", () => {
  it("runs from the first start to the last end, not the last start", () => {
    const span = traceSpan([ev({ at: 0 }), ev({ at: 100, durationMs: 400 })]);
    expect(span).toEqual({ startAt: 0, endAt: 500, ms: 500 });
  });

  it("is zero for no events", () => {
    expect(traceSpan([])).toEqual({ startAt: 0, endAt: 0, ms: 0 });
  });

  it("is zero for a single instantaneous event", () => {
    expect(traceSpan([ev({ at: 42 })]).ms).toBe(0);
  });
});

describe("waterfall", () => {
  it("positions and sizes bars against the span", () => {
    const rows = waterfall([ev({ at: 0, durationMs: 100 }), ev({ at: 500, durationMs: 500 })]);
    expect(rows[0]).toMatchObject({ offsetMs: 0, leftPct: 0, widthPct: 10 });
    expect(rows[1]).toMatchObject({ offsetMs: 500, leftPct: 50, widthPct: 50 });
  });

  it("gives an event with no duration a visible sliver, marked as instant", () => {
    const rows = waterfall([ev({ at: 0 }), ev({ at: 1000, durationMs: 10 })]);
    expect(rows[0].instant).toBe(true);
    expect(rows[0].widthPct).toBeGreaterThan(0);
    expect(rows[1].instant).toBe(false);
  });

  it("does not divide by a zero span", () => {
    const rows = waterfall([ev({ at: 5 })]);
    expect(rows[0].leftPct).toBe(0);
    expect(Number.isFinite(rows[0].widthPct)).toBe(true);
  });

  it("returns rows in chronological order regardless of input order", () => {
    const rows = waterfall([ev({ at: 900, title: "late" }), ev({ at: 100, title: "early" })]);
    expect(rows.map((r) => r.event.title)).toEqual(["early", "late"]);
  });
});

describe("traceGaps", () => {
  it("measures from when the previous event finished, not when it started", () => {
    const gaps = traceGaps([ev({ at: 0, durationMs: 300 }), ev({ at: 500 })]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].ms).toBe(200);
  });

  it("reports no gap when the next event starts inside the previous one", () => {
    expect(traceGaps([ev({ at: 0, durationMs: 500 }), ev({ at: 100 })])).toEqual([]);
  });

  it("measures from the furthest point reached, not the previous event in order", () => {
    // A long parent overlaps a short child; the gap is after the parent ends.
    const gaps = traceGaps([
      ev({ at: 0, durationMs: 1000, title: "parent" }),
      ev({ at: 100, durationMs: 50, title: "child" }),
      ev({ at: 1200, title: "next" }),
    ]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].ms).toBe(200);
    expect(gaps[0].after.title).toBe("parent");
  });

  it("is sorted largest first and reports the share of the span", () => {
    const gaps = traceGaps([ev({ at: 0 }), ev({ at: 100 }), ev({ at: 1000 })]);
    expect(gaps.map((g) => g.ms)).toEqual([900, 100]);
    expect(Math.round(gaps[0].pctOfSpan)).toBe(90);
  });

  it("has nothing to report for a single event", () => {
    expect(traceGaps([ev({ at: 1 })])).toEqual([]);
  });
});

describe("slowestEvents", () => {
  it("ignores events with no duration and orders by it", () => {
    const list = slowestEvents([ev({ at: 0, durationMs: 10 }), ev({ at: 1 }), ev({ at: 2, durationMs: 90 })]);
    expect(list.map((e) => e.durationMs)).toEqual([90, 10]);
  });

  it("respects the limit", () => {
    expect(slowestEvents([ev({ at: 0, durationMs: 1 }), ev({ at: 1, durationMs: 2 })], 1)).toHaveLength(1);
  });
});

describe("cascadeErrors", () => {
  it("separates the first error from the ones that followed", () => {
    const r = cascadeErrors([
      ev({ at: 200, status: "error", title: "second" }),
      ev({ at: 100, status: "error", title: "first" }),
      ev({ at: 50 }),
    ])!;
    expect(r.first.title).toBe("first");
    expect(r.cascade.map((e) => e.title)).toEqual(["second"]);
  });

  it("is null when nothing failed", () => {
    expect(cascadeErrors([ev({ at: 1 })])).toBeNull();
  });
});

describe("repeatedSteps", () => {
  it("finds a step repeating within one service", () => {
    const events = [1, 2, 3].map((i) => ev({ at: i, title: "POST /pay", service: "billing" }));
    expect(repeatedSteps(events)).toEqual([{ title: "POST /pay", service: "billing", count: 3 }]);
  });

  it("does not treat a fan-out across services as a retry", () => {
    const events = ["a", "b", "c"].map((s, i) => ev({ at: i, title: "handle", service: s }));
    expect(repeatedSteps(events)).toEqual([]);
  });

  it("respects the threshold", () => {
    const events = [1, 2].map((i) => ev({ at: i, title: "x", service: "s" }));
    expect(repeatedSteps(events)).toEqual([]);
    expect(repeatedSteps(events, 2)).toHaveLength(1);
  });
});

describe("ambiguousOrder", () => {
  it("finds timestamps shared by more than one service", () => {
    const r = ambiguousOrder([
      ev({ at: 100, service: "api" }),
      ev({ at: 100, service: "db" }),
      ev({ at: 200, service: "api" }),
    ]);
    expect(r).toEqual([{ at: 100, services: ["api", "db"] }]);
  });

  it("ignores a service logging twice in the same millisecond", () => {
    expect(ambiguousOrder([ev({ at: 100, service: "api" }), ev({ at: 100, service: "api" })])).toEqual([]);
  });
});

describe("shareOfSpan", () => {
  it("is a percentage", () => {
    expect(shareOfSpan(50, 200)).toBe(25);
  });

  it("does not divide by zero", () => {
    expect(shareOfSpan(50, 0)).toBe(0);
  });
});

describe("traceInsights", () => {
  it("has nothing to say about no events", () => {
    expect(traceInsights([])).toEqual([]);
  });

  it("calls out a gap that dominates the span", () => {
    const insights = traceInsights([
      ev({ at: 0, durationMs: 10, title: "publish" }),
      ev({ at: 5000, durationMs: 10, title: "consume" }),
    ]);
    expect(insights[0].headline).toMatch(/unaccounted gap/);
    expect(insights[0].severity).toBe("bad");
    expect(insights[0].detail).toMatch(/publish/);
  });

  it("calls out a single step that dominates the span", () => {
    const insights = traceInsights([ev({ at: 0, durationMs: 4800, title: "SELECT", service: "db" }), ev({ at: 4900 })]);
    expect(insights.some((i) => /is \d+% of the span on its own/.test(i.headline))).toBe(true);
  });

  it("names the first failure and counts the ones that followed it", () => {
    const insights = traceInsights([
      ev({ at: 0, status: "error", title: "db timeout", service: "orders" }),
      ev({ at: 10, status: "error", title: "500", service: "gateway" }),
    ]);
    const first = insights.find((i) => i.headline.startsWith("First failure"))!;
    expect(first.headline).toMatch(/db timeout/);
    expect(first.detail).toMatch(/1 later error/);
  });

  it("describes a lone error without inventing a cascade", () => {
    const insights = traceInsights([ev({ at: 0, status: "error", title: "boom", service: "s", error: "stack" })]);
    expect(insights[0].headline).toMatch(/^Failure at s/);
    expect(insights[0].detail).toBe("stack");
  });

  it("flags a retry loop", () => {
    const events = [1, 2, 3].map((i) => ev({ at: i * 10, title: "POST /pay", service: "billing" }));
    expect(traceInsights(events).some((i) => /happens 3 times/.test(i.headline))).toBe(true);
  });

  it("notes shared timestamps as ordering that is not evidence", () => {
    const insights = traceInsights([ev({ at: 100, service: "api" }), ev({ at: 100, service: "db" })]);
    expect(insights.some((i) => /shared by more than one service/.test(i.headline))).toBe(true);
  });

  it("says so when nothing reports a duration", () => {
    const insights = traceInsights([ev({ at: 0 }), ev({ at: 10 })]);
    expect(insights.some((i) => i.headline === "No event reports a duration")).toBe(true);
  });

  it("does not say that when durations exist", () => {
    const insights = traceInsights([ev({ at: 0, durationMs: 5 }), ev({ at: 10 })]);
    expect(insights.some((i) => i.headline === "No event reports a duration")).toBe(false);
  });

  it("puts problems before warnings before notes", () => {
    const insights = traceInsights([
      ev({ at: 0, status: "error", title: "boom", service: "a" }),
      ev({ at: 100, service: "b" }),
      ev({ at: 100, service: "c" }),
    ]);
    expect(insights[0].severity).toBe("bad");
    expect(insights[insights.length - 1].severity).toBe("info");
  });
});
