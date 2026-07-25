import { useCallback, useEffect, useMemo, useState } from "react";
import { Table2, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/CopyButton";
import { cn } from "@/lib/utils";
import type { DbEngine, DbObject, QueryResult } from "@/tools/lib/dbTypes";
import { columnsQuery, pkQuery, normalizeColumns, buildCreateTable, type ColumnMeta } from "@/tools/lib/dbSchema";
import { qualify, pageQuery, countQuery, definitionQuery, indexQuery } from "@/tools/lib/dbBrowse";

type RunSql = (sql: string, maxRows?: number) => Promise<QueryResult>;
type Tab = "columns" | "data" | "indexes" | "definition";

const PAGE_SIZE = 50;

export function DbObjectDetails({ obj, engine, runSql, onClose, onSelect }: {
  obj: DbObject;
  engine: DbEngine;
  runSql: RunSql;
  onClose: () => void;
  onSelect: () => void;
}) {
  const q = qualify(obj.schema, obj.name);
  const isRelation = obj.kind === "table" || obj.kind === "view";
  const tabs: Tab[] = obj.kind === "procedure" || obj.kind === "function"
    ? ["definition"]
    : obj.kind === "view"
      ? ["columns", "data", "definition"]
      : ["columns", "data", "indexes"];

  const [tab, setTab] = useState<Tab>(tabs[0]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [cols, setCols] = useState<ColumnMeta[] | null>(null);
  const [idx, setIdx] = useState<QueryResult | null>(null);
  const [def, setDef] = useState<string | null>(null);
  const [data, setData] = useState<QueryResult | null>(null);
  const [page, setPage] = useState(0);
  const [count, setCount] = useState<number | null>(null);

  const loadColumns = useCallback(async () => {
    const r = await runSql(columnsQuery(engine, obj.schema, obj.name), 1000);
    let pk: QueryResult | undefined;
    const pkSql = pkQuery(engine, obj.schema, obj.name);
    if (pkSql) { try { pk = await runSql(pkSql, 200); } catch { /* best effort */ } }
    setCols(normalizeColumns(engine, r, pk));
  }, [engine, obj.schema, obj.name, runSql]);

  const loadData = useCallback(async (p: number) => {
    const r = await runSql(pageQuery(engine, obj.schema, obj.name, p * PAGE_SIZE, PAGE_SIZE), PAGE_SIZE);
    setData(r);
    setPage(p);
    if (count === null) {
      try { const c = await runSql(countQuery(engine, obj.schema, obj.name), 1); setCount(Number(c.rows[0]?.[0] ?? 0)); } catch { /* ignore */ }
    }
  }, [engine, obj.schema, obj.name, runSql, count]);

  const loadIndexes = useCallback(async () => {
    const sql = indexQuery(engine, obj.schema, obj.name);
    if (!sql) { setIdx({ columns: [], rows: [], rowCount: 0, elapsedMs: 0, truncated: false }); return; }
    setIdx(await runSql(sql, 500));
  }, [engine, obj.schema, obj.name, runSql]);

  const loadDefinition = useCallback(async () => {
    const sql = definitionQuery(engine, obj.kind as "view" | "procedure" | "function", obj.schema, obj.name);
    if (!sql) { setDef("-- definition not available for this engine"); return; }
    const r = await runSql(sql, 500);
    setDef(extractDefinition(r));
  }, [engine, obj.kind, obj.schema, obj.name, runSql]);

  // Load the active tab's data on demand.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setError("");
      setBusy(true);
      try {
        if (tab === "columns" && cols === null) await loadColumns();
        else if (tab === "data" && data === null) await loadData(0);
        else if (tab === "indexes" && idx === null) await loadIndexes();
        else if (tab === "definition" && def === null) await loadDefinition();
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setBusy(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [tab, obj]); // eslint-disable-line react-hooks/exhaustive-deps

  const createStmt = useMemo(() => (cols ? buildCreateTable(q, cols) : ""), [cols, q]);
  const lastPage = count !== null ? Math.max(0, Math.ceil(count / PAGE_SIZE) - 1) : null;

  return (
    <div className="rounded-md border border-border">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Table2 className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">{q}</span>
        <Badge variant="outline" className="text-[10px]">{obj.kind}</Badge>
        {isRelation && <Button size="sm" variant="ghost" onClick={onSelect}>SELECT</Button>}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onClose}>Close</Button>
      </div>

      <div className="flex gap-1 border-b border-border px-2">
        {tabs.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cn("px-3 py-1.5 text-xs capitalize", tab === t ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground")}>{t}</button>
        ))}
      </div>

      <div className="p-3">
        {error && <div className="mb-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{error}</div>}
        {busy && <p className="text-sm text-muted-foreground">Loading…</p>}

        {tab === "columns" && cols && (
          <div className="flex flex-col gap-2">
            <div className="max-h-64 overflow-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-xs text-muted-foreground">
                  <tr><th className="px-3 py-1.5">Column</th><th className="px-3 py-1.5">Type</th><th className="px-3 py-1.5">Null</th><th className="px-3 py-1.5">Default</th><th className="px-3 py-1.5">Key</th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {cols.map((c) => (
                    <tr key={c.name}>
                      <td className="mono px-3 py-1">{c.name}</td>
                      <td className="mono px-3 py-1 text-muted-foreground">{c.type}</td>
                      <td className="px-3 py-1 text-xs">{c.nullable ? "YES" : "NO"}</td>
                      <td className="mono px-3 py-1 text-xs text-muted-foreground">{c.default ?? ""}</td>
                      <td className="px-3 py-1">{c.pk && <Badge className="text-[10px]">PK</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end"><CopyButton value={createStmt} label="CREATE" /></div>
          </div>
        )}

        {tab === "data" && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Button size="sm" variant="outline" disabled={busy || page === 0} onClick={() => loadData(page - 1)}><ChevronLeft className="size-3.5" /> Prev</Button>
              <Button size="sm" variant="outline" disabled={busy || (lastPage !== null ? page >= lastPage : (data?.rows.length ?? 0) < PAGE_SIZE)} onClick={() => loadData(page + 1)}>Next <ChevronRight className="size-3.5" /></Button>
              <span>rows {page * PAGE_SIZE + 1}–{page * PAGE_SIZE + (data?.rows.length ?? 0)}{count !== null ? ` of ${count}` : ""}</span>
              <Button size="sm" variant="ghost" onClick={() => loadData(page)}><RefreshCw className={cn("size-3.5", busy && "animate-spin")} /></Button>
            </div>
            {data && <Grid result={data} />}
          </div>
        )}

        {tab === "indexes" && idx && (
          idx.rows.length === 0 ? <p className="text-sm text-muted-foreground">No indexes.</p> : <Grid result={idx} />
        )}

        {tab === "definition" && def !== null && (
          <div className="relative rounded-md border border-border bg-secondary/30 p-3">
            <CopyButton value={def} className="absolute right-2 top-2" />
            <pre className="mono max-h-72 overflow-auto whitespace-pre-wrap pr-16 text-xs">{def || "-- (empty)"}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

function Grid({ result }: { result: QueryResult }) {
  if (result.columns.length === 0) return <p className="text-sm text-muted-foreground">No columns.</p>;
  return (
    <div className="max-h-[360px] overflow-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 border-b border-border bg-card text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-2 py-1.5">#</th>
            {result.columns.map((c) => <th key={c} className="whitespace-nowrap px-3 py-1.5 font-medium">{c}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {result.rows.map((row, ri) => (
            <tr key={ri} className="hover:bg-secondary/40">
              <td className="px-2 py-1 text-xs text-muted-foreground">{ri + 1}</td>
              {row.map((cell, ci) => (
                <td key={ci} className={cn("mono max-w-[360px] truncate px-3 py-1", cell === null && "italic text-muted-foreground")} title={cell ?? "NULL"}>{cell === null ? "NULL" : cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Pull the definition text out of an engine-specific result (SHOW CREATE / OBJECT_DEFINITION / etc). */
function extractDefinition(r: QueryResult): string {
  if (r.columns.length === 0 || r.rows.length === 0) return "-- (no definition returned)";
  const lower = r.columns.map((c) => c.toLowerCase());
  let i = lower.findIndex((c) => c.startsWith("create"));
  if (i < 0) i = lower.findIndex((c) => c === "definition" || c === "sql" || c === "indexdef");
  if (i < 0) i = r.columns.length - 1;
  return r.rows[0][i] ?? "-- (empty)";
}
