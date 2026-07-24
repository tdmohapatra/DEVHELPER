import type { ReactNode } from "react";
import { Wrench, Star, History, Settings } from "lucide-react";
import { CATEGORIES } from "@/tools/types";
import { CATEGORY_ICONS } from "@/tools/categoryIcons";
import { CATEGORY_COLORS } from "@/tools/categoryColors";
import { toolsByCategory } from "@/tools/registry";
import { useAppStore, type View } from "@/stores/useAppStore";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const view = useAppStore((s) => s.view);
  const openView = useAppStore((s) => s.openView);
  const openTool = useAppStore((s) => s.openTool);
  const favorites = useAppStore((s) => s.favorites);

  const isView = (v: View["kind"]) => view.kind === v;

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-card/40">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
          <Wrench className="size-4" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-tight">DevHelper</div>
          <div className="text-[11px] text-muted-foreground">Your Everyday Toolbox</div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        <NavItem active={isView("dashboard")} onClick={() => openView({ kind: "dashboard" })} icon={<CATEGORY_ICONS.quick className="size-4" />} label="Dashboard" />

        <div className="mt-3 space-y-0.5">
          {CATEGORIES.map((cat) => {
            const tools = toolsByCategory(cat.id);
            if (tools.length === 0) return null;
            const Icon = CATEGORY_ICONS[cat.id];
            const color = CATEGORY_COLORS[cat.id];
            return (
              <div key={cat.id} className="mb-2">
                <div className="flex items-center gap-2 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <Icon className={cn("size-3.5", color.text)} />
                  {cat.label}
                </div>
                {tools.map((t) => (
                  <NavItem
                    key={t.id}
                    active={view.kind === "tool" && view.toolId === t.id}
                    onClick={() => openTool(t.id)}
                    icon={<t.icon className="size-4" />}
                    label={t.name}
                    color={color}
                    indent
                  />
                ))}
              </div>
            );
          })}
        </div>
      </nav>

      <div className="border-t border-border px-2 py-2">
        <NavItem active={isView("favorites")} onClick={() => openView({ kind: "favorites" })} icon={<Star className="size-4" />} label="Favorites" badge={favorites.length || undefined} />
        <NavItem active={isView("recent")} onClick={() => openView({ kind: "recent" })} icon={<History className="size-4" />} label="Recent" />
        <NavItem active={isView("settings")} onClick={() => openView({ kind: "settings" })} icon={<Settings className="size-4" />} label="Settings" />
      </div>
    </aside>
  );
}

function NavItem({
  active,
  onClick,
  icon,
  label,
  indent,
  badge,
  color,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  indent?: boolean;
  badge?: number;
  color?: { text: string; bg: string };
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
        indent && "pl-4",
        active
          ? cn(color ? color.bg : "bg-primary/15", color ? color.text : "text-primary", "font-medium")
          : "text-foreground/70 hover:bg-secondary hover:text-foreground",
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
      {badge !== undefined && (
        <span className="ml-auto rounded-full bg-secondary px-1.5 text-[10px] text-muted-foreground">{badge}</span>
      )}
    </button>
  );
}
