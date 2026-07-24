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

/** Invoke a native Tauri command, or throw NativeUnavailableError in the browser. */
export async function invokeNative<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isTauri()) {
    throw new NativeUnavailableError(command);
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}
