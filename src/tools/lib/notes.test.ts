import { describe, it, expect } from "vitest";
import {
  stripCode, noteStats, excerpt,
  bodyTags, allTags, tagCounts,
  linkKey, bodyLinks, resolveLink, backlinks, danglingLinks,
  extractTasks, taskStats, toggleTask, openTasks,
  outline,
  parseQuery, scoreNote, filterNotes,
  pushRevision,
  TEMPLATES, applyTemplate,
  type Note,
} from "./notes";

const note = (over: Partial<Note> = {}): Note => ({
  id: over.id ?? "n1",
  title: over.title ?? "Untitled",
  body: over.body ?? "",
  tags: over.tags ?? [],
  pinned: over.pinned ?? false,
  archived: over.archived ?? false,
  color: over.color,
  createdAt: over.createdAt ?? 1000,
  updatedAt: over.updatedAt ?? 1000,
});

describe("stripCode", () => {
  it("blanks fenced code but keeps the line count and length", () => {
    const md = "before\n```js\nconst x = 1;\n```\nafter";
    const out = stripCode(md);
    expect(out.length).toBe(md.length);
    expect(out.split("\n").length).toBe(md.split("\n").length);
    expect(out).toContain("before");
    expect(out).not.toContain("const x");
  });

  it("blanks inline code", () => {
    // `#nope` is seven characters, replaced by seven spaces.
    expect(stripCode("use `#nope` here")).toBe("use " + " ".repeat(7) + " here");
  });

  it("blanks an unclosed fence to the end", () => {
    expect(stripCode("a\n```\n#tag")).not.toContain("#tag");
  });
});

describe("noteStats", () => {
  it("counts words and characters", () => {
    expect(noteStats("one two three")).toEqual({ words: 3, chars: 13, readingMinutes: 1 });
  });

  it("reports nothing for an empty body", () => {
    expect(noteStats("   ")).toEqual({ words: 0, chars: 3, readingMinutes: 0 });
  });

  it("rounds reading time at 200 wpm", () => {
    expect(noteStats("w ".repeat(600)).readingMinutes).toBe(3);
  });
});

describe("excerpt", () => {
  it("skips headings and rules, and strips markdown", () => {
    expect(excerpt("# Title\n---\n**Bold** and [a link](http://x)")).toBe("Bold and a link");
  });

  it("unwraps a wiki link to its target", () => {
    expect(excerpt("See [[Release plan|the plan]]")).toBe("See Release plan");
  });

  it("drops list and task markers", () => {
    expect(excerpt("- [ ] ship it")).toBe("ship it");
  });

  it("clips long text with an ellipsis", () => {
    expect(excerpt("x".repeat(200), 10)).toBe("xxxxxxxxx…");
  });

  it("returns empty when there is nothing but a heading", () => {
    expect(excerpt("# Only a heading")).toBe("");
  });
});

describe("bodyTags", () => {
  it("finds hash tags in the text", () => {
    expect(bodyTags("about #redis and #db/postgres")).toEqual(["redis", "db/postgres"]);
  });

  it("does not mistake a heading for a tag", () => {
    expect(bodyTags("# Heading\n## Another")).toEqual([]);
  });

  it("does not mistake a url fragment for a tag", () => {
    expect(bodyTags("see http://host/page#section")).toEqual([]);
  });

  it("ignores tags inside code", () => {
    expect(bodyTags("```\n#notatag\n```\n#real")).toEqual(["real"]);
  });

  it("de-duplicates case-insensitively, keeping the first spelling", () => {
    expect(bodyTags("#API and #api")).toEqual(["API"]);
  });
});

describe("allTags / tagCounts", () => {
  it("merges the tag field with the body tags", () => {
    expect(allTags({ tags: ["ops"], body: "#redis #ops" })).toEqual(["ops", "redis"]);
  });

  it("counts tags across notes, most used first", () => {
    const notes = [
      note({ id: "a", tags: ["api"], body: "#db" }),
      note({ id: "b", body: "#db" }),
    ];
    expect(tagCounts(notes)).toEqual([
      { tag: "db", count: 2 },
      { tag: "api", count: 1 },
    ]);
  });
});

