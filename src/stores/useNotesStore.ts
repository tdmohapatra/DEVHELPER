import { create } from "zustand";
import { persist } from "zustand/middleware";
import { pushRevision, toggleTask, type Note, type Revision } from "@/tools/lib/notes";

/**
 * Notes state.
 *
 * The store holds notes and their local history and nothing derived — tags,
 * links, tasks and the outline are read back out of the Markdown on demand
 * (src/tools/lib/notes.ts). Nothing here can drift out of step with the text
 * because nothing here duplicates it.
 *
 * Every edit goes through `update`, which is also what records history, so a
 * revision cannot be missed by a code path that forgot to ask for one.
 */

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `n${Date.now()}${Math.random().toString(16).slice(2)}`);

export interface NotesState {
  notes: Note[];
  /** note id → newest revision first. Capped per note; see pushRevision. */
  revisions: Record<string, Revision[]>;
  create: (seed?: Partial<Pick<Note, "title" | "body" | "tags" | "color">>) => string;
  update: (id: string, patch: Partial<Omit<Note, "id" | "createdAt">>) => void;
  remove: (id: string) => void;
  togglePin: (id: string) => void;
  toggleArchive: (id: string) => void;
  /** Tick or untick the checkbox on one line of a note's body. */
  toggleTaskLine: (id: string, line: number) => void;
  /** Put a past revision back, recording the current text as a revision first. */
  restore: (id: string, at: number) => void;
  /** Add imported notes. Ids always regenerated, so an import never overwrites. */
  addImported: (notes: Note[]) => number;
}

export const useNotesStore = create<NotesState>()(
  persist(
    (set, get) => ({
      notes: [],
      revisions: {},

      create: (seed) => {
        const id = uid();
        const now = Date.now();
        const note: Note = {
          id,
          title: seed?.title ?? "",
          body: seed?.body ?? "",
          tags: seed?.tags ?? [],
          pinned: false,
          archived: false,
          color: seed?.color,
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ notes: [note, ...s.notes] }));
        return id;
      },

      update: (id, patch) =>
        set((s) => {
          const current = s.notes.find((n) => n.id === id);
          if (!current) return s;
          const next = { ...current, ...patch, updatedAt: Date.now() };

          // History only tracks the text; pinning something is not a revision.
          const textChanged = next.body !== current.body || next.title !== current.title;
          const revisions = textChanged
            ? {
                ...s.revisions,
                [id]: pushRevision(s.revisions[id] ?? [], { at: current.updatedAt, body: current.body, title: current.title }),
              }
            : s.revisions;

          return { notes: s.notes.map((n) => (n.id === id ? next : n)), revisions };
        }),

      remove: (id) =>
        set((s) => {
          const { [id]: _dropped, ...revisions } = s.revisions;
          return { notes: s.notes.filter((n) => n.id !== id), revisions };
        }),

      togglePin: (id) => set((s) => ({ notes: s.notes.map((n) => (n.id === id ? { ...n, pinned: !n.pinned } : n)) })),

      toggleArchive: (id) => set((s) => ({ notes: s.notes.map((n) => (n.id === id ? { ...n, archived: !n.archived } : n)) })),

      toggleTaskLine: (id, line) => {
        const note = get().notes.find((n) => n.id === id);
        if (!note) return;
        const body = toggleTask(note.body, line);
        if (body !== note.body) get().update(id, { body });
      },

      restore: (id, at) => {
        const revision = get().revisions[id]?.find((r) => r.at === at);
        if (!revision) return;
        get().update(id, { body: revision.body, title: revision.title });
      },

      addImported: (incoming) => {
        if (!incoming.length) return 0;
        const now = Date.now();
        const fresh = incoming.map((n, i) => ({ ...n, id: uid(), createdAt: n.createdAt || now, updatedAt: n.updatedAt || now + i }));
        set((s) => ({ notes: [...fresh, ...s.notes] }));
        return fresh.length;
      },
    }),
    { name: "devhelper-notes" },
  ),
);
