import { describe, it, expect } from "vitest";
import {
  NATS_ENDPOINTS,
  allStreams,
  allConsumers,
  limitUsage,
  serverFindings,
  formatNanos,
  formatBytes,
  subjectMatches,
  matchingFilters,
  publishSubjectProblem,
  monitorUrl,
  portAdvice,
  withMonitorPort,
  type Jsz,
  type Connz,
} from "./natsMonitor";

const jsz: Jsz = {
  memory: 900,
  storage: 500,
  streams: 1,
  consumers: 2,
  config: { max_memory: 1000, max_storage: 10000 },
  api: { total: 100, errors: 3 },
  account_details: [
    {
      name: "APP",
      stream_detail: [
        {
          name: "ORDERS",
          config: { name: "ORDERS", subjects: ["orders.>"], max_bytes: 1000, discard: "new", storage: "file", num_replicas: 3 },
          state: { messages: 10, bytes: 960, consumer_count: 2 },
          cluster: { leader: "n1", replicas: [{ name: "n2", current: true, lag: 5 }, { name: "n3", current: false }] },
          consumer_detail: [
            { name: "billing", config: { durable_name: "billing", ack_wait: 30_000_000_000, max_ack_pending: 10 }, num_pending: 4, num_ack_pending: 10, num_redelivered: 2 },
            { name: "audit", config: { durable_name: "audit", max_ack_pending: 100 }, num_pending: 0, num_ack_pending: 0, num_redelivered: 0 },
          ],
        },
      ],
    },
  ],
};

describe("endpoints", () => {
  it("asks for subscriptions, streams and consumers explicitly", () => {
    const paths = NATS_ENDPOINTS.map((e) => e.path);
    expect(paths.find((p) => p.startsWith("/connz"))).toContain("subs=1");
    expect(paths.find((p) => p.startsWith("/jsz"))).toContain("streams=1");
    expect(paths.find((p) => p.startsWith("/jsz"))).toContain("consumers=1");
  });

  it("describes every endpoint", () => {
    for (const e of NATS_ENDPOINTS) expect(e.description.length).toBeGreaterThan(0);
  });
});

describe("flattening", () => {
  it("lists streams with their account", () => {
    expect(allStreams(jsz)).toEqual([{ account: "APP", stream: jsz.account_details![0].stream_detail![0] }]);
  });

  it("lists consumers with their stream and account", () => {
    const consumers = allConsumers(jsz);
    expect(consumers).toHaveLength(2);
    expect(consumers[0]).toMatchObject({ account: "APP", stream: "ORDERS" });
  });

  it("returns nothing when JetStream is absent", () => {
    expect(allStreams(null)).toEqual([]);
    expect(allConsumers({})).toEqual([]);
  });
});

describe("limitUsage", () => {
  it("is a percentage of the limit", () => {
    expect(limitUsage(50, 200)).toBe(25);
  });

  it("is undefined when the limit means unlimited", () => {
    expect(limitUsage(50, 0)).toBeUndefined();
    expect(limitUsage(50, -1)).toBeUndefined();
    expect(limitUsage(undefined, 100)).toBeUndefined();
  });
});