describe("links", () => {
  const plan = note({ id: "plan", title: "Release Plan" });
  const work = note({ id: "work", title: "Work", body: "blocked by [[release plan]] and [[Nothing Yet]]", updatedAt: 5 });

  it("normalises a title for matching", () => {
    expect(linkKey("  Release   Plan ")).toBe("release plan");
  });

  it("reads link targets, ignoring the alias", () => {
    expect(bodyLinks("[[A|shown as this]] and [[B]]")).toEqual(["A", "B"]);
  });

  it("ignores links inside code", () => {
    expect(bodyLinks("`[[nope]]`\n[[yes]]")).toEqual(["yes"]);
  });

  it("resolves a link case- and space-insensitively", () => {
    expect(resolveLink("release plan", [plan, work])?.id).toBe("plan");
    expect(resolveLink("missing", [plan, work])).toBeUndefined();
  });

  it("finds backlinks and never counts a note as its own", () => {
    expect(backlinks(plan, [plan, work]).map((n) => n.id)).toEqual(["work"]);
    expect(backlinks(work, [plan, work])).toEqual([]);
  });

  it("lists the links that point nowhere yet", () => {
    expect(danglingLinks(work, [plan, work])).toEqual(["Nothing Yet"]);
  });
});

describe("tasks", () => {
  const body = "- [ ] first\n  - [x] nested done\ntext\n* [ ] third";

  it("extracts tasks with their line, state and indent", () => {
    expect(extractTasks(body)).toEqual([
      { line: 0, text: "first", done: false, indent: 0 },
      { line: 1, text: "nested done", done: true, indent: 2 },
      { line: 3, text: "third", done: false, indent: 0 },
    ]);
  });

  it("counts done against total", () => {
    expect(taskStats(body)).toEqual({ done: 1, total: 3 });
  });

  it("toggles a checkbox both ways", () => {
    expect(toggleTask(body, 0).split("\n")[0]).toBe("- [x] first");
    expect(toggleTask(body, 1).split("\n")[1]).toBe("  - [X] nested done".replace("[X]", "[ ]"));
  });

  it("leaves a non-task line and an out-of-range line alone", () => {
    expect(toggleTask(body, 2)).toBe(body);
    expect(toggleTask(body, 99)).toBe(body);
  });

  it("collects open tasks across notes, newest note first, skipping archived", () => {
    const notes = [
      note({ id: "old", body: "- [ ] old thing", updatedAt: 1 }),
      note({ id: "new", body: "- [ ] new thing\n- [x] done thing", updatedAt: 9 }),
      note({ id: "gone", body: "- [ ] hidden", archived: true, updatedAt: 10 }),
    ];
    expect(openTasks(notes).map((t) => `${t.note.id}:${t.task.text}`)).toEqual(["new:new thing", "old:old thing"]);
  });
});

describe("outline", () => {
  it("lists headings with their level and line", () => {
    expect(outline("# One\ntext\n### Three")).toEqual([
      { level: 1, text: "One", line: 0 },
      { level: 3, text: "Three", line: 2 },
    ]);
  });

  it("ignores a hash inside a code fence", () => {
    expect(outline("```\n# not a heading\n```")).toEqual([]);
  });
});

describe("parseQuery", () => {
  it("splits filters from free text", () => {
    const q = parseQuery("tag:api #db is:pinned link:Plan retry policy");
    expect(q.tags).toEqual(["api", "db"]);
    expect(q.links).toEqual(["Plan"]);
    expect(q.pinned).toBe(true);
    expect(q.text).toBe("retry policy");
  });

  it("accepts quoted filter values", () => {
    expect(parseQuery('link:"Release plan"').links).toEqual(["Release plan"]);
  });

  it("reads every is: flag", () => {
    const q = parseQuery("is:archived is:tasks is:untagged is:orphan");
    expect([q.archived, q.tasks, q.untagged, q.orphan]).toEqual([true, true, true, true]);
  });

  it("drops an unknown is: value instead of searching for it", () => {
    const q = parseQuery("is:pinnd hello");
    expect(q.pinned).toBe(false);
    expect(q.text).toBe("hello");
  });

  it("returns an empty query for empty input", () => {
    expect(parseQuery("   ")).toMatchObject({ text: "", tags: [], links: [], pinned: false });
  });
});

describe("scoreNote", () => {
  it("scores anything when there is no text", () => {
    expect(scoreNote("", note())).toBe(0);
  });

  it("ranks a title match above a body match", () => {
    const titled = note({ title: "Redis notes", body: "nothing" });
    const bodied = note({ title: "Other", body: "redis redis" });
    expect(scoreNote("redis", titled)!).toBeGreaterThan(scoreNote("redis", bodied)!);
  });

  it("matches the body only as a substring, not as a subsequence", () => {
    expect(scoreNote("rds", note({ title: "x", body: "r d s spread out" }))).toBeNull();
  });

  it("credits a tag match", () => {
    expect(scoreNote("ops", note({ title: "x", tags: ["ops"] }))).toBeGreaterThan(0);
  });
});

