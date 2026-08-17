import { describe, expect, it } from "vitest";
import {
  applyJitter,
  baseDelay,
  breakerFindings,
  DEFAULT_BREAKER,
  DEFAULT_POLICY,
  herdImpact,
  humanMs,
  IDEMPOTENCY_CHECKS,
  policyFindings,
  POISON_PLAYBOOK,
  seededRandom,
  shouldRetry,
  simulate,
  STATUS_ADVICE,
  toPolly,
  toResiliencePipeline,
  type RetryPolicy,
} from "./resilience";

const policy = (over: Partial<RetryPolicy> = {}): RetryPolicy => ({ ...DEFAULT_POLICY, ...over });

describe("baseDelay", () => {
  it("doubles for exponential, starting at the base", () => {
    const p = policy({ strategy: "exponential", baseMs: 1000, maxDelayMs: 60_000 });
    expect([1, 2, 3, 4, 5].map((n) => baseDelay(p, n))).toEqual([0, 1000, 2000, 4000, 8000]);
  });

  it("steps for linear and holds for fixed", () => {
    const linear = policy({ strategy: "linear", baseMs: 500, maxDelayMs: 60_000 });
    expect([1, 2, 3, 4].map((n) => baseDelay(linear, n))).toEqual([0, 500, 1000, 1500]);

    const fixed = policy({ strategy: "fixed", baseMs: 500 });
    expect([2, 3, 4].map((n) => baseDelay(fixed, n))).toEqual([500, 500, 500]);
  });

  it("caps at maxDelay", () => {
    const p = policy({ strategy: "exponential", baseMs: 1000, maxDelayMs: 3000 });
    expect([2, 3, 4, 5].map((n) => baseDelay(p, n))).toEqual([1000, 2000, 3000, 3000]);
  });

  it("never delays before the first attempt", () => {
    expect(baseDelay(policy(), 1)).toBe(0);
    expect(baseDelay(policy(), 0)).toBe(0);
  });
});

