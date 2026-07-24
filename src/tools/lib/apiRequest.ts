import type { ApiRequest } from "./apiTypes";
import { interpolate } from "./interpolate";

export interface ResolvedRequest {
  method: string;
  url: string; // includes query string
  headers: Record<string, string>;
  body?: string;
}

const CONTENT_TYPE: Record<string, string | undefined> = {
  json: "application/json",
  xml: "application/xml",
  "x-www-form-urlencoded": "application/x-www-form-urlencoded",
  "form-data": undefined, // let the transport set the multipart boundary
  raw: "text/plain",
  none: undefined,
};

/** Turn an ApiRequest + environment vars into a concrete request ready to send or codegen. */
export function resolveRequest(req: ApiRequest, vars: Record<string, string> = {}): ResolvedRequest {
  const sub = (s: string) => interpolate(s, vars);

  // Query string
  const enabledQuery = req.query.filter((q) => q.enabled && q.key);
  const qs = enabledQuery.map((q) => `${encodeURIComponent(sub(q.key))}=${encodeURIComponent(sub(q.value))}`).join("&");
  let url = sub(req.url).trim();
  if (qs) url += (url.includes("?") ? "&" : "?") + qs;

  // Headers
  const headers: Record<string, string> = {};
  for (const h of req.headers) {
    if (h.enabled && h.key) headers[sub(h.key)] = sub(h.value);
  }

  // Auth
  if (req.auth.type === "bearer" && req.auth.token) {
    headers["Authorization"] = `Bearer ${sub(req.auth.token)}`;
  } else if (req.auth.type === "basic") {
    const creds = `${sub(req.auth.username ?? "")}:${sub(req.auth.password ?? "")}`;
    headers["Authorization"] = `Basic ${btoa(creds)}`;
  }

  // Body + content type
  let body: string | undefined;
  const hasBody = req.bodyType !== "none" && !["GET", "HEAD"].includes(req.method);
  if (hasBody) {
    body = sub(req.body);
    const ct = CONTENT_TYPE[req.bodyType];
    const hasCt = Object.keys(headers).some((k) => k.toLowerCase() === "content-type");
    if (ct && !hasCt) headers["Content-Type"] = ct;
  }

  return { method: req.method, url, headers, body };
}
