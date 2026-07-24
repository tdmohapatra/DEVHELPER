import { create } from "zustand";
import { persist } from "zustand/middleware";

export type AiProvider = "ollama" | "openai";

interface AiState {
  provider: AiProvider;
  ollamaUrl: string;
  ollamaModel: string;
  openaiBaseUrl: string;
  openaiKey: string;
  openaiModel: string;

  set: (patch: Partial<AiState>) => void;
  isConfigured: () => boolean;
}

export const useAiStore = create<AiState>()(
  persist(
    (set, get) => ({
      provider: "ollama",
      ollamaUrl: "http://localhost:11434",
      ollamaModel: "llama3.1",
      openaiBaseUrl: "https://api.openai.com/v1",
      openaiKey: "",
      openaiModel: "gpt-4o-mini",

      set: (patch) => set(patch),
      isConfigured: () => {
        const s = get();
        return s.provider === "ollama" ? !!s.ollamaUrl && !!s.ollamaModel : !!s.openaiKey && !!s.openaiModel;
      },
    }),
    { name: "devhelper-ai" },
  ),
);
