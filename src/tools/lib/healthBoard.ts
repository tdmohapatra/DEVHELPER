/**
 * Watching the endpoints an integration depends on.
 *
 * The gap this fills is narrow and real. Proper monitoring lives in Azure and
 * watches production; what it does not watch is the third-party sandbox you are
 * integrating against this week, the on-premise service reachable only from your
 * laptop, or the endpoint you have just changed and want to keep an eye on for
 * an hour. Those get checked by hand, by refreshing a browser tab.
 *
 * Three deliberate choices shape it:
 *
 * **Latency is reported as percentiles, never as an average.** An average hides
 * exactly the failure people care about: an endpoint answering in 40 ms for
 * nineteen calls and 9 seconds for the twentieth averages 490 ms and looks
 * healthy, while one user in twenty is timing out. p95 says so immediately.
 *
 * **Availability is expressed as an error budget.** "99.5%" means nothing at a
 * glance; "you have 3 failures left this window" is a decision. It also stops
 * the reflex of treating a single blip as an outage.
 *
 * **Down means consecutive failures, not one.** A single failed probe is a
 * network hiccup as often as it is anything else. Requiring two in a row costs
 * one interval of detection time and removes almost all of the noise.
 *
 * The polling itself belongs to the screen; everything here is arithmetic over
 * results that have already happened, so it is pure and testable.
 */

import type { ParsedEvent } from "./debugSession";

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export interface Watcher {
  id: string;
  name: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  /** Status that counts as healthy. 0 means "any 2xx". */
  expectStatus: number;
  /** Text the body must contain. A 200 from a load balancer is not the service. */
  expectBody?: string;
  intervalMs: number;
  timeoutMs: number;
  /** Above this, a response counts as slow even though it succeeded. */
  sloMs: number;
  enabled: boolean;
}

export interface Probe {
  at: number;
  ok: boolean;
  status: number;
  ms: number;
  error?: string;
  /** Succeeded but took longer than the SLO. */
  slow?: boolean;
}

export const DEFAULT_WATCHER: Omit<Watcher, "id" | "name" | "url"> = {
  method: "GET",
  headers: {},
  expectStatus: 0,
  intervalMs: 30_000,
  timeoutMs: 10_000,
  sloMs: 1000,
  enabled: true,
};

/** How many probes to keep per watcher. At 30s that is about two hours. */
export const WINDOW = 240;

/** Consecutive failures before a watcher is called down. */
export const DOWN_AFTER = 2;

// ---------------------------------------------------------------------------
// Judging one probe
// ---------------------------------------------------------------------------

export interface ProbeInput {
  status: number;
  ms: number;
  body: string;
  error?: string;
}

/**
 * Whether a response counts as healthy.
 *
 * The body check earns its place: a 200 from a load balancer, a WAF splash page
 * or a login redirect is not the service answering, and an availability figure
 * built on those is worse than none.
 */
export function judge(watcher: Watcher, input: ProbeInput, at: number): Probe {
  if (input.error) {
    return { at, ok: false, status: 0, ms: input.ms, error: input.error };
  }

  const statusOk = watcher.expectStatus === 0 ? input.status >= 200 && input.status < 300 : input.status === watcher.expectStatus;
  if (!statusOk) {
    return {
      at,
      ok: false,
      status: input.status,
      ms: input.ms,
      error: watcher.expectStatus === 0 ? `${input.status}, expected a 2xx` : `${input.status}, expected ${watcher.expectStatus}`,
    };
  }

  if (watcher.expectBody && !input.body.includes(watcher.expectBody)) {
    return {
      at,
      ok: false,
      status: input.status,
      ms: input.ms,
      error: `${input.status} but the body does not contain "${watcher.expectBody}" — something answered, and it was not this service.`,
    };
  }

  return { at, ok: true, status: input.status, ms: input.ms, slow: watcher.sloMs > 0 && input.ms > watcher.sloMs };
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

/**
 * Nearest-rank percentile.
 *
 * Not interpolated: with a handful of samples, interpolation invents a latency
 * that was never measured, and the whole point of p95 is that it is a real
 * request somebody actually waited for.
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

export type HealthState = "unknown" | "up" | "slow" | "degraded" | "down";

export interface Health {
  state: HealthState;
  probes: number;
  failures: number;
  /** 0–100. */
  availability: number;
  p50: number;
  p95: number;
  p99: number;
  /** Successes that were over the SLO. */
  slowCount: number;
  consecutiveFailures: number;
  lastProbe?: Probe;
  /** Since when the current state has held. */
  since?: number;
  message: string;
}

