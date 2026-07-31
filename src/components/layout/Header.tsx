import { useEffect, useState } from "react";
import { Search, Moon, Sun, Settings, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/stores/useAppStore";
import { getLogs, subscribeLogs } from "@/lib/logBus";
import { cn } from "@/lib/utils";

export function Header({ onOpenPalette }: { onOpenPalette: () => void }) {
  const theme = useAppStore((s) => s.theme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const openView = useAppStore((s) => s.openView);
  const logDock = useAppStore((s) => s.logDock);
  const setLogDock = useAppStore((s) => s.setLogDock);

  // Badge the button so a failure is visible even with the dock hidden.
  const [errors, setErrors] = useState(() => getLogs().filter((e) => e.level === "error").length);
  useEffect(() => subscribeLogs((list) => setErrors(list.filter((e) => e.level === "error").length)), []);

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur">
      <button
        onClick={onOpenPalette}
        aria-label="Open command palette"
        className="group flex h-9 max-w-md flex-1 items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3 text-sm text-muted-foreground transition-all duration-150 hover:border-primary/40 hover:bg-secondary hover:text-foreground focus-visible:border-primary/40"
      >
        <Search className="size-4 transition-colors group-hover:text-primary" />
        <span>Search tools &amp; actions…</span>
        <kbd className="ml-auto rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Ctrl K</kbd>
      </button>
      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          title="Activity log (Ctrl+`)"
          aria-label="Toggle the activity log"
          aria-pressed={logDock === "open"}
          onClick={() => setLogDock(logDock === "open" ? "hidden" : "open")}
        >
          <Terminal className={cn(logDock === "open" && "text-primary")} />
          {errors > 0 && (
            <span className="absolute right-1 top-1 size-1.5 rounded-full bg-destructive" aria-hidden />
          )}
        </Button>
        <Button variant="ghost" size="icon" title="Toggle theme" aria-label="Toggle theme" onClick={toggleTheme}>
          {theme === "dark" ? <Sun /> : <Moon />}
        </Button>
        <Button variant="ghost" size="icon" title="Settings" aria-label="Settings" onClick={() => openView({ kind: "settings" })}>
          <Settings />
        </Button>
      </div>
    </header>
  );
}
