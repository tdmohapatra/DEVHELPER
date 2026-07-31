import type { Question } from "./types";

/** System design: the frameworks, trade-offs and canonical designs. */
export const SYSTEM_DESIGN_QUESTIONS: Question[] = [
  {
    id: "sd-approach",
    topic: "system-design",
    subtopic: "Method",
    level: "intermediate",
    mustKnow: true,
    question: "How do you approach a system design interview?",
    answer: `Structure beats brilliance. Spend the first five minutes on requirements, not boxes.

1. **Clarify scope** — what exactly are we building, and what is explicitly out?
2. **Functional requirements** — the handful of operations that matter.
3. **Non-functional** — scale (DAU, QPS), read/write ratio, latency target, consistency needs, availability target, retention.
4. **Estimate** — QPS, storage per year, bandwidth. Rough numbers guide every later decision.
5. **API sketch** — the two or three endpoints.
6. **Data model** — entities, access patterns, and the choice of store *justified by them*.
7. **High-level diagram** — client, gateway, services, stores, queues, cache.
8. **Deep dive** where the interviewer pushes; usually the hardest scaling or consistency point.
9. **Bottlenecks and failure modes** — what breaks first, and what happens when each component dies.

Say the trade-off out loud every time you choose something. That is what is being assessed.`,
    diagram: `Standard skeleton to draw

 [Clients] -> [CDN] -> [Load balancer / API gateway]
                              |
              +---------------+---------------+
              |               |               |
        [Service A]     [Service B]     [Service C]
              |               |               |
        [ Cache ]      [ Primary DB ]   [ Queue ] -> [ Workers ]
                        |         \\
                   [replica]   [object storage]`,
    followUps: [
      {
        question: "How do you do capacity estimation quickly?",
        answer:
          "Round hard. 1 M daily users × 10 requests = 10 M/day ≈ 120 QPS average, and assume 3–5× peak. 100 bytes × 10 M/day ≈ 1 GB/day ≈ 365 GB/year. Precision is irrelevant; the order of magnitude drives the design.",
      },
    ],
    tags: ["method", "requirements", "estimation", "interview"],
  },
  {
    id: "sd-cap",
    topic: "system-design",
    subtopic: "Theory",
    level: "intermediate",
    mustKnow: true,
    question: "Explain CAP, and what it actually means for your design.",
    answer: `In the presence of a network **P**artition, you must choose between **C**onsistency and **A**vailability. Partitions are not optional — networks fail — so CAP is really a choice between CP and AP *during* a partition.

- **CP** — refuse writes rather than diverge. A payment ledger, inventory decrement, unique username.
- **AP** — keep serving, reconcile later. A social feed, product reviews, presence.

The nuance interviewers reward: **it is per-operation, not per-system**. The same product can be CP for "place order" and AP for "show recommendations".

**PACELC** extends it usefully: *else* (no partition) you still trade **L**atency against **C**onsistency — which is what choosing a read replica actually costs you.`,
    diagram: `Partition between regions

  Region A  --X--  Region B
     |                |
  CP: reject writes in the minority side (correct, unavailable)
  AP: accept both, reconcile later      (available, temporarily divergent)`,
    followUps: [
      {
        question: "What is eventual consistency, in user terms?",
        answer:
          "A write is visible everywhere eventually, not immediately. Users notice as 'I posted it but do not see it' — mitigate with read-your-own-writes (route that user to the primary or serve from a local copy).",
      },
      {
        question: "Where does 'strong consistency' actually cost you?",
        answer:
          "Latency and availability: a quorum write must reach several nodes, possibly across regions, and fails if enough are unreachable.",
      },
    ],
    tags: ["cap", "pacelc", "consistency", "availability", "partition"],
  },
  {
    id: "sd-scaling",
    topic: "system-design",
    subtopic: "Scaling",
    level: "intermediate",
    mustKnow: true,
    question: "How do you scale a read-heavy system?",
    answer: `In the order you should actually apply them:

1. **Cache** — the biggest single win. CDN for static, Redis for hot objects, in-process for tiny hot sets. Removes load rather than absorbing it.
2. **Read replicas** — send reads to followers. Accept replication lag; route read-your-writes to the primary.
3. **Denormalise / precompute** — materialised views, counters, feed fan-out on write.
4. **Scale out stateless services** behind a load balancer.
5. **Shard** the database — only when a single primary genuinely cannot hold the write volume or data. It is the most expensive step: cross-shard queries and transactions become hard.

Say the ratio first. A 100:1 read/write ratio makes caching and replicas obvious; a write-heavy system needs partitioning and queues instead.`,
    diagram: `Read path with caching layers

 Client -> CDN ---------------------> static assets
        -> API -> [ in-process cache ] -> [ Redis ] -> [ DB primary ]
                                                    -> [ DB replica ] (reads)

 Hit rates compound: 90% CDN + 90% Redis leaves 1% reaching the database`,
    followUps: [
      {
        question: "What is cache invalidation strategy?",
        answer:
          "Choose per data: TTL where staleness is acceptable (simplest, self-healing), write-through/invalidate-on-write where it is not, and versioned keys to avoid deleting anything at all.",
      },
      {
        question: "What is a hot key and how do you fix it?",
        answer:
          "One key taking a disproportionate share of traffic (a celebrity account). Fix by replicating that key across several cache nodes with a suffix, or serving it from local memory on every instance.",
      },
    ],
    tags: ["scaling", "cache", "replica", "sharding", "read heavy"],
  },
  {
    id: "sd-sharding",
    topic: "system-design",
    subtopic: "Scaling",
    level: "advanced",
    question: "How do you shard a database, and what breaks?",
    answer: `Sharding splits data across independent databases by a **shard key**.

Strategies:

- **Hash of key** — even distribution, but range queries hit every shard and resharding moves nearly everything (fix with **consistent hashing**).
- **Range** — natural for time series, but creates hot shards (today's data).
- **Directory** — a lookup service maps entity to shard; flexible, but it is another dependency and a single point of failure.
- **Geographic** — data residency and latency; uneven by nature.

What breaks: **cross-shard joins** (do them in the application or duplicate data), **transactions across shards** (use sagas), **unique constraints** across shards, **rebalancing**, and **hot shards** from a bad key.

Choose the key by how you query. Getting it wrong is expensive to undo, which is why interviewers focus on it.`,
    followUps: [
      {
        question: "What is consistent hashing and why does it help?",
        answer:
          "Nodes and keys are placed on a ring; a key belongs to the next node clockwise. Adding or removing a node moves only the keys in one arc rather than remapping everything, which is what makes rebalancing survivable.",
      },
      {
        question: "How do you avoid sharding?",
        answer:
          "Vertical scaling, read replicas, archiving cold data, and moving large blobs out of the database. Modern hardware and managed databases handle far more than teams assume — shard when measurement says you must.",
      },
    ],
    tags: ["sharding", "consistent hashing", "partitioning", "hot shard"],
  },
  {
    id: "sd-url-shortener",
    topic: "system-design",
    subtopic: "Designs",
    level: "intermediate",
    mustKnow: true,
    question: "Design a URL shortener.",
    answer: `**Requirements** — shorten a URL, redirect, optional expiry and analytics. Read-heavy (≈100:1), redirect latency must be tiny, availability matters more than perfect consistency.

**Estimate** — 100 M new URLs/month ≈ 40 writes/s; 100× reads ≈ 4,000 reads/s. 100 M × 500 bytes ≈ 50 GB/month.

**Key generation** — the interesting part:

- **Counter + base62** — a distributed counter (Redis \`INCR\`, or ranges pre-allocated per instance) encoded in base62. Short, no collisions, but sequential and guessable.
- **Hash + collision check** — MD5/SHA of the URL, take 7 chars, check for a collision. Needs a lookup per write.
- **Pre-generated keys** — a table of unused keys handed out on demand. Simple and fast.

7 base62 characters = 62⁷ ≈ 3.5 trillion — enough.

**Storage** — a key-value store keyed by short code. **Redirect** — 301 (cached by browsers, kills analytics) or 302 (every hit reaches you, enables analytics). Say which and why.

**Scale reads** — cache aggressively; the distribution is extremely skewed, so a small cache serves most traffic.`,
    diagram: `Write:  POST /shorten -> [API] -> key from counter -> [KV store] -> return code

Read:   GET /aB3xY9  -> [CDN/edge cache]
                     -> [API] -> [Redis: code -> url] --miss--> [KV store]
                     -> 302 redirect

Analytics: fire-and-forget event -> [queue] -> [worker] -> [analytics store]`,
    language: "csharp",
    code: `// Base62 encoding of a distributed counter value
private const string Alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

public static string Encode(long id)
{
    if (id == 0) return "0";
    var sb = new StringBuilder();
    while (id > 0)
    {
        sb.Insert(0, Alphabet[(int)(id % 62)]);
        id /= 62;
    }
    return sb.ToString();
}`,
    followUps: [
      {
        question: "How do you stop the counter being a bottleneck or predictable?",
        answer:
          "Hand each instance a block of 10,000 ids at a time, so the shared counter is touched rarely. To hide sequence, permute the id (a bijective scramble) before encoding.",
      },
      {
        question: "How do custom aliases change the design?",
        answer:
          "They need a uniqueness check on write — a conditional insert on the key — and reserved-word handling. That is the one place a strongly consistent write matters.",
      },
    ],
    tags: ["url shortener", "base62", "cache", "kv store", "design"],
  },
  {
    id: "sd-rate-limiter",
    topic: "system-design",
    subtopic: "Designs",
    level: "advanced",
    question: "Design a distributed rate limiter.",
    answer: `**Algorithms**, weakest to best:

- **Fixed window** — count per minute. Simple, but allows a 2× burst across the boundary.
- **Sliding window log** — timestamps per user; exact, memory-hungry.
- **Sliding window counter** — weighted blend of current and previous window. Good accuracy, cheap. The usual choice.
- **Token bucket** — tokens refill at a rate, each request takes one. Allows controlled bursts, which is what APIs usually want.
- **Leaky bucket** — smooths output to a constant rate.

**Distributed** — the counter must be shared, so Redis with an atomic Lua script or \`INCR\` + \`EXPIRE\`. Local-only counters let N instances allow N× the limit.

**Behaviour** — return **429** with \`Retry-After\` and \`X-RateLimit-*\` headers. Decide fail-open or fail-closed if Redis is down; for public APIs, fail-open protects availability, for abuse protection, fail-closed.`,
    diagram: `Token bucket

  refill 10 tokens/sec
        |
        v
   [ ~~~~~~~~ ]  capacity 100 (burst allowance)
        |
   request takes 1 token -> allowed
   empty bucket          -> 429 Retry-After`,
    language: "text",
    code: `-- Redis Lua: atomic check-and-increment, no race between instances
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])   -- window length
end
if current > tonumber(ARGV[2]) then        -- limit
  return 0
end
return 1`,
    followUps: [
      {
        question: "What do you rate limit by?",
        answer:
          "API key or user for authenticated traffic, IP for anonymous (with care behind NAT and proxies — read the correct forwarded header), and per-endpoint for expensive operations. Usually several tiers at once.",
      },
    ],
    tags: ["rate limiting", "token bucket", "redis", "429", "distributed"],
  },
  {
    id: "sd-microservices",
    topic: "system-design",
    subtopic: "Architecture",
    level: "advanced",
    mustKnow: true,
    question: "Monolith or microservices?",
    answer: `Start with a **modular monolith** unless you have a specific reason not to. It gives clear boundaries with none of the distributed cost, and it can be split later along those boundaries.

**Microservices buy** independent deployment, independent scaling, technology choice per service, and team autonomy — mainly an *organisational* benefit.

**They cost** network calls instead of method calls, distributed transactions (sagas), distributed debugging, versioned contracts, more infrastructure, and eventual consistency everywhere.

The honest interview answer: "Microservices solve a team-scaling problem before they solve a technical one. With three developers and one deployment pipeline, a monolith ships faster and breaks less."

If splitting: boundaries follow **business capabilities** (bounded contexts), each service owns its data, and no service reads another's database.`,
    diagram: `Modular monolith                     Microservices
+---------------------------+        [orders] --http/queue--> [payments]
| Orders | Payments | Ship  |             |                        |
|  (clear module seams)     |         [orders db]            [payments db]
+---------------------------+
  one deploy, in-process calls        independent deploy, network calls
  refactor freely                     contracts must be versioned`,
    followUps: [
      {
        question: "What is the distributed monolith anti-pattern?",
        answer:
          "Services split physically but still coupled — deployed together, sharing a database, calling each other synchronously in a chain. All the cost of distribution, none of the independence.",
      },
      {
        question: "How do services share data without sharing a database?",
        answer:
          "Publish events and let each service keep the projection it needs. Duplication is deliberate: the copy is denormalised for that service's queries and is eventually consistent.",
      },
    ],
    tags: ["microservices", "monolith", "bounded context", "architecture"],
  },
  {
    id: "sd-idempotency-api",
    topic: "system-design",
    subtopic: "Reliability",
    level: "advanced",
    question: "How do you make a payment API safe to retry?",
    answer: `The client cannot tell a lost response from a failed request, so it will retry — and must not charge twice.

**Idempotency key**: the client generates a unique key per logical operation and sends it as a header. The server:

1. Attempts to insert the key with the request fingerprint, atomically.
2. If it is new — process, store the response against the key.
3. If it exists and is **complete** — return the stored response, do not reprocess.
4. If it exists and is **in flight** — return 409 or wait, depending on the contract.
5. If the same key arrives with a *different* body — 422, because that is a client bug.

Keys expire after a window (24 hours is typical). The uniqueness must be enforced by the database, not by a check-then-insert, which races.`,
    language: "sql",
    code: `CREATE TABLE IdempotencyKeys (
    [Key]         nvarchar(100) PRIMARY KEY,   -- uniqueness enforced by the engine
    RequestHash   binary(32)    NOT NULL,
    Status        tinyint       NOT NULL,      -- 0 in-flight, 1 complete
    ResponseBody  nvarchar(max) NULL,
    CreatedAt     datetime2     NOT NULL
);

-- Claim the key; a duplicate raises a unique violation instead of racing
INSERT INTO IdempotencyKeys ([Key], RequestHash, Status, CreatedAt)
VALUES (@key, @hash, 0, SYSUTCDATETIME());`,
    diagram: `Client                       Server
  |-- POST /charge (key=K) --->|  insert K -> new -> charge -> store response
  |<--- 201 (lost in transit)  |
  |-- POST /charge (key=K) --->|  insert K -> conflict -> return stored response
  |<--- 201 (same result)      |     no second charge`,
    followUps: [
      {
        question: "Which HTTP methods are idempotent by definition?",
        answer:
          "GET, PUT, DELETE and HEAD are meant to be — repeating them has the same effect. POST is not, which is exactly why it needs an idempotency key.",
      },
    ],
    tags: ["idempotency", "retry", "payments", "api", "reliability"],
  },
  {
    id: "sd-consistency-patterns",
    topic: "system-design",
    subtopic: "Data",
    level: "advanced",
    question: "How do you keep data consistent across services?",
    answer: `Give up on distributed ACID transactions and pick a pattern that fits the requirement:

- **Transactional outbox** — atomic local commit plus reliable publishing. The default for "change something and tell others".
- **Saga** — a multi-step business process with compensating actions.
- **Event sourcing** — store the events, derive state. Perfect audit and time travel; costs schema evolution pain and query complexity (needs CQRS projections).
- **CQRS** — separate write and read models. Justified when read and write shapes genuinely differ; overkill otherwise.
- **Two-phase commit** — technically consistent, practically avoided: it blocks on the coordinator and hurts availability.

Then decide what the *user* sees during the inconsistent window, and design that experience deliberately — "pending" states, optimistic UI, or a read-your-writes route.`,
    followUps: [
      {
        question: "When is event sourcing genuinely worth it?",
        answer:
          "When the history *is* the product — ledgers, audit-heavy domains, anything where 'how did we get to this state' is a real question. If nobody asks that, a normal table plus an audit log is simpler.",
      },
      {
        question: "Is CQRS the same as event sourcing?",
        answer:
          "No. CQRS just separates read and write models and can be done with one database. Event sourcing is a storage decision. They are often used together because event streams need projections to be queryable.",
      },
    ],
    tags: ["cqrs", "event sourcing", "outbox", "saga", "consistency"],
  },
  {
    id: "sd-availability",
    topic: "system-design",
    subtopic: "Reliability",
    level: "intermediate",
    question: "How do you design for high availability?",
    answer: `- **Remove single points of failure** — redundant instances across availability zones, multi-AZ databases with automatic failover, redundant load balancers.
- **Health checks that mean something** — a liveness probe that only proves the process is running will keep a broken instance in rotation. Readiness should check critical dependencies.
- **Graceful degradation** — serve stale cache, hide non-essential features, queue writes. Partial service beats an error page.
- **Isolate failures** — timeouts, circuit breakers, bulkheads, so one sick dependency cannot take everything down.
- **Practise recovery** — backups are worthless untested; run restore drills and failover exercises.

Know the arithmetic: 99.9% is 8.7 hours of downtime a year, 99.99% is 52 minutes. Each nine costs disproportionately more, so ask what the business actually needs.`,
    followUps: [
      {
        question: "Active-active or active-passive?",
        answer:
          "Active-passive is simpler and cheaper, with failover measured in minutes. Active-active gives near-zero failover and uses all capacity, but requires conflict resolution and data locality decisions.",
      },
      {
        question: "What is the difference between RPO and RTO?",
        answer:
          "RPO is how much data you can afford to lose (drives backup and replication frequency). RTO is how long recovery may take (drives standby and automation investment).",
      },
    ],
    tags: ["availability", "redundancy", "health check", "rpo", "rto"],
  },
  {
    id: "sd-chat-notification",
    topic: "system-design",
    subtopic: "Designs",
    level: "advanced",
    question: "Design a notification / real-time update system.",
    answer: `**Delivery to the client** — pick per constraint:

- **WebSocket** — bidirectional, lowest latency, stateful connections that must be load balanced with affinity or a backplane.
- **Server-Sent Events** — server → client only, plain HTTP, auto-reconnect. Simpler when you only push.
- **Long polling** — the compatibility fallback.
- **Push notifications** (APNs/FCM) — when the app is closed.

**Server side** — a connection registry (which user is on which node, in Redis), a **backplane** so any node can reach a connection on another node, and a queue between the event producer and the fan-out workers.

**Hard parts to raise before being asked**: offline users (store and deliver on reconnect), ordering per conversation, deduplication, fan-out cost for large groups, and read receipts multiplying write volume.`,
    diagram: ` Producer -> [ queue ] -> [ fan-out workers ]
                                  |
                    +-------------+-------------+
                    |             |             |
              [ node 1 ]    [ node 2 ]    [ node 3 ]   <- WebSocket servers
                    |             |             |
                 clients       clients       clients

 [ Redis ] holds: user -> node mapping, presence, undelivered queue`,
    followUps: [
      {
        question: "How do you scale WebSockets behind a load balancer?",
        answer:
          "Connections are sticky by nature, so route with consistent hashing or session affinity, and use a Redis backplane (or SignalR's) so a message produced on one node reaches a socket held by another.",
      },
      {
        question: "How do you handle a user with several devices?",
        answer:
          "Registry maps user → set of connections, fan out to all, and track per-device delivery so a message read on one device updates the others.",
      },
    ],
    tags: ["websocket", "sse", "signalr", "fan-out", "presence", "notifications"],
  },
];
