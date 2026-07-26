import { useCallback, useMemo, useRef, useState } from "react";
import {
  Database as DbIcon,
  Plus,
  Play,
  Table2,
  Eye,
  FunctionSquare,
  Trash2,
  Files,
  Plug,
  ShieldAlert,
  TriangleAlert,
  Code2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Circle,
  Download,
  Upload,
} from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/CopyButton";
import { AddToDebug } from "@/components/AddToDebug";
import { NativeNotice } from "@/components/NativeNotice";
import { toast } from "@/components/ui/toast";
import { invokeNative, isTauri } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { useDbStore } from "@/stores/useDbStore";
import { useApiStore } from "@/stores/useApiStore";
import {
  DB_ENGINES,
  DEFAULT_PORTS,
  buildConnString,
  connTarget,
  dbConnectionFromEnvRef,
  serializeConnections,
  parseConnectionsFile,
  type DbConnection,
  type DbEngine,
  type DbObject,
  type QueryResult,
} from "@/tools/lib/dbTypes";
import { analyzeSql, isWriteSql, highestRisk } from "@/tools/lib/sqlSafety";
import { DbObjectDetails } from "@/tools/impl/DbObjectDetails";
import { DbMonitor } from "@/tools/impl/DbMonitor";
import {
  inferColumns,
  toCsharpClass,
  toCsharpRecord,
  toEfEntity,
  toTsInterface,
  toJsonExample,
  toInsert,
} from "@/tools/lib/dbCodegen";

type Tab = "explorer" | "query" | "monitor";
type CodeGen = "csharp-class" | "csharp-record" | "ef-entity" | "ts-interface" | "json";

const OBJECT_ICON = { table: Table2, view: Eye, procedure: FunctionSquare, function: FunctionSquare } as const;

/** Expected raw connection-string format per engine (shown as the paste placeholder/hint). */
const RAW_HINT: Record<DbEngine, string> = {
  mssql: "Server=tcp:HOST,1433;Database=DB;Integrated Security=True;TrustServerCertificate=True",
  postgres: "postgresql://user:pass@host:5432/dbname",
  mysql: "mysql://user:pass@host:3306/dbname",
  oracle: "user/password@//host:1521/service",
  sqlite: "C:\\path\\to\\app.db",
};

interface DetectProbe { engine: DbEngine; port: number; proc: string }
type DetectRow = DetectProbe & { open: boolean; running: boolean };

interface ConnStatus { state: "unknown" | "ok" | "fail"; version?: string; error?: string }

/** Engine-specific SQL to list databases on a server (SQLite is file-based → none). */
const DB_LIST_SQL: Record<DbEngine, string> = {
  postgres: "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname",
  mssql: "SELECT name FROM sys.databases ORDER BY name",
  mysql: "SHOW DATABASES",
  oracle: "SELECT name FROM v$database",
  sqlite: "",
};

/** Local engines to probe: default TCP port + a process-name marker. */
const LOCAL_PROBES: DetectProbe[] = [
  { engine: "mssql", port: 1433, proc: "sqlservr" },
  { engine: "postgres", port: 5432, proc: "postgres" },
  { engine: "mysql", port: 3306, proc: "mysqld" },
  { engine: "oracle", port: 1521, proc: "tnslsnr" },
];

