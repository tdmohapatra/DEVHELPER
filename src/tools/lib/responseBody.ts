/**
 * What a response body actually is, and how to show it.
 *
 * The Content-Type header is the first source, not the only one: plenty of
 * endpoints answer `text/plain` with JSON, or `text/html` with an error page
 * where JSON was expected. When the header and the bytes disagree, the bytes
 * win — the point of the viewer is to show what arrived, not what was claimed.
 */

export type BodyKind = "json" | "html" | "xml" | "css" | "javascript" | "csv" | "text" | "binary";

export type ViewMode = "pretty" | "raw" | "preview";

export const KIND_LABELS: Record<BodyKind, string> = {
  json: "JSON",
  html: "HTML",
  xml: "XML",
  css: "CSS",
  javascript: "JavaScript",
  csv: "CSV",
  text: "Text",
  binary: "Binary",
};

/** Header value for a key, matched case-insensitively. */
export function headerValue(headers: Record<string, string>, name: string): string {
  const hit = Object.entries(headers).find(([k]) => k.toLowerCase() === name.toLowerCase());
  return hit?.[1] ?? "";
}

/** The media type without parameters, lowercased. `application/json; charset=utf-8` → `application/json`. */
export function mediaType(contentType: string): string {
  return contentType.split(";")[0].trim().toLowerCase();
}

