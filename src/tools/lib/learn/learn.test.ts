import { describe, it, expect } from "vitest";
import {
  BUILT_IN_QUESTIONS,
  TOPICS,
  LEVELS,
  filterQuestions,
  groupBySubtopic,
  topicStats,
  overallProgress,
  reviseOrder,
  exportQuestions,
  importQuestions,
  LearnImportError,
  type Progress,
  type Question,
} from "./index";

describe("question catalogue", () => {
  it("has unique ids", () => {
    const ids = BUILT_IN_QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers every advertised topic", () => {
    for (const topic of TOPICS) {
      const count = BUILT_IN_QUESTIONS.filter((q) => q.topic === topic.id).length;
      expect(count, `${topic.id} has no questions`).toBeGreaterThan(0);
    }
  });

  it("is a substantial bank", () => {
    expect(BUILT_IN_QUESTIONS.length).toBeGreaterThanOrEqual(190);
  });

  it("gives every topic enough depth to revise from", () => {
    for (const topic of TOPICS) {
      const count = BUILT_IN_QUESTIONS.filter((q) => q.topic === topic.id).length;
      expect(count, `${topic.id} is thin`).toBeGreaterThanOrEqual(15);
    }
  });

  it("gives every question a real answer, subtopic, level and tags", () => {
    for (const q of BUILT_IN_QUESTIONS) {
      expect(q.question.trim().length, q.id).toBeGreaterThan(10);
      expect(q.answer.trim().length, q.id).toBeGreaterThan(80);
      expect(q.subtopic.trim(), q.id).not.toBe("");
      expect(LEVELS.map((l) => l.id), q.id).toContain(q.level);
      expect(q.tags.length, q.id).toBeGreaterThan(0);
    }
  });

  it("names a language whenever it ships code", () => {
    for (const q of BUILT_IN_QUESTIONS) {
      if (q.code) expect(q.language, `${q.id} has code but no language`).toBeTruthy();
    }
  });

  it("gives every follow-up both a question and an answer", () => {
    for (const q of BUILT_IN_QUESTIONS) {
      for (const f of q.followUps ?? []) {
        expect(f.question.trim().length, q.id).toBeGreaterThan(5);
        expect(f.answer.trim().length, q.id).toBeGreaterThan(20);
      }
    }
  });

  it("marks the questions that come up in nearly every interview", () => {
    const mustKnow = BUILT_IN_QUESTIONS.filter((q) => q.mustKnow);
    expect(mustKnow.length).toBeGreaterThanOrEqual(10);
    // Spread across topics, not all in one
    expect(new Set(mustKnow.map((q) => q.topic)).size).toBeGreaterThanOrEqual(6);
  });

  it("carries examples on the majority of questions", () => {
    const withExample = BUILT_IN_QUESTIONS.filter((q) => q.code || q.diagram).length;
    expect(withExample / BUILT_IN_QUESTIONS.length).toBeGreaterThan(0.6);
  });
});

describe("filterQuestions", () => {
  it("filters by topic and level", () => {
    const csharp = filterQuestions(BUILT_IN_QUESTIONS, { topic: "csharp" });
    expect(csharp.every((q) => q.topic === "csharp")).toBe(true);

    const basic = filterQuestions(BUILT_IN_QUESTIONS, { level: "basic" });
    expect(basic.every((q) => q.level === "basic")).toBe(true);
  });

  it("treats 'all' as no filter", () => {
    expect(filterQuestions(BUILT_IN_QUESTIONS, { topic: "all", level: "all" })).toHaveLength(BUILT_IN_QUESTIONS.length);
  });

  it("searches question text, tags and answers", () => {
    const results = filterQuestions(BUILT_IN_QUESTIONS, { search: "deadlock" });
    expect(results.length).toBeGreaterThan(0);
    expect(
      results.every(
        (q) =>
          q.question.toLowerCase().includes("deadlock") ||
          q.answer.toLowerCase().includes("deadlock") ||
          q.tags.join(" ").toLowerCase().includes("deadlock") ||
          (q.followUps ?? []).some((f) => f.question.toLowerCase().includes("deadlock")),
      ),
    ).toBe(true);
  });

  it("ranks a title match above a body mention", () => {
    const results = filterQuestions(BUILT_IN_QUESTIONS, { search: "index" });
    expect(results[0].question.toLowerCase()).toContain("index");
  });

  it("is case-insensitive", () => {
    expect(filterQuestions(BUILT_IN_QUESTIONS, { search: "SOLID" }).length).toBeGreaterThan(0);
  });

  it("filters to must-know and to an id set", () => {
    expect(filterQuestions(BUILT_IN_QUESTIONS, { mustKnowOnly: true }).every((q) => q.mustKnow)).toBe(true);

    const ids = new Set([BUILT_IN_QUESTIONS[0].id, BUILT_IN_QUESTIONS[5].id]);
    expect(filterQuestions(BUILT_IN_QUESTIONS, { ids })).toHaveLength(2);
  });

  it("returns nothing for an unmatched search", () => {
    expect(filterQuestions(BUILT_IN_QUESTIONS, { search: "zzzznotathing" })).toEqual([]);
  });
});