export function DatabaseToolkit() {
  const connections = useDbStore((s) => s.connections);
  const activeId = useDbStore((s) => s.activeId);
  const setActive = useDbStore((s) => s.setActive);
  const upsert = useDbStore((s) => s.upsert);
  const remove = useDbStore((s) => s.remove);
  const duplicate = useDbStore((s) => s.duplicate);
  const setPassword = useDbStore((s) => s.setPassword);
  const passwords = useDbStore((s) => s.passwords);
  const pushHistory = useDbStore((s) => s.pushHistory);
  const history = useDbStore((s) => s.history);
  const clearHistory = useDbStore((s) => s.clearHistory);
  const importConnections = useDbStore((s) => s.importConnections);
  const importFileRef = useRef<HTMLInputElement>(null);

  function exportConnections() {
    if (connections.length === 0) { toast.error("No connections to export"); return; }
    const blob = new Blob([serializeConnections(connections)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "devhelper-connections.json";
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${connections.length} connection${connections.length === 1 ? "" : "s"}`);
  }

  function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const n = importConnections(parseConnectionsFile(String(reader.result)));
        toast.success(`Imported ${n} connection${n === 1 ? "" : "s"}`);
      } catch (err) {
        toast.error(`Import failed: ${(err as Error).message}`);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  const active = connections.find((c) => c.id === activeId) ?? null;

  const activeEnv = useApiStore((s) => s.environments.find((e) => e.id === s.activeEnvId));
  const envDbRefs = (activeEnv?.connections ?? []).filter((c) => c.kind === "database");
  const connHistory = active ? history.filter((h) => h.connId === active.id) : [];

  const [editing, setEditing] = useState<DbConnection | null>(null);
  const [tab, setTab] = useState<Tab>("query");
  const [objects, setObjects] = useState<DbObject[]>([]);
  const [objFilter, setObjFilter] = useState("");
  const [sql, setSql] = useState("SELECT 1;");
  const [maxRows, setMaxRows] = useState(1000);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<null | "test" | "objects" | "query">(null);
  const [confirmRisk, setConfirmRisk] = useState(false);
  const [codeGen, setCodeGen] = useState<CodeGen | null>(null);
  const [detected, setDetected] = useState<DetectRow[] | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [status, setStatus] = useState<Record<string, ConnStatus>>({});
  const [databases, setDatabases] = useState<string[]>([]);
  const [loadingDbs, setLoadingDbs] = useState(false);
  const [details, setDetails] = useState<DbObject | null>(null);

  const runSql = useCallback(
    async (sql: string, maxRows = 200): Promise<QueryResult> => {
      if (!active) throw new Error("No active connection");
      return invokeNative<QueryResult>("db_query", { engine: active.engine, connStr: buildConnString(active, passwords[active.id] ?? ""), sql, maxRows });
    },
    [active, passwords],
  );

  const activeStatus: ConnStatus = (active && status[active.id]) || { state: "unknown" };
  const mark = (id: string, s: ConnStatus) => setStatus((cur) => ({ ...cur, [id]: s }));

  async function detectLocal() {
    if (!isTauri()) return;
    setDetecting(true);
    try {
      const procs = await invokeNative<{ name: string }[]>("list_processes", {}).catch(() => []);
      const rows = await Promise.all(
        LOCAL_PROBES.map(async (p) => {
          const tcp = await invokeNative<{ open: boolean }>("tcp_check", { host: "localhost", port: p.port }).catch(() => ({ open: false }));
          const running = procs.some((pr) => pr.name.toLowerCase().includes(p.proc));
          return { ...p, open: tcp.open, running };
        }),
      );
      setDetected(rows);
    } finally {
      setDetecting(false);
    }
  }

  function createFromDetected(p: DetectRow) {
    const label = DB_ENGINES.find((e) => e.id === p.engine)?.label ?? p.engine;
    setEditing({
      ...blankConnection(),
      engine: p.engine,
      name: `Local ${label}`,
      host: "localhost",
      port: p.port,
      integratedSecurity: p.engine === "mssql",
      trustServerCertificate: true,
    });
  }

  const engineReady = (e: DbEngine) => DB_ENGINES.find((x) => x.id === e)?.ready ?? false;
  const needsPassword =
    !!active && active.engine !== "sqlite" && !active.integratedSecurity && !active.usesRawConnString && !passwords[active.id];

  const connString = () => (active ? buildConnString(active, passwords[active.id] ?? "") : "");

  const findings = useMemo(() => analyzeSql(sql), [sql]);
  const risk = highestRisk(findings);

  async function testConn(conn: DbConnection) {
    if (!isTauri()) return;
    setBusy("test");
    setError("");
    try {
      const version = await invokeNative<string>("db_test", { engine: conn.engine, connStr: buildConnString(conn, passwords[conn.id] ?? "") });
      mark(conn.id, { state: "ok", version });
      toast.success(`Connected — ${version.slice(0, 60)}`);
    } catch (e) {
      const msg = (e as Error).message;
      mark(conn.id, { state: "fail", error: msg });
      setError(msg);
      toast.error("Connection failed");
    } finally {
      setBusy(null);
    }
  }

  async function listDatabases() {
    if (!active || !isTauri() || !DB_LIST_SQL[active.engine]) return;
    setLoadingDbs(true);
    setError("");
    try {
      const r = await invokeNative<QueryResult>("db_query", {
        engine: active.engine,
        connStr: connString(),
        sql: DB_LIST_SQL[active.engine],
        maxRows: 500,
      });
      setDatabases(r.rows.map((row) => row[0] ?? "").filter(Boolean));
      mark(active.id, { state: "ok", version: activeStatus.version });
    } catch (e) {
      const msg = (e as Error).message;
      mark(active.id, { state: "fail", error: msg });
      setError(msg);
    } finally {
      setLoadingDbs(false);
    }
  }

  function switchDatabase(name: string) {
    if (!active) return;
    upsert({ ...active, database: name });
    setObjects([]);
    setResult(null);
    toast.success(`Database → ${name}`);
  }

  async function loadObjects() {
    if (!active || !isTauri()) return;
    setBusy("objects");
    setError("");
    try {
      setObjects(await invokeNative<DbObject[]>("db_objects", { engine: active.engine, connStr: connString() }));
      mark(active.id, { state: "ok", version: activeStatus.version });
    } catch (e) {
      const msg = (e as Error).message;
      mark(active.id, { state: "fail", error: msg });
      setError(msg);
    } finally {
      setBusy(null);
    }
  }

  async function runQuery() {
    if (!active || !isTauri()) return;
    // Safe mode blocks any write/DDL outright.
    if (active.safeMode && isWriteSql(sql)) {
      toast.error("Safe mode is on for this connection — writes and schema changes are blocked.");
      return;
    }
    // Risky statements require an explicit confirm first.
    if (risk && !confirmRisk) {
      setConfirmRisk(true);
      return;
    }
    setBusy("query");
    setError("");
    setResult(null);
    try {
      const r = await invokeNative<QueryResult>("db_query", {
        engine: active.engine,
        connStr: connString(),
        sql,
        maxRows,
      });
      setResult(r);
      setConfirmRisk(false);
      mark(active.id, { state: "ok", version: activeStatus.version });
      pushHistory({ connId: active.id, sql, ok: true, rowCount: r.rowCount });
    } catch (e) {
      const msg = (e as Error).message;
      mark(active.id, { state: "fail", error: msg });
      setError(msg);
      pushHistory({ connId: active.id, sql, ok: false });
    } finally {
      setBusy(null);
    }
  }

  function selectFrom(obj: DbObject) {
    const qualified = obj.schema ? `${obj.schema}.${obj.name}` : obj.name;
    setSql(`SELECT * FROM ${qualified} LIMIT 100;`);
    setTab("query");
  }


  const filteredObjects = objects.filter((o) => o.name.toLowerCase().includes(objFilter.toLowerCase()));

  return (
    <ToolShell
      toolId="database-toolkit"
      title="Database Toolkit"
      description="Connect to PostgreSQL or SQLite, explore objects, run queries with safe-mode, export results and generate code."
      requiresNative
      actions={
        <Button size="sm" variant="outline" onClick={() => setEditing(blankConnection())}>
          <Plus /> New connection
        </Button>
      }
    >
      {!isTauri() && <NativeNotice what="Database connections" />}

      <div className="grid grid-cols-[260px_1fr] gap-4">
        {/* Connections rail */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Connections</div>
            <div className="flex items-center gap-0.5">
              <input ref={importFileRef} type="file" accept=".json,application/json" className="hidden" onChange={onImportFile} />
              <button title="Export connections" aria-label="Export connections" className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={exportConnections}><Download className="size-3.5" /></button>
              <button title="Import connections" aria-label="Import connections" className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={() => importFileRef.current?.click()}><Upload className="size-3.5" /></button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={!isTauri() || detecting} onClick={detectLocal}>
                <RefreshCw className={cn("size-3.5", detecting && "animate-spin")} /> Detect
              </Button>
            </div>
          </div>

          {envDbRefs.length > 0 && (
            <select
              value=""
              onChange={(e) => {
                const ref = envDbRefs.find((r) => r.id === e.target.value);
                if (ref) setEditing({ ...dbConnectionFromEnvRef(ref, activeEnv!.name), id: "" });
              }}
              className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
              title="Prefill a connection from the active environment"
            >
              <option value="">From environment ({activeEnv?.name})…</option>
              {envDbRefs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          )}

          {detected && (
            <div className="rounded-md border border-border bg-secondary/30 p-2">
              <div className="mb-1 text-[11px] font-medium text-muted-foreground">Local servers</div>
              <div className="flex flex-col gap-1">
                {detected.map((d) => {
                  const label = DB_ENGINES.find((e) => e.id === d.engine)?.label ?? d.engine;
                  const found = d.open || d.running;
                  return (
                    <div key={d.engine} className="flex items-center gap-1.5 text-[11px]">
                      <span className={cn("size-2 rounded-full", d.open ? "bg-success" : d.running ? "bg-warning" : "bg-muted-foreground/40")} />
                      <span className="truncate">{label}</span>
                      <span className="text-muted-foreground">:{d.port}</span>
                      <span className="ml-auto text-muted-foreground">
                        {d.open ? "port open" : d.running ? "process up" : "not found"}
                      </span>
                      {found && d.engine !== "oracle" && (
                        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" onClick={() => createFromDetected(d)}>Use</Button>
                      )}
                    </div>
                  );
                })}
                <p className="mt-1 text-[10px] text-muted-foreground">Green = port reachable · amber = process running but port closed (check TCP/IP + firewall).</p>
              </div>
            </div>
          )}

          {connections.length === 0 && <p className="text-sm text-muted-foreground">No connections yet.</p>}
          {connections.map((c) => {
            const eng = DB_ENGINES.find((e) => e.id === c.engine);
            return (
              <button
                key={c.id}
                onClick={() => setActive(c.id)}
                className={cn(
                  "group rounded-md border px-3 py-2 text-left transition-colors",
                  c.id === activeId ? "border-primary/50 bg-primary/10" : "border-border hover:bg-secondary",
                )}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      status[c.id]?.state === "ok" ? "bg-success" : status[c.id]?.state === "fail" ? "bg-destructive" : "bg-muted-foreground/40",
                    )}
                    title={status[c.id]?.state === "ok" ? "Connected" : status[c.id]?.state === "fail" ? status[c.id]?.error ?? "Failed" : "Not tested"}
                  />
                  <DbIcon className="size-4 shrink-0 text-indigo-500" />
                  <span className="truncate text-sm font-medium">{c.name}</span>
                  {c.isProduction && <Badge variant="destructive" className="ml-auto shrink-0">PROD</Badge>}
                </div>
                <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {eng?.label} · {connTarget(c)}
                </div>
                <div className="mt-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <IconBtn title="Edit" onClick={(e) => { e.stopPropagation(); setEditing(c); }}><Code2 className="size-3.5" /></IconBtn>
                  <IconBtn title="Duplicate" onClick={(e) => { e.stopPropagation(); const id = duplicate(c.id); if (id) toast.success("Duplicated"); }}><Files className="size-3.5" /></IconBtn>
                  <IconBtn title="Delete" onClick={(e) => { e.stopPropagation(); remove(c.id); }}><Trash2 className="size-3.5 text-destructive" /></IconBtn>
                </div>
              </button>
            );
          })}
        </div>

        {/* Main panel */}
        <div className="min-w-0">
          {editing ? (
            <ConnectionForm
              initial={editing}
              onCancel={() => setEditing(null)}
              onSave={(conn) => {
                const id = upsert(conn);
                setActive(id);
                setEditing(null);
                toast.success("Connection saved");
              }}
            />
          ) : !active ? (
            <div className="grid h-64 place-items-center text-sm text-muted-foreground">
              Select or create a connection to begin.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {/* Active connection header */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{active.name}</span>
                <Badge variant="secondary">{DB_ENGINES.find((e) => e.id === active.engine)?.label}</Badge>
                <StatusBadge status={activeStatus} />
                {active.safeMode && <Badge variant="warning" className="gap-1"><ShieldAlert className="size-3" /> Safe mode</Badge>}
                {!engineReady(active.engine) && <Badge variant="warning">Not supported yet</Badge>}
                <div className="ml-auto flex gap-1">
                  <Button size="sm" variant="outline" disabled={!isTauri() || busy !== null || needsPassword} onClick={() => testConn(active)}>
                    <Plug /> Test
                  </Button>
                </div>
              </div>

              {activeStatus.state === "ok" && activeStatus.version && (
                <div className="flex items-center gap-1.5 rounded-md border border-success/40 bg-success/10 p-2 text-xs">
                  <CheckCircle2 className="size-3.5 text-success" />
                  <span className="truncate">Connected — {activeStatus.version}</span>
                </div>
              )}

              {needsPassword && (
                <PasswordUnlock
                  onSubmit={(pw) => setPassword(active.id, pw)}
                />
              )}

              {/* Database picker (server engines only) */}
              {active.engine !== "sqlite" && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground">Database</span>
                  {databases.length > 0 ? (
                    <select
                      value={active.database ?? ""}
                      onChange={(e) => switchDatabase(e.target.value)}
                      className="h-8 min-w-40 rounded-md border border-input bg-transparent px-2 text-sm"
                    >
                      {!databases.includes(active.database ?? "") && <option value={active.database ?? ""}>{active.database || "(none)"}</option>}
                      {databases.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  ) : (
                    <span className="text-xs text-muted-foreground">{active.database || "(none)"}</span>
                  )}
                  <Button size="sm" variant="ghost" className="h-8" disabled={!isTauri() || loadingDbs || needsPassword} onClick={listDatabases}>
                    <RefreshCw className={cn("size-3.5", loadingDbs && "animate-spin")} /> {databases.length ? "Refresh" : "List databases"}
                  </Button>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
                  <span className="min-w-0 flex-1 break-words">{error}</span>
                  <AddToDebug
                    variant="ghost"
                    label="Debug"
                    makeEvent={() => ({
                      source: "database" as const,
                      status: "error" as const,
                      title: `${active.engine} · ${firstLine(sql)} → failed`,
                      service: active.name,
                      error,
                      payload: JSON.stringify({ sql, engine: active.engine }),
                    })}
                  />
                </div>
              )}

              {/* Tabs */}
              <div className="flex gap-1 border-b border-border">
                {(["query", "explorer", "monitor"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => { setTab(t); if (t === "explorer" && objects.length === 0) loadObjects(); }}
                    className={cn("px-3 py-1.5 text-sm capitalize", tab === t ? "border-b-2 border-primary text-primary" : "text-muted-foreground")}
                  >
                    {t}
                  </button>
                ))}
              </div>

              {tab === "explorer" ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <Input value={objFilter} onChange={(e) => setObjFilter(e.target.value)} placeholder="Filter objects…" className="max-w-xs" />
                    <Button size="sm" variant="outline" disabled={!isTauri() || busy !== null || needsPassword} onClick={loadObjects}>
                      <RefreshCw className={cn(busy === "objects" && "animate-spin")} /> Refresh
                    </Button>
                    <span className="text-xs text-muted-foreground">{filteredObjects.length} objects</span>
                  </div>
                  <div className="overflow-hidden rounded-md border border-border">
                    {filteredObjects.length === 0 ? (
                      <p className="p-3 text-sm text-muted-foreground">No objects loaded.</p>
                    ) : (
                      filteredObjects.map((o, i) => {
                        const Icon = OBJECT_ICON[o.kind];
                        return (
                          <div key={`${o.schema}.${o.name}-${i}`} className={cn("flex items-center gap-2 px-3 py-1.5", i > 0 && "border-t border-border")}>
                            <Icon className="size-4 text-muted-foreground" />
                            <span className="text-sm">{o.schema ? `${o.schema}.` : ""}{o.name}</span>
                            <Badge variant="outline" className="ml-1 text-[10px]">{o.kind}</Badge>
                            <div className="ml-auto flex gap-1">
                              <Button size="sm" variant="ghost" onClick={() => setDetails(o)}>Details</Button>
                              {(o.kind === "table" || o.kind === "view") && (
                                <Button size="sm" variant="ghost" onClick={() => selectFrom(o)}>SELECT</Button>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {details && active && (
                    <DbObjectDetails
                      key={`${details.schema}.${details.name}`}
                      obj={details}
                      engine={active.engine}
                      runSql={runSql}
                      onClose={() => setDetails(null)}
                      onSelect={() => selectFrom(details)}
                    />
                  )}
                </div>
              ) : tab === "monitor" ? (
                <DbMonitor engine={active.engine} runSql={runSql} />
              ) : (
                <div className="flex flex-col gap-2">
                  <Textarea
                    mono
                    value={sql}
                    onChange={(e) => { setSql(e.target.value); setConfirmRisk(false); }}
                    onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !busy && !needsPassword && engineReady(active.engine)) { e.preventDefault(); runQuery(); } }}
                    className="min-h-32"
                    placeholder="Write SQL… (Ctrl+Enter to run)"
                  />

                  {risk && (
                    <div className={cn(
                      "rounded-md border p-2 text-sm",
                      risk === "destructive" ? "border-destructive/50 bg-destructive/10 text-destructive" : "border-warning/50 bg-warning/10",
                    )}>
                      <div className="flex items-center gap-1.5 font-medium">
                        <TriangleAlert className="size-4" /> {findings.length} risky statement{findings.length === 1 ? "" : "s"} detected
                      </div>
                      <ul className="mt-1 list-disc pl-5 text-xs">
                        {findings.slice(0, 4).map((f, i) => <li key={i}>{f.message}</li>)}
                      </ul>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant={confirmRisk ? "destructive" : "default"}
                      disabled={!isTauri() || busy !== null || needsPassword || !engineReady(active.engine)}
                      onClick={runQuery}
                    >
                      <Play /> {busy === "query" ? "Running…" : confirmRisk ? "Run anyway" : "Run"}
                    </Button>
                    {confirmRisk && <Button size="sm" variant="ghost" onClick={() => setConfirmRisk(false)}>Cancel</Button>}
                    {connHistory.length > 0 && (
                      <select
                        value=""
                        onChange={(e) => { if (e.target.value) setSql(e.target.value); }}
                        className="h-8 max-w-[240px] rounded-md border border-input bg-transparent px-2 text-xs"
                        title="Query history for this connection"
                      >
                        <option value="">History ({connHistory.length})…</option>
                        {connHistory.map((h) => (
                          <option key={h.id} value={h.sql}>{h.ok ? "" : "✗ "}{firstLine(h.sql)}</option>
                        ))}
                      </select>
                    )}
                    {connHistory.length > 0 && (
                      <Button size="sm" variant="ghost" title="Clear history" onClick={() => clearHistory(active.id)}><Trash2 /></Button>
                    )}
                    <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                      Max rows
                      <Input type="number" value={maxRows} min={1} max={5000} onChange={(e) => setMaxRows(Math.max(1, Math.min(5000, Number(e.target.value) || 1000)))} className="h-8 w-24" />
                    </label>
                  </div>

                  {result && (
                    <ResultView
                      result={result}
                      codeGen={codeGen}
                      setCodeGen={setCodeGen}
                      debugEvent={() => ({
                        source: "database" as const,
                        status: "ok" as const,
                        title: `${active.engine} · ${firstLine(sql)} (${result.rowCount} rows)`,
                        service: active.name,
                        durationMs: result.elapsedMs,
                        payload: JSON.stringify({ sql, rowCount: result.rowCount, columns: result.columns }),
                      })}
                    />
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </ToolShell>
  );
}

function IconBtn({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: (e: React.MouseEvent) => void }) {
  return (
    <span role="button" title={title} onClick={onClick} className="rounded p-1 hover:bg-secondary">
      {children}
    </span>
  );
}

function blankConnection(): DbConnection {
  return { id: "", name: "New connection", engine: "postgres", host: "localhost", port: 5432, database: "", user: "", safeMode: true };
}

function PasswordUnlock({ onSubmit }: { onSubmit: (pw: string) => void }) {
  const [pw, setPw] = useState("");
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit(pw); }}
      className="flex items-center gap-2 rounded-md border border-border bg-secondary/40 p-2"
    >
      <span className="text-xs text-muted-foreground">Password (session only, never saved):</span>
      <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} className="h-8 max-w-xs" autoFocus />
      <Button size="sm" type="submit" disabled={!pw}>Unlock</Button>
    </form>
  );
}

function ConnectionForm({ initial, onSave, onCancel }: { initial: DbConnection; onSave: (c: DbConnection) => void; onCancel: () => void }) {
  const [c, setC] = useState<DbConnection>(initial);
  const patch = (p: Partial<DbConnection>) => setC((cur) => ({ ...cur, ...p }));
  const isFile = c.engine === "sqlite";

  return (
    <div className="max-w-lg rounded-lg border border-border p-4">
      <h3 className="mb-3 text-sm font-semibold">{initial.id ? "Edit" : "New"} connection</h3>
      <div className="flex flex-col gap-3">
        <Field label="Name"><Input value={c.name} onChange={(e) => patch({ name: e.target.value })} /></Field>
        <Field label="Engine">
          <select
            value={c.engine}
            onChange={(e) => { const engine = e.target.value as DbEngine; patch({ engine, port: DEFAULT_PORTS[engine] }); }}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          >
            {DB_ENGINES.map((e) => <option key={e.id} value={e.id}>{e.label}{e.ready ? "" : " (needs special build)"}</option>)}
          </select>
        </Field>
        {DB_ENGINES.find((e) => e.id === c.engine)?.note && (
          <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-[11px]">
            {DB_ENGINES.find((e) => e.id === c.engine)?.note}
          </p>
        )}

        {isFile ? (
          <Field label="Database file path">
            <Input value={c.filePath ?? ""} onChange={(e) => patch({ filePath: e.target.value })} placeholder="C:\\path\\to\\app.db" />
            <Hint>Absolute path to a .db / .sqlite file. It is created if it does not exist.</Hint>
          </Field>
        ) : (
          <>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!c.usesRawConnString} onChange={(e) => patch({ usesRawConnString: e.target.checked })} />
              Paste a connection string (advanced)
            </label>

            {c.usesRawConnString ? (
              <Field label="Connection string">
                <Textarea mono value={c.rawConnString ?? ""} onChange={(e) => patch({ rawConnString: e.target.value })} className="min-h-24" placeholder={RAW_HINT[c.engine]} />
                <Hint>
                  Passed straight to the driver — expected format: <span className="mono">{RAW_HINT[c.engine]}</span>.
                  Not saved to disk (may contain a password); re-paste it each session.
                </Hint>
              </Field>
            ) : (
              <>
                <div className="grid grid-cols-[1fr_120px] gap-2">
                  <Field label="Host"><Input value={c.host ?? ""} onChange={(e) => patch({ host: e.target.value })} placeholder="localhost" /></Field>
                  <Field label="Port"><Input type="number" value={c.port ?? 0} onChange={(e) => patch({ port: Number(e.target.value) })} /></Field>
                </div>
                {c.engine === "mssql" && (
                  <Hint>
                    Local default port is <b>1433</b>. A named instance like <b>SQLEXPRESS</b> uses a dynamic port —
                    find it in SQL Server Configuration Manager → Protocols → TCP/IP → IP Addresses → TCP Dynamic Ports,
                    and enter that port here. Make sure TCP/IP is <b>enabled</b> for the instance.
                  </Hint>
                )}
                <Field label="Database"><Input value={c.database ?? ""} onChange={(e) => patch({ database: e.target.value })} placeholder={c.engine === "mssql" ? "master" : ""} /></Field>

                {c.engine === "mssql" && (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={!!c.integratedSecurity} onChange={(e) => patch({ integratedSecurity: e.target.checked })} />
                    Windows authentication (integrated security)
                  </label>
                )}

                {!(c.engine === "mssql" && c.integratedSecurity) && (
                  <Field label="User">
                    <Input value={c.user ?? ""} onChange={(e) => patch({ user: e.target.value })} placeholder={c.engine === "mssql" ? "sa" : ""} />
                    {c.engine === "mssql" && <Hint>SQL login. Requires the server to allow <b>SQL Server &amp; Windows Authentication mode</b> (mixed mode). If only Windows auth is enabled, tick the box above instead.</Hint>}
                  </Field>
                )}

                {c.engine === "mssql" && (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={c.trustServerCertificate !== false} onChange={(e) => patch({ trustServerCertificate: e.target.checked })} />
                    Trust server certificate (needed for local/self-signed)
                  </label>
                )}
              </>
            )}
          </>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Field label="Environment"><Input value={c.environment ?? ""} onChange={(e) => patch({ environment: e.target.value })} placeholder="DEV / QA / PROD" /></Field>
          <div className="flex flex-col justify-end gap-2 pb-1">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!c.isProduction} onChange={(e) => patch({ isProduction: e.target.checked })} /> Production</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!c.safeMode} onChange={(e) => patch({ safeMode: e.target.checked })} /> Safe mode (block writes)</label>
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground">Passwords are entered per session and never stored on disk.</p>

        <div className="flex gap-2">
          <Button size="sm" onClick={() => onSave(c)} disabled={!c.name.trim()}>Save</Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: ConnStatus }) {
  if (status.state === "ok") return <Badge variant="success" className="gap-1"><CheckCircle2 className="size-3" /> Connected</Badge>;
  if (status.state === "fail") return <Badge variant="destructive" className="gap-1" title={status.error}><XCircle className="size-3" /> Failed</Badge>;
  return <Badge variant="outline" className="gap-1 text-muted-foreground"><Circle className="size-3" /> Not tested</Badge>;
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] leading-snug text-muted-foreground">{children}</p>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function firstLine(sql: string): string {
  const s = sql.trim().split("\n")[0].slice(0, 60);
  return s + (sql.trim().length > s.length ? "…" : "");
}

function ResultView({ result, codeGen, setCodeGen, debugEvent }: { result: QueryResult; codeGen: CodeGen | null; setCodeGen: (c: CodeGen | null) => void; debugEvent: () => import("@/tools/lib/debugSession").ParsedEvent }) {
  const cols = useMemo(() => inferColumns(result), [result]);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<{ col: number; dir: "asc" | "desc" } | null>(null);
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [gridPage, setGridPage] = useState(0);

  const generated = useMemo(() => {
    if (!codeGen) return "";
    if (codeGen === "csharp-class") return toCsharpClass(cols);
    if (codeGen === "csharp-record") return toCsharpRecord(cols);
    if (codeGen === "ef-entity") return toEfEntity(cols);
    if (codeGen === "ts-interface") return toTsInterface(cols);
    return toJsonExample(result, cols);
  }, [codeGen, cols, result]);

  // Filter, then sort, keeping the original row index for the detail/INSERT view.
  const view = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let rows = result.rows.map((row, idx) => ({ row, idx }));
    if (q) rows = rows.filter(({ row }) => row.some((c) => (c ?? "").toLowerCase().includes(q)));
    if (sort) {
      const { col, dir } = sort;
      rows = [...rows].sort((a, b) => {
        const av = a.row[col] ?? "", bv = b.row[col] ?? "";
        const na = Number(av), nb = Number(bv);
        const cmp = !Number.isNaN(na) && !Number.isNaN(nb) && av !== "" && bv !== "" ? na - nb : av.localeCompare(bv);
        return dir === "asc" ? cmp : -cmp;
      });
    }
    return rows;
  }, [result.rows, filter, sort]);

  const cycleSort = (col: number) =>
    setSort((cur) => (cur?.col !== col ? { col, dir: "asc" } : cur.dir === "asc" ? { col, dir: "desc" } : null));

  // Paginate the (filtered + sorted) view so we never render thousands of DOM rows at once.
  const GRID_PAGE = 100;
  const totalPages = Math.max(1, Math.ceil(view.length / GRID_PAGE));
  const pageClamped = Math.min(gridPage, totalPages - 1);
  const pageRows = view.slice(pageClamped * GRID_PAGE, pageClamped * GRID_PAGE + GRID_PAGE);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{result.rowCount} row{result.rowCount === 1 ? "" : "s"}</span>
        <span>· {result.elapsedMs} ms</span>
        {result.truncated && <Badge variant="warning">truncated to {result.rows.length}</Badge>}
        {result.columns.length > 0 && (
          <Input value={filter} onChange={(e) => { setFilter(e.target.value); setGridPage(0); }} placeholder="Filter rows…" className="h-7 w-40" />
        )}
        {filter && <span>{view.length} match</span>}
        {view.length > GRID_PAGE && (
          <span className="flex items-center gap-1">
            <Button size="sm" variant="ghost" className="h-6 px-1" disabled={pageClamped === 0} onClick={() => setGridPage(pageClamped - 1)}>‹</Button>
            page {pageClamped + 1}/{totalPages}
            <Button size="sm" variant="ghost" className="h-6 px-1" disabled={pageClamped >= totalPages - 1} onClick={() => setGridPage(pageClamped + 1)}>›</Button>
          </span>
        )}
        <div className="ml-auto flex gap-1">
          <AddToDebug makeEvent={debugEvent} label="Debug" variant="ghost" />
          <CopyButton value={toCsv(result)} label="CSV" />
          <CopyButton value={JSON.stringify(toObjects(result), null, 2)} label="JSON" />
          <select
            value={codeGen ?? ""}
            onChange={(e) => setCodeGen((e.target.value || null) as CodeGen | null)}
            className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
          >
            <option value="">Generate code…</option>
            <option value="csharp-class">C# class</option>
            <option value="csharp-record">C# record</option>
            <option value="ef-entity">EF Core entity</option>
            <option value="ts-interface">TS interface</option>
            <option value="json">JSON example</option>
          </select>
        </div>
      </div>

      {generated && (
        <div className="relative rounded-md border border-border bg-secondary/30 p-3">
          <CopyButton value={generated} className="absolute right-2 top-2" />
          <pre className="mono overflow-x-auto whitespace-pre pr-16 text-xs">{generated}</pre>
        </div>
      )}

      {result.columns.length > 0 ? (
        <div className="max-h-[420px] overflow-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 border-b border-border bg-card text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 font-medium">#</th>
                {result.columns.map((col, ci) => (
                  <th key={col} onClick={() => cycleSort(ci)} className="cursor-pointer select-none whitespace-nowrap px-3 py-1.5 font-medium hover:text-foreground" title="Click to sort">
                    {col}{sort?.col === ci ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pageRows.map(({ row, idx }) => (
                <tr key={idx} className={cn("cursor-pointer hover:bg-secondary/40", openRow === idx && "bg-primary/5")} onClick={() => setOpenRow(openRow === idx ? null : idx)}>
                  <td className="px-2 py-1 text-xs text-muted-foreground">{idx + 1}</td>
                  {row.map((cell, ci) => (
                    <td key={ci} className={cn("mono max-w-[360px] truncate px-3 py-1", cell === null && "italic text-muted-foreground")} title={cell ?? "NULL"}>
                      {cell === null ? "NULL" : cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Statement executed. {result.rowCount} row(s) affected.</p>
      )}

      {openRow !== null && result.rows[openRow] && (
        <div className="rounded-md border border-border bg-secondary/20 p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Row {openRow + 1}</span>
            <div className="ml-auto flex gap-1">
              <CopyButton value={toInsert(result.columns, result.rows[openRow])} label="INSERT" />
              <CopyButton value={JSON.stringify(rowObject(result, openRow), null, 2)} label="JSON" />
              <Button size="sm" variant="ghost" onClick={() => setOpenRow(null)}>Close</Button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            {result.columns.map((col, ci) => (
              <div key={col} className="flex gap-2 text-xs">
                <span className="min-w-32 shrink-0 text-muted-foreground">{col}</span>
                <span className={cn("mono break-all", result.rows[openRow][ci] === null && "italic text-muted-foreground")}>{result.rows[openRow][ci] ?? "NULL"}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function rowObject(r: QueryResult, idx: number): Record<string, string | null> {
  const o: Record<string, string | null> = {};
  r.columns.forEach((c, i) => (o[c] = r.rows[idx][i]));
  return o;
}

function toObjects(r: QueryResult): Record<string, string | null>[] {
  return r.rows.map((row) => {
    const o: Record<string, string | null> = {};
    r.columns.forEach((c, i) => (o[c] = row[i]));
    return o;
  });
}

function toCsv(r: QueryResult): string {
  const esc = (v: string | null) => {
    const s = v ?? "";
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = r.columns.map(esc).join(",");
  const body = r.rows.map((row) => row.map(esc).join(",")).join("\n");
  return `${head}\n${body}`;
}
