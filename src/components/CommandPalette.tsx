import { useEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Search, Star, History, CornerDownLeft } from "lucide-react";
import { searchTools, getTool } from "@/tools/registry";
import { useAppStore } from "@/stores/useAppStore";
import { generateGuids } from "@/tools/lib/guid";
import { copyToClipboard } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

interface Command {
  id: string;
  name: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  shortcut?: string;
  isFavorite?: boolean;
  isRecent?: boolean;
  run: () => void;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const openTool = useAppStore((s) => s.openTool);
  const favorites = useAppStore((s) => s.favorites);
  const recent = useAppStore((s) => s.recent);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      // Focus after paint.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const q = query.trim().toLowerCase();

    // Direct actions triggered by intent.
    const actions: Command[] = [];
    if (/(gen|new|create).*guid|guid|uuid/.test(q)) {
      actions.push({
        id: "action-guid",
        name: "Generate a GUID → clipboard",
        description: "Create one UUID v4 and copy it",
        icon: Star,
        run: async () => {
          const [g] = generateGuids({ count: 1, uppercase: false, hyphens: true, braces: false });
          await copyToClipboard(g);
          toast.success(`Copied ${g}`);
          onClose();
        },
      });
    }

    const toolCommands: Command[] = searchTools(query).map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      icon: t.icon,
      shortcut: t.shortcut,
      isFavorite: favorites.includes(t.id),
      isRecent: recent.includes(t.id),
      run: () => {
        openTool(t.id);
        onClose();
      },
    }));

    // When query is empty, surface favorites and recents first.
    if (!q) {
      const favTools = favorites.map(getTool).filter(Boolean).map((t) => t!.id);
      const priority = [...new Set([...recent, ...favTools])];
      toolCommands.sort((a, b) => {
        const ai = priority.indexOf(a.id);
        const bi = priority.indexOf(b.id);
        if (ai === -1 && bi === -1) return 0;
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });
    }

    return [...actions, ...toolCommands];
  }, [query, favorites, recent, openTool, onClose]);

  useEffect(() => setActive(0), [query]);

  if (!open) return null;

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, commands.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commands[active]?.run();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[12vh] animate-fade-in" onClick={onClose}>
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border border-border bg-card shadow-2xl animate-slide-up"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search className="size-4 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tools and actions…"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">Esc</kbd>
        </div>
        <ul className="max-h-80 overflow-y-auto p-2">
          {commands.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted-foreground">No results for “{query}”.</li>}
          {commands.map((c, i) => {
            const Icon = c.icon;
            return (
              <li key={c.id}>
                <button
                  onMouseEnter={() => setActive(i)}
                  onClick={c.run}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left",
                    i === active ? "bg-primary/15" : "hover:bg-secondary",
                  )}
                >
                  <Icon className={cn("size-4 shrink-0", i === active ? "text-primary" : "text-muted-foreground")} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-sm">
                      <span className="truncate">{c.name}</span>
                      {c.isFavorite && <Star className="size-3 fill-warning text-warning" />}
                      {c.isRecent && !c.isFavorite && <History className="size-3 text-muted-foreground" />}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{c.description}</div>
                  </div>
                  {c.shortcut && <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">{c.shortcut}</kbd>}
                  {i === active && <CornerDownLeft className="size-3.5 text-muted-foreground" />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
