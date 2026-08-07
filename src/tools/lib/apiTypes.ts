export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export type BodyType = "none" | "json" | "xml" | "form-data" | "x-www-form-urlencoded" | "raw" | "graphql";

export interface KeyValue {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

export type AuthType = "none" | "bearer" | "basic" | "apikey" | "oauth2";
export interface AuthConfig {
  type: AuthType;
  token?: string; // bearer
  username?: string; // basic
  password?: string; // basic
  /** API key: the header or query parameter name, e.g. `X-API-Key`. */
  apiKeyName?: string;
  apiKeyValue?: string;
  apiKeyIn?: "header" | "query";
  /** OAuth 2.0 client credentials. The fetched token is session-only, never persisted. */
  tokenUrl?: string;
  clientId?: string;
  clientSecret?: string;
  scope?: string;
  /** Where the client credentials go: an Authorization header or the form body. */
  clientAuth?: "header" | "body";
}

/** Per-request transport settings — Postman's request-level Settings tab. */
export interface RequestSettings {
  /** Abort after this many milliseconds. 0 or undefined means no limit. */
  timeoutMs?: number;
  /** Follow 3xx responses. Off shows the redirect itself, which is often what you want. */
  followRedirects?: boolean;
}

/** GraphQL requests keep the query and variables apart, and combine them at send time. */
export interface GraphQlBody {
  query: string;
  variables: string;
}

/** A check run against the response — the "Tests" tab, without a scripting engine. */
export type AssertionKind = "status" | "jsonPath" | "header" | "bodyContains" | "responseTime";
export type AssertionOp = "equals" | "notEquals" | "contains" | "lessThan" | "greaterThan" | "exists";

export interface Assertion {
  id: string;
  enabled: boolean;
  kind: AssertionKind;
  /** JSONPath expression, header name — unused for status and responseTime. */
  target?: string;
  op: AssertionOp;
  expected?: string;
}

export interface ApiRequest {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  headers: KeyValue[];
  query: KeyValue[];
  bodyType: BodyType;
  body: string;
  auth: AuthConfig;
  /** Response checks. Optional so requests saved before this existed still load. */
  assertions?: Assertion[];
  /** GraphQL variables, kept apart from the query which lives in `body`. */
  graphqlVariables?: string;
  settings?: RequestSettings;
}

export interface ApiResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  timeMs: number;
  sizeBytes: number;
  ok: boolean;
}

export interface ApiFolder {
  id: string;
  name: string;
  requestIds: string[];
}

/** A typed service the environment points at (metadata only — no secrets stored here). */
export type EnvConnKind = "database" | "api" | "redis" | "nats" | "rabbitmq" | "mqtt" | "websocket";

export interface EnvConnection {
  id: string;
  kind: EnvConnKind;
  name: string;
  /** Per-kind target fields, e.g. { host, port, database } or { baseUrl } or { url }. */
  fields: Record<string, string>;
}

export interface Environment {
  id: string;
  name: string;
  isProduction: boolean;
  variables: KeyValue[];
  /** Optional typed connection references (Environment Manager 2.0). Backward compatible. */
  connections?: EnvConnection[];
  /**
   * Id of the environment this one inherits variables from, if any.
   *
   * A child's own variables win; everything else falls through to the parent.
   * Optional, so environments saved before inheritance existed still load.
   */
  extendsId?: string;
}

export function emptyRequest(id: string): ApiRequest {
  return {
    id,
    name: "New Request",
    method: "GET",
    url: "",
    headers: [],
    query: [],
    bodyType: "none",
    body: "",
    auth: { type: "none" },
    assertions: [],
  };
}
