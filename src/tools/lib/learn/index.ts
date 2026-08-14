/**
 * The learning catalogue: all built-in questions, plus search, filtering and stats.
 *
 * User-added questions live in the store and are merged in by the UI, so everything here
 * stays pure and testable.
 */

import { CSHARP_QUESTIONS } from "./csharp";
import { OOP_QUESTIONS } from "./oop";
import { DOTNET_QUESTIONS } from "./dotnet";
import { AZURE_QUESTIONS } from "./azure";
import { DATABASE_QUESTIONS } from "./database";
import { MESSAGING_QUESTIONS } from "./messaging";
import { DSA_QUESTIONS } from "./dsa";
import { SYSTEM_DESIGN_QUESTIONS } from "./systemDesign";
import { PROGRAMMING_QUESTIONS } from "./programming";
import { CSHARP_EXTRA, OOP_EXTRA } from "./extraCsharpOop";
import { DOTNET_EXTRA, AZURE_EXTRA } from "./extraDotnetAzure";
import { DATABASE_EXTRA, MESSAGING_EXTRA } from "./extraDataMessaging";
import { PROGRAMMING_EXTRA, DSA_EXTRA, SYSTEM_DESIGN_EXTRA } from "./extraProgrammingDsaDesign";
import { HEALTHCARE_QUESTIONS } from "./healthcare";
import { DEVICE_QUESTIONS } from "./devices";
import { MICROSERVICE_QUESTIONS } from "./microservices";
import { AZURE_SERVICE_QUESTIONS } from "./azureServices";
import { DEVOPS_QUESTIONS } from "./devops";
import { AI_QUESTIONS } from "./ai";
import { PYTHON_DATA_QUESTIONS } from "./pythonData";
import { FRONTEND_QUESTIONS } from "./frontend";
import type { Level, Question, TopicId } from "./types";

export * from "./types";
export * from "./roadmap";

export const BUILT_IN_QUESTIONS: Question[] = [
  ...CSHARP_QUESTIONS,
  ...CSHARP_EXTRA,
  ...OOP_QUESTIONS,
  ...OOP_EXTRA,
  ...DOTNET_QUESTIONS,
  ...DOTNET_EXTRA,
  ...AZURE_QUESTIONS,
  ...AZURE_EXTRA,
  ...DATABASE_QUESTIONS,
  ...DATABASE_EXTRA,
  ...MESSAGING_QUESTIONS,
  ...MESSAGING_EXTRA,
  ...PROGRAMMING_QUESTIONS,
  ...PROGRAMMING_EXTRA,
  ...DSA_QUESTIONS,
  ...DSA_EXTRA,
  ...SYSTEM_DESIGN_QUESTIONS,
  ...SYSTEM_DESIGN_EXTRA,
  ...HEALTHCARE_QUESTIONS,
  ...DEVICE_QUESTIONS,
  ...MICROSERVICE_QUESTIONS,
  ...AZURE_SERVICE_QUESTIONS,
  ...DEVOPS_QUESTIONS,
  ...AI_QUESTIONS,
  ...PYTHON_DATA_QUESTIONS,
  ...FRONTEND_QUESTIONS,
];

export interface QuestionFilter {
  topic?: TopicId | "all";
  level?: Level | "all";
  /** Free text over question, answer, tags and subtopic. */
  search?: string;
  /** Only questions marked as asked in nearly every interview. */
  mustKnowOnly?: boolean;
  /** Restrict to a set of ids — used for bookmarks and "needs review". */
  ids?: Set<string>;
}

/** Filter and rank. Matches in the question text outrank matches in the answer body. */
export function filterQuestions(questions: Question[], filter: QuestionFilter): Question[] {
  const needle = filter.search?.trim().toLowerCase();

  const matched = questions.filter((q) => {
    if (filter.topic && filter.topic !== "all" && q.topic !== filter.topic) return false;
    if (filter.level && filter.level !== "all" && q.level !== filter.level) return false;
    if (filter.mustKnowOnly && !q.mustKnow) return false;
    if (filter.ids && !filter.ids.has(q.id)) return false;
    if (!needle) return true;
    return score(q, needle) > 0;
  });

  if (!needle) return matched;
  return matched.sort((a, b) => score(b, needle) - score(a, needle));
}

