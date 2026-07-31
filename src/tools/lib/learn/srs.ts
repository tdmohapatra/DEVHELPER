/**
 * Spaced repetition scheduling (SM-2, simplified).
 *
 * Binary known/unknown loses information: a card you barely recalled and one you answered
 * instantly are not the same. Grading each review and spacing the next one by how well it
 * went is what turns a large bank into something retained rather than re-read.
 *
 * Pure functions with an injected clock so the schedule is testable.
 */

export type Grade = "again" | "hard" | "good" | "easy";

export interface ReviewState {
  /** Consecutive successful reviews. Reset to 0 on "again". */
  streak: number;
  /** Days until the next review. */
  intervalDays: number;
  /** SM-2 ease factor; lower means the card comes back sooner. */
  ease: number;
  /** Epoch milliseconds when this card is next due. */
  dueAt: number;
  /** Total reviews, for statistics. */
  reviews: number;
  /** Times graded "again" — the signal for a weak card. */
  lapses: number;
  lastGrade?: Grade;
  lastReviewedAt?: number;
}

export type ReviewMap = Record<string, ReviewState>;

export const MIN_EASE = 1.3;
export const DEFAULT_EASE = 2.5;
const DAY_MS = 86_400_000;

export const GRADES: { id: Grade; label: string; hint: string }[] = [
  { id: "again", label: "Again", hint: "Could not recall — see it again today" },
  { id: "hard", label: "Hard", hint: "Recalled with effort — shorter interval" },
  { id: "good", label: "Good", hint: "Recalled correctly" },
  { id: "easy", label: "Easy", hint: "Instant — push it far out" },
];

/** A card never reviewed before. */
export function newState(now: number): ReviewState {
  return { streak: 0, intervalDays: 0, ease: DEFAULT_EASE, dueAt: now, reviews: 0, lapses: 0 };
}

/**
 * Apply a grade and compute the next due date.
 *
 * Intervals follow SM-2's shape: the first two successes are fixed (1 day, then 6), after
 * which the interval multiplies by the ease factor. "Again" resets the streak but keeps a
 * reduced ease, so a card you keep failing keeps coming back quickly.
 */
export function schedule(current: ReviewState | undefined, grade: Grade, now: number): ReviewState {
  const state = current ?? newState(now);
  const reviews = state.reviews + 1;

  if (grade === "again") {
    return {
      streak: 0,
      intervalDays: 0,
      ease: Math.max(MIN_EASE, state.ease - 0.2),
      dueAt: now + 10 * 60_000, // back in ten minutes, within the same session
      reviews,
      lapses: state.lapses + 1,
      lastGrade: grade,
      lastReviewedAt: now,
    };
  }

  const ease = clampEase(
    state.ease + (grade === "easy" ? 0.15 : grade === "hard" ? -0.15 : 0),
  );
  const streak = state.streak + 1;

  let intervalDays: number;
  if (streak === 1) intervalDays = grade === "easy" ? 3 : 1;
  else if (streak === 2) intervalDays = grade === "hard" ? 3 : 6;
  else {
    const factor = grade === "hard" ? 1.2 : grade === "easy" ? ease * 1.3 : ease;
    intervalDays = Math.round(state.intervalDays * factor);
  }

  intervalDays = Math.max(1, Math.min(intervalDays, 365));

  return {
    streak,
    intervalDays,
    ease,
    dueAt: now + intervalDays * DAY_MS,
    reviews,
    lapses: state.lapses,
    lastGrade: grade,
    lastReviewedAt: now,
  };
}

function clampEase(ease: number): number {
  return Math.max(MIN_EASE, Math.min(3.0, Number(ease.toFixed(2))));
}

/** What the next interval would be, so the buttons can show it before you press one. */
export function previewIntervals(current: ReviewState | undefined, now: number): Record<Grade, string> {
  const out = {} as Record<Grade, string>;
  for (const { id } of GRADES) {
    const next = schedule(current, id, now);
    out[id] = formatInterval(next.dueAt - now);
  }
  return out;
}

