import { describe, expect, it } from "vitest";
import {
  API_VERSION,
  ConnectionStringError,
  deadLetterExplanation,
  displayName,
  endpointWarning,
  entityFindings,
  entityPath,
  formatBytes,
  isUnlimitedDuration,
  managementUrl,
  namespaceSummary,
  parseConnectionString,
  parseDuration,
  parseFeed,
  parsePeekResponse,
  peekLockUrl,
  peekPlan,
  queuesUrl,
  requestAdvice,
  runtimePath,
  sasHeader,
  sasStringToSign,
  sasToken,
  sendUrl,
  sortByAttention,
  subscriptionsUrl,
  topicsUrl,
  totalMessages,
  type EntityDescription,
} from "./serviceBus";

const CONN = "Endpoint=sb://labs.servicebus.windows.net/;SharedAccessKeyName=RootManageSharedAccessKey;SharedAccessKey=abc+def/ghi=";

describe("parseConnectionString", () => {
  it("reads a namespace-level string", () => {
    const conn = parseConnectionString(CONN);
    expect(conn.endpoint).toBe("https://labs.servicebus.windows.net");
    expect(conn.host).toBe("labs.servicebus.windows.net");
    expect(conn.namespace).toBe("labs");
    expect(conn.keyName).toBe("RootManageSharedAccessKey");
    expect(conn.entityPath).toBeUndefined();
  });

  it("keeps a base64 key whole even though it contains '='", () => {
    expect(parseConnectionString(CONN).key).toBe("abc+def/ghi=");
  });

  it("reads an entity-scoped string", () => {
    const conn = parseConnectionString(`${CONN};EntityPath=orders`);
    expect(conn.entityPath).toBe("orders");
  });

  it("tolerates whitespace and line breaks from a copy/paste", () => {
    const conn = parseConnectionString(`\n  Endpoint=sb://labs.servicebus.windows.net/; \n SharedAccessKeyName=Reader ;SharedAccessKey=k \n`);
    expect(conn.keyName).toBe("Reader");
    expect(conn.key).toBe("k");
  });

  it("accepts an https endpoint as well as sb://", () => {
    expect(parseConnectionString("Endpoint=https://labs.servicebus.windows.net/;SharedAccessKeyName=a;SharedAccessKey=b").endpoint).toBe(
      "https://labs.servicebus.windows.net",
    );
  });

  it("rejects a pre-signed SAS string by name", () => {
    expect(() =>
      parseConnectionString("Endpoint=sb://labs.servicebus.windows.net/;SharedAccessSignature=SharedAccessSignature sr=x&sig=y&se=1&skn=z"),
    ).toThrow(/already-signed/i);
  });

  it("names the missing part", () => {
    expect(() => parseConnectionString("SharedAccessKeyName=a;SharedAccessKey=b")).toThrow(/Endpoint=/);
    expect(() => parseConnectionString("Endpoint=sb://labs.servicebus.windows.net/;SharedAccessKey=b")).toThrow(/SharedAccessKeyName=/);
    expect(() => parseConnectionString("Endpoint=sb://labs.servicebus.windows.net/;SharedAccessKeyName=a")).toThrow(/SharedAccessKey=/);
    expect(() => parseConnectionString("   ")).toThrow(ConnectionStringError);
  });
});

describe("endpointWarning", () => {
  it("is silent for a real namespace, in any cloud", () => {
    expect(endpointWarning("labs.servicebus.windows.net")).toBeNull();
    expect(endpointWarning("labs.servicebus.usgovcloudapi.net")).toBeNull();
  });

  it("calls out an IoT Hub string", () => {
    expect(endpointWarning("plant.azure-devices.net")).toMatch(/IoT Hub/);
  });

  it("warns that an Event Hubs style host will list nothing", () => {
    expect(endpointWarning("labs.eventhub.example.com")).toMatch(/list no queues/);
  });
});