/**
 * Roll a window of probes into a state.
 *
 * `slow` is a state of its own rather than a flavour of `up`, because an
 * endpoint that answers every time in nine seconds is not healthy and is not
 * down — and calling it either loses the only interesting thing about it.
 */
export function health(watcher: Watcher, probes: Probe[]): Health {
  if (probes.length === 0) {
    return { state: "unknown", probes: 0, failures: 0, availability: 0, p50: 0, p95: 0, p99: 0, slowCount: 0, consecutiveFailures: 0, message: "Not checked yet." };
  }

  const failures = probes.filter((p) => !p.ok).length;
  const successes = probes.filter((p) => p.ok);
  const durations = successes.map((p) => p.ms);
  const slowCount = successes.filter((p) => p.slow).length;
  const availability = ((probes.length - failures) / probes.length) * 100;

  let consecutive = 0;
  for (let i = probes.length - 1; i >= 0 && !probes[i].ok; i--) consecutive++;

  const p95 = percentile(durations, 95);
  const last = probes[probes.length - 1];

  let state: HealthState;
  let message: string;
  if (consecutive >= DOWN_AFTER) {
    state = "down";
    message = `${consecutive} consecutive failures. Last: ${last.error ?? "failed"}.`;
  } else if (!last.ok) {
    state = "degraded";
    message = `The last probe failed (${last.error ?? "failed"}), but the one before succeeded — one failure is a hiccup as often as an outage, so this is not called down until ${DOWN_AFTER} in a row.`;
  } else if (failures > 0) {
    state = "degraded";
    message = `${failures} of ${probes.length} probes failed in this window, though the latest succeeded.`;
  } else if (watcher.sloMs > 0 && p95 > watcher.sloMs) {
    state = "slow";
    message = `Every probe succeeded, but p95 is ${Math.round(p95)} ms against an SLO of ${watcher.sloMs} ms. At least one call in twenty is this slow — an average would hide it entirely.`;
  } else {
    state = "up";
    message = `${probes.length} probes, all healthy, p95 ${Math.round(p95)} ms.`;
  }

  // When the current state began: walk back while the outcome is unchanged.
  let since = last.at;
  for (let i = probes.length - 1; i >= 0; i--) {
    if (probes[i].ok !== last.ok) break;
    since = probes[i].at;
  }

  return {
    state,
    probes: probes.length,
    failures,
    availability,
    p50: percentile(durations, 50),
    p95,
    p99: percentile(durations, 99),
    slowCount,
    consecutiveFailures: consecutive,
    lastProbe: last,
    since,
    message,
  };
}

// ---------------------------------------------------------------------------
// Error budget
// ---------------------------------------------------------------------------

export interface ErrorBudget {
  target: number;
  /** Failures the target allows over this many probes. */
  allowed: number;
  used: number;
  remaining: number;
  /** 0–100: how much of the budget has been spent. */
  burned: number;
  message: string;
}

/**
 * The availability target as a number of failures.
 *
 * "99.5%" is not a quantity anyone can act on; "3 failures left in this window"
 * is. It also converts an argument about whether one blip counts into
 * arithmetic.
 */
