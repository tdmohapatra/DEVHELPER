import { describe, it, expect } from "vitest";
import {
  appendLine,
  channelCounts,
  commandCounts,
  filterLines,
  parseMonitorLine,
  startWatch,
  watchCommand,
  watchTargetProblem,
  type WatchLine,
} from "./redisWatch";

const line = (over: Partial<WatchLine> = {}): WatchLine => ({
  id: "w1",
  kind: "message",
  channel: "news",
  payload: "hello",
  at: 0,
  seq: 0,
  ...over,
});

describe("appendLine", () => {
  it("puts the newest first", () => {
    expect(appendLine([line({ seq: 1 })], line({ seq: 2 })).map((l) => l.seq)).toEqual([2, 1]);
  });

  it("caps the feed, since MONITOR on a busy server is thousands a second", () => {
    let feed: WatchLine[] = [];
    for (let i = 0; i < 30; i++) feed = appendLine(feed, line({ seq: i }), 4);
    expect(feed).toHaveLength(4);
    expect(feed[0].seq).toBe(29);
  });
});

describe("filterLines", () => {
  const feed = [line({ channel: "news", payload: "a" }), line({ channel: "orders", payload: "paid" })];

  it("returns everything for an empty query", () => {
    expect(filterLines(feed, " ")).toHaveLength(2);
  });

  it("matches channel or payload, case-insensitively", () => {
    expect(filterLines(feed, "ORDERS")).toHaveLength(1);
    expect(filterLines(feed, "paid")[0].channel).toBe("orders");
  });
});

describe("parseMonitorLine", () => {
  it("reads timestamp, database, client and command", () => {
    const parsed = parseMonitorLine('1700000000.123456 [0 127.0.0.1:52918] "GET" "user:1"')!;
    expect(parsed).toMatchObject({ at: 1700000000.123456, db: 0, client: "127.0.0.1:52918", command: "GET" });
    expect(parsed.args).toEqual(["user:1"]);
  });

  it("keeps a quoted argument containing spaces as one argument", () => {
    // Splitting on whitespace is what makes a SET of a sentence look like
    // twenty commands.
    const parsed = parseMonitorLine('1700000000.1 [0 127.0.0.1:1] "SET" "k" "hello there world"')!;
    expect(parsed.args).toEqual(["k", "hello there world"]);
  });

  it("handles an escaped quote inside an argument", () => {
    const parsed = parseMonitorLine('1700000000.1 [0 127.0.0.1:1] "SET" "k" "say \\"hi\\""')!;
    expect(parsed.args[1]).toBe('say "hi"');
  });

  it("upper-cases the command so counting is not case-sensitive", () => {
    expect(parseMonitorLine('1700000000.1 [0 127.0.0.1:1] "get" "k"')!.command).toBe("GET");
  });

  it("reads a non-zero database", () => {
    expect(parseMonitorLine('1700000000.1 [3 127.0.0.1:1] "GET" "k"')!.db).toBe(3);
  });

  it("returns null for something that is not a MONITOR line", () => {
    expect(parseMonitorLine("hello")).toBeNull();
    expect(parseMonitorLine("")).toBeNull();
  });
});

describe("commandCounts", () => {
  it("counts commands, busiest first", () => {
    const feed = [
      line({ payload: '1700000000.1 [0 c:1] "GET" "a"' }),
      line({ payload: '1700000000.2 [0 c:1] "GET" "b"' }),
      line({ payload: '1700000000.3 [0 c:1] "SET" "a" "1"' }),
    ];
    expect(commandCounts(feed)).toEqual([
      { command: "GET", count: 2 },
      { command: "SET", count: 1 },
    ]);
  });

  it("ignores lines that are not MONITOR output", () => {
    expect(commandCounts([line({ payload: "hello" })])).toEqual([]);
  });
});

describe("channelCounts", () => {
  it("counts channels and skips lines that have none", () => {
    const feed = [line({ channel: "a" }), line({ channel: "a" }), line({ channel: "" })];
    expect(channelCounts(feed)).toEqual([{ channel: "a", count: 2 }]);
  });
});

describe("watchCommand", () => {
  it("builds the right command for each mode", () => {
    expect(watchCommand("subscribe", "news")).toEqual(["SUBSCRIBE", "news"]);
    expect(watchCommand("psubscribe", "news.*")).toEqual(["PSUBSCRIBE", "news.*"]);
    expect(watchCommand("monitor", "ignored")).toEqual(["MONITOR"]);
  });

  it("trims the target", () => {
    expect(watchCommand("subscribe", "  news  ")).toEqual(["SUBSCRIBE", "news"]);
  });
});

describe("watchTargetProblem", () => {
  it("needs no target for MONITOR", () => {
    expect(watchTargetProblem("monitor", "")).toBeNull();
  });

  it("requires a channel otherwise", () => {
    expect(watchTargetProblem("subscribe", "  ")).toMatch(/required/);
  });

  it("rejects whitespace in a channel name", () => {
    expect(watchTargetProblem("subscribe", "a b")).toMatch(/whitespace/);
  });

  it("points a glob at pattern subscribe rather than silently matching nothing", () => {
    expect(watchTargetProblem("subscribe", "news.*")).toMatch(/pattern subscribe/);
    expect(watchTargetProblem("psubscribe", "news.*")).toBeNull();
  });
});

describe("without the desktop app", () => {
  it("says so rather than failing obscurely", async () => {
    await expect(startWatch({ host: "localhost", port: 6379 }, ["MONITOR"])).rejects.toThrow(/desktop app/i);
  });
});
