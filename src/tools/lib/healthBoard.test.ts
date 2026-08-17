import { describe, expect, it } from "vitest";
import {
  boardSummary,
  DEFAULT_WATCHER,
  DOWN_AFTER,
  errorBudget,
  health,
  isDue,
  judge,
  missingSecrets,
  percentile,
  stagger,
  stateChangeEvent,
  withoutSecrets,
  type Probe,
  type Watcher,
} from "./healthBoard";

const watcher = (over: Partial<Watcher> = {}): Watcher => ({
  ...DEFAULT_WATCHER,
  id: "w1",
  name: "Orders API",
  url: "https://api.example/health",
  ...over,
});

const probe = (over: Partial<Probe> = {}): Probe => ({ at: 1000, ok: true, status: 200, ms: 50, ...over });

describe("judge", () => {
  it("accepts any 2xx when no status is named", () => {
    expect(judge(watcher(), { status: 204, ms: 10, body: "" }, 1).ok).toBe(true);
    expect(judge(watcher(), { status: 301, ms: 10, body: "" }, 1).ok).toBe(false);
  });

  it("holds an exact status when one is named", () => {
    const w = watcher({ expectStatus: 204 });
    expect(judge(w, { status: 204, ms: 10, body: "" }, 1).ok).toBe(true);
    const wrong = judge(w, { status: 200, ms: 10, body: "" }, 1);
    expect(wrong.ok).toBe(false);
    expect(wrong.error).toBe("200, expected 204");
  });

  it("checks the body, because a 200 from a load balancer is not the service", () => {
    const w = watcher({ expectBody: '"status":"ok"' });
    expect(judge(w, { status: 200, ms: 10, body: '{"status":"ok"}' }, 1).ok).toBe(true);
    const splash = judge(w, { status: 200, ms: 10, body: "<html>Sign in</html>" }, 1);
    expect(splash.ok).toBe(false);
    expect(splash.error).toMatch(/it was not this service/);
  });

  it("records a transport error as a failure with no status", () => {
    const failed = judge(watcher(), { status: 0, ms: 5000, body: "", error: "connection refused" }, 1);
    expect(failed).toMatchObject({ ok: false, status: 0, error: "connection refused" });
  });

  it("marks a success over the SLO as slow rather than failed", () => {
    const slow = judge(watcher({ sloMs: 100 }), { status: 200, ms: 900, body: "" }, 1);
    expect(slow.ok).toBe(true);
    expect(slow.slow).toBe(true);
    expect(judge(watcher({ sloMs: 0 }), { status: 200, ms: 9000, body: "" }, 1).slow).toBe(false);
  });
});

describe("percentile", () => {
  it("returns a value that was actually measured, not an interpolation", () => {
    const values = [10, 20, 30, 40, 50];
    expect(percentile(values, 50)).toBe(30);
    expect(percentile(values, 95)).toBe(50);
    expect(percentile(values, 100)).toBe(50);
    for (const p of [10, 25, 50, 75, 90, 99]) expect(values).toContain(percentile(values, p));
  });

  it("does not care what order it was given", () => {
    expect(percentile([50, 10, 30, 20, 40], 50)).toBe(30);
  });

  it("copes with one sample and with none", () => {
    expect(percentile([42], 95)).toBe(42);
    expect(percentile([], 95)).toBe(0);
  });
});

describe("health", () => {
  it("says nothing before the first probe", () => {
    expect(health(watcher(), []).state).toBe("unknown");
  });

  it("is up when everything succeeded inside the SLO", () => {
    const result = health(watcher({ sloMs: 1000 }), [probe(), probe({ at: 2000 })]);
    expect(result.state).toBe("up");
    expect(result.availability).toBe(100);
  });

  it("does not call one failure an outage", () => {
    const result = health(watcher(), [probe(), probe({ at: 2000, ok: false, error: "500" })]);
    expect(result.state).toBe("degraded");
    expect(result.message).toMatch(new RegExp(`${DOWN_AFTER} in a row`));
  });

  it("calls it down after consecutive failures", () => {
    const result = health(watcher(), [
      probe(),
      probe({ at: 2000, ok: false, error: "500" }),
      probe({ at: 3000, ok: false, error: "500" }),
    ]);
    expect(result.state).toBe("down");
    expect(result.consecutiveFailures).toBe(2);
  });

  it("stays degraded when the window has failures but the latest succeeded", () => {
    const result = health(watcher(), [probe({ ok: false }), probe({ at: 2000 })]);
    expect(result.state).toBe("degraded");
    expect(result.availability).toBe(50);
  });

  it("has a state for slow, because it is neither up nor down", () => {
    // Two of twenty, because with only one outlier the slow call sits *above*
    // p95 by definition — nearest-rank puts p95 at the 19th of 20 samples.
    const probes = Array.from({ length: 20 }, (_, i) => probe({ at: i * 1000, ms: i >= 18 ? 9000 : 40, slow: i >= 18 }));
    const result = health(watcher({ sloMs: 1000 }), probes);
    expect(result.state).toBe("slow");
    expect(result.message).toMatch(/an average would hide it entirely/);
    expect(result.p95).toBe(9000);
    expect(result.p50).toBe(40);
  });

  it("computes percentiles over successes only, since a failure has no latency", () => {
    const result = health(watcher(), [probe({ ms: 10 }), probe({ at: 2, ok: false, ms: 30_000 }), probe({ at: 3, ms: 20 })]);
    expect(result.p95).toBe(20);
  });

  it("reports when the current state began", () => {
    const result = health(watcher(), [probe({ at: 1000, ok: false }), probe({ at: 2000 }), probe({ at: 3000 })]);
    expect(result.since).toBe(2000);
  });
});

