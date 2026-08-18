import { create } from "zustand";
import { persist } from "zustand/middleware";
import { aiAccount, deleteSecret, getSecret, setSecret } from "@/lib/secrets";

import { DEFAULT_HUB_DIR } from "@/tools/lib/localLlm";
import { resolveProvider, switchesForProvider, type LocalKind } from "@/lib/aiRouting";

/**
 * `local` is a GGUF file on this machine, served by a llama.cpp process
 * DevHelper starts. `ollama` is another program already serving one. They are
 * separate providers because the difference the user cares about — who is
 * responsible for the server being up — is exactly the difference between them.
 */
export type AiProvider = "ollama" | "openai" | "local";

interface AiState {
  /**
   * Where prompts go. Derived from the two switches below — set those, not this.
   * It stays a plain field because every consumer (`lib/ai.ts`, the PHI gateway)
   * only ever needs the answer, not how it was reached.
   */
  provider: AiProvider;

  /** Local AI switched on: an offline model file, or Ollama. */
  localEnabled: boolean;
  /** Online AI switched on: a hosted OpenAI-compatible API. */
  onlineEnabled: boolean;
  /** Which kind of local, when Local AI is on. */
  localKind: LocalKind;
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
  /** Flip the switches. Recomputes `provider` so the two cannot disagree. */
  setSwitches: (patch: { localEnabled?: boolean; onlineEnabled?: boolean; localKind?: LocalKind }) => void;
  isConfigured: () => boolean;
}

export const useAiStore = create<AiState>()(
  persist(
    (set, get) => ({
      provider: "local",
      localEnabled: true,
      onlineEnabled: false,
      localKind: "local",
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
      setSwitches: (patch) => {
        const next = { ...get(), ...patch };
        const provider = resolveProvider(next);
        // Both off leaves `provider` at its last value; `isConfigured` is what
        // reports "off", so nothing downstream has to handle a null provider.
        set({ ...patch, ...(provider ? { provider } : {}) });
      },
      isConfigured: () => {
        const s = get();
        // Both switches off is a supported state: AI is simply not in use.
        if (!s.localEnabled && !s.onlineEnabled) return false;
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
      /**
       * Version 1 introduced the switches. A setting saved before them has only
       * a provider, and inferring the switches from it is what keeps an upgrade
       * from silently moving someone's prompts to a different destination.
       */
      version: 1,
      migrate: (persisted, from) => {
        const state = (persisted ?? {}) as Partial<AiState>;
        if (from >= 1 || state.localEnabled !== undefined) return state as AiState;
        return { ...state, ...switchesForProvider(state.provider ?? "ollama") } as AiState;
      },
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
