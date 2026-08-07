import { create } from "zustand";
import { persist } from "zustand/middleware";
import { aiAccount, deleteSecret, getSecret, setSecret } from "@/lib/secrets";

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
    {
      name: "devhelper-ai",
      /**
       * The API key is deliberately not persisted here.
       *
       * It used to be, in plain text, in the same local storage a workspace
       * backup copies — which meant an exported backup carried a live
       * credential. It now lives in the OS credential store when the user opts
       * in (see `lib/secrets.ts`), and is loaded into memory at startup.
       */
      partialize: ({ openaiKey: _key, ...rest }) => rest,
    },
  ),
);

const OPENAI_ACCOUNT = aiAccount("openai");

/**
 * Load a remembered API key into memory.
 *
 * Called once at startup. Does nothing when nothing was saved, which is the
 * default — the key is only in the OS store if someone asked for it to be.
 */
export async function loadRememberedAiKey(): Promise<void> {
  const key = await getSecret(OPENAI_ACCOUNT);
  if (key) useAiStore.setState({ openaiKey: key });
}

/** Save the current API key to the OS credential store. */
export async function rememberAiKey(key: string): Promise<void> {
  await setSecret(OPENAI_ACCOUNT, key);
}

/** Remove the remembered API key. The in-memory one is untouched. */
export async function forgetAiKey(): Promise<void> {
  await deleteSecret(OPENAI_ACCOUNT);
}

/** Is an API key currently remembered on this machine? */
export async function aiKeyRemembered(): Promise<boolean> {
  return (await getSecret(OPENAI_ACCOUNT)) !== null;
}
