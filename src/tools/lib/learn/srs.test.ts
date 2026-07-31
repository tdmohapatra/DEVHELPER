import { describe, it, expect } from "vitest";
import {
  schedule,
  newState,
  dueCards,
  srsStats,
  weakAreas,
  streakDays,
  previewIntervals,
  formatInterval,
  GRADES,
  MIN_EASE,
  DEFAULT_EASE,
  MATURE_DAYS,
  type ReviewMap,
} from "./srs";

const NOW = new Date("2026-08-01T10:00:00Z").getTime();
const DAY = 86_400_000;
const days = (state: { dueAt: number }) => Math.round((state.dueAt - NOW) / DAY);

describe("schedule", () => {
  it("starts a new card at one day after a good answer", () => {
    const s = schedule(undefined, "good", NOW);
    expect(s.streak).toBe(1);
    expect(days(s)).toBe(1);
    expect(s.reviews).toBe(1);
  });

  it("uses the SM-2 shape: 1 day, then 6, then multiplied by ease", () => {
    let s = schedule(undefined, "good", NOW);
    expect(days(s)).toBe(1);

    s = schedule(s, "good", NOW);
    expect(days(s)).toBe(6);

    s = schedule(s, "good", NOW);
    expect(days(s)).toBe(Math.round(6 * DEFAULT_EASE));   // 15
  });

  it("sends a failed card back within the same session and records a lapse", () => {
    const learned = schedule(schedule(undefined, "good", NOW), "good", NOW);
    const failed = schedule(learned, "again", NOW);

    expect(failed.streak).toBe(0);
    expect(failed.intervalDays).toBe(0);
    expect(failed.dueAt - NOW).toBeLessThanOrEqual(15 * 60_000);
    expect(failed.lapses).toBe(1);
  });

  it("lowers ease on failure and hard, raises it on easy", () => {
    const base = schedule(undefined, "good", NOW);
    expect(schedule(base, "again", NOW).ease).toBeLessThan(base.ease);
    expect(schedule(base, "hard", NOW).ease).toBeLessThan(base.ease);
    expect(schedule(base, "easy", NOW).ease).toBeGreaterThan(base.ease);
  });

  it("never drops ease below the floor", () => {
    let s = newState(NOW);
    for (let i = 0; i < 20; i++) s = schedule(s, "again", NOW);
    expect(s.ease).toBeGreaterThanOrEqual(MIN_EASE);
  });

  it("pushes an easy card further than a good one", () => {
    const twice = schedule(schedule(undefined, "good", NOW), "good", NOW);
    expect(days(schedule(twice, "easy", NOW))).toBeGreaterThan(days(schedule(twice, "good", NOW)));
    expect(days(schedule(twice, "hard", NOW))).toBeLessThan(days(schedule(twice, "good", NOW)));
  });

  it("caps the interval at a year", () => {
    let s = newState(NOW);
    for (let i = 0; i < 30; i++) s = schedule(s, "easy", NOW);
    expect(s.intervalDays).toBeLessThanOrEqual(365);
  });

  it("keeps lapses across successful reviews", () => {
    const failed = schedule(schedule(undefined, "good", NOW), "again", NOW);
    expect(schedule(failed, "good", NOW).lapses).toBe(1);
  });
});

describe("previewIntervals", () => {
  it("gives a label for every grade", () => {
    const preview = previewIntervals(undefined, NOW);
    for (const g of GRADES) expect(preview[g.id], g.id).toMatch(/^\d+(\.\d+)?(m|h|d|mo|y)$/);
  });
});

describe("formatInterval", () => {
  it("scales the unit to the size", () => {
    expect(formatInterval(10 * 60_000)).toBe("10m");
    expect(formatInterval(5 * 3_600_000)).toBe("5h");
    expect(formatInterval(3 * DAY)).toBe("3d");
    expect(formatInterval(60 * DAY)).toBe("2mo");
    expect(formatInterval(400 * DAY)).toBe("1.1y");
  });
});

