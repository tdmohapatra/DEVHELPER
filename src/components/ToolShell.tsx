import type { ReactNode } from "react";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/useAppStore";

interface ToolShellProps {
  toolId: string;
  title: string;
  description: string;
  requiresNative?: boolean;
  children: ReactNode;
  /** Optional toolbar rendered on the right of the header. */
  actions?: ReactNode;
}

/** Consistent header + scrollable body for every tool screen. */
export function ToolShell({ toolId, title, description, requiresNative, children, actions }: ToolShellProps) {
  const isFavorite = useAppStore((s) => s.favorites.includes(toolId));
  const toggleFavorite = useAppStore((s) => s.toggleFavorite);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-start justify-between gap-4 border-b border-border bg-background/70 px-6 py-4 backdrop-blur">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-lg font-semibold tracking-tight">{title}</h1>
            {requiresNative && <Badge variant="warning">Desktop only</Badge>}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          <Button
            variant="ghost"
            size="icon"
            title={isFavorite ? "Remove from favorites" : "Add to favorites"}
            aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
            aria-pressed={isFavorite}
            onClick={() => toggleFavorite(toolId)}
          >
            <Star className={cn("transition-colors", isFavorite && "fill-warning text-warning")} />
          </Button>
        </div>
      </header>
      <div className="flex-1 overflow-auto p-6">{children}</div>
    </div>
  );
}
