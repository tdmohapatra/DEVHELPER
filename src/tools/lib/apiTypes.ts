export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export type BodyType = "none" | "json" | "xml" | "form-data" | "x-www-form-urlencoded" | "raw";

export interface KeyValue {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

export type AuthType = "none" | "bearer" | "basic";
export interface AuthConfig {
  type: AuthType;
  token?: string; // bearer
  username?: string; // basic
  password?: string; // basic
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

export interface Environment {
  id: string;
  name: string;
  isProduction: boolean;
  variables: KeyValue[];
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
  };
}