export function errorBudget(probes: number, failures: number, target = 99.5): ErrorBudget {
  const allowed = Math.floor(probes * (1 - target / 100));
  const remaining = Math.max(0, allowed - failures);
  const burned = allowed === 0 ? (failures > 0 ? 100 : 0) : Math.min(100, (failures / allowed) * 100);

  let message: string;
  if (probes === 0) message = "No probes yet.";
  else if (allowed === 0) {
    message = `At ${target}% over only ${probes} probes the budget rounds to zero failures — the window is too short to say anything. Keep watching.`;
  } else if (failures > allowed) {
    message = `${failures} failures against a budget of ${allowed}. The target is already missed for this window.`;
  } else {
    message = `${remaining} of ${allowed} failures left in this window.`;
  }

  return { target, allowed, used: failures, remaining, burned, message };
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

/** Is this watcher due? */
export function isDue(watcher: Watcher, lastAt: number | undefined, now: number): boolean {
  if (!watcher.enabled) return false;
  if (lastAt === undefined) return true;
  return now - lastAt >= watcher.intervalMs;
}

/**
 * Stagger the first probe of each watcher.
 *
 * Otherwise every watcher fires on the same tick forever, and a board with
 * twenty endpoints sends twenty requests in one instant every thirty seconds —
 * the same thundering herd the Retry Designer warns about, built by the
 * monitoring.
 */
export function stagger(index: number, count: number, intervalMs: number): number {
  if (count <= 1) return 0;
  return Math.round((index / count) * intervalMs);
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

/**
 * A state change as a Debug Session event.
 *
 * Only changes: a watcher that has been up for an hour has nothing to say, and a
 * timeline full of successful probes buries the one entry that matters.
 */
export function stateChangeEvent(watcher: Watcher, from: HealthState, to: HealthState, current: Health): ParsedEvent {
  const worse = rank(to) > rank(from);
  return {
    source: "http",
    status: to === "down" ? "error" : to === "degraded" || to === "slow" ? "warn" : "ok",
    service: watcher.name,
    title: `${watcher.name}: ${from} → ${to}`,
    error: worse ? current.message : undefined,
    durationMs: current.lastProbe?.ms,
    payload: JSON.stringify({
      url: watcher.url,
      state: to,
      availability: Number(current.availability.toFixed(2)),
      p95: Math.round(current.p95),
      consecutiveFailures: current.consecutiveFailures,
    }),
  };
}

function rank(state: HealthState): number {
  return { unknown: 0, up: 1, slow: 2, degraded: 3, down: 4 }[state];
}

/** The board in one line, for a status bar or a handover note. */
export function boardSummary(entries: { watcher: Watcher; health: Health }[]): string {
  if (entries.length === 0) return "Nothing being watched.";
  const counts: Partial<Record<HealthState, number>> = {};
  for (const entry of entries) counts[entry.health.state] = (counts[entry.health.state] ?? 0) + 1;
  const order: HealthState[] = ["down", "degraded", "slow", "up", "unknown"];
  return order
    .filter((state) => counts[state])
    .map((state) => `${counts[state]} ${state}`)
    .join(", ");
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** Header names whose values are credentials and must not be written to disk. */
const SECRET_HEADERS = /^(authorization|proxy-authorization|x-api-key|api-key|apikey|x-auth-token|cookie|x-functions-key)$/i;

/**
 * A watcher with its credentials stripped, for persisting.
 *
 * The header *names* are kept so the shape of the request survives a restart and
 * it is obvious what has to be filled back in. The values are not: this store is
 * copied by a workspace backup, and a bearer token in a backup is a credential
 * in a file somebody will email.
 */
export function withoutSecrets(watcher: Watcher): Watcher {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(watcher.headers)) {
    headers[key] = SECRET_HEADERS.test(key) ? "" : value;
  }
  return { ...watcher, headers };
}

/** Which headers on this watcher are waiting to be filled back in. */
export function missingSecrets(watcher: Watcher): string[] {
  return Object.entries(watcher.headers)
    .filter(([key, value]) => SECRET_HEADERS.test(key) && !value)
    .map(([key]) => key);
}
