import { describe, it, expect } from "vitest";
import type { EnvConnection } from "./apiTypes";
import { handoffTarget, hostPort, joinHostPort } from "./envHandoff";

const conn = (kind: EnvConnection["kind"], fields: Record<string, string>): EnvConnection => ({
  id: "c1",
  kind,
  name: "ref",
  fields,
});

describe("hostPort", () => {
  it("reads a bare host", () => {
    expect(hostPort("localhost")).toEqual({ host: "localhost" });
  });

  it("reads host and port", () => {
    expect(hostPort("broker:5672")).toEqual({ host: "broker", port: "5672" });
  });

  it("strips a scheme", () => {
    expect(hostPort("nats://localhost:4222")).toEqual({ host: "localhost", port: "4222" });
  });

  it("strips credentials", () => {
    expect(hostPort("amqp://user:pw@broker:5672")).toEqual({ host: "broker", port: "5672" });
  });

  it("strips a path and query", () => {
    expect(hostPort("http://broker:15672/api?x=1")).toEqual({ host: "broker", port: "15672" });
  });

  it("has nothing to say about an empty string", () => {
    expect(hostPort("  ")).toEqual({ host: "" });
  });
});

describe("joinHostPort", () => {
  it("omits an absent port", () => {
    expect(joinHostPort("h")).toBe("h");
    expect(joinHostPort("h", "1")).toBe("h:1");
  });
});

describe("handoffTarget — Redis", () => {
  it("maps host and port through, defaulting the rest", () => {
    const t = handoffTarget(conn("redis", { host: "cache.internal", port: "6380" }))!;
    expect(t.toolId).toBe("redis");
    expect(t.fields).toEqual({ host: "cache.internal", port: "6380", db: "0" });
  });

  it("takes the port out of the host when the port field is empty", () => {
    expect(handoffTarget(conn("redis", { host: "cache:6390" }))!.fields.port).toBe("6390");
  });

  it("defaults the port when there is none anywhere", () => {
    expect(handoffTarget(conn("redis", { host: "cache" }))!.fields.port).toBe("6379");
  });

  it("declines a reference with no host", () => {
    expect(handoffTarget(conn("redis", {}))).toBeNull();
  });
});

describe("handoffTarget — NATS", () => {
  it("swaps the client port for the monitoring port and says why", () => {
    const t = handoffTarget(conn("nats", { url: "nats://localhost:4222" }))!;
    expect(t.fields.server).toBe("localhost:8222");
    expect(t.note).toMatch(/monitoring port/);
  });

  it("says nothing when the address was already the monitoring port", () => {
    const t = handoffTarget(conn("nats", { url: "localhost:8222" }))!;
    expect(t.fields.server).toBe("localhost:8222");
    expect(t.note).toBeUndefined();
  });

  it("appends the monitoring port to a bare host", () => {
    expect(handoffTarget(conn("nats", { url: "nats.internal" }))!.fields.server).toBe("nats.internal:8222");
  });

  it("declines an empty reference", () => {
    expect(handoffTarget(conn("nats", { url: "" }))).toBeNull();
  });
});

describe("handoffTarget — RabbitMQ", () => {
  it("swaps the AMQP port for the management port and says why", () => {
    const t = handoffTarget(conn("rabbitmq", { url: "amqp://guest@broker:5672" }))!;
    expect(t.fields.server).toBe("broker:15672");
    expect(t.note).toMatch(/management API/);
  });

  it("leaves an address that is already the management port alone", () => {
    expect(handoffTarget(conn("rabbitmq", { url: "broker:15672" }))!.note).toBeUndefined();
  });
});

describe("handoffTarget — everything else", () => {
  it("declines a database reference, which has its own richer route", () => {
    expect(handoffTarget(conn("database", { host: "db", engine: "postgres" }))).toBeNull();
  });

  it("declines kinds nothing consumes yet", () => {
    expect(handoffTarget(conn("mqtt", { broker: "m", port: "1883" }))).toBeNull();
    expect(handoffTarget(conn("api", { baseUrl: "https://x" }))).toBeNull();
  });
});
