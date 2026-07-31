import { describe, it, expect } from "vitest";
import { queryJsonPath, queryJsonText, JsonPathError } from "./jsonPath";

const DOC = {
  store: {
    name: "main",
    "odd-key": "yes",
    books: [
      { title: "A", price: 10, tags: ["x"], author: { name: "Ann" } },
      { title: "B", price: 25, tags: ["x", "y"], author: { name: "Bob" } },
      { title: "C", price: 5, tags: [], author: { name: "Cid" } },
    ],
  },
  active: true,
};

const values = (expr: string, root: unknown = DOC) => queryJsonPath(root, expr).map((m) => m.value);
const paths = (expr: string, root: unknown = DOC) => queryJsonPath(root, expr).map((m) => m.path);

describe("child access", () => {
  it("reads a dotted path", () => {
    expect(values("$.store.name")).toEqual(["main"]);
  });
  it("reads a bracketed name with non-identifier characters", () => {
    expect(values("$.store['odd-key']")).toEqual(["yes"]);
  });
  it("treats a leading bare name as a root child", () => {
    expect(values("active")).toEqual([true]);
  });
  it("returns nothing for a missing key", () => {
    expect(values("$.store.missing")).toEqual([]);
  });
  it("returns the root for $", () => {
    expect(values("$")).toEqual([DOC]);
  });
});

describe("indexes and slices", () => {
  it("reads an index", () => {
    expect(values("$.store.books[1].title")).toEqual(["B"]);
  });
  it("reads a negative index from the end", () => {
    expect(values("$.store.books[-1].title")).toEqual(["C"]);
  });
  it("reads an index union", () => {
    expect(values("$.store.books[0,2].title")).toEqual(["A", "C"]);
  });
  it("slices", () => {
    expect(values("$.store.books[0:2].title")).toEqual(["A", "B"]);
  });
  it("slices with a step", () => {
    expect(values("$.store.books[::2].title")).toEqual(["A", "C"]);
  });
  it("slices backwards with a negative step", () => {
    expect(values("$.store.books[::-1].title")).toEqual(["C", "B", "A"]);
  });
  it("ignores out-of-range indexes", () => {
    expect(values("$.store.books[9]")).toEqual([]);
  });
});

describe("wildcards", () => {
  it("expands array elements", () => {
    expect(values("$.store.books[*].title")).toEqual(["A", "B", "C"]);
  });
  it("expands object values with dot form", () => {
    expect(values("$.store.books[0].author.*")).toEqual(["Ann"]);
  });
});

describe("recursive descent", () => {
  it("collects a key at any depth", () => {
    expect(values("$..title")).toEqual(["A", "B", "C"]);
  });
  it("distinguishes nested keys of the same name", () => {
    expect(values("$..author.name")).toEqual(["Ann", "Bob", "Cid"]);
  });
  it("combines with a bracket selector", () => {
    expect(values("$..books[0].price")).toEqual([10]);
  });
  it("does not report duplicate paths", () => {
    const p = paths("$..name");
    expect(new Set(p).size).toBe(p.length);
  });
});

describe("filters", () => {
  it("compares numbers", () => {
    expect(values("$.store.books[?(@.price > 8)].title")).toEqual(["A", "B"]);
  });
  it("supports <=", () => {
    expect(values("$.store.books[?(@.price <= 10)].title")).toEqual(["A", "C"]);
  });
  it("compares strings", () => {
    expect(values("$.store.books[?(@.title == 'B')].price")).toEqual([25]);
  });
  it("supports !=", () => {
    expect(values("$.store.books[?(@.title != 'B')].title")).toEqual(["A", "C"]);
  });
  it("matches on a nested property", () => {
    expect(values("$.store.books[?(@.author.name == 'Cid')].title")).toEqual(["C"]);
  });
  it("treats a bare path as an existence test", () => {
    expect(values("$.store.books[?(@.price)].title")).toEqual(["A", "B", "C"]);
  });
  it("works after a recursive descent", () => {
    expect(values("$..books[?(@.price < 10)].title")).toEqual(["C"]);
  });
});

describe("reported paths", () => {
  it("uses dotted form for identifiers and brackets otherwise", () => {
    expect(paths("$..title")).toEqual([
      "$.store.books[0].title",
      "$.store.books[1].title",
      "$.store.books[2].title",
    ]);
    expect(paths("$.store['odd-key']")).toEqual(["$.store['odd-key']"]);
  });
});

describe("errors", () => {
  it("rejects an empty expression", () => {
    expect(() => queryJsonPath(DOC, "  ")).toThrow(JsonPathError);
  });
  it("rejects an unclosed bracket", () => {
    expect(() => queryJsonPath(DOC, "$.store.books[0")).toThrow(JsonPathError);
  });
  it("rejects an unquoted name inside brackets", () => {
    expect(() => queryJsonPath(DOC, "$.store[books]")).toThrow(JsonPathError);
  });
  it("rejects a filter that does not start with @", () => {
    expect(() => queryJsonPath(DOC, "$.store.books[?(price > 1)]")).toThrow(JsonPathError);
  });
});

describe("queryJsonText", () => {
  it("parses then queries", () => {
    expect(queryJsonText('{"a":[1,2,3]}', "$.a[1]").map((m) => m.value)).toEqual([2]);
  });
});
