import { describe, it, expect } from "vitest";
import {
  appendFrame,
  directionOf,
  exportFrames,
  receivedPayloads,
  filterFrames,
  formatFrame,
  framesToText,
  normalizeWsUrl,
  statsOf,
  statusAfter,
  FRAME_LIMIT,
  type WsFrame,
} from "./wsSession";

const frame = (over: Partial<WsFrame> = {}): WsFrame => ({
  id: 1,
  connectionId: "c1",
  kind: "message",
  direction: "in",
  data: "hello",
  size: 5,
  at: 1_700_000_000_000,
  ...over,
});

describe("directionOf", () => {
  it("classifies inbound, outbound and system frames", () => {
    expect(directionOf("message")).toBe("in");
    expect(directionOf("binary")).toBe("in");
    expect(directionOf("pong")).toBe("in");
    expect(directionOf("sent")).toBe("out");
    expect(directionOf("open")).toBe("system");
    expect(directionOf("close")).toBe("system");
    expect(directionOf("error")).toBe("system");
  });
});

describe("appendFrame", () => {
  it("appends with the given id", () => {
    const { id: _drop, ...rest } = frame();
    const out = appendFrame([], rest, 7);
    expect(out[0].id).toBe(7);
  });

  it("caps the log at the frame limit, keeping the newest", () => {
    let frames: WsFrame[] = [];
    for (let i = 0; i < FRAME_LIMIT + 10; i++) {
      const { id: _drop, ...rest } = frame({ data: `m${i}` });
      frames = appendFrame(frames, rest, i);
    }
    expect(frames).toHaveLength(FRAME_LIMIT);
    expect(frames[frames.length - 1].data).toBe(`m${FRAME_LIMIT + 9}`);
    expect(frames[0].data).toBe("m10");
  });
});

describe("statusAfter", () => {
  it("maps lifecycle events onto a status", () => {
    expect(statusAfter("open")).toBe("open");
    expect(statusAfter("close")).toBe("closed");
    expect(statusAfter("error")).toBe("error");
  });
  it("leaves the status alone for data frames", () => {
    expect(statusAfter("message")).toBeNull();
    expect(statusAfter("pong")).toBeNull();
  });
});

describe("filterFrames", () => {
  const frames = [
    frame({ id: 1, data: "hello world" }),
    frame({ id: 2, kind: "sent", direction: "out", data: "ping request" }),
    frame({ id: 3, kind: "ping", data: "" }),
    frame({ id: 4, kind: "pong", data: "" }),
  ];

  it("matches payload text case-insensitively", () => {
    expect(filterFrames(frames, { text: "HELLO" }).map((f) => f.id)).toEqual([1]);
  });
  it("hides control frames when asked", () => {
    expect(filterFrames(frames, { hideControl: true }).map((f) => f.id)).toEqual([1, 2]);
  });
  it("filters by direction", () => {
    expect(filterFrames(frames, { direction: "out" }).map((f) => f.id)).toEqual([2]);
    expect(filterFrames(frames, { direction: "all" })).toHaveLength(4);
  });
  it("returns everything with an empty filter", () => {
    expect(filterFrames(frames, {})).toHaveLength(4);
  });
});

describe("statsOf", () => {
  it("counts frames and bytes per direction, ignoring system frames", () => {
    const stats = statsOf([
      frame({ size: 10 }),
      frame({ kind: "sent", direction: "out", size: 4 }),
      frame({ kind: "sent", direction: "out", size: 6 }),
      frame({ kind: "open", direction: "system", size: 0 }),
    ]);
    expect(stats).toEqual({ sent: 2, received: 1, bytesSent: 10, bytesReceived: 10 });
  });
});

describe("formatFrame", () => {
  it("pretty-prints JSON", () => {
    expect(formatFrame('{"a":1}')).toBe('{\n  "a": 1\n}');
  });
  it("leaves non-JSON untouched", () => {
    expect(formatFrame("plain text")).toBe("plain text");
    expect(formatFrame("{not json")).toBe("{not json");
  });
});

describe("framesToText", () => {
  it("renders direction, kind and payload", () => {
    const text = framesToText([frame({ data: "hi", size: 2 }), frame({ kind: "sent", direction: "out", data: "yo", size: 2 })]);
    expect(text).toContain("← message (2 B) hi");
    expect(text).toContain("→ sent (2 B) yo");
  });
});

describe("exportFrames", () => {
  const frames = [frame({ data: "hi" }), frame({ kind: "sent", direction: "out", data: "yo" })];

  it("writes structured JSON with a count and ISO timestamps", () => {
    const out = exportFrames(frames, "json", "1700000000000");
    const parsed = JSON.parse(out.content);
    expect(parsed.frameCount).toBe(2);
    expect(parsed.frames[0]).toMatchObject({ direction: "in", kind: "message", data: "hi" });
    expect(parsed.frames[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(out.filename).toMatch(/\.json$/);
    expect(out.mime).toBe("application/json");
  });

  it("writes one JSON object per line for NDJSON", () => {
    const out = exportFrames(frames, "ndjson", "1");
    const lines = out.content.split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1])).toMatchObject({ direction: "out", data: "yo" });
    expect(out.filename).toMatch(/\.ndjson$/);
  });

  it("writes the readable log for text", () => {
    const out = exportFrames(frames, "text", "1");
    expect(out.content).toContain("← message");
    expect(out.filename).toMatch(/\.log$/);
  });

  it("handles an empty log", () => {
    expect(JSON.parse(exportFrames([], "json", "1").content).frameCount).toBe(0);
    expect(exportFrames([], "ndjson", "1").content).toBe("");
  });
});

describe("receivedPayloads", () => {
  it("returns only inbound payloads, one per line", () => {
    const out = receivedPayloads([
      frame({ data: "a" }),
      frame({ kind: "sent", direction: "out", data: "sent" }),
      frame({ data: "b" }),
      frame({ kind: "open", direction: "system", data: "connected" }),
      frame({ kind: "ping", data: "" }),
    ]);
    expect(out).toBe("a\nb");
  });
});

describe("normalizeWsUrl", () => {
  it("accepts ws and wss unchanged", () => {
    expect(normalizeWsUrl("wss://api.dev/socket")).toEqual({ url: "wss://api.dev/socket" });
  });
  it("converts http schemes, which is the usual mistake", () => {
    expect(normalizeWsUrl("https://api.dev/ws")).toMatchObject({ url: "wss://api.dev/ws" });
    expect(normalizeWsUrl("http://localhost:8080/ws")).toMatchObject({ url: "ws://localhost:8080/ws" });
  });
  it("assumes ws:// when no scheme is given", () => {
    expect(normalizeWsUrl("localhost:8080/ws")).toMatchObject({ url: "ws://localhost:8080/ws" });
  });
  it("explains an empty or unusable value", () => {
    expect(() => normalizeWsUrl("  ")).toThrow(/Enter a WebSocket URL/);
    expect(() => normalizeWsUrl("!!!")).toThrow(/Not a WebSocket URL/);
  });
});
