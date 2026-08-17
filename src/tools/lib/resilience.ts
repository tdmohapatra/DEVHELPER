/**
 * Designing a retry policy, and seeing what it actually costs.
 *
 * Retry is the setting everyone changes and nobody measures. The arithmetic is
 * simple and almost never done, so the same three mistakes recur:
 *
 * **The total is not the delays.** Five attempts with exponential backoff from
 * one second is `1 + 2 + 4 + 8 = 15s` of waiting — but each attempt also has a
 * timeout, and if that is 30 seconds the worst case is `5 × 30 + 15 = 165s`.
 * The caller gave up at 30. Everything after the first attempt was work nobody
 * was waiting for, and the user saw a timeout while the system was still busy
 * on their behalf.
 *
 * **Without jitter, retries synchronise.** A hundred clients that fail at the
 * same moment retry at the same moment, and the recovering service is hit by the
 * same spike that knocked it over. Jitter is not a refinement; it is the
 * difference between a service recovering and a service being held down.
 *
 * **Retrying a non-idempotent write duplicates it.** A timeout does not mean the
 * request did not happen — it means the answer did not arrive. Retrying a
 * payment or an order after a timeout is how one becomes two, and no amount of
 * backoff helps.
 *
 * Everything here is pure and deterministic: the simulator takes its randomness
 * as a parameter, so the same policy always produces the same schedule and the
 * numbers on screen can be trusted to be the numbers that were computed.
 */

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export type BackoffStrategy = "fixed" | "linear" | "exponential";

/**
 * How much randomness to add to each delay.
 *
 * `full` is the one to reach for by default: it spreads a fleet across the whole
 * window and is what AWS's own analysis recommends. `equal` keeps half the delay
 * fixed, which retains some of the backoff's shape at the cost of less spread.
 * `decorrelated` grows from the previous *actual* delay rather than the attempt
 * number, which converges fastest when the outage is short.
 */
export type JitterMode = "none" | "full" | "equal" | "decorrelated";

export interface RetryPolicy {
  /** Total attempts including the first. `1` means no retry at all. */
  attempts: number;
  strategy: BackoffStrategy;
  /** The first delay, in milliseconds. */
  baseMs: number;
  /** Ceiling for any single delay. */
  maxDelayMs: number;
  jitter: JitterMode;
  /** Per-attempt timeout. This is what makes the worst case so much larger than the delays. */
  timeoutMs: number;
  /** Give up once total elapsed exceeds this, whatever the attempt count says. */
  overallBudgetMs?: number;
}

export const DEFAULT_POLICY: RetryPolicy = {
  attempts: 4,
  strategy: "exponential",
  baseMs: 1000,
  maxDelayMs: 30_000,
  jitter: "full",
  timeoutMs: 10_000,
  overallBudgetMs: 60_000,
};

/** A tiny seeded generator, so a simulation is reproducible. */
export function seededRandom(seed = 1): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    // xorshift32 — not cryptography, just a repeatable spread.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
}

/** The delay before an attempt, before jitter. Attempt 1 has no delay. */
export function baseDelay(policy: RetryPolicy, attempt: number): number {
  if (attempt <= 1) return 0;
  const step = attempt - 1;
  const raw =
    policy.strategy === "fixed" ? policy.baseMs
    : policy.strategy === "linear" ? policy.baseMs * step
    : policy.baseMs * 2 ** (step - 1);
  return Math.min(raw, policy.maxDelayMs);
}