export function formatInterval(ms: number): string {
  if (ms < 60 * 60_000) return `${Math.max(1, Math.round(ms / 60_000))}m`;
  const days = ms / DAY_MS;
  if (days < 1) return `${Math.round(ms / 3_600_000)}h`;
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

/** Cards due now, weakest first — low ease and high lapses come back before easy ones. */
export function dueCards<T extends { id: string }>(cards: T[], reviews: ReviewMap, now: number): T[] {
  return cards
    .filter((c) => (reviews[c.id]?.dueAt ?? 0) <= now)
    .sort((a, b) => {
      const ra = reviews[a.id];
      const rb = reviews[b.id];
      // Never-seen cards come after cards that are due again, so lapses get cleared first.
      const bandA = ra === undefined ? 1 : 0;
      const bandB = rb === undefined ? 1 : 0;
      if (bandA !== bandB) return bandA - bandB;
      if (ra && rb && ra.ease !== rb.ease) return ra.ease - rb.ease;
      return (ra?.dueAt ?? 0) - (rb?.dueAt ?? 0);
    });
}

export interface SrsStats {
  total: number;
  /** Never reviewed. */
  unseen: number;
  /** Reviewed, interval under 21 days. */
  learning: number;
  /** Interval of 21 days or more — the usual "mature" threshold. */
  mature: number;
  dueNow: number;
  dueToday: number;
  /** Successful reviews as a share of all reviews. */
  retention: number;
  reviewsToday: number;
}

export const MATURE_DAYS = 21;

export function srsStats<T extends { id: string }>(cards: T[], reviews: ReviewMap, now: number): SrsStats {
  const startOfTomorrow = endOfDay(now);
  let unseen = 0;
  let learning = 0;
  let mature = 0;
  let dueNow = 0;
  let dueToday = 0;
  let totalReviews = 0;
  let lapses = 0;
  let reviewsToday = 0;

  for (const card of cards) {
    const state = reviews[card.id];
    if (!state || state.reviews === 0) {
      unseen++;
      dueNow++;
      dueToday++;
      continue;
    }

    if (state.intervalDays >= MATURE_DAYS) mature++;
    else learning++;

    if (state.dueAt <= now) dueNow++;
    if (state.dueAt <= startOfTomorrow) dueToday++;

    totalReviews += state.reviews;
    lapses += state.lapses;
    if (state.lastReviewedAt && state.lastReviewedAt >= startOfDay(now)) reviewsToday++;
  }

  return {
    total: cards.length,
    unseen,
    learning,
    mature,
    dueNow,
    dueToday,
    retention: totalReviews === 0 ? 0 : Math.round(((totalReviews - lapses) / totalReviews) * 100),
    reviewsToday,
  };
}

function startOfDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function endOfDay(now: number): number {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export interface WeakArea<TKey extends string = string> {
  key: TKey;
  label: string;
  /** Cards in this group that have been failed at least once. */
  weak: number;
  total: number;
  /** Share of reviews that were failures, 0–100. */
  failureRate: number;
}

/**
 * Group cards by any key and rank the groups by how badly they go, so revision time can
 * be spent where it is losing rather than spread evenly.
 */
export function weakAreas<T extends { id: string }>(
  cards: T[],
  reviews: ReviewMap,
  keyOf: (card: T) => string,
  labelOf: (key: string) => string,
): WeakArea[] {
  const groups = new Map<string, { weak: number; total: number; reviews: number; lapses: number }>();

  for (const card of cards) {
    const key = keyOf(card);
    const group = groups.get(key) ?? { weak: 0, total: 0, reviews: 0, lapses: 0 };
    group.total++;
    const state = reviews[card.id];
    if (state) {
      group.reviews += state.reviews;
      group.lapses += state.lapses;
      if (state.lapses > 0) group.weak++;
    }
    groups.set(key, group);
  }

  return [...groups.entries()]
    .map(([key, g]) => ({
      key,
      label: labelOf(key),
      weak: g.weak,
      total: g.total,
      failureRate: g.reviews === 0 ? 0 : Math.round((g.lapses / g.reviews) * 100),
    }))
    .sort((a, b) => b.failureRate - a.failureRate || b.weak - a.weak);
}

/** Consecutive days with at least one review, counting back from today. */
export function streakDays(reviews: ReviewMap, now: number): number {
  const days = new Set<string>();
  for (const state of Object.values(reviews)) {
    if (state.lastReviewedAt) days.add(new Date(state.lastReviewedAt).toDateString());
  }
  if (days.size === 0) return 0;

  let streak = 0;
  const cursor = new Date(now);
  // Today only counts if something was reviewed; otherwise the streak is yesterday's.
  if (!days.has(cursor.toDateString())) cursor.setDate(cursor.getDate() - 1);

  while (days.has(cursor.toDateString())) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