describe("SAS tokens", () => {
  it("signs the encoded resource and the expiry, newline separated", () => {
    expect(sasStringToSign("https://labs.servicebus.windows.net", 1700000000)).toBe("https%3A%2F%2Flabs.servicebus.windows.net\n1700000000");
  });

  it("escapes the characters encodeURIComponent leaves alone", () => {
    expect(sasStringToSign("https://labs.servicebus.windows.net/a'b(c)", 1)).toContain("a%27b%28c%29");
  });

  it("assembles the four token fields", () => {
    const header = sasHeader("https://labs.servicebus.windows.net", "sig+with/chars=", 1700000000, "Root Policy");
    expect(header.startsWith("SharedAccessSignature ")).toBe(true);
    expect(header).toContain("sr=https%3A%2F%2Flabs.servicebus.windows.net");
    expect(header).toContain("sig=sig%2Bwith%2Fchars%3D");
    expect(header).toContain("se=1700000000");
    expect(header).toContain("skn=Root%20Policy");
  });

  it("computes a stable signature and a clock-derived expiry", async () => {
    const conn = { endpoint: "https://labs.servicebus.windows.net", keyName: "Root", key: "secret" };
    const token = await sasToken(conn, 3600, 1_700_000_000_000);
    expect(token).toContain("se=1700003600");
    // Same inputs must sign the same, or a cached token would stop matching.
    expect(await sasToken(conn, 3600, 1_700_000_000_000)).toBe(token);
    expect(await sasToken(conn, 3600, 1_700_000_060_000)).not.toBe(token);
  });

  it("refuses a TTL so short the token expires before it is used", async () => {
    const conn = { endpoint: "https://labs.servicebus.windows.net", keyName: "Root", key: "secret" };
    expect(await sasToken(conn, 1, 1_700_000_000_000)).toContain("se=1700000060");
  });
});

describe("urls", () => {
  const conn = { endpoint: "https://labs.servicebus.windows.net" };

  it("appends the api-version to a management path", () => {
    expect(queuesUrl(conn)).toBe(`https://labs.servicebus.windows.net/$Resources/Queues?api-version=${API_VERSION}`);
    expect(topicsUrl(conn)).toContain("$Resources/Topics");
  });

  it("keeps an existing query string intact", () => {
    expect(managementUrl(conn, "$Resources/Queues?$skip=100")).toBe(
      `https://labs.servicebus.windows.net/$Resources/Queues?$skip=100&api-version=${API_VERSION}`,
    );
  });

  it("encodes a topic name in the subscriptions path", () => {
    expect(subscriptionsUrl(conn, "order events")).toContain("/order%20events/Subscriptions");
  });

  it("hangs the dead-letter sub-queue off a subscription, not its topic", () => {
    expect(entityPath("orders/Subscriptions/billing", true)).toBe("orders/Subscriptions/billing/$deadletterqueue");
  });

  it("builds a peek-lock url with a bounded timeout", () => {
    expect(peekLockUrl(conn, "orders")).toBe("https://labs.servicebus.windows.net/orders/messages/head?timeout=5");
    expect(peekLockUrl(conn, "orders", true, 900)).toContain("$deadletterqueue/messages/head?timeout=55");
  });

  it("sends to the entity's messages collection", () => {
    expect(sendUrl(conn, "orders")).toBe("https://labs.servicebus.windows.net/orders/messages");
  });
});

describe("parseDuration", () => {
  it("reads the shapes Service Bus emits", () => {
    expect(parseDuration("PT30S")).toBe(30);
    expect(parseDuration("PT1M")).toBe(60);
    expect(parseDuration("PT5M")).toBe(300);
    expect(parseDuration("P14D")).toBe(1209600);
    expect(parseDuration("PT1H30M")).toBe(5400);
  });

  it("treats TimeSpan.MaxValue as unlimited rather than a real number of days", () => {
    const seconds = parseDuration("P10675199DT2H48M5.4775807S");
    expect(seconds).toBeGreaterThan(0);
    expect(isUnlimitedDuration(seconds)).toBe(true);
    expect(isUnlimitedDuration(1209600)).toBe(false);
  });

  it("returns undefined for nothing and for nonsense", () => {
    expect(parseDuration(undefined)).toBeUndefined();
    expect(parseDuration("")).toBeUndefined();
    expect(parseDuration("14 days")).toBeUndefined();
  });
});

