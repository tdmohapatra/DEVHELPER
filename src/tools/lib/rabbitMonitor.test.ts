import { describe, it, expect } from "vitest";
import {
  brokerFindings,
  deadLetterExchange,
  formatBytes,
  limitUsage,
  looksLikeDeadLetter,
  mgmtPortAdvice,
  mgmtUrl,
  decodePayload,
  peekBody,
  peekWarning,
  routingKeyProblem,
  sortQueuesByAttention,
  withMgmtPort,
  type Node,
  type Overview,
  type Queue,
} from "./rabbitMonitor";

const subjects = (fs: { subject: string }[]) => fs.map((f) => f.subject);
const messages = (fs: { message: string }[]) => fs.map((f) => f.message).join(" | ");

describe("limitUsage", () => {
  it("returns a percentage of a real limit", () => {
    expect(limitUsage(50, 200)).toBe(25);
  });

  it("treats an absent or zero limit as no limit rather than as 100%", () => {
    expect(limitUsage(50, 0)).toBeUndefined();
    expect(limitUsage(50, undefined)).toBeUndefined();
    expect(limitUsage(undefined, 200)).toBeUndefined();
  });
});

describe("formatBytes", () => {
  it("scales up through the units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.00 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.00 MB");
  });

  it("has no answer for an absent number", () => {
    expect(formatBytes(undefined)).toBe("—");
  });
});

describe("deadLetterExchange", () => {
  it("reads the declare-time argument", () => {
    expect(deadLetterExchange({ arguments: { "x-dead-letter-exchange": "dlx" } })).toBe("dlx");
  });

  it("ignores an empty or non-string value", () => {
    expect(deadLetterExchange({ arguments: { "x-dead-letter-exchange": "" } })).toBeUndefined();
    expect(deadLetterExchange({ arguments: { "x-dead-letter-exchange": 5 } })).toBeUndefined();
    expect(deadLetterExchange({})).toBeUndefined();
  });
});

describe("looksLikeDeadLetter", () => {
  it("recognises the usual naming conventions", () => {
    expect(looksLikeDeadLetter("orders.dlq")).toBe(true);
    expect(looksLikeDeadLetter("orders-dead-letter")).toBe(true);
    expect(looksLikeDeadLetter("payments_retry")).toBe(true);
    expect(looksLikeDeadLetter("ERROR.queue")).toBe(true);
  });

  it("does not match a word that merely contains one", () => {
    expect(looksLikeDeadLetter("orders")).toBe(false);
    expect(looksLikeDeadLetter("dlqueue")).toBe(false);
    expect(looksLikeDeadLetter(undefined)).toBe(false);
  });
});

describe("brokerFindings — nodes", () => {
  it("flags a memory alarm as blocking publishers, not merely as high memory", () => {
    const nodes: Node[] = [{ name: "rabbit@host", mem_alarm: true, mem_used: 900, mem_limit: 1000 }];
    const found = brokerFindings(null, [], nodes);
    expect(found[0].severity).toBe("bad");
    expect(messages(found)).toMatch(/blocked/i);
  });

  it("warns on memory pressure before the alarm fires, and not twice once it has", () => {
    const under = brokerFindings(null, [], [{ name: "n", mem_used: 850, mem_limit: 1000 }]);
    expect(under).toHaveLength(1);
    expect(under[0].severity).toBe("warn");

    const alarmed = brokerFindings(null, [], [{ name: "n", mem_alarm: true, mem_used: 850, mem_limit: 1000 }]);
    expect(alarmed).toHaveLength(1);
    expect(alarmed[0].severity).toBe("bad");
  });

  it("flags file-descriptor exhaustion", () => {
    const found = brokerFindings(null, [], [{ name: "n", fd_used: 950, fd_total: 1000 }]);
    expect(found[0].severity).toBe("bad");
    expect(messages(found)).toMatch(/file descriptors/i);
  });

  it("says a stopped node is unavailable rather than empty", () => {
    const found = brokerFindings(null, [], [{ name: "n", running: false }]);
    expect(messages(found)).toMatch(/not running/i);
  });

  it("reports nothing about a healthy node", () => {
    expect(brokerFindings(null, [], [{ name: "n", running: true, mem_used: 10, mem_limit: 1000, fd_used: 5, fd_total: 1000 }])).toEqual([]);
  });
});

