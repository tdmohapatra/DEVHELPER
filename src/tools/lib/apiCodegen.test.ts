import { describe, it, expect } from "vitest";
import { generateCode } from "./apiCodegen";
import type { ResolvedRequest } from "./apiRequest";

const req: ResolvedRequest = {
  method: "POST",
  url: "https://api.dev/users?active=true",
  headers: { "Content-Type": "application/json", Authorization: "Bearer abc" },
  body: '{"name":"John"}',
};

describe("generateCode", () => {
  it("curl includes method, url, headers, data", () => {
    const c = generateCode("curl", req);
    expect(c).toContain("curl -X POST");
    expect(c).toContain("api.dev/users");
    expect(c).toContain("-H");
    expect(c).toContain("--data");
  });
  it("csharp uses HttpClient", () => {
    const c = generateCode("csharp", req);
    expect(c).toContain("new HttpClient()");
    expect(c).toContain("HttpMethod.Post");
    expect(c).toContain("StringContent");
  });
  it("python uses requests", () => {
    const c = generateCode("python", req);
    expect(c).toContain("import requests");
    expect(c).toContain("requests.post(");
  });
  it("javascript uses fetch", () => {
    const c = generateCode("javascript", req);
    expect(c).toContain("await fetch(");
    expect(c).toContain('"POST"');
  });
});
