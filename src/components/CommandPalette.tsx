import { useEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Search, Star, History, CornerDownLeft, LayoutDashboard, Settings as SettingsIcon, Moon, Sun, Hash, ArrowUp, ArrowDown, Send, Server, Database, Bookmark, Bug, FolderKanban } from "lucide-react";
import { TOOLS } from "@/tools/registry";
import { CATEGORY_COLORS } from "@/tools/categoryColors";
import { useAppStore } from "@/stores/useAppStore";
import { useApiStore } from "@/stores/useApiStore";
import { useDbStore } from "@/stores/useDbStore";
import { useDebugStore } from "@/stores/useDebugStore";
import { useSnippetStore } from "@/stores/useSnippetStore";
import { useProjectStore } from "@/stores/useProjectStore";
import { sendHandoff } from "@/stores/useHandoffStore";
import { generateGuids } from "@/tools/lib/guid";
import { scoreTool, fuzzyMatch } from "@/lib/fuzzy";
import { buildArtifactIndex, searchArtifacts, KIND_LABEL, type ArtifactKind } from "@/lib/artifactIndex";
import { copyToClipboard } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { CategoryId } from "@/tools/types";

interface Command {
  id: string;
  name: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  category?: CategoryId;
  shortcut?: string;
  group: "Action" | "Tool" | "Yours";
  /** For a saved-artefact row: what kind it is, shown instead of a category. */
  kindLabel?: string;
  isFavorite?: boolean;
  isRecent?: boolean;
  score: number;
  positions: number[];
  run: () => void;
}

const ARTIFACT_ICON: Record<ArtifactKind, ComponentType<{ className?: string }>> = {
  request: Send,
  environment: Server,
  connection: Database,
  snippet: Bookmark,
  session: Bug,
  project: FolderKanban,
};

/**
 * Open a saved artefact in the tool that owns it.
 *
 * Where a store has a notion of "active", selecting it is the whole job. The
 * two that do not — a request and a snippet are picked from a list inside their
 * tool — get a one-shot handoff, which those tools read on mount.
 */
function openArtifact(kind: ArtifactKind, refId: string, toolId: string): void {
  switch (kind) {
    case "environment":
      useApiStore.getState().setActiveEnv(refId);
      break;
    case "connection":
      useDbStore.getState().setActive(refId);
      break;
    case "session":
      useDebugStore.getState().setActive(refId);
      break;
    case "project":
      useProjectStore.getState().setActive(refId);
      break;
    case "request":
    case "snippet":
      sendHandoff(toolId, { selectId: refId }, "the command palette");
      break;
  }
  useAppStore.getState().openTool(toolId);
}

