import { create } from "zustand";
import { persist } from "zustand/middleware";
import { toggleMember, type ScopeKind, type ScopeMembers } from "@/lib/projectScope";

export interface ProjectProfile {
  id: string;
  name: string;
  technologies: string[];
  notes: string;
  /**
   * Artefacts this project claims, per kind. Optional and backward compatible —
   * a profile saved before scoping existed claims nothing, which means every
   * list stays exactly as it was.
   */
  members?: ScopeMembers;
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(performance.now()));

interface ProjectState {
  profiles: ProjectProfile[];
  activeId: string | null;
  /** Whether lists elsewhere are filtered to the active project. Off by default. */
  scopeEnabled: boolean;
  upsert: (p: Omit<ProjectProfile, "id"> & { id?: string }) => string;
  remove: (id: string) => void;
  setActive: (id: string | null) => void;
  setScopeEnabled: (on: boolean) => void;
  /** Claim or release one artefact for a project. */
  toggleMember: (projectId: string, kind: ScopeKind, itemId: string) => void;
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set) => ({
      profiles: [],
      activeId: null,
      scopeEnabled: false,
      upsert: (p) => {
        const id = p.id ?? uid();
        const record: ProjectProfile = {
          id,
          name: p.name,
          technologies: p.technologies,
          notes: p.notes,
          // Editing a profile must not silently drop what it claims.
          members: p.members,
        };
        set((state) => {
          const exists = state.profiles.some((x) => x.id === id);
          return {
            profiles: exists ? state.profiles.map((x) => (x.id === id ? record : x)) : [...state.profiles, record],
            activeId: state.activeId ?? id,
          };
        });
        return id;
      },
      remove: (id) => set((state) => ({ profiles: state.profiles.filter((p) => p.id !== id), activeId: state.activeId === id ? null : state.activeId })),
      setActive: (id) => set({ activeId: id }),
      setScopeEnabled: (on) => set({ scopeEnabled: on }),
      toggleMember: (projectId, kind, itemId) =>
        set((state) => ({
          profiles: state.profiles.map((p) =>
            p.id === projectId ? { ...p, members: toggleMember(p, kind, itemId) } : p,
          ),
        })),
    }),
    { name: "devhelper-projects" },
  ),
);