function looksLikeJson(body: string): boolean {
  const t = body.trim();
  if (!(t.startsWith("{") || t.startsWith("["))) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

function looksLikeHtml(body: string): boolean {
  const head = body.trimStart().slice(0, 500).toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html") || /<(head|body|div|meta|title)\b/.test(head);
}

function looksLikeXml(body: string): boolean {
  const head = body.trimStart().slice(0, 200);
  return head.startsWith("<?xml") || (head.startsWith("<") && !looksLikeHtml(body));
}

/**
 * Bytes that no text view can render.
 *
 * A NUL or a run of C0 control characters means the transport handed us binary
 * (or a mis-decoded encoding). Saying so beats painting the pane with replacement
 * characters.
 */
function looksBinary(body: string): boolean {
  if (body.includes("\u0000")) return true;
  const sample = body.slice(0, 2000);
  if (sample.length === 0) return false;
  let odd = 0;
  for (const ch of sample) {
    const c = ch.codePointAt(0)!;
    // Tab, newline and carriage return are ordinary text.
    if (c < 32 && c !== 9 && c !== 10 && c !== 13) odd++;
    if (c === 0xfffd) odd++; // replacement char — the decode already failed
  }
  return odd / sample.length > 0.05;
}

/** Classify a body from its declared type and its content, content taking priority. */
export function detectBodyKind(contentType: string, body: string): BodyKind {
  if (looksBinary(body)) return "binary";
  const type = mediaType(contentType);

  // Content first: a mislabelled body is common and the label is only a hint.
  if (looksLikeJson(body)) return "json";
  if (looksLikeHtml(body)) return "html";

  if (type.includes("json") || type.endsWith("+json")) return "json";
  if (type.includes("html")) return "html";
  if (type.includes("xml") || type.endsWith("+xml")) return "xml";
  if (type.includes("csv")) return "csv";
  if (type.includes("css")) return "css";
  if (type.includes("javascript") || type.includes("ecmascript")) return "javascript";
  if (type.startsWith("image/") || type.startsWith("audio/") || type.startsWith("video/") || type === "application/octet-stream") {
    return "binary";
  }

  if (looksLikeXml(body)) return "xml";
  return "text";
}

/** Tags whose contents must survive verbatim — reindenting them changes what they mean. */
const VERBATIM_TAGS = new Set(["pre", "script", "style", "textarea"]);
/** HTML elements with no closing tag. */
const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

/**
 * Indent markup one tag per line.
 *
 * A deliberately small formatter, not a parser: it is here so a minified page or
 * a one-line SOAP envelope can be read, and it never has to round-trip. Content
 * inside pre/script/style/textarea is copied through untouched, because
 * reindenting it would change the rendered output.
 */
export function formatMarkup(source: string): string {
  const out: string[] = [];
  let depth = 0;
  let i = 0;
  const indent = () => "  ".repeat(Math.max(0, depth));

  while (i < source.length) {
    const lt = source.indexOf("<", i);
    if (lt < 0) {
      const rest = source.slice(i).trim();
      if (rest) out.push(indent() + rest);
      break;
    }
    // Text before this tag.
    const text = source.slice(i, lt).trim();
    if (text) out.push(indent() + text);

    // Comments and CDATA run to their own terminator, angle brackets included.
    if (source.startsWith("<!--", lt)) {
      const end = source.indexOf("-->", lt);
      const stop = end < 0 ? source.length : end + 3;
      out.push(indent() + source.slice(lt, stop).trim());
      i = stop;
      continue;
    }

    const gt = source.indexOf(">", lt);
    if (gt < 0) {
      out.push(indent() + source.slice(lt).trim());
      break;
    }
    const tag = source.slice(lt, gt + 1);
    const nameMatch = /^<\/?\s*([a-zA-Z0-9:-]+)/.exec(tag);
    const name = nameMatch ? nameMatch[1].toLowerCase() : "";
    const isClose = tag.startsWith("</");
    const isDecl = tag.startsWith("<!") || tag.startsWith("<?");
    const isSelfClosing = tag.endsWith("/>") || VOID_TAGS.has(name);

    if (isClose) depth = Math.max(0, depth - 1);
    out.push(indent() + tag.trim());
    i = gt + 1;

    if (isDecl || isClose || isSelfClosing) continue;

    if (VERBATIM_TAGS.has(name)) {
      // Copy through to the matching close tag without touching the inside.
      const closeIdx = source.toLowerCase().indexOf(`</${name}`, i);
      if (closeIdx < 0) continue;
      const inner = source.slice(i, closeIdx);
      if (inner.trim()) out.push(inner.replace(/\r?\n$/, ""));
      const closeGt = source.indexOf(">", closeIdx);
      const stop = closeGt < 0 ? source.length : closeGt + 1;
      out.push(indent() + source.slice(closeIdx, stop).trim());
      i = stop;
      continue;
    }

    depth++;
  }

  return out.join("\n");
}

export interface FormattedBody {
  text: string;
  /** Set when the body could not be formatted as its kind claims. */
  note?: string;
}

/** The body prepared for the Pretty view. */
export function formatBody(kind: BodyKind, body: string): FormattedBody {
  if (kind === "binary") {
    return { text: "", note: "This body is binary and cannot be shown as text." };
  }
  if (kind === "json") {
    try {
      return { text: JSON.stringify(JSON.parse(body), null, 2) };
    } catch (e) {
      return { text: body, note: `Not valid JSON: ${(e as Error).message}` };
    }
  }
  if (kind === "html" || kind === "xml") {
    return { text: formatMarkup(body) };
  }
  return { text: body };
}

/** Which view tabs make sense for this kind. */
export function availableModes(kind: BodyKind): ViewMode[] {
  if (kind === "binary") return ["raw"];
  if (kind === "html") return ["pretty", "raw", "preview"];
  return ["pretty", "raw"];
}

export interface HtmlSummary {
  title: string;
  description: string;
  /** `h1`–`h3` text, in document order. */
  headings: string[];
  links: number;
  scripts: number;
  images: number;
  forms: number;
  /** Tags stripped, whitespace collapsed — what a reader would actually see. */
  text: string;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&"); // last, so &amp;lt; does not become <
}

function count(source: string, re: RegExp): number {
  return source.match(re)?.length ?? 0;
}

/**
 * The readable facts of an HTML page.
 *
 * Useful on its own — "which page did this endpoint actually return" is usually
 * answered by the title alone — and it is the fallback when the sandboxed
 * preview renders nothing.
 */
export function htmlSummary(body: string): HtmlSummary {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1] ?? "";
  const description =
    /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i.exec(body)?.[1] ??
    /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i.exec(body)?.[1] ??
    "";

  const headings: string[] = [];
  const headingRe = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(body)) !== null) {
    const text = decodeEntities(m[2].replace(/<[^>]*>/g, "")).trim();
    if (text) headings.push(text);
    if (headings.length >= 40) break;
  }

  const text = decodeEntities(
    body
      // Drop the elements whose contents are never shown to a reader.
      .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();

  return {
    title: decodeEntities(title).trim(),
    description: decodeEntities(description).trim(),
    headings,
    links: count(body, /<a\b[^>]*href=/gi),
    scripts: count(body, /<script\b/gi),
    images: count(body, /<img\b/gi),
    forms: count(body, /<form\b/gi),
    text,
  };
}

/** Line and character counts for the status line. */
export function bodyStats(body: string): { lines: number; chars: number } {
  return { lines: body === "" ? 0 : body.split("\n").length, chars: body.length };
}

/** True when a JSONPath filter box is worth offering. */
export function supportsJsonPath(kind: BodyKind): boolean {
  return kind === "json";
}
