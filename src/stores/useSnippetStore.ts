import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Snippet {
  id: string;
  title: string;
  language: string;
  code: string;
  tags: string[];
  favorite: boolean;
  updatedAt: number;
}

export const SNIPPET_LANGUAGES = ["C#", ".NET", "Python", "SQL", "Docker", "PowerShell", "Git", "Redis", "NATS", "RabbitMQ", "API", "HL7", "FHIR", "JavaScript", "TypeScript", "Other"];

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(performance.now()));

interface SnippetState {
  snippets: Snippet[];
  upsert: (s: Omit<Snippet, "id" | "updatedAt"> & { id?: string }) => string;
  remove: (id: string) => void;
  toggleFavorite: (id: string) => void;
}

export const useSnippetStore = create<SnippetState>()(
  persist(
    (set) => ({
      snippets: [],
      upsert: (s) => {
        const id = s.id ?? uid();
        const record: Snippet = {
          id,
          title: s.title,
          language: s.language,
          code: s.code,
          tags: s.tags,
          favorite: s.favorite ?? false,
          updatedAt: Date.now(),
        };
        set((state) => {
          const exists = state.snippets.some((x) => x.id === id);
          return {
            snippets: exists ? state.snippets.map((x) => (x.id === id ? record : x)) : [record, ...state.snippets],
          };
        });
        return id;
      },
      remove: (id) => set((state) => ({ snippets: state.snippets.filter((s) => s.id !== id) })),
      toggleFavorite: (id) => set((state) => ({ snippets: state.snippets.map((s) => (s.id === id ? { ...s, favorite: !s.favorite } : s)) })),
    }),
    { name: "devhelper-snippets" },
  ),
);
