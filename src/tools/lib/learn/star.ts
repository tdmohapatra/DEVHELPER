/**
 * STAR stories — the behavioural half of an interview.
 *
 * Technical recall is testable from a question bank; "tell me about a time…" is not. It
 * needs a handful of rehearsed, specific stories from your own work. This module holds
 * the prompts, the story shape, and a quality check that catches the mistakes that make
 * an answer weak: no numbers, no first person, no consequence.
 */

export type Competency =
  | "ownership"
  | "conflict"
  | "failure"
  | "leadership"
  | "ambiguity"
  | "delivery"
  | "technical-decision"
  | "incident"
  | "collaboration"
  | "growth";

export interface StarPrompt {
  id: string;
  competency: Competency;
  /** The question as an interviewer would ask it. */
  question: string;
  /** What the interviewer is really assessing. */
  looksFor: string;
  /** Variations of the same question, so one story covers several. */
  variants: string[];
}

export interface StarStory {
  id: string;
  title: string;
  /** Prompt ids this story can answer. */
  promptIds: string[];
  situation: string;
  task: string;
  action: string;
  result: string;
  /** What you would do differently — the part that turns a failure story into a strength. */
  reflection?: string;
  tags: string[];
  updatedAt: number;
}

export const COMPETENCIES: { id: Competency; label: string; description: string }[] = [
  { id: "ownership", label: "Ownership", description: "Taking responsibility beyond the assigned task" },
  { id: "conflict", label: "Conflict & disagreement", description: "Disagreeing well, with peers or managers" },
  { id: "failure", label: "Failure & mistakes", description: "What you broke, and what you learned" },
  { id: "leadership", label: "Leadership & influence", description: "Leading without authority, mentoring" },
  { id: "ambiguity", label: "Ambiguity", description: "Acting without complete requirements" },
  { id: "delivery", label: "Delivery & pressure", description: "Deadlines, trade-offs, scope" },
  { id: "technical-decision", label: "Technical decisions", description: "Choices you made and defended" },
  { id: "incident", label: "Incidents & debugging", description: "Production problems under pressure" },
  { id: "collaboration", label: "Collaboration", description: "Cross-team, stakeholders, communication" },
  { id: "growth", label: "Growth & feedback", description: "Learning, receiving criticism, improving" },
];

/**
 * The behavioural questions that actually get asked. Each names what is being assessed,
 * because a story that does not hit the assessed quality scores badly no matter how
 * interesting it is.
 */
