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
export async function executeRequest(
  req: ResolvedRequest,
  signal?: AbortSignal,
  settings?: { timeoutMs?: number; followRedirects?: boolean },
): Promise<ApiResponse> {
  const fetchFn = isTauri() ? (await import("@tauri-apps/plugin-http")).fetch : window.fetch.bind(window);

  // A caller's cancel signal and a timeout both have to abort the same request.
  const timeoutMs = settings?.timeoutMs ?? 0;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;

  const init: RequestInit = {
    method: req.method,
    headers: req.headers,
    signal: controller.signal,
    // "manual" surfaces the 3xx itself, which is usually what you want to inspect.
    redirect: settings?.followRedirects === false ? "manual" : "follow",
  };
  if (req.body !== undefined && !["GET", "HEAD"].includes(req.method)) {
    init.body = req.body;
  }

  const start = performance.now();
  let res: Response;
  try {
    res = await fetchFn(req.url, init);
  } catch (e) {
    if (controller.signal.aborted && !signal?.aborted && timeoutMs > 0) {
      throw new Error(`Request timed out after ${timeoutMs} ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
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
