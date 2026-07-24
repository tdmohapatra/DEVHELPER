import { Star, History } from "lucide-react";
import { getTool } from "@/tools/registry";
import { ToolCard } from "@/components/ToolCard";
import { useAppStore } from "@/stores/useAppStore";
import type { Tool } from "@/tools/types";

/** Shared page for the Favorites and Recent views. */
export function ToolList({ mode }: { mode: "favorites" | "recent" }) {
  const favorites = useAppStore((s) => s.favorites);
  const recent = useAppStore((s) => s.recent);
  const ids = mode === "favorites" ? favorites : recent;
  const tools = ids.map(getTool).filter(Boolean) as Tool[];

  const Icon = mode === "favorites" ? Star : History;
  const title = mode === "favorites" ? "Favorites" : "Recently used";
  const empty = mode === "favorites" ? "You have not starred any tools yet." : "Tools you open will appear here.";

  return (
    <div className="mx-auto max-w-6xl p-6">
      <h1 className="mb-6 flex items-center gap-2 text-2xl font-semibold">
        <Icon className="size-6" /> {title}
      </h1>
      {tools.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {tools.map((t) => (
            <ToolCard key={t.id} tool={t} />
          ))}
        </div>
      )}
    </div>
  );
}
