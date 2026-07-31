/**
 * Collection runner.
 *
 * Runs a list of requests in order, evaluating each one's assertions, and reports a
 * summary — the thing that turns saved requests into a smoke test you can run after a
 * deploy.
 *
 * The sender is injected rather than imported, so the orchestration (ordering, delays,
 * stop-on-failure, cancellation, aggregation) is testable without a network.
 */

import { runAssertions, summarize, type AssertionResult } from "./apiAssert";
import type { ApiRequest, ApiResponse } from "./apiTypes";

export interface RunOptions {
  /** Milliseconds to wait between requests, for rate-limited APIs. */
  delayMs?: number;
  /** Repeat the whole list this many times. */
  iterations?: number;
  /** Abandon the run as soon as a request fails or an assertion fails. */
  stopOnFailure?: boolean;
}

export interface RunItemResult {
  request: ApiRequest;
  iteration: number;
  response?: ApiResponse;
  /** Transport failure — a request that never produced a response. */
  error?: string;
  assertions: AssertionResult[];
  passed: boolean;
  timeMs: number;
}

export interface RunSummary {
  total: number;
  passed: number;
  failed: number;
  assertionsPassed: number;
  assertionsFailed: number;
  totalTimeMs: number;
  /** True when the run ended early — stop-on-failure or cancellation. */
  stoppedEarly: boolean;
}

export interface RunResult {
  items: RunItemResult[];
  summary: RunSummary;
}

export type Sender = (req: ApiRequest) => Promise<ApiResponse>;

export interface RunHooks {
  /** Called before each request, for progress display. */
  onStart?: (req: ApiRequest, index: number, iteration: number) => void;
  /** Called after each request completes or fails. */
  onResult?: (result: RunItemResult) => void;
  /** Return true to abandon the run — how the Stop button works. */
  isCancelled?: () => boolean;
  /** Injected so tests do not actually wait. */
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * A request passes when it produced a response and every enabled assertion held.
 *
 * A request with no assertions passes on any response — including a 500. That is
 * deliberate: the runner reports what was asked for, and "should not be a 500" is an
 * assertion the user can add.
 */
export function itemPassed(response: ApiResponse | undefined, assertions: AssertionResult[]): boolean {
  if (!response) return false;
  return assertions.every((a) => a.passed);
}

export async function runCollection(
  requests: ApiRequest[],
  send: Sender,
  options: RunOptions = {},
  hooks: RunHooks = {},
): Promise<RunResult> {
  const iterations = Math.max(1, options.iterations ?? 1);
  const delayMs = Math.max(0, options.delayMs ?? 0);
  const sleep = hooks.sleep ?? realSleep;

  const items: RunItemResult[] = [];
  let stoppedEarly = false;

  outer: for (let iteration = 1; iteration <= iterations; iteration++) {
    for (let index = 0; index < requests.length; index++) {
      if (hooks.isCancelled?.()) {
        stoppedEarly = true;
        break outer;
      }

      const request = requests[index];
      hooks.onStart?.(request, index, iteration);

      const started = Date.now();
      let result: RunItemResult;
      try {
        const response = await send(request);
        const assertions = runAssertions(request.assertions, response);
        result = {
          request,
          iteration,
          response,
          assertions,
          passed: itemPassed(response, assertions),
          timeMs: response.timeMs || Date.now() - started,
        };
      } catch (e) {
        result = {
          request,
          iteration,
          error: e instanceof Error ? e.message : String(e),
          assertions: [],
          passed: false,
          timeMs: Date.now() - started,
        };
      }

      items.push(result);
      hooks.onResult?.(result);

      if (!result.passed && options.stopOnFailure) {
        stoppedEarly = true;
        break outer;
      }

      const isLast = iteration === iterations && index === requests.length - 1;
      if (delayMs > 0 && !isLast) await sleep(delayMs);
    }
  }

  return { items, summary: summarizeRun(items, stoppedEarly) };
}

export function summarizeRun(items: RunItemResult[], stoppedEarly = false): RunSummary {
  const assertionTotals = items.reduce(
    (acc, item) => {
      const s = summarize(item.assertions);
      acc.passed += s.passed;
      acc.failed += s.failed;
      return acc;
    },
    { passed: 0, failed: 0 },
  );

  const passed = items.filter((i) => i.passed).length;
  return {
    total: items.length,
    passed,
    failed: items.length - passed,
    assertionsPassed: assertionTotals.passed,
    assertionsFailed: assertionTotals.failed,
    totalTimeMs: items.reduce((n, i) => n + i.timeMs, 0),
    stoppedEarly,
  };
}

/** Plain-text report for the clipboard, a CI log or a bug report. */
export function runReportText(result: RunResult): string {
  const lines = result.items.map((item) => {
    const mark = item.passed ? "PASS" : "FAIL";
    const status = item.error ? `error: ${item.error}` : `${item.response?.status} ${item.response?.statusText ?? ""}`.trim();
    const checks = item.assertions.length
      ? ` [${item.assertions.filter((a) => a.passed).length}/${item.assertions.length} checks]`
      : "";
    const iteration = item.iteration > 1 ? ` (iteration ${item.iteration})` : "";
    return `${mark}  ${item.request.method} ${item.request.name}${iteration} — ${status}${checks} ${item.timeMs}ms`;
  });

  const s = result.summary;
  lines.push(
    "",
    `${s.passed}/${s.total} requests passed · ${s.assertionsPassed}/${s.assertionsPassed + s.assertionsFailed} checks passed · ${s.totalTimeMs} ms total${s.stoppedEarly ? " · stopped early" : ""}`,
  );
  return lines.join("\n");
}
