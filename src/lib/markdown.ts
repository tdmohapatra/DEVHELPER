/**
 * Minimal, dependency-free Markdown parser for AI output (headings, code fences, lists,
 * paragraphs, and inline bold/italic/code/links). Not CommonMark-complete — just the
 * subset LLMs actually emit. Rendering (to JSX) lives in components/Markdown.tsx.
 */

export type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "code"; lang: string; code: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "para"; text: string };

export type Inline =
  | { type: "text"; value: string }
  | { type: "bold"; value: string }
  | { type: "italic"; value: string }
  | { type: "code"; value: string }
  | { type: "link"; value: string; href: string };

const isListLine = (l: string) => /^\s*[-*+]\s+/.test(l) || /^\s*\d+\.\s+/.test(l);
const isHeading = (l: string) => /^#{1,6}\s+/.test(l);

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

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { blocks.push({ type: "heading", level: h[1].length, text: h[2].trim() }); i++; continue; }

    if (isListLine(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && isListLine(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, ""));
        i++;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    if (line.trim() === "") { i++; continue; }

    const buf: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== "" && !/^```/.test(lines[i]) && !isHeading(lines[i]) && !isListLine(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push({ type: "para", text: buf.join(" ") });
  }

  return blocks;
}

export function parseInline(text: string): Inline[] {
  const tokens: Inline[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) tokens.push({ type: "text", value: text.slice(last, m.index) });
    const tok = m[0];
    if (tok.startsWith("`")) tokens.push({ type: "code", value: tok.slice(1, -1) });
    else if (tok.startsWith("**")) tokens.push({ type: "bold", value: tok.slice(2, -2) });
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
