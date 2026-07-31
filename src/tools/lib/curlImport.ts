/**
 * Import a cURL command as a request.
 *
 * Every API doc, browser devtools "Copy as cURL" and colleague's Slack message hands you
 * a curl command. Retyping it into fields is the single most common friction in an API
 * client, so pasting it is supported directly.
 */

import { emptyRequest, type ApiRequest, type BodyType, type HttpMethod, type KeyValue } from "./apiTypes";

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));

const kv = (key: string, value: string): KeyValue => ({ id: uid(), key, value, enabled: true });

/** Split a command line into arguments, honouring quotes and line continuations. */
export function tokenizeCurl(input: string): string[] {
  const text = input
    .replace(/\\\r?\n/g, " ") // shell line continuation
    .replace(/[`^]\r?\n/g, " ") // PowerShell / cmd continuations
    .trim();

  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let started = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (quote) {
      if (c === "\\" && quote === '"' && i + 1 < text.length) {
        current += text[++i];
        continue;
      }
      if (c === quote) {
        quote = null;
        continue;
      }
      current += c;
      continue;
    }

    if (c === '"' || c === "'") {
      quote = c;
      started = true;
      continue;
    }
    if (/\s/.test(c)) {
      if (current || started) tokens.push(current);
      current = "";
      started = false;
      continue;
    }
    current += c;
  }
  if (current || started) tokens.push(current);
  return tokens;
}

/** Body type implied by a Content-Type header. */
function bodyTypeFor(contentType: string | undefined, body: string): BodyType {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("json")) return "json";
  if (ct.includes("xml")) return "xml";
  if (ct.includes("x-www-form-urlencoded")) return "x-www-form-urlencoded";
  if (ct.includes("multipart/form-data")) return "form-data";
  if (ct) return "raw";
  // No declared type: infer from the payload so pasted JSON is still formatted as JSON.
  const trimmed = body.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
  return "raw";
}

export class CurlParseError extends Error {}

/**
 * Parse a cURL command into a request. Throws when no URL can be found.
 *
 * Supported: -X/--request, -H/--header, -d and its --data variants, --json, -F/--form, -u/--user,
 * -b/--cookie, -G/--get, --url. Transport-only flags (-k, -L, --compressed, -s, -v)
 * are accepted and ignored, because they do not change what is sent.
 */
export function parseCurl(input: string): ApiRequest {
  const tokens = tokenizeCurl(input);
  if (tokens.length === 0) throw new CurlParseError("Nothing to import");

  const req = emptyRequest(uid());
  const headers: KeyValue[] = [];
  const formFields: string[] = [];
  const dataParts: string[] = [];
  let explicitMethod: HttpMethod | null = null;
  let url = "";
  let forceGet = false;

  const start = tokens[0].toLowerCase() === "curl" ? 1 : 0;

  for (let i = start; i < tokens.length; i++) {
    const t = tokens[i];
    const next = () => tokens[++i] ?? "";

    // --flag=value is equivalent to --flag value
    const eq = t.startsWith("--") ? t.indexOf("=") : -1;
    const flag = eq > -1 ? t.slice(0, eq) : t;
    const inlineValue = eq > -1 ? t.slice(eq + 1) : null;
    const valueOf = () => inlineValue ?? next();

    switch (flag) {
      case "-X":
      case "--request":
        explicitMethod = valueOf().toUpperCase() as HttpMethod;
        break;

      case "-H":
      case "--header": {
        const raw = valueOf();
        const idx = raw.indexOf(":");
        if (idx > 0) headers.push(kv(raw.slice(0, idx).trim(), raw.slice(idx + 1).trim()));
        break;
      }

      case "-d":
      case "--data":
      case "--data-raw":
      case "--data-binary":
      case "--data-ascii":
      case "--data-urlencode":
        dataParts.push(valueOf());
        break;

      case "--json": {
        dataParts.push(valueOf());
        if (!headers.some((h) => h.key.toLowerCase() === "content-type")) {
          headers.push(kv("Content-Type", "application/json"));
        }
        break;
      }

      case "-F":
      case "--form":
        formFields.push(valueOf());
        break;

      case "-u":
      case "--user": {
        const raw = valueOf();
        const idx = raw.indexOf(":");
        req.auth = {
          type: "basic",
          username: idx > -1 ? raw.slice(0, idx) : raw,
          password: idx > -1 ? raw.slice(idx + 1) : "",
        };
        break;
      }

      case "-b":
      case "--cookie":
        headers.push(kv("Cookie", valueOf()));
        break;

      case "-A":
      case "--user-agent":
        headers.push(kv("User-Agent", valueOf()));
        break;

      case "-e":
      case "--referer":
        headers.push(kv("Referer", valueOf()));
        break;

      case "-G":
      case "--get":
        forceGet = true;
        break;

      case "--url":
        url = valueOf();
        break;

      // Transport-only flags that do not change the request itself.
      case "-k":
      case "--insecure":
      case "-L":
      case "--location":
      case "--compressed":
      case "-s":
      case "--silent":
      case "-v":
      case "--verbose":
      case "-i":
      case "--include":
      case "-f":
      case "--fail":
        break;

      // Flags that take a value we do not model.
      case "-o":
      case "--output":
      case "--max-time":
      case "--connect-timeout":
      case "--retry":
      case "-x":
      case "--proxy":
        valueOf();
        break;

      default:
        if (!t.startsWith("-") && !url) url = t;
        break;
    }
  }

  if (!url) throw new CurlParseError("No URL found in the command");

  // Split a query string off the URL so the params are editable.
  const query: KeyValue[] = [];
  const qIdx = url.indexOf("?");
  if (qIdx > -1) {
    const qs = url.slice(qIdx + 1);
    url = url.slice(0, qIdx);
    for (const pair of qs.split("&")) {
      if (!pair) continue;
      const [k, ...rest] = pair.split("=");
      query.push(kv(safeDecode(k), safeDecode(rest.join("="))));
    }
  }

  let body = dataParts.join("&");

  // -G sends the data as query parameters instead of a body.
  if (forceGet && body) {
    for (const pair of body.split("&")) {
      const [k, ...rest] = pair.split("=");
      if (k) query.push(kv(safeDecode(k), safeDecode(rest.join("="))));
    }
    body = "";
  }

  if (formFields.length > 0) {
    body = formFields.join("\n");
  }

  const contentType = headers.find((h) => h.key.toLowerCase() === "content-type")?.value;
  const bodyType: BodyType =
    formFields.length > 0 ? "form-data" : body ? bodyTypeFor(contentType, body) : "none";

  const method: HttpMethod =
    explicitMethod ?? (forceGet ? "GET" : body || formFields.length > 0 ? "POST" : "GET");

  // Basic auth given as a header rather than -u.
  const authHeader = headers.find((h) => h.key.toLowerCase() === "authorization");
  if (authHeader && req.auth.type === "none") {
    const value = authHeader.value.trim();
    if (/^bearer\s+/i.test(value)) {
      req.auth = { type: "bearer", token: value.replace(/^bearer\s+/i, "") };
      headers.splice(headers.indexOf(authHeader), 1);
    }
  }

  return {
    ...req,
    name: nameFromUrl(url),
    method,
    url,
    headers,
    query,
    body,
    bodyType,
  };
}

function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v.replace(/\+/g, " "));
  } catch {
    return v;
  }
}

/** `/api/v1/users` → "users", so an imported request has a readable name. */
export function nameFromUrl(url: string): string {
  const withoutScheme = url.replace(/^[a-z]+:\/\//i, "");
  const path = withoutScheme.split("?")[0].split("/").filter(Boolean);
  const last = path[path.length - 1];
  return last && path.length > 1 ? last : withoutScheme || "Imported request";
}

/** True when the text looks like a cURL command, used to offer import on paste. */
export function looksLikeCurl(text: string): boolean {
  return /^\s*curl\s+/i.test(text);
}