describe("groupBySubtopic", () => {
  it("groups without losing questions", () => {
    const csharp = filterQuestions(BUILT_IN_QUESTIONS, { topic: "csharp" });
    const groups = groupBySubtopic(csharp);
    expect(groups.reduce((n, g) => n + g.questions.length, 0)).toBe(csharp.length);
    expect(new Set(groups.map((g) => g.subtopic)).size).toBe(groups.length);
  });
});

describe("progress", () => {
  const progress: Progress = {
    [BUILT_IN_QUESTIONS[0].id]: "known",
    [BUILT_IN_QUESTIONS[1].id]: "review",
  };

  it("counts known, review and unseen per topic", () => {
    const stats = topicStats(BUILT_IN_QUESTIONS, progress);
    const total = stats.reduce((n, s) => n + s.total, 0);
    expect(total).toBe(BUILT_IN_QUESTIONS.length);
    for (const s of stats) expect(s.known + s.review + s.unseen).toBe(s.total);
  });

  it("computes an overall percentage", () => {
    const overall = overallProgress(BUILT_IN_QUESTIONS, progress);
    expect(overall.known).toBe(1);
    expect(overall.total).toBe(BUILT_IN_QUESTIONS.length);
    expect(overall.percent).toBe(Math.round((1 / BUILT_IN_QUESTIONS.length) * 100));
  });

  it("handles an empty set without dividing by zero", () => {
    expect(overallProgress([], {})).toEqual({ known: 0, total: 0, percent: 0 });
  });
});

describe("reviseOrder", () => {
  it("puts review first, then unseen, then known", () => {
    const [a, b, c] = BUILT_IN_QUESTIONS;
    const progress: Progress = { [a.id]: "known", [b.id]: "review" };
    const ordered = reviseOrder([a, b, c], progress);
    expect(ordered[0].id).toBe(b.id);      // needs review
    expect(ordered[1].id).toBe(c.id);      // unseen
    expect(ordered[2].id).toBe(a.id);      // already known
  });

  it("prefers must-know questions within a band", () => {
    const plain: Question = { ...BUILT_IN_QUESTIONS[0], id: "plain", mustKnow: false };
    const important: Question = { ...BUILT_IN_QUESTIONS[0], id: "important", mustKnow: true };
    expect(reviseOrder([plain, important], {})[0].id).toBe("important");
  });

  it("does not mutate the input", () => {
    const input = BUILT_IN_QUESTIONS.slice(0, 3);
    const before = input.map((q) => q.id);
    reviseOrder(input, {});
    expect(input.map((q) => q.id)).toEqual(before);
  });
});

describe("export and import", () => {
  const mine: Question[] = [
    {
      id: "mine-1",
      topic: "csharp",
      subtopic: "My questions",
      level: "basic",
      question: "What did the interviewer ask about spans?",
      answer: "Span<T> slices memory without copying.",
      tags: ["span"],
    },
  ];

  it("round-trips", () => {
    const back = importQuestions(exportQuestions(mine));
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ id: "mine-1", question: mine[0].question });
  });

  it("accepts a bare array", () => {
    expect(importQuestions(JSON.stringify(mine))).toHaveLength(1);
  });

  it("fills in the fields an author may have left out", () => {
    const sparse = JSON.stringify([{ topic: "azure", question: "What is a managed identity?", answer: "A platform-managed principal." }]);
    const [q] = importQuestions(sparse);
    expect(q.id).toBeTruthy();
    expect(q.subtopic).toBe("Imported");
    expect(q.level).toBe("intermediate");
    expect(q.tags).toEqual([]);
  });

  it("rejects unusable input", () => {
    expect(() => importQuestions("{oops")).toThrow(/valid JSON/);
    expect(() => importQuestions(JSON.stringify({ nope: 1 }))).toThrow(LearnImportError);
    expect(() => importQuestions(JSON.stringify([{ question: "no answer" }]))).toThrow(/no usable questions/);
  });
});
