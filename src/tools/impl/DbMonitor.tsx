import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Users, Lock, Clock, HardDrive, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { DbEngine, QueryResult } from "@/tools/lib/dbTypes";
import { sessionsQuery, locksQuery, lastModifiedQuery, dbSizeQuery, killQuery } from "@/tools/lib/dbMonitor";

type RunSql = (sql: string, maxRows?: number) => Promise<QueryResult>;

interface SectionState { supported: boolean; loading: boolean; error?: string; result?: QueryResult }

export function DbMonitor({ engine, runSql }: { engine: DbEngine; runSql: RunSql }) {
  const [sessions, setSessions] = useState<SectionState>({ supported: true, loading: false });
  const [locks, setLocks] = useState<SectionState>({ supported: true, loading: false });
  const [modified, setModified] = useState<SectionState>({ supported: true, loading: false });
  const [size, setSize] = useState<SectionState>({ supported: true, loading: false });
  const [killId, setKillId] = useState("");

  const load = useCallback(async () => {
    const run = async (sql: string | null, set: (s: SectionState) => void) => {
      if (!sql) { set({ supported: false, loading: false }); return; }
      set({ supported: true, loading: true });
      try {
        set({ supported: true, loading: false, result: await runSql(sql, 500) });
      } catch (e) {
        set({ supported: true, loading: false, error: (e as Error).message });
      }
    };
    await Promise.all([
      run(sessionsQuery(engine), setSessions),
      run(locksQuery(engine), setLocks),
      run(lastModifiedQuery(engine), setModified),
      run(dbSizeQuery(engine), setSize),
    ]);
  }, [engine, runSql]);

  useEffect(() => { load(); }, [load]);

  const kill = async () => {
    const sql = killQuery(engine, killId);
    if (!sql) { toast.error("Enter a numeric session id"); return; }
    if (!confirm(`Terminate session ${killId.replace(/[^0-9]/g, "")}? Any in-flight transaction is rolled back.`)) return;
    try {
      await runSql(sql, 1);
      toast.success(`Killed session ${killId.replace(/[^0-9]/g, "")}`);
      setKillId("");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const sizeValue = size.result?.rows?.[0]?.[0];
  const canKill = killQuery(engine, "1") !== null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={load}><RefreshCw className={cn((sessions.loading || locks.loading) && "animate-spin")} /> Refresh</Button>
        {size.supported && sizeValue != null && (
          <span className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-sm">
            <HardDrive className="size-3.5 text-muted-foreground" /> Database size: <b>{sizeValue}{engine === "postgres" ? "" : " MB"}</b>
          </span>
        )}
      </div>

      <Section icon={<Users className="size-4" />} title="Active sessions" state={sessions} engine={engine}
        extra={canKill && sessions.supported ? (
          <div className="flex items-center gap-1.5">
            <Input value={killId} onChange={(e) => setKillId(e.target.value)} placeholder="session id" className="h-7 w-28 text-xs" />
            <Button size="sm" variant="destructive" onClick={kill} disabled={!killId.trim()}><Ban className="size-3.5" /> Kill</Button>
          </div>
        ) : null}
      />

      <Section icon={<Lock className="size-4" />} title="Blocking & locks" state={locks} engine={engine} emptyText="No blocking detected." />
      <Section icon={<Clock className="size-4" />} title="Last modified objects" state={modified} engine={engine} />
    </div>
  );
}

function Section({ icon, title, state, engine, extra, emptyText }: { icon: React.ReactNode; title: string; state: SectionState; engine: DbEngine; extra?: React.ReactNode; emptyText?: string }) {
  return (
    <section>
      <div className="mb-1.5 flex items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{icon} {title}</h3>
        {state.result && <Badge variant="outline" className="text-[10px]">{state.result.rows.length}</Badge>}
        <div className="ml-auto">{extra}</div>
      </div>
      {!state.supported ? (
        <p className="text-sm text-muted-foreground">Not available for {engine}.</p>
      ) : state.loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : state.error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{state.error}</p>
      ) : state.result && state.result.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText ?? "Nothing to show."}</p>
      ) : state.result ? (
        <Grid result={state.result} />
      ) : null}
    </section>
  );
}

function Grid({ result }: { result: QueryResult }) {
  if (result.columns.length === 0) return null;
  return (
    <div className="max-h-72 overflow-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 border-b border-border bg-card text-left text-xs text-muted-foreground">
          <tr>{result.columns.map((c) => <th key={c} className="whitespace-nowrap px-3 py-1.5 font-medium">{c}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border">
          {result.rows.map((row, ri) => (
            <tr key={ri} className="hover:bg-secondary/40">
              {row.map((cell, ci) => (
                <td key={ci} className={cn("mono max-w-[320px] truncate px-3 py-1", cell === null && "italic text-muted-foreground")} title={cell ?? "NULL"}>{cell === null ? "NULL" : cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