describe("serverFindings", () => {
  const subjects = (f: ReturnType<typeof serverFindings>) => f.map((x) => x.subject);

  it("reports slow consumers as bad, since those messages are gone", () => {
    const f = serverFindings({ slow_consumers: 4 }, null, null);
    expect(f[0].severity).toBe("bad");
    expect(f[0].message).toMatch(/gone, not queued/);
  });

  it("escalates connection usage towards the limit", () => {
    expect(serverFindings({ connections: 85, max_connections: 100 }, null, null)[0].severity).toBe("warn");
    expect(serverFindings({ connections: 96, max_connections: 100 }, null, null)[0].severity).toBe("bad");
    expect(serverFindings({ connections: 10, max_connections: 100 }, null, null)).toEqual([]);
  });

  it("says nothing when there is no connection limit", () => {
    expect(serverFindings({ connections: 5000, max_connections: 0 }, null, null)).toEqual([]);
  });

  it("flags a client with a backed-up pending queue", () => {
    const connz: Connz = { connections: [{ cid: 3, name: "slow-app", ip: "10.0.0.9", port: 5000, pending_bytes: 4 * 1024 * 1024 }] };
    const f = serverFindings(null, connz, null);
    expect(f[0].subject).toBe("connection 3");
    expect(f[0].message).toMatch(/4096 KB pending/);
  });

  it("flags JetStream memory and storage pressure", () => {
    const f = serverFindings(null, null, jsz);
    expect(subjects(f)).toContain("JetStream memory");
    // Storage is only 5% used, so it must not be reported.
    expect(subjects(f)).not.toContain("JetStream storage");
  });

  it("flags API errors", () => {
    expect(subjects(serverFindings(null, null, jsz))).toContain("JetStream API");
  });

  it("flags a stream near max_bytes and says what discard will do", () => {
    const f = serverFindings(null, null, jsz).find((x) => x.subject === "stream ORDERS" && /max_bytes/.test(x.message));
    expect(f?.severity).toBe("bad");
    expect(f?.message).toMatch(/reject new publishes/);
  });

  it("flags a replica that is not current as worse than one merely behind", () => {
    const all = serverFindings(null, null, jsz).filter((x) => /Replica/.test(x.message));
    expect(all.find((x) => /n3/.test(x.message))?.severity).toBe("bad");
    expect(all.find((x) => /n2/.test(x.message))?.severity).toBe("warn");
  });

  it("flags redeliveries and names ack_wait as a cause", () => {
    const f = serverFindings(null, null, jsz).find((x) => /redelivery/.test(x.message));
    expect(f?.message).toMatch(/ack_wait \(30\.0 s\)/);
  });

  it("flags a consumer stalled at max_ack_pending", () => {
    const f = serverFindings(null, null, jsz).find((x) => /max_ack_pending/.test(x.message));
    expect(f?.severity).toBe("bad");
    expect(f?.subject).toBe("consumer ORDERS/billing");
  });

  it("orders the worst findings first", () => {
    const severities = serverFindings({ slow_consumers: 1, connections: 85, max_connections: 100 }, null, jsz).map((f) => f.severity);
    expect(severities).toEqual([...severities].sort((a, b) => ["bad", "warn", "ok", "unknown"].indexOf(a) - ["bad", "warn", "ok", "unknown"].indexOf(b)));
  });

  it("finds nothing wrong with a healthy server", () => {
    expect(serverFindings({ connections: 2, max_connections: 1000, slow_consumers: 0 }, { connections: [] }, {})).toEqual([]);
  });
});

describe("subjectMatches", () => {
  it("matches an exact subject", () => {
    expect(subjectMatches("orders.new", "orders.new")).toBe(true);
    expect(subjectMatches("orders.new", "orders.old")).toBe(false);
  });

  it("matches * against exactly one token", () => {
    expect(subjectMatches("orders.*", "orders.new")).toBe(true);
    expect(subjectMatches("orders.*", "orders.new.eu")).toBe(false);
    expect(subjectMatches("orders.*", "orders")).toBe(false);
  });

  it("matches * in the middle", () => {
    expect(subjectMatches("orders.*.eu", "orders.new.eu")).toBe(true);
    expect(subjectMatches("orders.*.eu", "orders.new.us")).toBe(false);
  });

  it("matches > against one or more trailing tokens", () => {
    expect(subjectMatches("orders.>", "orders.new")).toBe(true);
    expect(subjectMatches("orders.>", "orders.new.eu.priority")).toBe(true);
    // `>` must cover something: it does not match the parent alone.
    expect(subjectMatches("orders.>", "orders")).toBe(false);
  });

  it("matches everything with a bare >", () => {
    expect(subjectMatches(">", "anything.at.all")).toBe(true);
    expect(subjectMatches(">", "a")).toBe(true);
  });

  it("does not match a longer subject without a wildcard", () => {
    expect(subjectMatches("orders", "orders.new")).toBe(false);
  });

  it("rejects empty inputs rather than matching them", () => {
    expect(subjectMatches("", "a")).toBe(false);
    expect(subjectMatches("a", "")).toBe(false);
  });

  it("is case sensitive, as NATS subjects are", () => {
    expect(subjectMatches("Orders.new", "orders.new")).toBe(false);
  });
});

describe("matchingFilters", () => {
  it("returns every filter that would capture the subject", () => {
    expect(matchingFilters(["orders.>", "orders.*", "billing.>"], "orders.new")).toEqual(["orders.>", "orders.*"]);
  });

  it("returns nothing when no filter matches", () => {
    expect(matchingFilters(["billing.>"], "orders.new")).toEqual([]);
  });
});

