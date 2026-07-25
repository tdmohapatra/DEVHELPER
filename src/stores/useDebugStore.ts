import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { DebugEvent, DebugSessionData, ParsedEvent } from "@/tools/lib/debugSession";

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.floor(performance.now())));

interface DebugState {
  sessions: DebugSessionData[];
  activeId: string | null;

  createSession: (name?: string) => string;
  renameSession: (id: string, name: string) => void;
  deleteSession: (id: string) => void;
  setActive: (id: string | null) => void;

  addEvent: (sessionId: string, event: ParsedEvent) => void;
  importEvents: (sessionId: string, events: ParsedEvent[]) => number;
  removeEvent: (sessionId: string, eventId: string) => void;
  clearEvents: (sessionId: string) => void;
}

function materialize(e: ParsedEvent): DebugEvent {
  const { at, ...rest } = e;
  return { ...rest, id: uid(), at: at ?? Date.now() };
}

export const useDebugStore = create<DebugState>()(
  persist(
    (set) => ({
      sessions: [],
      activeId: null,

      createSession: (name) => {
        const id = uid();
        const session: DebugSessionData = { id, name: name?.trim() || "New session", createdAt: Date.now(), events: [] };
        set((s) => ({ sessions: [...s.sessions, session], activeId: id }));
        return id;
      },
      renameSession: (id, name) =>
        set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, name } : x)) })),
      deleteSession: (id) =>
        set((s) => ({
          sessions: s.sessions.filter((x) => x.id !== id),
          activeId: s.activeId === id ? null : s.activeId,
        })),
      setActive: (id) => set({ activeId: id }),

      addEvent: (sessionId, event) =>
        set((s) => ({
          sessions: s.sessions.map((x) => (x.id === sessionId ? { ...x, events: [...x.events, materialize(event)] } : x)),
        })),
      importEvents: (sessionId, events) => {
        const mats = events.map(materialize);
        set((s) => ({
          sessions: s.sessions.map((x) => (x.id === sessionId ? { ...x, events: [...x.events, ...mats] } : x)),
        }));
        return mats.length;
      },
      removeEvent: (sessionId, eventId) =>
        set((s) => ({
          sessions: s.sessions.map((x) => (x.id === sessionId ? { ...x, events: x.events.filter((e) => e.id !== eventId) } : x)),
        })),
      clearEvents: (sessionId) =>
        set((s) => ({ sessions: s.sessions.map((x) => (x.id === sessionId ? { ...x, events: [] } : x)) })),
    }),
    { name: "devhelper-debug" },
  ),
);

/**
 * Push an event into a session from anywhere (e.g. other tools). If no session id is
 * given, targets the active session; if there is no active session, one is created.
 * Returns the session id the event was added to.
 */
export function pushDebugEvent(event: ParsedEvent, sessionId?: string): string {
  const store = useDebugStore.getState();
  let target = sessionId ?? store.activeId;
  if (!target || !store.sessions.some((s) => s.id === target)) {
    target = store.createSession("Captured");
  }
  useDebugStore.getState().addEvent(target, event);
  return target;
}
