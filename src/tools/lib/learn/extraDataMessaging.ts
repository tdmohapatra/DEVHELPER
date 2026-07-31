import type { Question } from "./types";

/** Second batch: databases, and a deeper set on messaging and queues. */
export const DATABASE_EXTRA: Question[] = [
  {
    id: "db2-clustered-choice",
    topic: "database",
    subtopic: "Indexing",
    level: "advanced",
    question: "What makes a good clustered index key?",
    answer: `The clustered index **is** the table, and its key is copied into every non-clustered index. So the key should be:

- **Narrow** — every extra byte multiplies across all indexes.
- **Unique** — otherwise the engine adds a hidden uniquifier.
- **Static** — updating it physically moves the row.
- **Ever-increasing** — appends at the end instead of splitting pages in the middle.

That is why an \`int\`/\`bigint\` identity is the usual choice, and why a random \`GUID\` is the classic mistake: random inserts cause page splits and fragmentation. \`NEWSEQUENTIALID()\` or a sortable ULID fixes the ordering while keeping a GUID's other properties.`,
    followUps: [
      {
        question: "Is a GUID primary key always wrong?",
        answer: "No — it is right when ids must be generated client-side or merged across systems. Make it sequential, or keep the GUID as a unique non-clustered key and cluster on an identity column.",
      },
    ],
    tags: ["clustered index", "guid", "page split", "fragmentation"],
  },
  {
    id: "db2-temp-table-cte",
    topic: "database",
    subtopic: "SQL",
    level: "intermediate",
    question: "Temp table, table variable, or CTE?",
    answer: `- **CTE** — syntax only. It is inlined into the query, not materialised, so referencing it twice may execute it twice. Use for readability and recursion.
- **Table variable (\`@t\`)** — in memory (mostly), no statistics before SQL Server 2019, so the optimiser assumes one row and can pick a terrible plan for large sets. Fine for small lookups.
- **Temp table (\`#t\`)** — real table in tempdb, with statistics and indexes. Best for large intermediate sets, and it lets you break a monstrous query into steps the optimiser handles well.

The practical rule: small and simple → table variable; large or reused → temp table; readability or recursion → CTE.`,
    tags: ["temp table", "table variable", "cte", "tempdb", "statistics"],
  },
  {
    id: "db2-nolock",
    topic: "database",
    subtopic: "Transactions",
    level: "intermediate",
    question: "Is `WITH (NOLOCK)` a good way to avoid blocking?",
    answer: `No, and this is a common trap question.

\`NOLOCK\` is Read Uncommitted. It permits:

- **Dirty reads** — data from a transaction that later rolls back.
- **Missing or duplicated rows** — if a page split occurs mid-scan, a row can be skipped or read twice, even for rows nobody is modifying.

The real fixes are **READ_COMMITTED_SNAPSHOT** (readers see a consistent version and never block), tuning the query so it stops scanning, or reporting from a replica.

Acceptable use: a rough count for a dashboard where a wrong number is harmless — and say that explicitly.`,
    language: "sql",
    code: `-- Turn on row versioning: readers stop blocking writers, without dirty reads
ALTER DATABASE [App] SET READ_COMMITTED_SNAPSHOT ON WITH ROLLBACK IMMEDIATE;

-- Requires tempdb space for the version store; monitor it`,
    tags: ["nolock", "read uncommitted", "rcsi", "blocking", "dirty read"],
  },
  {
    id: "db2-bulk-insert",
    topic: "database",
    subtopic: "Operations",
    level: "intermediate",
    question: "What is the fastest way to insert a million rows from .NET?",
    answer: `Not \`SaveChanges\` in a loop — that is one round trip per row.

In order of speed:

1. **\`SqlBulkCopy\`** — the bulk load API; hundreds of thousands of rows per second. Set \`BatchSize\`, and consider dropping/disabling non-clustered indexes and re-creating them after.
2. **Table-valued parameter** into a stored procedure — one round trip, and it can MERGE.
3. **EF Core \`AddRange\` + one \`SaveChanges\`** — batches statements, far better than per-row, still much slower than bulk copy.
4. **Per-row \`SaveChanges\`** — the anti-pattern.

Also: batch inside a transaction of sensible size, or the log grows unbounded and a failure rolls back everything.`,
    language: "csharp",
    code: `using var bulk = new SqlBulkCopy(connection)
{
    DestinationTableName = "dbo.Readings",
    BatchSize = 10_000,
    BulkCopyTimeout = 0
};
bulk.ColumnMappings.Add(nameof(Reading.DeviceId), "DeviceId");
bulk.ColumnMappings.Add(nameof(Reading.Value), "Value");
await bulk.WriteToServerAsync(readings.AsDataReader());`,
    tags: ["bulk insert", "sqlbulkcopy", "tvp", "ef core", "performance"],
  },
  {
    id: "db2-soft-delete",
    topic: "database",
    subtopic: "Modelling",
    level: "intermediate",
    question: "What are the trade-offs of soft delete?",
    answer: `Soft delete (\`IsDeleted\` flag) keeps history and makes "undo" possible, but it leaks into everything:

- **Every query must filter** — one forgotten \`WHERE IsDeleted = 0\` shows deleted data.
- **Unique constraints break** — a deleted row still occupies the unique email. Fix with a filtered index.
- **Foreign keys still point at deleted rows**, so integrity means less than it appears.
- **Tables grow forever**, and indexes fill with rows nobody wants.
- **GDPR/erasure** requests cannot be satisfied by a flag.

Alternatives: an archive table, event sourcing, or genuinely deleting and relying on backups and an audit log.`,
    language: "sql",
    code: `-- EF Core: global filter so the flag cannot be forgotten
modelBuilder.Entity<Customer>().HasQueryFilter(c => !c.IsDeleted);

-- Uniqueness that ignores deleted rows
CREATE UNIQUE INDEX UX_Customers_Email ON Customers (Email) WHERE IsDeleted = 0;`,
    tags: ["soft delete", "query filter", "filtered index", "gdpr"],
  },
  {
    id: "db2-read-replica",
    topic: "database",
    subtopic: "Scaling",
    level: "intermediate",
    question: "What breaks when you add read replicas?",
    answer: `**Replication lag.** The replica is behind by milliseconds to seconds, and the user notices as "I saved it but it is not there".

Handling it:

- **Read-your-writes** — route a user to the primary for a short window after their write, or pass the write's LSN/timestamp and wait for the replica to catch up.
- **Route by intent** — reports, search and dashboards to replicas; anything read immediately after a write to the primary.
- **Monitor lag** and stop routing to a replica that falls behind a threshold.

Also: replicas do not help write throughput at all, and they multiply cost and connection count.`,
    tags: ["read replica", "replication lag", "read your writes", "scaling"],
  },
  {
    id: "db2-datetime-storage",
    topic: "database",
    subtopic: "Modelling",
    level: "basic",
    question: "How should you store dates and times?",
    answer: `- **Store UTC**, always, in \`datetime2\` (SQL Server) or \`timestamptz\` (PostgreSQL). Convert to local time at display.
- **Keep the original offset** when it matters (\`datetimeoffset\`) — an appointment booked at 09:00 in Kolkata is not the same fact as its UTC instant if the rule is "9 am local".
- **Store the time zone id** (\`Asia/Kolkata\`) for future events, because offsets change with daylight saving and with law.
- Use \`date\` for dates with no time — a birthday is not an instant.
- Never store local time without an offset; it is ambiguous twice a year.

In .NET: \`DateTimeOffset\` for instants, \`DateOnly\`/\`TimeOnly\` for calendar values, \`TimeProvider\` so tests can control now.`,
    tags: ["datetime", "utc", "timezone", "datetimeoffset", "modelling"],
  },
  {
    id: "db2-json-columns",
    topic: "database",
    subtopic: "Modelling",
    level: "intermediate",
    question: "When is a JSON column the right choice in a relational database?",
    answer: `Good uses: sparse or per-tenant custom attributes, an audit payload, a third-party response you must keep verbatim, and settings blobs.

Bad uses: anything you filter, join or aggregate on regularly — you lose constraints, and indexing is more limited and easier to get wrong.

Rule of thumb: if a field appears in a \`WHERE\` clause across many queries, promote it to a real column. Hybrids are normal — key fields as columns, the long tail as JSON.

PostgreSQL \`jsonb\` with a GIN index is genuinely powerful; SQL Server's JSON is functions over an \`nvarchar\`, so index computed columns for anything hot.`,
    language: "sql",
    code: `-- SQL Server: promote a hot JSON field to an indexed computed column
ALTER TABLE Events ADD DeviceId AS CAST(JSON_VALUE(Payload, '$.deviceId') AS nvarchar(50)) PERSISTED;
CREATE INDEX IX_Events_DeviceId ON Events (DeviceId);

-- PostgreSQL: index the document itself
CREATE INDEX IX_Events_Payload ON events USING GIN (payload jsonb_path_ops);`,
    tags: ["json", "jsonb", "computed column", "modelling", "indexing"],
  },
  {
    id: "db2-locking-hierarchy",
    topic: "database",
    subtopic: "Transactions",
    level: "advanced",
    question: "How do you reduce lock contention on a hot table?",
    answer: `- **Shorten transactions** — never do I/O, user interaction or a message publish inside one.
- **Touch rows in a consistent order** so transactions cannot deadlock in a cycle.
- **Update in one statement** rather than read-modify-write, so the engine holds the lock briefly.
- **Enable RCSI** so readers use versions instead of shared locks.
- **Avoid lock escalation** — thousands of row locks escalate to a table lock; batch updates in chunks of a few thousand.
- **Move the hotspot** — a single counter row is a serialisation point; shard it into N rows and sum, or move it to Redis.`,
    language: "sql",
    code: `-- Serialisation point: every order updates the same row
UPDATE Counters SET Value = Value + 1 WHERE Name = 'orders';

-- Sharded counter: contention divided by 16
UPDATE Counters SET Value = Value + 1
WHERE Name = 'orders' AND Shard = ABS(CHECKSUM(NEWID())) % 16;

SELECT SUM(Value) FROM Counters WHERE Name = 'orders';   -- read side aggregates`,
    tags: ["locking", "contention", "deadlock", "escalation", "hotspot"],
  },
  {
    id: "db2-backup-restore",
    topic: "database",
    subtopic: "Operations",
    level: "intermediate",
    question: "What is your backup and recovery strategy?",
    answer: `Define **RPO** (acceptable data loss) and **RTO** (acceptable downtime) first — everything else follows.

- **Full + differential + transaction log** backups; log frequency sets the RPO (15 minutes of logs means up to 15 minutes lost).
- **Point-in-time restore** requires the full recovery model and an unbroken log chain.
- **Test restores on a schedule.** An untested backup is a belief, not a backup.
- **Store copies off-site / cross-region**, and protect them from the same credentials that could delete production — ransomware deletes backups first.
- **Keep restore runbooks** with real timings, because a 4-hour restore against a 1-hour RTO is a plan that already failed.`,
    tags: ["backup", "restore", "rpo", "rto", "point in time"],
  },
  {
    id: "db2-query-antipatterns",
    topic: "database",
    subtopic: "SQL",
    level: "intermediate",
    question: "Which SQL anti-patterns do you look for in review?",
    answer: `- **\`SELECT *\`** — breaks covering indexes and silently changes with the schema.
- **Functions on indexed columns** in \`WHERE\` — kills the seek.
- **Implicit conversion** — an \`nvarchar\` parameter against a \`varchar\` column scans the whole index.
- **\`OR\` across different columns** — often better as two queries with \`UNION ALL\`.
- **Correlated subquery in the SELECT list** — runs per row; usually rewritable as a join or window function.
- **\`NOT IN\` with a nullable column** — returns nothing when any value is NULL. Use \`NOT EXISTS\`.
- **Cursors** where a set-based statement would do.
- **Missing \`WHERE\`** on an UPDATE/DELETE — write the SELECT first, always.`,
    language: "sql",
    code: `-- Returns zero rows if any CustomerId in Orders is NULL — a silent bug
SELECT * FROM Customers WHERE Id NOT IN (SELECT CustomerId FROM Orders);

-- Correct and usually faster
SELECT c.* FROM Customers c
WHERE NOT EXISTS (SELECT 1 FROM Orders o WHERE o.CustomerId = c.Id);`,
    tags: ["anti-patterns", "not in", "implicit conversion", "sargable", "review"],
  },
  {
    id: "db2-multi-tenancy",
    topic: "database",
    subtopic: "Modelling",
    level: "advanced",
    question: "How do you design multi-tenant data isolation?",
    answer: `Three models, increasing isolation and cost:

1. **Shared schema, \`TenantId\` column** — cheapest, easiest to operate, one migration for everyone. Risk: one missing filter leaks another tenant's data. Enforce with a global query filter *and* row-level security in the database.
2. **Schema per tenant** — better separation, but migrations multiply and hundreds of schemas become unmanageable.
3. **Database per tenant** — strongest isolation, per-tenant backup/restore and scaling, easy "delete this customer". Costs the most and needs connection routing plus fleet-wide migration tooling.

Common real answer: shared schema for the long tail, dedicated databases for large or regulated customers — the hybrid.`,
    language: "sql",
    code: `-- Defence in depth: even a query that forgets the filter cannot see other tenants
CREATE FUNCTION dbo.fn_TenantPredicate(@TenantId int)
RETURNS TABLE WITH SCHEMABINDING
AS RETURN SELECT 1 AS ok WHERE @TenantId = CAST(SESSION_CONTEXT(N'TenantId') AS int);

CREATE SECURITY POLICY TenantFilter
ADD FILTER PREDICATE dbo.fn_TenantPredicate(TenantId) ON dbo.Orders
WITH (STATE = ON);`,
    tags: ["multi-tenancy", "row level security", "isolation", "saas"],
  },
];