describe("brokerFindings — queues", () => {
  it("flags a backlog with no consumer, and escalates once it is large", () => {
    const small = brokerFindings(null, [{ name: "orders", messages: 5, consumers: 0 }], []);
    expect(small[0].severity).toBe("warn");

    const large = brokerFindings(null, [{ name: "orders", messages: 5000, consumers: 0 }], []);
    expect(large[0].severity).toBe("bad");
    expect(messages(large)).toMatch(/no consumer/i);
  });

  it("flags a queue whose messages are all delivered but unacknowledged", () => {
    const found = brokerFindings(null, [{ name: "orders", messages: 12, messages_unacknowledged: 12, consumers: 1 }], []);
    expect(messages(found)).toMatch(/unacknowledged/i);
  });

  it("does not call it stuck when only some messages are unacked", () => {
    const found = brokerFindings(null, [{ name: "orders", messages: 12, messages_unacknowledged: 3, consumers: 1 }], []);
    expect(found).toEqual([]);
  });

  it("flags flow control as the broker throttling publishers", () => {
    const found = brokerFindings(null, [{ name: "orders", state: "flow" }], []);
    expect(messages(found)).toMatch(/flow control/i);
  });

  it("flags a redelivery rate as a loop when there is no dead-letter exchange", () => {
    const found = brokerFindings(
      null,
      [{ name: "orders", consumers: 1, message_stats: { redeliver_details: { rate: 4.2 } } }],
      [],
    );
    expect(messages(found)).toMatch(/redeliver/i);
  });

  it("flags a dead-letter queue that is filling up", () => {
    const found = brokerFindings(null, [{ name: "orders.dlq", messages: 500, consumers: 0 }], []);
    // Both "no consumer" and "dead letters piling" apply; the DLQ one must be there.
    expect(messages(found)).toMatch(/already failed once/i);
  });

  it("flags a limited queue with nowhere to dead-letter to", () => {
    const found = brokerFindings(null, [{ name: "orders", messages: 5, consumers: 1, arguments: { "x-max-length": 100 } }], []);
    expect(messages(found)).toMatch(/x-dead-letter-exchange/);
  });

  it("stays quiet when the limited queue does have a dead-letter exchange", () => {
    const found = brokerFindings(
      null,
      [{ name: "orders", messages: 5, consumers: 1, arguments: { "x-max-length": 100, "x-dead-letter-exchange": "dlx" } }],
      [],
    );
    expect(found).toEqual([]);
  });

  it("names the vhost when it is not the default", () => {
    const found = brokerFindings(null, [{ name: "orders", vhost: "billing", messages: 5, consumers: 0 }], []);
    expect(subjects(found)[0]).toBe("orders @billing");
  });
});

describe("brokerFindings — routing", () => {
  it("flags unroutable publishes, which clients do not see", () => {
    const overview: Overview = { message_stats: { return_unroutable_details: { rate: 2 } } };
    const found = brokerFindings(overview, [], []);
    expect(messages(found)).toMatch(/unroutable/i);
  });

  it("sorts the worst finding first", () => {
    const found = brokerFindings(
      { message_stats: { return_unroutable_details: { rate: 1 } } },
      [{ name: "orders", messages: 5000, consumers: 0 }],
      [],
    );
    expect(found[0].severity).toBe("bad");
  });
});

describe("mgmtUrl", () => {
  it("assumes the management port for a bare host", () => {
    expect(mgmtUrl("localhost", "/overview")).toBe("http://localhost:15672/api/overview");
  });

  it("keeps an explicit port and scheme", () => {
    expect(mgmtUrl("https://broker:15671", "/queues")).toBe("https://broker:15671/api/queues");
  });

  it("tolerates a trailing slash", () => {
    expect(mgmtUrl("localhost:15672/", "/nodes")).toBe("http://localhost:15672/api/nodes");
  });

  it("falls back to localhost when nothing was typed", () => {
    expect(mgmtUrl("  ", "/overview")).toBe("http://localhost:15672/api/overview");
  });
});

describe("mgmtPortAdvice", () => {
  it("names the AMQP port as the wrong one and says why", () => {
    const advice = mgmtPortAdvice("localhost:5672");
    expect(advice).toMatch(/AMQP/);
    expect(advice).toMatch(/rabbitmq_management/);
  });

  it("mentions the assumed default when no port was given", () => {
    expect(mgmtPortAdvice("localhost")).toMatch(/15672/);
  });

  it("still points at the plugin for an unrecognised port", () => {
    expect(mgmtPortAdvice("localhost:9999")).toMatch(/rabbitmq_management/);
  });
});

