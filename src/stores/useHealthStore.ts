import { create } from "zustand";
import { persist } from "zustand/middleware";
import { withoutSecrets, WINDOW, type Probe, type Watcher } from "@/tools/lib/healthBoard";

interface HealthState {
  watchers: Watcher[];
  /** Probe history per watcher id, oldest first. */
  probes: Record<string, Probe[]>;
  /** Availability target the error budget is measured against. */
  target: number;
  running: boolean;

  add: (watcher: Watcher) => void;
  update: (id: string, patch: Partial<Watcher>) => void;
  remove: (id: string) => void;
  record: (id: string, probe: Probe) => void;
  clear: (id?: string) => void;
  setTarget: (target: number) => void;
  setRunning: (running: boolean) => void;
}

export const useHealthStore = create<HealthState>()(
  persist(
    (set) => ({
      watchers: [],
      probes: {},
      target: 99.5,
      running: false,

      add: (watcher) => set((s) => ({ watchers: [...s.watchers, watcher] })),
      update: (id, patch) => set((s) => ({ watchers: s.watchers.map((w) => (w.id === id ? { ...w, ...patch } : w)) })),
      remove: (id) =>
        set((s) => {
          const probes = { ...s.probes };
          delete probes[id];
          return { watchers: s.watchers.filter((w) => w.id !== id), probes };
        }),
      record: (id, probe) =>
        set((s) => ({ probes: { ...s.probes, [id]: [...(s.probes[id] ?? []), probe].slice(-WINDOW) } })),
      clear: (id) => set((s) => (id ? { probes: { ...s.probes, [id]: [] } } : { probes: {} })),
      setTarget: (target) => set({ target }),
      setRunning: (running) => set({ running }),
    }),
    {
      name: "devhelper-health",
      /*
       * Credential header values are stripped before anything is written, and
       * `running` is never persisted — a board that starts probing the moment the
       * app opens is a surprise, and on a shared laptop an unwelcome one.
       *
       * Probe history is kept: the value of a board is the shape over time, and
       * losing it on every restart makes the tool a refresh button.
       */
      partialize: (state) => ({
        watchers: state.watchers.map(withoutSecrets),
        probes: state.probes,
        target: state.target,
      }),
    },
  ),
);
