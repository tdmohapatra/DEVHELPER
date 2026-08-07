import { create } from "zustand";

/**
 * A one-shot prefill handed from one tool to another.
 *
 * The Database Toolkit could already be opened on an environment's database
 * reference because it owns a persisted connection list to write into. The
 * messaging tools do not have one — their address lives in component state —
 * so a handoff needs somewhere to sit for the moment between "open the tool"
 * and "the tool mounts and reads it".
 *
 * Deliberately not persisted: a prefill is a navigation, and a navigation that
 * survives a restart would silently repoint a tool days later.
 */

export interface Handoff {
  /** Field values the receiving tool understands, e.g. { server: "localhost:8222" }. */
  fields: Record<string, string>;
  /** Where it came from, for the "prefilled from DEV" note. */
  from: string;
}

interface HandoffState {
  pending: Record<string, Handoff>;
  /** Queue a prefill for a tool id. Replaces any prefill that tool had not read yet. */
  send: (toolId: string, handoff: Handoff) => void;
  /** Read and clear a tool's prefill. Returns undefined when there is none. */
  take: (toolId: string) => Handoff | undefined;
  clear: (toolId: string) => void;
}

export const useHandoffStore = create<HandoffState>()((set, get) => ({
  pending: {},
  send: (toolId, handoff) => set((s) => ({ pending: { ...s.pending, [toolId]: handoff } })),
  take: (toolId) => {
    const handoff = get().pending[toolId];
    if (handoff) {
      set((s) => {
        const { [toolId]: _taken, ...rest } = s.pending;
        return { pending: rest };
      });
    }
    return handoff;
  },
  clear: (toolId) =>
    set((s) => {
      const { [toolId]: _dropped, ...rest } = s.pending;
      return { pending: rest };
    }),
}));

/** Queue a prefill and return it, for callers that also want to navigate. */
export function sendHandoff(toolId: string, fields: Record<string, string>, from: string): void {
  useHandoffStore.getState().send(toolId, { fields, from });
}
