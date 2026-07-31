import { describe, it, expect } from "vitest";
import { parseCurl, tokenizeCurl, looksLikeCurl, nameFromUrl, CurlParseError } from "./curlImport";

describe("tokenizeCurl", () => {
  it("keeps quoted arguments together", () => {
    expect(tokenizeCurl(`curl -H "Content-Type: application/json" https://x.dev`)).toEqual([
      "curl",
      "-H",
      "Content-Type: application/json",
      "https://x.dev",
    ]);
  });
  it("handles single quotes and embedded doubles", () => {
    expect(tokenizeCurl(`curl -d '{"a":1}' https://x.dev`)).toEqual(["curl", "-d", '{"a":1}', "https://x.dev"]);
  });
  it("joins shell line continuations", () => {
    expect(tokenizeCurl("curl \\\n  -X POST \\\n  https://x.dev")).toEqual(["curl", "-X", "POST", "https://x.dev"]);
  });
  it("preserves an empty quoted argument", () => {
    expect(tokenizeCurl(`curl -d '' https://x.dev`)).toEqual(["curl", "-d", "", "https://x.dev"]);
  });
});

describe("parseCurl", () => {
  it("imports a plain GET", () => {
    const r = parseCurl("curl https://api.dev/v1/users");
    expect(r).toMatchObject({ method: "GET", url: "https://api.dev/v1/users", bodyType: "none" });
  });

  it("splits the query string into editable params", () => {
    const r = parseCurl("curl 'https://api.dev/search?q=hello%20world&page=2'");
    expect(r.url).toBe("https://api.dev/search");
    expect(r.query.map((q) => [q.key, q.value])).toEqual([
      ["q", "hello world"],
      ["page", "2"],
    ]);
  });

  it("imports headers", () => {
    const r = parseCurl(`curl -H "X-Trace: abc" -H "Accept: application/json" https://api.dev`);
    expect(r.headers.map((h) => [h.key, h.value])).toEqual([
      ["X-Trace", "abc"],
      ["Accept", "application/json"],
    ]);
  });

  it("infers POST when a body is present", () => {
    const r = parseCurl(`curl -d '{"a":1}' https://api.dev/items`);
    expect(r.method).toBe("POST");
    expect(r.bodyType).toBe("json");
    expect(r.body).toBe('{"a":1}');
  });

  it("honours an explicit method", () => {
    expect(parseCurl(`curl -X DELETE https://api.dev/items/1`).method).toBe("DELETE");
  });

  it("uses the content type to pick the body type", () => {
    const r = parseCurl(`curl -H 'Content-Type: application/xml' -d '<a/>' https://api.dev`);
    expect(r.bodyType).toBe("xml");
  });

  it("joins repeated data flags the way curl does", () => {
    const r = parseCurl("curl -d a=1 -d b=2 https://api.dev");
    expect(r.body).toBe("a=1&b=2");
  });

  it("imports basic auth from -u", () => {
    expect(parseCurl("curl -u admin:s3cret https://api.dev").auth).toMatchObject({
      type: "basic",
      username: "admin",
      password: "s3cret",
    });
  });

  it("promotes a bearer Authorization header to auth", () => {
    const r = parseCurl(`curl -H "Authorization: Bearer tok123" https://api.dev`);
    expect(r.auth).toMatchObject({ type: "bearer", token: "tok123" });
    expect(r.headers.some((h) => h.key.toLowerCase() === "authorization")).toBe(false);
  });

  it("supports --flag=value form", () => {
    expect(parseCurl("curl --request=PUT --url=https://api.dev/x").method).toBe("PUT");
  });

  it("moves -G data into the query string", () => {
    const r = parseCurl("curl -G -d q=cats https://api.dev/search");
    expect(r.method).toBe("GET");
    expect(r.body).toBe("");
    expect(r.query.map((q) => [q.key, q.value])).toEqual([["q", "cats"]]);
  });

  it("imports form fields", () => {
    const r = parseCurl("curl -F name=ada -F role=admin https://api.dev/users");
    expect(r.bodyType).toBe("form-data");
    expect(r.body).toBe("name=ada\nrole=admin");
    expect(r.method).toBe("POST");
  });

  it("ignores transport-only flags", () => {
    const r = parseCurl("curl -k -L --compressed -s https://api.dev");
    expect(r.url).toBe("https://api.dev");
    expect(r.headers).toEqual([]);
  });

  it("skips the value of flags it does not model", () => {
    const r = parseCurl("curl --max-time 30 -o out.json https://api.dev");
    expect(r.url).toBe("https://api.dev");
  });

  it("imports a devtools-style copy with cookies and user agent", () => {
    const r = parseCurl(`curl 'https://api.dev/me' -H 'Accept: */*' -b 'sid=42' -A 'Mozilla/5.0'`);
    expect(r.headers.find((h) => h.key === "Cookie")?.value).toBe("sid=42");
    expect(r.headers.find((h) => h.key === "User-Agent")?.value).toBe("Mozilla/5.0");
  });

  it("names the request after the last path segment", () => {
    expect(parseCurl("curl https://api.dev/v1/users").name).toBe("users");
  });

  it("rejects a command with no URL", () => {
    expect(() => parseCurl("curl -X POST")).toThrow(CurlParseError);
    expect(() => parseCurl("")).toThrow(CurlParseError);
  });
});

describe("looksLikeCurl", () => {
  it("recognises a curl command", () => {
    expect(looksLikeCurl("  curl https://x.dev")).toBe(true);
    expect(looksLikeCurl("https://x.dev")).toBe(false);
  });
});

describe("nameFromUrl", () => {
  it("uses the last segment when there is a path", () => {
    expect(nameFromUrl("https://api.dev/v1/orders")).toBe("orders");
  });
  it("falls back to the host", () => {
    expect(nameFromUrl("https://api.dev")).toBe("api.dev");
  });
});
