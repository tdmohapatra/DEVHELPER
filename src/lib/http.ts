import { isTauri } from "./platform";
import type { ResolvedRequest, } from "@/tools/lib/apiRequest";
import type { ApiResponse } from "@/tools/lib/apiTypes";

/**
 * Execute a resolved HTTP request.
 *
 * In the desktop app we use the Tauri HTTP plugin, whose `fetch` runs in Rust and is
 * NOT subject to browser CORS — the right behaviour for an API testing tool. In browser
 * dev mode we fall back to `window.fetch` (subject to CORS).
 */
export async function executeRequest(req: ResolvedRequest, signal?: AbortSignal): Promise<ApiResponse> {
  const fetchFn = isTauri() ? (await import("@tauri-apps/plugin-http")).fetch : window.fetch.bind(window);

  const init: RequestInit = {
    method: req.method,
    headers: req.headers,
    signal,
  };
  if (req.body !== undefined && !["GET", "HEAD"].includes(req.method)) {
    init.body = req.body;
  }

  const start = performance.now();
  const res = await fetchFn(req.url, init);
  const text = await res.text();
  const timeMs = Math.round(performance.now() - start);

  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => (headers[k] = v));

  return {
    status: res.status,
    statusText: res.statusText,
    headers,
    body: text,
    timeMs,
    sizeBytes: new Blob([text]).size,
    ok: res.ok,
  };
}

/** True when browser CORS may block requests (i.e. not running in the desktop app). */
export function corsLimited(): boolean {
  return !isTauri();
}
