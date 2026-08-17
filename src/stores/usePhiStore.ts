import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PhiKind, PhiPolicy } from "@/tools/lib/phi";

export interface PhiLogEntry {
  at: number;
  /** Which tool made the request, when it said. */
  tool: string;
  destination: string;
  local: boolean;
  policy: PhiPolicy;
  /** How many identifiers were found. */
  found: number;
  /** Counts by kind — never the values. */
  kinds: Partial<Record<PhiKind, number>>;
  sent: boolean;
  message: string;
}

interface PhiState {
  policy: PhiPolicy;
  /**
   * Skip redaction when the model is on this machine.
   *
   * On by default because an Ollama at localhost is not a disclosure, and
   * redacting there costs answer quality for no privacy gain. Off is the right
   * choice for anyone who cannot vouch for what their "local" endpoint forwards.
   */
  trustLocal: boolean;
  log: PhiLogEntry[];

  set: (patch: Partial<Pick<PhiState, "policy" | "trustLocal">>) => void;
  record: (entry: PhiLogEntry) => void;
  clearLog: () => void;
}

/** How many log lines to keep. Enough to answer "what left the machine today". */
const LOG_LIMIT = 100;

export const usePhiStore = create<PhiState>()(
  persist(
    (set) => ({
      // Redacting by default is the whole point: a setting that has to be turned
      // on protects nobody on the day it matters.
      policy: "redact",
      trustLocal: true,
      log: [],

      set: (patch) => set(patch),
      record: (entry) => set((s) => ({ log: [entry, ...s.log].slice(0, LOG_LIMIT) })),
      clearLog: () => set({ log: [] }),
    }),
    {
      name: "devhelper-phi",
      /*
       * The log is persisted, and it is safe to persist because it holds counts
       * and category names only — never a redacted value and never an original.
       * A workspace backup copies this storage, so anything put in here leaves
       * the machine with the backup.
       */
    },
  ),
);
