/**
 * Thin abstraction over Tauri native commands.
 *
 * DevHelper runs in two modes:
 *   1. Full desktop app (Tauri)   — native commands available.
 *   2. Browser dev mode (`npm run dev` without Tauri) — native commands absent.
 *
 * Tools that need native access call `invoke` through here and get a clear
 * `NativeUnavailableError` in browser mode instead of a cryptic failure, so the
 * UI can show a graceful "requires the desktop app" fallback.
 */

import { addLog } from "./logBus";

export class NativeUnavailableError extends Error {
  constructor(command: string) {
    super(`Native command "${command}" is only available in the DevHelper desktop app.`);
    this.name = "NativeUnavailableError";
  }
}

/** True when running inside the Tauri desktop shell. */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Invoke a native Tauri command, or throw NativeUnavailableError in the browser.
 *
 * Every call is written to the activity log — arguments on the way in, outcome and
 * duration on the way out — because native failures otherwise surface as a toast that
 * disappears before it can be read. Secrets are redacted by the log itself.
 */
export async function invokeNative<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isTauri()) {
    const err = new NativeUnavailableError(command);
    addLog("warn", `native:${command}`, err.message);
    throw err;
  }
  const started = Date.now();
  addLog("info", `native:${command}`, "invoked", args);
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke<T>(command, args);
    addLog("success", `native:${command}`, "ok", summarize(result), Date.now() - started);
    return result;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    addLog("error", `native:${command}`, message, undefined, Date.now() - started);
    throw e instanceof Error ? e : new Error(message);
  }
}

/** Keep result logging cheap: shapes and sizes, not whole result sets. */
function summarize(value: unknown): unknown {
  if (Array.isArray(value)) return `array(${value.length})`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.rows)) return `rows=${obj.rows.length}, columns=${(obj.columns as unknown[])?.length ?? 0}`;
    return Object.keys(obj).slice(0, 12).join(", ");
  }
  return value;
}
