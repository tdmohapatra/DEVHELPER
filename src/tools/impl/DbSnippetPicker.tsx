import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Search, Shield, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { DbEngine } from "@/tools/lib/dbTypes";
import {
  CATEGORY_LABELS,
  searchSnippets,
  snippetsByCategory,
  snippetSql,
  type Snippet,
} from "@/tools/lib/dbSnippets";

/**
 * Searchable library of ready-made SQL.
 *
 * Deliberately a plain popover rather than a modal: picking a snippet is a
 * step inside writing a query, so it opens over the editor, takes the keyboard,
 * and closes the moment something is chosen.
 */
export function DbSnippetPicker({ engine, onInsert }: { engine: DbEngine; onInsert: (sql: string, title: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => searchSnippets(engine, query), [engine, query]);
  const groups = useMemo(() => snippetsByCategory(matches), [matches]);
  // Flat order matches what the eye sees, so arrow keys walk the rendered list.
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const active = flat[Math.min(cursor, flat.length - 1)];

  useEffect(() => setCursor(0), [query]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    // Deferred: the click that opened the popover would otherwise close it again.
    const t = setTimeout(() => window.addEventListener("mousedown", onClick), 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
      clearTimeout(t);
    };
  }, [open]);

  function choose(s: Snippet) {
    const sql = snippetSql(s, engine);
    if (!sql) return;
    onInsert(sql, s.title);
    setOpen(false);
    setQuery("");
  }

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter" && active) {
      e.preventDefault();
      choose(active);
    }
  }

  return (
    <div className="relative" ref={boxRef}>
      <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)} title="Ready-made SQL for this engine">
        <BookOpen className="size-3.5" /> Snippets
      </Button>

      {open && (
        <div className="absolute left-0 top-9 z-30 flex w-[min(46rem,92vw)] flex-col rounded-md border border-border bg-card shadow-lg">
          <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKey}
              placeholder="Search — window function, blocking, index, backup…"
              className="h-7 border-0 px-0 focus-visible:ring-0"
            />
            <span className="shrink-0 text-[11px] text-muted-foreground">{matches.length}</span>
          </div>

          <div className="flex max-h-[26rem]">
            <div className="w-1/2 overflow-auto border-r border-border py-1">
              {flat.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">Nothing matches.</p>}
              {groups.map((g) => (
                <div key={g.category}>
                  <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {CATEGORY_LABELS[g.category]}
                  </div>
                  {g.items.map((s) => {
                    const i = flat.indexOf(s);
                    return (
                      <button
                        key={s.id}
                        onMouseEnter={() => setCursor(i)}
                        onClick={() => choose(s)}
                        className={cn(
                          "flex w-full items-center gap-1.5 px-3 py-1 text-left text-xs",
                          i === cursor ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-secondary/60",
                        )}
                      >
                        <span className="truncate">{s.title}</span>
                        {s.template && <Pencil className="ml-auto size-3 shrink-0 opacity-60" />}
                        {s.privileged && <Shield className="size-3 shrink-0 opacity-60" />}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            <div className="w-1/2 overflow-auto p-3">
              {active ? (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium">{active.title}</span>
                    <Badge variant="outline" className="text-[10px]">{CATEGORY_LABELS[active.category]}</Badge>
                    {active.template && <Badge variant="secondary" className="text-[10px]">edit before running</Badge>}
                    {active.privileged && <Badge variant="warning" className="text-[10px]">needs elevated rights</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground">{active.description}</p>
                  <pre className="mono max-h-56 overflow-auto rounded border border-border bg-secondary/30 p-2 text-[11px] leading-snug">
                    {snippetSql(active, engine)}
                  </pre>
                  <Button size="sm" className="self-start" onClick={() => choose(active)}>Insert (Enter)</Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Type to search, ↑↓ to move, Enter to insert.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
