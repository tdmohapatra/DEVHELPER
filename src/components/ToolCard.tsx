import { Star } from "lucide-react";
import type { Tool } from "@/tools/types";
import { CATEGORY_COLORS } from "@/tools/categoryColors";
import { useAppStore } from "@/stores/useAppStore";
import { cn } from "@/lib/utils";

export function ToolCard({ tool }: { tool: Tool }) {
  const openTool = useAppStore((s) => s.openTool);
  const isFavorite = useAppStore((s) => s.favorites.includes(tool.id));
  const toggleFavorite = useAppStore((s) => s.toggleFavorite);
  const Icon = tool.icon;
  const color = CATEGORY_COLORS[tool.category];

  return (
    <button
      onClick={() => openTool(tool.id)}
      className={cn(
        "group relative flex flex-col items-start gap-2 rounded-lg border border-border bg-card p-4 text-left transition-all duration-150 ease-premium hover:-translate-y-0.5 hover:shadow-premium",
        color.hoverBorder,
      )}
    >
      <div className="flex w-full items-center justify-between">
        <div className={cn("flex size-9 items-center justify-center rounded-md", color.bg, color.text)}>
          <Icon className="size-5" />
        </div>
        <span
          role="button"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            toggleFavorite(tool.id);
          }}
          className={cn(
            "opacity-0 transition-opacity group-hover:opacity-100",
            isFavorite && "opacity-100",
          )}
        >
          <Star className={cn("size-4", isFavorite ? "fill-warning text-warning" : "text-muted-foreground")} />
        </span>
      </div>
      <div className="text-sm font-medium tracking-tight">{tool.name}</div>
      <div className="line-clamp-2 text-xs text-muted-foreground">{tool.description}</div>
      {tool.shortcut && (
        <kbd className="mt-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">{tool.shortcut}</kbd>
      )}
    </button>
  );
}
