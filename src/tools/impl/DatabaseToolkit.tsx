import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  KeyRound,
  Wand2,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/CopyButton";
import { AddToDebug } from "@/components/AddToDebug";
import { NativeNotice } from "@/components/NativeNotice";
import { Tips } from "@/components/Tips";
import { toast } from "@/components/ui/toast";
import { invokeNative, isTauri } from "@/lib/platform";
import { log } from "@/lib/logBus";
import { cn } from "@/lib/utils";
import { useDbStore } from "@/stores/useDbStore";
import { useApiStore } from "@/stores/useApiStore";
import {
  DB_ENGINES,
  DEFAULT_PORTS,
  buildConnString,
  connectionProblems,
  connTarget,
  looksLikeSecret,
  dbConnectionFromEnvRef,
  serializeConnections,
  parseConnectionsFile,
  type DbConnection,
  type DbEngine,
  type DbObject,
  type QueryResult,
} from "@/tools/lib/dbTypes";
import {
  pageableStatement,
  pagedSql,
  countSql,
  pageLabel,
  lastPageIndex,
  type PageableQuery,
} from "@/tools/lib/dbPaging";
import {
  parseMssqlConnString,
  convertRawConnection,
  formatServerAddress,
  explainMssqlError,
  type MssqlInstance,
} from "@/tools/lib/mssqlConn";
import { serviceNameFor } from "@/lib/tips";
import { credentialKey, credentialLabel, findCredential } from "@/tools/lib/credentials";
import { analyzeSql, isWriteSql, highestRisk } from "@/tools/lib/sqlSafety";
import {
  editorLanguage,
  formatterDialect,
  selectPreviewSql,
  sqlCompletions,
  sqlMarkers,
} from "@/tools/lib/sqlEditor";
import { formatSql } from "@/tools/lib/sql";
import { CodeEditor, type EditorMarker } from "@/components/CodeEditor";
import { DbObjectDetails } from "@/tools/impl/DbObjectDetails";
import { DbMonitor } from "@/tools/impl/DbMonitor";
import { DbSchemaDiff } from "@/tools/impl/DbSchemaDiff";
import {
  inferColumns,
  toCsharpClass,
  toCsharpRecord,
  toEfEntity,
  toTsInterface,
  toJsonExample,
  toInsert,
} from "@/tools/lib/dbCodegen";

type Tab = "explorer" | "query" | "monitor" | "diff";
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

/** Conventional local defaults, so a detected server produces a connection that can actually open. */
const ENGINE_DEFAULTS: Record<DbEngine, { user?: string; database?: string }> = {
  postgres: { user: "postgres", database: "postgres" },
  mysql: { user: "root", database: "mysql" },
  mssql: { database: "master" },
  oracle: { user: "system", database: "XEPDB1" },
  sqlite: {},
};

interface DetectProbe { engine: DbEngine; port: number; proc: string }
type DetectRow = DetectProbe & {
  open: boolean;
  running: boolean;
  /** SQL Server only: the named instance this row stands for. */
  instance?: string;
  /** Overrides the engine label in the list. */
  label?: string;
  /** SQL Server only: false when the TCP/IP protocol is switched off. */
  tcpEnabled?: boolean;
  /** SQL Server only: registry name, needed by the fix command. */
  internalName?: string;
};

interface ConnStatus { state: "unknown" | "ok" | "fail"; version?: string; error?: string }

