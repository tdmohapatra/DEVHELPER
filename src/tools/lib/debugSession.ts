/**
 * Debug Session — data model and pure logic.
 *
 * A Debug Session is a chronological timeline of events pulled from many sources
 * (API calls, logs, exceptions, DB queries, messages) so a developer can reconstruct
 * "what happened" across a distributed flow, keyed by correlation / trace id.
 *
 * This module holds only pure, testable logic: parsing pasted logs into events,
 * sorting/filtering the timeline, and exporting. UI and persistence live elsewhere.
 */

export type DebugSource =
  | "api"
  | "log"
  | "exception"
  | "database"
  | "redis"
  | "nats"
  | "rabbitmq"
  | "http"
  | "websocket"
  | "custom";

export type DebugStatus = "ok" | "error" | "warn" | "info" | "pending";

export interface DebugEvent {
  id: string;
  /** epoch milliseconds */
  at: number;
  source: DebugSource;
  title: string;
  status: DebugStatus;
  service?: string;
  correlationId?: string;
  traceId?: string;
  durationMs?: number;
  payload?: string;
  error?: string;
}

/** An event before it is stored (id + timestamp are assigned on import). */
export type ParsedEvent = Omit<DebugEvent, "id" | "at"> & { at?: number };

export interface DebugSessionData {
  id: string;
  name: string;
  createdAt: number;
  events: DebugEvent[];
}

export const DEBUG_SOURCES: { id: DebugSource; label: string }[] = [
  { id: "api", label: "API" },
  { id: "http", label: "HTTP" },
  { id: "log", label: "Log" },
  { id: "exception", label: "Exception" },
  { id: "database", label: "Database" },
  { id: "redis", label: "Redis" },
  { id: "nats", label: "NATS" },
  { id: "rabbitmq", label: "RabbitMQ" },
  { id: "websocket", label: "WebSocket" },
  { id: "custom", label: "Custom" },
];

// Field aliases seen across common structured loggers (Serilog, Winston, Zap, .NET, etc.).
const TS_KEYS = ["timestamp", "time", "ts", "@t", "datetime", "date", "eventtime"];
const LEVEL_KEYS = ["level", "severity", "loglevel", "@l", "lvl"];
const MSG_KEYS = ["message", "msg", "@m", "renderedmessage", "text", "title", "event"];
const SERVICE_KEYS = ["service", "source", "sourcecontext", "app", "application", "logger", "category", "component"];
const TRACE_KEYS = ["traceid", "trace_id", "trace-id", "traceidentifier"];
const CORR_KEYS = ["correlationid", "correlation_id", "correlation-id", "corrid", "requestid", "request_id"];
const DURATION_KEYS = ["duration", "durationms", "elapsed", "elapsedms", "responsetime", "elapsedmilliseconds"];
const ERROR_KEYS = ["error", "exception", "err", "stacktrace", "stack"];

/** Build a lowercased-key view of an object for case-insensitive field lookup. */
function lowerKeyMap(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj)) out[k.toLowerCase()] = obj[k];
  return out;
}

function pick(map: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (map[k] !== undefined && map[k] !== null) return map[k];
  return undefined;
}

/** Parse a timestamp expressed as epoch ms, epoch seconds, or an ISO/parseable string. */
export function parseTimestamp(v: unknown): number | undefined {
  if (v == null) return undefined;
  if (typeof v === "number") {
    if (v > 1e12) return v; // ms
    if (v > 1e9) return v * 1000; // seconds
    return v;
  }
  if (typeof v === "string") {
    const n = Date.parse(v);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}

/** Map a log level string to a timeline status. */
export function statusFromLevel(level: unknown): DebugStatus | undefined {
  if (typeof level !== "string") return undefined;
  const l = level.toLowerCase();
  if (["error", "fatal", "critical", "err", "crit"].includes(l)) return "error";
  if (["warn", "warning"].includes(l)) return "warn";
  if (["info", "information", "debug", "trace", "verbose", "notice"].includes(l)) return "info";
  return undefined;
}

function toNumber(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/[^\d.-]/g, ""));
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}

function asString(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "string") return v;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Convert one parsed log object into a timeline event. */
function objectToEvent(obj: unknown): ParsedEvent {
  if (obj == null || typeof obj !== "object") {
    return { source: "log", title: String(obj ?? ""), status: "info" };
  }
  const rec = obj as Record<string, unknown>;
  const map = lowerKeyMap(rec);

  const level = pick(map, LEVEL_KEYS);
  const errorVal = pick(map, ERROR_KEYS);
  const status = statusFromLevel(level) ?? (errorVal ? "error" : "info");

  const message = asString(pick(map, MSG_KEYS));
  const title = message && message.length > 0 ? message : JSON.stringify(rec).slice(0, 120);

  return {
    source: "log",
    title,
    status,
    at: parseTimestamp(pick(map, TS_KEYS)),
    service: asString(pick(map, SERVICE_KEYS)),
    traceId: asString(pick(map, TRACE_KEYS)),
    correlationId: asString(pick(map, CORR_KEYS)),
    durationMs: toNumber(pick(map, DURATION_KEYS)),
    error: asString(errorVal),
    payload: JSON.stringify(rec),
  };
}

/**
 * Parse pasted log text into events. Accepts a JSON array, a single JSON object,
 * newline-delimited JSON (NDJSON), or plain text lines (each becomes a log event).
 */
export function parseLogEntries(text: string): ParsedEvent[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // Try a single JSON value first (array or object).
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed.map(objectToEvent);
    if (parsed && typeof parsed === "object") return [objectToEvent(parsed)];
  } catch {
    // fall through to line-based parsing
  }

  // NDJSON / plain lines.
  const events: ParsedEvent[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    const l = line.trim();
    if (!l) continue;
    try {
      events.push(objectToEvent(JSON.parse(l)));
    } catch {
      events.push({ source: "log", title: l, status: "info" });
    }
  }
  return events;
}

