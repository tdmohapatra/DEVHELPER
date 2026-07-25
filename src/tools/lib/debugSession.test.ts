import { describe, it, expect } from "vitest";
import {
  parseLogEntries,
  parseTimestamp,
  statusFromLevel,
  sortEvents,
  filterEvents,
  correlationIds,
  eventMatchesId,
  serviceFlow,
  traceSummary,
  toMarkdown,
  buildAiContext,
  type DebugEvent,
} from "./debugSession";

describe("parseTimestamp", () => {
  it("handles epoch ms, epoch seconds and ISO strings", () => {
    expect(parseTimestamp(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(parseTimestamp(1_700_000_000)).toBe(1_700_000_000_000);
    expect(parseTimestamp("2024-01-02T03:04:05.000Z")).toBe(Date.parse("2024-01-02T03:04:05.000Z"));
    expect(parseTimestamp("nonsense")).toBeUndefined();
    expect(parseTimestamp(null)).toBeUndefined();
  });
});

describe("statusFromLevel", () => {
  it("maps levels to statuses", () => {
    expect(statusFromLevel("Error")).toBe("error");
    expect(statusFromLevel("FATAL")).toBe("error");
    expect(statusFromLevel("Warning")).toBe("warn");
    expect(statusFromLevel("Information")).toBe("info");
    expect(statusFromLevel("weird")).toBeUndefined();
  });
});

describe("parseLogEntries", () => {
  it("parses a JSON array of log objects", () => {
    const evs = parseLogEntries(JSON.stringify([
      { timestamp: "2024-01-01T00:00:01Z", level: "Information", message: "started" },
      { timestamp: "2024-01-01T00:00:02Z", level: "Error", message: "boom" },
    ]));
    expect(evs).toHaveLength(2);
    expect(evs[1].status).toBe("error");
    expect(evs[1].title).toBe("boom");
  });

  it("parses NDJSON with Serilog-style @t/@l/@m and SourceContext", () => {
    const nd = [
      JSON.stringify({ "@t": "2024-01-01T00:00:01Z", "@l": "Warning", "@m": "slow", SourceContext: "OrderSvc", TraceId: "abc", CorrelationId: "c-1", Elapsed: "125ms" }),
      JSON.stringify({ "@t": "2024-01-01T00:00:02Z", "@m": "ok", SourceContext: "OrderSvc" }),
    ].join("\n");
    const evs = parseLogEntries(nd);
    expect(evs).toHaveLength(2);
    expect(evs[0].status).toBe("warn");
    expect(evs[0].service).toBe("OrderSvc");
    expect(evs[0].traceId).toBe("abc");
    expect(evs[0].correlationId).toBe("c-1");
    expect(evs[0].durationMs).toBe(125);
  });

  it("treats an error field as an error status even without a level", () => {
    const evs = parseLogEntries(JSON.stringify({ message: "failed", exception: "NullReferenceException" }));
    expect(evs[0].status).toBe("error");
    expect(evs[0].error).toContain("NullReference");
  });

  it("falls back to a plain-text line as a log event", () => {
    const evs = parseLogEntries("just a plain log line\nsecond line");
    expect(evs).toHaveLength(2);
    expect(evs[0].title).toBe("just a plain log line");
    expect(evs[0].status).toBe("info");
  });

  it("returns nothing for empty input", () => {
    expect(parseLogEntries("   ")).toHaveLength(0);
  });
});

const sample: DebugEvent[] = [
  { id: "1", at: 300, source: "database", title: "insert", status: "error", correlationId: "c-1", error: "timeout" },
  { id: "2", at: 100, source: "api", title: "POST /orders", status: "ok", correlationId: "c-1", durationMs: 12 },
  { id: "3", at: 200, source: "nats", title: "published", status: "info", correlationId: "c-2" },
];

describe("sortEvents", () => {
  it("orders ascending by timestamp", () => {
    expect(sortEvents(sample).map((e) => e.id)).toEqual(["2", "3", "1"]);
  });
});

describe("filterEvents", () => {
  it("filters errors only", () => {
    expect(filterEvents(sample, { errorsOnly: true }).map((e) => e.id)).toEqual(["1"]);
  });
  it("filters by source", () => {
    expect(filterEvents(sample, { sources: ["api", "nats"] }).map((e) => e.id).sort()).toEqual(["2", "3"]);
  });
  it("filters by correlation id", () => {
    expect(filterEvents(sample, { correlationId: "c-1" }).map((e) => e.id).sort()).toEqual(["1", "2"]);
  });
  it("filters by free-text query across fields", () => {
    expect(filterEvents(sample, { query: "timeout" }).map((e) => e.id)).toEqual(["1"]);
    expect(filterEvents(sample, { query: "/orders" }).map((e) => e.id)).toEqual(["2"]);
  });
});

describe("correlationIds", () => {
  it("returns distinct ids in chronological first-seen order", () => {
    expect(correlationIds(sample)).toEqual(["c-1", "c-2"]);
  });
});

const flow: DebugEvent[] = [
  { id: "a", at: 100, source: "api", title: "POST /orders", status: "ok", service: "OrderApi", correlationId: "ord-9", traceId: "t-1", durationMs: 20 },
  { id: "b", at: 200, source: "nats", title: "OrderCreated", status: "ok", service: "OrderSvc", correlationId: "ord-9" },
  { id: "c", at: 300, source: "database", title: "INSERT payment", status: "error", service: "PaymentSvc", correlationId: "ord-9", error: "deadlock" },
  { id: "d", at: 150, source: "log", title: "unrelated", status: "info", service: "Other", correlationId: "zzz" },
];

describe("eventMatchesId", () => {
  it("matches on correlation id, trace id, and text", () => {
    expect(eventMatchesId(flow[0], "ord-9")).toBe(true);
    expect(eventMatchesId(flow[0], "t-1")).toBe(true);
    expect(eventMatchesId(flow[0], "/orders")).toBe(true);
    expect(eventMatchesId(flow[3], "ord-9")).toBe(false);
    expect(eventMatchesId(flow[0], "")).toBe(false);
  });
});

describe("serviceFlow", () => {
  it("orders services by first appearance and rolls up the worst status", () => {
    const hops = serviceFlow(flow.filter((e) => e.correlationId === "ord-9"));
    expect(hops.map((h) => h.service)).toEqual(["OrderApi", "OrderSvc", "PaymentSvc"]);
    expect(hops[2].status).toBe("error");
    expect(hops[0].count).toBe(1);
  });
});

describe("traceSummary", () => {
  it("computes span duration, error count and first failure point", () => {
    const s = traceSummary(flow.filter((e) => e.correlationId === "ord-9"));
    expect(s.count).toBe(3);
    expect(s.errors).toBe(1);
    expect(s.durationMs).toBe(200); // 300 - 100
    expect(s.failurePoint?.id).toBe("c");
  });
});

describe("exports", () => {
  const session = { id: "s", name: "Order 123", createdAt: 0, events: sample };
  it("markdown includes the session name and event titles", () => {
    const md = toMarkdown(session);
    expect(md).toContain("# Debug Session: Order 123");
    expect(md).toContain("POST /orders");
    expect(md).toContain("error: timeout");
  });
  it("AI context is chronological and includes correlation ids", () => {
    const ctx = buildAiContext(session);
    expect(ctx).toContain("Order 123");
    expect(ctx.indexOf("POST /orders")).toBeLessThan(ctx.indexOf("insert"));
    expect(ctx).toContain("corr=c-1");
  });
  it("AI context honours a selection", () => {
    const ctx = buildAiContext(session, new Set(["2"]));
    expect(ctx).toContain("POST /orders");
    expect(ctx).not.toContain("insert");
  });
});
