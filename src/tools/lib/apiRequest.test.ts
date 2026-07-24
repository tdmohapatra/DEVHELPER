import { describe, it, expect } from "vitest";
import { resolveRequest } from "./apiRequest";
import { emptyRequest, type ApiRequest } from "./apiTypes";

function make(over: Partial<ApiRequest>): ApiRequest {
  return { ...emptyRequest("1"), ...over };
}

describe("resolveRequest", () => {
  it("interpolates url and appends enabled query params", () => {
    const r = resolveRequest(
      make({
        url: "{{BASE}}/users",
        query: [
          { id: "a", key: "id", value: "{{UID}}", enabled: true },
          { id: "b", key: "skip", value: "x", enabled: false },
        ],
      }),
      { BASE: "https://api.dev", UID: "42" },
    );
    expect(r.url).toBe("https://api.dev/users?id=42");
  });

  it("adds bearer auth header", () => {
    const r = resolveRequest(make({ url: "https://x", auth: { type: "bearer", token: "abc" } }));
    expect(r.headers["Authorization"]).toBe("Bearer abc");
  });

  it("adds basic auth header", () => {
    const r = resolveRequest(make({ url: "https://x", auth: { type: "basic", username: "u", password: "p" } }));
    expect(r.headers["Authorization"]).toBe("Basic " + btoa("u:p"));
  });

  it("sets content-type for json body and includes body", () => {
    const r = resolveRequest(make({ method: "POST", url: "https://x", bodyType: "json", body: '{"a":1}' }));
    expect(r.headers["Content-Type"]).toBe("application/json");
    expect(r.body).toBe('{"a":1}');
  });

  it("omits body for GET", () => {
    const r = resolveRequest(make({ method: "GET", url: "https://x", bodyType: "json", body: "{}" }));
    expect(r.body).toBeUndefined();
  });
});
