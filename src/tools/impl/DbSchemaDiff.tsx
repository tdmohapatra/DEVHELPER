import { useMemo, useRef, useState } from "react";
import { ArrowLeftRight, Download, Upload, GitCompare, ChevronRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/CopyButton";
import { toast } from "@/components/ui/toast";
import { invokeNative, isTauri } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { useDbStore } from "@/stores/useDbStore";
import { buildConnString, DB_ENGINES, type DbConnection, type QueryResult } from "@/tools/lib/dbTypes";
import {
  allColumnsQuery,
  buildSnapshot,
  mergePages,
  serializeSnapshot,
  parseSnapshotFile,
  SNAPSHOT_BLIND_SPOTS,
  type SchemaSnapshot,
} from "@/tools/lib/dbSnapshot";
import {
  DEFAULT_DIFF_OPTIONS,
  diffSchemas,
  changedTables,
  migrationSql,
  diffSummary,
  type DiffOptions,
  type TableDiff,
  type ColumnDiff,
} from "@/tools/lib/dbDiff";
import { pageableStatement, pagedSql } from "@/tools/lib/dbPaging";

/** Matches the native hard cap, so one request is one page. */
const SNAPSHOT_PAGE = 5000;
/** 100k columns of headroom before we assume something has gone wrong. */
const MAX_SNAPSHOT_PAGES = 20;

const OPTION_LABELS: { key: keyof DiffOptions; label: string; hint: string }[] = [
  { key: "ignoreCase", label: "Ignore case", hint: "Match table and column names case-insensitively." },
  { key: "ignoreSchema", label: "Ignore schema", hint: "Match on bare table name — needed when one side has no schemas." },
  { key: "ignoreDefaults", label: "Ignore defaults", hint: "Skip column defaults, which differ cosmetically across engines." },
  { key: "ignoreOrder", label: "Ignore column order", hint: "Skip ordinal position." },
  { key: "ignoreTypeAliases", label: "Fold type aliases", hint: "Treat int4 and integer, or nvarchar and varchar, as the same type." },
];

export function DbSchemaDiff() {
  const connections = useDbStore((s) => s.connections);
  const passwords = useDbStore((s) => s.passwords);
  const activeId = useDbStore((s) => s.activeId);

  const [imports, setImports] = useState<SchemaSnapshot[]>([]);
  const [leftRef, setLeftRef] = useState(activeId ? `conn:${activeId}` : "");
  const [rightRef, setRightRef] = useState("");
  const [left, setLeft] = useState<SchemaSnapshot | null>(null);
  const [right, setRight] = useState<SchemaSnapshot | null>(null);
  const [options, setOptions] = useState<DiffOptions>(DEFAULT_DIFF_OPTIONS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [changedOnly, setChangedOnly] = useState(true);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [showSql, setShowSql] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const diff = useMemo(() => (left && right ? diffSchemas(left, right, options) : null), [left, right, options]);

  const visible = useMemo(() => {
    if (!diff) return [];
    const rows = changedOnly ? changedTables(diff) : diff.tables;
    const q = filter.trim().toLowerCase();
    return q ? rows.filter((t) => `${t.schema ?? ""}.${t.name}`.toLowerCase().includes(q)) : rows;
  }, [diff, changedOnly, filter]);

  /**
   * Read a whole schema, one page at a time.
   *
   * A truncated snapshot would report its missing columns as deletions, so the
   * query is walked to the end rather than capped. The statement carries its own
   * ORDER BY, which is what makes paging over it stable.
   */
  async function capture(conn: DbConnection): Promise<SchemaSnapshot> {
    const sql = allColumnsQuery(conn.engine);
    const q = pageableStatement(sql);
    if (!q) throw new Error("Internal: the snapshot query is not pageable");
    const connStr = buildConnString(conn, passwords[conn.id] ?? "");
    const pages: QueryResult[] = [];
    for (let p = 0; p < MAX_SNAPSHOT_PAGES; p++) {
      const page = await invokeNative<QueryResult>("db_query", {
        engine: conn.engine,
        connStr,
        sql: pagedSql(conn.engine, q, p * SNAPSHOT_PAGE, SNAPSHOT_PAGE),
        maxRows: SNAPSHOT_PAGE,
      });
      pages.push(page);
      if (page.rows.length < SNAPSHOT_PAGE) break;
      if (p === MAX_SNAPSHOT_PAGES - 1) {
        throw new Error(`Schema is larger than ${MAX_SNAPSHOT_PAGES * SNAPSHOT_PAGE} columns; the comparison would be incomplete.`);
      }
    }
    return buildSnapshot(conn.engine, conn.name, mergePages(pages), Date.now());
  }

  async function resolve(ref: string): Promise<SchemaSnapshot> {
    if (ref.startsWith("snap:")) {
      const s = imports[Number(ref.slice(5))];
      if (!s) throw new Error("That snapshot is no longer loaded");
      return s;
    }
    const conn = connections.find((c) => c.id === ref.slice(5));
    if (!conn) throw new Error("Pick a connection on both sides");
    if (!isTauri()) throw new Error("Reading a live schema needs the desktop app");
    const needsPassword = conn.engine !== "sqlite" && !conn.integratedSecurity && !conn.usesRawConnString && !passwords[conn.id];
    if (needsPassword) throw new Error(`${conn.name} is locked — open it in the Query tab and enter its password first.`);
    return capture(conn);
  }

  async function compare() {
    if (!leftRef || !rightRef) {
      setError("Pick a schema on both sides.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      // Sequential on purpose: two connections to the same server at once is a
      // needless way to trip a connection limit, and this is not a hot path.
      const l = await resolve(leftRef);
      const r = await resolve(rightRef);
      setLeft(l);
      setRight(r);
      setOpen({});
    } catch (e) {
      setError((e as Error).message);
      setLeft(null);
      setRight(null);
    } finally {
      setBusy(false);
    }
  }

  function swap() {
    setLeftRef(rightRef);
    setRightRef(leftRef);
    setLeft(right);
    setRight(left);
  }

  function exportSnapshot(snapshot: SchemaSnapshot | null) {
    if (!snapshot) return;
    const blob = new Blob([serializeSnapshot(snapshot)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${snapshot.label.replace(/[^\w.-]+/g, "-")}-schema.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${snapshot.tables.length} tables`);
  }

  function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const snapshot = parseSnapshotFile(String(reader.result));
        // `imports` is the list as of this render, which is also the index the
        // new snapshot lands on — one file is read at a time.
        setRightRef(`snap:${imports.length}`);
        setImports((cur) => [...cur, snapshot]);
        toast.success(`Loaded ${snapshot.label} (${snapshot.tables.length} tables)`);
      } catch (err) {
        toast.error(`Import failed: ${(err as Error).message}`);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  const blindSpots = [left, right]
    .filter((s): s is SchemaSnapshot => !!s)
    .map((s) => SNAPSHOT_BLIND_SPOTS[s.engine])
    .filter((v, i, a): v is string => !!v && a.indexOf(v) === i);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <SidePicker label="Baseline" value={leftRef} onChange={setLeftRef} connections={connections} imports={imports} />
        <Button size="sm" variant="ghost" className="h-8" title="Swap sides" onClick={swap}><ArrowLeftRight className="size-3.5" /></Button>
        <SidePicker label="Compare with" value={rightRef} onChange={setRightRef} connections={connections} imports={imports} />
        <Button size="sm" disabled={busy || !leftRef || !rightRef} onClick={compare}>
          {busy ? <RefreshCw className="size-3.5 animate-spin" /> : <GitCompare className="size-3.5" />} {busy ? "Reading…" : "Compare"}
        </Button>
        <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={onImportFile} />
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => fileRef.current?.click()}>
          <Upload className="size-3.5" /> Load snapshot
        </Button>
      </div>

      <p className="text-[11px] leading-snug text-muted-foreground">
        Changes are described from the baseline's point of view: "added" means the other side has it. A saved snapshot
        can be compared later from a machine that cannot reach the server it came from.
      </p>

      {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{error}</div>}

      {diff && (
        <>
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
            <span className="font-medium">{diff.leftLabel}</span>
            <ChevronRight className="size-3.5 text-muted-foreground" />
            <span className="font-medium">{diff.rightLabel}</span>
            <span className="text-muted-foreground">· {diffSummary(diff)}</span>
            <div className="ml-auto flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => exportSnapshot(left)}><Download className="size-3.5" /> Baseline</Button>
              <Button size="sm" variant="ghost" onClick={() => exportSnapshot(right)}><Download className="size-3.5" /> Other</Button>
            </div>
          </div>

          {blindSpots.map((note) => (
            <p key={note} className="text-[11px] text-warning">{note}</p>
          ))}

          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {OPTION_LABELS.map((o) => (
              <label key={o.key} className="flex items-center gap-1.5" title={o.hint}>
                <input type="checkbox" checked={options[o.key]} onChange={(e) => setOptions({ ...options, [o.key]: e.target.checked })} />
                {o.label}
              </label>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter tables…" className="h-8 max-w-xs" />
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input type="checkbox" checked={changedOnly} onChange={(e) => setChangedOnly(e.target.checked)} />
              Changed only
            </label>
            <span className="text-xs text-muted-foreground">{visible.length} table{visible.length === 1 ? "" : "s"}</span>
            <Button size="sm" variant="outline" className="ml-auto" onClick={() => setShowSql((v) => !v)}>
              {showSql ? "Hide" : "Show"} migration SQL
            </Button>
          </div>

          {showSql && left && (
            <div className="relative rounded-md border border-border bg-secondary/30 p-3">
              <CopyButton value={migrationSql(left.engine, diff)} className="absolute right-2 top-2" />
              <pre className="mono max-h-80 overflow-auto whitespace-pre-wrap pr-16 text-xs">{migrationSql(left.engine, diff)}</pre>
            </div>
          )}

          {diff.identical ? (
            <p className="text-sm text-muted-foreground">No differences under the current options.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {visible.map((t) => (
                <TableRow key={t.key} table={t} open={!!open[t.key]} onToggle={() => setOpen((o) => ({ ...o, [t.key]: !o[t.key] }))} />
              ))}
              {visible.length === 0 && <p className="text-sm text-muted-foreground">Nothing matches that filter.</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SidePicker({ label, value, onChange, connections, imports }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  connections: DbConnection[];
  imports: SchemaSnapshot[];
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 min-w-[180px] rounded-md border border-input bg-transparent px-2 text-xs"
      >
        <option value="">Select…</option>
        <optgroup label="Connections">
          {connections.map((c) => (
            <option key={c.id} value={`conn:${c.id}`}>
              {c.name} ({DB_ENGINES.find((e) => e.id === c.engine)?.label ?? c.engine})
            </option>
          ))}
        </optgroup>
        {imports.length > 0 && (
          <optgroup label="Loaded snapshots">
            {imports.map((s, i) => <option key={i} value={`snap:${i}`}>{s.label}</option>)}
          </optgroup>
        )}
      </select>
    </label>
  );
}

const KIND_VARIANT = {
  added: "success",
  removed: "destructive",
  changed: "warning",
  same: "outline",
} as const;

function TableRow({ table, open, onToggle }: { table: TableDiff; open: boolean; onToggle: () => void }) {
  const changed = table.columns.filter((c) => c.kind !== "same");
  const name = table.schema ? `${table.schema}.${table.name}` : table.name;
  return (
    <div className="rounded-md border border-border">
      <button onClick={onToggle} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-secondary/40">
        <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        <span className="mono">{name}</span>
        <Badge variant={KIND_VARIANT[table.kind]} className="text-[10px]">{table.kind}</Badge>
        {table.kind === "changed" && (
          <span className="text-xs text-muted-foreground">{changed.length} column{changed.length === 1 ? "" : "s"}</span>
        )}
      </button>
      {open && (
        <div className="border-t border-border px-3 py-2">
          {table.columns.length === 0 ? (
            <p className="text-xs text-muted-foreground">No columns.</p>
          ) : (
            <table className="w-full text-xs">
              <tbody className="divide-y divide-border">
                {(table.kind === "changed" ? changed : table.columns).map((c) => <ColumnRow key={c.name} column={c} />)}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function ColumnRow({ column }: { column: ColumnDiff }) {
  const shape = column.right ?? column.left;
  return (
    <tr>
      <td className="w-6 py-1">
        <Badge variant={KIND_VARIANT[column.kind]} className="px-1 text-[9px]">{column.kind[0].toUpperCase()}</Badge>
      </td>
      <td className="mono py-1 pr-3">{column.name}</td>
      <td className="py-1 text-muted-foreground">
        {column.kind === "changed"
          ? column.changes.join(" · ")
          : `${shape?.type ?? ""}${shape && !shape.nullable ? " NOT NULL" : ""}${shape?.pk ? " · PK" : ""}`}
      </td>
    </tr>
  );
}
