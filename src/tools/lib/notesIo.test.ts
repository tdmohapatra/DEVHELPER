import { describe, it, expect } from "vitest";
import {
  exportNotesJson, importNotesJson,
  noteToMarkdown, notesToMarkdown, importNotesMarkdown, splitFrontMatter,
  safeFileName,
  NOTES_FILE_KIND,
} from "./notesIo";
import type { Note } from "./notes";

const note = (over: Partial<Note> = {}): Note => ({
  id: "n1",
  title: "Release plan",
  body: "Ship it.\n\n- [ ] cut the tag",
  tags: ["ops"],
  pinned: false,
  archived: false,
  createdAt: Date.UTC(2026, 0, 2, 3, 4, 5),
  updatedAt: Date.UTC(2026, 0, 3, 4, 5, 6),
  ...over,
});

describe("json round trip", () => {
  it("writes the kind and version", () => {
    const file = JSON.parse(exportNotesJson([note()], "2026-08-14T00:00:00Z"));
    expect(file.kind).toBe(NOTES_FILE_KIND);
    expect(file.version).toBe(1);
    expect(file.exportedAt).toBe("2026-08-14T00:00:00Z");
  });

  it("round-trips a note exactly", () => {
    const original = note({ pinned: true, color: "violet" });
    const back = importNotesJson(exportNotesJson([original]));
    expect(back.errors).toEqual([]);
    expect(back.notes).toEqual([original]);
  });

  it("accepts a bare array of notes", () => {
    expect(importNotesJson(JSON.stringify([note()])).notes).toHaveLength(1);
  });

  it("reports invalid JSON rather than throwing", () => {
    const r = importNotesJson("{nope");
    expect(r.notes).toEqual([]);
    expect(r.errors[0]).toMatch(/Not valid JSON/);
  });

  it("reports a file that is not notes", () => {
    expect(importNotesJson('{"kind":"something"}').errors[0]).toMatch(/No notes/);
  });

  it("names the entry that was wrong and keeps the rest", () => {
    const r = importNotesJson(JSON.stringify([note(), { tags: [] }, 42]));
    expect(r.notes).toHaveLength(1);
    expect(r.errors).toEqual([
      "Entry 2 has neither a title nor a body.",
      "Entry 3 is not an object.",
    ]);
  });

  it("fills in defaults instead of trusting the shape", () => {
    const [n] = importNotesJson(JSON.stringify([{ title: "Just a title", tags: ["ok", 7] }])).notes;
    expect(n).toMatchObject({ body: "", tags: ["ok"], pinned: false, archived: false });
  });

  it("does not date a note without timestamps to 1970 by way of Number(null)", () => {
    const [n] = importNotesJson(JSON.stringify([{ title: "t", createdAt: null, updatedAt: "nope" }])).notes;
    expect(n.createdAt).toBe(0);
    expect(n.updatedAt).toBe(0);
  });

  it("copies createdAt into updatedAt when only one is given", () => {
    const [n] = importNotesJson(JSON.stringify([{ title: "t", createdAt: 555 }])).notes;
    expect(n.updatedAt).toBe(555);
  });
});

describe("front matter", () => {
  it("reads keys and a tag list", () => {
    const { meta, body } = splitFrontMatter('---\ntitle: "A: title"\ntags: [ops, "two words"]\npinned: true\n---\nBody');
    expect(meta).toMatchObject({ title: "A: title", tags: ["ops", "two words"], pinned: "true" });
    expect(body).toBe("Body");
  });

  it("leaves a document with no front matter alone", () => {
    expect(splitFrontMatter("# Hello")).toEqual({ meta: {}, body: "# Hello" });
  });

  it("ignores keys it does not understand", () => {
    const { meta } = splitFrontMatter("---\ntitle: T\nweird: 1\n---\n");
    expect(meta).toEqual({ title: "T" });
  });

  it("survives a horizontal rule further down the body", () => {
    const { body } = splitFrontMatter("---\ntitle: T\n---\none\n\n---\n\ntwo");
    expect(body).toBe("one\n\n---\n\ntwo");
  });
});

describe("markdown round trip", () => {
  it("writes front matter and the body", () => {
    const md = noteToMarkdown(note({ pinned: true }));
    expect(md.startsWith("---\ntitle: Release plan\ntags: [ops]\npinned: true\n")).toBe(true);
    expect(md).toContain("- [ ] cut the tag");
  });

  it("quotes a title that would otherwise be misread", () => {
    expect(noteToMarkdown(note({ title: "Bug: [redis] down" }))).toContain('title: "Bug: [redis] down"');
  });

  it("round-trips title, tags, flags, body and dates", () => {
    const original = note({ pinned: true, archived: true, color: "rose", tags: ["ops", "two words"] });
    const { notes, errors } = importNotesMarkdown(noteToMarkdown(original), 9999);
    expect(errors).toEqual([]);
    expect(notes[0]).toMatchObject({
      title: original.title,
      tags: original.tags,
      pinned: true,
      archived: true,
      color: "rose",
      body: original.body,
      createdAt: original.createdAt,
      updatedAt: original.updatedAt,
    });
  });

  it("round-trips several notes through one file", () => {
    const many = [note({ id: "a", title: "One" }), note({ id: "b", title: "Two", tags: [] })];
    const back = importNotesMarkdown(notesToMarkdown(many), 1);
    expect(back.notes.map((n) => n.title)).toEqual(["One", "Two"]);
  });

  it("takes the title from the first heading of a plain markdown file", () => {
    const { notes } = importNotesMarkdown("# From a README\n\nSome text", 1234);
    expect(notes[0].title).toBe("From a README");
    expect(notes[0].body).toBe("Some text");
    expect(notes[0].createdAt).toBe(1234);
  });

  it("keeps a heading that is not the title", () => {
    const { notes } = importNotesMarkdown("---\ntitle: Real title\n---\n# Section\ntext", 1);
    expect(notes[0].body).toBe("# Section\ntext");
  });

  it("names a section that carried nothing", () => {
    const r = importNotesMarkdown("---\n---\n", 1);
    expect(r.notes).toEqual([]);
    expect(r.errors[0]).toMatch(/empty/);
  });

  it("reports an empty file", () => {
    expect(importNotesMarkdown("   ", 1).errors[0]).toMatch(/empty/);
  });

  it("gives an untitled section a name rather than dropping it", () => {
    expect(importNotesMarkdown("plain text, no heading", 1).notes[0].title).toBe("Imported note 1");
  });
});

describe("safeFileName", () => {
  it("replaces the characters Windows refuses", () => {
    expect(safeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe("a-b-c-d-e-f-g-h-i-j");
  });

  it("trims trailing dots and spaces", () => {
    expect(safeFileName("report... ")).toBe("report");
  });

  it("falls back for an empty or reserved name", () => {
    expect(safeFileName("   ")).toBe("note");
    expect(safeFileName("CON")).toBe("note");
    expect(safeFileName("", "notes")).toBe("notes");
  });

  it("clips a very long title", () => {
    expect(safeFileName("x".repeat(200))).toHaveLength(80);
  });
});
