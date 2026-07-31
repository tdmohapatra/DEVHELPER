import type { ApiRequest } from "./apiTypes";
import { interpolate } from "./interpolate";
import { resolveDynamic } from "./dynamicVars";

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
  graphql: "application/json",
  none: undefined,
};

/** Turn an ApiRequest + environment vars into a concrete request ready to send or codegen. */
export function resolveRequest(req: ApiRequest, vars: Record<string, string> = {}): ResolvedRequest {
  // Dynamic variables first, so `{{$guid}}` is generated fresh even when an environment
  // happens to define a variable of the same name.
  const sub = (s: string) => interpolate(resolveDynamic(s), vars);

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
  } else if (req.auth.type === "apikey" && req.auth.apiKeyName) {
    const name = sub(req.auth.apiKeyName);
    const value = sub(req.auth.apiKeyValue ?? "");
    if (req.auth.apiKeyIn === "query") {
      url += (url.includes("?") ? "&" : "?") + `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
    } else {
      headers[name] = value;
    }
  }

  // Body + content type
  let body: string | undefined;
  const hasBody = req.bodyType !== "none" && !["GET", "HEAD"].includes(req.method);
  if (hasBody) {
    if (req.bodyType === "graphql") {
      // GraphQL travels as JSON: the query and its variables in one envelope.
      let variables: unknown = undefined;
      const rawVars = sub(req.graphqlVariables ?? "").trim();
      if (rawVars) {
        try {
          variables = JSON.parse(rawVars);
        } catch {
          throw new Error("GraphQL variables are not valid JSON");
        }
      }
      body = JSON.stringify({ query: sub(req.body), ...(variables === undefined ? {} : { variables }) });
    } else {
      body = sub(req.body);
    }
    const ct = CONTENT_TYPE[req.bodyType];
    const hasCt = Object.keys(headers).some((k) => k.toLowerCase() === "content-type");
    if (ct && !hasCt) headers["Content-Type"] = ct;
  }

  return { method: req.method, url, headers, body };
}
