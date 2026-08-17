import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, BookOpen, Copy, Play, TableIcon } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/CopyButton";
import { AddToDebug } from "@/components/AddToDebug";
import { executeRequest, corsLimited } from "@/lib/http";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  AUDIENCE,
  formatCell,
  innermostMessage,
  leadingTable,
  lintQuery,
  parseResult,
  queryAdvice,
  queryBody,
  queryHeaders,
  queryUrl,
  snippetsFor,
  tableToCsv,
  tableToObjects,
  TIME_RANGES,
  tokenCommand,
  type Backend,
  type KqlResult,
} from "@/tools/lib/kql";

const DEFAULT_QUERY = `AppRequests
| where TimeGenerated > ago(1h)
| summarize total = count(), failed = countif(Success == false) by Name
| where failed > 0
| top 20 by failed desc`;

export function KqlPad() {
  const [backend, setBackend] = useState<Backend>("loganalytics");
  const [id, setId] = useState("");
  // Credentials are held for this screen only — a bearer token is a login.
  const [token, setToken] = useState("");
  const [apiKey, setApiKey] = useState("");

  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [minutes, setMinutes] = useState(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<KqlResult | null>(null);
  const [tookMs, setTookMs] = useState(0);
  const [showSnippets, setShowSnippets] = useState(false);

  const hints = useMemo(() => lintQuery(query, minutes), [query, minutes]);
  const table = result?.primary ?? null;
  const snippets = useMemo(() => snippetsFor(backend), [backend]);

  const run = async () => {
    setBusy(true);
    setError("");
    try {
      const url = queryUrl({ backend, id });
      const headers = queryHeaders({ backend, id, token, apiKey });
      const res = await executeRequest({ method: "POST", url, headers, body: queryBody(query, minutes) }, undefined, { timeoutMs: 120000 });
      setTookMs(res.timeMs);

      let payload: unknown = null;
      try {
        payload = JSON.parse(res.body);
      } catch {
        payload = null;
      }

      if (!res.ok) {
        const detail = innermostMessage(payload);
        throw new Error(`${queryAdvice(res.status, backend)}${detail ? `\n\n${detail}` : `\n\n${res.body.slice(0, 400)}`}`);
      }

      const parsed = parseResult(payload);
      setResult(parsed);
      if ((parsed.primary?.rows.length ?? 0) === 0) {
        const named = leadingTable(query);
        toast.success(
          named
            ? `No rows. ${named} exists in this workspace or the query would have failed — the filter or the time range excluded everything.`
            : "The query ran and returned no rows.",
        );
      }
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : String(e));
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolShell
      toolId="kql-pad"
      title="KQL Pad"
      description="Query Log Analytics and Application Insights, with the cost mistakes flagged before you send them."
    >
      {corsLimited() && (
        <div className="mb-3 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
          Browser dev mode: the query APIs send no CORS headers. Use the desktop app.
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
        <F label="Backend">
          <select
            className="h-8 rounded-md border border-border bg-background px-2 text-sm"
            value={backend}
            onChange={(e) => setBackend(e.target.value as Backend)}
          >
            <option value="loganalytics">Log Analytics workspace</option>
            <option value="appinsights">Application Insights</option>
          </select>
        </F>
        <F label={backend === "loganalytics" ? "Workspace id" : "Application id"}>
          <Input className="h-8 w-[22rem]" value={id} onChange={(e) => setId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" />
        </F>
        <F label="Bearer token">
          <Input type="password" className="h-8 w-56" value={token} onChange={(e) => setToken(e.target.value)} placeholder={`for ${AUDIENCE[backend]}`} />
        </F>
        {backend === "appinsights" && (
          <F label="or API key">
            <Input type="password" className="h-8 w-40" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="X-API-Key" />
          </F>
        )}
        <div className="flex w-full items-center gap-2">
          <p className="text-[11px] text-muted-foreground">
            Held for this screen only, never saved. A token has to be issued for {AUDIENCE[backend]} — one for
            management.azure.com authenticates everywhere else and is refused here.
          </p>
          <CopyButton className="ml-auto shrink-0" value={tokenCommand(backend)} />
          <code className="mono shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px]">{tokenCommand(backend)}</code>
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-end gap-2">
        <F label="Time range">
          <select
            className="h-8 rounded-md border border-border bg-background px-2 text-sm"
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
          >
            {TIME_RANGES.map((r) => (
              <option key={r.minutes} value={r.minutes}>{r.label}</option>
            ))}
          </select>
        </F>
        <Button size="sm" onClick={run} disabled={busy}>
          <Play className={cn("size-3.5", busy && "animate-pulse")} /> Run
        </Button>
        <Button size="sm" variant="outline" onClick={() => setShowSnippets((v) => !v)}>
          <BookOpen className="size-3.5" /> {showSnippets ? "Hide" : "Snippets"}
        </Button>
        {table && (
          <>
            <Badge variant="outline">{table.rows.length.toLocaleString()} rows</Badge>
            <Badge variant="outline">{tookMs} ms</Badge>
            <Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(tableToCsv(table)).then(() => toast.success("CSV copied"))}>
              <Copy className="size-3.5" /> CSV
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => navigator.clipboard.writeText(JSON.stringify(tableToObjects(table), null, 2)).then(() => toast.success("JSON copied"))}
            >
              <Copy className="size-3.5" /> JSON
            </Button>
            <AddToDebug
              variant="ghost"
              label="Debug"
              makeEvent={() => ({
                source: "custom",
                status: "info",
                service: backend === "loganalytics" ? "Log Analytics" : "Application Insights",
                title: `KQL — ${leadingTable(query) ?? "query"} (${table.rows.length} rows)`,
                durationMs: tookMs,
                payload: JSON.stringify({ query, rows: tableToObjects(table).slice(0, 50) }),
              })}
            />
          </>
        )}
      </div>

      {/*
        A plain editor rather than Monaco: Monaco ships no Kusto grammar, and the
        value here is the linting below, which works on the text either way.
      */}
      <textarea
        className="mono min-h-[9rem] w-full rounded-md border border-border bg-background p-2 text-xs"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        spellCheck={false}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            run();
          }
        }}
      />

      {hints.length > 0 && (
        <div className="mt-2 flex flex-col gap-1 rounded-md border border-warning/40 bg-warning/5 p-2">
          {hints.map((h, i) => (
            <p key={i} className="text-[11px]">
              <AlertTriangle className={cn("mr-1 inline size-3", h.severity === "warn" ? "text-warning" : "text-muted-foreground")} />
              {h.message}
            </p>
          ))}
        </div>
      )}

      {showSnippets && (
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          {snippets.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setQuery(s.query);
                setShowSnippets(false);
              }}
              className="rounded-md border border-border p-2 text-left hover:bg-secondary/40"
            >
              <div className="text-xs font-medium">{s.title}</div>
              <div className="text-[11px] text-muted-foreground">{s.purpose}</div>
              <pre className="mono mt-1 max-h-24 overflow-hidden text-[10px] text-muted-foreground">{s.query}</pre>
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="mt-3 whitespace-pre-wrap rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {table && (
        <div className="mt-3 flex flex-col gap-1">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <TableIcon className="size-3" />
            {table.name}
            {result && result.tables.length > 1 && <span>· {result.tables.length - 1} statistics table(s) not shown</span>}
          </div>
          {table.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">The query ran and matched nothing.</p>
          ) : (
            <div className="max-h-[50vh] overflow-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 border-b border-border bg-card text-left text-muted-foreground">
                  <tr>
                    {table.columns.map((c) => (
                      <th key={c.name} className="whitespace-nowrap px-2 py-1 font-medium" title={c.type}>
                        {c.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {table.rows.slice(0, 500).map((row, i) => (
                    <tr key={i} className="hover:bg-secondary/40">
                      {row.map((cell, j) => {
                        const text = formatCell(cell);
                        return (
                          <td key={j} className="mono max-w-[360px] truncate px-2 py-1" title={text}>
                            {text}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {table.rows.length > 500 && (
            <p className="text-[11px] text-muted-foreground">
              Showing the first 500 of {table.rows.length.toLocaleString()} rows. Copy as CSV or JSON for all of them.
            </p>
          )}
        </div>
      )}
    </ToolShell>
  );
}

function F({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
