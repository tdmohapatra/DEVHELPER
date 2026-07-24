import { describe, it, expect } from "vitest";
import { parseOpenApi, endpointsToRequests, diffContracts } from "./openapi";

const V3 = JSON.stringify({
  openapi: "3.0.0",
  info: { title: "Demo", version: "1.0.0" },
  servers: [{ url: "https://api.dev/v1" }],
  paths: {
    "/users": {
      get: { operationId: "listUsers", parameters: [{ name: "limit", in: "query", schema: { type: "integer" } }], responses: { "200": {} } },
      post: { operationId: "createUser", requestBody: {}, responses: { "201": {} } },
    },
    "/users/{id}": {
      get: { operationId: "getUser", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": {}, "404": {} } },
    },
  },
});

describe("parseOpenApi (v3)", () => {
  it("extracts metadata and endpoints", () => {
    const s = parseOpenApi(V3);
    expect(s.title).toBe("Demo");
    expect(s.baseUrl).toBe("https://api.dev/v1");
    expect(s.endpoints).toHaveLength(3);
  });
});

describe("parseOpenApi (swagger v2)", () => {
  it("builds baseUrl from host+basePath", () => {
    const v2 = JSON.stringify({
      swagger: "2.0", info: { title: "Old", version: "1" }, host: "api.dev", basePath: "/v1", schemes: ["https"],
      paths: { "/ping": { get: { responses: { "200": {} } } } },
    });
    const s = parseOpenApi(v2);
    expect(s.baseUrl).toBe("https://api.dev/v1");
    expect(s.endpoints[0].path).toBe("/ping");
  });
});

describe("endpointsToRequests", () => {
  it("maps path params to {{}} and uses {{BASE_URL}}", () => {
    const reqs = endpointsToRequests(parseOpenApi(V3));
    const getUser = reqs.find((r) => r.name === "getUser")!;
    expect(getUser.url).toBe("{{BASE_URL}}/users/{{id}}");
  });
});

describe("diffContracts", () => {
  it("detects added/removed/breaking changes", () => {
    const v2 = JSON.stringify({
      openapi: "3.0.0", info: { title: "Demo", version: "2.0.0" }, servers: [{ url: "x" }],
      paths: {
        "/users": {
          get: { operationId: "listUsers", parameters: [{ name: "limit", in: "query", required: true, schema: { type: "integer" } }], responses: { "200": {} } },
          // post removed → breaking
        },
        "/orders": { get: { responses: { "200": {} } } }, // added
      },
    });
    const d = diffContracts(parseOpenApi(V3), parseOpenApi(v2));
    expect(d.added).toContain("GET /orders");
    expect(d.removed).toContain("POST /users");
    expect(d.removed).toContain("GET /users/{id}");
    // limit became required → breaking change on GET /users
    const changed = d.changed.find((c) => c.key === "GET /users");
    expect(changed?.changes.some((c) => c.severity === "breaking")).toBe(true);
  });
});