describe("errorBudget", () => {
  it("turns a target into a number of failures", () => {
    const budget = errorBudget(200, 0, 99);
    expect(budget.allowed).toBe(2);
    expect(budget.remaining).toBe(2);
    expect(budget.message).toMatch(/2 of 2 failures left/);
  });

  it("says when the target is already missed", () => {
    const budget = errorBudget(200, 5, 99);
    expect(budget.remaining).toBe(0);
    expect(budget.burned).toBe(100);
    expect(budget.message).toMatch(/already missed/);
  });

  it("admits when the window is too short to mean anything", () => {
    const budget = errorBudget(10, 0, 99.5);
    expect(budget.allowed).toBe(0);
    expect(budget.message).toMatch(/too short to say anything/);
  });

  it("reports the burn as a proportion", () => {
    expect(errorBudget(1000, 2, 99).burned).toBe(20);
    expect(errorBudget(0, 0).message).toMatch(/No probes yet/);
  });
});

describe("scheduling", () => {
  it("is due immediately, then on the interval", () => {
    const w = watcher({ intervalMs: 30_000 });
    expect(isDue(w, undefined, 0)).toBe(true);
    expect(isDue(w, 1000, 20_000)).toBe(false);
    expect(isDue(w, 1000, 31_000)).toBe(true);
  });

  it("never fires a disabled watcher", () => {
    expect(isDue(watcher({ enabled: false }), undefined, 0)).toBe(false);
  });

  it("spreads the first probes so the board does not build its own thundering herd", () => {
    expect(stagger(0, 4, 30_000)).toBe(0);
    expect(stagger(1, 4, 30_000)).toBe(7500);
    expect(stagger(3, 4, 30_000)).toBe(22_500);
    expect(stagger(0, 1, 30_000)).toBe(0);
  });
});

describe("stateChangeEvent", () => {
  const current = health(watcher(), [probe({ ok: false, error: "500" }), probe({ at: 2000, ok: false, error: "500" })]);

  it("records a fall as an error, with the reason", () => {
    const event = stateChangeEvent(watcher(), "up", "down", current);
    expect(event.status).toBe("error");
    expect(event.title).toBe("Orders API: up → down");
    expect(event.error).toBeTruthy();
  });

  it("records a recovery without an error attached", () => {
    const up = health(watcher(), [probe(), probe({ at: 2000 })]);
    const event = stateChangeEvent(watcher(), "down", "up", up);
    expect(event.status).toBe("ok");
    expect(event.error).toBeUndefined();
  });

  it("carries the numbers, not the credentials", () => {
    const payload = JSON.parse(stateChangeEvent(watcher({ headers: { Authorization: "Bearer secret" } }), "up", "down", current).payload!);
    expect(payload).toMatchObject({ state: "down", consecutiveFailures: 2 });
    expect(JSON.stringify(payload)).not.toContain("secret");
  });
});

describe("boardSummary", () => {
  it("counts by state, worst first", () => {
    const entries = [
      { watcher: watcher({ id: "a" }), health: health(watcher(), [probe(), probe({ at: 2 })]) },
      { watcher: watcher({ id: "b" }), health: health(watcher(), [probe({ ok: false }), probe({ at: 2, ok: false })]) },
    ];
    expect(boardSummary(entries)).toBe("1 down, 1 up");
    expect(boardSummary([])).toBe("Nothing being watched.");
  });
});

describe("withoutSecrets", () => {
  it("blanks credential headers but keeps their names", () => {
    const w = watcher({ headers: { Authorization: "Bearer abc", "X-API-Key": "k", Accept: "application/json" } });
    const saved = withoutSecrets(w);
    expect(saved.headers).toEqual({ Authorization: "", "X-API-Key": "", Accept: "application/json" });
    expect(JSON.stringify(saved)).not.toContain("Bearer abc");
  });

  it("matches the header name however it was cased", () => {
    expect(withoutSecrets(watcher({ headers: { authorization: "x", "api-key": "y", Cookie: "z" } })).headers).toEqual({
      authorization: "",
      "api-key": "",
      Cookie: "",
    });
  });

  it("lists what has to be filled back in after a restart", () => {
    const restored = withoutSecrets(watcher({ headers: { Authorization: "Bearer abc", Accept: "json" } }));
    expect(missingSecrets(restored)).toEqual(["Authorization"]);
    expect(missingSecrets(watcher({ headers: { Accept: "json" } }))).toEqual([]);
  });
});
