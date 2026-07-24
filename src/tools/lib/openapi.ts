/**
 * Minimal OpenAPI 3 / Swagger 2 reader for the import + contract-diff tools.
 * Pragmatic, not a full validator — tolerates missing fields.
 */
import type { ApiRequest, HttpMethod, KeyValue } from "./apiTypes";
import { emptyRequest, HTTP_METHODS } from "./apiTypes";

export interface ApiParam {
  name: string;
  in: "query" | "path" | "header" | "cookie" | "body";
  required: boolean;
  type: string;
}

export interface ApiEndpoint {
  method: HttpMethod;
  path: string;
  operationId?: string;
  summary?: string;
  tag?: string;
  params: ApiParam[];
  requestBody: boolean;
  responseCodes: string[];
}

export interface ParsedSpec {
  title: string;
  version: string;
  baseUrl: string;
  endpoints: ApiEndpoint[];
}

type AnyObj = Record<string, any>;

function resolveType(schema: AnyObj | undefined): string {
  if (!schema) return "any";
  if (schema.$ref) return String(schema.$ref).split("/").pop() ?? "ref";
  if (schema.type === "array") return `${resolveType(schema.items)}[]`;
  return schema.type ?? "object";
}

export function parseOpenApi(text: string): ParsedSpec {
  const spec: AnyObj = JSON.parse(text);
  const isV2 = typeof spec.swagger === "string";
  const info = spec.info ?? {};

  let baseUrl = "";
  if (isV2) {
    const scheme = (spec.schemes?.[0] as string) ?? "https";
    baseUrl = spec.host ? `${scheme}://${spec.host}${spec.basePath ?? ""}` : (spec.basePath ?? "");
  } else {
    baseUrl = spec.servers?.[0]?.url ?? "";
  }

  const endpoints: ApiEndpoint[] = [];
  const paths: AnyObj = spec.paths ?? {};
  for (const [path, pathItem] of Object.entries(paths)) {
    for (const method of HTTP_METHODS) {
      const op: AnyObj | undefined = (pathItem as AnyObj)[method.toLowerCase()];
      if (!op) continue;

      const params: ApiParam[] = (op.parameters ?? []).map((p: AnyObj) => ({
        name: p.name,
        in: p.in,
        required: !!p.required,
        type: isV2 ? (p.type ?? resolveType(p.schema)) : resolveType(p.schema),
      }));

      const requestBody = isV2
        ? (op.parameters ?? []).some((p: AnyObj) => p.in === "body")
        : !!op.requestBody;

      endpoints.push({
        method,
        path,
        operationId: op.operationId,
        summary: op.summary ?? op.description,
        tag: op.tags?.[0],
        params,
        requestBody,
        responseCodes: Object.keys(op.responses ?? {}),
      });
    }
  }

  return {
    title: info.title ?? "API",
    version: info.version ?? "",
    baseUrl,
    endpoints,
  };
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(performance.now() + Math.random()));

/** Convert parsed endpoints into DevHelper ApiRequests (baseUrl as {{BASE_URL}}). */
export function endpointsToRequests(spec: ParsedSpec): ApiRequest[] {
  return spec.endpoints.map((ep) => {
    const req = emptyRequest(uid());
    req.name = ep.operationId ?? `${ep.method} ${ep.path}`;
    req.method = ep.method;
    // Path params become {{param}} placeholders; query params seeded (disabled).
    const path = ep.path.replace(/\{(\w+)\}/g, "{{$1}}");
    req.url = `{{BASE_URL}}${path}`;
    const query: KeyValue[] = ep.params
      .filter((p) => p.in === "query")
      .map((p) => ({ id: uid(), key: p.name, value: "", enabled: false }));
    req.query = query;
    if (ep.requestBody && ep.method !== "GET") {
      req.bodyType = "json";
      req.body = "{}";
    }
    return req;
  });
}

// ---- Contract diff ---------------------------------------------------------

export type ChangeSeverity = "breaking" | "non-breaking";
export interface EndpointChange {
  key: string; // "GET /users"
  changes: { detail: string; severity: ChangeSeverity }[];
}
export interface ContractDiff {
  added: string[];
  removed: string[];
  changed: EndpointChange[];
}

const key = (ep: ApiEndpoint) => `${ep.method} ${ep.path}`;

export function diffContracts(oldSpec: ParsedSpec, newSpec: ParsedSpec): ContractDiff {
  const oldMap = new Map(oldSpec.endpoints.map((e) => [key(e), e]));
  const newMap = new Map(newSpec.endpoints.map((e) => [key(e), e]));

  const added = [...newMap.keys()].filter((k) => !oldMap.has(k));
  const removed = [...oldMap.keys()].filter((k) => !newMap.has(k)); // breaking
  const changed: EndpointChange[] = [];

  for (const [k, oldEp] of oldMap) {
    const newEp = newMap.get(k);
    if (!newEp) continue;
    const changes: EndpointChange["changes"] = [];

    // Params
    const oldParams = new Map(oldEp.params.map((p) => [`${p.in}:${p.name}`, p]));
    const newParams = new Map(newEp.params.map((p) => [`${p.in}:${p.name}`, p]));
    for (const [pk, np] of newParams) {
      const op = oldParams.get(pk);
      if (!op && np.required) changes.push({ detail: `new required param "${np.name}"`, severity: "breaking" });
      else if (!op) changes.push({ detail: `new optional param "${np.name}"`, severity: "non-breaking" });
      else {
        if (op.type !== np.type) changes.push({ detail: `param "${np.name}" type ${op.type} → ${np.type}`, severity: "breaking" });
        if (!op.required && np.required) changes.push({ detail: `param "${np.name}" is now required`, severity: "breaking" });
        else if (op.required && !np.required) changes.push({ detail: `param "${np.name}" is now optional`, severity: "non-breaking" });
      }
    }
    for (const [pk, op] of oldParams) {
      if (!newParams.has(pk)) changes.push({ detail: `removed param "${op.name}"`, severity: op.required ? "breaking" : "non-breaking" });
    }

    // Responses
    const removedCodes = oldEp.responseCodes.filter((c) => !newEp.responseCodes.includes(c));
    const addedCodes = newEp.responseCodes.filter((c) => !oldEp.responseCodes.includes(c));
    for (const c of removedCodes) changes.push({ detail: `removed response ${c}`, severity: "breaking" });
    for (const c of addedCodes) changes.push({ detail: `new response ${c}`, severity: "non-breaking" });

    if (changes.length) changed.push({ key: k, changes });
  }

  return { added, removed, changed };
}
