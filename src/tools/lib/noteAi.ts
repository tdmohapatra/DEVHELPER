/**
 * AI help for a note: what to ask, and what to do with the answer.
 *
 * Two rules shape this file.
 *
 * **The note is the user's.** Nothing here writes to it. Each action returns text
 * and says how it *could* be applied — replace, append, or just be read — and the
 * screen asks before anything lands. A writing tool that silently rewrote a
 * paragraph would be unusable for the one thing notes are for: keeping what you
 * actually wrote.
 *
 * **A selection beats the whole note.** If some text is selected, that is the
 * subject; otherwise the note is. Everything downstream reads `subject()` rather
 * than deciding for itself, so "improve this paragraph" and "improve the note" are
 * the same code path.
 */
import type { ChatMessage } from "@/lib/ai";

/** What the screen may do with a result once the user agrees. */
export type NoteApply =
  /** Put it where the subject was — the selection, or the whole body. */
  | "replace"
  /** Add it at the end of the note, under its own heading. */
  | "append"
  /** Read-only: an answer about the note rather than a change to it. */
  | "read"
  /** Sets the note's title and tags rather than its text. */
  | "meta";

export interface NoteAction {
  id: string;
  /** Button label. */
  label: string;
  /** One line on what it does, for the tooltip. */
  hint: string;
  /** What the result is for. */
  apply: NoteApply;
  /** Heading used when appending. */
  heading?: string;
  system: string;
  /** The user turn. `subject` is the selection or the whole note. */
  build: (subject: string, ctx: { title: string; selected: boolean }) => string;
}

const MARKDOWN_RULES =
  "Answer with GitHub-flavoured Markdown and nothing else — no preamble, no explanation of what you did, " +
  "no code fence around the whole answer. Keep the author's voice and any existing structure.";

export const NOTE_ACTIONS: NoteAction[] = [
  {
    id: "summarise",
    label: "Summarise",
    hint: "A short summary of what this says",
    apply: "append",
    heading: "Summary",
    system: `You summarise notes for the person who wrote them. Be brief and concrete: the points that would remind them what this was about. ${MARKDOWN_RULES}`,
    build: (subject, { selected }) =>
      `Summarise ${selected ? "this passage" : "this note"} in at most five bullet points.\n\n${subject}`,
  },
  {
    id: "improve",
    label: "Improve writing",
    hint: "Same meaning, clearer prose",
    apply: "replace",
    system:
      `You are an editor. Improve clarity and flow without changing meaning, adding claims, or inflating length. ` +
      `Preserve every Markdown structure exactly: headings, lists, task checkboxes ("- [ ]"), tables, links, [[wiki links]], #tags and code blocks. ` +
      `Do not touch text inside code blocks. ${MARKDOWN_RULES}`,
    build: (subject) => `Rewrite this more clearly, keeping the meaning and the structure:\n\n${subject}`,
  },
  {
    id: "continue",
    label: "Continue",
    hint: "Write the next part",
    apply: "append",
    system: `You continue a note in the author's own voice and format. Add substance, not filler. ${MARKDOWN_RULES}`,
    build: (subject, { title }) =>
      `This is a note titled "${title || "Untitled"}". Write what plausibly comes next — a paragraph or a short section, no repetition of what is already there.\n\n${subject}`,
  },
  {
    id: "analyse",
    label: "Analyse",
    hint: "What is missing, unclear or risky",
    apply: "read",
    system:
      "You review notes critically and usefully. Give the reading in three short sections — What this is about, Gaps and open questions, Risks or things that will bite — " +
      `and skip any section that has nothing worth saying. Be specific to the text; no generic advice. ${MARKDOWN_RULES}`,
    build: (subject, { selected }) =>
      `Analyse ${selected ? "this passage" : "this note"}.\n\n${subject}`,
  },
  {
    id: "tasks",
    label: "Find tasks",
    hint: "Pull out the actions as checkboxes",
    apply: "append",
    heading: "Tasks",
    system:
      "You extract action items from notes. Output only a Markdown task list, one action per line as \"- [ ] …\", " +
      "in the order they appear. Each line is a thing someone does, phrased as an instruction. " +
      "If the text contains no actions, answer exactly: (no actions found)",
    build: (subject) => `List the actions implied by this text as unchecked task lines:\n\n${subject}`,
  },
  {
    id: "meta",
    label: "Title & tags",
    hint: "Suggest a title and tags",
    apply: "meta",
    system:
      "You name things well. Answer with exactly two lines and nothing else:\n" +
      "Title: <a specific title, at most eight words>\n" +
      "Tags: <three to six #tags, lower case, hyphenated, space separated>",
    build: (subject) => `Suggest a title and tags for this note:\n\n${subject}`,
  },
  {
    id: "outline",
    label: "Outline",
    hint: "Reorganise into headings",
    apply: "replace",
    system:
      `You reorganise notes. Group the existing content under Markdown headings in a sensible order, keeping every fact, task and link. ` +
      `Do not invent content and do not delete any. ${MARKDOWN_RULES}`,
    build: (subject) => `Reorganise this under clear headings, keeping all of the content:\n\n${subject}`,
  },
];

