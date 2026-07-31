import { describe, it, expect } from "vitest";
import { runAssertions, summarize, describeAssertion, defaultAssertion } from "./apiAssert";
import type { ApiResponse, Assertion } from "./apiTypes";

const res: ApiResponse = {
  status: 200,
  statusText: "OK",
  headers: { "Content-Type": "application/json", "X-Trace-Id": "abc-123" },
  body: JSON.stringify({ data: { items: [{ id: 7, name: "Ada" }], total: 1 }, ok: true }),
  timeMs: 42,
  sizeBytes: 64,
  ok: true,
};

const a = (over: Partial<Assertion>): Assertion => ({
  id: "a1",
  enabled: true,
  kind: "status",
  op: "equals",
  expected: "200",
  ...over,
});

describe("runAssertions", () => {
  it("checks the status code", () => {
    expect(runAssertions([a({})], res)[0]).toMatchObject({ passed: true, actual: "200" });
    expect(runAssertions([a({ expected: "201" })], res)[0].passed).toBe(false);
  });

  it("checks response time with a numeric operator", () => {
    expect(runAssertions([a({ kind: "responseTime", op: "lessThan", expected: "100" })], res)[0].passed).toBe(true);
    expect(runAssertions([a({ kind: "responseTime", op: "lessThan", expected: "10" })], res)[0].passed).toBe(false);
  });

  it("checks a header case-insensitively", () => {
    const r = runAssertions([a({ kind: "header", target: "x-trace-id", op: "equals", expected: "abc-123" })], res)[0];
    expect(r.passed).toBe(true);
  });

  it("reports a missing header as absent rather than failing obscurely", () => {
    const r = runAssertions([a({ kind: "header", target: "X-Nope", op: "equals", expected: "x" })], res)[0];
    expect(r.passed).toBe(false);
    expect(r.actual).toBe("—");
    expect(r.detail).toMatch(/not present/);
  });

  it("extracts a value with JSONPath", () => {
    const r = runAssertions([a({ kind: "jsonPath", target: "$.data.items[0].name", op: "equals", expected: "Ada" })], res)[0];
    expect(r).toMatchObject({ passed: true, actual: "Ada" });
  });

  it("stringifies a non-string JSONPath match", () => {
    const r = runAssertions([a({ kind: "jsonPath", target: "$.data.total", op: "equals", expected: "1" })], res)[0];
    expect(r.passed).toBe(true);
  });

  it("supports exists on a JSONPath", () => {
    expect(runAssertions([a({ kind: "jsonPath", target: "$.ok", op: "exists" })], res)[0].passed).toBe(true);
    expect(runAssertions([a({ kind: "jsonPath", target: "$.missing", op: "exists" })], res)[0].passed).toBe(false);
  });

  it("explains a non-JSON body instead of reporting a bare failure", () => {
    const text = { ...res, body: "plain text" };
    const r = runAssertions([a({ kind: "jsonPath", target: "$.a", op: "exists" })], text)[0];
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/not JSON/);
  });

  it("explains a bad JSONPath expression", () => {
    const r = runAssertions([a({ kind: "jsonPath", target: "$.[", op: "exists" })], res)[0];
    expect(r.passed).toBe(false);
    expect(r.detail).toBeTruthy();
  });

  it("checks body content", () => {
    expect(runAssertions([a({ kind: "bodyContains", op: "contains", expected: "Ada" })], res)[0].passed).toBe(true);
    expect(runAssertions([a({ kind: "bodyContains", op: "contains", expected: "Grace" })], res)[0].passed).toBe(false);
  });

  it("supports notEquals", () => {
    expect(runAssertions([a({ op: "notEquals", expected: "500" })], res)[0].passed).toBe(true);
  });

  it("fails a numeric comparison against a non-number", () => {
    const r = runAssertions([a({ kind: "header", target: "Content-Type", op: "lessThan", expected: "5" })], res)[0];
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/not a number/);
  });

  it("skips disabled assertions", () => {
    expect(runAssertions([a({ enabled: false })], res)).toEqual([]);
    expect(runAssertions(undefined, res)).toEqual([]);
  });

  it("clips a long actual value", () => {
    const long = { ...res, body: JSON.stringify({ v: "x".repeat(500) }) };
    const r = runAssertions([a({ kind: "jsonPath", target: "$.v", op: "equals", expected: "y" })], long)[0];
    expect(r.actual.length).toBeLessThan(130);
    expect(r.actual.endsWith("…")).toBe(true);
  });
});

describe("summarize", () => {
  it("counts passes and failures", () => {
    const results = runAssertions([a({}), a({ id: "a2", expected: "500" })], res);
    expect(summarize(results)).toEqual({ total: 2, passed: 1, failed: 1, allPassed: false });
  });
  it("is not 'all passed' when there is nothing to check", () => {
    expect(summarize([]).allPassed).toBe(false);
  });
});

describe("describeAssertion", () => {
  it("renders each kind readably", () => {
    expect(describeAssertion(a({}))).toBe("Status = 200");
    expect(describeAssertion(a({ kind: "responseTime", op: "lessThan", expected: "500" }))).toBe("Response time < 500 ms");
    expect(describeAssertion(a({ kind: "jsonPath", target: "$.id", op: "exists", expected: "" }))).toBe("$.id exists");
    expect(describeAssertion(a({ kind: "header", target: "ETag", op: "contains", expected: "W/" }))).toContain("Header ETag");
  });
});

describe("defaultAssertion", () => {
  it("starts with the check almost everyone wants", () => {
    expect(defaultAssertion("x")).toMatchObject({ kind: "status", op: "equals", expected: "200", enabled: true });
  });
});