/** Apply jitter to a computed delay. `previous` is only used by decorrelated. */
export function applyJitter(policy: RetryPolicy, delay: number, random: () => number, previous: number): number {
  switch (policy.jitter) {
    case "none":
      return delay;
    case "full":
      // Anywhere in [0, delay]. Maximum spread, which is the point.
      return Math.round(random() * delay);
    case "equal":
      return Math.round(delay / 2 + random() * (delay / 2));
    case "decorrelated":
      // Grows from the previous actual delay rather than the attempt number.
      return Math.round(Math.min(policy.maxDelayMs, policy.baseMs + random() * (previous * 3 - policy.baseMs)));
  }
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

export interface Attempt {
  attempt: number;
  /** Waited before this attempt. */
  delayMs: number;
  /** Cumulative time when this attempt starts. */
  startsAtMs: number;
  /** Cumulative time when it gives up, if it times out. */
  endsAtMs: number;
  /** Set when the overall budget stopped this attempt happening. */
  cutByBudget?: boolean;
}

export interface Simulation {
  attempts: Attempt[];
  /** Every attempt fails at its timeout: the worst case, and the one that matters. */
  worstCaseMs: number;
  /** Delays only, which is the number people quote and the one that misleads. */
  delayOnlyMs: number;
  /** Attempts that never ran because the budget ran out. */
  droppedByBudget: number;
}

/**
 * Run the policy on paper.
 *
 * Assumes every attempt fails by timing out, because that is the case worth
 * planning for: a fast failure costs almost nothing, and a policy is sized by
 * how bad it gets when nothing works.
 */
export function simulate(policy: RetryPolicy, random: () => number = seededRandom()): Simulation {
  const attempts: Attempt[] = [];
  let elapsed = 0;
  let delayOnly = 0;
  let previous = policy.baseMs;
  let dropped = 0;

  for (let n = 1; n <= Math.max(1, policy.attempts); n++) {
    const jittered = n === 1 ? 0 : applyJitter(policy, baseDelay(policy, n), random, previous);
    if (n > 1) previous = jittered || policy.baseMs;

    const startsAt = elapsed + jittered;
    if (policy.overallBudgetMs && startsAt >= policy.overallBudgetMs) {
      dropped = policy.attempts - n + 1;
      break;
    }

    const endsAt = policy.overallBudgetMs ? Math.min(startsAt + policy.timeoutMs, policy.overallBudgetMs) : startsAt + policy.timeoutMs;
    attempts.push({
      attempt: n,
      delayMs: jittered,
      startsAtMs: startsAt,
      endsAtMs: endsAt,
      cutByBudget: policy.overallBudgetMs ? startsAt + policy.timeoutMs > policy.overallBudgetMs : false,
    });

    delayOnly += jittered;
    elapsed = endsAt;
  }

  return { attempts, worstCaseMs: elapsed, delayOnlyMs: delayOnly, droppedByBudget: dropped };
}

/** Milliseconds as something readable. */
export function humanMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export interface ResilienceFinding {
  level: "error" | "warn" | "info";
  subject: string;
  message: string;
}

/**
 * What is wrong with this policy.
 *
 * Every rule here is arithmetic against a number the designer already knows —
 * the caller's timeout, the fleet size — rather than an opinion about what a
 * good policy looks like.
 */
export function policyFindings(policy: RetryPolicy, simulation: Simulation, callerTimeoutMs?: number): ResilienceFinding[] {
  const findings: ResilienceFinding[] = [];

  if (policy.attempts <= 1) {
    findings.push({ level: "info", subject: "attempts", message: "One attempt means no retry. That is a legitimate choice for a non-idempotent write." });
  }

  if (callerTimeoutMs && simulation.worstCaseMs > callerTimeoutMs) {
    findings.push({
      level: "error",
      subject: "budget",
      message:
        `The worst case is ${humanMs(simulation.worstCaseMs)} but the caller gives up at ${humanMs(callerTimeoutMs)}. ` +
        "Everything after that point is work nobody is waiting for: the user already saw a timeout while the system was still busy on their behalf, holding a connection and a thread.",
    });
  }

  if (simulation.worstCaseMs > simulation.delayOnlyMs * 2 && policy.timeoutMs > 0) {
    findings.push({
      level: "warn",
      subject: "timeout",
      message:
        `The delays add up to ${humanMs(simulation.delayOnlyMs)}, but the worst case is ${humanMs(simulation.worstCaseMs)} — ` +
        `the per-attempt timeout of ${humanMs(policy.timeoutMs)} dominates. Sizing a retry policy by its backoff alone is how this gets missed.`,
    });
  }

  if (policy.jitter === "none" && policy.attempts > 1) {
    findings.push({
      level: "error",
      subject: "jitter",
      message:
        "No jitter. Every client that failed at the same moment retries at the same moment, so the service that just fell over is hit by the same spike again — and again, in lockstep. Jitter is not a refinement here; it decides whether the service can recover at all.",
    });
  }

  if (policy.strategy === "fixed" && policy.attempts > 3) {
    findings.push({
      level: "warn",
      subject: "backoff",
      message: `Fixed backoff with ${policy.attempts} attempts keeps the same pressure on a service that is already failing. Exponential gives it room to recover.`,
    });
  }

  if (policy.maxDelayMs < policy.baseMs) {
    findings.push({ level: "error", subject: "maxDelay", message: "The cap is below the base delay, so every delay is the cap and the backoff does nothing." });
  }

  if (simulation.droppedByBudget > 0) {
    findings.push({
      level: "info",
      subject: "budget",
      message: `${simulation.droppedByBudget} attempt(s) never happen — the overall budget of ${humanMs(policy.overallBudgetMs!)} runs out first. That is the budget working, but the attempt count is misleading as written.`,
    });
  }

  if (!policy.overallBudgetMs) {
    findings.push({
      level: "warn",
      subject: "budget",
      message: "No overall budget. Attempt count and backoff bound the retries, but nothing bounds the total — and the total is what the caller experiences.",
    });
  }

  if (policy.timeoutMs === 0) {
    findings.push({
      level: "error",
      subject: "timeout",
      message: "No per-attempt timeout. A request that hangs holds its attempt forever, and no retry policy can rescue it — the retry never starts.",
    });
  }

  return findings;
}

/**
 * What a fleet does to a recovering service.
 *
 * The number that makes the case for jitter: with none, every client lands in
 * the same instant.
 */
export function herdImpact(policy: RetryPolicy, clients: number): { peakPerSecond: number; spreadSeconds: number; message: string } {
  const window = policy.jitter === "none" ? 0 : baseDelay(policy, 2) / 1000;
  const spread = policy.jitter === "full" ? window : policy.jitter === "equal" ? window / 2 : window;

  if (spread <= 0) {
    return {
      peakPerSecond: clients,
      spreadSeconds: 0,
      message: `All ${clients.toLocaleString()} clients retry in the same instant. The service that just failed gets its whole load back at once, which is how a brief outage becomes a long one.`,
    };
  }

  const peak = Math.ceil(clients / spread);
  return {
    peakPerSecond: peak,
    spreadSeconds: spread,
    message: `${clients.toLocaleString()} clients spread across ${spread.toFixed(1)}s — about ${peak.toLocaleString()}/s at the peak instead of ${clients.toLocaleString()} at once.`,
  };
}

// ---------------------------------------------------------------------------
// What to retry
// ---------------------------------------------------------------------------

export interface StatusAdvice {
  status: number;
  retry: boolean;
  reason: string;
}

/**
 * Which HTTP statuses are worth retrying.
 *
 * The distinction is whether repeating the same request could plausibly succeed.
 * A 400 will be a 400 every time; a 503 is the server saying "not now". 429 is
 * the interesting one: retryable, but only at the rate the server named in
 * `Retry-After` — retrying a 429 on your own schedule is how a rate limit
 * becomes a ban.
 */
export const STATUS_ADVICE: StatusAdvice[] = [
  { status: 400, retry: false, reason: "The request is wrong. It will be wrong next time." },
  { status: 401, retry: false, reason: "Not authenticated. Refresh the token and send a new request — that is not a retry of this one." },
  { status: 403, retry: false, reason: "Authenticated and not permitted. Retrying cannot change that." },
  { status: 404, retry: false, reason: "Not found. Retrying only helps if you believe it is about to be created, which is a different design." },
  { status: 408, retry: true, reason: "The server timed out waiting for the request. Safe to retry." },
  { status: 409, retry: false, reason: "A conflict — usually something else changed the resource. Re-read and decide; do not blindly repeat." },
  { status: 422, retry: false, reason: "The payload was understood and rejected. It will be rejected again." },
  { status: 425, retry: true, reason: "Too early — the server is asking you to try again." },
  { status: 429, retry: true, reason: "Rate limited. Retry, but honour Retry-After: retrying on your own schedule is how a rate limit turns into a ban." },
  { status: 500, retry: true, reason: "An unhandled error. It may be transient — but if it is deterministic, retrying just multiplies the load." },
  { status: 501, retry: false, reason: "Not implemented. It will not be implemented by the next attempt." },
  { status: 502, retry: true, reason: "A bad gateway — usually one unhealthy instance. The next attempt may land on a healthy one." },
  { status: 503, retry: true, reason: "Unavailable. This is the server explicitly saying 'not now', and often carries Retry-After." },
  { status: 504, retry: true, reason: "A gateway timeout. Retryable — but the work may have completed upstream, so the operation must be idempotent." },
];

/** Should this status be retried? Unlisted 5xx yes, unlisted 4xx no. */
export function shouldRetry(status: number): StatusAdvice {
  const known = STATUS_ADVICE.find((a) => a.status === status);
  if (known) return known;
  if (status >= 500) return { status, retry: true, reason: "An unlisted server error. Server-side failures are usually worth one retry." };
  if (status >= 400) return { status, retry: false, reason: "An unlisted client error. The request is the problem, so repeating it will not help." };
  return { status, retry: false, reason: "Not an error." };
}

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

export interface IdempotencyCheck {
  id: string;
  question: string;
  why: string;
}

/**
 * The questions that decide whether retrying is safe at all.
 *
 * Written as questions rather than rules because the answers are specific to the
 * operation, and a checklist that pretends otherwise gets ticked without being
 * read. The first one is the one people get wrong: a timeout is not evidence
 * that nothing happened.
 */
export const IDEMPOTENCY_CHECKS: IdempotencyCheck[] = [
  {
    id: "timeout-meaning",
    question: "If this request times out, do you know whether it was applied?",
    why: "A timeout means the answer did not arrive, not that the work did not happen. Retrying a payment or an order after a timeout is exactly how one becomes two.",
  },
  {
    id: "key",
    question: "Does the request carry an idempotency key the server honours?",
    why: "A client-generated key, stored server-side with the result, turns a retry into a lookup. This is the only mechanism that makes an arbitrary write safe to repeat.",
  },
  {
    id: "natural-key",
    question: "Is there a natural key that makes a duplicate impossible?",
    why: "A unique constraint on order number or accession number turns a duplicate into a constraint violation, which is a much better failure than a duplicate record.",
  },
  {
    id: "conditional",
    question: "Could this be a conditional update instead?",
    why: "`If-Match` with an ETag, or a version column, makes the second write fail rather than overwrite. FHIR servers support this directly.",
  },
  {
    id: "side-effects",
    question: "What else fires when this succeeds — email, HL7 message, payment?",
    why: "The write may be idempotent while its side effects are not. A duplicate ORU sent to an EMR is a duplicate result on a patient's chart.",
  },
  {
    id: "partial",
    question: "Can this operation half-succeed?",
    why: "A batch that writes 40 of 100 rows and then fails is not retryable as a unit. Either make it transactional or make each row independently idempotent.",
  },
  {
    id: "downstream",
    question: "Does the thing you are calling retry internally as well?",
    why: "Retries multiply through layers: three at the gateway times three at the service is nine requests for one call. Retry at one layer, usually the outermost.",
  },
];

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

export interface BreakerPolicy {
  /** Fraction of failures that opens the circuit, 0–1. */
  failureRatio: number;
  /** Requests needed in the window before the ratio means anything. */
  minimumThroughput: number;
  samplingDurationMs: number;
  breakDurationMs: number;
}

export const DEFAULT_BREAKER: BreakerPolicy = {
  failureRatio: 0.5,
  minimumThroughput: 20,
  samplingDurationMs: 30_000,
  breakDurationMs: 15_000,
};

/**
 * Whether a breaker's numbers make sense together.
 *
 * The trap is minimum throughput against the sampling window: a breaker that
 * needs 100 requests in 10 seconds never opens on an endpoint that gets 5, so
 * it looks configured and does nothing.
 */
export function breakerFindings(breaker: BreakerPolicy, requestsPerSecond: number): ResilienceFinding[] {
  const findings: ResilienceFinding[] = [];
  const expected = requestsPerSecond * (breaker.samplingDurationMs / 1000);

  if (expected < breaker.minimumThroughput) {
    findings.push({
      level: "error",
      subject: "minimumThroughput",
      message:
        `At ${requestsPerSecond}/s this endpoint sees about ${Math.round(expected)} requests per ${humanMs(breaker.samplingDurationMs)} window, ` +
        `below the minimum of ${breaker.minimumThroughput}. The breaker can never open — it is configured and inert.`,
    });
  }

  if (breaker.failureRatio >= 1) {
    findings.push({ level: "error", subject: "failureRatio", message: "A ratio of 1 means the breaker only opens when everything fails, which is far too late to protect anything." });
  }

  if (breaker.breakDurationMs < 5000) {
    findings.push({
      level: "warn",
      subject: "breakDuration",
      message: `Breaking for only ${humanMs(breaker.breakDurationMs)} barely gives the downstream service time to recover before the probe traffic returns.`,
    });
  }

  if (breaker.breakDurationMs > 120_000) {
    findings.push({
      level: "warn",
      subject: "breakDuration",
      message: `Breaking for ${humanMs(breaker.breakDurationMs)} means a service that recovers in seconds still looks down for minutes.`,
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

/** The policy as .NET 8's standard resilience pipeline. */
export function toResiliencePipeline(policy: RetryPolicy, breaker: BreakerPolicy): string {
  const backoff = policy.strategy === "exponential" ? "DelayBackoffType.Exponential" : policy.strategy === "linear" ? "DelayBackoffType.Linear" : "DelayBackoffType.Constant";
  return `// .NET 8+ — Microsoft.Extensions.Resilience.
// Order matters: the retry wraps the timeout, so each attempt is bounded and
// the total is bounded by the outer timeout.
services.AddHttpClient<IMyClient, MyClient>()
    .AddResilienceHandler("my-pipeline", builder =>
    {
        builder.AddTimeout(TimeSpan.FromMilliseconds(${policy.overallBudgetMs ?? 60000})); // total budget

        builder.AddRetry(new HttpRetryStrategyOptions
        {
            MaxRetryAttempts = ${Math.max(0, policy.attempts - 1)},
            BackoffType = ${backoff},
            Delay = TimeSpan.FromMilliseconds(${policy.baseMs}),
            MaxDelay = TimeSpan.FromMilliseconds(${policy.maxDelayMs}),
            UseJitter = ${policy.jitter !== "none"},
            ShouldHandle = new PredicateBuilder<HttpResponseMessage>()
                .Handle<HttpRequestException>()
                .HandleResult(r => r.StatusCode is HttpStatusCode.RequestTimeout
                    or HttpStatusCode.TooManyRequests
                    or >= HttpStatusCode.InternalServerError),
        });

        builder.AddCircuitBreaker(new HttpCircuitBreakerStrategyOptions
        {
            FailureRatio = ${breaker.failureRatio},
            MinimumThroughput = ${breaker.minimumThroughput},
            SamplingDuration = TimeSpan.FromMilliseconds(${breaker.samplingDurationMs}),
            BreakDuration = TimeSpan.FromMilliseconds(${breaker.breakDurationMs}),
        });

        builder.AddTimeout(TimeSpan.FromMilliseconds(${policy.timeoutMs})); // per attempt
    });`;
}

/** The same policy in Polly v8 directly, for code that is not on HttpClient. */
export function toPolly(policy: RetryPolicy, breaker: BreakerPolicy): string {
  const backoff = policy.strategy === "exponential" ? "DelayBackoffType.Exponential" : policy.strategy === "linear" ? "DelayBackoffType.Linear" : "DelayBackoffType.Constant";
  return `// Polly v8 pipeline. Build once and reuse — a pipeline rebuilt per call
// has a circuit breaker that never sees enough traffic to open.
var pipeline = new ResiliencePipelineBuilder()
    .AddTimeout(TimeSpan.FromMilliseconds(${policy.overallBudgetMs ?? 60000}))
    .AddRetry(new RetryStrategyOptions
    {
        MaxRetryAttempts = ${Math.max(0, policy.attempts - 1)},
        BackoffType = ${backoff},
        Delay = TimeSpan.FromMilliseconds(${policy.baseMs}),
        MaxDelay = TimeSpan.FromMilliseconds(${policy.maxDelayMs}),
        UseJitter = ${policy.jitter !== "none"},
    })
    .AddCircuitBreaker(new CircuitBreakerStrategyOptions
    {
        FailureRatio = ${breaker.failureRatio},
        MinimumThroughput = ${breaker.minimumThroughput},
        SamplingDuration = TimeSpan.FromMilliseconds(${breaker.samplingDurationMs}),
        BreakDuration = TimeSpan.FromMilliseconds(${breaker.breakDurationMs}),
    })
    .AddTimeout(TimeSpan.FromMilliseconds(${policy.timeoutMs}))
    .Build();

await pipeline.ExecuteAsync(async token => await CallAsync(token), cancellationToken);`;
}

// ---------------------------------------------------------------------------
// Poison messages
// ---------------------------------------------------------------------------

export interface PoisonStep {
  step: string;
  detail: string;
}

/**
 * What to do about a message that cannot be processed.
 *
 * The queue equivalent of a retry policy, and the failure mode is different: an
 * HTTP retry gives up, a queue retry does not. A message that always fails and
 * has nowhere to go is redelivered forever, and the handler spends its whole
 * capacity on one bad message.
 */
export const POISON_PLAYBOOK: PoisonStep[] = [
  {
    step: "Bound the redeliveries",
    detail: "Max delivery count on Service Bus, or a dead-letter exchange with a retry count header on RabbitMQ. Without a bound, a message that always fails is redelivered forever and the handler makes no progress on anything else.",
  },
  {
    step: "Dead-letter with the reason",
    detail: "Record why on the way out — the exception type, the message id, the attempt count. A dead-letter queue whose messages carry no reason means opening each one by hand later.",
  },
  {
    step: "Alert on the dead-letter queue, not the error rate",
    detail: "A dead-lettered message is a message nobody will ever process. Depth on the DLQ is the alert that matters; a handler exception rate can be noisy and self-correcting.",
  },
  {
    step: "Separate poison from unavailable",
    detail: "A malformed message will fail identically forever and belongs in the DLQ immediately. A downstream outage will fix itself, and those messages should back off and stay in the queue. Treating them the same either dead-letters good work or retries bad messages for hours.",
  },
  {
    step: "Make replay a routine, not a project",
    detail: "Fix the handler, then replay the DLQ. If replay needs a developer with a script, dead letters accumulate until they exceed the entity's quota — at which point sends start failing and the incident is much larger.",
  },
  {
    step: "Keep the handler idempotent regardless",
    detail: "At-least-once delivery means a message you completed can be delivered again after a lock expiry. That is not an error condition; it is the contract.",
  },
];
