/**
 * Getting notes out of the app, and back in.
 *
 * Notes live in localStorage like every other store, which in the desktop build
 * is WebView2 storage — not a file, not something a backup tool sees. A notes
 * app you cannot get your notes out of is a trap, so there are two ways out:
 *
 * - a JSON bundle, which round-trips everything exactly, and
 * - Markdown with a small front matter header, which round-trips everything
 *   that matters and is still readable in any editor.
 *
 * The Markdown form is the important one. Its front matter is deliberately a
 * flat, quoted, hand-written subset rather than real YAML: a note exported
 * today has to parse in five years, and the parser here is small enough to
 * read in full. Anything it does not understand is ignored, never guessed at.
 *
 * Import is forgiving about shape and loud about failure — a file that is not
 * notes is reported, not silently dropped.
 */

import type { Note } from "./notes";

export const NOTES_FILE_KIND = "devhelper.notes";
export const NOTES_FILE_VERSION = 1;

export interface NotesFile {
  kind: typeof NOTES_FILE_KIND;
  version: number;
  exportedAt?: string;
  notes: Note[];
}

export interface ImportResult {
  notes: Note[];
  /** What was rejected and why — shown to the user rather than swallowed. */
  errors: string[];
}

/* ------------------------------------------------------------------ json ---- */

/** Serialize notes to the interchange format. `exportedAt` is passed in, so this stays pure. */
export function exportNotesJson(notes: Note[], exportedAt?: string): string {
  const file: NotesFile = { kind: NOTES_FILE_KIND, version: NOTES_FILE_VERSION, exportedAt, notes };
  return JSON.stringify(file, null, 2);
}

/**
 * Read a notes bundle.
 *
 * A bare array of notes is accepted too: it is what someone hand-editing an
 * export is most likely to end up with, and rejecting it would teach nothing.
 */
export function importNotesJson(text: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { notes: [], errors: [`Not valid JSON: ${(e as Error).message}`] };
  }

  const raw = Array.isArray(parsed) ? parsed : (parsed as NotesFile)?.notes;
  if (!Array.isArray(raw)) {
    return { notes: [], errors: ["No notes in this file — expected a `notes` array."] };
  }

  const notes: Note[] = [];
  const errors: string[] = [];
  raw.forEach((item, i) => {
    const note = coerceNote(item, i);
    if (typeof note === "string") errors.push(note);
    else notes.push(note);
  });
  return { notes, errors };
}

