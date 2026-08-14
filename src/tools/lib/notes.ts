/**
 * Notes — the pure model behind the Notes gadget.
 *
 * A note is Markdown plus a little metadata. Everything interesting is derived
 * from the Markdown itself rather than stored beside it, so a note stays a
 * plain file you could edit anywhere: `#tags` in the text are real tags,
 * `[[Wiki Links]]` are real links (and give backlinks for free), `- [ ]` lines
 * are real tasks, and `#` headings are the outline.
 *
 * Deriving instead of storing is what keeps the two views honest — the tag
 * sidebar can never disagree with the text, because there is only the text.
 *
 * All of this is pure and dependency-free. State lives in
 * src/stores/useNotesStore.ts; the screen is src/tools/impl/Notes.tsx.
 */

import { fuzzyMatch } from "@/lib/fuzzy";

export interface Note {
  id: string;
  title: string;
  /** Markdown. The single source of truth for tags, links, tasks and outline. */
  body: string;
  /** Tags typed into the tag field. `#tags` inside the body are added on top. */
  tags: string[];
  pinned: boolean;
  archived: boolean;
  /** Optional accent, one of ACCENTS. Undefined means "no accent". */
  color?: string;
  createdAt: number;
  updatedAt: number;
}

/** Accents a note may carry. Names, not hex, so themes stay in charge of the hue. */
export const ACCENTS = ["blue", "violet", "cyan", "green", "amber", "rose"] as const;
export type Accent = (typeof ACCENTS)[number];

/* ------------------------------------------------------------------ text ---- */

/**
 * Blank out fenced and inline code, keeping the text's length and line count.
 *
 * Length-preserving matters: line and character offsets computed on the
 * stripped copy still point at the right place in the original.
 */
export function stripCode(md: string): string {
  let out = md.replace(/```[\s\S]*?(```|$)/g, (m) => m.replace(/[^\n]/g, " "));
  out = out.replace(/`[^`\n]*`/g, (m) => " ".repeat(m.length));
  return out;
}

/** Words, characters and a reading estimate at 200 wpm (a minute is the floor). */
export function noteStats(body: string): { words: number; chars: number; readingMinutes: number } {
  const words = body.trim() ? body.trim().split(/\s+/).length : 0;
  return { words, chars: body.length, readingMinutes: words ? Math.max(1, Math.round(words / 200)) : 0 };
}

/** First non-empty, non-heading line, trimmed of Markdown noise and clipped. */
export function excerpt(body: string, max = 120): string {
  const line = stripCode(body)
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !/^#{1,6}\s/.test(l) && !/^[-*_]{3,}$/.test(l));
  if (!line) return "";
  const plain = line
    .replace(/^>\s*/, "")
    .replace(/^[-*+]\s+(\[[ xX]\]\s*)?/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .trim();
  return plain.length > max ? plain.slice(0, max - 1).trimEnd() + "…" : plain;
}

/* ------------------------------------------------------------------ tags ---- */

/**
 * `#tags` written in the body.
 *
 * A tag needs a letter straight after the hash, which is what separates it from
 * a `# heading`, and it must start a line or follow whitespace or an opening
 * bracket — so the fragment in `http://host/page#top` is not a tag. Code is
 * blanked out first.
 */
