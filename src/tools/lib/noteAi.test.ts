import { describe, expect, it } from "vitest";
import {
  applyNoteResult,
  buildNotePrompt,
  noteAction,
  noteAiProblem,
  NOTE_ACTIONS,
  parseMeta,
  subject,
} from "./noteAi";

const act = (id: string) => noteAction(id)!;

describe("NOTE_ACTIONS", () => {
  it("has unique ids and a coherent apply mode", () => {
    expect(new Set(NOTE_ACTIONS.map((a) => a.id)).size).toBe(NOTE_ACTIONS.length);
    for (const a of NOTE_ACTIONS) {
      expect(["replace", "append", "read", "meta"]).toContain(a.apply);
    }
  });

  it("gives a heading to the answers that are separate artifacts", () => {
    // A summary or a task list is a new section and needs a heading to be found
    // again. A continuation is the note carrying on, and a "## Continued" banner
    // in the middle of prose would be noise.
    expect(noteAction("summarise")!.heading).toBe("Summary");
    expect(noteAction("tasks")!.heading).toBe("Tasks");
    expect(noteAction("continue")!.heading).toBeUndefined();
  });

  it("tells the model to preserve the things a note is made of", () => {
    // Losing a task checkbox or a [[wiki link]] to a rewrite breaks the features
    // the rest of the tool is built on.
    const improve = act("improve").system;
    for (const must of ["- [ ]", "[[wiki links]]", "#tags", "code blocks"]) {
      expect(improve).toContain(must);
    }
  });
});

describe("subject", () => {
  it("prefers the selection", () => {
    expect(subject("whole note", "a bit")).toEqual({ text: "a bit", selected: true });
  });

  it("falls back to the body when the selection is blank", () => {
    expect(subject("whole note", "   \n ")).toEqual({ text: "whole note", selected: false });
    expect(subject("whole note")).toEqual({ text: "whole note", selected: false });
  });
});

describe("noteAiProblem", () => {
  it("is silent for ordinary text", () => {
    expect(noteAiProblem("some words")).toBeNull();
  });

  it("refuses an empty note", () => {
    expect(noteAiProblem("   ")).toContain("nothing in this note");
  });

  it("asks for a selection when the note is enormous", () => {
    expect(noteAiProblem("x".repeat(24_001))).toContain("select the part");
    // …and a selection out of a huge note is fine.
    expect(noteAiProblem("x".repeat(50_000), "a short passage")).toBeNull();
  });
});

describe("buildNotePrompt", () => {
  const note = { title: "Migration plan", body: "Move the queue first.\nThen the DB." };

  it("sends the system prompt and the note", () => {
    const msgs = buildNotePrompt(act("summarise"), note);
    expect(msgs[0].role).toBe("system");
    expect(msgs[1].content).toContain("Move the queue first.");
  });

  it("sends only the selection when there is one, and says so", () => {
    const msgs = buildNotePrompt(act("summarise"), note, "Then the DB.");
    expect(msgs[1].content).toContain("Then the DB.");
    expect(msgs[1].content).not.toContain("Move the queue first.");
    expect(msgs[1].content).toContain("this passage");
  });

  it("gives Continue the title, since that is what it is continuing", () => {
    expect(buildNotePrompt(act("continue"), note)[1].content).toContain("Migration plan");
  });

  it("copes with an untitled note", () => {
    expect(buildNotePrompt(act("continue"), { title: "", body: "x" })[1].content).toContain("Untitled");
  });
});

describe("applyNoteResult", () => {
  it("appends under its own heading, with one blank line before it", () => {
    const out = applyNoteResult(act("summarise"), "Body text.", "- a point");
    expect(out).toBe("Body text.\n\n## Summary\n\n- a point\n");
  });

  it("does not pile up blank lines when the note already ends with them", () => {
    expect(applyNoteResult(act("summarise"), "Body.\n\n", "- a")).toBe("Body.\n\n## Summary\n\n- a\n");
    expect(applyNoteResult(act("summarise"), "Body.\n", "- a")).toBe("Body.\n\n## Summary\n\n- a\n");
  });

  it("replaces the whole body when nothing was selected", () => {
    expect(applyNoteResult(act("improve"), "old text", "new text")).toBe("new text");
  });

  it("replaces exactly the selected range", () => {
    const body = "keep this REPLACE ME keep that";
    // "keep this " is ten characters, so the selection is [10, 20).
    const out = applyNoteResult(act("improve"), body, "better", { start: 10, end: 20 });
    expect(out).toBe("keep this better keep that");
  });

  it("never edits the note for an action that is not about the text", () => {
    // Analyse answers a question and Title & tags sets fields; applying either to
    // the body would delete the note.
    expect(applyNoteResult(act("analyse"), "my note", "some analysis")).toBe("my note");
    expect(applyNoteResult(act("meta"), "my note", "Title: X\nTags: #y")).toBe("my note");
  });

  it("ignores an empty answer rather than blanking the note", () => {
    expect(applyNoteResult(act("improve"), "my note", "   ")).toBe("my note");
  });
});

describe("parseMeta", () => {
  it("reads the two lines the prompt asks for", () => {
    expect(parseMeta("Title: Queue migration plan\nTags: #azure #service-bus #migration")).toEqual({
      title: "Queue migration plan",
      tags: ["azure", "service-bus", "migration"],
    });
  });

  it("copes with commas, missing hashes, odd case and duplicates", () => {
    expect(parseMeta("title: A Note\ntags: Azure, azure, HL7").tags).toEqual(["azure", "hl7"]);
  });

  it("returns empties rather than throwing on an unexpected answer", () => {
    expect(parseMeta("I could not think of one.")).toEqual({ title: "", tags: [] });
  });
});
