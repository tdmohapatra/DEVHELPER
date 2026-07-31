import { describe, it, expect } from "vitest";
import {
  STAR_PROMPTS,
  COMPETENCIES,
  reviewStory,
  storyScore,
  coverage,
  uncoveredPrompts,
  emptyStory,
  storyToText,
  exportStories,
  importStories,
  StarImportError,
  type StarStory,
} from "./star";

const good: StarStory = {
  id: "s1",
  title: "The SQL Server outage nobody could reproduce",
  promptIds: ["star-production-incident"],
  situation:
    "Our order API started failing for one customer region during the evening peak, about 400 requests a minute returning 500s, while monitoring showed the database healthy.",
  task: "I was on call and owned restoring service, then finding the cause before the next peak.",
  action:
    "I first checked what had changed and found a config deploy two hours earlier. I rolled it back to restore service, then reproduced the failure in staging and traced it to a connection string that had dropped the port, so the driver fell back to a default the firewall blocked.",
  result:
    "Service was restored in 12 minutes, and the fix cut connection errors from 400 a minute to 0. I added a startup validation that fails fast on an unreachable database, which caught 2 similar misconfigurations later.",
  reflection: "I would have added the startup check the first time we saw a connection issue rather than after an outage.",
  tags: ["incident", "sql"],
  updatedAt: 0,
};

describe("prompt catalogue", () => {
  it("has unique ids and covers every competency", () => {
    expect(new Set(STAR_PROMPTS.map((p) => p.id)).size).toBe(STAR_PROMPTS.length);
    for (const c of COMPETENCIES) {
      expect(STAR_PROMPTS.some((p) => p.competency === c.id), c.id).toBe(true);
    }
  });

  it("says what each question assesses and lists variants", () => {
    for (const p of STAR_PROMPTS) {
      expect(p.looksFor.length, p.id).toBeGreaterThan(25);
      expect(p.variants.length, p.id).toBeGreaterThan(0);
    }
  });
});

describe("reviewStory", () => {
  it("passes a complete, specific story", () => {
    expect(reviewStory(good).filter((i) => i.severity === "error")).toEqual([]);
    expect(storyScore(good)).toBeGreaterThanOrEqual(90);
  });

  it("requires every STAR section", () => {
    const issues = reviewStory({ ...good, action: "", result: "" });
    expect(issues.filter((i) => i.field === "action" && i.severity === "error")).toHaveLength(1);
    expect(issues.filter((i) => i.field === "result" && i.severity === "error")).toHaveLength(1);
  });

  it("catches an action with no first person", () => {
    const issues = reviewStory({ ...good, action: "The team rolled back the deploy and the service recovered quickly afterwards." });
    expect(issues.some((i) => i.field === "action" && /first person/.test(i.message))).toBe(true);
  });

  it("warns when the action hides behind 'we'", () => {
    const action = "I joined the call, we investigated, we rolled back, and we agreed our team would follow up the next day.";
    expect(reviewStory({ ...good, action }).some((i) => /"we" appears/.test(i.message))).toBe(true);
  });

  it("warns when the result has no number", () => {
    const issues = reviewStory({ ...good, result: "Service was restored and everyone was happy with the outcome overall." });
    expect(issues.some((i) => i.field === "result" && /No number/.test(i.message))).toBe(true);
  });

  it("warns about a thin section", () => {
    expect(reviewStory({ ...good, task: "Fix it" }).some((i) => i.field === "task" && i.severity === "warning")).toBe(true);
  });

  it("asks for a reflection", () => {
    expect(reviewStory({ ...good, reflection: "" }).some((i) => i.field === "reflection")).toBe(true);
  });

  it("wants the story linked to a question", () => {
    expect(reviewStory({ ...good, promptIds: [] }).some((i) => i.field === "promptIds")).toBe(true);
  });

  it("requires a title", () => {
    expect(reviewStory({ ...good, title: "  " }).some((i) => i.field === "title" && i.severity === "error")).toBe(true);
  });
});

describe("storyScore", () => {
  it("scores an empty story near zero and a good one high", () => {
    expect(storyScore(emptyStory("x"))).toBeLessThan(20);
    expect(storyScore(good)).toBeGreaterThan(storyScore({ ...good, result: "It went well and the team was pleased." }));
  });
});

describe("coverage", () => {
  it("reports zero coverage with no stories", () => {
    const gaps = coverage([]);
    expect(gaps.every((g) => g.covered === 0)).toBe(true);
    expect(gaps.reduce((n, g) => n + g.prompts, 0)).toBe(STAR_PROMPTS.length);
  });

  it("counts a competency as covered once a story answers one of its prompts", () => {
    const incident = coverage([good]).find((g) => g.competency === "incident")!;
    expect(incident.covered).toBe(1);
  });

  it("suggests prompts from uncovered competencies first", () => {
    const next = uncoveredPrompts([good])[0];
    expect(next.competency).not.toBe("incident");
    expect(next.id).not.toBe("star-production-incident");
  });

  it("returns nothing to write when every prompt is answered", () => {
    const everything: StarStory = { ...good, promptIds: STAR_PROMPTS.map((p) => p.id) };
    expect(uncoveredPrompts([everything])).toEqual([]);
  });
});

describe("storyToText", () => {
  it("renders the sections in order", () => {
    const text = storyToText(good);
    expect(text.indexOf("Situation:")).toBeLessThan(text.indexOf("Task:"));
    expect(text.indexOf("Action:")).toBeLessThan(text.indexOf("Result:"));
    expect(text).toContain("Reflection:");
  });

  it("omits an empty reflection", () => {
    expect(storyToText({ ...good, reflection: "" })).not.toContain("Reflection:");
  });
});

describe("export and import", () => {
  it("round-trips", () => {
    const back = importStories(exportStories([good]));
    expect(back).toHaveLength(1);
    expect(back[0].title).toBe(good.title);
  });

  it("fills in missing collections", () => {
    const [s] = importStories(JSON.stringify([{ title: "Partial story" }]));
    expect(s.promptIds).toEqual([]);
    expect(s.tags).toEqual([]);
    expect(s.id).toBeTruthy();
  });

  it("rejects unusable input", () => {
    expect(() => importStories("{oops")).toThrow(/valid JSON/);
    expect(() => importStories(JSON.stringify({ nope: 1 }))).toThrow(StarImportError);
    expect(() => importStories(JSON.stringify([{ noTitle: true }]))).toThrow(/no usable stories/);
  });
});