function score(q: Question, needle: string): number {
  let total = 0;
  if (q.question.toLowerCase().includes(needle)) total += 10;
  if (q.tags.some((t) => t.toLowerCase().includes(needle))) total += 6;
  if (q.subtopic.toLowerCase().includes(needle)) total += 4;
  if (q.answer.toLowerCase().includes(needle)) total += 2;
  if (q.code?.toLowerCase().includes(needle)) total += 1;
  if (q.followUps?.some((f) => f.question.toLowerCase().includes(needle))) total += 3;
  return total;
}

/**
 * The cards that can be practised in a given tool.
 *
 * This is what lets a tool offer its own concepts back: the Device Link screen
 * can ask the catalogue what it is for, without the catalogue knowing anything
 * about the UI.
 */
export function questionsForTool(questions: Question[], toolId: string): Question[] {
  return questions.filter((q) => q.relatedTools?.includes(toolId));
}

/** Questions grouped by subtopic, preserving catalogue order. */
export function groupBySubtopic(questions: Question[]): { subtopic: string; questions: Question[] }[] {
  const groups = new Map<string, Question[]>();
  for (const q of questions) {
    const existing = groups.get(q.subtopic);
    if (existing) existing.push(q);
    else groups.set(q.subtopic, [q]);
  }
  return [...groups.entries()].map(([subtopic, qs]) => ({ subtopic, questions: qs }));
}

export interface TopicStats {
  topic: TopicId;
  total: number;
  known: number;
  review: number;
  unseen: number;
}

export type Progress = Record<string, "known" | "review">;

/** Per-topic counts for the progress display. */
export function topicStats(questions: Question[], progress: Progress): TopicStats[] {
  const byTopic = new Map<TopicId, TopicStats>();
  for (const q of questions) {
    const stats = byTopic.get(q.topic) ?? { topic: q.topic, total: 0, known: 0, review: 0, unseen: 0 };
    stats.total++;
    const state = progress[q.id];
    if (state === "known") stats.known++;
    else if (state === "review") stats.review++;
    else stats.unseen++;
    byTopic.set(q.topic, stats);
  }
  return [...byTopic.values()];
}

export function overallProgress(questions: Question[], progress: Progress): { known: number; total: number; percent: number } {
  const known = questions.filter((q) => progress[q.id] === "known").length;
  const total = questions.length;
  return { known, total, percent: total === 0 ? 0 : Math.round((known / total) * 100) };
}

/**
 * Order a revision session: questions needing review first, then unseen, then known.
 * `mustKnow` wins inside each band, so a short session covers the important ground.
 */
export function reviseOrder(questions: Question[], progress: Progress): Question[] {
  const band = (q: Question) => (progress[q.id] === "review" ? 0 : progress[q.id] === undefined ? 1 : 2);
  return [...questions].sort((a, b) => {
    const byBand = band(a) - band(b);
    if (byBand !== 0) return byBand;
    return Number(b.mustKnow ?? false) - Number(a.mustKnow ?? false);
  });
}

/** Serialize user questions for export. */
export function exportQuestions(questions: Question[]): string {
  return JSON.stringify({ version: 1, kind: "devhelper-learn", questions }, null, 2);
}

export class LearnImportError extends Error {}

/** Parse an exported file. Accepts `{questions:[...]}` or a bare array. */
export function importQuestions(text: string): Question[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new LearnImportError(`Not valid JSON: ${(e as Error).message}`);
  }
  const list = Array.isArray(data) ? data : (data as { questions?: unknown })?.questions;
  if (!Array.isArray(list)) throw new LearnImportError("No 'questions' array found");

  const valid = list.filter(
    (q): q is Question =>
      !!q &&
      typeof (q as Question).question === "string" &&
      typeof (q as Question).answer === "string" &&
      typeof (q as Question).topic === "string",
  );
  if (valid.length === 0) throw new LearnImportError("The file contains no usable questions");

  return valid.map((q) => ({
    ...q,
    id: q.id || `import-${Math.random().toString(36).slice(2, 10)}`,
    subtopic: q.subtopic || "Imported",
    level: q.level ?? "intermediate",
    tags: Array.isArray(q.tags) ? q.tags : [],
  }));
}
