/**
 * Microservices and distributed-systems cards.
 *
 * This deck is the one that decides a senior band, and it is deliberately
 * opinionated: every card states a position and its cost, because an interview
 * at this level is not testing whether you have heard of CQRS. It is testing
 * whether you know what it costs and when you would refuse it.
 */

import type { Question } from "./types";

export const MICROSERVICE_QUESTIONS: Question[] = [
  {
    id: "ms-when",
    topic: "microservices",
    subtopic: "Boundaries",
    level: "intermediate",
    mustKnow: true,
    question: "When should you split a monolith into microservices — and when should you refuse?",
    answer:
      "Split when a **team, a rate of change, or a failure domain** needs to be independent:\n\n- Two teams keep blocking each other on one deployment.\n- One part scales differently — the results ingest is 100× the admin screens.\n- One part must not take the rest down.\n- One part has different compliance rules, so isolating it shrinks the audit.\n\nRefuse when the reason is \"microservices are the modern architecture\". The costs are real and immediate: a network between every call, distributed transactions you now have to design around, deployment and observability overhead, and a debugging story that is strictly worse.\n\nThe honest sequencing is a **modular monolith first** — proper module boundaries, no shared tables across them — and extract a service when a boundary proves itself under pressure. Boundaries drawn on a whiteboard are guesses; boundaries drawn after a year of change are evidence.\n\nThe strongest interview answer names a split you *did not* do and why.",
    followUps: [
      { question: "What is the clearest sign a boundary is wrong?", answer: "Two services that must be deployed together, or a change that always touches both. That is one service with a network in the middle." },
      { question: "How small should a service be?", answer: "Small enough that one team owns it fully, big enough that a typical feature lands in one. 'One service per entity' is how you get a distributed monolith." },
    ],
    tags: ["microservices", "boundaries", "monolith", "architecture"],
  },
  {
    id: "ms-gateway",
    topic: "microservices",
    subtopic: "Boundaries",
    level: "intermediate",
    question: "What belongs in an API gateway, and what must never go in one?",
    answer:
      "**Belongs**: TLS termination, authentication and token validation, rate limiting, routing, request/response logging with a correlation id, API versioning, CORS, and response aggregation for a specific client (a backend-for-frontend).\n\n**Must not**: business logic, per-entity authorisation decisions that need domain data, and data transformation that encodes domain rules. The moment the gateway knows what a valid order looks like, every service change becomes a gateway change, and the gateway is the one component you cannot deploy independently.\n\nThe test: could a new service be added without editing gateway logic beyond a route? If not, the gateway has absorbed the domain.\n\nAuthorisation splits in two: the gateway proves *who you are* (a valid token, the right audience); the service decides *what you may do with this record*, because only it knows the record.",
    diagram:
      "  client ──▶ gateway ──┬──▶ orders service\n              │        ├──▶ results service\n              │        └──▶ patients service\n              │\n              ├─ TLS, authn, rate limit, routing, correlation id   ✔\n              └─ \"is this order valid?\"                            �’ belongs in the service",
    followUps: [
      { question: "What is a backend-for-frontend?", answer: "A gateway per client type — one for the mobile app, one for the web — so each can aggregate exactly what its screens need without one generic API pleasing nobody." },
    ],
    tags: ["api-gateway", "bff", "routing", "authorisation"],
  },
  {
    id: "ms-cqrs",
    topic: "microservices",
    subtopic: "Patterns",
    level: "intermediate",
    mustKnow: true,
    question: "Explain CQRS and what it costs.",
    answer:
      "CQRS separates the **write model** from the **read model**. Writes go through commands into a model shaped for invariants and validation; reads come from a model shaped for the screen that displays them.\n\nWhat you gain: reads that need no joins, read and write scaling independently, and a write model free to be normalised and strict without punishing every query.\n\nWhat you pay: **two models to keep in step**. Unless both live in one transaction, the read model is stale — usually milliseconds, occasionally minutes after an outage — and your UI must cope with a user not seeing their own write. That is the cost people skip when they describe it, and the one an interviewer is listening for.\n\nCQRS does *not* require event sourcing, separate databases, or a message bus. The lightweight version — command handlers plus hand-written read queries or a materialised view against the same database — gets most of the benefit for almost none of the cost.\n\nUse it where reads and writes genuinely differ in shape or volume. A CRUD screen does not need it.",
    diagram:
      "  command ──▶ write model ──▶ events ──▶ projector ──▶ read model ──▶ query\n              (invariants)                    (async)     (denormalised)\n                                                 ▲\n                                    staleness lives here",
    followUps: [
      { question: "How do you handle read-your-own-writes?", answer: "Return the new state from the command, or have the client hold the write's version and wait for the read model to catch up. Pretending it is synchronous is what produces the 'my change vanished' bug." },
      { question: "Is event sourcing required?", answer: "No. They are often taught together, but CQRS is about separating models and event sourcing is about storing events as the source of truth. Each is useful without the other." },
    ],
    tags: ["cqrs", "read-model", "consistency", "patterns"],
  },
  {
    id: "ms-saga",
    topic: "microservices",
    subtopic: "Patterns",
    level: "advanced",
    mustKnow: true,
    question: "What is a saga, and how do choreography and orchestration differ?",
    answer:
      "A saga replaces a distributed transaction with a **sequence of local transactions, each with a compensating action**. There is no rollback across services, so if step four fails you *undo* steps three, two and one by doing something new.\n\n- **Choreography** — each service reacts to events and publishes its own. No coordinator. Simple with three steps; by seven, nobody can say what the flow is, and the only way to find out is to read every service.\n- **Orchestration** — one component holds the flow and tells each service what to do next. The flow is readable in one place and can be monitored; the cost is a component that knows about everyone.\n\nUse choreography while the flow is short and stable; orchestrate once it has branches, timeouts or a business owner who asks \"where is order 12345?\".\n\nWhat people miss: **compensation is not rollback**. You cannot un-send an email or un-run a blood test. The compensating action is a real business action — a cancellation notice, a credit note, a discard record — and it has to be designed with the business, not invented by the developer.",
    diagram:
      "  Orchestration                        Choreography\n  ┌───────────┐                        order ──event──▶ payment\n  │ saga      │──▶ reserve stock             ◀─event─── │\n  │ (the flow)│──▶ take payment         stock ◀─event───┘\n  │           │──▶ ship                      (flow exists nowhere)\n  └───────────┘  on failure: compensate in reverse",
    followUps: [
      { question: "Where does the saga state live?", answer: "In a durable store owned by the orchestrator, with a timeout per step. A saga in memory does not survive the restart that happens mid-flow." },
      { question: "How does this apply to a lab order?", answer: "Order placed, specimen collected, run, result filed, order closed. Cancelling after collection is not a rollback — it is a discard record and a notification, both real events." },
    ],
    tags: ["saga", "compensation", "orchestration", "choreography", "transactions"],
    relatedTools: ["trace-explorer"],
  },
  {
    id: "ms-outbox",
    topic: "microservices",
    subtopic: "Patterns",
    level: "advanced",
    mustKnow: true,
    question: "Why do you need the outbox pattern?",
    answer:
      "Because you cannot atomically write to your database and publish to a broker. Whichever you do first, a crash between them leaves the two disagreeing:\n\n- Save then publish → the row exists, nobody was told. Silent data loss downstream.\n- Publish then save → everyone acts on an order that does not exist.\n\nThe **outbox** makes it one transaction: write the business row *and* an `Outbox` row in the same commit. A separate process then reads the outbox and publishes, marking rows sent. The publish may happen twice — hence at-least-once and idempotent consumers — but it can never be missed.\n\nThe relay is either a poller (simple, adds latency) or change-data-capture reading the transaction log (lower latency, more moving parts).\n\nThe symmetric pattern on the receiving side is the **inbox**: record the message id you processed in the same transaction as its effect, so a redelivery can be recognised and skipped.",
    language: "csharp",
    code:
      "// One transaction, two rows: the fact and the intention to tell people about it.\nusing var tx = await db.Database.BeginTransactionAsync();\n\ndb.Orders.Add(order);\ndb.Outbox.Add(new OutboxMessage\n{\n    Id = Guid.NewGuid(),\n    Type = nameof(OrderPlaced),\n    Payload = JsonSerializer.Serialize(new OrderPlaced(order.Id, order.PatientId)),\n    OccurredAt = DateTimeOffset.UtcNow,\n});\n\nawait db.SaveChangesAsync();\nawait tx.CommitAsync();\n\n// A background relay publishes unsent rows and marks them sent.\n// It may publish twice; it can never publish something that did not commit.",
    followUps: [
      { question: "Why not just use a distributed transaction?", answer: "Two-phase commit across a database and a broker is slow, poorly supported by modern brokers, and blocks when the coordinator dies. The outbox is the pragmatic replacement." },
      { question: "How do you stop the outbox growing for ever?", answer: "Delete or archive sent rows on a schedule, and index on (sent, occurredAt) so the relay's query stays cheap as the table ages." },
    ],
    tags: ["outbox", "inbox", "atomicity", "messaging", "reliability"],
  },
  {
    id: "ms-idempotency",
    topic: "microservices",
    subtopic: "Reliability",
    level: "intermediate",
    mustKnow: true,
    question: "Why is idempotency mandatory, and how do you implement it?",
    answer:
      "Because every broker worth using delivers **at least once**. Exactly-once delivery does not exist across a network; what exists is at-least-once delivery plus a consumer that makes duplicates harmless.\n\nDuplicates arrive because an ACK was lost, a consumer restarted after processing but before acknowledging, a producer retried on a timeout, or an operator replayed a queue.\n\nHow to implement, in order of preference:\n\n1. **Make the operation naturally idempotent.** `SET status = 'complete'` is safe to repeat; `balance = balance - 10` is not.\n2. **Upsert on a natural key.** The business identity of the thing, not the message id — a resend may carry a new message id while meaning the same result.\n3. **An inbox table.** Record the message id with a unique constraint, in the same transaction as the effect. A duplicate violates the constraint and is skipped.\n\nFor HTTP the same problem takes an `Idempotency-Key` header: store the key with the response, and return the stored response if the key comes back.",
    language: "csharp",
    code:
      "// The unique constraint is what makes this safe, not the SELECT.\nusing var tx = await db.Database.BeginTransactionAsync();\ntry\n{\n    db.ProcessedMessages.Add(new ProcessedMessage { MessageId = messageId, At = DateTimeOffset.UtcNow });\n    await db.SaveChangesAsync();          // throws if this id was already handled\n\n    await ApplyAsync(message);            // the effect, in the same transaction\n    await db.SaveChangesAsync();\n    await tx.CommitAsync();\n}\ncatch (DbUpdateException e) when (e.IsUniqueViolation())\n{\n    await tx.RollbackAsync();             // already processed — acknowledge and move on\n}",
    followUps: [
      { question: "Does Kafka's exactly-once help?", answer: "Within Kafka, yes — its transactions cover consume-process-produce inside the cluster. The moment your side effect is a database or an email, you are back to at-least-once." },
    ],
    tags: ["idempotency", "at-least-once", "duplicates", "inbox", "reliability"],
  },
  {
    id: "ms-kafka",
    topic: "microservices",
    subtopic: "Messaging",
    level: "intermediate",
    mustKnow: true,
    question: "Explain Kafka partitions, offsets and consumer groups.",
    answer:
      "- A **topic** is split into **partitions**. Each partition is an append-only log.\n- **Ordering is per partition, not per topic.** Messages with the same key go to the same partition, so ordering is really *ordering per key*. Choose the key as the thing whose order matters — patient id, order id — and never leave it null if order matters.\n- An **offset** is a message's position in a partition. The consumer stores the offset it has processed; nothing is deleted when it is read. That is why replay is possible and why Kafka is a log, not a queue.\n- A **consumer group** is a set of consumers sharing the work: **each partition goes to exactly one consumer in the group**. This is the ceiling people meet — the maximum useful parallelism equals the partition count. Adding an eleventh consumer to a ten-partition topic gives you an idle process.\n- Two groups on the same topic each get everything, independently, which is how you add a new consumer without disturbing the existing one.\n- **Retention is by time or size**, not by consumption. A slow consumer that falls behind retention loses data permanently.\n\nCommit offsets *after* processing, not before, or a crash loses messages. That gives at-least-once, which is why the consumer must be idempotent.",
    diagram:
      "  topic: results          consumer group A (3 consumers)\n   P0 [0][1][2][3]  ──────▶  consumer 1\n   P1 [0][1][2]     ──────▶  consumer 2\n   P2 [0][1][2][3]  ──────▶  consumer 3\n   P3 [0][1]        ──────▶  consumer 1   ← more partitions than consumers is fine\n                              (more consumers than partitions is not)",
    followUps: [
      { question: "What breaks when you add partitions later?", answer: "Key-to-partition mapping changes, so ordering guarantees for existing keys break at the boundary. Size partitions for growth up front." },
      { question: "Kafka or Service Bus?", answer: "Kafka for high-volume streams you may want to replay; Service Bus for work queues with per-message dead-lettering, scheduled delivery and sessions." },
    ],
    tags: ["kafka", "partitions", "offsets", "consumer-groups", "ordering"],
    relatedTools: ["nats", "rabbitmq"],
  },
  {
    id: "ms-redis",
    topic: "microservices",
    subtopic: "Caching",
    level: "intermediate",
    mustKnow: true,
    question: "How do you use Redis as a cache correctly, and what makes a distributed lock safe?",
    answer:
      "**Cache-aside** is the default: read the cache; on a miss read the database and populate it; on a write update the database and *invalidate* the key. Update-the-cache-on-write races with concurrent readers and eventually serves stale data.\n\nWhat matters in practice:\n\n- **Always set a TTL.** A key with no expiry is a memory leak and a permanently wrong value waiting to happen.\n- **Stampede.** When a hot key expires, every request misses at once and hammers the database. Fix with a short lock around the repopulate, or by refreshing slightly before expiry.\n- **Never cache PHI without thinking.** Redis is often unencrypted, shared, and dumped to disk.\n\nA **distributed lock** is `SET key value NX PX 30000` — set if absent, with an expiry so a dead holder cannot block for ever. Two rules people miss:\n\n1. **Release only your own lock**, comparing a unique value in a Lua script. Otherwise you delete a lock someone else acquired after yours expired.\n2. **The expiry can fire while you are still working**, so two holders exist. If correctness depends on exclusivity, the protected resource needs a **fencing token** — a number that increases with each grant, checked by the resource, so a stale holder's write is rejected.\n\nRedis locks are good enough for \"do not run this job twice\", not for guarding money.",
    language: "text",
    code:
      "SET lock:ingest <uuid> NX PX 30000        -- acquire, self-expiring\n\n-- release: only if it is still mine\nif redis.call('GET', KEYS[1]) == ARGV[1] then\n  return redis.call('DEL', KEYS[1])\nelse\n  return 0\nend",
    followUps: [
      { question: "What is a fencing token?", answer: "A monotonically increasing number issued with the lock. The protected resource remembers the highest it has seen and rejects anything lower, so a stale holder cannot write." },
      { question: "When is a cache the wrong answer?", answer: "When the real problem is a missing index. A cache in front of a slow query hides it until the cache is cold, and then the outage is worse." },
    ],
    tags: ["redis", "cache", "ttl", "distributed-lock", "fencing"],
    relatedTools: ["redis"],
  },
  {
    id: "ms-retry",
    topic: "microservices",
    subtopic: "Reliability",
    level: "intermediate",
    mustKnow: true,
    question: "How do you retry correctly?",
    answer:
      "- **Only transient faults.** Timeouts, 429, 503, connection resets, deadlocks. Retrying a 400 or a validation failure just repeats it slower.\n- **Exponential backoff with jitter.** Without jitter, every client that failed together retries together, and the recovering service is knocked over by its own clients. Full jitter — a random delay between zero and the current ceiling — is the usual choice.\n- **A cap on attempts and total time**, because a retry that outlives the caller's timeout is pure waste.\n- **Only idempotent operations**, or the retry creates a second order.\n- **Respect `Retry-After`** when the server sends one; it knows more than your backoff formula.\n- **Never retry inside a held lock or an open transaction.** That is how a transient blip becomes a deadlock storm.\n- **Pair it with a circuit breaker**, or retries turn a struggling dependency into a dead one.\n\nAnd know when *not* to retry: if the work is queued and will be redelivered, failing fast and letting the broker redeliver is better than blocking a consumer thread.",
    language: "csharp",
    code:
      "// Polly v8: retry the transient, break when it is clearly down, cap the wait.\nvar pipeline = new ResiliencePipelineBuilder<HttpResponseMessage>()\n    .AddRetry(new RetryStrategyOptions<HttpResponseMessage>\n    {\n        MaxRetryAttempts = 3,\n        BackoffType = DelayBackoffType.Exponential,\n        UseJitter = true,                         // without this, clients synchronise\n        Delay = TimeSpan.FromMilliseconds(200),\n        ShouldHandle = new PredicateBuilder<HttpResponseMessage>()\n            .Handle<HttpRequestException>()\n            .HandleResult(r => r.StatusCode is HttpStatusCode.TooManyRequests\n                                            or HttpStatusCode.ServiceUnavailable),\n    })\n    .AddCircuitBreaker(new CircuitBreakerStrategyOptions<HttpResponseMessage>\n    {\n        FailureRatio = 0.5, SamplingDuration = TimeSpan.FromSeconds(30),\n        MinimumThroughput = 10, BreakDuration = TimeSpan.FromSeconds(15),\n    })\n    .AddTimeout(TimeSpan.FromSeconds(5))\n    .Build();",
    followUps: [
      { question: "Why jitter specifically?", answer: "Because failures are correlated. A hundred clients that timed out at the same moment will retry at the same moment, producing exactly the load spike the dependency cannot take." },
    ],
    tags: ["retry", "backoff", "jitter", "polly", "resilience"],
  },
  {
    id: "ms-circuit-breaker",
    topic: "microservices",
    subtopic: "Reliability",
    level: "intermediate",
    mustKnow: true,
    question: "What does a circuit breaker do that a retry does not?",
    answer:
      "A retry assumes the fault is brief. A circuit breaker handles the case where it is not: after enough failures it **stops calling at all** and fails immediately.\n\nStates:\n\n- **Closed** — calls flow, failures are counted.\n- **Open** — calls fail instantly without touching the dependency, for a break duration.\n- **Half-open** — a small number of trial calls decide whether to close again or re-open.\n\nWhy it matters more than it looks: without it, every request to a dead dependency occupies a thread and a connection for the full timeout. Your service runs out of both and stops serving requests that had nothing to do with that dependency. The failure has spread. Failing fast is what contains it.\n\nWith the circuit open you still need an answer: cached data, a degraded response, a queued request, or an honest error. \"The results service is unavailable; your order was queued\" is a better product than a thirty-second spinner.\n\nUse a **bulkhead** alongside it — a separate connection or thread pool per dependency — so one slow dependency cannot consume the capacity of all the others.",
    diagram:
      "         failures > threshold\n  closed ──────────────────▶ open ──after break──▶ half-open\n     ▲                                                │\n     └───────────── trial call succeeds ──────────────┘\n                    trial call fails ──▶ open again",
    followUps: [
      { question: "What is the difference between a bulkhead and a circuit breaker?", answer: "A bulkhead limits how much of your capacity one dependency may consume; a breaker stops calling it entirely. They solve the same spread of failure from different directions." },
    ],
    tags: ["circuit-breaker", "bulkhead", "resilience", "cascading-failure"],
  },
  {
    id: "ms-rate-limit",
    topic: "microservices",
    subtopic: "Reliability",
    level: "intermediate",
    question: "Compare rate-limiting algorithms and say where the limit belongs.",
    answer:
      "- **Fixed window** — count per minute, reset on the boundary. Trivial, but allows a double burst around the edge: the full quota at 11:59:59 and again at 12:00:00.\n- **Sliding window** — count over the trailing period. Smoother, more state.\n- **Token bucket** — tokens refill at a steady rate up to a ceiling; each request spends one. Allows a controlled burst, which matches how real clients behave. The usual default.\n- **Leaky bucket** — a fixed drain rate, so output is perfectly smooth and bursts queue.\n- **Concurrency limit** — cap requests *in flight* rather than per second. Often the one that actually protects a database.\n\nWhere it belongs: at the **gateway** for per-client fairness and abuse, and **inside the service** for the resource you are actually protecting. A per-instance limit multiplies by your instance count, so a shared counter (Redis) is needed for a real global limit.\n\nAlways return `429` with `Retry-After`, and make the limit visible in headers. A rate limit the client cannot see becomes a retry storm.",
    language: "csharp",
    code:
      "// ASP.NET Core: token bucket per client, plus a queue rather than an instant reject.\nbuilder.Services.AddRateLimiter(o =>\n{\n    o.AddTokenBucketLimiter(\"per-client\", opt =>\n    {\n        opt.TokenLimit = 100;                       // burst ceiling\n        opt.TokensPerPeriod = 20;                   // steady rate\n        opt.ReplenishmentPeriod = TimeSpan.FromSeconds(1);\n        opt.QueueLimit = 10;\n        opt.QueueProcessingOrder = QueueProcessingOrder.OldestFirst;\n    });\n    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;\n});",
    followUps: [
      { question: "Rate limit by what key?", answer: "By the thing you are protecting from: API key or tenant, not IP, when clients are behind NAT or a gateway. IP limiting punishes whole hospitals." },
    ],
    tags: ["rate-limiting", "token-bucket", "429", "throttling"],
  },
  {
    id: "ms-load-balancing",
    topic: "microservices",
    subtopic: "Scaling",
    level: "basic",
    question: "L4 versus L7 load balancing, and why are sticky sessions a smell?",
    answer:
      "**L4** balances TCP connections — fast, protocol-agnostic, and blind to what is inside. **L7** understands HTTP, so it can route by path or header, retry an idempotent request on another instance, terminate TLS and inject a correlation id. Most service traffic wants L7; raw TCP protocols like MLLP get L4.\n\nAlgorithms: round robin (fine when requests are uniform), **least connections** (better when they are not), and **consistent hashing** when you want the same key to reach the same instance for cache locality.\n\n**Health checks** are the part that matters most: a liveness check that only proves the process is running will happily route traffic to an instance whose database connection is dead. Check the dependencies you cannot serve without — and no more, or one slow dependency takes your whole fleet out of rotation.\n\n**Sticky sessions** pin a user to an instance, which means state lives in that instance's memory. That instance now cannot be replaced without logging someone out, scaling out does not rebalance existing users, and a deployment is a mass logout. Put the state in Redis or a signed cookie and let any instance serve any request.",
    followUps: [
      { question: "When are sticky sessions legitimate?", answer: "Long-lived connections — WebSockets, SignalR without a backplane, server-sent events — where the connection itself is the state. Even then, prefer a backplane." },
    ],
    tags: ["load-balancing", "health-checks", "sticky-sessions", "scaling"],
  },
  {
    id: "ms-sharding",
    topic: "microservices",
    subtopic: "Scaling",
    level: "advanced",
    question: "How do you choose a shard key, and what does it cost?",
    answer:
      "A shard key decides which node holds a row. Choose it for **even distribution** and for **query locality** — the queries you run most should touch one shard.\n\n- **By tenant** (hospital, lab) is the usual right answer for this domain: queries are naturally per-tenant, and isolation is a compliance benefit. The risk is one enormous tenant on one node.\n- **By hash of an entity id** distributes evenly but destroys locality — every range query becomes a scatter-gather.\n- **By date** is the classic mistake: all of today's writes land on one shard, and it is the only busy one.\n\nWhat it costs, always:\n\n- **Cross-shard queries** need scatter-gather and application-side merging.\n- **Cross-shard transactions** do not exist; you are back to sagas.\n- **Rebalancing** is an operation, not a config change. Consistent hashing with virtual nodes limits how much data moves.\n- **Unique constraints across shards** have to be enforced somewhere else.\n\nBefore sharding: read replicas, better indexes, archiving cold data, and a bigger machine. Sharding is the last resort, and it is permanent.",
    followUps: [
      { question: "How do you shard when a query has no shard key?", answer: "Keep a lookup table or a search index mapping the other identifier to its shard, and accept that it is a second thing to keep consistent." },
    ],
    tags: ["sharding", "partitioning", "scaling", "database"],
    relatedTools: ["database-toolkit"],
  },
  {
    id: "ms-cap",
    topic: "microservices",
    subtopic: "Theory",
    level: "intermediate",
    mustKnow: true,
    question: "State the CAP theorem accurately, and say what it means for a design.",
    answer:
      "Under a **network partition**, a distributed system must choose between **consistency** (every read sees the latest write) and **availability** (every request gets a non-error response). It cannot have both.\n\nThe common misstatement is \"pick two of three\". Partition tolerance is not optional — networks partition — so the real choice is CP or AP, *and only while partitioned*. When the network is healthy you can have both, which is why the theorem says less about everyday behaviour than people think.\n\n- **CP** — refuse to answer rather than answer wrongly. Correct for anything clinical or financial.\n- **AP** — answer with possibly stale data. Correct for a dashboard, a catalogue, a cache.\n\nPACELC is the more useful version: *if Partitioned, choose A or C; Else, choose Latency or Consistency*. That second half is the trade-off you make every day, and the one that actually shapes designs.\n\nA good answer names the choice per component rather than per system: the result store is CP; the analytics view is AP.",
    followUps: [
      { question: "Where would you accept AP in a hospital system?", answer: "A departmental dashboard, a search index, a printed workload report. Never an active medication list, a result release, or an allergy check." },
    ],
    tags: ["cap", "pacelc", "consistency", "availability", "theory"],
  },
  {
    id: "ms-consistency",
    topic: "microservices",
    subtopic: "Theory",
    level: "intermediate",
    question: "How do you explain eventual consistency to someone who is not an engineer?",
    answer:
      "\"The change is saved. Some screens will show it within a second or two.\"\n\nThat sentence is the whole skill: it is honest, it is bounded, and it does not use the word eventual — which sounds like *maybe*.\n\nThe engineering that has to sit behind it:\n\n- **A bound.** \"Usually under a second, always under ten, and we alert if not.\" Eventual with no measured bound is an excuse.\n- **Read-your-own-writes for the person who made the change.** Users forgive other people's screens being a moment behind; they do not forgive their own change vanishing.\n- **Monotonic reads** — never show newer data and then older data. Bouncing between replicas produces exactly that, and it looks like data loss.\n- **Visible staleness where it matters.** \"As of 09:41\" on a dashboard costs nothing and prevents a support call.\n\nAnd know where it is not acceptable: an allergy list, a current medication, a released result. There, wait or fail — do not show a stale value with a timestamp and hope.",
    followUps: [
      { question: "What is causal consistency?", answer: "Operations that depend on one another are seen in order by everyone; unrelated ones may be seen in any order. It is often the practical middle ground." },
    ],
    tags: ["eventual-consistency", "read-your-writes", "monotonic-reads", "ux"],
  },
  {
    id: "ms-observability",
    topic: "microservices",
    subtopic: "Operations",
    level: "intermediate",
    mustKnow: true,
    question: "Logs, metrics and traces — which question does each answer?",
    answer:
      "- **Metrics** answer *is something wrong, and since when?* Cheap, aggregated, always on. Alert on these.\n- **Traces** answer *where did this request spend its time, and which hop failed?* One request across every service.\n- **Logs** answer *what exactly happened in this one case?* Expensive at volume, and the only one that can carry detail.\n\nYou need all three, and the thing that makes them useful together is a **correlation id** — W3C `traceparent` — propagated across every HTTP call, every queue message and into every log line. Without it you have three unrelated haystacks.\n\nPractical rules:\n\n- **Structured logs**, always. `LogInformation(\"Filed {Count} results for {Accession}\", n, acc)` is queryable; string interpolation is not.\n- **Sample traces, not errors.** Head sampling at 1–10% for normal traffic, but keep every trace that failed or was slow.\n- **RED for services** (Rate, Errors, Duration), **USE for resources** (Utilisation, Saturation, Errors).\n- **Alert on symptoms, not causes.** \"Result filing rate dropped to zero\" is worth waking someone for; \"CPU is at 80%\" is not.\n- **No PHI in any of them.** Ids and counts, never payloads.",
    diagram:
      "  metric:  results_filed_per_minute ──▶ 0        \"something is wrong, since 09:41\"\n  trace:   POST /results → parse → lookup(4.9s ✗)  \"the order lookup is timing out\"\n  log:     \"Order lookup failed for accession ACC55012: connection reset\"",
    followUps: [
      { question: "What is the single most valuable thing to add first?", answer: "The correlation id, end to end. It costs a day and turns every later investigation from guesswork into a query." },
    ],
    tags: ["observability", "tracing", "metrics", "logging", "correlation"],
    relatedTools: ["trace-explorer", "log-viewer", "debug-session"],
  },
  {
    id: "ms-eda",
    topic: "microservices",
    subtopic: "Patterns",
    level: "intermediate",
    question: "What do you actually gain and lose with event-driven architecture?",
    answer:
      "**Gain**: the producer stops knowing who consumes. A new consumer is added without touching the producer, load spikes are absorbed by the queue, and a slow consumer no longer slows the request that caused the event.\n\n**Lose**: the ability to see the flow. There is no stack trace across a broker. Debugging becomes correlation-id archaeology, ordering becomes a design problem, and \"why did this not happen?\" is a genuinely hard question.\n\nThe distinction worth stating in an interview:\n\n- **Event notification** — \"result filed, id 123\". Small, and the consumer calls back for detail. Loose coupling, more chatter.\n- **Event-carried state transfer** — the event carries the data. No callback, but now the schema is a contract and every consumer holds a copy.\n- **Commands are not events.** \"SendEmail\" is an instruction to one recipient; \"OrderPlaced\" is a fact for anyone interested. Putting commands on a broadcast topic is how coupling sneaks back in.\n\nAnd version events from day one. An event schema is a public API you cannot deploy alongside its consumers.",
    followUps: [
      { question: "How do you version an event?", answer: "Add fields, never remove or repurpose them; keep the old shape readable. When a breaking change is unavoidable, publish a new topic and run both until consumers move." },
    ],
    tags: ["event-driven", "coupling", "events", "schema", "architecture"],
    relatedTools: ["debug-session", "trace-explorer"],
  },
  {
    id: "ms-versioning",
    topic: "microservices",
    subtopic: "Operations",
    level: "intermediate",
    question: "How do you change a service contract without breaking its consumers?",
    answer:
      "The rule is **expand, migrate, contract** — and never do two of them in one deployment.\n\n1. **Expand.** Add the new field or endpoint. Old clients ignore it; new clients can use it. Everything still works with either version deployed.\n2. **Migrate.** Move consumers over, at their pace. Measure who is still using the old shape — you need telemetry per version, or this step never ends.\n3. **Contract.** Remove the old thing once nothing uses it, which you now know rather than assume.\n\nWhat this forbids: renaming a field, changing a type, making an optional field required, or changing the meaning of an existing value. All of those are breaking changes wearing a small diff.\n\nDatabase columns follow the same dance: add nullable, backfill, start writing both, switch reads, stop writing the old one, drop it. Six deployments, no downtime, no coordination.\n\nURL versioning (`/v2/orders`) is honest and easy to route. Header versioning is tidier and harder to debug. Either is fine; having no version at all is not.",
    followUps: [
      { question: "How do you know nothing uses the old field?", answer: "Log usage per field or per version with the client id. Announcements do not tell you who is still calling; telemetry does." },
    ],
    tags: ["versioning", "contracts", "migration", "backwards-compatibility"],
    relatedTools: ["openapi"],
  },
];
