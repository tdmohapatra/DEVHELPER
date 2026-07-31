/**
 * Postman collection interchange (schema v2.1).
 *
 * Teams already keep their APIs in Postman collections. Importing them means the tool is
 * usable on day one instead of after an afternoon of retyping; exporting means nothing
 * done here is trapped.
 *
 * Only the parts that map onto a request are handled — pre-request scripts, test scripts
 * and Postman-specific variables are reported as skipped rather than silently dropped.
 */

import {
  emptyRequest,
  type ApiRequest,
  type AuthConfig,
  type BodyType,
  type HttpMethod,
  type KeyValue,
} from "./apiTypes";

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
const kv = (key: string, value: string, enabled = true): KeyValue => ({ id: uid(), key, value, enabled });

export interface ImportedCollection {
  name: string;
  /** Folder name → requests, in collection order. Root requests use an empty name. */
  folders: { name: string; requests: ApiRequest[] }[];
  /** Collection-level variables, importable as an environment. */
  variables: KeyValue[];
  /** Things that were present but could not be represented. */
  skipped: string[];
}

interface PostmanUrl {
  raw?: string;
  protocol?: string;
  host?: string[] | string;
  path?: string[] | string;
  query?: { key?: string; value?: string; disabled?: boolean }[];
}

interface PostmanItem {
  name?: string;
  item?: PostmanItem[];
  request?: PostmanRequest | string;
  event?: { listen?: string }[];
}

interface PostmanRequest {
  method?: string;
  header?: { key?: string; value?: string; disabled?: boolean }[] | string;
  url?: PostmanUrl | string;
  body?: {
    mode?: string;
    raw?: string;
    urlencoded?: { key?: string; value?: string; disabled?: boolean }[];
    formdata?: { key?: string; value?: string; type?: string; src?: string; disabled?: boolean }[];
    options?: { raw?: { language?: string } };
  };
  auth?: Record<string, unknown>;
}

export class PostmanImportError extends Error {}

/** Rebuild a URL string from Postman's split representation. */
export function postmanUrlToString(url: PostmanUrl | string | undefined): string {
  if (!url) return "";
  if (typeof url === "string") return url;
  if (url.raw) return url.raw.split("?")[0];
  const host = Array.isArray(url.host) ? url.host.join(".") : (url.host ?? "");
  const path = Array.isArray(url.path) ? url.path.join("/") : (url.path ?? "");
  const scheme = url.protocol ? `${url.protocol}://` : "";
  return `${scheme}${host}${path ? `/${path}` : ""}`;
}

function queryFrom(url: PostmanUrl | string | undefined): KeyValue[] {
  if (!url) return [];
  if (typeof url === "string") {
    const qs = url.split("?")[1];
    if (!qs) return [];
    return qs
      .split("&")
      .filter(Boolean)
      .map((pair) => {
        const [k, ...rest] = pair.split("=");
        return kv(k, rest.join("="));
      });
  }
  if (url.query?.length) {
    return url.query.filter((q) => q.key).map((q) => kv(q.key!, q.value ?? "", !q.disabled));
  }
  const qs = url.raw?.split("?")[1];
  if (!qs) return [];
  return qs
    .split("&")
    .filter(Boolean)
    .map((pair) => {
      const [k, ...rest] = pair.split("=");
      return kv(k, rest.join("="));
    });
}

/** Postman stores auth as `{type, bearer:[{key,value}]}`. */
function authFrom(auth: Record<string, unknown> | undefined): AuthConfig {
  if (!auth || typeof auth.type !== "string") return { type: "none" };
  const entries = (auth[auth.type] as { key?: string; value?: string }[] | undefined) ?? [];
  const find = (key: string) => entries.find((e) => e.key === key)?.value ?? "";
  switch (auth.type) {
    case "bearer":
      return { type: "bearer", token: find("token") };
    case "basic":
      return { type: "basic", username: find("username"), password: find("password") };
    case "apikey":
      return {
        type: "apikey",
        apiKeyName: find("key"),
        apiKeyValue: find("value"),
        apiKeyIn: find("in") === "query" ? "query" : "header",
      };
    default:
      return { type: "none" };
  }
}

function bodyFrom(body: PostmanRequest["body"]): { bodyType: BodyType; body: string } {
  if (!body?.mode) return { bodyType: "none", body: "" };
  switch (body.mode) {
    case "raw": {
      const language = body.options?.raw?.language;
      const type: BodyType = language === "xml" ? "xml" : language === "json" ? "json" : inferRaw(body.raw ?? "");
      return { bodyType: type, body: body.raw ?? "" };
    }
    case "urlencoded":
      return {
        bodyType: "x-www-form-urlencoded",
        body: (body.urlencoded ?? [])
          .filter((f) => !f.disabled && f.key)
          .map((f) => `${f.key}=${f.value ?? ""}`)
          .join("&"),
      };
    case "formdata":
      return {
        bodyType: "form-data",
        body: (body.formdata ?? [])
          .filter((f) => !f.disabled && f.key)
          .map((f) => `${f.key}=${f.type === "file" ? (f.src ?? "<file>") : (f.value ?? "")}`)
          .join("\n"),
      };
    default:
      return { bodyType: "raw", body: body.raw ?? "" };
  }
}

function inferRaw(text: string): BodyType {
  const t = text.trim();
  if (t.startsWith("{") || t.startsWith("[")) return "json";
  if (t.startsWith("<")) return "xml";
  return t ? "raw" : "none";
}

