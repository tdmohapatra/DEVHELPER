import { describe, it, expect } from "vitest";
import {
  validateJson,
  formatJson,
  minifyJson,
  sortJsonKeys,
  diffJson,
  jsonToCSharp,
  DEFAULT_CSHARP_OPTIONS,
} from "./json";

describe("validateJson", () => {
  it("accepts valid JSON", () => {
    expect(validateJson('{"a":1}').valid).toBe(true);
  });
  it("rejects invalid JSON with a message", () => {
    const r = validateJson("{a:1}");
    expect(r.valid).toBe(false);
    expect(r.error).toBeTruthy();
  });
  it("rejects empty input", () => {
    expect(validateJson("   ").valid).toBe(false);
  });
});

describe("format/minify/sort", () => {
  it("formats with indent", () => {
    expect(formatJson('{"a":1}', 2)).toBe('{\n  "a": 1\n}');
  });
  it("minifies", () => {
    expect(minifyJson('{ "a": 1 }')).toBe('{"a":1}');
  });
  it("sorts keys recursively", () => {
    expect(sortJsonKeys('{"b":1,"a":{"d":2,"c":3}}', 0)).toBe('{"a":{"c":3,"d":2},"b":1}');
  });
});

describe("diffJson", () => {
  it("detects add/remove/change", () => {
    const d = diffJson('{"a":1,"b":2}', '{"a":1,"c":3}').filter((e) => e.kind !== "unchanged");
    const byPath = Object.fromEntries(d.map((e) => [e.path, e.kind]));
    expect(byPath.b).toBe("removed");
    expect(byPath.c).toBe("added");
  });
  it("reports changed values", () => {
    const d = diffJson('{"a":1}', '{"a":2}');
    expect(d[0]).toMatchObject({ path: "a", kind: "changed", left: 1, right: 2 });
  });
});

describe("jsonToCSharp", () => {
  it("generates a class with mapped types", () => {
    const cs = jsonToCSharp('{"id":1,"name":"x","ok":true,"pi":3.14}', DEFAULT_CSHARP_OPTIONS);
    expect(cs).toContain("public class Root");
    expect(cs).toContain("public long Id");
    expect(cs).toContain("public string Name");
    expect(cs).toContain("public bool Ok");
    expect(cs).toContain("public double Pi");
    expect(cs).toContain('[JsonPropertyName("id")]');
  });
  it("supports records and Newtonsoft attributes", () => {
    const cs = jsonToCSharp('{"a":1}', { ...DEFAULT_CSHARP_OPTIONS, useRecords: true, framework: "Newtonsoft" });
    expect(cs).toContain("public record Root");
    expect(cs).toContain('[JsonProperty("a")]');
  });
  it("handles nested objects and arrays", () => {
    const cs = jsonToCSharp('{"items":[{"x":1}]}', DEFAULT_CSHARP_OPTIONS);
    expect(cs).toContain("List<Item>");
    expect(cs).toContain("public class Item");
  });
});