/** Engine-specific SQL to list databases on a server (SQLite is file-based → none). */
const DB_LIST_SQL: Record<DbEngine, string> = {
  postgres: "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname",
  // Offline, restoring and inaccessible databases are dropped: picking one only
  // produces "Cannot open database", which reads as a broken tool.
  mssql: "SELECT name FROM sys.databases WHERE state = 0 AND HAS_DBACCESS(name) = 1 ORDER BY name",
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
  const credentials = useDbStore((s) => s.credentials);
  const rememberCredential = useDbStore((s) => s.rememberCredential);
  const applyCredential = useDbStore((s) => s.applyCredential);
  const forgetCredential = useDbStore((s) => s.forgetCredential);
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
  // Server-side paging for the editor result. `paged` is the statement captured at
  // run time, so the pager keeps walking the query that produced the grid even after
  // the editor text is edited. Null means the statement was not pageable.
  const [paged, setPaged] = useState<PageableQuery | null>(null);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  /** Page size frozen at run time — editing Max rows must not shift the offsets mid-walk. */
  const [pageSize, setPageSize] = useState(1000);
  /** Bumped per run so a slow COUNT(*) cannot land on a later query's result. */
  const runToken = useRef(0);
  /**
   * Bumped once per query run, and used as the result grid's key.
   *
   * The grid keeps its own filter, sort and page. Without a new key those carry
   * into the next query's result, and a filter left over from an earlier query
   * hides every row of the new one while the header still reports a success.
   * Paging does not bump it — a filter should survive stepping through pages of
   * the same query.
   */
  const [resultKey, setResultKey] = useState(0);
  /** Id of a raw-string connection that just connected and could be saved as fields. */
  const [offerConvert, setOfferConvert] = useState<string | null>(null);
  const [convertNotes, setConvertNotes] = useState<string[]>([]);

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
      setDetected(await expandMssqlInstances(rows));
    } finally {
      setDetecting(false);
    }
  }

  /**
   * Replace the fixed 1433 row with one row per real instance. A local SQL Server is
   * usually a named instance on a dynamic port, where probing 1433 reports "process up,
   * port closed" and tells the user nothing about where to connect.
   */
  async function expandMssqlInstances(rows: DetectRow[]): Promise<DetectRow[]> {
    const base = rows.find((r) => r.engine === "mssql");
    if (!base || (!base.running && !base.open)) return rows;

    const instances = await invokeNative<MssqlInstance[]>("mssql_instances", { host: "localhost" }).catch((e) => {
      // Not fatal — fall back to the fixed-port row, but say why in the log.
      log.warn("db:detect", `Instance discovery failed: ${e instanceof Error ? e.message : String(e)}`);
      return [] as MssqlInstance[];
    });
    if (instances.length === 0) {
      log.warn("db:detect", "No SQL Server instances reported; showing the default port probe only.");
      return rows;
    }
    log.success(
      "db:detect",
      `Found ${instances.length} SQL Server instance(s)`,
      instances
        .map((i) => {
          const tcp = i.tcpEnabled === false ? "TCP/IP DISABLED" : i.tcpEnabled ? "tcp on" : "tcp unknown";
          return `${i.instance}:${i.tcpPort ?? "no port"} (${tcp}${i.internalName ? `, ${i.internalName}` : ""})`;
        })
        .join(", "),
    );

    const expanded: DetectRow[] = await Promise.all(
      instances.map(async (i) => {
        const port = i.tcpPort ?? base.port;
        const tcp = await invokeNative<{ open: boolean }>("tcp_check", { host: "localhost", port }).catch(() => ({
          open: false,
        }));
        const isDefault = i.instance.toLowerCase() === "mssqlserver";
        return {
          engine: "mssql" as DbEngine,
          proc: base.proc,
          port,
          open: tcp.open,
          running: true,
          instance: isDefault ? undefined : i.instance,
          label: isDefault ? "SQL Server" : `SQL Server \\${i.instance}`,
          tcpEnabled: i.tcpEnabled ?? undefined,
          internalName: i.internalName ?? undefined,
        };
      }),
    );

    return rows.flatMap((r) => (r.engine === "mssql" ? expanded : [r]));
  }

  function createFromDetected(p: DetectRow) {
    const label = DB_ENGINES.find((e) => e.id === p.engine)?.label ?? p.engine;
    const defaults = ENGINE_DEFAULTS[p.engine];
    setEditing({
      ...blankConnection(),
      engine: p.engine,
      name: p.instance ? `Local SQL Server (${p.instance})` : `Local ${label}`,
      host: p.instance ? `localhost\\${p.instance}` : "localhost",
      port: p.port,
      // Without a user and database, PostgreSQL and MySQL reject the connection string
      // outright ("invalid configuration") — prefill the conventional local values.
      database: defaults.database,
      user: defaults.user,
      integratedSecurity: p.engine === "mssql",
      trustServerCertificate: true,
    });
  }

  // A password verified against one database on a server opens the others too, so it is
  // applied to the active connection without asking again.
  const reused = active ? findCredential(credentials, active) : undefined;
  useEffect(() => {
    if (active && !passwords[active.id] && applyCredential(active)) {
      log.info("db:credentials", `Reused the saved password for ${credentialKey(active)}`);
    }
  }, [active, passwords, applyCredential]);

  const engineReady = (e: DbEngine) => DB_ENGINES.find((x) => x.id === e)?.ready ?? false;
  const needsPassword =
    !!active && active.engine !== "sqlite" && !active.integratedSecurity && !active.usesRawConnString && !passwords[active.id];

  const connString = () => (active ? buildConnString(active, passwords[active.id] ?? "") : "");

  const findings = useMemo(() => analyzeSql(sql), [sql]);
  const risk = highestRisk(findings);

  const engine = active?.engine ?? "sqlite";
  /** Risk findings as editor squiggles: destructive is an error, the rest warnings. */
  const editorMarkers = useMemo<EditorMarker[]>(
    () => sqlMarkers(sql).map((m) => ({
      start: m.start,
      end: m.end,
      severity: m.risk === "destructive" ? "error" : "warning",
      message: m.message,
    })),
    [sql],
  );
  // A getter, not a list: the suggest widget then always reads the objects and
  // result columns loaded at the moment the user typed.
  const completions = useCallback(
    () => sqlCompletions({ engine, objects, columns: result?.columns }),
    [engine, objects, result],
  );

  function formatQuery() {
    try {
      setSql(formatSql(sql, { language: formatterDialect(engine), uppercase: true, tabWidth: 2 }));
    } catch (e) {
      toast.error(`Could not format this SQL: ${(e as Error).message}`);
    }
  }

  async function testConn(conn: DbConnection) {
    if (!isTauri()) return;
    // Catch missing fields here: the drivers report them as unreadable configuration errors.
    const problems = connectionProblems(conn);
    if (problems.length > 0) {
      const msg = `This connection is incomplete:\n${problems.map((p) => `• ${p}`).join("\n")}`;
      mark(conn.id, { state: "fail", error: msg });
      setError(msg);
      log.warn("db:test", "Blocked an incomplete connection", problems.join(" "));
      return;
    }
    setBusy("test");
    setError("");
    try {
      const password = passwords[conn.id] ?? "";
      const version = await invokeNative<string>("db_test", { engine: conn.engine, connStr: buildConnString(conn, password) });
      mark(conn.id, { state: "ok", version });
      // Only a password that actually opened a connection is worth keeping.
      if (password) {
        rememberCredential(conn, password);
        const key = credentialKey(conn);
        if (key) log.success("db:credentials", `Remembered the password for ${key} (this session only)`);
      }
      // A pasted string is never written to disk, so this connection would be gone
      // next session. Now that it is known to work, offer to keep it.
      setOfferConvert(conn.usesRawConnString && conn.engine === "mssql" ? conn.id : null);
      setConvertNotes([]);
      toast.success(`Connected — ${version.slice(0, 60)}`);
    } catch (e) {
      const raw = (e as Error).message;
      // SQL Server failures are cryptic; add the fix when the cause is recognisable.
      const hint = conn.engine === "mssql" ? explainMssqlError(raw) : null;
      const msg = hint ? `${raw}\n\n${hint}` : raw;
      mark(conn.id, { state: "fail", error: msg });
      setError(msg);
      toast.error("Connection failed");
    } finally {
      setBusy(null);
    }
  }

  /**
   * Keep a working pasted connection string as a normal saved connection.
   *
   * The string itself stays off disk. Its server, database and login move into the
   * persisted fields, and its password goes to the session store and the credential
   * vault — the same place a typed password lives.
   */
  function convertRaw(conn: DbConnection) {
    try {
      const { conn: next, password, notes } = convertRawConnection(conn);
      upsert(next);
      if (password) {
        setPassword(next.id, password);
        rememberCredential(next, password);
      }
      mark(next.id, { state: "ok", version: status[next.id]?.version });
      setOfferConvert(null);
      setConvertNotes(notes);
      log.success("db:convert", `Saved ${next.name} as fields`, notes.join(" ") || undefined);
      toast.success("Saved — this connection is now available on every start.");
    } catch (e) {
      toast.error((e as Error).message);
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
    setPaged(null);
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
    // A single windowless SELECT can be walked page by page instead of being cut
    // off at Max rows. Anything else runs exactly as written.
    const q = pageableStatement(sql);
    const token = ++runToken.current;
    setResultKey((k) => k + 1);
    setPaged(q);
    setPage(0);
    setTotal(null);
    setPageSize(maxRows);
    setBusy("query");
    setError("");
    setResult(null);
    try {
      const r = await invokeNative<QueryResult>("db_query", {
        engine: active.engine,
        connStr: connString(),
        sql: q ? pagedSql(active.engine, q, 0, maxRows) : sql,
        maxRows,
      });
      setResult(r);
      setConfirmRisk(false);
      mark(active.id, { state: "ok", version: activeStatus.version });
      pushHistory({ connId: active.id, sql, ok: true, rowCount: r.rowCount });
      // Naming the database matters as much as the count: "0 rows" from the wrong
      // database looks identical to "0 rows" from the right one.
      log.success(
        "db:query",
        `${r.rowCount} row(s) · ${active.database || "server default database"} · ${active.name}`,
        firstLine(sql),
      );
      // A total makes the pager exact. Without one it can still step forward for
      // as long as pages come back full, so this stays best-effort.
      if (q) loadTotal(q, token);
    } catch (e) {
      const msg = (e as Error).message;
      mark(active.id, { state: "fail", error: msg });
      setError(msg);
      setPaged(null);
      pushHistory({ connId: active.id, sql, ok: false });
    } finally {
      setBusy(null);
    }
  }

  /**
   * Row count for the whole result set, in the background.
   *
   * Deliberately silent on failure: COUNT(*) has to wrap the statement in a
   * derived table, which a query with duplicate column names rejects. An
   * unknown total is a working pager, not an error worth showing.
   */
  async function loadTotal(q: PageableQuery, token: number) {
    if (!active) return;
    const sql = countSql(active.engine, q);
    if (!sql) return;
    try {
      const c = await invokeNative<QueryResult>("db_query", { engine: active.engine, connStr: connString(), sql, maxRows: 1 });
      const n = Number(c.rows[0]?.[0]);
      if (Number.isFinite(n) && runToken.current === token) setTotal(n);
    } catch {
      /* total stays unknown */
    }
  }

  /** Re-run the captured statement windowed to another page. */
  async function goPage(p: number) {
    if (!active || !paged || p < 0 || busy !== null) return;
    setBusy("query");
    setError("");
    try {
      const r = await invokeNative<QueryResult>("db_query", {
        engine: active.engine,
        connStr: connString(),
        sql: pagedSql(active.engine, paged, p * pageSize, pageSize),
        maxRows: pageSize,
      });
      setResult(r);
      setPage(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function selectFrom(obj: DbObject) {
    // Engine-aware: LIMIT is not valid T-SQL, and identifiers may need quoting.
    setSql(selectPreviewSql(engine, obj));
    setTab("query");
  }


  const filteredObjects = objects.filter((o) => o.name.toLowerCase().includes(objFilter.toLowerCase()));

  const lastPage = lastPageIndex(total, pageSize);
  // With no total, a full page is the only evidence that more rows may exist.
  const atLastPage = lastPage !== null ? page >= lastPage : (result?.rows.length ?? 0) < pageSize;

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
                  const label = d.label ?? DB_ENGINES.find((e) => e.id === d.engine)?.label ?? d.engine;
                  const found = d.open || d.running;
                  return (
                    <div key={`${d.engine}:${d.instance ?? ""}:${d.port}`} className="flex items-center gap-1.5 text-[11px]">
                      <span className={cn("size-2 rounded-full", d.open ? "bg-success" : d.running ? "bg-warning" : "bg-muted-foreground/40")} />
                      <span className="truncate">{label}</span>
                      <span className="text-muted-foreground">:{d.port}</span>
                      <span className="ml-auto text-muted-foreground">
                        {d.tcpEnabled === false
                          ? "TCP/IP off"
                          : d.open
                            ? "port open"
                            : d.running
                              ? "process up"
                              : "not found"}
                      </span>
                      {found && d.engine !== "oracle" && (
                        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" onClick={() => createFromDetected(d)}>Use</Button>
                      )}
                    </div>
                  );
                })}
                <p className="mt-1 text-[10px] text-muted-foreground">Green = port reachable · amber = process running but port closed (check TCP/IP + firewall).</p>
                {detected.some((d) => d.tcpEnabled === false) && (
                  <div className="mt-1 flex flex-col gap-1">
                    <p className="text-[10px] text-destructive">
                      SQL Server is running with TCP/IP switched off. SSMS still works over Shared Memory, but no TCP
                      driver — including this one — can connect until it is enabled.
                    </p>
                    <Tips
                      error="10061"
                      domain="mssql"
                      context={(() => {
                        const off = detected.find((d) => d.tcpEnabled === false);
                        return {
                          internalName: off?.internalName,
                          serviceName: serviceNameFor(off?.instance),
                          host: "localhost",
                        };
                      })()}
                    />
                  </div>
                )}
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
              onSave={(conn, password) => {
                const id = upsert(conn);
                // A password pasted inside a connection string stays session-only.
                if (password) setPassword(id, password);
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
                {reused && passwords[active.id] && (
                  <Badge variant="secondary" className="gap-1" title={`Verified ${new Date(reused.verifiedAt).toLocaleTimeString()} — held in memory only`}>
                    <KeyRound className="size-3" /> {credentialLabel(reused)}
                    <button
                      className="ml-1 text-muted-foreground hover:text-destructive"
                      title="Forget this password"
                      aria-label="Forget this password"
                      onClick={() => {
                        forgetCredential(reused.key);
                        setPassword(active.id, "");
                        log.info("db:credentials", `Forgot the password for ${reused.key}`);
                      }}
                    >
                      <X className="size-3" />
                    </button>
                  </Badge>
                )}
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

              {offerConvert === active.id && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/40 bg-primary/5 p-2 text-xs">
                  <KeyRound className="size-3.5 shrink-0" />
                  <span>
                    This connection is a pasted string, which is never written to disk — it would be gone next start.
                    Save its server, database and login as fields to keep it.
                  </span>
                  <div className="ml-auto flex gap-1">
                    <Button size="sm" onClick={() => convertRaw(active)}>Save connection</Button>
                    <Button size="sm" variant="ghost" onClick={() => setOfferConvert(null)}>Not now</Button>
                  </div>
                </div>
              )}

              {convertNotes.length > 0 && (
                <div className="rounded-md border border-border bg-secondary/40 p-2 text-[11px]">
                  <div className="mb-1 flex items-center gap-2 font-medium">
                    Saved with these changes
                    <button className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => setConvertNotes([])}>
                      <X className="size-3" />
                    </button>
                  </div>
                  <ul className="list-disc pl-4">{convertNotes.map((n, i) => <li key={i}>{n}</li>)}</ul>
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
                  <span className="min-w-0 flex-1 whitespace-pre-line break-words">{error}</span>
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

              {error && (
                <Tips
                  error={error}
                  domain={active.engine}
                  compact
                  context={{
                    host: (active.host || "localhost").split("\\")[0],
                    port: active.port ?? DEFAULT_PORTS[active.engine],
                    target: active.database,
                    serviceName: serviceNameFor(active.host?.split("\\")[1]),
                  }}
                />
              )}

              {/* Tabs */}
              <div className="flex gap-1 border-b border-border">
                {(["query", "explorer", "monitor", "diff"] as const).map((t) => (
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
              ) : tab === "diff" ? (
                <DbSchemaDiff />
              ) : (
                <div className="flex flex-col gap-2">
                  <CodeEditor
                    value={sql}
                    onChange={(v) => { setSql(v); setConfirmRisk(false); }}
                    language={editorLanguage(active.engine)}
                    markers={editorMarkers}
                    completions={completions}
                    onRun={() => { if (!busy && !needsPassword && engineReady(active.engine)) runQuery(); }}
                    onFormat={formatQuery}
                    height={220}
                    placeholder="Write SQL… (Ctrl+Enter to run, Ctrl+Space for suggestions)"
                    ariaLabel="SQL query editor"
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
                    <Button size="sm" variant="outline" onClick={formatQuery} title="Format SQL (Ctrl+Shift+F)">
                      <Wand2 /> Format
                    </Button>
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

                  {result && paged && (
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Button size="sm" variant="outline" className="h-7" disabled={busy !== null || page === 0} onClick={() => goPage(page - 1)}>
                        <ChevronLeft className="size-3.5" /> Prev
                      </Button>
                      <Button size="sm" variant="outline" className="h-7" disabled={busy !== null || atLastPage} onClick={() => goPage(page + 1)}>
                        Next <ChevronRight className="size-3.5" />
                      </Button>
                      <span>{pageLabel(page * pageSize, result.rows.length, total)}</span>
                      {lastPage !== null && <span>· page {page + 1} of {lastPage + 1}</span>}
                      <Button size="sm" variant="ghost" className="h-7" title="Reload this page" onClick={() => goPage(page)}>
                        <RefreshCw className={cn("size-3.5", busy === "query" && "animate-spin")} />
                      </Button>
                      {(total === null || total > result.rows.length) && (
                        <span className="text-[11px]">Copy and export cover this page only.</span>
                      )}
                    </div>
                  )}

                  {result && (
                    <ResultView
                      key={resultKey}
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

function ConnectionForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: DbConnection;
  onSave: (c: DbConnection, password?: string) => void;
  onCancel: () => void;
}) {
  const [c, setC] = useState<DbConnection>(initial);
  const [pastedPassword, setPastedPassword] = useState<string | undefined>();
  /** What a connection-string conversion changed or dropped. */
  const [convertNotes, setConvertNotes] = useState<string[]>([]);
  const patch = (p: Partial<DbConnection>) => setC((cur) => ({ ...cur, ...p }));
  const isFile = c.engine === "sqlite";

  // A password already proven for this server account covers this connection too, so the
  // form says so instead of demanding it again.
  const credentials = useDbStore((s) => s.credentials);
  const knownCredential = findCredential(credentials, c);

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
                {c.engine === "mssql" && (c.rawConnString ?? "").trim() && (
                  <div className="flex flex-col gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="self-start"
                      onClick={() => {
                        try {
                          const { conn: next, password, notes } = convertRawConnection(c);
                          setC(next);
                          if (password) setPastedPassword(password);
                          setConvertNotes(notes);
                        } catch (e) {
                          toast.error((e as Error).message);
                        }
                      }}
                    >
                      Convert to fields
                    </Button>
                    <Hint>Fills the form below from the string so the connection is saved and reusable. The password moves to the session-only box.</Hint>
                    {convertNotes.map((n, i) => <p key={i} className="text-[11px] text-muted-foreground">• {n}</p>)}
                  </div>
                )}
              </Field>
            ) : (
              <>
                {c.engine === "mssql" && (
                  <MssqlQuickConnect
                    conn={c}
                    onFill={(fields, password) => {
                      patch(fields);
                      if (password !== undefined) setPastedPassword(password);
                    }}
                  />
                )}

                <div className="grid grid-cols-[1fr_120px] gap-2">
                  <Field label="Host"><Input value={c.host ?? ""} onChange={(e) => patch({ host: e.target.value })} placeholder="localhost" /></Field>
                  <Field label="Port">
                    <Input
                      type="number"
                      value={c.port ?? ""}
                      placeholder={c.engine === "mssql" ? "auto" : ""}
                      onChange={(e) => patch({ port: e.target.value === "" ? undefined : Number(e.target.value) })}
                    />
                  </Field>
                </div>
                {c.engine === "mssql" && (
                  <Hint>
                    Write a named instance straight into Host — <span className="mono">HOST\SQLEXPRESS</span> — and leave
                    Port empty; its dynamic port is resolved through the SQL Browser when you connect. A plain host uses{" "}
                    <b>1433</b> unless you set a port. TCP/IP must be <b>enabled</b> for the instance.
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
                  <>
                    <Field label="User">
                      <Input value={c.user ?? ""} onChange={(e) => patch({ user: e.target.value })} placeholder={c.engine === "mssql" ? "sa" : ""} />
                      {c.engine === "mssql" && <Hint>SQL login. Requires the server to allow <b>SQL Server &amp; Windows Authentication mode</b> (mixed mode). If only Windows auth is enabled, tick the box above instead.</Hint>}
                    </Field>
                    {/* Without a field here, users put the password in whatever box looks free —
                        and every other field on this form IS written to disk. */}
                    <Field label="Password (this session only)">
                      <Input
                        type="password"
                        autoComplete="off"
                        value={pastedPassword ?? ""}
                        onChange={(e) => setPastedPassword(e.target.value)}
                        placeholder={knownCredential ? "Using the stored password — type to override" : "Kept in memory, never written to disk"}
                      />
                      {knownCredential && !pastedPassword && (
                        <p className="flex items-center gap-1 text-[11px] text-success">
                          <KeyRound className="size-3" />
                          A verified password for {credentialLabel(knownCredential)} is already in memory and will be used.
                        </p>
                      )}
                      <Hint>
                        Held in memory until the app closes. Every other field on this form <b>is</b> saved to disk —
                        never type a password into Name, Environment or Database.
                      </Hint>
                    </Field>
                  </>
                )}

                {c.engine === "mssql" && (
                  <>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={c.trustServerCertificate !== false} onChange={(e) => patch({ trustServerCertificate: e.target.checked })} />
                      Trust server certificate (needed for local/self-signed)
                    </label>
                    {c.trustServerCertificate === false && (
                      <Hint>
                        The server's certificate will be verified. A self-signed or mismatched certificate will now be
                        rejected rather than accepted silently.
                      </Hint>
                    )}
                    <Field label="Encryption">
                      <select
                        value={c.encrypt === undefined ? "" : String(c.encrypt)}
                        onChange={(e) => patch({ encrypt: e.target.value === "" ? undefined : e.target.value === "true" })}
                        className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                      >
                        <option value="">Driver default</option>
                        <option value="true">Required (Encrypt=true)</option>
                        <option value="false">Off (Encrypt=false)</option>
                      </select>
                      <Hint>
                        Only sent when you choose one. A server with no certificate configured refuses
                        <span className="mono"> Encrypt=true</span>, so there is no safe default to impose.
                      </Hint>
                    </Field>
                  </>
                )}
              </>
            )}
          </>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Field label="Environment">
            <Input value={c.environment ?? ""} onChange={(e) => patch({ environment: e.target.value })} placeholder="DEV / QA / PROD" />
            {looksLikeSecret(c.environment) && (
              <p className="flex items-start gap-1 text-[11px] text-destructive">
                <TriangleAlert className="mt-0.5 size-3 shrink-0" />
                This looks like a password. Environment is a label (DEV / QA / PROD) and <b>is saved to disk</b> — put
                credentials in the Password field above.
              </p>
            )}
          </Field>
          <div className="flex flex-col justify-end gap-2 pb-1">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!c.isProduction} onChange={(e) => patch({ isProduction: e.target.checked })} /> Production</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!c.safeMode} onChange={(e) => patch({ safeMode: e.target.checked })} /> Safe mode (block writes)</label>
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground">Passwords are entered per session and never stored on disk.</p>

        <div className="flex gap-2">
          <Button size="sm" onClick={() => onSave(c, pastedPassword)} disabled={!c.name.trim()}>Save</Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The two things that actually block a SQL Server connection: not knowing which instances
 * exist, and having a connection string rather than fields. Both are handled here.
 */
function MssqlQuickConnect({
  conn,
  onFill,
}: {
  conn: DbConnection;
  onFill: (fields: Partial<DbConnection>, password?: string) => void;
}) {
  const [instances, setInstances] = useState<MssqlInstance[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const [paste, setPaste] = useState("");
  const [notes, setNotes] = useState<string[]>([]);
  const [showPaste, setShowPaste] = useState(false);

  // Scan the host already typed in, ignoring any instance suffix.
  const scanHost = (conn.host || "localhost").split("\\")[0] || "localhost";

  const discover = async () => {
    setScanning(true);
    setScanError("");
    setInstances(null);
    try {
      const found = await invokeNative<MssqlInstance[]>("mssql_instances", { host: scanHost });
      setInstances(found);
      if (found.length === 0) setScanError(`No instances reported by ${scanHost}.`);
    } catch (e) {
      const msg = String(e);
      setScanError([msg, explainMssqlError(msg)].filter(Boolean).join(" "));
    } finally {
      setScanning(false);
    }
  };

  const applyInstance = (i: MssqlInstance) => {
    const isDefault = i.instance.toLowerCase() === "mssqlserver";
    onFill({
      host: isDefault ? i.server : formatServerAddress(i.server, i.instance),
      // A resolved port is kept — it saves a SQL Browser round trip on every connect.
      port: i.tcpPort ?? undefined,
    });
    toast.success(`Using ${isDefault ? i.server : `${i.server}\\${i.instance}`}${i.tcpPort ? ` on port ${i.tcpPort}` : ""}`);
  };

  const applyPaste = () => {
    try {
      const { conn: fields, password, notes: parsedNotes } = parseMssqlConnString(paste);
      onFill(fields, password);
      setNotes(parsedNotes);
      toast.success("Fields filled from the connection string");
    } catch (e) {
      setNotes([]);
      toast.error(String(e instanceof Error ? e.message : e));
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium">Quick connect</span>
        <Button size="sm" variant="outline" disabled={!isTauri() || scanning} onClick={discover}>
          <RefreshCw className={cn(scanning && "animate-spin")} />
          {scanning ? "Scanning…" : `Find instances on ${scanHost}`}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setShowPaste((v) => !v)}>
          Paste a connection string
        </Button>
      </div>

      {!isTauri() && <Hint>Instance discovery needs the desktop app.</Hint>}

      {showPaste && (
        <div className="flex flex-col gap-2">
          <Textarea
            mono
            className="min-h-20 text-[12px]"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder={'Server=HOST\\SQLEXPRESS;Database=App;Integrated Security=True\njdbc:sqlserver://host:1433;databaseName=App;user=sa;password=…'}
          />
          <div>
            <Button size="sm" variant="outline" disabled={!paste.trim()} onClick={applyPaste}>
              Fill the fields
            </Button>
          </div>
          <Hint>Accepts an SSMS / ADO.NET / JDBC string. Any password in it is kept for this session only.</Hint>
        </div>
      )}

      {notes.length > 0 && (
        <ul className="list-disc pl-4 text-[11px] text-muted-foreground">
          {notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}

      {scanError && <p className="text-[11px] text-destructive">{scanError}</p>}

      {instances && instances.length > 0 && (
        <div className="flex flex-col gap-1">
          {instances.map((i) => (
            <button
              key={`${i.server}\\${i.instance}`}
              onClick={() => applyInstance(i)}
              className="flex items-center gap-2 rounded border border-border px-2 py-1 text-left text-xs hover:bg-muted"
            >
              <DbIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="font-medium">
                {i.instance.toLowerCase() === "mssqlserver" ? `${i.server} (default instance)` : `${i.server}\\${i.instance}`}
              </span>
              <span className="text-muted-foreground">{i.tcpPort ? `port ${i.tcpPort}` : "no TCP port"}</span>
              {i.tcpEnabled === false && <Badge variant="destructive" className="text-[10px]">TCP/IP off</Badge>}
              {i.version && <span className="ml-auto text-muted-foreground">v{i.version}</span>}
            </button>
          ))}
          <Hint>
            Found via {instances[0].source === "browser" ? "the SQL Browser" : "the local registry"}. Click one to fill Host and Port.
          </Hint>
          {instances.some((i) => i.tcpEnabled === false) && (
            <>
              <p className="text-[11px] text-destructive">
                An instance has the TCP/IP protocol disabled — it accepts Shared Memory connections (so SSMS works) but
                refuses every TCP driver, including this one. Enable TCP/IP and restart the service.
              </p>
              <Tips
                error="10061"
                domain="mssql"
                context={(() => {
                  const off = instances.find((i) => i.tcpEnabled === false);
                  return {
                    internalName: off?.internalName,
                    serviceName: serviceNameFor(off?.instance),
                    host: off?.server,
                  };
                })()}
              />
            </>
          )}
        </div>
      )}
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
          {/* An empty grid under a successful query reads as a broken tool unless it
              says which of the three reasons applies. */}
          {pageRows.length === 0 && (
            <p className="p-3 text-sm text-muted-foreground">
              {result.rows.length === 0
                ? "The query ran and matched no rows."
                : `All ${result.rows.length} fetched rows are hidden by the filter "${filter}".`}
            </p>
          )}
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
