/**
 * WebSocket session model.
 *
 * The socket itself lives in Rust; this is the frame log the UI renders — appending,
 * capping, filtering and summarizing. Pure functions so the behaviour is testable without
 * a live server.
 */

export type WsFrameKind = "open" | "message" | "binary" | "ping" | "pong" | "close" | "error" | "sent";
export type WsDirection = "in" | "out" | "system";

export interface WsFrame {
  id: number;
  /** Connection this frame belongs to. */
  connectionId: string;
  kind: WsFrameKind;
  direction: WsDirection;
  data: string;
  size: number;
  at: number;
}

/** Event payload emitted by the native layer. */
export interface WsEventPayload {
  id: string;
  kind: string;
  data: string;
  size: number;
}

export type WsStatus = "idle" | "connecting" | "open" | "closed" | "error";

/** Older frames are dropped past this, so a chatty socket cannot exhaust memory. */
export const FRAME_LIMIT = 1000;

export function directionOf(kind: WsFrameKind): WsDirection {
  if (kind === "sent") return "out";
  if (kind === "message" || kind === "binary" || kind === "ping" || kind === "pong") return "in";
  return "system";
}

/** Append a frame, keeping the newest `FRAME_LIMIT`. */
export function appendFrame(frames: WsFrame[], frame: Omit<WsFrame, "id">, nextId: number): WsFrame[] {
  return [...frames, { ...frame, id: nextId }].slice(-FRAME_LIMIT);
}

/** Status implied by a native event, or `null` when the event does not change it. */
export function statusAfter(kind: string): WsStatus | null {
  switch (kind) {
    case "open":
      return "open";
    case "close":
      return "closed";
    case "error":
      return "error";
    default:
      return null;
  }
}

export interface WsFilter {
  /** Substring match over the payload. */
  text?: string;
  /** Hide ping/pong noise. */
  hideControl?: boolean;
  direction?: WsDirection | "all";
}

export function filterFrames(frames: WsFrame[], filter: WsFilter): WsFrame[] {
  const needle = filter.text?.trim().toLowerCase();
  return frames.filter((f) => {
    if (filter.hideControl && (f.kind === "ping" || f.kind === "pong")) return false;
    if (filter.direction && filter.direction !== "all" && f.direction !== filter.direction) return false;
    if (needle && !f.data.toLowerCase().includes(needle)) return false;
    return true;
  });
}

export interface WsStats {
  sent: number;
  received: number;
  bytesSent: number;
  bytesReceived: number;
}

export function statsOf(frames: WsFrame[]): WsStats {
  return frames.reduce<WsStats>(
    (acc, f) => {
      if (f.direction === "out") {
        acc.sent++;
        acc.bytesSent += f.size;
      } else if (f.direction === "in") {
        acc.received++;
        acc.bytesReceived += f.size;
      }
      return acc;
    },
    { sent: 0, received: 0, bytesSent: 0, bytesReceived: 0 },
  );
}

/** Pretty-print a frame when it is JSON, otherwise return it unchanged. */
export function formatFrame(data: string): string {
  const trimmed = data.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return data;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return data;
  }
}

/** Render the whole log as text for the clipboard or a bug report. */
export function framesToText(frames: WsFrame[]): string {
  return frames
    .map((f) => {
      const arrow = f.direction === "out" ? "→" : f.direction === "in" ? "←" : "•";
      const time = new Date(f.at).toISOString().slice(11, 23);
      return `[${time}] ${arrow} ${f.kind}${f.size ? ` (${f.size} B)` : ""}${f.data ? ` ${f.data}` : ""}`;
    })
    .join("\n");
}

export type ExportFormat = "json" | "ndjson" | "text";

export interface ExportedLog {
  content: string;
  filename: string;
  mime: string;
}

/**
 * Serialize frames for saving.
 *
 * JSON keeps the structure for later analysis, NDJSON suits streaming into jq or a log
 * pipeline, and text is what you paste into a ticket.
 */
export function exportFrames(frames: WsFrame[], format: ExportFormat, stamp: string): ExportedLog {
  const base = `websocket-log-${stamp}`;
  switch (format) {
    case "json":
      return {
        content: JSON.stringify(
          {
            exportedAt: new Date(Number(stamp) || Date.now()).toISOString(),
            frameCount: frames.length,
            frames: frames.map((f) => ({
              at: new Date(f.at).toISOString(),
              direction: f.direction,
              kind: f.kind,
              size: f.size,
              data: f.data,
            })),
          },
          null,
          2,
        ),
        filename: `${base}.json`,
        mime: "application/json",
      };
    case "ndjson":
      return {
        content: frames
          .map((f) => JSON.stringify({ at: new Date(f.at).toISOString(), direction: f.direction, kind: f.kind, size: f.size, data: f.data }))
          .join("\n"),
        filename: `${base}.ndjson`,
        mime: "application/x-ndjson",
      };
    case "text":
      return { content: framesToText(frames), filename: `${base}.log`, mime: "text/plain" };
  }
}

/** Only the payloads that arrived, one per line — the usual thing to feed another tool. */
export function receivedPayloads(frames: WsFrame[]): string {
  return frames
    .filter((f) => f.direction === "in" && f.data)
    .map((f) => f.data)
    .join("\n");
}

/**
 * Validate a WebSocket URL before dialling.
 *
 * `http://` is the most common mistake, and the native error for it is unhelpful, so it
 * is corrected here instead.
 */
export function normalizeWsUrl(input: string): { url: string; note?: string } {
  const text = input.trim();
  if (!text) throw new Error("Enter a WebSocket URL");
  if (/^wss?:\/\//i.test(text)) return { url: text };
  if (/^https:\/\//i.test(text)) {
    return { url: text.replace(/^https:\/\//i, "wss://"), note: "https:// was changed to wss://" };
  }
  if (/^http:\/\//i.test(text)) {
    return { url: text.replace(/^http:\/\//i, "ws://"), note: "http:// was changed to ws://" };
  }
  if (/^[\w.-]+(:\d+)?(\/|$)/.test(text)) {
    return { url: `ws://${text}`, note: "no scheme given — assumed ws://" };
  }
  throw new Error(`Not a WebSocket URL: ${text}`);
}