describe("dueCards", () => {
  const cards = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("treats never-seen cards as due", () => {
    expect(dueCards(cards, {}, NOW).map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("excludes cards scheduled for the future", () => {
    const reviews: ReviewMap = { a: { ...newState(NOW), dueAt: NOW + 5 * DAY, reviews: 1 } };
    expect(dueCards(cards, reviews, NOW).map((c) => c.id)).toEqual(["b", "c"]);
  });

  it("puts due cards before never-seen ones, weakest first", () => {
    const reviews: ReviewMap = {
      b: { ...newState(NOW), dueAt: NOW - DAY, reviews: 3, ease: 2.5 },
      c: { ...newState(NOW), dueAt: NOW - DAY, reviews: 3, ease: 1.8 },   // struggling
    };
    expect(dueCards(cards, reviews, NOW).map((x) => x.id)).toEqual(["c", "b", "a"]);
  });
});

describe("srsStats", () => {
  const cards = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

  it("counts an untouched deck as entirely unseen and due", () => {
    const stats = srsStats(cards, {}, NOW);
    expect(stats).toMatchObject({ total: 4, unseen: 4, dueNow: 4, mature: 0, learning: 0, retention: 0 });
  });

  it("separates learning from mature by the interval threshold", () => {
    const reviews: ReviewMap = {
      a: { ...newState(NOW), reviews: 2, intervalDays: 6, dueAt: NOW + 6 * DAY },
      b: { ...newState(NOW), reviews: 5, intervalDays: MATURE_DAYS, dueAt: NOW + 30 * DAY },
    };
    const stats = srsStats(cards, reviews, NOW);
    expect(stats.learning).toBe(1);
    expect(stats.mature).toBe(1);
    expect(stats.unseen).toBe(2);
  });

  it("computes retention from lapses", () => {
    const reviews: ReviewMap = {
      a: { ...newState(NOW), reviews: 8, lapses: 2, intervalDays: 3, dueAt: NOW + DAY },
    };
    expect(srsStats(cards, reviews, NOW).retention).toBe(75);
  });

  it("counts reviews done today", () => {
    const reviews: ReviewMap = {
      a: { ...newState(NOW), reviews: 1, intervalDays: 1, dueAt: NOW + DAY, lastReviewedAt: NOW },
      b: { ...newState(NOW), reviews: 1, intervalDays: 1, dueAt: NOW + DAY, lastReviewedAt: NOW - 3 * DAY },
    };
    expect(srsStats(cards, reviews, NOW).reviewsToday).toBe(1);
  });
});

describe("weakAreas", () => {
  const cards = [
    { id: "a", topic: "csharp" },
    { id: "b", topic: "csharp" },
    { id: "c", topic: "azure" },
  ];
  const label = (k: string) => k.toUpperCase();

  it("ranks the topic with the highest failure rate first", () => {
    const reviews: ReviewMap = {
      a: { ...newState(NOW), reviews: 4, lapses: 3 },     // 75% failed
      c: { ...newState(NOW), reviews: 4, lapses: 1 },     // 25% failed
    };
    const areas = weakAreas(cards, reviews, (c) => c.topic, label);
    expect(areas[0]).toMatchObject({ key: "csharp", label: "CSHARP", failureRate: 75, weak: 1, total: 2 });
    expect(areas[1].key).toBe("azure");
  });

  it("reports zero for topics with no reviews", () => {
    expect(weakAreas(cards, {}, (c) => c.topic, label).every((a) => a.failureRate === 0)).toBe(true);
  });
});

describe("streakDays", () => {
  it("counts consecutive days ending today", () => {
    const reviews: ReviewMap = {
      a: { ...newState(NOW), lastReviewedAt: NOW },
      b: { ...newState(NOW), lastReviewedAt: NOW - DAY },
      c: { ...newState(NOW), lastReviewedAt: NOW - 2 * DAY },
    };
    expect(streakDays(reviews, NOW)).toBe(3);
  });

  it("survives a gap for today if yesterday was studied", () => {
    const reviews: ReviewMap = { b: { ...newState(NOW), lastReviewedAt: NOW - DAY } };
    expect(streakDays(reviews, NOW)).toBe(1);
  });

  it("breaks when a day is missed", () => {
    const reviews: ReviewMap = {
      a: { ...newState(NOW), lastReviewedAt: NOW },
      c: { ...newState(NOW), lastReviewedAt: NOW - 3 * DAY },
    };
    expect(streakDays(reviews, NOW)).toBe(1);
  });

  it("is zero with no reviews", () => {
    expect(streakDays({}, NOW)).toBe(0);
  });
});
