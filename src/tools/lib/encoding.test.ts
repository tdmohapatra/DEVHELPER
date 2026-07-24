import { describe, it, expect } from "vitest";
import { textToBase64, base64ToText, urlEncode, urlDecode, parseQueryParams } from "./encoding";

describe("base64", () => {
  it("round-trips UTF-8 text", () => {
    const s = "Héllo, 世界 🌍";
    expect(base64ToText(textToBase64(s))).toBe(s);
  });
  it("encodes ASCII correctly", () => {
    expect(textToBase64("abc")).toBe("YWJj");
  });
});

describe("url", () => {
  it("encodes and decodes", () => {
    expect(urlEncode("a b&c")).toBe("a%20b%26c");
    expect(urlDecode("a%20b%26c")).toBe("a b&c");
  });
});

describe("parseQueryParams", () => {
  it("parses a full URL", () => {
    const p = parseQueryParams("https://x.io/y?id=42&name=John%20Doe#frag");
    expect(p).toEqual([
      { key: "id", value: "42" },
      { key: "name", value: "John Doe" },
    ]);
  });
  it("returns empty for no query", () => {
    expect(parseQueryParams("https://x.io/y")).toEqual([]);
  });
});
