import { describe, it, expect } from "vitest";
import {
  ruleMatches,
  findAutoReply,
  normalizeInterval,
  presetById,
  WS_PRESETS,
  MIN_HEARTBEAT_MS,
  DEFAULT_HEARTBEAT,
  type AutoReplyRule,
} from "./wsHeartbeat";

const rule = (over: Partial<AutoReplyRule> = {}): AutoReplyRule => ({
  id: "r1",
  enabled: true,
  label: "pong",
  kind: "contains",
  value: "ping",
  reply: "pong",
  ...over,
});

describe("ruleMatches", () => {
  it("matches a substring", () => {
    expect(ruleMatches(rule(), '{"type":"ping"}')).toBe(true);
    expect(ruleMatches(rule(), '{"type":"data"}')).toBe(false);
  });

  it("matches an exact frame, ignoring surrounding whitespace", () => {
    const r = rule({ kind: "equals", value: "2", reply: "3" });
    expect(ruleMatches(r, "2")).toBe(true);
    expect(ruleMatches(r, " 2\n")).toBe(true);
    expect(ruleMatches(r, "20")).toBe(false);
  });

  it("matches a regular expression", () => {
    expect(ruleMatches(rule({ kind: "regex", value: "^heartbeat-\\d+$" }), "heartbeat-42")).toBe(true);
    expect(ruleMatches(rule({ kind: "regex", value: "^heartbeat-\\d+$" }), "heartbeat-x")).toBe(false);
  });

  it("does not match everything when the pattern is invalid", () => {
    expect(ruleMatches(rule({ kind: "regex", value: "[" }), "anything")).toBe(false);
  });

  it("matches a JSON field", () => {
    const r = rule({ kind: "jsonField", field: "type", value: "ping", reply: '{"type":"pong"}' });
    expect(ruleMatches(r, '{"type":"ping","id":1}')).toBe(true);
    expect(ruleMatches(r, '{"type":"next"}')).toBe(false);
  });

  it("compares JSON field values as strings, so numeric types work", () => {
    const r = rule({ kind: "jsonField", field: "type", value: "6" });
    expect(ruleMatches(r, '{"type":6}')).toBe(true);
  });

  it("ignores a JSON rule when the frame is not JSON or the field is missing", () => {
    const r = rule({ kind: "jsonField", field: "type", value: "ping" });
    expect(ruleMatches(r, "plain text")).toBe(false);
    expect(ruleMatches(r, '{"other":1}')).toBe(false);
    expect(ruleMatches(rule({ kind: "jsonField", value: "x" }), '{"type":"x"}')).toBe(false);
  });

  it("never matches while disabled", () => {
    expect(ruleMatches(rule({ enabled: false }), "ping")).toBe(false);
  });

  it("treats an empty contains value as no match", () => {
    expect(ruleMatches(rule({ value: "" }), "anything")).toBe(false);
  });
});

describe("findAutoReply", () => {
  it("returns the first matching rule, so order is priority", () => {
    const rules = [
      rule({ id: "a", kind: "equals", value: "2", reply: "3" }),
      rule({ id: "b", kind: "contains", value: "2", reply: "other" }),
    ];
    expect(findAutoReply(rules, "2")?.id).toBe("a");
  });
  it("returns null when nothing matches", () => {
    expect(findAutoReply([rule()], "data")).toBeNull();
    expect(findAutoReply([], "ping")).toBeNull();
  });
});

describe("normalizeInterval", () => {
  it("keeps a sensible interval", () => {
    expect(normalizeInterval(15_000)).toBe(15_000);
  });
  it("refuses to flood the server", () => {
    expect(normalizeInterval(50)).toBe(MIN_HEARTBEAT_MS);
  });
  it("falls back to the default for nonsense", () => {
    expect(normalizeInterval(0)).toBe(DEFAULT_HEARTBEAT.intervalMs);
    expect(normalizeInterval(Number.NaN)).toBe(DEFAULT_HEARTBEAT.intervalMs);
  });
});

describe("presets", () => {
  it("answers Socket.IO's ping with a pong", () => {
    const preset = presetById("socketio")!;
    const rules = preset.rules.map((r, i) => ({ ...r, id: String(i) }));
    expect(findAutoReply(rules, "2")?.reply).toBe("3");
  });

  it("answers graphql-ws with a pong message", () => {
    const rules = presetById("graphql-ws")!.rules.map((r, i) => ({ ...r, id: String(i) }));
    expect(findAutoReply(rules, '{"type":"ping"}')?.reply).toBe('{"type":"pong"}');
  });

  it("mirrors SignalR's keep-alive and sends one on a timer", () => {
    const preset = presetById("signalr")!;
    const rules = preset.rules.map((r, i) => ({ ...r, id: String(i) }));
    // SignalR's JSON protocol terminates every frame with the 0x1E record separator.
    expect(findAutoReply(rules, '{"type":6}')?.reply).toBe('{"type":6}');
    expect(preset.heartbeat.message.endsWith("")).toBe(true);
    expect(preset.heartbeat.enabled).toBe(true);
    expect(preset.heartbeat.useProtocolPing).toBe(false);
  });

  it("matches a JSON rule despite a trailing record separator", () => {
    const r = { ...presetById("signalr")!.rules[0], id: "r" };
    expect(ruleMatches(r, '{"type":6}')).toBe(true);
  });

  it("sends a newline heartbeat for STOMP and has no reply rules", () => {
    const preset = presetById("stomp")!;
    expect(preset.heartbeat.message).toBe("\n");
    expect(preset.rules).toHaveLength(0);
  });

  it("gives every preset a valid interval and a description", () => {
    for (const p of WS_PRESETS) {
      expect(normalizeInterval(p.heartbeat.intervalMs), p.id).toBe(p.heartbeat.intervalMs);
      expect(p.description.length, p.id).toBeGreaterThan(20);
    }
  });

  it("returns nothing for an unknown preset", () => {
    expect(presetById("nope")).toBeUndefined();
  });
});
