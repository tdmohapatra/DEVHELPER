import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Users, Lock, HardDrive, Ban, Search, Shield, Play, ExternalLink, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/CopyButton";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { DbEngine, QueryResult } from "@/tools/lib/dbTypes";
import { sessionsQuery, locksQuery, dbSizeQuery, killQuery } from "@/tools/lib/dbMonitor";
import {
  CATEGORY_LABELS,
  diagnosticsFor,
  searchSnippets,
  snippetsByCategory,
  snippetSql,
  type Snippet,
} from "@/tools/lib/dbSnippets";

type RunSql = (sql: string, maxRows?: number) => Promise<QueryResult>;

interface PanelState { loading: boolean; error?: string; result?: QueryResult; ranAt?: number }

/**
 * Health dashboard.
 *
 * Nothing runs on open except the two cheap headline queries. Every diagnostic
 * is a deliberate click: these read DMVs and catalog views on a live server,
 * and a dashboard that fires twenty of them the moment a tab is selected is a
 * dashboard people stop opening.
 */
export function DbMonitor({ engine, runSql, onOpenInEditor }: {
  engine: DbEngine;
  runSql: RunSql;
  onOpenInEditor?: (sql: string, title: string) => void;
}) {
  const [sessions, setSessions] = useState<PanelState>({ loading: false });
  const [locks, setLocks] = useState<PanelState>({ loading: false });
  const [size, setSize] = useState<PanelState>({ loading: false });
  const [killId, setKillId] = useState("");

  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [panels, setPanels] = useState<Record<string, PanelState>>({});

  const diagnostics = useMemo(() => diagnosticsFor(engine), [engine]);
  const matches = useMemo(() => {
    const searched = new Set(searchSnippets(engine, query).map((s) => s.id));
    return diagnostics.filter((s) => searched.has(s.id));
  }, [diagnostics, engine, query]);
  const groups = useMemo(() => snippetsByCategory(matches), [matches]);

  const runInto = useCallback(
    async (sql: string | null, set: (p: PanelState) => void, cap = 500) => {
      if (!sql) { set({ loading: false, error: "Not available for this engine." }); return; }
      set({ loading: true });
      try {
        set({ loading: false, result: await runSql(sql, cap), ranAt: Date.now() });
      } catch (e) {
        set({ loading: false, error: (e as Error).message });
      }
    },
    [runSql],
  );

  const loadHeadline = useCallback(async () => {
    await Promise.all([
      runInto(sessionsQuery(engine), setSessions),
      runInto(dbSizeQuery(engine), setSize, 5),
    ]);
  }, [engine, runInto]);

  // StrictMode runs effects twice in development, and each run opens a real
  // connection. Latched to one load per runner.
  const loadedFor = useRef<RunSql | null>(null);
  useEffect(() => {
    if (loadedFor.current === runSql) return;
    loadedFor.current = runSql;
    loadHeadline();
  }, [loadHeadline, runSql]);

  async function toggle(s: Snippet) {
    if (openId === s.id) { setOpenId(null); return; }
    setOpenId(s.id);
    if (panels[s.id]?.result || panels[s.id]?.loading) return;
    await runInto(snippetSql(s, engine), (p) => setPanels((cur) => ({ ...cur, [s.id]: p })));
  }

  async function rerun(s: Snippet) {
    await runInto(snippetSql(s, engine), (p) => setPanels((cur) => ({ ...cur, [s.id]: p })));
  }

  const kill = async () => {
    const sql = killQuery(engine, killId);
    if (!sql) { toast.error("Enter a numeric session id"); return; }
    if (!confirm(`Terminate session ${killId.replace(/[^0-9]/g, "")}? Any in-flight transaction is rolled back.`)) return;
    try {
      await runSql(sql, 1);
      toast.success(`Killed session ${killId.replace(/[^0-9]/g, "")}`);
      setKillId("");
      loadHeadline();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const sizeValue = size.result?.rows?.[0]?.[0];
  const canKill = killQuery(engine, "1") !== null;
  const blocked = locks.result?.rows.length;
  const busy = sessions.loading || size.loading;

  return (
    <div className="flex flex-col gap-3">
      {/* Headline numbers — the two cheapest useful facts. */}
      <div className="flex flex-wrap items-center gap-2">
        <Tile
          icon={<Users className="size-3.5" />}
          label="Sessions"
          value={sessions.result ? String(sessions.result.rows.length) : sessions.error ? "—" : "…"}
        />
        <Tile
          icon={<HardDrive className="size-3.5" />}
          label="Database size"
          value={sizeValue != null ? `${sizeValue}${engine === "postgres" ? "" : " MB"}` : "—"}
        />
        <Tile
          icon={<Lock className="size-3.5" />}
          label="Blocked"
          value={blocked === undefined ? "not checked" : String(blocked)}
          tone={blocked ? "bad" : blocked === 0 ? "good" : undefined}
          onClick={() => runInto(locksQuery(engine), setLocks)}
        />
        <Button size="sm" variant="outline" className="ml-auto" onClick={loadHeadline}>
          <RefreshCw className={cn("size-3.5", busy && "animate-spin")} /> Refresh
        </Button>
      </div>

      {sessions.error && <Problem message={sessions.error} />}

      {locks.result && (
        <Panel
          title="Blocking"
          state={locks}
          emptyText="No blocking right now."
          onRerun={() => runInto(locksQuery(engine), setLocks)}
        />
      )}

      <Panel
        title="Active sessions"
        state={sessions}
        emptyText="No user sessions."
        onRerun={() => runInto(sessionsQuery(engine), setSessions)}
        extra={canKill ? (
          <div className="flex items-center gap-1.5">
            <Input value={killId} onChange={(e) => setKillId(e.target.value)} placeholder="session id" className="h-7 w-24 text-xs" />
            <Button size="sm" variant="destructive" className="h-7" onClick={kill} disabled={!killId.trim()}>
              <Ban className="size-3.5" /> Kill
            </Button>
          </div>
        ) : null}
      />

      {/* Diagnostics — one click each, nothing runs until asked. */}
      <div className="flex items-center gap-2 pt-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Diagnostics</h3>
        <Badge variant="outline" className="text-[10px]">{matches.length}</Badge>
        <div className="ml-auto flex items-center gap-1.5">
          <Search className="size-3.5 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter…" className="h-7 w-44 text-xs" />
        </div>
      </div>

      {diagnostics.length === 0 ? (
        <p className="text-sm text-muted-foreground">No diagnostics are written for {engine} yet.</p>
      ) : (
        groups.map((g) => (
          <section key={g.category} className="flex flex-col gap-1">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {CATEGORY_LABELS[g.category]}
            </div>
            {g.items.map((s) => (
              <Diagnostic
                key={s.id}
                snippet={s}
                engine={engine}
                open={openId === s.id}
                state={panels[s.id]}
                onToggle={() => toggle(s)}
                onRerun={() => rerun(s)}
                onOpenInEditor={onOpenInEditor}
              />
            ))}
          </section>
        ))
      )}

      {matches.length === 0 && diagnostics.length > 0 && (
        <p className="text-sm text-muted-foreground">Nothing matches that filter.</p>
      )}
    </div>
  );
}

function Tile({ icon, label, value, tone, onClick }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "good" | "bad";
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={cn("text-sm font-medium", tone === "bad" && "text-destructive", tone === "good" && "text-success")}>
        {value}
      </span>
    </>
  );
  return onClick ? (
    <button onClick={onClick} className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 hover:bg-secondary/50">
      {body}
    </button>
  ) : (
    <div className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1">{body}</div>
  );
}

function Problem({ message }: { message: string }) {
  return <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{message}</p>;
}

function Panel({ title, state, emptyText, extra, onRerun }: {
  title: string;
  state: PanelState;
  emptyText: string;
  extra?: React.ReactNode;
  onRerun: () => void;
}) {
  return (
    <section className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
        {state.result && <Badge variant="outline" className="text-[10px]">{state.result.rows.length}</Badge>}
        <button className="text-muted-foreground hover:text-foreground" onClick={onRerun} title="Run again">
          <RefreshCw className={cn("size-3", state.loading && "animate-spin")} />
        </button>
        <div className="ml-auto">{extra}</div>
      </div>
      {state.error ? (
        <Problem message={state.error} />
      ) : state.loading ? (
        <p className="text-xs text-muted-foreground">Running…</p>
      ) : state.result && state.result.rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyText}</p>
      ) : state.result ? (
        <Grid result={state.result} />
      ) : null}
    </section>
  );
}

