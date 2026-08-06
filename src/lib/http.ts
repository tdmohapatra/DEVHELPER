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
    throw new Error(describeFetchError(e, req.url));
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

const NO_REASON = "the request failed without reporting a reason";

/**
 * Turn whatever a fetch implementation rejected with into a usable sentence.
 *
 * The two implementations fail differently and neither is a plain Error with a
 * helpful message. The Tauri plugin rejects with a string from Rust, so reading
 * `.message` off it yields `undefined` — which is how a caller ends up printing
 * "undefined" and hiding the actual cause. `window.fetch` rejects with a
 * TypeError saying only "Failed to fetch", which does not say what it could not
 * reach. Both get the URL attached.
 */
export function describeFetchError(e: unknown, url: string): string {
  let detail: string;
  // An Error is handled first even when its message is empty: falling through to
  // the object branch would serialise it as `{}`, which says less than nothing.
  if (e instanceof Error) detail = e.message.trim() || NO_REASON;
  else if (typeof e === "string" && e.trim()) detail = e.trim();
  else if (e && typeof e === "object") {
    // Tauri surfaces some errors as { message } or { error }; fall back to JSON.
    const obj = e as Record<string, unknown>;
    const named = obj.message ?? obj.error;
    detail = typeof named === "string" && named ? named : safeJson(obj);
  } else detail = NO_REASON;
  return `${detail} — requesting ${url}`;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "unknown error";
  } catch {
    return "unknown error";
  }
}

/** True when browser CORS may block requests (i.e. not running in the desktop app). */
export function corsLimited(): boolean {
  return !isTauri();
}