const QUEUE_FEED = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title type="text">Queues</title>
  <entry>
    <title type="text">orders</title>
    <content type="application/xml">
      <QueueDescription xmlns="http://schemas.microsoft.com/netservices/2010/10/servicebus/connect" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
        <LockDuration>PT1M</LockDuration>
        <MaxSizeInMegabytes>1024</MaxSizeInMegabytes>
        <RequiresDuplicateDetection>false</RequiresDuplicateDetection>
        <RequiresSession>false</RequiresSession>
        <DefaultMessageTimeToLive>P14D</DefaultMessageTimeToLive>
        <DeadLetteringOnMessageExpiration>true</DeadLetteringOnMessageExpiration>
        <MaxDeliveryCount>10</MaxDeliveryCount>
        <SizeInBytes>2048</SizeInBytes>
        <MessageCount>7</MessageCount>
        <Status>Active</Status>
        <AutoDeleteOnIdle>P10675199DT2H48M5.4775807S</AutoDeleteOnIdle>
        <EnablePartitioning>false</EnablePartitioning>
        <CountDetails xmlns:d2p1="http://schemas.microsoft.com/netservices/2011/06/servicebus">
          <d2p1:ActiveMessageCount>4</d2p1:ActiveMessageCount>
          <d2p1:DeadLetterMessageCount>3</d2p1:DeadLetterMessageCount>
          <d2p1:ScheduledMessageCount>0</d2p1:ScheduledMessageCount>
          <d2p1:TransferMessageCount>0</d2p1:TransferMessageCount>
          <d2p1:TransferDeadLetterMessageCount>0</d2p1:TransferDeadLetterMessageCount>
        </CountDetails>
      </QueueDescription>
    </content>
  </entry>
