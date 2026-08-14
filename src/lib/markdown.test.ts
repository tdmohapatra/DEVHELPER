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

  it("parses a task list, keeping the source line of each item", () => {
    expect(parseMarkdown("intro\n\n- [ ] open\n- [x] shut")).toEqual([
      { type: "para", text: "intro" },
      { type: "tasks", items: [
        { text: "open", done: false, line: 2 },
        { text: "shut", done: true, line: 3 },
      ] },
    ]);
  });

  it("keeps a plain list and a task list apart", () => {
    expect(parseMarkdown("- plain\n- [ ] task").map((b) => b.type)).toEqual(["list", "tasks"]);
  });

  it("parses a table with its alignment", () => {
    expect(parseMarkdown("| a | b | c |\n| :-- | :-: | --: |\n| 1 | 2 | 3 |")).toEqual([
      { type: "table", header: ["a", "b", "c"], align: ["left", "center", "right"], rows: [["1", "2", "3"]] },
    ]);
  });

  it("needs the divider row before it calls something a table", () => {
    expect(parseMarkdown("| not | a table |").map((b) => b.type)).toEqual(["para"]);
  });

  it("does not swallow a table that follows a paragraph", () => {
    expect(parseMarkdown("text\n| a |\n| --- |\n| 1 |").map((b) => b.type)).toEqual(["para", "table"]);
  });

  it("parses block quotes, joining their lines", () => {
    expect(parseMarkdown("> one\n> two")).toEqual([{ type: "quote", text: "one\ntwo" }]);
  });

  it("parses horizontal rules and does not read them as a list", () => {
    expect(parseMarkdown("---")).toEqual([{ type: "hr" }]);
    expect(parseMarkdown("- - -")).toEqual([{ type: "hr" }]);
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

  it("tokenizes strikethrough", () => {
    expect(parseInline("~~gone~~")).toEqual([{ type: "strike", value: "gone" }]);
  });

  it("tokenizes a wiki link, and its alias when it has one", () => {
    expect(parseInline("see [[Release Plan]]")).toEqual([
      { type: "text", value: "see " },
      { type: "wikilink", target: "Release Plan", value: "Release Plan" },
    ]);
    expect(parseInline("[[Release Plan|the plan]]")).toEqual([
      { type: "wikilink", target: "Release Plan", value: "the plan" },
    ]);
  });

  it("reads a wiki link before an ordinary link", () => {
    expect(parseInline("[[a]] and [b](http://x)")).toEqual([
      { type: "wikilink", target: "a", value: "a" },
      { type: "text", value: " and " },
      { type: "link", value: "b", href: "http://x" },
    ]);
  });
});
