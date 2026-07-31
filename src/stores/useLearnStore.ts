import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Question } from "@/tools/lib/learn/types";
import type { StarStory } from "@/tools/lib/learn/star";
import { schedule, type Grade, type ReviewMap } from "@/tools/lib/learn/srs";

/**
 * Learning state: your own questions, revision progress and bookmarks.
 *
 * All of it is persisted — unlike the rest of the app, this data has no other home and
 * losing it would mean losing your own notes.
 */

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));

export type ProgressState = "known" | "review";

interface LearnState {
  /** Questions the user wrote or imported. */
  custom: Question[];
  /** questionId -> state. Absent means unseen. */
  progress: Record<string, ProgressState>;
  bookmarks: string[];
  /** Ids hidden from the catalogue, so built-ins can be dismissed without deleting code. */
  hidden: string[];
  /** Behavioural STAR stories written by the user. */
  stories: StarStory[];
  /** Spaced-repetition schedule, keyed by question id. */
  reviews: ReviewMap;

  addQuestion: (q: Omit<Question, "id"> & { id?: string }) => string;
  updateQuestion: (q: Question) => void;
  deleteQuestion: (id: string) => void;
  importQuestions: (questions: Question[]) => number;

  mark: (id: string, state: ProgressState | null) => void;
  resetProgress: (ids?: string[]) => void;
  toggleBookmark: (id: string) => void;
  toggleHidden: (id: string) => void;

  /** Grade a card and schedule its next review. */
  gradeCard: (id: string, grade: Grade) => void;
  resetReviews: (ids?: string[]) => void;

  saveStory: (story: StarStory) => string;
  deleteStory: (id: string) => void;
  importStories: (stories: StarStory[]) => number;
}

export const useLearnStore = create<LearnState>()(
  persist(
    (set) => ({
      custom: [],
      progress: {},
      bookmarks: [],
      hidden: [],
      stories: [],
      reviews: {},

      addQuestion: (q) => {
        const id = q.id ?? uid();
        set((s) => ({ custom: [...s.custom, { ...q, id } as Question] }));
        return id;
      },
      updateQuestion: (q) => set((s) => ({ custom: s.custom.map((x) => (x.id === q.id ? q : x)) })),
      deleteQuestion: (id) =>
        set((s) => ({
          custom: s.custom.filter((x) => x.id !== id),
          bookmarks: s.bookmarks.filter((b) => b !== id),
        })),
      importQuestions: (questions) => {
        // Imported ids may collide with existing ones; keep both by re-keying.
        set((s) => {
          const existing = new Set(s.custom.map((q) => q.id));
          const incoming = questions.map((q) => (existing.has(q.id) ? { ...q, id: uid() } : q));
          return { custom: [...s.custom, ...incoming] };
        });
        return questions.length;
      },

      mark: (id, state) =>
        set((s) => {
          const next = { ...s.progress };
          if (state === null) delete next[id];
          else next[id] = state;
          return { progress: next };
        }),
      resetProgress: (ids) =>
        set((s) => {
          if (!ids) return { progress: {} };
          const next = { ...s.progress };
          for (const id of ids) delete next[id];
          return { progress: next };
        }),
      toggleBookmark: (id) =>
        set((s) => ({
          bookmarks: s.bookmarks.includes(id) ? s.bookmarks.filter((b) => b !== id) : [...s.bookmarks, id],
        })),
      toggleHidden: (id) =>
        set((s) => ({
          hidden: s.hidden.includes(id) ? s.hidden.filter((h) => h !== id) : [...s.hidden, id],
        })),

      gradeCard: (id, grade) =>
        set((s) => {
          const next = schedule(s.reviews[id], grade, Date.now());
          // Keep the simple known/review flags in step, so the browse list still shows state.
          const progress = { ...s.progress };
          if (grade === "again") progress[id] = "review";
          else if (next.intervalDays >= 6) progress[id] = "known";
          else delete progress[id];

          return { reviews: { ...s.reviews, [id]: next }, progress };
        }),
      resetReviews: (ids) =>
        set((s) => {
          if (!ids) return { reviews: {} };
          const next = { ...s.reviews };
          for (const id of ids) delete next[id];
          return { reviews: next };
        }),

      saveStory: (story) => {
        const id = story.id || uid();
        const record = { ...story, id, updatedAt: Date.now() };
        set((s) => ({
          stories: s.stories.some((x) => x.id === id)
            ? s.stories.map((x) => (x.id === id ? record : x))
            : [...s.stories, record],
        }));
        return id;
      },
      deleteStory: (id) => set((s) => ({ stories: s.stories.filter((x) => x.id !== id) })),
      importStories: (stories) => {
        set((s) => {
          const existing = new Set(s.stories.map((x) => x.id));
          const incoming = stories.map((x) => (existing.has(x.id) ? { ...x, id: uid() } : x));
          return { stories: [...s.stories, ...incoming] };
        });
        return stories.length;
      },
    }),
    { name: "devhelper-learn" },
  ),
);
