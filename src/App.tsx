import { Suspense, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { CommandPalette } from "@/components/CommandPalette";
import { Toaster } from "@/components/ui/toast";
import { Dashboard } from "@/pages/Dashboard";
import { ToolList } from "@/pages/ToolList";
import { Settings } from "@/pages/Settings";
import { useAppStore, viewFromHash } from "@/stores/useAppStore";
import { getTool, TOOLS } from "@/tools/registry";

/** Map of "Ctrl+Shift+X" shortcut strings to tool ids for global hotkeys. */
const SHORTCUTS = new Map(TOOLS.filter((t) => t.shortcut).map((t) => [t.shortcut!, t.id]));

function Content() {
  const view = useAppStore((s) => s.view);
  switch (view.kind) {
    case "dashboard":
      return <Dashboard />;
    case "favorites":
      return <ToolList mode="favorites" />;
    case "recent":
      return <ToolList mode="recent" />;
    case "settings":
      return <Settings />;
    case "tool": {
      const tool = getTool(view.toolId);
      if (!tool) return <Dashboard />;
      const Component = tool.component;
      return <Component />;
    }
  }
}

export default function App() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const openTool = useAppStore((s) => s.openTool);
  const openView = useAppStore((s) => s.openView);

  // Deep-linking: honour the URL hash on load and on manual hash changes.
  useEffect(() => {
    const apply = () => {
      const v = viewFromHash();
      if (v) v.kind === "tool" ? openTool(v.toolId) : openView(v);
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [openTool, openView]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl+K or Ctrl+Space → command palette.
      if (e.ctrlKey && (e.key === "k" || e.code === "Space")) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      // Ctrl+Shift+<letter> → tool shortcuts.
      if (e.ctrlKey && e.shiftKey && e.key.length === 1) {
        const combo = `Ctrl+Shift+${e.key.toUpperCase()}`;
        const toolId = SHORTCUTS.get(combo);
        if (toolId) {
          e.preventDefault();
          openTool(toolId);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openTool]);

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header onOpenPalette={() => setPaletteOpen(true)} />
        <main className="min-h-0 flex-1 overflow-hidden">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <Loader2 className="size-5 animate-spin" />
              </div>
            }
          >
            <Content />
          </Suspense>
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <Toaster />
    </div>
  );
}
