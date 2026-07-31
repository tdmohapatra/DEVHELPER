/**
 * Response assertions — the "Tests" tab without a scripting engine.
 *
 * Postman runs arbitrary JavaScript against the response. That is powerful and also a
 * sandbox liability in a desktop tool, so checks here are declarative: a kind, an
 * operator and an expected value. The JSONPath engine does the extraction, which keeps
 * the expressive part (`$.data.items[0].id`) without executing user code.
 */

import { queryJsonPath } from "./jsonPath";
import type { ApiResponse, Assertion, AssertionOp } from "./apiTypes";

export interface AssertionResult {
  assertion: Assertion;
  passed: boolean;
  /** What the response actually produced, rendered for display. */
  actual: string;
  /** Why it failed, when the reason is not obvious from actual vs expected. */
  detail?: string;
}

const NUMERIC_OPS: AssertionOp[] = ["lessThan", "greaterThan"];

/** Human label for the check, used in the UI and in exported results. */
export function describeAssertion(a: Assertion): string {
  const target = a.target ? ` ${a.target}` : "";
  switch (a.kind) {
    case "status":
      return `Status ${opLabel(a.op)} ${a.expected ?? ""}`.trim();
    case "responseTime":
      return `Response time ${opLabel(a.op)} ${a.expected ?? ""} ms`.trim();
    case "header":
      return `Header${target} ${opLabel(a.op)} ${a.expected ?? ""}`.trim();
    case "jsonPath":
      return `${a.target || "$"} ${opLabel(a.op)} ${a.expected ?? ""}`.trim();
    case "bodyContains":
      return `Body contains ${a.expected ?? ""}`;
  }
}

function opLabel(op: AssertionOp): string {
  return {
    equals: "=",
    notEquals: "≠",
    contains: "contains",
    lessThan: "<",
    greaterThan: ">",
    exists: "exists",
  }[op];
}

function compare(op: AssertionOp, actual: string | undefined, expected: string): { passed: boolean; detail?: string } {
  if (op === "exists") return { passed: actual !== undefined };
  if (actual === undefined) return { passed: false, detail: "not present in the response" };

  if (NUMERIC_OPS.includes(op)) {
    const a = Number(actual);
    const e = Number(expected);
    if (Number.isNaN(a) || Number.isNaN(e)) return { passed: false, detail: "not a number" };
    return { passed: op === "lessThan" ? a < e : a > e };
  }

  switch (op) {
    case "equals":
      return { passed: actual === expected };
    case "notEquals":
      return { passed: actual !== expected };
    case "contains":
      return { passed: actual.includes(expected) };
    default:
      return { passed: false, detail: `unsupported operator "${op}"` };
  }
}

/** Extract the value an assertion is about. `undefined` means "absent". */
function actualFor(a: Assertion, res: ApiResponse): { value: string | undefined; detail?: string } {
  switch (a.kind) {
    case "status":
      return { value: String(res.status) };
    case "responseTime":
      return { value: String(res.timeMs) };
    case "bodyContains":
      return { value: res.body };
    case "header": {
      const wanted = (a.target ?? "").toLowerCase();
      const hit = Object.entries(res.headers).find(([k]) => k.toLowerCase() === wanted);
      return { value: hit?.[1] };
    }
    case "jsonPath": {
      let parsed: unknown;
      try {
        parsed = JSON.parse(res.body);
      } catch {
        return { value: undefined, detail: "the response body is not JSON" };
      }
      try {
        const matches = queryJsonPath(parsed, a.target || "$");
        if (matches.length === 0) return { value: undefined };
        const v = matches[0].value;
        return { value: typeof v === "string" ? v : JSON.stringify(v) };
      } catch (e) {
        return { value: undefined, detail: (e as Error).message };
      }
    }
  }
}

/** Run the enabled assertions against a response. */
export function runAssertions(assertions: Assertion[] | undefined, res: ApiResponse): AssertionResult[] {
  return (assertions ?? [])
    .filter((a) => a.enabled)
    .map((assertion) => {
      const { value, detail: extractDetail } = actualFor(assertion, res);
      const { passed, detail } = compare(assertion.op, value, assertion.expected ?? "");
      return {
        assertion,
        passed,
        actual: value === undefined ? "—" : clip(value),
        detail: extractDetail ?? detail,
      };
    });
}

function clip(text: string, max = 120): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export interface AssertionSummary {
  total: number;
  passed: number;
  failed: number;
  allPassed: boolean;
}

export function summarize(results: AssertionResult[]): AssertionSummary {
  const passed = results.filter((r) => r.passed).length;
  return { total: results.length, passed, failed: results.length - passed, allPassed: results.length > 0 && passed === results.length };
}

/** A sensible starting check, so the tab is never an empty form. */
export function defaultAssertion(id: string): Assertion {
  return { id, enabled: true, kind: "status", op: "equals", expected: "200" };
}
