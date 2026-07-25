import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { DbConnection } from "@/tools/lib/dbTypes";

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.floor(performance.now())));

export interface DbHistoryEntry {
  id: string;
  connId: string;
  sql: string;
  at: number;
  ok: boolean;
  rowCount?: number;
}

const HISTORY_LIMIT = 50;

interface DbState {
  connections: DbConnection[];
  activeId: string | null;
  history: DbHistoryEntry[];
  /**
   * Session-only passwords, keyed by connection id. NEVER persisted — cleared when the
   * app closes. Secure OS credential storage (DPAPI / Credential Manager) is a later step.
   */
  passwords: Record<string, string>;

  upsert: (c: Omit<DbConnection, "id"> & { id?: string }) => string;
  remove: (id: string) => void;
  duplicate: (id: string) => string | null;
  setActive: (id: string | null) => void;
  setPassword: (id: string, password: string) => void;
  getPassword: (id: string) => string;
  clearPasswords: () => void;
  pushHistory: (e: Omit<DbHistoryEntry, "id" | "at">) => void;
  clearHistory: (connId: string) => void;
}

export const useDbStore = create<DbState>()(
  persist(
    (set, get) => ({
      connections: [],
      activeId: null,
      history: [],
      passwords: {},

      upsert: (c) => {
        const id = c.id ?? uid();
        const record: DbConnection = { ...c, id };
        set((s) => {
          const exists = s.connections.some((x) => x.id === id);
          return {
            connections: exists ? s.connections.map((x) => (x.id === id ? record : x)) : [...s.connections, record],
            activeId: s.activeId ?? id,
          };
        });
        return id;
      },
      remove: (id) =>
        set((s) => {
          const { [id]: _drop, ...restPw } = s.passwords;
          return {
            connections: s.connections.filter((c) => c.id !== id),
            activeId: s.activeId === id ? null : s.activeId,
            passwords: restPw,
          };
        }),
      duplicate: (id) => {
        const src = get().connections.find((c) => c.id === id);
        if (!src) return null;
        const newId = uid();
        set((s) => ({ connections: [...s.connections, { ...src, id: newId, name: `${src.name} (copy)` }] }));
        return newId;
      },
      setActive: (id) => set({ activeId: id }),
      setPassword: (id, password) => set((s) => ({ passwords: { ...s.passwords, [id]: password } })),
      getPassword: (id) => get().passwords[id] ?? "",
      clearPasswords: () => set({ passwords: {} }),
      pushHistory: (e) =>
        set((s) => ({
          history: [{ ...e, id: uid(), at: Date.now() }, ...s.history].slice(0, HISTORY_LIMIT),
        })),
      clearHistory: (connId) => set((s) => ({ history: s.history.filter((h) => h.connId !== connId) })),
    }),
    {
      name: "devhelper-db",
      // Persist connection metadata + query history. Passwords and active selection stay in memory.
      partialize: (s) => ({ connections: s.connections, history: s.history }),
    },
  ),
);
