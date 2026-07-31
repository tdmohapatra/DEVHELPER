import { describe, it, expect } from "vitest";
import {
  validateJson,
  formatJson,
  minifyJson,
  sortJsonKeys,
  diffJson,
  jsonToCSharp,
  DEFAULT_CSHARP_OPTIONS,
  stripJsonComments,
  parseJsonLoose,
  unescapeJsonString,
  escapeJsonString,
  valueKind,
  appendPath,
  childEntries,
  previewValue,
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

describe("lenient parsing", () => {
  it("strips line comments", () => {
    expect(parseJsonLoose('{ "a": 1 // note\n }')).toEqual({ a: 1 });
  });
  it("strips block comments", () => {
    expect(parseJsonLoose('{ /* head */ "a": 1 }')).toEqual({ a: 1 });
  });
  it("drops trailing commas in objects and arrays", () => {
    expect(parseJsonLoose('{ "a": [1, 2, ], }')).toEqual({ a: [1, 2] });
  });
  it("leaves comment-like text inside strings alone", () => {
    expect(parseJsonLoose('{ "url": "http://x/y", "p": "/* not a comment */" }')).toEqual({
      url: "http://x/y",
      p: "/* not a comment */",
    });
  });
  it("keeps escaped quotes intact while scanning strings", () => {
    expect(stripJsonComments('{"a":"say \\"hi\\" // no"}')).toBe('{"a":"say \\"hi\\" // no"}');
  });
  it("format accepts loose input only when asked", () => {
    expect(() => formatJson('{"a":1,}')).toThrow();
    expect(formatJson('{"a":1,}', 0, true)).toBe('{"a":1}');
  });
  it("validate reports loose input as valid when asked", () => {
    expect(validateJson('{"a":1,}').valid).toBe(false);
    expect(validateJson('{"a":1,}', true).valid).toBe(true);
  });
  it("minifies loose input", () => {
    expect(minifyJson('{ "a": 1, // x\n }', true)).toBe('{"a":1}');
  });
});

describe("escape helpers", () => {
  it("unescapes a bare escaped payload", () => {
    expect(unescapeJsonString('{\\"a\\":1}')).toBe('{"a":1}');
  });
  it("unescapes a quoted string literal", () => {
    expect(unescapeJsonString('"line\\nbreak"')).toBe("line\nbreak");
  });
  it("rejects empty input", () => {
    expect(() => unescapeJsonString("   ")).toThrow();
  });
  it("escapes back to a literal", () => {
    expect(escapeJsonString('{"a":1}')).toBe('"{\\"a\\":1}"');
  });
  it("round-trips", () => {
    const raw = '{"a":"b\\nc"}';
    expect(unescapeJsonString(escapeJsonString(raw))).toBe(raw);
  });
});

describe("tree model", () => {
  it("classifies values", () => {
    expect(valueKind(null)).toBe("null");
    expect(valueKind([])).toBe("array");
    expect(valueKind({})).toBe("object");
    expect(valueKind(1)).toBe("number");
    expect(valueKind(true)).toBe("boolean");
    expect(valueKind("s")).toBe("string");
  });
  it("builds dotted paths for identifiers and bracketed paths otherwise", () => {
    expect(appendPath("$", "name", false)).toBe("$.name");
    expect(appendPath("$", "odd-key", false)).toBe("$['odd-key']");
    expect(appendPath("$.a", "0", true)).toBe("$.a[0]");
  });
  it("lists children with paths", () => {
    expect(childEntries({ a: 1, "b-c": 2 }, "$")).toEqual([
      { key: "a", value: 1, path: "$.a" },
      { key: "b-c", value: 2, path: "$['b-c']" },
    ]);
    expect(childEntries([7], "$.x")).toEqual([{ key: "0", value: 7, path: "$.x[0]" }]);
  });
  it("has no children for scalars", () => {
    expect(childEntries(5, "$")).toEqual([]);
  });
  it("previews containers by size and truncates long scalars", () => {
    expect(previewValue([1, 2])).toBe("[] 2 items");
    expect(previewValue({ a: 1 })).toBe("{} 1 key");
    expect(previewValue("x".repeat(80), 10)).toMatch(/…$/);
    expect(previewValue(null)).toBe("null");
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