export function bodyTags(body: string): string[] {
  const found: string[] = [];
  const re = /(^|[\s([{])#([A-Za-z][\w/-]*)/g;
  let m: RegExpExecArray | null;
  const text = stripCode(body);
  while ((m = re.exec(text))) found.push(m[2]);
  return uniqueCI(found);
}

/** Every tag on a note: the ones typed into the field plus the ones in the text. */
export function allTags(note: Pick<Note, "tags" | "body">): string[] {
  return uniqueCI([...note.tags, ...bodyTags(note.body)]);
}

/** Tag → how many notes carry it, most-used first, then alphabetical. */
export function tagCounts(notes: Note[]): { tag: string; count: number }[] {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const n of notes) {
    for (const t of allTags(n)) {
      const key = t.toLowerCase();
      const hit = counts.get(key);
      if (hit) hit.count++;
      else counts.set(key, { tag: t, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

function uniqueCI(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.toLowerCase();
    if (!v || seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

/* ----------------------------------------------------------------- links ---- */

/** How a title is compared when resolving a `[[link]]`: case- and space-insensitive. */
export function linkKey(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Targets of the `[[Wiki Links]]` in a body (the part before any `|alias`). */
export function bodyLinks(body: string): string[] {
  const out: string[] = [];
  const re = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
  let m: RegExpExecArray | null;
  const text = stripCode(body);
  while ((m = re.exec(text))) {
    const target = m[1].trim();
    if (target) out.push(target);
  }
  return uniqueCI(out);
}

/** The note a `[[link]]` points at, or undefined when it points nowhere yet. */
export function resolveLink(target: string, notes: Note[]): Note | undefined {
  const key = linkKey(target);
  return notes.find((n) => linkKey(n.title) === key);
}

/** The notes that link *to* this one, newest first. */
export function backlinks(note: Note, notes: Note[]): Note[] {
  const key = linkKey(note.title);
  return notes
    .filter((n) => n.id !== note.id && bodyLinks(n.body).some((l) => linkKey(l) === key))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Link targets in this note that no note answers to — the notes worth writing next. */
export function danglingLinks(note: Note, notes: Note[]): string[] {
  return bodyLinks(note.body).filter((l) => !resolveLink(l, notes));
}

/* ----------------------------------------------------------------- tasks ---- */

export interface Task {
  /** 0-based line in the body. */
  line: number;
  text: string;
  done: boolean;
  /** Leading spaces, so nested checklists keep their shape. */
  indent: number;
}

const TASK_RE = /^(\s*)[-*+]\s+\[([ xX])\]\s?(.*)$/;

/** Every `- [ ]` / `- [x]` line in a body, in document order. */
export function extractTasks(body: string): Task[] {
  const out: Task[] = [];
  body.split("\n").forEach((line, i) => {
    const m = line.match(TASK_RE);
    if (m) out.push({ line: i, text: m[3].trim(), done: m[2].toLowerCase() === "x", indent: m[1].length });
  });
  return out;
}

/** Done / total for a body. */
export function taskStats(body: string): { done: number; total: number } {
  const tasks = extractTasks(body);
  return { done: tasks.filter((t) => t.done).length, total: tasks.length };
}

/**
 * Flip the checkbox on one line and hand back the new body.
 *
 * Editing the Markdown rather than a parallel task list is the whole point:
 * ticking a box in the preview and typing an `x` in the editor are the same
 * act, so they can never drift apart. A line that is not a task is left alone.
 */
export function toggleTask(body: string, line: number): string {
  const lines = body.split("\n");
  const target = lines[line];
  if (target === undefined) return body;
  const m = target.match(TASK_RE);
  if (!m) return body;
  lines[line] = target.replace(/\[([ xX])\]/, m[2].toLowerCase() === "x" ? "[ ]" : "[x]");
  return lines.join("\n");
}

/** Open tasks across every note, newest note first — the cross-note to-do list. */
export function openTasks(notes: Note[]): { note: Note; task: Task }[] {
  return [...notes]
    .filter((n) => !n.archived)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .flatMap((note) => extractTasks(note.body).filter((t) => !t.done).map((task) => ({ note, task })));
}

/* --------------------------------------------------------------- outline ---- */

export interface Heading {
  level: number;
  text: string;
  line: number;
}

/** The `#` headings of a body, for a table of contents. Code fences are ignored. */
export function outline(body: string): Heading[] {
  const out: Heading[] = [];
  stripCode(body).split("\n").forEach((line, i) => {
    const m = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (m) out.push({ level: m[1].length, text: m[2].trim(), line: i });
  });
  return out;
}

/* ----------------------------------------------------------------- query ---- */

export interface Query {
  /** Free text, everything that was not a filter. */
  text: string;
  tags: string[];
  /** `is:` flags that were asked for. */
  pinned: boolean;
  archived: boolean;
  tasks: boolean;
  untagged: boolean;
  orphan: boolean;
  /** `link:target` — notes linking to that title. */
  links: string[];
}

const EMPTY_QUERY: Query = { text: "", tags: [], pinned: false, archived: false, tasks: false, untagged: false, orphan: false, links: [] };

/**
 * Parse the search box: `tag:api #db is:pinned link:"Release plan" retry policy`.
 *
 * Unknown `is:` values are dropped rather than treated as text, so a typo
 * narrows nothing instead of quietly searching for the literal word.
 */
export function parseQuery(input: string): Query {
  const q: Query = { ...EMPTY_QUERY, tags: [], links: [] };
  const words: string[] = [];
  const tokens = input.match(/(?:[^\s"]+"[^"]*"?|"[^"]*"?|[^\s"]+)/g) ?? [];

  for (const raw of tokens) {
    const token = raw.trim();
    if (!token) continue;
    const unquote = (v: string) => v.replace(/^"|"$/g, "").trim();

    if (/^tags?:/i.test(token)) {
      const v = unquote(token.replace(/^tags?:/i, ""));
      if (v) q.tags.push(v);
    } else if (/^link:/i.test(token)) {
      const v = unquote(token.replace(/^link:/i, ""));
      if (v) q.links.push(v);
    } else if (/^is:/i.test(token)) {
      switch (unquote(token.slice(3)).toLowerCase()) {
        case "pinned": q.pinned = true; break;
        case "archived": q.archived = true; break;
        case "task": case "tasks": case "todo": q.tasks = true; break;
        case "untagged": q.untagged = true; break;
        case "orphan": case "orphaned": q.orphan = true; break;
      }
    } else if (/^#[A-Za-z]/.test(token)) {
      q.tags.push(token.slice(1));
    } else {
      words.push(unquote(token));
    }
  }

  q.text = words.join(" ").trim();
  return q;
}

/**
 * How well a note answers the free text: title matched fuzzily and weighted
 * heavily, tags next, body only as a substring.
 *
 * Body text is deliberately not fuzzy — a subsequence match against a thousand
 * words matches nearly everything, so it would rank noise above real hits.
 */
export function scoreNote(text: string, note: Note): number | null {
  if (!text) return 0;
  const needle = text.toLowerCase();
  let score = 0;

  const title = fuzzyMatch(text, note.title);
  if (title) score += title.score * 3;

  for (const tag of allTags(note)) {
    if (tag.toLowerCase().includes(needle)) score += 20;
  }

  const body = note.body.toLowerCase();
  if (body.includes(needle)) {
    let hits = 0;
    let at = body.indexOf(needle);
    while (at !== -1 && hits < 10) { hits++; at = body.indexOf(needle, at + needle.length); }
    score += 10 + hits * 2;
  }

  return score > 0 ? score : null;
}

/**
 * Apply a parsed query. Pinned notes lead, then score, then most recent.
 *
 * Archived notes stay out unless `is:archived` asked for them — an archive you
 * keep tripping over is not an archive.
 */
export function filterNotes(notes: Note[], input: string): Note[] {
  const q = parseQuery(input);
  const scored: { note: Note; score: number }[] = [];

  for (const note of notes) {
    if (q.archived !== note.archived) continue;
    if (q.pinned && !note.pinned) continue;
    if (q.untagged && allTags(note).length > 0) continue;
    if (q.tasks && !extractTasks(note.body).some((t) => !t.done)) continue;
    if (q.orphan && (bodyLinks(note.body).length > 0 || backlinks(note, notes).length > 0)) continue;

    if (q.tags.length) {
      const mine = allTags(note).map((t) => t.toLowerCase());
      if (!q.tags.every((t) => mine.includes(t.toLowerCase()))) continue;
    }
    if (q.links.length) {
      const mine = bodyLinks(note.body).map(linkKey);
      if (!q.links.every((l) => mine.includes(linkKey(l)))) continue;
    }

    const score = scoreNote(q.text, note);
    if (score === null) continue;
    scored.push({ note, score });
  }

  return scored
    .sort((a, b) => Number(b.note.pinned) - Number(a.note.pinned) || b.score - a.score || b.note.updatedAt - a.note.updatedAt)
    .map((s) => s.note);
}

/* ------------------------------------------------------------- revisions ---- */

export interface Revision {
  at: number;
  body: string;
  title: string;
}

/**
 * Push a revision onto a note's history, oldest dropped past `cap`.
 *
 * Consecutive edits within `windowMs` collapse into one entry, so a history of
 * fifty keystrokes does not push out the version from this morning. An edit
 * that changed nothing is not recorded.
 */
export function pushRevision(history: Revision[], next: Revision, cap = 30, windowMs = 120_000): Revision[] {
  const last = history[0];
  if (last && last.body === next.body && last.title === next.title) return history;
  const rest = last && next.at - last.at < windowMs ? history.slice(1) : history;
  return [next, ...rest].slice(0, cap);
}

/* ------------------------------------------------------------- templates ---- */

export interface Template {
  id: string;
  name: string;
  /** `{{date}}` and `{{time}}` are filled in when the template is used. */
  title: string;
  body: string;
  tags: string[];
}

export const TEMPLATES: Template[] = [
  {
    id: "daily",
    name: "Daily log",
    title: "{{date}}",
    tags: ["daily"],
    body: "## Doing\n\n- [ ] \n\n## Learned\n\n- \n\n## Blocked\n\n- \n",
  },
  {
    id: "bug",
    name: "Bug report",
    title: "Bug: ",
    tags: ["bug"],
    body: "## What happens\n\n\n## Expected\n\n\n## Steps\n\n1. \n\n## Environment\n\n| Field | Value |\n| --- | --- |\n| Build |  |\n| OS |  |\n\n## Evidence\n\n```\n\n```\n",
  },
  {
    id: "meeting",
    name: "Meeting",
    title: "Meeting — {{date}}",
    tags: ["meeting"],
    body: "**When:** {{date}} {{time}}\n**With:** \n\n## Notes\n\n- \n\n## Decisions\n\n- \n\n## Actions\n\n- [ ] \n",
  },
  {
    id: "decision",
    name: "Decision record",
    title: "Decision: ",
    tags: ["decision"],
    body: "**Status:** proposed\n**Date:** {{date}}\n\n## Context\n\n\n## Decision\n\n\n## Consequences\n\n- \n\n## Alternatives considered\n\n- \n",
  },
  {
    id: "snippet",
    name: "Command / snippet",
    title: "",
    tags: ["snippet"],
    body: "```\n\n```\n\nWhy: \n",
  },
];

/** Fill a template's `{{date}}` / `{{time}}` against a given instant. */
export function applyTemplate(t: Template, now: Date): { title: string; body: string; tags: string[] } {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const fill = (s: string) => s.replace(/\{\{date\}\}/g, date).replace(/\{\{time\}\}/g, time);
  return { title: fill(t.title), body: fill(t.body), tags: [...t.tags] };
}

const pad = (n: number) => String(n).padStart(2, "0");