export function noteAction(id: string): NoteAction | null {
  return NOTE_ACTIONS.find((a) => a.id === id) ?? null;
}

/** The text an action works on: the selection when there is one. */
export function subject(body: string, selection?: string): { text: string; selected: boolean } {
  const sel = (selection ?? "").trim();
  if (sel) return { text: sel, selected: true };
  return { text: body, selected: false };
}

/** Why the action cannot run, or null. */
export function noteAiProblem(body: string, selection?: string): string | null {
  const { text } = subject(body, selection);
  if (!text.trim()) return "There is nothing in this note yet.";
  // A very long note would be truncated by the model's context anyway; saying so
  // beats an answer that quietly ignores the second half.
  if (text.length > 24_000) return "This note is too long to send in one piece — select the part you want help with.";
  return null;
}

/** The messages for an action. */
export function buildNotePrompt(
  action: NoteAction,
  note: { title: string; body: string },
  selection?: string,
): ChatMessage[] {
  const { text, selected } = subject(note.body, selection);
  return [
    { role: "system", content: action.system },
    { role: "user", content: action.build(text, { title: note.title, selected }) },
  ];
}

/**
 * Apply a result to the note body.
 *
 * Pure, and the only place that decides what "append" and "replace" mean, so the
 * screen cannot get it subtly wrong per action. `read` returns the body unchanged
 * — the caller should not have offered to apply it, and silently editing would be
 * worse than doing nothing.
 */
export function applyNoteResult(
  action: NoteAction,
  body: string,
  result: string,
  selection?: { start: number; end: number },
): string {
  const text = result.trim();
  // `read` answers a question and `meta` sets fields; neither touches the text,
  // and editing it here would delete what the user wrote.
  if (!text || action.apply === "read" || action.apply === "meta") return body;

  if (action.apply === "append") {
    const heading = action.heading ? `## ${action.heading}\n\n` : "";
    const gap = body.trim() ? (body.endsWith("\n\n") ? "" : body.endsWith("\n") ? "\n" : "\n\n") : "";
    return `${body}${gap}${heading}${text}\n`;
  }

  // replace
  if (selection && selection.end > selection.start) {
    return body.slice(0, selection.start) + text + body.slice(selection.end);
  }
  return text;
}

/** Parse the two-line answer from the `meta` action. */
export function parseMeta(result: string): { title: string; tags: string[] } {
  const title = /^\s*title\s*:\s*(.+)$/im.exec(result)?.[1]?.trim() ?? "";
  const tagLine = /^\s*tags\s*:\s*(.+)$/im.exec(result)?.[1] ?? "";
  const tags = tagLine
    .split(/[\s,]+/)
    .map((t) => t.replace(/^#/, "").trim().toLowerCase())
    .filter(Boolean);
  // Dedupe while keeping the model's order — it puts the most specific first.
  return { title, tags: [...new Set(tags)] };
}