/** Accept anything with a body or a title; fill the rest with defaults. */
function coerceNote(item: unknown, index: number): Note | string {
  if (!item || typeof item !== "object") return `Entry ${index + 1} is not an object.`;
  const o = item as Record<string, unknown>;
  const title = str(o.title);
  const body = str(o.body);
  if (!title && !body) return `Entry ${index + 1} has neither a title nor a body.`;
  const created = num(o.createdAt) ?? 0;
  return {
    id: str(o.id) || `imported-${index}`,
    title: title || "Untitled",
    body,
    tags: Array.isArray(o.tags) ? o.tags.filter((t): t is string => typeof t === "string") : [],
    pinned: o.pinned === true,
    archived: o.archived === true,
    color: str(o.color) || undefined,
    createdAt: created,
    updatedAt: num(o.updatedAt) ?? created,
  };
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
/** Strict: `Number(null)` is 0, which would date every imported note to 1970. */
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/* -------------------------------------------------------------- markdown ---- */

/** One note as Markdown with a front matter header. */
export function noteToMarkdown(note: Note): string {
  const lines = ["---", `title: ${quote(note.title)}`];
  if (note.tags.length) lines.push(`tags: [${note.tags.map(quote).join(", ")}]`);
  if (note.pinned) lines.push("pinned: true");
  if (note.archived) lines.push("archived: true");
  if (note.color) lines.push(`color: ${quote(note.color)}`);
  if (note.createdAt) lines.push(`created: ${new Date(note.createdAt).toISOString()}`);
  if (note.updatedAt) lines.push(`updated: ${new Date(note.updatedAt).toISOString()}`);
  lines.push("---", "", note.body.replace(/\s*$/, ""), "");
  return lines.join("\n");
}

/** Every note in one file, separated by a rule — readable, and importable back. */
export function notesToMarkdown(notes: Note[]): string {
  return notes.map(noteToMarkdown).join("\n<!-- note -->\n\n");
}

/**
 * Read Markdown back into notes.
 *
 * Front matter is optional: a plain Markdown file becomes one note whose title
 * is its first heading, which is what dropping in a README should do. `now` is
 * passed in so an import gets one consistent timestamp.
 */
export function importNotesMarkdown(text: string, now: number): ImportResult {
  const chunks = text.split(/^<!-- note -->\s*$/m).map((c) => c.trim()).filter(Boolean);
  if (!chunks.length) return { notes: [], errors: ["The file is empty."] };

  const notes: Note[] = [];
  const errors: string[] = [];
  chunks.forEach((chunk, i) => {
    const { meta, body } = splitFrontMatter(chunk);
    const title = meta.title || firstHeading(body) || `Imported note ${i + 1}`;
    if (!body.trim() && !meta.title) {
      errors.push(`Section ${i + 1} is empty.`);
      return;
    }
    const created = parseDate(meta.created) ?? now;
    notes.push({
      id: `md-${now}-${i}`,
      title,
      body: stripLeadingHeading(body, title),
      tags: meta.tags ?? [],
      pinned: meta.pinned === "true",
      archived: meta.archived === "true",
      color: meta.color || undefined,
      createdAt: created,
      updatedAt: parseDate(meta.updated) ?? created,
    });
  });
  return { notes, errors };
}

interface FrontMatter {
  title?: string;
  tags?: string[];
  pinned?: string;
  archived?: string;
  color?: string;
  created?: string;
  updated?: string;
}

/**
 * Pull a `---` fenced header off the front of a document.
 *
 * Only `key: value` and `key: [a, b]` are understood, and only the keys this
 * module writes. Everything else is left in place and ignored.
 */
export function splitFrontMatter(text: string): { meta: FrontMatter; body: string } {
  // The newline before the closing fence is optional so an empty header still parses.
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n?---\r?\n?/);
  if (!m) return { meta: {}, body: text };

  const meta: FrontMatter = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    const value = kv[2].trim();
    if (key === "tags") meta.tags = parseList(value);
    else if (key === "title") meta.title = unquote(value);
    else if (key === "pinned" || key === "archived") meta[key] = value.toLowerCase();
    else if (key === "color") meta.color = unquote(value);
    else if (key === "created" || key === "updated") meta[key] = unquote(value);
  }
  return { meta, body: text.slice(m[0].length) };
}

function parseList(value: string): string[] {
  const inner = value.replace(/^\[/, "").replace(/\]$/, "");
  return inner.split(",").map((v) => unquote(v.trim())).filter(Boolean);
}

/** Quote only when the value could otherwise be misread; keeps the file readable. */
function quote(value: string): string {
  const v = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return /^[\w][\w .\-/]*$/.test(value) ? v : `"${v}"`;
}

function unquote(value: string): string {
  const v = value.trim();
  if (!(v.startsWith('"') && v.endsWith('"') && v.length >= 2)) return v;
  return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

/** An ISO date, or null. Never `new Date(undefined)`, which is an Invalid Date, not an error. */
function parseDate(value?: string): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

const firstHeading = (body: string): string => body.match(/^#{1,6}\s+(.+?)\s*$/m)?.[1]?.trim() ?? "";

/** Drop a leading `# Title` that only repeats the title we already have. */
function stripLeadingHeading(body: string, title: string): string {
  const trimmed = body.replace(/^\s+/, "");
  const m = trimmed.match(/^#{1,6}\s+(.+?)\s*(\r?\n|$)/);
  return m && m[1].trim() === title ? trimmed.slice(m[0].length).replace(/^\s*\n/, "") : body.trim();
}

/* ----------------------------------------------------------- file names ---- */

/** A title made safe for a Windows file name, never empty and never a reserved name. */
export function safeFileName(title: string, fallback = "note"): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/[\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  const reserved = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
  if (!cleaned || reserved.test(cleaned)) return fallback;
  return cleaned.slice(0, 80);
}