export const STAR_PROMPTS: StarPrompt[] = [
  {
    id: "star-hardest-problem",
    competency: "technical-decision",
    question: "Tell me about the hardest technical problem you have solved.",
    looksFor: "Depth of understanding, method over luck, and whether you can explain complexity simply.",
    variants: [
      "What is the most complex system you have worked on?",
      "Describe a problem where the obvious solution did not work.",
    ],
  },
  {
    id: "star-production-incident",
    competency: "incident",
    question: "Describe a production incident you handled.",
    looksFor: "Calm method: mitigate first, diagnose second, prevent third. And whether you blame people or systems.",
    variants: [
      "Tell me about a time you broke production.",
      "How did you handle an outage?",
      "What is the worst bug you have shipped?",
    ],
  },
  {
    id: "star-disagree-manager",
    competency: "conflict",
    question: "Tell me about a time you disagreed with your manager or a senior engineer.",
    looksFor: "Whether you can disagree with evidence, commit once decided, and avoid making it personal.",
    variants: [
      "How do you handle a decision you think is wrong?",
      "Describe a conflict with a colleague.",
    ],
  },
  {
    id: "star-mistake",
    competency: "failure",
    question: "Tell me about a mistake you made and what you learned.",
    looksFor: "Real accountability. A story where the mistake was someone else's fails this question.",
    variants: [
      "What is your biggest professional failure?",
      "Tell me about a project that did not go well.",
    ],
  },
  {
    id: "star-tight-deadline",
    competency: "delivery",
    question: "Describe a time you had to deliver under an unrealistic deadline.",
    looksFor: "Negotiating scope rather than silently working nights, and communicating risk early.",
    variants: [
      "How do you handle competing priorities?",
      "Tell me about a time you had to cut scope.",
    ],
  },
  {
    id: "star-ownership",
    competency: "ownership",
    question: "Tell me about a time you went beyond what was asked of you.",
    looksFor: "Initiative with judgement — not heroics, and not work nobody wanted.",
    variants: [
      "Describe something you improved that nobody asked you to.",
      "Tell me about a problem you found and fixed yourself.",
    ],
  },
  {
    id: "star-ambiguity",
    competency: "ambiguity",
    question: "Tell me about a time the requirements were unclear.",
    looksFor: "Whether you ask, prototype and validate, or build the wrong thing confidently.",
    variants: [
      "How do you start a project with no specification?",
      "Describe a time you had to make an assumption and move.",
    ],
  },
  {
    id: "star-mentoring",
    competency: "leadership",
    question: "Tell me about a time you mentored or unblocked someone.",
    looksFor: "Teaching rather than taking over, and whether you scale other people.",
    variants: [
      "How do you onboard a new team member?",
      "Describe a time you led without being the manager.",
    ],
  },
  {
    id: "star-technical-tradeoff",
    competency: "technical-decision",
    question: "Describe a technical decision you made and the trade-offs.",
    looksFor: "That you considered alternatives, stated the cost, and can say what you would change now.",
    variants: [
      "Why did you choose that technology?",
      "Tell me about an architecture decision you regret.",
    ],
  },
  {
    id: "star-performance",
    competency: "technical-decision",
    question: "Tell me about a performance problem you diagnosed and fixed.",
    looksFor: "Measure-first discipline, and numbers before and after.",
    variants: [
      "How did you make something faster?",
      "Describe a scalability problem you solved.",
    ],
  },
  {
    id: "star-stakeholder",
    competency: "collaboration",
    question: "Tell me about explaining something technical to a non-technical stakeholder.",
    looksFor: "Translation without condescension, and whether the audience acted on it.",
    variants: [
      "How do you communicate risk to the business?",
      "Describe a time you had to say no to a stakeholder.",
    ],
  },
  {
    id: "star-quality-vs-speed",
    competency: "delivery",
    question: "Tell me about a time you had to choose between quality and speed.",
    looksFor: "A conscious, communicated trade with a plan to repay — not an excuse for shortcuts.",
    variants: [
      "When is technical debt acceptable?",
      "Describe a shortcut you took and what happened.",
    ],
  },
  {
    id: "star-feedback",
    competency: "growth",
    question: "Tell me about difficult feedback you received.",
    looksFor: "Whether you can hear criticism without defending, and whether behaviour actually changed.",
    variants: [
      "How do you respond to a critical code review?",
      "What is the most useful feedback you have had?",
    ],
  },
  {
    id: "star-learning",
    competency: "growth",
    question: "Tell me about a time you had to learn something quickly.",
    looksFor: "A repeatable learning method, and shipping while still learning.",
    variants: [
      "How do you keep current?",
      "Describe picking up an unfamiliar codebase.",
    ],
  },
  {
    id: "star-cross-team",
    competency: "collaboration",
    question: "Describe working with another team to deliver something.",
    looksFor: "Managing dependencies and contracts, and what you did when the other team slipped.",
    variants: [
      "How do you handle a blocking dependency?",
      "Tell me about integrating with a system you did not control.",
    ],
  },
  {
    id: "star-legacy",
    competency: "ownership",
    question: "Tell me about working with a legacy system.",
    looksFor: "Respect for existing constraints, incremental improvement rather than rewrite fantasies.",
    variants: [
      "How do you refactor safely?",
      "Describe improving code you did not write.",
    ],
  },
  {
    id: "star-say-no",
    competency: "conflict",
    question: "Tell me about a time you pushed back on a request.",
    looksFor: "Whether you offered an alternative rather than simply refusing.",
    variants: [
      "How do you handle scope creep?",
      "Describe declining work you thought was wrong.",
    ],
  },
  {
    id: "star-proudest",
    competency: "ownership",
    question: "What are you most proud of professionally?",
    looksFor: "What you value, and whether your contribution is clear inside a team effort.",
    variants: [
      "What is your best work?",
      "Tell me about a project that went well and why.",
    ],
  },
];

// ---- Quality checks --------------------------------------------------------

export interface StoryIssue {
  field: "title" | "situation" | "task" | "action" | "result" | "reflection" | "promptIds";
  severity: "error" | "warning";
  message: string;
}

const FIRST_PERSON = /\b(I|my|me)\b/;
const HAS_NUMBER = /\d/;
const WEASEL = /\b(we|our team|the team)\b/gi;

/**
 * Lint a story the way an interviewer would hear it.
 *
 * The three failures that sink real answers: no measurable result, "we" everywhere so
 * your own contribution is invisible, and an Action section that describes the plan
 * rather than what you personally did.
 */
