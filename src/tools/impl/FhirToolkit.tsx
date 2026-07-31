import { useMemo, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/CopyButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { executeRequest } from "@/lib/http";
import { log } from "@/lib/logBus";
import { validateFhir, summarizeFhir } from "@/tools/lib/fhir";
import {
  analyzeBundle,
  buildSearchUrl,
  extractTable,
  resourcesOf,
  toCsv,
  validateFhirResource,
  COMMON_SEARCH_PARAMS,
  DEFAULT_COLUMNS,
  FHIR_SERVERS,
  type SearchParam,
} from "@/tools/lib/fhirAdvanced";
import { formatJson, jsonToCSharp, DEFAULT_CSHARP_OPTIONS } from "@/tools/lib/json";

const SAMPLE = JSON.stringify(
  {
    resourceType: "Patient",
    id: "example",
    name: [{ given: ["John", "A"], family: "Doe" }],
    gender: "male",
    birthDate: "1980-01-01",
    identifier: [{ system: "urn:mrn", value: "12345" }],
  },
  null,
  2,
);

type View = "summary" | "validate" | "bundle" | "table" | "search" | "formatted" | "csharp";

export function FhirToolkit() {
  const [input, setInput] = useState(SAMPLE);
  const [view, setView] = useState<View>("summary");

  const [serverId, setServerId] = useState(FHIR_SERVERS[0].id);
  const [resourceType, setResourceType] = useState("Patient");
  const [params, setParams] = useState<SearchParam[]>([{ name: "_count", value: "5", enabled: true }]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  const validation = useMemo(() => validateFhir(input), [input]);
  const summary = useMemo(() => summarizeFhir(input), [input]);
  const formatted = useMemo(() => { try { return formatJson(input); } catch { return ""; } }, [input]);
  const csharp = useMemo(() => {
    try {
      return jsonToCSharp(input, { ...DEFAULT_CSHARP_OPTIONS, rootName: summary?.resourceType ?? "Resource" });
    } catch {
      return "";
    }
  }, [input, summary]);

  const issues = useMemo(() => {
    try {
      return validateFhirResource(JSON.parse(input));
    } catch (e) {
      return [{ severity: "error" as const, message: (e as Error).message }];
    }
  }, [input]);

  const bundle = useMemo(() => {
    try {
      return { analysis: analyzeBundle(input), error: "" };
    } catch (e) {
      return { analysis: null, error: (e as Error).message };
    }
  }, [input]);

  const table = useMemo(() => {
    try {
      const resources = resourcesOf(input);
      if (resources.length === 0) return null;
      const type = String(resources[0].resourceType);
      const columns = DEFAULT_COLUMNS[type] ?? [
        { header: "resourceType", path: "$.resourceType" },
        { header: "id", path: "$.id" },
      ];
      return { columns, rows: extractTable(resources, columns) };
    } catch {
      return null;
    }
  }, [input]);

  const searchUrl = buildSearchUrl(FHIR_SERVERS.find((s) => s.id === serverId)!.baseUrl, resourceType, params);

  /** Run the search against the chosen public sandbox and load the bundle it returns. */
  const runSearch = async () => {
    setSearching(true);
    setSearchError("");
    try {
      const res = await executeRequest({
        method: "GET",
        url: searchUrl,
        headers: { Accept: "application/fhir+json" },
      });
      setInput(res.body ? formatJson(res.body) : "");
      setView("bundle");
      log.success("fhir:search", `${res.status} from ${searchUrl}`, `${res.sizeBytes} bytes in ${res.timeMs} ms`);
      if (!res.ok) setSearchError(`Server returned ${res.status} ${res.statusText}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSearchError(msg);
      toast.error(msg);
    } finally {
      setSearching(false);
    }
  };

  const csvValue = table ? toCsv(table.columns.map((c) => c.header), table.rows) : "";
  const outValue =
    view === "formatted" ? formatted
    : view === "csharp" ? csharp
    : view === "table" ? csvValue
    : "";

  return (
    <ToolShell
      toolId="fhir-toolkit"
      title="FHIR Toolkit (R4)"
      description="Validate, explore and convert FHIR resources. Local-only integration utility — not clinical software."
      actions={outValue && <CopyButton value={outValue} />}
    >
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">FHIR JSON</label>
          <Textarea mono className="h-[calc(100vh-360px)] min-h-64" value={input} onChange={(e) => setInput(e.target.value)} />
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            {validation.resourceType && <Badge>{validation.resourceType}</Badge>}
            {validation.resourceType && !validation.knownResource && <Badge variant="warning">Unknown R4 type</Badge>}
            {validation.valid ? (
              <Badge variant="success" className="ml-auto gap-1"><CheckCircle2 className="size-3" /> Valid</Badge>
            ) : (
              <Badge variant="destructive" className="ml-auto gap-1"><XCircle className="size-3" /> {validation.errors.length} issue(s)</Badge>
            )}
          </div>
          {!validation.valid && validation.errors.map((e, i) => <p key={i} className="text-xs text-destructive">• {e}</p>)}
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-1">
            <TabBtn active={view === "summary"} onClick={() => setView("summary")} label="Summary" />
            <TabBtn active={view === "validate"} onClick={() => setView("validate")} label={`Validate${issues.filter((i) => i.severity === "error").length ? ` (${issues.filter((i) => i.severity === "error").length})` : ""}`} />
            <TabBtn active={view === "bundle"} onClick={() => setView("bundle")} label="Bundle" />
            <TabBtn active={view === "table"} onClick={() => setView("table")} label="Table" />
            <TabBtn active={view === "search"} onClick={() => setView("search")} label="Search" />
            <TabBtn active={view === "formatted"} onClick={() => setView("formatted")} label="Formatted" />
            <TabBtn active={view === "csharp"} onClick={() => setView("csharp")} label="C# model" />
          </div>
          <div className="h-[calc(100vh-360px)] min-h-64 overflow-auto rounded-md border border-border bg-muted/20 p-2">
            {view === "validate" ? (
              <div className="flex flex-col gap-1">
                {issues.length === 0 ? (
                  <p className="flex items-center gap-1.5 text-sm text-success">
                    <CheckCircle2 className="size-4" /> No structural problems found.
                  </p>
                ) : (
                  issues.map((issue, i) => (
                    <div key={i} className={cn("flex items-start gap-2 rounded border p-2 text-xs",
                      issue.severity === "error" ? "border-destructive/40 bg-destructive/10" : "border-warning/40 bg-warning/10")}>
                      <Badge variant={issue.severity === "error" ? "destructive" : "warning"} className="shrink-0 text-[10px]">
                        {issue.severity}
                      </Badge>
                      <span className="min-w-0 flex-1">{issue.message}</span>
                      {issue.location && <span className="shrink-0 font-mono text-muted-foreground">{issue.location}</span>}
                    </div>
                  ))
                )}
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Structural checks — required elements, status codes, date formats, codings without a system. Not a
                  profile conformance statement.
                </p>
              </div>
            ) : view === "bundle" ? (
              bundle.analysis ? (
                <div className="flex flex-col gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{bundle.analysis.type || "bundle"}</Badge>
                    <span className="text-muted-foreground">{bundle.analysis.entryCount} entries</span>
                    {bundle.analysis.total !== undefined && <span className="text-muted-foreground">· total {bundle.analysis.total}</span>}
                    {bundle.analysis.counts.map((c) => (
                      <Badge key={c.resourceType} variant="secondary" className="text-[10px]">{c.resourceType} × {c.count}</Badge>
                    ))}
                  </div>

                  {bundle.analysis.unresolved.length > 0 && (
                    <div className="rounded border border-destructive/40 bg-destructive/10 p-2">
                      <p className="font-medium text-destructive">{bundle.analysis.unresolved.length} unresolved reference(s)</p>
                      {bundle.analysis.unresolved.map((u, i) => (
                        <p key={i} className="font-mono text-[11px]">{u.from} → {u.reference}</p>
                      ))}
                    </div>
                  )}
                  {bundle.analysis.duplicateUrls.length > 0 && (
                    <p className="text-warning">Duplicate fullUrl: {bundle.analysis.duplicateUrls.join(", ")}</p>
                  )}
                  {bundle.analysis.issues.map((i, k) => (
                    <p key={k} className={i.severity === "error" ? "text-destructive" : "text-warning"}>• {i.message}</p>
                  ))}

                  <table className="w-full font-mono text-[11px]">
                    <tbody className="divide-y divide-border">
                      {bundle.analysis.entries.map((e) => (
                        <tr key={e.index} className={e.issues.some((i) => i.severity === "error") ? "bg-destructive/5" : undefined}>
                          <td className="w-8 px-2 py-0.5 text-muted-foreground">{e.index}</td>
                          <td className="w-32 px-2 py-0.5">{e.resourceType}</td>
                          <td className="w-24 px-2 py-0.5 text-muted-foreground">{e.id ?? ""}</td>
                          <td className="px-2 py-0.5 text-muted-foreground">{e.request ?? ""}</td>
                          <td className="w-24 px-2 py-0.5">
                            {e.issues.filter((i) => i.severity === "error").length > 0 && (
                              <span className="text-destructive">{e.issues.filter((i) => i.severity === "error").length} error(s)</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="p-2 text-sm text-muted-foreground">{bundle.error}</p>
              )
            ) : view === "table" ? (
              table ? (
                <div className="flex flex-col gap-2">
                  <p className="text-[11px] text-muted-foreground">
                    {table.rows.length} row(s). Copy takes CSV, ready to paste into a spreadsheet.
                  </p>
                  <table className="w-full font-mono text-[11px]">
                    <thead>
                      <tr className="border-b border-border text-left text-muted-foreground">
                        {table.columns.map((c) => <th key={c.header} className="px-2 py-1 font-medium">{c.header}</th>)}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {table.rows.map((row, i) => (
                        <tr key={i}>{row.map((cell, j) => <td key={j} className="px-2 py-0.5 break-all">{cell}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="p-2 text-sm text-muted-foreground">Load a resource or bundle to tabulate it.</p>
              )
            ) : view === "search" ? (
              <div className="flex flex-col gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <select className="h-8 rounded-md border border-input bg-transparent px-2 text-xs" value={serverId} onChange={(e) => setServerId(e.target.value)}>
                    {FHIR_SERVERS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <select
                    className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
                    value={resourceType}
                    onChange={(e) => setResourceType(e.target.value)}
                  >
                    {Object.keys(COMMON_SEARCH_PARAMS).map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <Button size="sm" onClick={runSearch} disabled={searching}>{searching ? "Searching…" : "Run search"}</Button>
                </div>
                <p className="text-[11px] text-muted-foreground">{FHIR_SERVERS.find((s) => s.id === serverId)!.description}</p>

                {params.map((p, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input type="checkbox" checked={p.enabled} onChange={(e) => setParams(params.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))} />
                    <select
                      className="h-7 w-40 rounded-md border border-input bg-transparent px-2 text-xs"
                      value={p.name}
                      onChange={(e) => setParams(params.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                    >
                      {[...new Set([p.name, ...(COMMON_SEARCH_PARAMS[resourceType] ?? [])])].filter(Boolean).map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                    <Input className="h-7 flex-1 text-xs" value={p.value} onChange={(e) => setParams(params.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} placeholder="value" />
                    <button className="text-muted-foreground hover:text-destructive" aria-label="Remove parameter" onClick={() => setParams(params.filter((_, j) => j !== i))}>×</button>
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  className="self-start"
                  onClick={() => setParams([...params, { name: (COMMON_SEARCH_PARAMS[resourceType] ?? ["_count"])[0], value: "", enabled: true }])}
                >
                  Add parameter
                </Button>

                <div className="rounded border border-border bg-card p-2 font-mono text-[11px] break-all">{searchUrl}</div>
                {searchError && <p className="text-destructive">{searchError}</p>}
                <p className="text-[11px] text-muted-foreground">
                  Public sandboxes holding synthetic data only. Never send real patient data to them.
                </p>
              </div>
            ) : view === "summary" ? (
              summary ? (
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <Badge>{summary.resourceType}</Badge>
                    {summary.id && <span className="font-mono text-xs text-muted-foreground">id: {summary.id}</span>}
                  </div>
                  <dl className="space-y-1">
                    {summary.fields.map((f, i) => (
                      <div key={i} className="grid grid-cols-[140px_1fr] gap-2 text-sm">
                        <dt className="text-muted-foreground">{f.label}</dt>
                        <dd className="mono break-all">{f.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : (
                <p className="p-2 text-sm text-muted-foreground">Enter a FHIR resource with a resourceType.</p>
              )
            ) : (
              <pre className="mono whitespace-pre-wrap text-[12px]">{outValue}</pre>
            )}
          </div>
        </div>
      </div>
    </ToolShell>
  );
}

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className={active ? "border-b-2 border-primary px-3 py-1 text-sm" : "px-3 py-1 text-sm text-muted-foreground hover:text-foreground"}>
      {label}
    </button>
  );
}
