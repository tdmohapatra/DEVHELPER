import type { ReactNode } from "react";
import { Sparkles, Star, History, Search, ArrowRight } from "lucide-react";
import { TOOLS, getTool } from "@/tools/registry";
import { ToolCard } from "@/components/ToolCard";
import { useAppStore } from "@/stores/useAppStore";
import type { Tool } from "@/tools/types";

function Section({ icon, title, tools, empty }: { icon: ReactNode; title: string; tools: Tool[]; empty?: string }) {
  if (tools.length === 0 && empty === undefined) return null;
  return (
    <section className="mb-9">
      <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {icon} {title}
      </h2>
      {tools.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {tools.map((t) => (
            <ToolCard key={t.id} tool={t} />
          ))}
        </div>
      )}
    </section>
  );
}

const openPalette = () => window.dispatchEvent(new CustomEvent("devhelper:open-palette"));

export function Dashboard() {
  const favorites = useAppStore((s) => s.favorites);
  const recent = useAppStore((s) => s.recent);
  const openTool = useAppStore((s) => s.openTool);

  const favTools = favorites.map(getTool).filter(Boolean) as Tool[];
  const recentTools = recent.map(getTool).filter(Boolean) as Tool[];
  const quickTools = TOOLS.filter((t) => t.category === "quick");

  // A few high-value shortcuts surfaced on the home screen.
  const jumps = ["json-formatter", "api-tester", "database-toolkit", "debug-session", "jwt-decoder", "command-cheatsheet"]
    .map(getTool)
    .filter(Boolean) as Tool[];

  return (
    <div className="h-full overflow-y-auto">
      {/* Hero */}
      <div className="relative border-b border-border">
        <div className="pointer-events-none absolute inset-0 bg-grid opacity-60" aria-hidden />
        <div className="relative mx-auto max-w-6xl px-6 pb-8 pt-10">
          <h1 className="text-2xl font-semibold tracking-tight">Developer Command Centre</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Everything for your daily workflow — search, run, inspect, debug.</p>

          <button
            onClick={openPalette}
            className="group mt-5 flex w-full max-w-xl items-center gap-3 rounded-xl border border-border bg-card/60 px-4 py-3 text-left shadow-premium transition-all duration-150 hover:border-primary/40 hover:bg-card"
          >
            <Search className="size-4 text-muted-foreground transition-colors group-hover:text-primary" />
            <span className="text-sm text-muted-foreground">Search {TOOLS.length} tools &amp; actions…</span>
            <kbd className="ml-auto rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Ctrl K</kbd>
          </button>

          <div className="mt-4 flex flex-wrap gap-1.5">
            {jumps.map((t) => (
              <button
                key={t.id}
                onClick={() => openTool(t.id)}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/40 px-3 py-1 text-xs text-foreground/80 transition-colors hover:border-primary/40 hover:text-foreground"
              >
                <t.icon className="size-3.5" /> {t.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Sections */}
      <div className="mx-auto max-w-6xl px-6 py-8">
        <Section icon={<Star className="size-4" />} title="Favorites" tools={favTools} empty="Star a tool to pin it here." />
        <Section icon={<History className="size-4" />} title="Recently used" tools={recentTools.slice(0, 8)} />
        <Section icon={<Sparkles className="size-4" />} title="Quick tools" tools={quickTools} />

        <button onClick={openPalette} className="group flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
          Browse all {TOOLS.length} tools <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>
    </div>
  );
}
