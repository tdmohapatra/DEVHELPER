import { describe, it, expect } from "vitest";
import type { DebugEvent } from "./debugSession";
import {
  UNCORRELATED,
  attachToGroup,
  dedupeEvents,
  eventFingerprint,
  groupKeyOf,
  groupLabel,
  groupTraces,
  sessionOverview,
  suggestAttachments,
} from "./sessionAnalysis";

let n = 0;
const ev = (over: Partial<DebugEvent> & { at: number }): DebugEvent => ({
  id: `e${++n}`,
  source: "api",
  title: "step",
  status: "info",
  ...over,
});

describe("groupKeyOf", () => {
  it("prefers the correlation id", () => {
    expect(groupKeyOf(ev({ at: 0, correlationId: "c", traceId: "t" }))).toEqual({ key: "c", kind: "correlation" });
  });

  it("falls back to the trace id", () => {
    expect(groupKeyOf(ev({ at: 0, traceId: "t" }))).toEqual({ key: "t", kind: "trace" });
  });

  it("has a home for events with neither", () => {
    expect(groupKeyOf(ev({ at: 0 }))).toEqual({ key: UNCORRELATED, kind: "none" });
  });
});

describe("groupTraces", () => {
  it("splits events into flows", () => {
    const groups = groupTraces([
      ev({ at: 100, correlationId: "a" }),
      ev({ at: 200, correlationId: "b" }),
      ev({ at: 150, correlationId: "a" }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["b", "a"]);
    expect(groups.find((g) => g.key === "a")!.events).toHaveLength(2);
  });

  it("orders newest flow first", () => {
    const groups = groupTraces([ev({ at: 10, correlationId: "old" }), ev({ at: 900, correlationId: "new" })]);
    expect(groups[0].key).toBe("new");
  });

  it("collects every uncorrelated event into one bucket, not one bucket each", () => {
    const groups = groupTraces([ev({ at: 1 }), ev({ at: 2 }), ev({ at: 3 })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].events).toHaveLength(3);
    expect(groups[0].kind).toBe("none");
  });

  it("spans to the end of the last event, counting its duration", () => {
    const g = groupTraces([ev({ at: 0, correlationId: "a" }), ev({ at: 100, durationMs: 400, correlationId: "a" })])[0];
    expect(g.startAt).toBe(0);
    expect(g.endAt).toBe(500);
    expect(g.spanMs).toBe(500);
  });

  it("takes the worst status and counts errors", () => {
    const g = groupTraces([
      ev({ at: 0, correlationId: "a", status: "ok" }),
      ev({ at: 1, correlationId: "a", status: "error" }),
      ev({ at: 2, correlationId: "a", status: "warn" }),
    ])[0];
    expect(g.status).toBe("error");
    expect(g.errors).toBe(1);
  });

  it("lists distinct services and sources", () => {
    const g = groupTraces([
      ev({ at: 0, correlationId: "a", service: "api", source: "api" }),
      ev({ at: 1, correlationId: "a", service: "api", source: "database" }),
      ev({ at: 2, correlationId: "a", service: "billing", source: "api" }),
    ])[0];
    expect(g.services).toEqual(["api", "billing"]);
    expect(g.sources).toEqual(["api", "database"]);
  });

  it("ignores a blank service rather than listing it", () => {
    const g = groupTraces([ev({ at: 0, correlationId: "a", service: "" })])[0];
    expect(g.services).toEqual([]);
  });
});

describe("sessionOverview", () => {
  it("counts flows, failures and the uncorrelated remainder", () => {
    const o = sessionOverview([
      ev({ at: 0, correlationId: "a" }),
      ev({ at: 10, correlationId: "a", status: "error" }),
      ev({ at: 20, correlationId: "b" }),
      ev({ at: 30 }),
    ]);
    expect(o).toMatchObject({ events: 4, flows: 3, correlatedFlows: 2, failedFlows: 1, uncorrelated: 1 });
  });

  it("spans from the first start to the last end", () => {
    const o = sessionOverview([ev({ at: 0 }), ev({ at: 100, durationMs: 50 })]);
    expect(o.spanMs).toBe(150);
  });

  it("is all zeroes for an empty session", () => {
    expect(sessionOverview([])).toMatchObject({ events: 0, flows: 0, spanMs: 0 });
  });
});

describe("eventFingerprint / dedupeEvents", () => {
  it("treats a re-import of the same log as duplicates", () => {
    const a = ev({ at: 100, title: "GET /x", service: "api" });
    const b = ev({ at: 100, title: "GET /x", service: "api" });
    expect(eventFingerprint(a)).toBe(eventFingerprint(b));
    const r = dedupeEvents([a, b]);
    expect(r.kept).toHaveLength(1);
    expect(r.removed).toHaveLength(1);
  });

  it("keeps two genuine retries, which differ in time", () => {
    const r = dedupeEvents([ev({ at: 100, title: "POST /pay" }), ev({ at: 200, title: "POST /pay" })]);
    expect(r.kept).toHaveLength(2);
  });

  it("keeps the first occurrence", () => {
    const first = ev({ at: 1, title: "x" });
    const second = ev({ at: 1, title: "x" });
    expect(dedupeEvents([first, second]).kept[0].id).toBe(first.id);
  });

  it("distinguishes the same title from two services", () => {
    const r = dedupeEvents([ev({ at: 1, title: "x", service: "a" }), ev({ at: 1, title: "x", service: "b" })]);
    expect(r.kept).toHaveLength(2);
  });
});

describe("suggestAttachments", () => {
  const flow = [
    ev({ at: 1000, correlationId: "a", title: "start" }),
    ev({ at: 2000, correlationId: "a", title: "end" }),
  ];

  it("offers an uncorrelated event that falls inside exactly one flow", () => {
    const orphan = ev({ at: 1500, title: "Redis health" });
    const suggestions = suggestAttachments([...flow, orphan]);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].group.key).toBe("a");
  });

  it("declines to guess when two flows were in flight", () => {
    const other = [ev({ at: 900, correlationId: "b" }), ev({ at: 2100, correlationId: "b" })];
    const orphan = ev({ at: 1500, title: "Redis health" });
    expect(suggestAttachments([...flow, ...other, orphan])).toEqual([]);
  });

  it("ignores an event outside every window", () => {
    expect(suggestAttachments([...flow, ev({ at: 9000 })])).toEqual([]);
  });

  it("includes the window boundaries", () => {
    expect(suggestAttachments([...flow, ev({ at: 2000, title: "edge" })])).toHaveLength(1);
  });

  it("has nothing to offer when everything is already correlated", () => {
    expect(suggestAttachments(flow)).toEqual([]);
  });
});

describe("attachToGroup", () => {
  it("gives the event the flow's correlation id", () => {
    const group = groupTraces([ev({ at: 0, correlationId: "a" })])[0];
    expect(attachToGroup(ev({ at: 1 }), group).correlationId).toBe("a");
  });

  it("uses the trace id when the flow is keyed by one", () => {
    const group = groupTraces([ev({ at: 0, traceId: "t" })])[0];
    const attached = attachToGroup(ev({ at: 1 }), group);
    expect(attached.traceId).toBe("t");
    expect(attached.correlationId).toBeUndefined();
  });
});

describe("groupLabel", () => {
  it("names the uncorrelated bucket in words", () => {
    const g = groupTraces([ev({ at: 0 })])[0];
    expect(groupLabel(g)).toBe("Uncorrelated captures");
  });

  it("uses the id for a real flow", () => {
    expect(groupLabel(groupTraces([ev({ at: 0, correlationId: "abc" })])[0])).toBe("abc");
  });
});