function Diagnostic({ snippet, engine, open, state, onToggle, onRerun, onOpenInEditor }: {
  snippet: Snippet;
  engine: DbEngine;
  open: boolean;
  state?: PanelState;
  onToggle: () => void;
  onRerun: () => void;
  onOpenInEditor?: (sql: string, title: string) => void;
}) {
  const sql = snippetSql(snippet, engine) ?? "";
  return (
    <div className="rounded-md border border-border">
      <button onClick={onToggle} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-secondary/40">
        <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        <span className="text-xs font-medium">{snippet.title}</span>
        {snippet.privileged && <Shield className="size-3 shrink-0 text-muted-foreground" />}
        <span className="truncate text-[11px] text-muted-foreground">{snippet.description}</span>
        {state?.result && <Badge variant="outline" className="ml-auto shrink-0 text-[10px]">{state.result.rows.length}</Badge>}
        {state?.loading && <RefreshCw className="ml-auto size-3 shrink-0 animate-spin text-muted-foreground" />}
      </button>

      {open && (
        <div className="flex flex-col gap-2 border-t border-border p-2">
          <div className="flex flex-wrap items-center gap-1">
            <Button size="sm" variant="ghost" className="h-7" onClick={onRerun}>
              <Play className="size-3" /> Run again
            </Button>
            {onOpenInEditor && (
              <Button size="sm" variant="ghost" className="h-7" onClick={() => onOpenInEditor(sql, snippet.title)}>
                <ExternalLink className="size-3" /> Open in editor
              </Button>
            )}
            <CopyButton value={sql} label="SQL" />
          </div>
          {state?.error ? (
            <Problem message={state.error} />
          ) : state?.loading ? (
            <p className="text-xs text-muted-foreground">Running…</p>
          ) : state?.result && state.result.rows.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing to report — the query returned no rows.</p>
          ) : state?.result ? (
            <Grid result={state.result} />
          ) : null}
        </div>
      )}
    </div>
  );
}

function Grid({ result }: { result: QueryResult }) {
  if (result.columns.length === 0) return <p className="text-xs text-muted-foreground">No columns returned.</p>;
  return (
    <div className="max-h-80 overflow-auto rounded-md border border-border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 border-b border-border bg-card text-left text-muted-foreground">
          <tr>{result.columns.map((c, i) => <th key={`${c}-${i}`} className="whitespace-nowrap px-2 py-1 font-medium">{c}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border">
          {result.rows.map((row, ri) => (
            <tr key={ri} className="hover:bg-secondary/40">
              {row.map((cell, ci) => (
                <td key={ci} className={cn("mono max-w-[320px] truncate px-2 py-0.5", cell === null && "italic text-muted-foreground")} title={cell ?? "NULL"}>
                  {cell === null ? "NULL" : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