</feed>`;

describe("parseFeed", () => {
  it("reads a queue description out of the Atom entry", () => {
    const [q] = parseFeed(QUEUE_FEED, "queue");
    expect(q.name).toBe("orders");
    expect(q.kind).toBe("queue");
    expect(q.status).toBe("Active");
    expect(q.maxSizeMb).toBe(1024);
    expect(q.sizeBytes).toBe(2048);
    expect(q.maxDeliveryCount).toBe(10);
    expect(q.lockDurationSeconds).toBe(60);
    expect(q.defaultTtlSeconds).toBe(1209600);
    expect(q.requiresSession).toBe(false);
    expect(q.deadLetterOnExpiration).toBe(true);
  });

  it("reads CountDetails through its namespace prefix", () => {
    const [q] = parseFeed(QUEUE_FEED, "queue");
    expect(q.counts).toEqual({ active: 4, deadLetter: 3, scheduled: 0, transfer: 0, transferDeadLetter: 0 });
    expect(totalMessages(q.counts)).toBe(7);
  });

  it("defaults every count to zero when the block is absent", () => {
    const feed = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>bare</title></entry></feed>`;
    const [q] = parseFeed(feed, "queue");
    expect(q.counts).toEqual({ active: 0, deadLetter: 0, scheduled: 0, transfer: 0, transferDeadLetter: 0 });
    expect(q.maxSizeMb).toBeUndefined();
  });

  it("attaches the topic to a subscription, which the feed does not repeat", () => {
    const feed = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>billing</title></entry></feed>`;
    const [s] = parseFeed(feed, "subscription", "orders");
    expect(displayName(s)).toBe("orders/billing");
    expect(runtimePath(s)).toBe("orders/Subscriptions/billing");
    expect(runtimePath({ name: "orders", kind: "queue" })).toBe("orders");
  });

  it("returns nothing for an empty feed, and for a body that is not XML at all", () => {
    expect(parseFeed(`<feed xmlns="http://www.w3.org/2005/Atom"><title>Queues</title></feed>`, "queue")).toEqual([]);
    expect(parseFeed("<html><body>401 Unauthorized", "queue")).toEqual([]);
  });
});

function entity(over: Partial<EntityDescription> = {}): EntityDescription {
  return {
    name: "orders",
    kind: "queue",
    status: "Active",
    counts: { active: 0, deadLetter: 0, scheduled: 0, transfer: 0, transferDeadLetter: 0 },
    ...over,
  };
}

describe("entityFindings", () => {
  const subjects = (f: { subject: string; message: string }[]) => f.map((x) => x.message).join(" | ");

  it("is silent about a healthy queue", () => {
    expect(entityFindings([entity({ counts: { active: 3, deadLetter: 0, scheduled: 0, transfer: 0, transferDeadLetter: 0 } })])).toEqual([]);
  });

  it("escalates a dead-letter backlog with its size", () => {
    const few = entityFindings([entity({ counts: { active: 0, deadLetter: 5, scheduled: 0, transfer: 0, transferDeadLetter: 0 } })]);
    const many = entityFindings([entity({ counts: { active: 0, deadLetter: 500, scheduled: 0, transfer: 0, transferDeadLetter: 0 } })]);
    expect(few[0].severity).toBe("warn");
    expect(many[0].severity).toBe("bad");
    expect(subjects(many)).toMatch(/size quota/);
  });

  it("treats a transfer dead-letter as bad and says where the messages are not", () => {
    const f = entityFindings([entity({ counts: { active: 0, deadLetter: 0, scheduled: 0, transfer: 0, transferDeadLetter: 2 } })]);
    expect(f[0].severity).toBe("bad");
    expect(f[0].message).toMatch(/not in the destination/);
  });

  it("explains ReceiveDisabled as the state that looks like a stuck consumer", () => {
    const f = entityFindings([entity({ status: "ReceiveDisabled" })]);
    expect(f[0].severity).toBe("bad");
    expect(f[0].message).toMatch(/stuck consumer/);
  });

  it("warns on the size quota before sends start failing", () => {
    const near = entityFindings([entity({ maxSizeMb: 1024, sizeBytes: 0.8 * 1024 * 1024 * 1024 })]);
    const full = entityFindings([entity({ maxSizeMb: 1024, sizeBytes: 0.95 * 1024 * 1024 * 1024 })]);
    expect(near[0].severity).toBe("warn");
    expect(full[0].severity).toBe("bad");
    expect(full[0].message).toMatch(/QuotaExceededException/);
    expect(entityFindings([entity({ maxSizeMb: 1024, sizeBytes: 1024 })])).toEqual([]);
  });

  it("does not divide by a missing quota", () => {
    expect(entityFindings([entity({ maxSizeMb: 0, sizeBytes: 5000 })])).toEqual([]);
    expect(entityFindings([entity({ sizeBytes: 5000 })])).toEqual([]);
  });

  it("flags a lock too short for a slow handler, and a delivery count with no retry", () => {
    expect(subjects(entityFindings([entity({ lockDurationSeconds: 15 })]))).toMatch(/MessageLockLostException/);
    expect(entityFindings([entity({ lockDurationSeconds: 60 })])).toEqual([]);
    expect(subjects(entityFindings([entity({ maxDeliveryCount: 1 })]))).toMatch(/no retry at all/);
  });

  it("says why a session queue looks empty to a plain receiver", () => {
    const f = entityFindings([entity({ requiresSession: true, counts: { active: 9, deadLetter: 0, scheduled: 0, transfer: 0, transferDeadLetter: 0 } })]);
    expect(f[0].message).toMatch(/session receiver/);
  });

  it("points at the destination when the entity auto-forwards", () => {
    expect(subjects(entityFindings([entity({ forwardTo: "https://labs.servicebus.windows.net/audit" })]))).toMatch(/audit/);
  });

  it("warns about silent expiry only when dead-lettering is off", () => {
    expect(subjects(entityFindings([entity({ defaultTtlSeconds: 600, deadLetterOnExpiration: false })]))).toMatch(/no record of it/);
    expect(entityFindings([entity({ defaultTtlSeconds: 600, deadLetterOnExpiration: true })])).toEqual([]);
  });

  it("does not read TimeSpan.MaxValue as a short TTL or a near auto-delete", () => {
    const forever = parseDuration("P10675199DT2H48M5.4775807S");
    expect(entityFindings([entity({ defaultTtlSeconds: forever, autoDeleteOnIdleSeconds: forever, deadLetterOnExpiration: false })])).toEqual([]);
  });

  it("calls a topic with no subscriptions a shredder", () => {
    expect(subjects(entityFindings([entity({ kind: "topic", subscriptionCount: 0 })]))).toMatch(/shredder/);
    expect(entityFindings([entity({ kind: "topic", subscriptionCount: 2 })])).toEqual([]);
  });

  it("puts the worst finding first", () => {
    const findings = entityFindings([
      entity({ name: "a", counts: { active: 0, deadLetter: 0, scheduled: 4, transfer: 0, transferDeadLetter: 0 } }),
      entity({ name: "b", counts: { active: 0, deadLetter: 300, scheduled: 0, transfer: 0, transferDeadLetter: 0 } }),
    ]);
    expect(findings[0].severity).toBe("bad");
    expect(findings[findings.length - 1].severity).toBe("unknown");
  });
});

describe("sortByAttention", () => {
  it("puts dead letters first, then depth, then name", () => {
    const list = [
      entity({ name: "quiet" }),
      entity({ name: "busy", counts: { active: 900, deadLetter: 0, scheduled: 0, transfer: 0, transferDeadLetter: 0 } }),
      entity({ name: "broken", counts: { active: 1, deadLetter: 2, scheduled: 0, transfer: 0, transferDeadLetter: 0 } }),
    ];
    expect(sortByAttention(list).map((e) => e.name)).toEqual(["broken", "busy", "quiet"]);
  });

  it("does not mutate its input", () => {
    const list = [entity({ name: "b" }), entity({ name: "a" })];
    sortByAttention(list);
    expect(list.map((e) => e.name)).toEqual(["b", "a"]);
  });
});

describe("parsePeekResponse", () => {
  it("reads BrokerProperties out of the header and keeps the body", () => {
    const msg = parsePeekResponse(
      {
        BrokerProperties: '{"MessageId":"m-1","DeliveryCount":3,"SequenceNumber":42,"EnqueuedTimeUtc":"Mon, 01 Jan 2026 10:00:00 GMT"}',
        Location: "https://labs.servicebus.windows.net/orders/messages/42/lock-token",
        "Content-Type": "application/json",
      },
      '{"orderId":7}',
    );
    expect(msg.properties.MessageId).toBe("m-1");
    expect(msg.properties.DeliveryCount).toBe(3);
    expect(msg.body).toBe('{"orderId":7}');
    expect(msg.lockUri).toContain("/lock-token");
  });

  it("keeps the body when the properties header is malformed", () => {
    const msg = parsePeekResponse({ BrokerProperties: "{not json" }, "payload");
    expect(msg.properties).toEqual({});
    expect(msg.body).toBe("payload");
  });

  it("separates the application's own properties from the broker's headers", () => {
    const msg = parsePeekResponse(
      { BrokerProperties: "{}", "Content-Type": "text/plain", "x-ms-request-id": "abc", tenant: '"acme"', attempt: "2" },
      "",
    );
    expect(msg.custom).toEqual({ tenant: "acme", attempt: "2" });
  });
});

describe("deadLetterExplanation", () => {
  it("says where the real exception is for the common reason", () => {
    const text = deadLetterExplanation({ DeadLetterReason: "MaxDeliveryCountExceeded" });
    expect(text).toMatch(/consumer's own logs/);
  });

  it("appends the broker's description when there is one", () => {
    expect(deadLetterExplanation({ DeadLetterReason: "TTLExpiredException", DeadLetterErrorDescription: "expired" })).toMatch(/expired$/);
  });

  it("passes an unknown reason through rather than swallowing it", () => {
    expect(deadLetterExplanation({ DeadLetterReason: "SomethingNew" })).toMatch(/^SomethingNew:/);
    expect(deadLetterExplanation({})).toBeNull();
  });
});

describe("peekPlan", () => {
  it("bounds the number of simultaneous locks and explains why they are held", () => {
    expect(peekPlan(10).locks).toBe(10);
    expect(peekPlan(0).locks).toBe(1);
    expect(peekPlan(5000).locks).toBe(50);
    expect(peekPlan(3).note).toMatch(/head only advances/);
  });
});

describe("requestAdvice", () => {
  it("gives 401 all three of its causes, including the clock", () => {
    const text = requestAdvice(401);
    expect(text).toMatch(/clock/);
    expect(text).toMatch(/Listen/);
  });

  it("names the entity in a 404 when there is one", () => {
    expect(requestAdvice(404, "orders")).toContain("orders");
    expect(requestAdvice(404)).toMatch(/namespace-level connection string/);
  });

  it("has something for the throttling and forbidden cases", () => {
    expect(requestAdvice(429)).toMatch(/throttled/i);
    expect(requestAdvice(403)).toMatch(/IP filter|private endpoint/);
    expect(requestAdvice(418)).toContain("418");
  });
});

describe("formatBytes and namespaceSummary", () => {
  it("scales bytes", () => {
    expect(formatBytes(undefined)).toBe("—");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.00 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.00 MB");
  });

  it("counts the namespace in one line, mentioning dead letters only when there are some", () => {
    const clean = namespaceSummary([entity({ counts: { active: 2, deadLetter: 0, scheduled: 0, transfer: 0, transferDeadLetter: 0 } })]);
    expect(clean).toBe("1 queue, 0 topics, 0 subscriptions, 2 active");
    const dirty = namespaceSummary([
      entity({ kind: "topic" }),
      entity({ kind: "subscription", topic: "t", counts: { active: 1, deadLetter: 4, scheduled: 0, transfer: 0, transferDeadLetter: 0 } }),
    ]);
    expect(dirty).toMatch(/4 dead-lettered$/);
  });
});
