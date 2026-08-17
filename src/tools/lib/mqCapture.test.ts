import { describe, it, expect } from "vitest";
import {
  brokerUnreachableEvent,
  findingLines,
  findingSummary,
  natsServerEvent,
  rabbitBrokerEvent,
  rabbitPublishEvent,
  serviceBusMessageEvent,
  serviceBusNamespaceEvent,
  serviceBusSendEvent,
  redisCommandEvent,
  redisHealthEvent,
  severityStatus,
  worstSeverity,
  type OpsFinding,
} from "./mqCapture";

const bad: OpsFinding = { severity: "bad", subject: "memory", message: "at the limit" };
const warn: OpsFinding = { severity: "warn", subject: "clients", message: "many idle" };

describe("severityStatus", () => {
  it("maps a broker severity onto a timeline status", () => {
    expect(severityStatus("bad")).toBe("error");
    expect(severityStatus("warn")).toBe("warn");
    expect(severityStatus("ok")).toBe("ok");
    expect(severityStatus("unknown")).toBe("info");
  });
});

describe("worstSeverity", () => {
  it("is ok when there is nothing to report", () => {
    expect(worstSeverity([])).toBe("ok");
  });

  it("picks the worst regardless of order", () => {
    expect(worstSeverity([warn, bad])).toBe("bad");
    expect(worstSeverity([bad, warn])).toBe("bad");
  });

  it("ranks a warning above an unknown", () => {
    expect(worstSeverity([{ severity: "unknown" }, { severity: "warn" }])).toBe("warn");
  });
});

describe("findingLines", () => {
  it("renders subject and message, worst first", () => {
    expect(findingLines([warn, bad])).toBe("memory: at the limit\nclients: many idle");
  });

  it("is empty for no findings", () => {
    expect(findingLines([])).toBe("");
  });
});

describe("findingSummary", () => {
  it("says healthy when nothing is wrong", () => {
    expect(findingSummary([])).toBe("healthy");
    expect(findingSummary([{ severity: "ok" }])).toBe("healthy");
  });

  it("counts problems and warnings separately, singular and plural", () => {
    expect(findingSummary([bad])).toBe("1 problem");
    expect(findingSummary([bad, bad, warn])).toBe("2 problems, 1 warning");
  });
});

describe("redisHealthEvent", () => {
  const metrics = [
    { id: "mem", label: "Memory", value: "900 MB", severity: "bad" as const, detail: "near maxmemory" },
    { id: "hit", label: "Hit ratio", value: "40%", severity: "warn" as const, detail: "cache barely helping" },
    { id: "up", label: "Uptime", value: "3d", severity: "ok" as const, detail: "fine" },
  ];

  it("takes its status from the worst metric", () => {
    const e = redisHealthEvent({ target: "localhost:6379", version: "7.2", metrics });
    expect(e.source).toBe("redis");
    expect(e.status).toBe("error");
    expect(e.service).toBe("localhost:6379");
  });

  it("puts only the non-ok metrics in the error text", () => {
    const e = redisHealthEvent({ target: "localhost:6379", metrics });
    expect(e.error).toMatch(/Memory/);
    expect(e.error).toMatch(/Hit ratio/);
    expect(e.error).not.toMatch(/Uptime/);
  });

  it("is an ok event with no error text when every metric is fine", () => {
    const e = redisHealthEvent({ target: "localhost:6379", metrics: [metrics[2]] });
    expect(e.status).toBe("ok");
    expect(e.error).toBeUndefined();
    expect(e.title).toMatch(/healthy/);
  });

  it("keeps the numbers in the payload even when healthy", () => {
    const e = redisHealthEvent({ target: "localhost:6379", metrics: [metrics[2]], keys: 12 });
    expect(JSON.parse(e.payload!)).toMatchObject({ target: "localhost:6379", keys: 12 });
  });
});

describe("redisCommandEvent", () => {
  it("records a successful command with its reply", () => {
    const e = redisCommandEvent("localhost:6379", "INFO", "redis_version:7.2", true);
    expect(e.status).toBe("ok");
    expect(e.error).toBeUndefined();
    expect(JSON.parse(e.payload!).command).toBe("INFO");
  });

  it("marks a failed command and keeps the reason", () => {
    const e = redisCommandEvent("localhost:6379", "GETX a", "ERR unknown command", false);
    expect(e.status).toBe("error");
    expect(e.error).toBe("ERR unknown command");
    expect(e.title).toMatch(/failed/);
  });
});

