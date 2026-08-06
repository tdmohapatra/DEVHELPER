import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Wrench, Star, History, Settings, PanelLeftClose, PanelLeftOpen, ChevronRight, Search, X } from "lucide-react";
import { CATEGORIES } from "@/tools/types";
import { CATEGORY_ICONS } from "@/tools/categoryIcons";
import { CATEGORY_COLORS } from "@/tools/categoryColors";
import { toolsByCategory, TOOLS } from "@/tools/registry";
import { useAppStore, type View } from "@/stores/useAppStore";
import { cn } from "@/lib/utils";
import type { Tool } from "@/tools/types";

/**
 * Tool navigation.
 *
 * Two shapes. Expanded, categories are collapsed accordions so the list is a
 * screen of headings rather than fifty rows of scroll, and a filter box jumps
 * straight to a tool. Collapsed, it is a rail of category icons with a flyout —
 * a rail of fifty unlabelled tool icons, which is what it used to be, is not
 * something anyone can read.
 */
export function Sidebar() {
  const view = useAppStore((s) => s.view);
  const openView = useAppStore((s) => s.openView);
  const openTool = useAppStore((s) => s.openTool);
  const favorites = useAppStore((s) => s.favorites);
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const openGroups = useAppStore((s) => s.openGroups);
  const toggleGroup = useAppStore((s) => s.toggleGroup);
  const setGroupOpen = useAppStore((s) => s.setGroupOpen);

  const [filter, setFilter] = useState("");
  const isView = (v: View["kind"]) => view.kind === v;
  const activeToolId = view.kind === "tool" ? view.toolId : null;

  const groups = useMemo(
    () => CATEGORIES.map((cat) => ({ cat, tools: toolsByCategory(cat.id) })).filter((g) => g.tools.length > 0),
    [],
  );

  /** Open the group holding the current tool, so the selection is never hidden. */
  useEffect(() => {
    if (!activeToolId) return;
    const tool = TOOLS.find((t) => t.id === activeToolId);
    if (tool) setGroupOpen(tool.category, true);
  }, [activeToolId, setGroupOpen]);

  const matches = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return null;
    const terms = q.split(/\s+/);
    return TOOLS.filter((t) => {
      const hay = `${t.name} ${t.description} ${t.keywords.join(" ")}`.toLowerCase();
      return terms.every((term) => hay.includes(term));
    });
  }, [filter]);

  if (collapsed) {
    return (
      <Rail
        groups={groups}
        activeToolId={activeToolId}
        onOpenTool={openTool}
        onExpand={toggleSidebar}
        onOpenView={openView}
        isView={isView}
      />
    );
  }

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-border bg-card/40">
      <div className="flex items-center gap-2 px-2 py-2">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Wrench className="size-3.5" />
        </div>
        <div className="min-w-0 truncate text-sm font-semibold tracking-tight">DevHelper</div>
        <button
          onClick={toggleSidebar}
          title="Collapse sidebar (Ctrl+B)"
          aria-label="Collapse sidebar"
          className="ml-auto rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <PanelLeftClose className="size-4" />
        </button>
      </div>

      <div className="px-2 pb-1.5">
        <div className="flex items-center gap-1.5 rounded-md border border-border bg-background/60 px-2">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter tools"
            aria-label="Filter tools"
            className="h-7 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
          {filter && (
            <button onClick={() => setFilter("")} aria-label="Clear filter" className="text-muted-foreground hover:text-foreground">
              <X className="size-3" />
            </button>
          )}
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-1.5 pb-2">
        {matches ? (
          <>
            <div className="px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {matches.length} match{matches.length === 1 ? "" : "es"}
            </div>
            {matches.map((t) => (
              <ToolRow key={t.id} tool={t} active={activeToolId === t.id} onClick={() => openTool(t.id)} showCategory />
            ))}
            {matches.length === 0 && <p className="px-1.5 py-2 text-xs text-muted-foreground">Nothing matches.</p>}
          </>
        ) : (
          <>
            <NavRow
              active={isView("dashboard")}
              onClick={() => openView({ kind: "dashboard" })}
              icon={<CATEGORY_ICONS.quick className="size-4" />}
              label="Dashboard"
            />
            <div className="mt-1">
              {groups.map(({ cat, tools }) => {
                const open = openGroups.includes(cat.id);
                const Icon = CATEGORY_ICONS[cat.id];
                const color = CATEGORY_COLORS[cat.id];
                const holdsActive = tools.some((t) => t.id === activeToolId);
                return (
                  <div key={cat.id}>
                    <button
                      onClick={() => toggleGroup(cat.id)}
                      aria-expanded={open}
                      className={cn(
                        "flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs transition-colors hover:bg-secondary/70",
                        holdsActive && !open ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      <ChevronRight className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")} />
                      <Icon className={cn("size-3.5 shrink-0", color.text)} />
                      <span className="truncate font-medium">{cat.label}</span>
                      {holdsActive && !open && <span className={cn("size-1.5 shrink-0 rounded-full", color.text.replace("text-", "bg-"))} />}
                      <span className="ml-auto shrink-0 text-[10px] opacity-60">{tools.length}</span>
                    </button>
                    {open &&
                      tools.map((t) => (
                        <ToolRow key={t.id} tool={t} active={activeToolId === t.id} onClick={() => openTool(t.id)} indent />
                      ))}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </nav>

      <div className="flex items-center gap-0.5 border-t border-border px-1.5 py-1">
        <IconRow active={isView("favorites")} onClick={() => openView({ kind: "favorites" })} title={`Favorites${favorites.length ? ` (${favorites.length})` : ""}`}>
          <Star className="size-4" />
          {favorites.length > 0 && <span className="text-[10px]">{favorites.length}</span>}
        </IconRow>
        <IconRow active={isView("recent")} onClick={() => openView({ kind: "recent" })} title="Recent">
          <History className="size-4" />
        </IconRow>
        <IconRow active={isView("settings")} onClick={() => openView({ kind: "settings" })} title="Settings">
          <Settings className="size-4" />
        </IconRow>
      </div>
    </aside>
  );
}

/**
 * The collapsed rail: one icon per category, with a flyout of its tools.
 *
 * The flyout is absolutely positioned outside the rail rather than widening it,
 * so opening one does not reflow the page.
 */
function Rail({ groups, activeToolId, onOpenTool, onExpand, onOpenView, isView }: {
  groups: { cat: (typeof CATEGORIES)[number]; tools: Tool[] }[];
  activeToolId: string | null;
  onOpenTool: (id: string) => void;
  onExpand: () => void;
  onOpenView: (v: View) => void;
  isView: (v: View["kind"]) => boolean;
}) {
  const [flyout, setFlyout] = useState<string | null>(null);
  const boxRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!flyout) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFlyout(null);
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setFlyout(null);
    };
    window.addEventListener("keydown", onKey);
    const t = setTimeout(() => window.addEventListener("mousedown", onDown), 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
      clearTimeout(t);
    };
  }, [flyout]);

  const openGroup = groups.find((g) => g.cat.id === flyout);

  return (
    <aside ref={boxRef} className="relative flex h-full w-12 shrink-0 flex-col items-center border-r border-border bg-card/40">
      <button
        onClick={onExpand}
        title="Expand sidebar (Ctrl+B)"
        aria-label="Expand sidebar"
        className="mt-2 rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        <PanelLeftOpen className="size-4" />
      </button>

      <button
        onClick={() => onOpenView({ kind: "dashboard" })}
        title="Dashboard"
        aria-label="Dashboard"
        className={cn(
          "mt-1 rounded p-1.5 hover:bg-secondary",
          isView("dashboard") ? "bg-primary/15 text-primary" : "text-foreground/70",
        )}
      >
        <CATEGORY_ICONS.quick className="size-4" />
      </button>

      <div className="mt-1 flex flex-1 flex-col items-center gap-0.5 overflow-y-auto py-1">
        {groups.map(({ cat, tools }) => {
          const Icon = CATEGORY_ICONS[cat.id];
          const color = CATEGORY_COLORS[cat.id];
          const holdsActive = tools.some((t) => t.id === activeToolId);
          return (
            <button
              key={cat.id}
              onClick={() => setFlyout(flyout === cat.id ? null : cat.id)}
              title={`${cat.label} (${tools.length})`}
              aria-label={cat.label}
              aria-expanded={flyout === cat.id}
              className={cn(
                "relative rounded p-1.5 hover:bg-secondary",
                flyout === cat.id && "bg-secondary",
                holdsActive ? color.text : "text-foreground/60",
              )}
            >
              <Icon className="size-4" />
              {holdsActive && <span className={cn("absolute right-0.5 top-0.5 size-1.5 rounded-full", color.text.replace("text-", "bg-"))} />}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col items-center gap-0.5 border-t border-border py-1">
        <button onClick={() => onOpenView({ kind: "favorites" })} title="Favorites" aria-label="Favorites" className={cn("rounded p-1.5 hover:bg-secondary", isView("favorites") ? "text-primary" : "text-muted-foreground")}>
          <Star className="size-4" />
        </button>
        <button onClick={() => onOpenView({ kind: "recent" })} title="Recent" aria-label="Recent" className={cn("rounded p-1.5 hover:bg-secondary", isView("recent") ? "text-primary" : "text-muted-foreground")}>
          <History className="size-4" />
        </button>
        <button onClick={() => onOpenView({ kind: "settings" })} title="Settings" aria-label="Settings" className={cn("rounded p-1.5 hover:bg-secondary", isView("settings") ? "text-primary" : "text-muted-foreground")}>
          <Settings className="size-4" />
        </button>
      </div>

      {openGroup && (
        <div className="absolute left-12 top-2 z-30 max-h-[80vh] w-52 overflow-y-auto rounded-md border border-border bg-card shadow-lg">
          <div className="border-b border-border px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {openGroup.cat.label}
          </div>
          {openGroup.tools.map((t) => (
            <button
              key={t.id}
              onClick={() => { onOpenTool(t.id); setFlyout(null); }}
              className={cn(
                "flex w-full items-center gap-2 px-2 py-1 text-left text-xs",
                activeToolId === t.id ? "bg-primary/15 text-primary" : "text-foreground/80 hover:bg-secondary",
              )}
            >
              <t.icon className="size-3.5 shrink-0" />
              <span className="truncate">{t.name}</span>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}

function ToolRow({ tool, active, onClick, indent, showCategory }: {
  tool: Tool;
  active: boolean;
  onClick: () => void;
  indent?: boolean;
  showCategory?: boolean;
}) {
  const color = CATEGORY_COLORS[tool.category];
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      title={tool.description}
      className={cn(
        "relative flex w-full items-center gap-2 rounded-md py-1 pr-1.5 text-left text-[13px] transition-colors",
        indent ? "pl-6" : "pl-1.5",
        active ? cn(color.bg, color.text, "font-medium") : "text-foreground/75 hover:bg-secondary hover:text-foreground",
      )}
    >
      <tool.icon className="size-3.5 shrink-0" />
      <span className="truncate">{tool.name}</span>
      {showCategory && (
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{CATEGORIES.find((c) => c.id === tool.category)?.label}</span>
      )}
    </button>
  );
}

function NavRow({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[13px] transition-colors",
        active ? "bg-primary/15 font-medium text-primary" : "text-foreground/75 hover:bg-secondary hover:text-foreground",
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

function IconRow({ active, onClick, title, children }: { active: boolean; onClick: () => void; title: string; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        "flex flex-1 items-center justify-center gap-1 rounded-md py-1 transition-colors hover:bg-secondary",
        active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
