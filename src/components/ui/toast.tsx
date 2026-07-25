import { create } from "zustand";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { playSound } from "@/lib/sound";

type ToastKind = "success" | "error" | "info";
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastStore {
  toasts: Toast[];
  push: (kind: ToastKind, message: string) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  push: (kind, message) => {
    const id = nextId++;
    if (kind === "success" || kind === "error") playSound(kind);
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 2600);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Imperative API: `toast.success("Copied")`. */
export const toast = {
  success: (m: string) => useToastStore.getState().push("success", m),
  error: (m: string) => useToastStore.getState().push("error", m),
  info: (m: string) => useToastStore.getState().push("info", m),
};

const icons = { success: CheckCircle2, error: AlertCircle, info: Info };

export function Toaster() {
  const { toasts, dismiss } = useToastStore();
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      {toasts.map((t) => {
        const Icon = icons[t.kind];
        return (
          <div
            key={t.id}
            className={cn(
              "flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm shadow-lg animate-slide-up",
              t.kind === "success" && "border-success/40",
              t.kind === "error" && "border-destructive/40",
              t.kind === "info" && "border-border",
            )}
          >
            <Icon
              className={cn(
                "size-4 shrink-0",
                t.kind === "success" && "text-success",
                t.kind === "error" && "text-destructive",
                t.kind === "info" && "text-muted-foreground",
              )}
            />
            <span className="max-w-xs">{t.message}</span>
            <button onClick={() => dismiss(t.id)} className="ml-1 text-muted-foreground hover:text-foreground">
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
