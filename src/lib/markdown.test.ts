import { describe, it, expect } from "vitest";
import { parseMarkdown, parseInline } from "./markdown";

describe("parseMarkdown", () => {
  it("parses headings with their level", () => {
    expect(parseMarkdown("### Root Cause")).toEqual([{ type: "heading", level: 3, text: "Root Cause" }]);
  });

  it("parses fenced code blocks with a language", () => {
    const md = "```csharp\nif (o == null) throw;\n```";
    expect(parseMarkdown(md)).toEqual([{ type: "code", lang: "csharp", code: "if (o == null) throw;" }]);
  });

  it("parses ordered and unordered lists", () => {
    expect(parseMarkdown("1. first\n2. second")).toEqual([{ type: "list", ordered: true, items: ["first", "second"] }]);
    expect(parseMarkdown("- a\n- b")).toEqual([{ type: "list", ordered: false, items: ["a", "b"] }]);
  });

  it("joins wrapped paragraph lines and separates on blank lines", () => {
    const blocks = parseMarkdown("Line one\nline two\n\nSecond para");
    expect(blocks).toEqual([
      { type: "para", text: "Line one line two" },
      { type: "para", text: "Second para" },
    ]);
  });

  it("handles a mixed document", () => {
    const md = "### Fix\nDo this:\n\n1. check null\n2. init\n\n```cs\nvar x = 1;\n```";
    const blocks = parseMarkdown(md);
    expect(blocks.map((b) => b.type)).toEqual(["heading", "para", "list", "code"]);
  });
});

describe("parseInline", () => {
  it("tokenizes bold, italic, code and links", () => {
    expect(parseInline("a **b** c")).toEqual([
      { type: "text", value: "a " },
      { type: "bold", value: "b" },
      { type: "text", value: " c" },
    ]);
    expect(parseInline("use `null` check")).toEqual([
      { type: "text", value: "use " },
      { type: "code", value: "null" },
      { type: "text", value: " check" },
    ]);
    expect(parseInline("see [docs](https://x.io)")).toEqual([
      { type: "text", value: "see " },
      { type: "link", value: "docs", href: "https://x.io" },
    ]);
  });
  it("returns plain text unchanged", () => {
    expect(parseInline("just text")).toEqual([{ type: "text", value: "just text" }]);
  });
});