export function reviewStory(story: StarStory): StoryIssue[] {
  const issues: StoryIssue[] = [];

  if (!story.title.trim()) issues.push({ field: "title", severity: "error", message: "Give the story a short name you can recall under pressure" });
  if (story.promptIds.length === 0) issues.push({ field: "promptIds", severity: "warning", message: "Link at least one question this story answers" });

  const required: [keyof StarStory & ("situation" | "task" | "action" | "result"), string][] = [
    ["situation", "Set the context in two sentences: where, when, what was at stake"],
    ["task", "State your specific responsibility, not the team's goal"],
    ["action", "What you actually did, step by step"],
    ["result", "The outcome, with a number if one exists"],
  ];

  for (const [field, hint] of required) {
    const value = String(story[field] ?? "").trim();
    if (!value) issues.push({ field, severity: "error", message: hint });
    else if (value.length < 40) issues.push({ field, severity: "warning", message: `Too thin to be convincing — ${hint.toLowerCase()}` });
  }

  if (story.action && !FIRST_PERSON.test(story.action)) {
    issues.push({ field: "action", severity: "error", message: "No first person: say what *you* did, or the interviewer cannot credit you" });
  }

  const weWords = story.action.match(WEASEL)?.length ?? 0;
  if (weWords >= 3) {
    issues.push({ field: "action", severity: "warning", message: `"we" appears ${weWords} times — replace most with what you personally did` });
  }

  if (story.result && !HAS_NUMBER.test(story.result)) {
    issues.push({ field: "result", severity: "warning", message: "No number. Latency, error rate, hours saved, users affected — anything measurable" });
  }

  if (story.situation.length > 600) {
    issues.push({ field: "situation", severity: "warning", message: "Situation is long; interviewers want context in ~30 seconds" });
  }

  if (!story.reflection?.trim()) {
    issues.push({ field: "reflection", severity: "warning", message: "Add what you would do differently — it is the strongest part of a failure story" });
  }

  return issues;
}

/** 0–100 readiness for one story. */
export function storyScore(story: StarStory): number {
  const issues = reviewStory(story);
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  return Math.max(0, 100 - errors * 25 - warnings * 8);
}

export interface CoverageGap {
  competency: Competency;
  covered: number;
  prompts: number;
}

/** Which competencies have no story yet — what to write next. */
export function coverage(stories: StarStory[]): CoverageGap[] {
  const answered = new Set(stories.flatMap((s) => s.promptIds));
  return COMPETENCIES.map((c) => {
    const prompts = STAR_PROMPTS.filter((p) => p.competency === c.id);
    return {
      competency: c.id,
      prompts: prompts.length,
      covered: prompts.filter((p) => answered.has(p.id)).length,
    };
  });
}

/** Prompts no story answers yet, most valuable first (competency with zero coverage). */
export function uncoveredPrompts(stories: StarStory[]): StarPrompt[] {
  const answered = new Set(stories.flatMap((s) => s.promptIds));
  const gaps = new Map(coverage(stories).map((c) => [c.competency, c.covered]));
  return STAR_PROMPTS.filter((p) => !answered.has(p.id)).sort(
    (a, b) => (gaps.get(a.competency) ?? 0) - (gaps.get(b.competency) ?? 0),
  );
}

export function emptyStory(id: string, promptId?: string): StarStory {
  return {
    id,
    title: "",
    promptIds: promptId ? [promptId] : [],
    situation: "",
    task: "",
    action: "",
    result: "",
    reflection: "",
    tags: [],
    updatedAt: 0,
  };
}

/** Plain text for rehearsal or for pasting into notes. */
export function storyToText(story: StarStory): string {
  return [
    story.title,
    "",
    `Situation: ${story.situation}`,
    `Task: ${story.task}`,
    `Action: ${story.action}`,
    `Result: ${story.result}`,
    story.reflection ? `Reflection: ${story.reflection}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function exportStories(stories: StarStory[]): string {
  return JSON.stringify({ version: 1, kind: "devhelper-star", stories }, null, 2);
}

export class StarImportError extends Error {}

export function importStories(text: string): StarStory[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new StarImportError(`Not valid JSON: ${(e as Error).message}`);
  }
  const list = Array.isArray(data) ? data : (data as { stories?: unknown })?.stories;
  if (!Array.isArray(list)) throw new StarImportError("No 'stories' array found");

  const valid = list.filter((s): s is StarStory => !!s && typeof (s as StarStory).title === "string");
  if (valid.length === 0) throw new StarImportError("The file contains no usable stories");

  return valid.map((s) => ({
    ...emptyStory(s.id || `story-${Math.random().toString(36).slice(2, 10)}`),
    ...s,
    promptIds: Array.isArray(s.promptIds) ? s.promptIds : [],
    tags: Array.isArray(s.tags) ? s.tags : [],
  }));
}