/** Sort events chronologically (ascending). Stable for equal timestamps. */
export function sortEvents(events: DebugEvent[]): DebugEvent[] {
  return [...events].sort((a, b) => a.at - b.at);
}

export interface EventFilter {
  sources?: DebugSource[];
  errorsOnly?: boolean;
  query?: string;
  correlationId?: string;
  traceId?: string;
}

export function filterEvents(events: DebugEvent[], f: EventFilter): DebugEvent[] {
  const q = f.query?.trim().toLowerCase();
  return events.filter((e) => {
    if (f.sources && f.sources.length > 0 && !f.sources.includes(e.source)) return false;
    if (f.errorsOnly && e.status !== "error") return false;
    if (f.correlationId && e.correlationId !== f.correlationId) return false;
    if (f.traceId && e.traceId !== f.traceId) return false;
    if (q) {
      const hay = [e.title, e.service, e.payload, e.error, e.correlationId, e.traceId].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** Distinct correlation ids present in a session, in first-seen order. */
export function correlationIds(events: DebugEvent[]): string[] {
  const seen = new Set<string>();
  for (const e of sortEvents(events)) if (e.correlationId) seen.add(e.correlationId);
  return [...seen];
}

/** True if an event carries the given id in its correlation/trace fields or text. */
export function eventMatchesId(e: DebugEvent, id: string): boolean {
  const q = id.trim();
  if (!q) return false;
  if (e.correlationId === q || e.traceId === q) return true;
  return [e.title, e.payload, e.error].filter(Boolean).join(" ").includes(q);
}

export interface ServiceHop {
  service: string;
  status: DebugStatus;
  count: number;
  firstAt: number;
  lastAt: number;
}

/** Roll up matched events into an ordered service-to-service flow (by first appearance). */
export function serviceFlow(events: DebugEvent[]): ServiceHop[] {
  const order: string[] = [];
  const map = new Map<string, ServiceHop>();
  for (const e of sortEvents(events)) {
    const service = e.service || "(unknown)";
    let hop = map.get(service);
    if (!hop) {
      hop = { service, status: "info", count: 0, firstAt: e.at, lastAt: e.at };
      map.set(service, hop);
      order.push(service);
    }
    hop.count += 1;
    hop.lastAt = Math.max(hop.lastAt, e.at);
    hop.firstAt = Math.min(hop.firstAt, e.at);
    hop.status = worstStatus(hop.status, e.status);
  }
  return order.map((s) => map.get(s)!);
}

const STATUS_RANK: Record<DebugStatus, number> = { error: 4, warn: 3, pending: 2, ok: 1, info: 0 };
function worstStatus(a: DebugStatus, b: DebugStatus): DebugStatus {
  return STATUS_RANK[b] > STATUS_RANK[a] ? b : a;
}

export interface TraceSummary {
  count: number;
  errors: number;
  startAt: number;
  endAt: number;
  durationMs: number;
  /** The first error event in time order, i.e. the likely failure point. */
  failurePoint?: DebugEvent;
}

/** Summarize a set of matched events: span duration, error count, first failure. */
export function traceSummary(events: DebugEvent[]): TraceSummary {
  const sorted = sortEvents(events);
  const errors = sorted.filter((e) => e.status === "error");
  const startAt = sorted.length ? sorted[0].at : 0;
  const endAt = sorted.length ? sorted[sorted.length - 1].at : 0;
  return {
    count: sorted.length,
    errors: errors.length,
    startAt,
    endAt,
    durationMs: endAt - startAt,
    failurePoint: errors[0],
  };
}

function fmtTime(at: number): string {
  const d = new Date(at);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

export { fmtTime as formatEventTime };

/** Render the session as a Markdown timeline. */
export function toMarkdown(session: DebugSessionData): string {
  const lines: string[] = [`# Debug Session: ${session.name}`, ""];
  for (const e of sortEvents(session.events)) {
    const meta = [
      e.status.toUpperCase(),
      e.durationMs != null ? `${e.durationMs}ms` : null,
      e.traceId ? `trace=${e.traceId}` : null,
      e.correlationId ? `corr=${e.correlationId}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    lines.push(`- \`${fmtTime(e.at)}\` **${e.source}**${e.service ? ` (${e.service})` : ""} — ${e.title}  \n  ${meta}`);
    if (e.error) lines.push(`  - error: ${e.error}`);
  }
  return lines.join("\n");
}

/** Build a compact structured context string for an AI root-cause prompt. */
export function buildAiContext(session: DebugSessionData, selected?: Set<string>): string {
  const events = sortEvents(session.events).filter((e) => !selected || selected.has(e.id));
  const lines = events.map((e) => {
    const parts = [
      `[${fmtTime(e.at)}]`,
      e.source.toUpperCase(),
      e.service ? `(${e.service})` : "",
      `— ${e.title}`,
      `(${e.status}${e.durationMs != null ? `, ${e.durationMs}ms` : ""})`,
      e.traceId ? `trace=${e.traceId}` : "",
      e.correlationId ? `corr=${e.correlationId}` : "",
    ].filter(Boolean);
    let s = parts.join(" ");
    if (e.error) s += `\n    error: ${e.error.slice(0, 400)}`;
    else if (e.payload && e.payload.length <= 400) s += `\n    payload: ${e.payload}`;
    return s;
  });
  return `Debug session "${session.name}" — ${events.length} events (chronological):\n\n${lines.join("\n")}`;
}