describe("filterNotes", () => {
  const notes = [
    note({ id: "a", title: "Redis", tags: ["ops"], body: "- [ ] tune it", updatedAt: 3 }),
    note({ id: "b", title: "Postgres", body: "links to [[Redis]]", pinned: true, updatedAt: 2 }),
    note({ id: "c", title: "Old", body: "archived text", archived: true, updatedAt: 1 }),
    note({ id: "d", title: "Lonely", updatedAt: 4 }),
  ];

  it("hides archived notes until is:archived asks for them", () => {
    expect(filterNotes(notes, "").map((n) => n.id)).toEqual(["b", "d", "a"]);
    expect(filterNotes(notes, "is:archived").map((n) => n.id)).toEqual(["c"]);
  });

  it("puts pinned notes first", () => {
    expect(filterNotes(notes, "")[0].id).toBe("b");
  });

  it("filters by tag", () => {
    expect(filterNotes(notes, "tag:ops").map((n) => n.id)).toEqual(["a"]);
  });

  it("filters by open task", () => {
    expect(filterNotes(notes, "is:tasks").map((n) => n.id)).toEqual(["a"]);
  });

  it("filters by outgoing link", () => {
    expect(filterNotes(notes, "link:redis").map((n) => n.id)).toEqual(["b"]);
  });

  it("finds notes with neither links nor backlinks", () => {
    expect(filterNotes(notes, "is:orphan").map((n) => n.id)).toEqual(["d"]);
  });

  it("finds untagged notes", () => {
    expect(filterNotes(notes, "is:untagged").map((n) => n.id)).toEqual(["b", "d"]);
  });

  it("requires every tag, not any", () => {
    expect(filterNotes(notes, "tag:ops tag:missing")).toEqual([]);
  });

  it("combines a filter with free text", () => {
    expect(filterNotes(notes, "tag:ops redis").map((n) => n.id)).toEqual(["a"]);
    expect(filterNotes(notes, "tag:ops postgres")).toEqual([]);
  });
});

describe("pushRevision", () => {
  it("records a changed body", () => {
    const h = pushRevision([], { at: 1, body: "a", title: "t" });
    expect(h).toHaveLength(1);
  });

  it("ignores an edit that changed nothing", () => {
    const first = pushRevision([], { at: 1, body: "a", title: "t" });
    expect(pushRevision(first, { at: 2, body: "a", title: "t" })).toBe(first);
  });

  it("collapses edits made close together", () => {
    let h = pushRevision([], { at: 0, body: "a", title: "t" });
    h = pushRevision(h, { at: 1_000, body: "ab", title: "t" });
    expect(h).toHaveLength(1);
    expect(h[0].body).toBe("ab");
  });

  it("keeps a separate entry once the window has passed", () => {
    let h = pushRevision([], { at: 0, body: "a", title: "t" });
    h = pushRevision(h, { at: 200_000, body: "ab", title: "t" });
    expect(h.map((r) => r.body)).toEqual(["ab", "a"]);
  });

  it("drops the oldest past the cap", () => {
    let h: ReturnType<typeof pushRevision> = [];
    for (let i = 0; i < 10; i++) h = pushRevision(h, { at: i * 200_000, body: `b${i}`, title: "t" }, 3);
    expect(h.map((r) => r.body)).toEqual(["b9", "b8", "b7"]);
  });
});

describe("templates", () => {
  it("every template has an id, a name and a body", () => {
    for (const t of TEMPLATES) {
      expect(t.id).toBeTruthy();
      expect(t.name).toBeTruthy();
      expect(t.body.length).toBeGreaterThan(0);
    }
  });

  it("fills the date and time placeholders", () => {
    const t = TEMPLATES.find((x) => x.id === "meeting")!;
    const out = applyTemplate(t, new Date(2026, 7, 14, 9, 5));
    expect(out.title).toBe("Meeting — 2026-08-14");
    expect(out.body).toContain("2026-08-14 09:05");
    expect(out.body).not.toContain("{{");
  });

  it("copies the tags rather than sharing them", () => {
    const t = TEMPLATES[0];
    applyTemplate(t, new Date()).tags.push("mutated");
    expect(t.tags).not.toContain("mutated");
  });
});
