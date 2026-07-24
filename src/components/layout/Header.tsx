import { Search, Moon, Sun, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/stores/useAppStore";

export function Header({ onOpenPalette }: { onOpenPalette: () => void }) {
  const theme = useAppStore((s) => s.theme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const openView = useAppStore((s) => s.openView);

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
      <button
        onClick={onOpenPalette}
        className="flex h-9 max-w-md flex-1 items-center gap-2 rounded-md border border-border bg-secondary/50 px-3 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:bg-secondary hover:text-foreground"
      >
        <Search className="size-4" />
        <span>Search tools…</span>
        <kbd className="ml-auto rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium">Ctrl K</kbd>
      </button>
      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="icon" title="Toggle theme" onClick={toggleTheme}>
          {theme === "dark" ? <Sun /> : <Moon />}
        </Button>
        <Button variant="ghost" size="icon" title="Settings" onClick={() => openView({ kind: "settings" })}>
          <Settings />
        </Button>
      </div>
    </header>
  );
}
