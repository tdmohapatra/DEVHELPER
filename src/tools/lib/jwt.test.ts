import { describe, it, expect } from "vitest";
import { decodeJwt } from "./jwt";

// header {alg:HS256,typ:JWT} . payload {sub:123, name:"John", exp:9999999999} . sig
const TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

describe("decodeJwt", () => {
  it("decodes header and payload", () => {
    const r = decodeJwt(TOKEN);
    expect(r.header.alg).toBe("HS256");
    expect(r.payload.name).toBe("John Doe");
  });
  it("reports no-expiry when exp absent", () => {
    expect(decodeJwt(TOKEN).status).toBe("no-expiry");
  });
  it("detects expired tokens", () => {
    // exp in the past (2020-01-01)
    const payload = btoa(JSON.stringify({ exp: 1577836800 })).replace(/=/g, "");
    const header = btoa(JSON.stringify({ alg: "none" })).replace(/=/g, "");
    const t = `${header}.${payload}.`;
    expect(decodeJwt(t, Date.parse("2026-01-01")).status).toBe("expired");
  });
  it("throws on malformed input", () => {
    expect(() => decodeJwt("garbage")).toThrow();
  });
});
