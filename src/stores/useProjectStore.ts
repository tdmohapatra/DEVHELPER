import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ProjectProfile {
  id: string;
  name: string;
  technologies: string[];
  notes: string;
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(performance.now()));

interface ProjectState {
  profiles: ProjectProfile[];
  activeId: string | null;
  upsert: (p: Omit<ProjectProfile, "id"> & { id?: string }) => string;
  remove: (id: string) => void;
  setActive: (id: string | null) => void;
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set) => ({
      profiles: [],
      activeId: null,
      upsert: (p) => {
        const id = p.id ?? uid();
        const record: ProjectProfile = { id, name: p.name, technologies: p.technologies, notes: p.notes };
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
    }),
    { name: "devhelper-projects" },
  ),
);