describe("withMgmtPort", () => {
  it("swaps a wrong port for the management default", () => {
    expect(withMgmtPort("localhost:5672")).toBe("localhost:15672");
  });

  it("appends the port when there is none", () => {
    expect(withMgmtPort("localhost")).toBe("localhost:15672");
  });
});

describe("routingKeyProblem", () => {
  it("requires a key", () => {
    expect(routingKeyProblem("", "direct")).toMatch(/required/);
  });

  it("rejects whitespace", () => {
    expect(routingKeyProblem("a b", "direct")).toMatch(/whitespace/);
  });

  it("rejects wildcards outside a topic exchange", () => {
    expect(routingKeyProblem("orders.*", "direct")).toMatch(/topic exchange/);
  });

  it("allows wildcards on a topic exchange", () => {
    expect(routingKeyProblem("orders.*", "topic")).toBeNull();
  });

  it("accepts an ordinary key", () => {
    expect(routingKeyProblem("orders.created", "direct")).toBeNull();
  });
});

describe("peekBody", () => {
  it("asks for the requested count and mode", () => {
    const body = JSON.parse(peekBody(5, "reject_requeue_true"));
    expect(body).toMatchObject({ count: 5, ackmode: "reject_requeue_true", encoding: "auto" });
  });

  it("clamps the count, so a typo cannot pull a whole queue into the UI", () => {
    expect(JSON.parse(peekBody(9999, "reject_requeue_true")).count).toBe(50);
    expect(JSON.parse(peekBody(0, "reject_requeue_true")).count).toBe(1);
  });

  it("truncates long payloads server-side", () => {
    expect(JSON.parse(peekBody(1, "reject_requeue_true")).truncate).toBe(50000);
  });
});

describe("peekWarning", () => {
  it("says requeueing puts messages back, and warns about redelivery", () => {
    expect(peekWarning("reject_requeue_true")).toMatch(/put back/);
    expect(peekWarning("reject_requeue_true")).toMatch(/redelivered/);
  });

  it("says the other mode is permanent, in those words", () => {
    expect(peekWarning("ack_requeue_false")).toMatch(/removed permanently/);
    expect(peekWarning("ack_requeue_false")).toMatch(/no undo/i);
  });
});

describe("decodePayload", () => {
  it("passes text through untouched", () => {
    expect(decodePayload({ payload: '{"a":1}', payload_encoding: "string" })).toEqual({ text: '{"a":1}', binary: false });
  });

  it("decodes base64 but still flags it as not sent as text", () => {
    // Rendering base64 as text is how a protobuf body looks like corruption.
    const encoded = btoa("hello");
    expect(decodePayload({ payload: encoded, payload_encoding: "base64" })).toEqual({ text: "hello", binary: true });
  });

  it("describes a payload it cannot decode rather than showing nothing", () => {
    const out = decodePayload({ payload: "!!!not base64!!!", payload_encoding: "base64", payload_bytes: 12 });
    expect(out.binary).toBe(true);
    expect(out.text).toMatch(/12 bytes/);
  });

  it("copes with a message that has no payload", () => {
    expect(decodePayload({})).toEqual({ text: "", binary: false });
  });
});

describe("sortQueuesByAttention", () => {
  it("puts an unconsumed backlog above a larger but consumed one", () => {
    const queues: Queue[] = [
      { name: "busy", messages: 900, consumers: 3 },
      { name: "orphan", messages: 4, consumers: 0 },
    ];
    expect(sortQueuesByAttention(queues).map((q) => q.name)).toEqual(["orphan", "busy"]);
  });

  it("orders by depth within the same class", () => {
    const queues: Queue[] = [
      { name: "a", messages: 1, consumers: 1 },
      { name: "b", messages: 50, consumers: 1 },
    ];
    expect(sortQueuesByAttention(queues).map((q) => q.name)).toEqual(["b", "a"]);
  });

  it("does not mutate the input", () => {
    const queues: Queue[] = [{ name: "a", messages: 1 }, { name: "b", messages: 9 }];
    sortQueuesByAttention(queues);
    expect(queues.map((q) => q.name)).toEqual(["a", "b"]);
  });
});
