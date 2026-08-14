/**
 * Minimal, dependency-free Markdown parser for AI output and for notes — headings, code
 * fences, lists, task lists, tables, block quotes, rules, paragraphs, and inline
 * bold/italic/strikethrough/code/links/wiki-links. Not CommonMark-complete: just the
 * subset LLMs actually emit plus what a notes editor needs. Rendering (to JSX) lives in
 * components/Markdown.tsx.
 *
 * Task items carry the line they came from, so ticking a box in the rendered view can
 * edit that exact line of the source (see tools/lib/notes.ts `toggleTask`).
 */

export type Align = "left" | "center" | "right" | null;

export type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "code"; lang: string; code: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "tasks"; items: { text: string; done: boolean; line: number }[] }
  | { type: "table"; header: string[]; align: Align[]; rows: string[][] }
  | { type: "quote"; text: string }
  | { type: "hr" }
  | { type: "para"; text: string };

export type Inline =
  | { type: "text"; value: string }
  | { type: "bold"; value: string }
  | { type: "italic"; value: string }
  | { type: "strike"; value: string }
  | { type: "code"; value: string }
  | { type: "link"; value: string; href: string }
  | { type: "wikilink"; value: string; target: string };

const TASK_LINE = /^\s*[-*+]\s+\[([ xX])\]\s?(.*)$/;
const isListLine = (l: string) => /^\s*[-*+]\s+/.test(l) || /^\s*\d+\.\s+/.test(l);
const isHeading = (l: string) => /^#{1,6}\s+/.test(l);
const isQuote = (l: string) => /^\s*>\s?/.test(l);
/** `---`, `***`, `___` — three or more of one mark, spaces allowed between. */
const isRule = (l: string) => /^\s*([-*_])(\s*\1){2,}\s*$/.test(l);
/** The `| --- | :--: |` row that turns the line above it into a table header. */
const isTableDivider = (l: string) => /^\s*\|?(\s*:?-+:?\s*\|)+(\s*:?-+:?\s*)?\|?\s*$/.test(l) && l.includes("-");
const isTableRow = (l: string) => l.includes("|") && /\S/.test(l);

/** Split one table row into trimmed cells, dropping the empty edges from `| a | b |`. */
function tableCells(line: string): string[] {
  const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|");
  return cells.map((c) => c.trim());
}

export function parseMarkdown(md: string): Block[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const lang = fence[1] || "";
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // skip closing fence
      blocks.push({ type: "code", lang, code: buf.join("\n") });
      continue;
    }

    // Before lists: `- - -` is a rule, not a one-item list.
    if (isRule(line)) { blocks.push({ type: "hr" }); i++; continue; }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { blocks.push({ type: "heading", level: h[1].length, text: h[2].trim() }); i++; continue; }

    // A table is only a table once the divider row under the header proves it.
    if (isTableRow(line) && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const header = tableCells(line);
      const align: Align[] = tableCells(lines[i + 1]).map((c) => {
        const left = c.startsWith(":");
        const right = c.endsWith(":");
        return left && right ? "center" : right ? "right" : left ? "left" : null;
      });
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) { rows.push(tableCells(lines[i])); i++; }
      blocks.push({ type: "table", header, align, rows });
      continue;
    }

    if (TASK_LINE.test(line)) {
      const items: { text: string; done: boolean; line: number }[] = [];
      while (i < lines.length) {
        const m = lines[i].match(TASK_LINE);
        if (!m) break;
        items.push({ text: m[2].trim(), done: m[1].toLowerCase() === "x", line: i });
        i++;
      }
      blocks.push({ type: "tasks", items });
      continue;
    }

    if (isQuote(line)) {
      const buf: string[] = [];
      while (i < lines.length && isQuote(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
      blocks.push({ type: "quote", text: buf.join("\n").trim() });
      continue;
    }

    if (isListLine(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && isListLine(lines[i]) && !TASK_LINE.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, ""));
        i++;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    if (line.trim() === "") { i++; continue; }

    const buf: string[] = [line];
    i++;
    while (
      i < lines.length && lines[i].trim() !== "" &&
      !/^```/.test(lines[i]) && !isHeading(lines[i]) && !isListLine(lines[i]) &&
      !isQuote(lines[i]) && !isRule(lines[i]) && !isTableDivider(lines[i]) &&
      // A table header only looks like prose until the divider under it arrives.
      !(isTableRow(lines[i]) && i + 1 < lines.length && isTableDivider(lines[i + 1]))
    ) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push({ type: "para", text: buf.join(" ") });
  }

  return blocks;
}

export function parseInline(text: string): Inline[] {
  const tokens: Inline[] = [];
  // Wiki-links come before ordinary links: `[[a]]` also matches `[..](..)`'s opener.
  const re = /(`[^`]+`)|(\[\[[^\]]+\]\])|(\*\*[^*]+\*\*)|(~~[^~]+~~)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) tokens.push({ type: "text", value: text.slice(last, m.index) });
    const tok = m[0];
    if (tok.startsWith("`")) tokens.push({ type: "code", value: tok.slice(1, -1) });
    else if (tok.startsWith("[[")) {
      const [target, alias] = tok.slice(2, -2).split("|");
      tokens.push({ type: "wikilink", target: target.trim(), value: (alias ?? target).trim() });
    }
    else if (tok.startsWith("**")) tokens.push({ type: "bold", value: tok.slice(2, -2) });
    else if (tok.startsWith("~~")) tokens.push({ type: "strike", value: tok.slice(2, -2) });
    else if (tok.startsWith("*")) tokens.push({ type: "italic", value: tok.slice(1, -1) });
    else {
      const lm = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (lm) tokens.push({ type: "link", value: lm[1], href: lm[2] });
    }
    last = re.lastIndex;
  }
  if (last < text.length) tokens.push({ type: "text", value: text.slice(last) });
  return tokens;
}
