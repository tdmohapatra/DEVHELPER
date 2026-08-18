import { create } from "zustand";
import { persist } from "zustand/middleware";
import { aiAccount, deleteSecret, getSecret, setSecret } from "@/lib/secrets";

import { DEFAULT_HUB_DIR } from "@/tools/lib/localLlm";

/**
 * `local` is a GGUF file on this machine, served by a llama.cpp process
 * DevHelper starts. `ollama` is another program already serving one. They are
 * separate providers because the difference the user cares about — who is
 * responsible for the server being up — is exactly the difference between them.
 */
export type AiProvider = "ollama" | "openai" | "local";

interface AiState {
  provider: AiProvider;
  ollamaUrl: string;
  ollamaModel: string;
  openaiBaseUrl: string;
  openaiKey: string;
  openaiModel: string;

  /** Folder scanned for .gguf files. */
  localHubDir: string;
  /** Absolute path of the chosen model file. */
  localModelPath: string;
  /** What the chosen model is called, for the request body and the UI. */
  localModelLabel: string;
  /** Explicit llama-server path; empty means "look in the usual places". */
  localRuntimePath: string;
  localCtxSize: number;
  /** -1 offloads every layer to the GPU, 0 keeps it on the CPU. */
  localGpuLayers: number;
  localThreads: number;

  /** Port the running server is on. 0 when nothing is running. */
  localPort: number;
  /** Whether the server answered its health check. Never persisted. */
  localRunning: boolean;

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

      localHubDir: DEFAULT_HUB_DIR,
      localModelPath: "",
      localModelLabel: "",
      localRuntimePath: "",
      localCtxSize: 4096,
      localGpuLayers: 0,
      localThreads: 0,
      localPort: 0,
      localRunning: false,

      set: (patch) => set(patch),
      isConfigured: () => {
        const s = get();
        if (s.provider === "ollama") return !!s.ollamaUrl && !!s.ollamaModel;
        // A chosen model is not a reachable one. Until the server is up there is
        // nothing to send a prompt to, and a tool that says "configured" and then
        // fails on the first request is worse than one that says "start it".
        if (s.provider === "local") return !!s.localModelPath && s.localRunning && s.localPort > 0;
        return !!s.openaiKey && !!s.openaiModel;
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
       *
       * `localPort` and `localRunning` are left out for a different reason:
       * they describe a process that does not survive a restart, and restoring
       * them would have DevHelper confidently address a port nobody is on.
       */
      partialize: ({ openaiKey: _key, localPort: _port, localRunning: _running, ...rest }) => rest,
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
