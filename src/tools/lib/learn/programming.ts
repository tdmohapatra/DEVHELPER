import type { Question } from "./types";

/** General craft: concurrency, testing, git, security, APIs, debugging. */
export const PROGRAMMING_QUESTIONS: Question[] = [
  {
    id: "prog-process-thread",
    topic: "programming",
    subtopic: "Concurrency",
    level: "basic",
    mustKnow: true,
    question: "Process vs thread vs task — and what is the thread pool for?",
    answer: `- **Process** — its own memory space. Isolation is the point; communication needs IPC.
- **Thread** — a unit of scheduling inside a process, sharing memory with its siblings. Cheap to communicate, dangerous to share state. Roughly 1 MB of stack each, so thousands of threads is a problem.
- **Task** — a *unit of work*, not a thread. It may run on a pooled thread, or on no thread at all while waiting for I/O.

The **thread pool** exists because creating threads is expensive and unbounded creation destroys throughput. It reuses a managed set, growing slowly (the injection rate is deliberately conservative). Blocking pooled threads — \`.Result\`, \`Thread.Sleep\`, sync I/O — causes **starvation**: the queue grows while the pool adds one thread at a time.`,
    diagram: `Blocking a pooled thread vs awaiting

 sync:   [thread] --wait for I/O------------> [thread] busy, pool shrinks
 async:  [thread] -> start I/O -> released -> ... -> continuation on any thread

 Concurrency = doing several things in overlapping periods
 Parallelism  = doing several things at the same instant (needs cores)`,
    followUps: [
      {
        question: "Concurrency or parallelism — which does async give you?",
        answer:
          "Concurrency. `async` lets one thread make progress on many operations; it does not use more cores. `Parallel.For`/PLINQ are for parallelism, and only help CPU-bound work.",
      },
      {
        question: "How do you spot thread pool starvation in production?",
        answer:
          "Latency climbing while CPU stays low, and the thread count creeping up ~1/second. In .NET, the `ThreadPool` queue length counter and a dump showing many threads blocked in `Wait` confirm it.",
      },
    ],
    tags: ["process", "thread", "task", "thread pool", "starvation"],
  },
  {
    id: "prog-testing-pyramid",
    topic: "programming",
    subtopic: "Testing",
    level: "intermediate",
    mustKnow: true,
    question: "What makes a good test, and how do you decide what to test?",
    answer: `A good test is **fast, isolated, deterministic and behavioural** — it fails only when behaviour is wrong, not when the implementation is refactored.

Shape: many unit tests, fewer integration tests, very few end-to-end. Not because E2E is bad, but because it is slow and flaky, so it should cover only critical journeys.

What to test: business rules, boundaries, error paths, and every bug you fix (a regression test proves it stays fixed). What not to test: framework behaviour, getters, or mocks verifying that mocks were called.

**Test doubles**: a *stub* returns canned data; a *mock* asserts an interaction. Over-mocking couples tests to implementation — the usual reason a suite becomes a refactoring tax.`,
    language: "csharp",
    code: `// Brittle: asserts how the work was done
_repo.Verify(r => r.GetByIdAsync(1), Times.Once);

// Robust: asserts what the caller observes
var result = await _service.ApplyDiscountAsync(order, "SUMMER");
Assert.Equal(90m, result.Total);

// Deterministic time: never call DateTime.Now inside the code under test
public class DiscountService(TimeProvider clock)
{
    public bool IsValid(Coupon c) => c.ExpiresAt > clock.GetUtcNow();
}

[Fact]
public void Rejects_an_expired_coupon()
{
    var clock = new FakeTimeProvider(new DateTime(2026, 8, 1, 0, 0, 0, DateTimeKind.Utc));
    var service = new DiscountService(clock);
    Assert.False(service.IsValid(new Coupon(ExpiresAt: new DateTime(2026, 7, 31))));
}`,
    followUps: [
      {
        question: "Is 100% coverage a good target?",
        answer:
          "No. Coverage shows which lines ran, not whether behaviour is correct. High coverage with weak assertions is worse than moderate coverage with sharp ones. Track it as a smell detector, not a goal.",
      },
      {
        question: "How do you deal with a flaky test?",
        answer:
          "Fix or delete it — never retry it into green. Flakiness usually comes from time, ordering, shared state or real network calls. A test nobody trusts is worse than no test.",
      },
    ],
    tags: ["testing", "unit test", "mocks", "coverage", "flaky"],
  },
  {
    id: "prog-solid-review",
    topic: "programming",
    subtopic: "Craft",
    level: "intermediate",
    question: "What do you look for in a code review?",
    answer: `In priority order — the sequence matters, because reviewers who start at style never reach correctness:

1. **Correctness** — does it do what it claims? Edge cases, nulls, empty collections, off-by-one, error paths.
2. **Security** — injection, authorisation checks, secrets, unvalidated input, sensitive data in logs.
3. **Concurrency and resources** — shared state, disposal, transactions held too long.
4. **Design** — is it in the right place, is the abstraction earned, will the next change be easy?
5. **Tests** — do they cover the risk, and would they fail if the logic broke?
6. **Readability** — naming, function size, comments explaining *why* rather than *what*.
7. **Style** — last, and ideally automated so humans never discuss it.

Review comments should distinguish blocking issues from suggestions, and explain the reason rather than issue instructions.`,
    followUps: [
      {
        question: "How do you handle disagreement in review?",
        answer:
          "Separate facts (this throws on empty input) from preferences (I would name it differently). Facts get fixed; preferences get one comment and then deference to the author. Escalate to a team convention rather than re-arguing per pull request.",
      },
    ],
    tags: ["code review", "quality", "security", "readability"],
  },
  {
    id: "prog-git-workflow",
    topic: "programming",
    subtopic: "Tooling",
    level: "intermediate",
    question: "Explain merge vs rebase, and how you would recover from common git mistakes.",
    answer: `**Merge** keeps history as it happened and creates a merge commit — honest, and safe on shared branches. **Rebase** replays your commits on top of the target, producing a linear history — cleaner, but it **rewrites commits**, so never rebase a branch others have pulled.

Rule of thumb: rebase your own local work before pushing; merge everything else.

Recovery:

- **Committed to the wrong branch** — \`git switch correct && git cherry-pick <sha>\`, then remove it from the wrong branch.
- **Need to undo a pushed commit** — \`git revert\` (adds an inverse commit) rather than \`reset --hard\` on a shared branch.
- **Lost commits after a bad reset** — \`git reflog\` still has them; \`git reset --hard <sha>\` from the reflog entry.
- **Committed a secret** — rotate it first. History rewriting does not un-leak it.`,
    language: "bash",
    code: `# Tidy local work before pushing
git fetch origin
git rebase origin/main          # replay my commits on top of the latest main

# Safer force-push after a rebase: refuses if someone else pushed meanwhile
git push --force-with-lease

# Undo a pushed commit without rewriting history
git revert <sha>

# Find anything, including "lost" commits
git reflog
git reset --hard HEAD@{3}`,
    followUps: [
      {
        question: "Why `--force-with-lease` instead of `--force`?",
        answer:
          "It checks the remote is still where you last saw it, so you cannot silently discard a colleague's push that landed after your fetch.",
      },
      {
        question: "Squash merge or merge commit?",
        answer:
          "Squash gives one tidy commit per pull request and a readable main history; you lose intermediate commits, which matters if the branch was long-lived and the steps are meaningful. Most teams squash.",
      },
    ],
    tags: ["git", "rebase", "merge", "reflog", "revert"],
  },
  {
    id: "prog-security-owasp",
    topic: "programming",
    subtopic: "Security",
    level: "intermediate",
    mustKnow: true,
    question: "Which security issues do you actively defend against?",
    answer: `- **Injection** (SQL, command, LDAP) — parameterise everything; never concatenate input into a query or a shell command.
- **Broken access control** — the most common real-world failure. Check authorisation **per object**, server-side: "can this user edit *this* order", not just "is logged in".
- **Secrets in code/config** — vault or environment, never the repository; rotate on exposure.
- **XSS** — encode on output, use a Content Security Policy, avoid \`innerHTML\`.
- **CSRF** — anti-forgery tokens and \`SameSite\` cookies for cookie-authenticated state changes.
- **Sensitive data exposure** — TLS everywhere, hash passwords with bcrypt/Argon2 (never SHA alone), keep PII out of logs.
- **Insecure deserialisation** — never deserialise untrusted input into arbitrary types.
- **Vulnerable dependencies** — automated scanning in CI; most breaches use a known CVE.

Say **defence in depth**: validate at the boundary *and* authorise at the operation *and* constrain at the database.`,
    language: "csharp",
    code: `// Broken access control: the user id comes from the request body
[HttpDelete("/orders/{id}")]
public async Task<IActionResult> Delete(int id)      // any authenticated user, any order
{
    await _db.Orders.Where(o => o.Id == id).ExecuteDeleteAsync();
    return NoContent();
}

// Fixed: ownership is part of the query, taken from the token
[Authorize]
[HttpDelete("/orders/{id}")]
public async Task<IActionResult> Delete(int id)
{
    var userId = User.FindFirstValue(ClaimTypes.NameIdentifier);
    var affected = await _db.Orders
        .Where(o => o.Id == id && o.CustomerId == userId)   // cannot touch another user's row
        .ExecuteDeleteAsync();

    return affected == 0 ? NotFound() : NoContent();        // 404, not 403: do not leak existence
}`,
    followUps: [
      {
        question: "Why return 404 instead of 403 for another user's resource?",
        answer:
          "403 confirms the resource exists, which leaks information an attacker can enumerate. 404 reveals nothing — though be consistent, or the timing difference leaks it anyway.",
      },
      {
        question: "How should passwords be stored?",
        answer:
          "A slow, salted hash designed for the purpose — Argon2id or bcrypt, with a work factor tuned to your hardware. Never plain SHA-256: it is fast, which is exactly wrong here.",
      },
    ],
    tags: ["security", "owasp", "injection", "access control", "csrf", "xss"],
  },
  {
    id: "prog-http-basics",
    topic: "programming",
    subtopic: "Web",
    level: "basic",
    question: "What happens when you type a URL and press enter?",
    answer: `The classic breadth question. A good answer walks the whole path and stops at the right depth:

1. **DNS** — cache (browser → OS → resolver) → recursive lookup → IP address.
2. **TCP** — three-way handshake to the IP on port 443.
3. **TLS** — handshake: certificate validation, key exchange, cipher agreement. TLS 1.3 does it in one round trip.
4. **HTTP request** — method, path, headers, cookies. HTTP/2 multiplexes several requests over one connection.
5. **Server** — load balancer → reverse proxy → application → maybe cache/database → response.
6. **Response** — status, headers (caching, cookies, security), body.
7. **Rendering** — parse HTML, build the DOM, fetch subresources, CSSOM, layout, paint.

Where interviewers dig: caching layers, why HTTPS is trusted (certificate chain), and what a CDN changes.`,
    diagram: `Browser
  |-- DNS ----------> resolver -> authoritative NS
  |-- TCP SYN/ACK --> server
  |-- TLS handshake -> certificate verified against a trusted root
  |-- GET /path ----> [CDN] -> [Load balancer] -> [App] -> [Cache] -> [DB]
  |<-- 200 + body --- gzip/brotli, cache headers
  '-- parse, layout, paint`,
    followUps: [
      {
        question: "What do the main caching headers do?",
        answer:
          "`Cache-Control` sets freshness (`max-age`, `no-store`, `private`). `ETag`/`If-None-Match` and `Last-Modified`/`If-Modified-Since` enable revalidation, letting the server answer 304 with no body.",
      },
      {
        question: "What does a CDN change?",
        answer:
          "It terminates the connection near the user, serves cached content without reaching origin, and absorbs traffic spikes. It also changes cache invalidation into a purge problem.",
      },
    ],
    tags: ["http", "dns", "tls", "cdn", "caching"],
  },
  {
    id: "prog-debugging",
    topic: "programming",
    subtopic: "Craft",
    level: "intermediate",
    question: "How do you debug a production issue you cannot reproduce?",
    answer: `A method, and interviewers are listening for the method rather than the trick.

1. **Establish the facts** — when did it start, what changed, how many users, which instances. Correlate with deployments and configuration changes first; most incidents are caused by a change.
2. **Narrow the layer** — is it the client, the network, the app, or a dependency? Metrics and traces answer this faster than reading code.
3. **Form one hypothesis and test it** — resist changing three things at once.
4. **Use the evidence you have** — structured logs with correlation ids, a trace of a failing request, a memory dump, database wait stats.
5. **Mitigate before you fix** — roll back, scale, disable the feature flag. Restore service, then diagnose.
6. **Write the regression test** before the fix, so it cannot silently return.
7. **Blameless post-mortem** — what made it possible and what makes it detectable next time.

The strongest signal you can give: "I would look at what changed" as the first move.`,
    followUps: [
      {
        question: "The bug only happens under load. How do you approach it?",
        answer:
          "Suspect concurrency and resource limits: races, connection or thread pool exhaustion, lock contention, cache stampede. Reproduce with a load test in staging, and capture a dump at peak.",
      },
      {
        question: "How do you debug a memory leak in .NET?",
        answer:
          "Capture two dumps minutes apart, compare heap sizes by type, and look for growth. Then find what roots those objects — usually a static collection, an event handler, or a cache with no eviction.",
      },
    ],
    tags: ["debugging", "production", "incident", "post-mortem", "observability"],
  },
  {
    id: "prog-api-idempotent-safe",
    topic: "programming",
    subtopic: "Web",
    level: "intermediate",
    question: "What do safe, idempotent and cacheable mean for HTTP methods?",
    answer: `- **Safe** — does not change state: GET, HEAD, OPTIONS. Crawlers and prefetchers assume this; a GET that deletes something will be triggered by a link preview.
- **Idempotent** — repeating gives the same result: GET, HEAD, PUT, DELETE, OPTIONS. Note DELETE is idempotent even though the second call returns 404 — the *state* is the same.
- **Cacheable** — GET and HEAD by default; POST only with explicit headers.

| Method | Safe | Idempotent | Typical use |
|---|---|---|---|
| GET | yes | yes | read |
| POST | no | no | create, trigger |
| PUT | no | yes | full replace |
| PATCH | no | no | partial update |
| DELETE | no | yes | remove |

PATCH is not idempotent in general because an operation like "increment by 1" applied twice differs — which is why retries need an idempotency key.`,
    followUps: [
      {
        question: "How do you make POST retry-safe?",
        answer:
          "An idempotency key the client generates and the server stores, returning the original response for a repeat. See the payments design question for the storage shape.",
      },
    ],
    tags: ["http", "idempotent", "rest", "caching", "methods"],
  },
  {
    id: "prog-clean-code",
    topic: "programming",
    subtopic: "Craft",
    level: "basic",
    question: "What does readable code mean to you in practice?",
    answer: `Concrete habits, not slogans:

- **Names carry intent** — \`daysUntilExpiry\`, not \`d\`. A comment explaining a name usually means the name is wrong.
- **Small functions with one level of abstraction** — a method should not mix HTTP parsing, business rules and SQL.
- **Guard clauses over nesting** — return early; deeply nested \`if\` is the most common readability killer.
- **No magic values** — named constants explain what 30 means.
- **Comments explain *why*** — the code already says what. Comments that restate the code rot immediately.
- **Consistency beats personal preference** — match the file you are in.
- **Delete dead code** — version control remembers it; commented-out blocks are noise that nobody dares remove later.`,
    language: "csharp",
    code: `// Nested, unnamed, hard to scan
public decimal Calc(Order o)
{
    if (o != null)
        if (o.Lines.Count > 0)
            if (o.Customer.Type == 2)
                return o.Total * 0.9m;
    return o?.Total ?? 0;
}

// Guard clauses, named intent, one abstraction level
private const decimal PremiumDiscount = 0.10m;

public decimal CalculateTotal(Order order)
{
    ArgumentNullException.ThrowIfNull(order);
    if (order.Lines.Count == 0) return 0m;

    return order.Customer.IsPremium
        ? order.Total * (1 - PremiumDiscount)
        : order.Total;
}`,
    followUps: [
      {
        question: "When is a comment genuinely useful?",
        answer:
          "When it records a decision or a constraint the code cannot express: why a workaround exists, which spec section a rule comes from, or why the obvious approach fails here.",
      },
    ],
    tags: ["clean code", "naming", "guard clause", "readability"],
  },
  {
    id: "prog-immutable-functional",
    topic: "programming",
    subtopic: "Craft",
    level: "intermediate",
    question: "What functional ideas are worth using in an object-oriented codebase?",
    answer: `- **Pure functions** — same input, same output, no side effects. Trivial to test and to reason about; push side effects to the edges.
- **Immutability** — data that cannot change cannot be corrupted by another thread or a distant caller.
- **Expressions over statements** — \`switch\` expressions and ternaries make the result obvious.
- **Higher-order functions** — LINQ is this; passing behaviour beats writing a variant of the same loop.
- **Explicit results over exceptions** for expected failures — a \`Result<T>\` type makes the failure path visible in the signature.

The pragmatic line: pure core, imperative shell. Business rules as pure functions, I/O at the boundary.`,
    language: "csharp",
    code: `// Impure: reaches out for time and mutates the input
public void ApplyLateFee(Invoice invoice)
{
    if (invoice.DueDate < DateTime.Now)      // hidden dependency on the clock
        invoice.Total += 50;                 // mutates the caller's object
}

// Pure: everything it needs is a parameter, and it returns a new value
public static Invoice WithLateFee(Invoice invoice, DateTimeOffset now, decimal fee) =>
    invoice.DueDate < now ? invoice with { Total = invoice.Total + fee } : invoice;

// Testable without a clock, a database, or a mock`,
    followUps: [
      {
        question: "Does immutability cost performance?",
        answer:
          "It allocates more, which matters in hot loops and is why `Span<T>` and pooling exist. Everywhere else the correctness and thread-safety win comfortably outweighs it — measure before trading it away.",
      },
    ],
    tags: ["functional", "pure function", "immutability", "result type"],
  },
];