describe("publishSubjectProblem", () => {
  it("accepts a literal subject", () => {
    expect(publishSubjectProblem("orders.new")).toBeNull();
  });

  it("rejects an empty subject", () => {
    expect(publishSubjectProblem("  ")).toMatch(/required/);
  });

  it("rejects wildcards, which only make sense when subscribing", () => {
    expect(publishSubjectProblem("orders.*")).toMatch(/literal/);
    expect(publishSubjectProblem("orders.>")).toMatch(/literal/);
  });

  it("catches a doubled or trailing dot", () => {
    expect(publishSubjectProblem("orders..new")).toMatch(/Empty token/);
    expect(publishSubjectProblem("orders.")).toMatch(/Empty token/);
    expect(publishSubjectProblem(".orders")).toMatch(/Empty token/);
  });

  it("rejects whitespace, which the protocol cannot carry", () => {
    expect(publishSubjectProblem("orders new")).toMatch(/whitespace/);
  });
});

describe("monitorUrl", () => {
  it("defaults to the monitoring port on a bare host", () => {
    expect(monitorUrl("localhost", "/varz")).toBe("http://localhost:8222/varz");
  });

  it("keeps an explicit port", () => {
    expect(monitorUrl("10.0.0.4:9999", "/varz")).toBe("http://10.0.0.4:9999/varz");
  });

  it("keeps an explicit scheme", () => {
    expect(monitorUrl("https://nats.internal:8222", "/varz")).toBe("https://nats.internal:8222/varz");
  });

  it("adds the default port to a scheme with no port", () => {
    expect(monitorUrl("http://nats.internal", "/varz")).toBe("http://nats.internal:8222/varz");
  });

  it("strips a trailing slash so the path is not doubled", () => {
    expect(monitorUrl("http://localhost:8222/", "/varz")).toBe("http://localhost:8222/varz");
  });

  it("falls back to localhost when nothing is given", () => {
    expect(monitorUrl("", "/healthz")).toBe("http://localhost:8222/healthz");
  });
});

describe("formatting", () => {
  it("scales nanosecond durations", () => {
    expect(formatNanos(30_000_000_000)).toBe("30.0 s");
    expect(formatNanos(500_000_000)).toBe("500 ms");
    expect(formatNanos(0)).toBe("—");
    expect(formatNanos(undefined)).toBe("—");
  });

  it("scales bytes", () => {
    expect(formatBytes(2048)).toBe("2.00 KB");
    expect(formatBytes(undefined)).toBe("—");
  });
});

describe("portAdvice", () => {
  it("names 4222 as the client port and says monitoring is separate", () => {
    const advice = portAdvice("127.0.0.1:4222");
    expect(advice).toMatch(/4222 is the client protocol port/);
    expect(advice).toMatch(/speaks NATS, not HTTP/);
    // The trap worth closing: having JetStream on does not give you /jsz.
    expect(advice).toMatch(/JetStream being enabled does not enable it/);
  });

  it("names the cluster and leafnode ports too", () => {
    expect(portAdvice("host:6222")).toMatch(/cluster route port/);
    expect(portAdvice("host:7422")).toMatch(/leafnode port/);
  });

  it("says 8222 was assumed when no port was given", () => {
    expect(portAdvice("localhost")).toMatch(/8222 was assumed/);
  });

  it("gives generic advice for any other port", () => {
    const advice = portAdvice("localhost:9999");
    expect(advice).toMatch(/running on 9999/);
    expect(advice).not.toMatch(/client protocol/);
  });
});

describe("withMonitorPort", () => {
  it("swaps the port for the monitoring default", () => {
    expect(withMonitorPort("127.0.0.1:4222")).toBe("127.0.0.1:8222");
    expect(withMonitorPort("http://nats.internal:4222")).toBe("http://nats.internal:8222");
  });

  it("appends the port when there is none", () => {
    expect(withMonitorPort("localhost")).toBe("localhost:8222");
  });

  it("leaves an address already on 8222 unchanged, so no pointless retry is offered", () => {
    expect(withMonitorPort("localhost:8222")).toBe("localhost:8222");
  });

  it("strips a trailing slash first", () => {
    expect(withMonitorPort("http://localhost:4222/")).toBe("http://localhost:8222");
  });
});