describe("natsServerEvent", () => {
  it("prefers the server name over the address as the service", () => {
    const e = natsServerEvent({ target: "localhost:8222", serverName: "nats-0", findings: [] });
    expect(e.service).toBe("nats-0");
    expect(e.source).toBe("nats");
  });

  it("falls back to the address when the server is unnamed", () => {
    const e = natsServerEvent({ target: "localhost:8222", findings: [] });
    expect(e.service).toBe("localhost:8222");
  });

  it("carries the findings into the error text", () => {
    const e = natsServerEvent({ target: "localhost:8222", findings: [bad] });
    expect(e.status).toBe("error");
    expect(e.error).toMatch(/at the limit/);
  });
});

describe("rabbitBrokerEvent", () => {
  it("summarises the broker and its findings", () => {
    const e = rabbitBrokerEvent({ target: "localhost:15672", version: "3.13", queues: 4, messages: 900, findings: [warn] });
    expect(e.source).toBe("rabbitmq");
    expect(e.status).toBe("warn");
    expect(e.title).toMatch(/v3\.13/);
    expect(JSON.parse(e.payload!)).toMatchObject({ queues: 4, messages: 900 });
  });
});

describe("rabbitPublishEvent", () => {
  it("records a publish", () => {
    const e = rabbitPublishEvent("localhost:15672", "orders.created", true, '{"id":1}');
    expect(e.status).toBe("ok");
    expect(e.title).toBe("Publish → orders.created");
  });

  it("records a failure with its reason", () => {
    const e = rabbitPublishEvent("localhost:15672", "orders.created", false, "404 Not Found");
    expect(e.status).toBe("error");
    expect(e.error).toBe("404 Not Found");
  });
});

describe("serviceBusNamespaceEvent", () => {
  it("carries the counts and takes its status from the worst finding", () => {
    const e = serviceBusNamespaceEvent({
      target: "labs.servicebus.windows.net",
      queues: 3,
      topics: 1,
      subscriptions: 2,
      active: 40,
      deadLettered: 7,
      findings: [{ severity: "bad", subject: "orders", message: "7 dead-lettered" }],
    });
    expect(e.source).toBe("servicebus");
    expect(e.status).toBe("error");
    expect(JSON.parse(e.payload!)).toMatchObject({ queues: 3, subscriptions: 2, deadLettered: 7 });
  });

  it("is ok when nothing is wrong", () => {
    const e = serviceBusNamespaceEvent({ target: "labs.servicebus.windows.net", findings: [] });
    expect(e.status).toBe("ok");
    expect(e.title).toMatch(/healthy/);
  });
});

describe("serviceBusMessageEvent", () => {
  it("records a dead-lettered message as the error it is, with the broker's reason", () => {
    const e = serviceBusMessageEvent(
      "labs.servicebus.windows.net",
      "orders",
      { properties: { DeadLetterReason: "MaxDeliveryCountExceeded", DeadLetterErrorDescription: "gave up", CorrelationId: "c-1" }, body: "{}" },
      true,
    );
    expect(e.status).toBe("error");
    expect(e.title).toMatch(/Dead-lettered on orders — MaxDeliveryCountExceeded/);
    expect(e.error).toBe("MaxDeliveryCountExceeded: gave up");
    expect(e.correlationId).toBe("c-1");
  });

  it("says so when a dead letter carries no reason at all", () => {
    const e = serviceBusMessageEvent("ns", "orders", { properties: {}, body: "" }, true);
    expect(e.error).toMatch(/no reason recorded/);
  });

  it("records a live message as information, not a failure", () => {
    const e = serviceBusMessageEvent("ns", "orders", { properties: { MessageId: "m" }, body: "hi" }, false);
    expect(e.status).toBe("info");
    expect(e.error).toBeUndefined();
  });
});

describe("serviceBusSendEvent", () => {
  it("records both outcomes", () => {
    expect(serviceBusSendEvent("ns", "orders", true, "{}").status).toBe("ok");
    const failed = serviceBusSendEvent("ns", "orders", false, "401 rejected");
    expect(failed.status).toBe("error");
    expect(failed.title).toMatch(/failed$/);
    expect(failed.error).toBe("401 rejected");
  });
});

describe("brokerUnreachableEvent", () => {
  it("distinguishes not-reachable from unhealthy", () => {
    const e = brokerUnreachableEvent("nats", "localhost:4222", "connection refused");
    expect(e.status).toBe("error");
    expect(e.title).toMatch(/unreachable/);
    expect(e.error).toBe("connection refused");
  });
});
