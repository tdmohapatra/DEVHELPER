import { describe, it, expect } from "vitest";
import {
  appendMessage,
  filterFeed,
  isStatusEvent,
  natsConnect,
  subjectCounts,
  subscribeSubjectProblem,
  toNativeAuth,
  type FeedMessage,
} from "./natsClient";

const msg = (over: Partial<FeedMessage> = {}): FeedMessage => ({
  id: "sub-1",
  subject: "orders.created",
  payload: "{}",
  binary: false,
  bytes: 2,
  headers: [],
  at: 0,
  seq: 0,
  ...over,
});

describe("isStatusEvent", () => {
  it("tells a status apart from a message on the shared channel", () => {
    expect(isStatusEvent({ id: "s", kind: "open", detail: "" })).toBe(true);
    expect(isStatusEvent(msg())).toBe(false);
  });

  it("copes with junk", () => {
    expect(isStatusEvent(null)).toBe(false);
    expect(isStatusEvent("nope")).toBe(false);
  });
});

describe("appendMessage", () => {
  it("puts the newest first", () => {
    const feed = appendMessage([msg({ seq: 1 })], msg({ seq: 2 }));
    expect(feed.map((m) => m.seq)).toEqual([2, 1]);
  });

  it("caps the feed, because a busy subject would otherwise freeze the view", () => {
    let feed: FeedMessage[] = [];
    for (let i = 0; i < 20; i++) feed = appendMessage(feed, msg({ seq: i }), 5);
    expect(feed).toHaveLength(5);
    expect(feed[0].seq).toBe(19);
  });
});

describe("filterFeed", () => {
  const feed = [msg({ subject: "orders.created" }), msg({ subject: "billing.paid", payload: "amount" })];

  it("returns everything for an empty query", () => {
    expect(filterFeed(feed, "  ")).toHaveLength(2);
  });

  it("matches the subject", () => {
    expect(filterFeed(feed, "billing")).toHaveLength(1);
  });

  it("matches the payload", () => {
    expect(filterFeed(feed, "amount")[0].subject).toBe("billing.paid");
  });

  it("is case-insensitive", () => {
    expect(filterFeed(feed, "ORDERS")).toHaveLength(1);
  });
});

describe("subjectCounts", () => {
  it("counts each subject, busiest first", () => {
    const feed = [msg({ subject: "a" }), msg({ subject: "b" }), msg({ subject: "a" })];
    expect(subjectCounts(feed)).toEqual([
      { subject: "a", count: 2 },
      { subject: "b", count: 1 },
    ]);
  });

  it("is empty for an empty feed", () => {
    expect(subjectCounts([])).toEqual([]);
  });
});

describe("subscribeSubjectProblem", () => {
  it("allows wildcards, unlike publishing", () => {
    expect(subscribeSubjectProblem("orders.>")).toBeNull();
    expect(subscribeSubjectProblem("orders.*.eu")).toBeNull();
  });

  it("requires a subject", () => {
    expect(subscribeSubjectProblem("  ")).toMatch(/required/);
  });

  it("rejects whitespace", () => {
    expect(subscribeSubjectProblem("a b")).toMatch(/whitespace/);
  });

  it("rejects an empty token from a doubled or trailing dot", () => {
    expect(subscribeSubjectProblem("orders..created")).toMatch(/Empty token/);
    expect(subscribeSubjectProblem("orders.")).toMatch(/Empty token/);
  });

  it("rejects `>` anywhere but last, where it means nothing", () => {
    expect(subscribeSubjectProblem("orders.>.eu")).toMatch(/last token/);
  });
});

describe("toNativeAuth", () => {
  it("is undefined when nothing was supplied, so the server sees an anonymous connect", () => {
    expect(toNativeAuth({})).toBeUndefined();
    expect(toNativeAuth({ user: "  ", token: "" })).toBeUndefined();
  });

  it("passes a user and password through", () => {
    expect(toNativeAuth({ user: "app", password: "pw" })).toMatchObject({ user: "app", password: "pw" });
  });

  it("passes a token through", () => {
    expect(toNativeAuth({ token: "t" })).toMatchObject({ token: "t" });
  });

  it("passes a credentials path through", () => {
    expect(toNativeAuth({ credsPath: "C:/x.creds" })).toMatchObject({ creds_path: "C:/x.creds" });
  });

  it("nulls the fields that were not given, rather than omitting them", () => {
    expect(toNativeAuth({ token: "t" })).toMatchObject({ user: null, creds_path: null });
  });
});

describe("without the desktop app", () => {
  it("says the protocol needs it rather than failing obscurely", async () => {
    await expect(natsConnect("localhost:4222", {})).rejects.toThrow(/desktop app/i);
  });
});
