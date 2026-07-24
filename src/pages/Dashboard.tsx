import type { ReactNode } from "react";
import { Sparkles, Star, History } from "lucide-react";
import { TOOLS, getTool } from "@/tools/registry";
import { ToolCard } from "@/components/ToolCard";
import { useAppStore } from "@/stores/useAppStore";
import type { Tool } from "@/tools/types";

function Section({ icon, title, tools, empty }: { icon: ReactNode; title: string; tools: Tool[]; empty?: string }) {
  if (tools.length === 0 && empty === undefined) return null;
  return (
    <section className="mb-8">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
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

export function Dashboard() {
  const favorites = useAppStore((s) => s.favorites);
  const recent = useAppStore((s) => s.recent);

  const favTools = favorites.map(getTool).filter(Boolean) as Tool[];
  const recentTools = recent.map(getTool).filter(Boolean) as Tool[];
  const quickTools = TOOLS.filter((t) => t.category === "quick");

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold">Welcome to DevHelper</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your everyday developer toolbox. Press <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px]">Ctrl K</kbd> to search any tool.
        </p>
      </div>

      <Section icon={<Star className="size-4" />} title="Favorites" tools={favTools} empty="Star a tool to pin it here." />
      <Section icon={<History className="size-4" />} title="Recently used" tools={recentTools.slice(0, 8)} />
      <Section icon={<Sparkles className="size-4" />} title="Quick tools" tools={quickTools} />
    </div>
  );
}