/** Render a label with fuzzy-matched characters emphasized. */
function highlight(text: string, positions: number[]): ReactNode {
  if (positions.length === 0) return text;
  const set = new Set(positions);
  return [...text].map((ch, i) =>
    set.has(i) ? <span key={i} className="font-semibold text-primary">{ch}</span> : <span key={i}>{ch}</span>,
  );
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const openTool = useAppStore((s) => s.openTool);
  const openView = useAppStore((s) => s.openView);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const theme = useAppStore((s) => s.theme);
  const favorites = useAppStore((s) => s.favorites);
  const recent = useAppStore((s) => s.recent);

  // Your own saved work, so the palette finds the request you named rather than
  // only the tool you would have had to remember it was in.
  const requests = useApiStore((s) => s.requests);
  const environments = useApiStore((s) => s.environments);
  const connections = useDbStore((s) => s.connections);
  const sessions = useDebugStore((s) => s.sessions);
  const snippets = useSnippetStore((s) => s.snippets);
  const projects = useProjectStore((s) => s.profiles);

  const artifacts = useMemo(
    () =>
      buildArtifactIndex({
        requests: Object.values(requests),
        environments,
        connections,
        snippets,
        sessions,
        projects,
      }),
    [requests, environments, connections, snippets, sessions, projects],
  );

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const q = query.trim();

    // Global navigation / utility actions.
    const rawActions: Omit<Command, "score" | "positions">[] = [
      { id: "act-dashboard", name: "Go to Dashboard", description: "Home", icon: LayoutDashboard, group: "Action", run: () => { openView({ kind: "dashboard" }); onClose(); } },
      { id: "act-favorites", name: "Open Favorites", description: "Your starred tools", icon: Star, group: "Action", run: () => { openView({ kind: "favorites" }); onClose(); } },
      { id: "act-recent", name: "Open Recent", description: "Recently used tools", icon: History, group: "Action", run: () => { openView({ kind: "recent" }); onClose(); } },
      { id: "act-settings", name: "Open Settings", description: "Preferences, AI, sound", icon: SettingsIcon, group: "Action", run: () => { openView({ kind: "settings" }); onClose(); } },
      { id: "act-theme", name: `Switch to ${theme === "dark" ? "light" : "dark"} theme`, description: "Toggle appearance", icon: theme === "dark" ? Sun : Moon, group: "Action", run: () => { toggleTheme(); onClose(); } },
      {
        id: "act-guid", name: "Generate a GUID → clipboard", description: "Create one UUID v4 and copy it", icon: Hash, group: "Action",
        run: async () => { const [g] = generateGuids({ count: 1, uppercase: false, hyphens: true, braces: false }); await copyToClipboard(g); toast.success(`Copied ${g}`); onClose(); },
      },
    ];

    const actions: Command[] = rawActions
      .map((a): Command | null => {
        const r = q ? fuzzyMatch(q, a.name) : { score: 0, positions: [] };
        return r ? { ...a, score: r.score, positions: r.positions } : null;
      })
      .filter((c): c is Command => c !== null);

    // Tools, fuzzy-scored with favorite/recent boosts.
    const tools: Command[] = TOOLS.map((t): Command | null => {
      const r = scoreTool(q, t.name, t.keywords, t.description);
      if (!r) return null;
      const fav = favorites.includes(t.id);
      const rec = recent.indexOf(t.id);
      let score = r.score;
      if (!q) {
        // Empty query: order by recent, then favorites.
        score = (rec >= 0 ? 1000 - rec : 0) + (fav ? 200 : 0);
      } else {
        if (fav) score += 4;
        if (rec >= 0) score += 3;
      }
      return { id: t.id, name: t.name, description: t.description, icon: t.icon, category: t.category, shortcut: t.shortcut, group: "Tool" as const, isFavorite: fav, isRecent: rec >= 0, score, positions: r.positions, run: () => { openTool(t.id); onClose(); } };
    }).filter((c): c is Command => c !== null);

    // Saved artefacts. Only searched, never listed on an empty query — the
    // palette should open on the tools, not on a dump of everything you own.
    const yours: Command[] = searchArtifacts(artifacts, q).map((a) => ({
      id: a.id,
      name: a.name,
      description: a.detail,
      icon: ARTIFACT_ICON[a.kind],
      group: "Yours" as const,
      kindLabel: KIND_LABEL[a.kind],
      // Ranked above tools: an exact name you chose beats a fuzzy tool match.
      score: a.score + 6,
      positions: a.positions,
      run: () => { openArtifact(a.kind, a.refId, a.toolId); onClose(); },
    }));

    const sortByScore = (a: Command, b: Command) => b.score - a.score || a.name.localeCompare(b.name);
    actions.sort(sortByScore);
    tools.sort(sortByScore);
    yours.sort(sortByScore);

    // Empty query surfaces a compact, useful set; a real query shows everything ranked.
    const limitedTools = q ? tools : tools.slice(0, 8);
    return q ? [...yours, ...actions, ...tools] : [...limitedTools, ...actions];
  }, [query, favorites, recent, theme, artifacts, openTool, openView, toggleTheme, onClose]);

  useEffect(() => setActive(0), [query]);

  // Keep the active row scrolled into view.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, commands.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); commands[active]?.run(); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[12vh] animate-fade-in backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-card shadow-premium animate-scale-in"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        role="dialog"
        aria-label="Command palette"
      >
        <div className="flex items-center gap-2.5 border-b border-border px-4">
          <Search className="size-4 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tools, actions, and your saved work…"
            className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            aria-label="Search tools, actions, and saved work"
          />
          <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">Esc</kbd>
        </div>

        <ul ref={listRef} className="max-h-[22rem] overflow-y-auto p-2">
          {commands.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted-foreground">No results for “{query}”.</li>}
          {commands.map((c, i) => {
            const Icon = c.icon;
            const color = c.category ? CATEGORY_COLORS[c.category] : null;
            return (
              <li key={c.id} data-idx={i}>
                <button
                  onMouseMove={() => active !== i && setActive(i)}
                  onClick={c.run}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
                    i === active ? "bg-secondary" : "hover:bg-secondary/60",
                  )}
                >
                  <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-md", color ? cn(color.bg, color.text) : "bg-primary/10 text-primary")}>
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-sm">
                      <span className="truncate">{highlight(c.name, c.positions)}</span>
                      {c.group === "Action" && <span className="rounded bg-secondary px-1 text-[9px] uppercase tracking-wide text-muted-foreground">cmd</span>}
                      {c.kindLabel && <span className="shrink-0 rounded bg-primary/10 px-1 text-[9px] uppercase tracking-wide text-primary">{c.kindLabel}</span>}
                      {c.isFavorite && <Star className="size-3 shrink-0 fill-warning text-warning" />}
                      {c.isRecent && !c.isFavorite && <History className="size-3 shrink-0 text-muted-foreground" />}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{c.description}</div>
                  </div>
                  {c.shortcut && <kbd className="hidden rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground sm:block">{c.shortcut}</kbd>}
                  {i === active && <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" />}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center gap-4 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1"><ArrowUp className="size-3" /><ArrowDown className="size-3" /> navigate</span>
          <span className="flex items-center gap-1"><CornerDownLeft className="size-3" /> open</span>
          <span className="ml-auto">{commands.length} result{commands.length === 1 ? "" : "s"}</span>
        </div>
      </div>
    </div>
  );
}