describe("applyJitter", () => {
  const random = () => 0.5;

  it("leaves the delay alone when there is no jitter", () => {
    expect(applyJitter(policy({ jitter: "none" }), 1000, random, 1000)).toBe(1000);
  });

  it("full jitter spans the whole window", () => {
    const p = policy({ jitter: "full" });
    expect(applyJitter(p, 1000, () => 0, 1000)).toBe(0);
    expect(applyJitter(p, 1000, () => 0.999, 1000)).toBe(999);
  });

  it("equal jitter keeps half the delay fixed", () => {
    const p = policy({ jitter: "equal" });
    expect(applyJitter(p, 1000, () => 0, 1000)).toBe(500);
    expect(applyJitter(p, 1000, () => 1, 1000)).toBe(1000);
  });

  it("decorrelated grows from the previous delay, not the attempt number", () => {
    const p = policy({ jitter: "decorrelated", baseMs: 100, maxDelayMs: 20_000 });
    const small = applyJitter(p, 0, () => 1, 100);
    const large = applyJitter(p, 0, () => 1, 5000);
    expect(large).toBeGreaterThan(small);
    expect(applyJitter(p, 0, () => 1, 100_000)).toBeLessThanOrEqual(20_000);
  });

  it("is reproducible for a given seed", () => {
    const a = seededRandom(7);
    const b = seededRandom(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(seededRandom(7)()).not.toBe(seededRandom(8)());
  });
});

describe("simulate", () => {
  it("counts the timeouts, not just the delays — the whole point", () => {
    const p = policy({ attempts: 4, strategy: "exponential", baseMs: 1000, jitter: "none", timeoutMs: 30_000, overallBudgetMs: undefined });
    const run = simulate(p);
    // Delays are 0 + 1 + 2 + 4 = 7s; timeouts are 4 × 30s.
    expect(run.delayOnlyMs).toBe(7000);
    expect(run.worstCaseMs).toBe(127_000);
  });

  it("starts the first attempt immediately", () => {
    const run = simulate(policy({ jitter: "none" }));
    expect(run.attempts[0]).toMatchObject({ attempt: 1, delayMs: 0, startsAtMs: 0 });
  });

  it("stops when the overall budget runs out, and says how many were dropped", () => {
    const run = simulate(policy({ attempts: 6, jitter: "none", baseMs: 1000, timeoutMs: 5000, overallBudgetMs: 12_000 }));
    expect(run.worstCaseMs).toBeLessThanOrEqual(12_000);
    expect(run.droppedByBudget).toBeGreaterThan(0);
    expect(run.attempts.length).toBeLessThan(6);
  });

  it("marks the attempt the budget cut short", () => {
    const run = simulate(policy({ attempts: 3, jitter: "none", baseMs: 1000, timeoutMs: 10_000, overallBudgetMs: 5000 }));
    expect(run.attempts.at(-1)!.cutByBudget).toBe(true);
  });

  it("gives the same schedule for the same seed", () => {
    const p = policy({ jitter: "full" });
    expect(simulate(p, seededRandom(3)).attempts).toEqual(simulate(p, seededRandom(3)).attempts);
  });

  it("always runs at least one attempt", () => {
    expect(simulate(policy({ attempts: 0 })).attempts).toHaveLength(1);
  });
});

describe("policyFindings", () => {
  const messages = (findings: { message: string }[]) => findings.map((f) => f.message).join(" | ");

  it("says when the policy outlives the caller", () => {
    const p = policy({ attempts: 4, timeoutMs: 30_000, jitter: "none", overallBudgetMs: undefined });
    const finding = policyFindings(p, simulate(p), 30_000).find((f) => f.level === "error");
    expect(finding?.message).toMatch(/caller gives up at 30/);
    expect(finding?.message).toMatch(/nobody is waiting for/);
  });

  it("points out that the timeout, not the backoff, dominates", () => {
    const p = policy({ attempts: 4, baseMs: 100, timeoutMs: 30_000, jitter: "none", overallBudgetMs: undefined });
    expect(messages(policyFindings(p, simulate(p)))).toMatch(/per-attempt timeout of 30 s dominates/);
  });

  it("treats no jitter as an error, because it decides whether the service recovers", () => {
    const p = policy({ jitter: "none" });
    const finding = policyFindings(p, simulate(p)).find((f) => f.subject === "jitter");
    expect(finding?.level).toBe("error");
    expect(finding?.message).toMatch(/lockstep/);
  });

  it("says nothing about jitter when there is only one attempt", () => {
    const p = policy({ attempts: 1, jitter: "none" });
    expect(policyFindings(p, simulate(p)).some((f) => f.subject === "jitter")).toBe(false);
  });

  it("catches a cap below the base, which disables the backoff entirely", () => {
    const p = policy({ baseMs: 5000, maxDelayMs: 1000 });
    expect(messages(policyFindings(p, simulate(p)))).toMatch(/every delay is the cap/);
  });

  it("wants an overall budget and a per-attempt timeout", () => {
    expect(messages(policyFindings(policy({ overallBudgetMs: undefined }), simulate(policy({ overallBudgetMs: undefined }))))).toMatch(/nothing bounds the total/);
    const noTimeout = policy({ timeoutMs: 0 });
    expect(messages(policyFindings(noTimeout, simulate(noTimeout)))).toMatch(/the retry never starts/);
  });

  it("calls one attempt a legitimate choice rather than a mistake", () => {
    const p = policy({ attempts: 1 });
    const finding = policyFindings(p, simulate(p)).find((f) => f.subject === "attempts");
    expect(finding?.level).toBe("info");
    expect(finding?.message).toMatch(/non-idempotent write/);
  });
});

describe("herdImpact", () => {
  it("says everything lands at once without jitter", () => {
    const impact = herdImpact(policy({ jitter: "none" }), 500);
    expect(impact.spreadSeconds).toBe(0);
    expect(impact.peakPerSecond).toBe(500);
    expect(impact.message).toMatch(/same instant/);
  });

  it("spreads the fleet with full jitter", () => {
    const impact = herdImpact(policy({ jitter: "full", baseMs: 4000 }), 4000);
    expect(impact.spreadSeconds).toBe(4);
    expect(impact.peakPerSecond).toBe(1000);
  });

  it("spreads less with equal jitter, which is the trade-off", () => {
    const full = herdImpact(policy({ jitter: "full", baseMs: 4000 }), 1000);
    const equal = herdImpact(policy({ jitter: "equal", baseMs: 4000 }), 1000);
    expect(equal.peakPerSecond).toBeGreaterThan(full.peakPerSecond);
  });
});

describe("shouldRetry", () => {
  it("retries what could plausibly succeed next time", () => {
    for (const status of [408, 425, 429, 500, 502, 503, 504]) expect(shouldRetry(status).retry).toBe(true);
  });

  it("does not retry what will fail identically", () => {
    for (const status of [400, 401, 403, 404, 409, 422, 501]) expect(shouldRetry(status).retry).toBe(false);
  });

  it("says why 429 is the awkward one", () => {
    expect(shouldRetry(429).reason).toMatch(/Retry-After/);
    expect(shouldRetry(429).reason).toMatch(/turns into a ban/);
  });

  it("warns that a retried 504 may already have been applied upstream", () => {
    expect(shouldRetry(504).reason).toMatch(/idempotent/);
  });

  it("falls back sensibly for statuses it does not list", () => {
    expect(shouldRetry(507).retry).toBe(true);
    expect(shouldRetry(418).retry).toBe(false);
    expect(shouldRetry(200).retry).toBe(false);
  });

  it("gives every listed status a reason worth reading", () => {
    for (const advice of STATUS_ADVICE) expect(advice.reason.length).toBeGreaterThan(25);
  });
});

describe("breakerFindings", () => {
  it("catches the breaker that can never open", () => {
    const finding = breakerFindings({ ...DEFAULT_BREAKER, minimumThroughput: 100, samplingDurationMs: 10_000 }, 5)[0];
    expect(finding.level).toBe("error");
    expect(finding.message).toMatch(/configured and inert/);
  });

  it("is content when the traffic clears the minimum", () => {
    expect(breakerFindings(DEFAULT_BREAKER, 10)).toEqual([]);
  });

  it("flags a break window too short to help and one too long to forgive", () => {
    expect(breakerFindings({ ...DEFAULT_BREAKER, breakDurationMs: 1000 }, 10)[0].message).toMatch(/barely gives/);
    expect(breakerFindings({ ...DEFAULT_BREAKER, breakDurationMs: 300_000 }, 10)[0].message).toMatch(/looks down for minutes/);
  });

  it("rejects a ratio that only trips when everything fails", () => {
    expect(breakerFindings({ ...DEFAULT_BREAKER, failureRatio: 1 }, 10).some((f) => /far too late/.test(f.message))).toBe(true);
  });
});

describe("humanMs", () => {
  it("reads naturally at each scale", () => {
    expect(humanMs(250)).toBe("250 ms");
    expect(humanMs(1500)).toBe("1.5 s");
    expect(humanMs(45_000)).toBe("45 s");
    expect(humanMs(127_000)).toBe("2m 07s");
  });
});

describe("code generation", () => {
  const code = toResiliencePipeline(policy({ attempts: 4, strategy: "exponential", jitter: "full" }), DEFAULT_BREAKER);

  it("emits retries as attempts minus one, which is what the library means", () => {
    expect(code).toContain("MaxRetryAttempts = 3");
  });

  it("orders the timeouts so each attempt and the total are both bounded", () => {
    expect(code.indexOf("total budget")).toBeLessThan(code.indexOf("per attempt"));
    expect(code).toMatch(/Order matters/);
  });

  it("carries the jitter setting through", () => {
    expect(code).toContain("UseJitter = true");
    expect(toResiliencePipeline(policy({ jitter: "none" }), DEFAULT_BREAKER)).toContain("UseJitter = false");
  });

  it("emits Polly with the warning that matters about pipeline lifetime", () => {
    const polly = toPolly(policy(), DEFAULT_BREAKER);
    expect(polly).toMatch(/Build once and reuse/);
    expect(polly).toContain("AddCircuitBreaker");
  });

  it("maps each backoff strategy to its enum", () => {
    expect(toPolly(policy({ strategy: "linear" }), DEFAULT_BREAKER)).toContain("DelayBackoffType.Linear");
    expect(toPolly(policy({ strategy: "fixed" }), DEFAULT_BREAKER)).toContain("DelayBackoffType.Constant");
  });
});

describe("checklists", () => {
  it("leads the idempotency checks with what a timeout actually means", () => {
    expect(IDEMPOTENCY_CHECKS[0].why).toMatch(/answer did not arrive/);
    expect(IDEMPOTENCY_CHECKS.every((c) => c.question.endsWith("?"))).toBe(true);
  });

  it("covers side effects and layered retries, which are the ones people miss", () => {
    const ids = IDEMPOTENCY_CHECKS.map((c) => c.id);
    expect(ids).toContain("side-effects");
    expect(ids).toContain("downstream");
  });

  it("separates poison from merely unavailable in the queue playbook", () => {
    expect(POISON_PLAYBOOK.some((s) => /Separate poison from unavailable/.test(s.step))).toBe(true);
    expect(POISON_PLAYBOOK.every((s) => s.detail.length > 60)).toBe(true);
  });
});
