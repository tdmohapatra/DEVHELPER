/**
 * In-app activity log.
 *
 * Tools fail in the native layer, where the message never reaches the screen. Every
 * native call and every handled error is recorded here so the user can read what
 * actually happened — and copy it verbatim into a bug report.
 *
 * Entries live in memory only: they are never persisted, and secrets are redacted
 * before an entry is stored, not when it is displayed.
 */

export type LogLevel = "info" | "success" | "warn" | "error";

export interface LogEntry {
  id: number;
  /** Epoch milliseconds. */
  ts: number;
  level: LogLevel;
  /** Where it came from, e.g. `db` or `native:db_test`. */
  source: string;
  message: string;
  /** Optional extra text — arguments, stack, driver output. */
  detail?: string;
  /** Duration of the operation, when it measured one. */
  elapsedMs?: number;
  /** Tool that was open when the entry was recorded — lets the dock filter by screen. */
  tool?: string;
}

/** Newest entries are kept; the oldest are dropped past this many. */
export const LOG_LIMIT = 500;

type Listener = (entries: LogEntry[]) => void;

let entries: LogEntry[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

const SECRET_KEYS = ["password", "pwd", "secret", "token", "apikey", "api_key"];

let currentTool: string | undefined;

/** Tell the log which tool is on screen, so entries can be filtered by it. */
export function setLogContext(toolId: string | undefined) {
  currentTool = toolId;
}

/**
 * Strip credentials from text that is about to be logged:
 * `Password=hunter2;` and `postgres://user:hunter2@host` both become `***`.
 */
export function redactSecrets(text: string): string {
  let out = text;
  for (const key of SECRET_KEYS) {
    // key=value or "key": "value", up to the next ; " ' , } or end of string.
    // The value's own quotes are consumed so the replacement stays valid JSON.
    out = out.replace(
      new RegExp(`("?${key}"?\\s*[=:]\\s*)(?:"[^"]*"|'[^']*'|[^;,"'}\\s]+)`, "gi"),
      (_m, head: string) => `${head}${head.trimEnd().endsWith(":") && head.includes('"') ? '"***"' : "***"}`,
    );
  }
  // URL credentials: scheme://user:secret@host
  out = out.replace(/(\w+:\/\/[^:/@\s]+:)[^@\s]+@/g, "$1***@");
  return out;
}

/** JSON for a log detail, with secrets removed and long values clipped. */
export function formatDetail(value: unknown, maxLen = 2000): string {
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  if (text === undefined) return "";
  const safe = redactSecrets(text);
  return safe.length > maxLen ? `${safe.slice(0, maxLen)}… (${safe.length} chars)` : safe;
}

function emit() {
  const snapshot = entries;
  listeners.forEach((l) => l(snapshot));
}

/** Append an entry. Message and detail are redacted before being stored. */
export function addLog(
  level: LogLevel,
  source: string,
  message: string,
  detail?: unknown,
  elapsedMs?: number,
): LogEntry {
  const entry: LogEntry = {
    id: nextId++,
    ts: Date.now(),
    level,
    source,
    message: redactSecrets(message),
    detail: detail === undefined ? undefined : formatDetail(detail),
    elapsedMs,
    tool: currentTool,
  };
  entries = [...entries, entry].slice(-LOG_LIMIT);
  emit();
  return entry;
}

export const log = {
  info: (source: string, message: string, detail?: unknown) => addLog("info", source, message, detail),
  success: (source: string, message: string, detail?: unknown) => addLog("success", source, message, detail),
  warn: (source: string, message: string, detail?: unknown) => addLog("warn", source, message, detail),
  error: (source: string, message: string, detail?: unknown) => addLog("error", source, message, detail),
};

export function getLogs(): LogEntry[] {
  return entries;
}

export function clearLogs() {
  entries = [];
  emit();
}

export function subscribeLogs(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** `12:04:31.882` — local time, millisecond precision. */
export function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** Render entries as plain text for the clipboard or a bug report. */
export function logsToText(list: LogEntry[]): string {
  return list
    .map((e) => {
      const head = `[${formatTime(e.ts)}] ${e.level.toUpperCase().padEnd(7)} ${e.source} — ${e.message}`;
      const timing = e.elapsedMs !== undefined ? ` (${e.elapsedMs} ms)` : "";
      return e.detail ? `${head}${timing}\n    ${e.detail}` : `${head}${timing}`;
    })
    .join("\n");
}
