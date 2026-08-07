import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ApiRequest, ApiFolder, Environment } from "@/tools/lib/apiTypes";
import { resolveVariables } from "@/tools/lib/envResolve";

export interface HistoryEntry {
  id: string;
  method: string;
  url: string;
  status: number;
  timeMs: number;
  at: number;
}

const HISTORY_LIMIT = 30;

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.floor(performance.now())));

interface ApiState {
  requests: Record<string, ApiRequest>;
  folders: ApiFolder[];
  environments: Environment[];
  activeEnvId: string | null;
  history: HistoryEntry[];

  saveRequest: (req: ApiRequest) => void;
  deleteRequest: (id: string) => void;
  addFolder: (name: string) => string;
  renameFolder: (id: string, name: string) => void;
  deleteFolder: (id: string) => void;
  assignRequestToFolder: (requestId: string, folderId: string | null) => void;

  addEnvironment: (name: string, isProduction: boolean) => string;
  updateEnvironment: (env: Environment) => void;
  deleteEnvironment: (id: string) => void;
  /** Replace the whole set — used by import, which decides the merge itself. */
  setEnvironments: (envs: Environment[]) => void;
  setActiveEnv: (id: string | null) => void;

  pushHistory: (e: Omit<HistoryEntry, "id" | "at">) => void;
  activeVars: () => Record<string, string>;
  activeEnv: () => Environment | undefined;
}

export const useApiStore = create<ApiState>()(
  persist(
    (set, get) => ({
      requests: {},
      folders: [],
      environments: [],
      activeEnvId: null,
      history: [],

      saveRequest: (req) => set((s) => ({ requests: { ...s.requests, [req.id]: req } })),
      deleteRequest: (id) =>
        set((s) => {
          const { [id]: _, ...rest } = s.requests;
          return {
            requests: rest,
            folders: s.folders.map((f) => ({ ...f, requestIds: f.requestIds.filter((r) => r !== id) })),
          };
        }),

      addFolder: (name) => {
        const id = uid();
        set((s) => ({ folders: [...s.folders, { id, name, requestIds: [] }] }));
        return id;
      },
      renameFolder: (id, name) => set((s) => ({ folders: s.folders.map((f) => (f.id === id ? { ...f, name } : f)) })),
      deleteFolder: (id) => set((s) => ({ folders: s.folders.filter((f) => f.id !== id) })),
      assignRequestToFolder: (requestId, folderId) =>
        set((s) => ({
          folders: s.folders.map((f) => ({
            ...f,
            requestIds:
              f.id === folderId
                ? [...new Set([...f.requestIds, requestId])]
                : f.requestIds.filter((r) => r !== requestId),
          })),
        })),

      addEnvironment: (name, isProduction) => {
        const id = uid();
        const env: Environment = { id, name, isProduction, variables: [] };
        set((s) => ({ environments: [...s.environments, env], activeEnvId: s.activeEnvId ?? id }));
        return id;
      },
      updateEnvironment: (env) => set((s) => ({ environments: s.environments.map((e) => (e.id === env.id ? env : e)) })),
      deleteEnvironment: (id) =>
        set((s) => ({
          // Children of a deleted parent are detached rather than left pointing
          // at a ghost, so what they resolve to is what the editor shows.
          environments: s.environments
            .filter((e) => e.id !== id)
            .map((e) => (e.extendsId === id ? { ...e, extendsId: undefined } : e)),
          activeEnvId: s.activeEnvId === id ? null : s.activeEnvId,
        })),
      setEnvironments: (envs) =>
        set((s) => ({
          environments: envs,
          activeEnvId: envs.some((e) => e.id === s.activeEnvId) ? s.activeEnvId : (envs[0]?.id ?? null),
        })),
      setActiveEnv: (id) => set({ activeEnvId: id }),

      pushHistory: (e) =>
        set((s) => ({
          history: [{ ...e, id: uid(), at: Date.now() }, ...s.history].slice(0, HISTORY_LIMIT),
        })),

      activeEnv: () => get().environments.find((e) => e.id === get().activeEnvId),
      // Resolved through the inheritance chain, so a child that only overrides
      // one value still sends everything its base defines.
      activeVars: () => {
        const { environments, activeEnvId } = get();
        const env = environments.find((e) => e.id === activeEnvId);
        return env ? resolveVariables(env, environments) : {};
      },
    }),
    { name: "devhelper-api" },
  ),
);
