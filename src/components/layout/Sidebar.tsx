import type { ReactNode } from "react";
import { Wrench, Star, History, Settings, PanelLeftClose, PanelLeftOpen } from "lucide-react";
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
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);

  const isView = (v: View["kind"]) => view.kind === v;

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col border-r border-border bg-card/40 transition-[width] duration-200 ease-premium",
        collapsed ? "w-16" : "w-64",
      )}
    >
      <div className={cn("flex items-center gap-2.5 px-3 py-4", collapsed && "justify-center px-0")}>
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
          <Wrench className="size-4" />
        </div>
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-semibold tracking-tight">DevHelper</div>
            <div className="truncate text-[11px] text-muted-foreground">Command Centre</div>
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 pb-4">
        <NavItem collapsed={collapsed} active={isView("dashboard")} onClick={() => openView({ kind: "dashboard" })} icon={<CATEGORY_ICONS.quick className="size-4" />} label="Dashboard" />

        <div className="mt-3 space-y-0.5">
          {CATEGORIES.map((cat) => {
            const tools = toolsByCategory(cat.id);
            if (tools.length === 0) return null;
            const Icon = CATEGORY_ICONS[cat.id];
            const color = CATEGORY_COLORS[cat.id];
            return (
              <div key={cat.id} className="mb-2">
                {collapsed ? (
                  <div className="my-1 flex justify-center" title={cat.label}>
                    <Icon className={cn("size-3.5", color.text)} />
                  </div>
                ) : (
                  <div className="flex items-center gap-2 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <Icon className={cn("size-3.5", color.text)} />
                    {cat.label}
                  </div>
                )}
                {tools.map((t) => (
                  <NavItem
                    key={t.id}
                    collapsed={collapsed}
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
        <NavItem collapsed={collapsed} active={isView("favorites")} onClick={() => openView({ kind: "favorites" })} icon={<Star className="size-4" />} label="Favorites" badge={favorites.length || undefined} />
        <NavItem collapsed={collapsed} active={isView("recent")} onClick={() => openView({ kind: "recent" })} icon={<History className="size-4" />} label="Recent" />
        <NavItem collapsed={collapsed} active={isView("settings")} onClick={() => openView({ kind: "settings" })} icon={<Settings className="size-4" />} label="Settings" />
        <button
          onClick={toggleSidebar}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
            collapsed && "justify-center",
          )}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <><PanelLeftClose className="size-4" /> Collapse</>}
        </button>
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
  collapsed,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  indent?: boolean;
  badge?: number;
  color?: { text: string; bg: string };
  collapsed?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={collapsed ? label : undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors duration-150",
        collapsed ? "justify-center" : indent && "pl-4",
        active
          ? cn(color ? color.bg : "bg-primary/15", color ? color.text : "text-primary", "font-medium")
          : "text-foreground/70 hover:bg-secondary hover:text-foreground",
      )}
    >
      {/* Active accent bar */}
      {active && !collapsed && <span className={cn("absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full", color ? color.text.replace("text-", "bg-") : "bg-primary")} />}
      <span className="shrink-0">{icon}</span>
      {!collapsed && <span className="truncate">{label}</span>}
      {!collapsed && badge !== undefined && (
        <span className="ml-auto rounded-full bg-secondary px-1.5 text-[10px] text-muted-foreground">{badge}</span>
      )}
    </button>
  );
}
