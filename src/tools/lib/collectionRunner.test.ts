import { describe, it, expect, vi } from "vitest";
import { runCollection, summarizeRun, runReportText, itemPassed, type Sender } from "./collectionRunner";
import { emptyRequest, type ApiRequest, type ApiResponse, type Assertion } from "./apiTypes";

const ok = (body = '{"id":1}', status = 200): ApiResponse => ({
  status,
  statusText: status === 200 ? "OK" : "Error",
  headers: { "Content-Type": "application/json" },
  body,
  timeMs: 10,
  sizeBytes: body.length,
  ok: status < 400,
});

const statusCheck = (expected: string): Assertion[] => [
  { id: "a1", enabled: true, kind: "status", op: "equals", expected },
];

const req = (name: string, assertions?: Assertion[]): ApiRequest => ({
  ...emptyRequest(name),
  name,
  url: `https://api.dev/${name}`,
  assertions,
});

const sendOk: Sender = async () => ok();
const noSleep = async () => {};

describe("runCollection", () => {
  it("runs every request in order", async () => {
    const seen: string[] = [];
    const send: Sender = async (r) => {
      seen.push(r.name);
      return ok();
    };
    const result = await runCollection([req("a"), req("b"), req("c")], send, {}, { sleep: noSleep });
    expect(seen).toEqual(["a", "b", "c"]);
    expect(result.summary).toMatchObject({ total: 3, passed: 3, failed: 0 });
  });

  it("evaluates each request's assertions", async () => {
    const result = await runCollection(
      [req("good", statusCheck("200")), req("bad", statusCheck("404"))],
      sendOk,
      {},
      { sleep: noSleep },
    );
    expect(result.items[0].passed).toBe(true);
    expect(result.items[1].passed).toBe(false);
    expect(result.summary).toMatchObject({ passed: 1, failed: 1, assertionsPassed: 1, assertionsFailed: 1 });
  });

  it("records a transport failure without aborting the run", async () => {
    const send: Sender = async (r) => {
      if (r.name === "b") throw new Error("connection refused");
      return ok();
    };
    const result = await runCollection([req("a"), req("b"), req("c")], send, {}, { sleep: noSleep });
    expect(result.items.map((i) => i.passed)).toEqual([true, false, true]);
    expect(result.items[1].error).toBe("connection refused");
    expect(result.summary.stoppedEarly).toBe(false);
  });

  it("stops on the first failure when asked", async () => {
    const send: Sender = async (r) => (r.name === "b" ? ok("{}", 500) : ok());
    const result = await runCollection(
      [req("a", statusCheck("200")), req("b", statusCheck("200")), req("c", statusCheck("200"))],
      send,
      { stopOnFailure: true },
      { sleep: noSleep },
    );
    expect(result.items.map((i) => i.request.name)).toEqual(["a", "b"]);
    expect(result.summary.stoppedEarly).toBe(true);
  });

  it("repeats the list for each iteration", async () => {
    const seen: string[] = [];
    const send: Sender = async (r) => {
      seen.push(r.name);
      return ok();
    };
    const result = await runCollection([req("a"), req("b")], send, { iterations: 3 }, { sleep: noSleep });
    expect(seen).toEqual(["a", "b", "a", "b", "a", "b"]);
    expect(result.summary.total).toBe(6);
    expect(result.items[5].iteration).toBe(3);
  });

  it("waits between requests but not after the last one", async () => {
    const sleep = vi.fn(async () => {});
    await runCollection([req("a"), req("b"), req("c")], sendOk, { delayMs: 50 }, { sleep });
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(50);
  });

  it("stops when cancelled", async () => {
    let calls = 0;
    const result = await runCollection([req("a"), req("b"), req("c")], sendOk, {}, {
      sleep: noSleep,
      isCancelled: () => ++calls > 2,
    });
    expect(result.items).toHaveLength(2);
    expect(result.summary.stoppedEarly).toBe(true);
  });

  it("reports progress through the hooks", async () => {
    const started: string[] = [];
    const finished: string[] = [];
    await runCollection([req("a"), req("b")], sendOk, {}, {
      sleep: noSleep,
      onStart: (r) => started.push(r.name),
      onResult: (r) => finished.push(r.request.name),
    });
    expect(started).toEqual(["a", "b"]);
    expect(finished).toEqual(["a", "b"]);
  });

  it("treats a request with no assertions as passing on any response", async () => {
    const send: Sender = async () => ok("{}", 500);
    const result = await runCollection([req("a")], send, {}, { sleep: noSleep });
    expect(result.items[0].passed).toBe(true);
  });

  it("handles an empty list", async () => {
    const result = await runCollection([], sendOk, {}, { sleep: noSleep });
    expect(result.summary).toMatchObject({ total: 0, passed: 0, failed: 0 });
  });
});

describe("itemPassed", () => {
  it("fails when there is no response", () => {
    expect(itemPassed(undefined, [])).toBe(false);
  });
  it("fails when any assertion failed", () => {
    const results = [
      { assertion: statusCheck("200")[0], passed: true, actual: "200" },
      { assertion: statusCheck("201")[0], passed: false, actual: "200" },
    ];
    expect(itemPassed(ok(), results)).toBe(false);
  });
});

describe("summarizeRun", () => {
  it("totals requests, checks and time", () => {
    const items = [
      { request: req("a"), iteration: 1, response: ok(), assertions: [], passed: true, timeMs: 10 },
      { request: req("b"), iteration: 1, error: "boom", assertions: [], passed: false, timeMs: 5 },
    ];
    expect(summarizeRun(items)).toMatchObject({ total: 2, passed: 1, failed: 1, totalTimeMs: 15 });
  });
});

describe("runReportText", () => {
  it("renders one line per request plus a summary", async () => {
    const result = await runCollection(
      [req("a", statusCheck("200")), req("b", statusCheck("404"))],
      sendOk,
      {},
      { sleep: noSleep },
    );
    const text = runReportText(result);
    expect(text).toMatch(/PASS\s+GET a — 200 OK \[1\/1 checks\]/);
    expect(text).toMatch(/FAIL\s+GET b/);
    expect(text).toMatch(/1\/2 requests passed/);
  });

  it("names the transport error when there was no response", async () => {
    const send: Sender = async () => {
      throw new Error("connection refused");
    };
    const text = runReportText(await runCollection([req("a")], send, {}, { sleep: noSleep }));
    expect(text).toContain("error: connection refused");
  });
});
