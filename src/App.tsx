import { Suspense, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { CommandPalette } from "@/components/CommandPalette";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { LogDock } from "@/components/LogDock";
import { log, setLogContext } from "@/lib/logBus";
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

  // Allow any component (e.g. the Home CTA) to open the palette via a DOM event.
  useEffect(() => {
    const open = () => setPaletteOpen(true);
    window.addEventListener("devhelper:open-palette", open);
    return () => window.removeEventListener("devhelper:open-palette", open);
  }, []);

  // Nothing else catches these, and a tool that dies silently is the worst case to debug.
  useEffect(() => {
    const onError = (e: ErrorEvent) => log.error("app", e.message, e.error?.stack ?? `${e.filename}:${e.lineno}`);
    const onRejection = (e: PromiseRejectionEvent) =>
      log.error("app", `Unhandled rejection: ${e.reason instanceof Error ? e.reason.message : String(e.reason)}`,
        e.reason instanceof Error ? e.reason.stack : undefined);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl+` → activity log dock.
      if (e.ctrlKey && (e.key === "`" || e.code === "Backquote")) {
        e.preventDefault();
        useAppStore.getState().toggleLogDock();
        return;
      }
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

  const view = useAppStore((s) => s.view);
  const viewKey = view.kind === "tool" ? `tool:${view.toolId}` : view.kind;

  // Tag every subsequent log entry with the screen it came from.
  useEffect(() => {
    setLogContext(view.kind === "tool" ? view.toolId : undefined);
  }, [view]);

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
            <ErrorBoundary key={viewKey} onHome={() => openView({ kind: "dashboard" })}>
              <div className="h-full animate-fade-in">
                <Content />
              </div>
            </ErrorBoundary>
          </Suspense>
        </main>
        <LogDock />
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <Toaster />
    </div>
  );
}
