import { create } from "zustand";
import { persist } from "zustand/middleware";
import { EMPTY_MAPPING, type Mapping } from "@/tools/lib/fieldMap";

interface MappingState {
  mappings: Mapping[];
  /** Index of the mapping being edited. */
  current: number;
  /** The last sample document, per source kind, so switching kinds keeps both. */
  samples: Record<string, string>;
  /** Target fields the receiving system expects, one per line. */
  expected: string;

  select: (index: number) => void;
  add: (mapping?: Mapping) => void;
  update: (mapping: Mapping) => void;
  remove: (index: number) => void;
  setSample: (kind: string, text: string) => void;
  setExpected: (text: string) => void;
}

/**
 * Mappings are the artefact, so they are what gets persisted.
 *
 * Sample documents are persisted too, which is a deliberate risk: a sample is
 * usually a real message, and this storage is copied by a workspace backup. The
 * tool says so on screen. Keeping them is worth it — a mapping you cannot re-run
 * against the message it was built for is a mapping you cannot trust after an
 * edit.
 */
export const useMappingStore = create<MappingState>()(
  persist(
    (set, get) => ({
      mappings: [EMPTY_MAPPING],
      current: 0,
      samples: {},
      expected: "",

      select: (index) => set({ current: Math.max(0, Math.min(index, get().mappings.length - 1)) }),
      add: (mapping) =>
        set((s) => ({
          mappings: [...s.mappings, mapping ?? { ...EMPTY_MAPPING, name: `Mapping ${s.mappings.length + 1}`, rules: [] }],
          current: s.mappings.length,
        })),
      update: (mapping) => set((s) => ({ mappings: s.mappings.map((m, i) => (i === s.current ? mapping : m)) })),
      remove: (index) =>
        set((s) => {
          const mappings = s.mappings.filter((_, i) => i !== index);
          // Never leave the tool with nothing to edit.
          return {
            mappings: mappings.length ? mappings : [EMPTY_MAPPING],
            current: Math.max(0, Math.min(s.current, (mappings.length || 1) - 1)),
          };
        }),
      setSample: (kind, text) => set((s) => ({ samples: { ...s.samples, [kind]: text } })),
      setExpected: (text) => set({ expected: text }),
    }),
    { name: "devhelper-mappings" },
  ),
);