export const MESSAGING_EXTRA: Question[] = [
  {
    id: "msg2-kafka-internals",
    topic: "messaging",
    subtopic: "Kafka",
    level: "advanced",
    mustKnow: true,
    question: "How does Kafka store data and guarantee durability?",
    answer: `A topic is split into **partitions**; each partition is an append-only log on disk, split into segments. Every message gets a monotonically increasing **offset**.

Durability comes from replication: each partition has a **leader** and followers. \`acks\` controls the guarantee:

- \`acks=0\` — fire and forget; fastest, loses data on failure.
- \`acks=1\` — leader wrote it; loses data if the leader dies before followers replicate.
- \`acks=all\` — all **in-sync replicas** have it. Combined with \`min.insync.replicas=2\` and replication factor 3, it survives one broker loss with no data loss.

Consumers pull, and track their own offset — which is why replay is possible and why a slow consumer does not slow producers.`,
    diagram: `Topic "orders", 3 partitions, RF=3

 P0: [0][1][2][3][4]   leader: broker1   followers: 2,3
 P1: [0][1][2]         leader: broker2   followers: 1,3
 P2: [0][1][2][3]      leader: broker3   followers: 1,2

 consumer group "billing":  c1 -> P0, c2 -> P1, c3 -> P2   (one owner per partition)`,
    followUps: [
      {
        question: "What happens if you have more consumers than partitions?",
        answer: "The extras sit idle. Partition count is the ceiling on parallelism within a consumer group, which is why it is chosen for peak throughput up front — increasing it later changes key-to-partition mapping.",
      },
      {
        question: "What is an ISR?",
        answer: "The in-sync replica set: followers caught up with the leader. A replica that falls behind is removed, and if the ISR drops below `min.insync.replicas`, `acks=all` producers start failing rather than risking loss.",
      },
    ],
    tags: ["kafka", "partitions", "replication", "acks", "isr", "offsets"],
  },
  {
    id: "msg2-consumer-offsets",
    topic: "messaging",
    subtopic: "Kafka",
    level: "advanced",
    question: "When should a Kafka consumer commit offsets?",
    answer: `Commit **after** processing, not before, and understand what each choice loses:

- **Auto-commit** (default, every 5 s) — a crash after the commit but before processing loses messages; a crash before the commit reprocesses. Convenient, imprecise.
- **Manual commit after processing** — at-least-once. The standard choice.
- **Commit before processing** — at-most-once. Only for data you can afford to lose.
- **Store the offset in the same transaction as the work** — effectively exactly-once for your own database.

Rebalances are the trap: if processing takes longer than \`max.poll.interval.ms\`, the broker assumes the consumer died, reassigns the partition, and the work is done twice.`,
    language: "csharp",
    code: `var config = new ConsumerConfig
{
    GroupId = "billing",
    EnableAutoCommit = false,                 // we decide when
    AutoOffsetReset = AutoOffsetReset.Earliest,
    MaxPollIntervalMs = 300_000               // must exceed worst-case processing time
};

while (!ct.IsCancellationRequested)
{
    var result = consumer.Consume(ct);
    await HandleAsync(result.Message.Value);  // idempotent
    consumer.StoreOffset(result);             // committed after success
}`,
    tags: ["kafka", "offsets", "commit", "rebalance", "at-least-once"],
  },
  {
    id: "msg2-rabbit-exchanges",
    topic: "messaging",
    subtopic: "RabbitMQ",
    level: "intermediate",
    question: "Explain RabbitMQ exchanges and routing.",
    answer: `Producers publish to an **exchange**, never to a queue. Bindings decide where messages land:

- **Direct** — routing key must match exactly. Point-to-point work distribution.
- **Fanout** — copy to every bound queue, routing key ignored. Broadcast.
- **Topic** — pattern match with \`*\` (one word) and \`#\` (zero or more): \`order.*.created\`, \`payment.#\`.
- **Headers** — match on header values instead of the routing key; flexible, slower, rarely used.

An unroutable message is dropped silently unless the exchange has an **alternate exchange** or the publisher sets the mandatory flag — a common source of "the message vanished".`,
    diagram: `                       binding: order.*.created
 publisher -> [ topic exchange "events" ] --> [ q.audit    ]  (#)
                    |                     --> [ q.shipping ]  (order.*.created)
                    |                     --> [ q.billing  ]  (payment.#)
   routing key: "order.in.created"`,
    followUps: [
      {
        question: "How do you make RabbitMQ messages survive a broker restart?",
        answer: "Three things together: a durable queue, persistent messages (delivery mode 2), and publisher confirms. Any one alone still loses messages.",
      },
    ],
    tags: ["rabbitmq", "exchange", "routing key", "topic", "durability"],
  },
  {
    id: "msg2-rabbit-prefetch",
    topic: "messaging",
    subtopic: "RabbitMQ",
    level: "intermediate",
    question: "What does prefetch (QoS) do and how do you tune it?",
    answer: `\`basic.qos(prefetch_count)\` limits how many unacknowledged messages a consumer may hold.

- **Unlimited (0)** — the broker pushes everything to the first consumer. One consumer sits on a huge backlog while others idle, and memory balloons.
- **1** — perfectly fair, but a round trip per message, so throughput suffers on fast handlers.
- **10–100** — the usual range: enough in flight to keep the pipe full, small enough to spread work.

Tune by handler duration: slow handlers → low prefetch (fairness matters more); fast handlers → higher (round trips dominate).`,
    language: "csharp",
    code: `channel.BasicQos(prefetchSize: 0, prefetchCount: 20, global: false);   // per consumer

var consumer = new AsyncEventingBasicConsumer(channel);
consumer.Received += async (_, ea) =>
{
    try
    {
        await HandleAsync(ea.Body.ToArray());
        channel.BasicAck(ea.DeliveryTag, multiple: false);
    }
    catch (Exception)
    {
        // requeue: false -> goes to the DLX instead of looping forever
        channel.BasicNack(ea.DeliveryTag, multiple: false, requeue: false);
    }
};
channel.BasicConsume("orders", autoAck: false, consumer);`,
    tags: ["rabbitmq", "prefetch", "qos", "ack", "fairness"],
  },
  {
    id: "msg2-competing-consumers",
    topic: "messaging",
    subtopic: "Patterns",
    level: "basic",
    question: "What is the competing consumers pattern?",
    answer: `Several instances of the same consumer read from one queue; the broker gives each message to exactly one of them. Throughput scales with instance count, and a failed instance's unacknowledged messages return to the queue.

Requirements that make it work:

- **Handlers must be idempotent** — a redelivery after a crash is normal.
- **No shared state between messages**, or you have reinvented ordering constraints.
- **Visibility/lock timeout longer than processing**, or messages are handled twice concurrently.

It is the default scaling model for queues, and the reason ordering is lost: three consumers process three messages simultaneously.`,
    diagram: `        +--> [consumer 1] (msg 1)
[queue] +--> [consumer 2] (msg 2)     each message goes to exactly one
        +--> [consumer 3] (msg 3)     add instances -> more throughput`,
    tags: ["competing consumers", "scaling", "idempotency", "ordering"],
  },
  {
    id: "msg2-retry-backoff",
    topic: "messaging",
    subtopic: "Reliability",
    level: "intermediate",
    mustKnow: true,
    question: "How do you implement retries for a message consumer?",
    answer: `Distinguish the failure type first:

- **Transient** (dependency timeout, 503, deadlock) — retry with **exponential backoff and jitter**.
- **Poison** (bad schema, missing reference) — never retry; dead-letter immediately.

Where the delay lives matters: retrying in-process blocks the consumer and burns the lock. Better to **schedule** the retry — Service Bus scheduled delivery, RabbitMQ delayed-message plugin or a per-attempt delay queue with TTL + DLX, Kafka retry topics.

Cap attempts, then dead-letter with the reason and the attempt count attached.`,
    diagram: `RabbitMQ delay chain

 [work] --nack--> [retry.5s  (TTL 5s, DLX=work)]  --expires--> back to work
                  [retry.30s (TTL 30s)]
                  [retry.5m  (TTL 5m)]
                  after N attempts --> [dead-letter]`,
    language: "csharp",
    code: `// Service Bus: schedule instead of blocking the consumer
var attempt = message.ApplicationProperties.TryGetValue("attempt", out var a) ? (int)a : 0;

if (attempt >= 5)
{
    await args.DeadLetterMessageAsync(message, "MaxAttempts", $"Failed {attempt} times");
    return;
}

var delay = TimeSpan.FromSeconds(Math.Pow(2, attempt)) + TimeSpan.FromMilliseconds(Random.Shared.Next(1000));
var retry = new ServiceBusMessage(message.Body) { ApplicationProperties = { ["attempt"] = attempt + 1 } };

await sender.ScheduleMessageAsync(retry, DateTimeOffset.UtcNow.Add(delay));
await args.CompleteMessageAsync(message);`,
    tags: ["retry", "backoff", "jitter", "dlx", "scheduled delivery"],
  },
  {
    id: "msg2-event-vs-command-vs-document",
    topic: "messaging",
    subtopic: "Design",
    level: "intermediate",
    question: "What should a message actually contain?",
    answer: `Two styles, and the choice has real consequences:

- **Event-carried state transfer** — the message carries the data consumers need (\`OrderPlaced\` with lines and totals). Consumers work without calling back, so they stay decoupled and fast. Costs: larger messages, duplicated data, and stale copies.
- **Thin event / notification** — just ids (\`OrderPlaced { OrderId }\`); consumers fetch what they need. Small messages, always fresh, but every consumer now depends on the producer's API being available — you have reintroduced coupling.

Always include: a **message id** (idempotency), **correlation id** (tracing), **type and version**, **occurred-at timestamp**, and the **aggregate id**.

Never include: secrets, or full personal data you would then have to erase from every consumer.`,
    language: "csharp",
    code: `public record OrderPlaced(
    Guid MessageId,          // idempotency key
    Guid CorrelationId,      // ties the whole flow together in logs
    string Type,             // "order.placed"
    int Version,             // schema version
    DateTimeOffset OccurredAt,
    Guid OrderId,            // aggregate id
    string CustomerId,
    decimal Total,
    IReadOnlyList<OrderLine> Lines);   // state transfer: consumers need no callback`,
    tags: ["message design", "event carried state", "correlation", "versioning"],
  },
  {
    id: "msg2-inbox-pattern",
    topic: "messaging",
    subtopic: "Patterns",
    level: "advanced",
    question: "What is the inbox pattern?",
    answer: `The consumer-side mirror of the outbox. Before processing, the consumer records the message id in an **Inbox** table **inside the same transaction** as the business change. A duplicate delivery finds the id already present and is skipped.

That gives effective exactly-once processing on top of at-least-once delivery, without distributed transactions.

Operational details that matter: index the inbox by message id, purge rows older than the broker's maximum redelivery window, and make sure the insert and the work truly share one transaction — two connections is the bug that makes it useless.`,
    language: "sql",
    code: `CREATE TABLE Inbox (
    MessageId   uniqueidentifier PRIMARY KEY,
    ProcessedAt datetime2 NOT NULL
);
CREATE INDEX IX_Inbox_ProcessedAt ON Inbox (ProcessedAt);   -- for the purge job

-- The insert and the business write commit together; a duplicate violates the PK
BEGIN TRAN;
  INSERT INTO Inbox (MessageId, ProcessedAt) VALUES (@messageId, SYSUTCDATETIME());
  UPDATE Accounts SET Balance = Balance - @amount WHERE Id = @accountId;
COMMIT;`,
    tags: ["inbox", "idempotency", "exactly once", "deduplication"],
  },
  {
    id: "msg2-claim-check",
    topic: "messaging",
    subtopic: "Patterns",
    level: "intermediate",
    question: "How do you send a large payload through a queue?",
    answer: `Do not. Brokers cap message size (Service Bus 256 KB standard / 100 MB premium, Kafka 1 MB by default) and large messages destroy throughput and memory.

Use the **claim check** pattern: write the payload to blob storage, and put a **reference** in the message — location, size, checksum and content type. The consumer fetches it.

Then handle the details: who deletes the blob and when, what happens if the message is dead-lettered (an orphaned blob), and access control so the consumer can read it (a short-lived SAS or a managed identity).`,
    diagram: `producer --> [ blob storage ]  (payload, 40 MB)
         --> [ queue ] { blobUri, sha256, size }  (200 bytes)
                          |
                  consumer reads reference -> downloads blob -> processes -> deletes`,
    tags: ["claim check", "large message", "blob", "size limit"],
  },
  {
    id: "msg2-fanout-fanin",
    topic: "messaging",
    subtopic: "Patterns",
    level: "intermediate",
    question: "How do you implement scatter-gather (fan-out / fan-in)?",
    answer: `Fan out one request to several workers, then aggregate the replies.

The hard part is the **gather**, and it is where designs fail:

- **Correlation** — every reply carries the original correlation id so the aggregator knows what it belongs to.
- **Completion** — know how many replies to expect, or aggregate on a timeout.
- **Partial failure** — decide in advance whether a missing reply means fail, or return a partial result.
- **State** — the aggregator must persist progress, or a restart loses everything in flight. Durable Functions, a saga table or a stateful actor all work.

If the replies are not needed together, do not fan in — let each consumer act independently and skip the coordination entirely.`,
    diagram: `                    +--> [pricing]  --+
 request --> [fan-out] --> [stock]    --+--> [aggregator] --> response
                    +--> [shipping] --+        waits for 3 or times out
                                              persists partial state`,
    tags: ["scatter gather", "fan-out", "aggregator", "correlation", "timeout"],
  },
  {
    id: "msg2-priority-scheduling",
    topic: "messaging",
    subtopic: "Design",
    level: "intermediate",
    question: "How do you handle message priority and delayed delivery?",
    answer: `**Priority** — most brokers support it badly or not at all. RabbitMQ has priority queues (with caveats: priorities only apply to messages waiting, not those already prefetched). Kafka has none. The robust approach is **separate queues per priority** with consumers weighted towards the high-priority one — explicit, observable, and it cannot starve low priority accidentally unless you let it.

**Delay / scheduling** — Service Bus has native \`ScheduledEnqueueTime\`; RabbitMQ uses the delayed-message plugin or a TTL+DLX chain; Kafka has none, so you schedule externally or use a per-delay topic with a consumer that waits.

Watch for starvation: if high priority is always non-empty, low priority never runs. Give the low queue a guaranteed share.`,
    tags: ["priority", "scheduled delivery", "starvation", "delay queue"],
  },
  {
    id: "msg2-monitoring-queues",
    topic: "messaging",
    subtopic: "Operations",
    level: "intermediate",
    mustKnow: true,
    question: "What do you monitor and alert on for a queue-based system?",
    answer: `- **Consumer lag / queue depth** — how much work is waiting.
- **Age of the oldest message** — the better alert, because it measures whether you are falling behind rather than how busy you are.
- **Dead-letter count** — should alert at greater than zero; a growing DLQ nobody watches is silent data loss.
- **Processing rate and duration** — per handler, so a slowdown is attributable.
- **Redelivery / retry rate** — rising means something downstream is failing.
- **Consumer instance count and health** — zero consumers on a filling queue is the outage nobody notices until morning.
- **Publish failures** on the producer side.

Two alerts to define carefully: *oldest message age > SLA* and *DLQ > 0*. They catch almost everything else.`,
    tags: ["monitoring", "lag", "dlq", "alerting", "sla"],
  },
  {
    id: "msg2-transactional-messaging",
    topic: "messaging",
    subtopic: "Reliability",
    level: "advanced",
    question: "Can you send a message and update the database atomically?",
    answer: `Not directly — they are two systems. The options:

1. **Transactional outbox** — one local transaction plus a relay. The standard answer, at-least-once.
2. **Change Data Capture** — tail the transaction log (Debezium) and publish committed changes. No polling, no application code, more infrastructure.
3. **Broker-side transactions** — Kafka transactions give exactly-once *between Kafka topics*, and Service Bus supports transactions within one namespace. Neither spans your database.
4. **Two-phase commit / MSDTC** — technically possible with some stacks, practically avoided: it blocks, couples availability, and is poorly supported in cloud services.

Interviewers are checking whether you know why the naive "save then publish" is broken, not whether you can name all four.`,
    tags: ["outbox", "cdc", "2pc", "kafka transactions", "atomicity"],
  },
  {
    id: "msg2-idempotency-keys",
    topic: "messaging",
    subtopic: "Reliability",
    level: "intermediate",
    question: "How do you make a handler idempotent when the operation is not naturally repeatable?",
    answer: `Techniques by situation:

- **Natural idempotency** — prefer operations that are safe to repeat: \`SET status = 'Paid'\` rather than \`status = status + 1\`; upsert rather than insert.
- **Deduplication table** (inbox) — record the message id in the same transaction.
- **Conditional update** — \`WHERE Status <> 'Paid'\` so the second attempt affects zero rows.
- **Version / expected-state check** — apply only if the aggregate is in the state the message assumed.
- **Downstream idempotency key** — when calling a payment provider, pass a key so *they* deduplicate.

For side effects you cannot undo (email, SMS), record "sent" before sending and accept at-most-once for that step, or accept an occasional duplicate — decide which is worse and say so.`,
    language: "csharp",
    code: `// Conditional: the second delivery changes nothing
var rows = await db.Database.ExecuteSqlInterpolatedAsync($@"
    UPDATE Orders SET Status = 'Paid', PaidAt = SYSUTCDATETIME()
    WHERE Id = {orderId} AND Status <> 'Paid'");

if (rows == 0) return;    // already applied by an earlier delivery`,
    tags: ["idempotency", "deduplication", "conditional update", "side effects"],
  },
  {
    id: "msg2-event-driven-pitfalls",
    topic: "messaging",
    subtopic: "Design",
    level: "advanced",
    question: "What goes wrong in event-driven architectures?",
    answer: `- **No global view** — the business process exists only as a chain of reactions; nobody can answer "where is order 123?" without a correlation id and a trace.
- **Event soup** — services publishing events nobody consumes, or consuming events they should not know about.
- **Distributed spaghetti** — synchronous chains disguised as events, where A waits for B's event to continue.
- **Eventual consistency surfacing in the UI** — users see stale data and press the button again.
- **Debugging cost** — a bug spans five services and three brokers.
- **Schema coupling** — every consumer is coupled to the producer's payload; changing it is a cross-team negotiation.

Mitigations: correlation ids everywhere, a saga or process manager for anything multi-step, versioned contracts, and a rule that events describe **facts**, not instructions.`,
    tags: ["event driven", "pitfalls", "correlation", "coupling", "debugging"],
  },
  {
    id: "msg2-broker-choice",
    topic: "messaging",
    subtopic: "Brokers",
    level: "intermediate",
    question: "How would you choose a broker for a new system?",
    answer: `Ask these, in order:

1. **What is the message?** Command to one handler → queue (Service Bus, RabbitMQ, SQS). Fact for many readers → topic or log (Kafka, Event Hubs).
2. **Do you need replay or retention?** Only a log gives it.
3. **Throughput** — thousands/sec is comfortable for any broker; hundreds of thousands means Kafka or Event Hubs.
4. **Ordering requirement** — per-entity ordering means partitions or sessions.
5. **Operational capacity** — self-hosted Kafka is a real commitment; managed services cost money but not people.
6. **Ecosystem** — already on Azure? Service Bus and Event Hubs integrate with everything you have, including identity and monitoring.

Naming the *questions* rather than a favourite broker is what gets marked as a senior answer.`,
    tags: ["broker choice", "kafka", "service bus", "rabbitmq", "sqs", "trade-offs"],
  },
  {
    id: "msg2-batching-throughput",
    topic: "messaging",
    subtopic: "Performance",
    level: "intermediate",
    question: "How do you increase throughput in a messaging system?",
    answer: `- **Batch on both sides** — send in batches, receive in batches, and write to the database once per batch rather than once per message. Usually the single biggest win.
- **Compression** — Kafka's \`lz4\`/\`zstd\` cuts network and disk substantially for JSON.
- **Prefetch** enough to keep handlers busy without hoarding.
- **Parallelism** bounded by partitions/sessions if ordering matters, otherwise by concurrency limits.
- **Smaller messages** — claim check for payloads, and stop sending fields nobody reads.
- **Avoid per-message round trips** to other systems; cache lookups or enrich in bulk.

Then verify where the time actually goes: it is usually the handler's database call, not the broker.`,
    language: "csharp",
    code: `// One database round trip per batch instead of per message
processor.ProcessMessageAsync += async args => { _buffer.Add(Parse(args.Message)); };

// Flush on size or time, whichever comes first
if (_buffer.Count >= 500 || _sinceLastFlush > TimeSpan.FromSeconds(2))
{
    await _repository.BulkUpsertAsync(_buffer);
    await Task.WhenAll(_pending.Select(m => processor.CompleteMessageAsync(m)));
    _buffer.Clear();
}`,
    tags: ["throughput", "batching", "compression", "prefetch", "performance"],
  },
  {
    id: "msg2-security",
    topic: "messaging",
    subtopic: "Security",
    level: "intermediate",
    question: "How do you secure a message broker?",
    answer: `- **Authentication** — managed identity or SASL/mTLS rather than shared connection strings. If you must use keys, scope them per application and rotate.
- **Authorisation** — least privilege per entity: a producer gets Send only, a consumer gets Listen only. Never one connection string with Manage rights shared by everything.
- **Encryption** — TLS in transit (enforce it), encryption at rest, and consider payload-level encryption for sensitive fields so the broker operator never sees them.
- **Network** — private endpoints, no public access.
- **Data hygiene** — do not put secrets or full PII in messages; they persist in the broker, in the DLQ, and in every consumer's logs.
- **Audit** — who published what, and DLQ access.`,
    tags: ["security", "sasl", "mtls", "least privilege", "pii", "encryption"],
  },
];
