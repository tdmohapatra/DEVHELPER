import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "dark" | "light";

/** A view is either a special page or a tool id. */
export type View =
  | { kind: "dashboard" }
  | { kind: "favorites" }
  | { kind: "recent" }
  | { kind: "settings" }
  | { kind: "tool"; toolId: string };

interface AppState {
  theme: Theme;
  favorites: string[];
  recent: string[]; // most-recent first
  view: View;

  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
  toggleFavorite: (toolId: string) => void;
  isFavorite: (toolId: string) => boolean;
  openTool: (toolId: string) => void;
  openView: (view: View) => void;
}

const RECENT_LIMIT = 12;

/** Map a view to its URL hash (enables deep links / shareable routes). */
export function hashForView(view: View): string {
  if (view.kind === "tool") return `#/tools/${view.toolId}`;
  if (view.kind === "dashboard") return "#/";
  return `#/${view.kind}`;
}

/** Parse the current location hash into a view, or null if unrecognized. */
export function viewFromHash(): View | null {
  if (typeof window === "undefined") return null;
  const h = window.location.hash.replace(/^#\/?/, "");
  if (!h) return { kind: "dashboard" };
  if (h === "favorites" || h === "recent" || h === "settings") return { kind: h };
  const m = h.match(/^tools\/(.+)$/);
  if (m) return { kind: "tool", toolId: m[1] };
  return null;
}

function writeHash(view: View) {
  if (typeof window === "undefined") return;
  const h = hashForView(view);
  if (window.location.hash !== h) window.location.hash = h;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      theme: "dark",
      favorites: [],
      recent: [],
      view: { kind: "dashboard" },

      toggleTheme: () => {
        const next = get().theme === "dark" ? "light" : "dark";
        get().setTheme(next);
      },
      setTheme: (t) => {
        set({ theme: t });
        document.documentElement.classList.toggle("dark", t === "dark");
      },
      toggleFavorite: (toolId) =>
        set((s) => ({
          favorites: s.favorites.includes(toolId)
            ? s.favorites.filter((id) => id !== toolId)
            : [...s.favorites, toolId],
        })),
      isFavorite: (toolId) => get().favorites.includes(toolId),
      openTool: (toolId) => {
        writeHash({ kind: "tool", toolId });
        set((s) => ({
          view: { kind: "tool", toolId },
          recent: [toolId, ...s.recent.filter((id) => id !== toolId)].slice(0, RECENT_LIMIT),
        }));
      },
      openView: (view) => {
        writeHash(view);
        set({ view });
      },
    }),
    {
      name: "devhelper-app",
      partialize: (s) => ({ theme: s.theme, favorites: s.favorites, recent: s.recent }),
      onRehydrateStorage: () => (state) => {
        // Apply persisted theme to the <html> element on load.
        if (state) document.documentElement.classList.toggle("dark", state.theme === "dark");
      },
    },
  ),
);