function requestFrom(item: PostmanItem): ApiRequest {
  const raw = item.request;
  const request: PostmanRequest = typeof raw === "string" ? { method: "GET", url: raw } : (raw ?? {});
  const headerList = Array.isArray(request.header) ? request.header : [];
  const { bodyType, body } = bodyFrom(request.body);

  return {
    ...emptyRequest(uid()),
    name: item.name?.trim() || postmanUrlToString(request.url) || "Imported request",
    method: (request.method ?? "GET").toUpperCase() as HttpMethod,
    url: postmanUrlToString(request.url),
    headers: headerList.filter((h) => h.key).map((h) => kv(h.key!, h.value ?? "", !h.disabled)),
    query: queryFrom(request.url),
    auth: authFrom(request.auth),
    bodyType,
    body,
  };
}

/**
 * Parse an exported Postman collection (v2.0 or v2.1).
 *
 * Nested folders are flattened one level: Postman allows arbitrary nesting while this
 * tool has a single folder level, so deeper paths are joined with " / " rather than lost.
 */
export function importPostmanCollection(text: string): ImportedCollection {
  let data: { info?: { name?: string; schema?: string }; item?: PostmanItem[]; variable?: { key?: string; value?: string }[] };
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new PostmanImportError(`Not valid JSON: ${(e as Error).message}`);
  }

  if (!data?.info || !Array.isArray(data.item)) {
    throw new PostmanImportError("Not a Postman collection — expected an 'info' object and an 'item' array");
  }

  const skipped: string[] = [];
  const folders: ImportedCollection["folders"] = [];
  const root: ApiRequest[] = [];

  const walk = (items: PostmanItem[], path: string[]) => {
    for (const item of items) {
      if (item.event?.some((e) => e.listen === "test" || e.listen === "prerequest")) {
        skipped.push(`Scripts on "${item.name ?? "unnamed"}"`);
      }
      if (Array.isArray(item.item)) {
        walk(item.item, [...path, item.name ?? "Folder"]);
        continue;
      }
      if (!item.request) continue;
      const req = requestFrom(item);
      if (path.length === 0) {
        root.push(req);
      } else {
        const name = path.join(" / ");
        const folder = folders.find((f) => f.name === name);
        if (folder) folder.requests.push(req);
        else folders.push({ name, requests: [req] });
      }
    }
  };

  walk(data.item, []);
  if (root.length > 0) folders.unshift({ name: "", requests: root });

  const count = folders.reduce((n, f) => n + f.requests.length, 0);
  if (count === 0) throw new PostmanImportError("The collection contains no requests");

  return {
    name: data.info.name?.trim() || "Imported collection",
    folders,
    variables: (data.variable ?? []).filter((v) => v.key).map((v) => kv(v.key!, v.value ?? "")),
    skipped: [...new Set(skipped)],
  };
}

/** Serialize requests as a Postman v2.1 collection. Passwords and tokens travel as written. */
export function exportPostmanCollection(
  name: string,
  folders: { name: string; requests: ApiRequest[] }[],
): string {
  const authOut = (auth: AuthConfig): Record<string, unknown> | undefined => {
    switch (auth.type) {
      case "bearer":
        return { type: "bearer", bearer: [{ key: "token", value: auth.token ?? "", type: "string" }] };
      case "basic":
        return {
          type: "basic",
          basic: [
            { key: "username", value: auth.username ?? "", type: "string" },
            { key: "password", value: auth.password ?? "", type: "string" },
          ],
        };
      case "apikey":
        return {
          type: "apikey",
          apikey: [
            { key: "key", value: auth.apiKeyName ?? "", type: "string" },
            { key: "value", value: auth.apiKeyValue ?? "", type: "string" },
            { key: "in", value: auth.apiKeyIn ?? "header", type: "string" },
          ],
        };
      default:
        return undefined;
    }
  };

  const itemFor = (r: ApiRequest) => {
    const enabledQuery = r.query.filter((q) => q.key);
    const rawUrl =
      enabledQuery.length > 0
        ? `${r.url}?${enabledQuery.filter((q) => q.enabled).map((q) => `${q.key}=${q.value}`).join("&")}`
        : r.url;
    return {
      name: r.name,
      request: {
        method: r.method,
        header: r.headers.filter((h) => h.key).map((h) => ({ key: h.key, value: h.value, disabled: !h.enabled })),
        url: {
          raw: rawUrl,
          query: enabledQuery.map((q) => ({ key: q.key, value: q.value, disabled: !q.enabled })),
        },
        ...(r.bodyType !== "none" && r.body
          ? {
              body: {
                mode: r.bodyType === "x-www-form-urlencoded" ? "urlencoded" : "raw",
                ...(r.bodyType === "x-www-form-urlencoded"
                  ? {
                      urlencoded: r.body.split("&").filter(Boolean).map((pair) => {
                        const [k, ...rest] = pair.split("=");
                        return { key: k, value: rest.join("=") };
                      }),
                    }
                  : {
                      raw: r.body,
                      options: { raw: { language: r.bodyType === "json" ? "json" : r.bodyType === "xml" ? "xml" : "text" } },
                    }),
              },
            }
          : {}),
        ...(authOut(r.auth) ? { auth: authOut(r.auth) } : {}),
      },
    };
  };

  const collection = {
    info: {
      name,
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
      _postman_id: uid(),
    },
    item: folders.map((f) =>
      f.name ? { name: f.name, item: f.requests.map(itemFor) } : { name: "Requests", item: f.requests.map(itemFor) },
    ),
  };

  return JSON.stringify(collection, null, 2);
}
