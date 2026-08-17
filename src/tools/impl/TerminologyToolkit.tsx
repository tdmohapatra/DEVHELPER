import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, ScanSearch, Table2 } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { CopyButton } from "@/components/CopyButton";
import { cn } from "@/lib/utils";
import {
  applyCrosswalk,
  detectSystem,
  parseCrosswalk,
  splitCodes,
  SYSTEMS,
  SYSTEM_BY_ID,
  toFhirCoding,
  validateCode,
  type CodeSystem,
} from "@/tools/lib/terminology";

type Tab = "check" | "crosswalk";

const SAMPLE_CODES = "718-7\n2160-0\nE11.9\nS72.001A\n99213\n0042T\nJ1885\n271649006\n0002-8215-01";

const SAMPLE_TABLE = [
  "# local, standard, system, description",
  "LAB-HB, 718-7, loinc, Haemoglobin",
  "LAB-CREAT, 2160-0, loinc, Creatinine",
  "DX-DM2, E11.9, icd10cm, Type 2 diabetes without complications",
].join("\n");

export function TerminologyToolkit() {
  const [tab, setTab] = useState<Tab>("check");

  const [single, setSingle] = useState("718-7");
  const [forced, setForced] = useState<CodeSystem | "auto">("auto");
  const [display, setDisplay] = useState("");

  const [batch, setBatch] = useState(SAMPLE_CODES);
  const [table, setTable] = useState(SAMPLE_TABLE);
  const [feed, setFeed] = useState("LAB-HB\nLAB-CREAT\nLAB-XX\nDX-DM2\nDX-UNKNOWN");

  const detected = useMemo(() => detectSystem(single), [single]);
  const system: CodeSystem | null = forced === "auto" ? detected : forced;
  const report = useMemo(() => (system ? validateCode(system, single) : null), [system, single]);

  const batchReports = useMemo(
    () =>
      splitCodes(batch).map((code) => {
        const guessed = detectSystem(code);
        return { code, system: guessed, report: guessed ? validateCode(guessed, code) : null };
      }),
    [batch],
  );

  const crosswalk = useMemo(() => applyCrosswalk(splitCodes(feed), parseCrosswalk(table)), [feed, table]);

  return (
    <ToolShell
      toolId="terminology"
      title="Terminology Toolkit"
      description="Check the structure of a clinical code, explain its parts, and find what your crosswalk does not cover."
    >
      <div className="mb-3 flex flex-wrap gap-1 border-b border-border">
        <button
          onClick={() => setTab("check")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 text-sm",
            tab === "check" ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <ScanSearch className="size-3.5" /> Check codes
        </button>
        <button
          onClick={() => setTab("crosswalk")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 text-sm",
            tab === "crosswalk" ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Table2 className="size-3.5" /> Crosswalk
        </button>
      </div>

      <p className="mb-3 rounded-md border border-border bg-muted/30 p-2 text-[11px] text-muted-foreground">
        <b>No code set is bundled.</b> CPT is copyright AMA and SNOMED CT needs an affiliate licence, so neither can ship
        here; LOINC and ICD-10-CM are free but large. What is checked is <b>structure</b> — the shape, what each position
        means, and the check digit where the system has one. Whether a code <i>exists</i> needs the table, and this will
        always say so rather than implying otherwise.
      </p>

      {tab === "check" && (
        <>
          <div className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
            <F label="Code">
              <Input className="mono h-8 w-56" value={single} onChange={(e) => setSingle(e.target.value)} placeholder="718-7" />
            </F>
            <F label="System">
              <select
                className="h-8 rounded-md border border-border bg-background px-2 text-sm"
                value={forced}
                onChange={(e) => setForced(e.target.value as CodeSystem | "auto")}
              >
                <option value="auto">Detect ({detected ? SYSTEM_BY_ID[detected].label : "unrecognised"})</option>
                {SYSTEMS.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </F>
            <F label="Display (for the FHIR Coding)">
              <Input className="h-8 w-56" value={display} onChange={(e) => setDisplay(e.target.value)} placeholder="optional" />
            </F>
            {report && (
              <Badge variant={report.valid ? "success" : "destructive"}>
                {report.valid ? "structurally valid" : "not this shape"}
              </Badge>
            )}
          </div>

          {!system ? (
            <p className="text-sm text-muted-foreground">
              That is not a recognised shape for any system here. Pick one explicitly to see why it does not fit.
            </p>
          ) : (
            report && (
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <div className="rounded-md border border-border">
                    <div className="border-b border-border px-3 py-1.5 text-xs font-medium">
                      {SYSTEM_BY_ID[system].label}
                      {report.normalized !== report.input && (
                        <span className="ml-2 text-muted-foreground">normalised to <span className="mono">{report.normalized}</span></span>
                      )}
                    </div>
                    <table className="w-full text-xs">
                      <tbody className="divide-y divide-border">
                        {report.parts.map((part, i) => (
                          <tr key={i}>
                            <td className="w-48 px-3 py-1.5 text-muted-foreground">{part.label}</td>
                            <td className="mono px-3 py-1.5">{part.value}</td>
                            <td className="px-3 py-1.5 text-[11px] text-muted-foreground">{part.note}</td>
                          </tr>
                        ))}
                        {report.parts.length === 0 && (
                          <tr><td className="px-3 py-2 text-muted-foreground">No structure to break down.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex flex-col gap-1">
                    {report.issues.map((issue, i) => (
                      <p key={i} className="text-[11px]">
                        {issue.level === "error" ? (
                          <AlertTriangle className="mr-1 inline size-3 text-destructive" />
                        ) : issue.level === "warn" ? (
                          <AlertTriangle className="mr-1 inline size-3 text-warning" />
                        ) : (
                          <Info className="mr-1 inline size-3 text-muted-foreground" />
                        )}
                        {issue.message}
                      </p>
                    ))}
                    {report.valid && report.issues.length === 0 && (
                      <p className="text-[11px] text-success">
                        <CheckCircle2 className="mr-1 inline size-3" /> The shape is right and the check digit agrees.
                      </p>
                    )}
                  </div>

                  <p className="text-[11px] text-muted-foreground">{SYSTEM_BY_ID[system].licence}</p>
                </div>

                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-medium text-muted-foreground">As a FHIR Coding</label>
                    <CopyButton className="ml-auto" value={toFhirCoding(report, display || undefined)} />
                  </div>
                  <pre className="mono overflow-auto whitespace-pre rounded-md border border-border bg-muted/20 p-3 text-[11px]">
                    {toFhirCoding(report, display || undefined)}
                  </pre>
                  <p className="text-[11px] text-muted-foreground">
                    The `system` URI is the half that gets forgotten. A Coding with a code and no system is a number
                    nobody can resolve — and the receiver is entitled to reject it.
                  </p>
                </div>
              </div>
            )
          )}

          <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Or check a whole feed at once</label>
              <Textarea mono className="h-40" value={batch} onChange={(e) => setBatch(e.target.value)} spellCheck={false} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">
                {batchReports.filter((r) => r.report && !r.report.valid).length} of {batchReports.length} fail their own shape
              </label>
              <div className="max-h-40 overflow-auto rounded-md border border-border">
                <table className="w-full text-xs">
                  <tbody className="divide-y divide-border">
                    {batchReports.map((row, i) => (
                      <tr key={i} className="hover:bg-secondary/40">
                        <td className="mono px-2 py-1">{row.code}</td>
                        <td className="px-2 py-1 text-muted-foreground">
                          {row.system ? SYSTEM_BY_ID[row.system].label : "unrecognised"}
                        </td>
                        <td className="px-2 py-1">
                          {!row.report ? (
                            <span className="text-warning">no system matches this shape</span>
                          ) : row.report.valid ? (
                            <span className="text-success">ok</span>
                          ) : (
                            <span className="text-destructive">{row.report.issues[0]?.message.slice(0, 70)}…</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}

      {tab === "crosswalk" && (
        <>
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-muted-foreground">Your crosswalk table</label>
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setTable(SAMPLE_TABLE)}>Sample</Button>
              </div>
              <Textarea mono className="h-40" value={table} onChange={(e) => setTable(e.target.value)} spellCheck={false} />
              <p className="text-[11px] text-muted-foreground">
                <span className="mono">local, standard, system, description</span> — one per line. The system column is
                optional; it is guessed from the code's shape when missing. This is a format an analyst can produce from
                a spreadsheet without help, which is the point.
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">The codes actually in your feed</label>
              <Textarea mono className="h-40" value={feed} onChange={(e) => setFeed(e.target.value)} spellCheck={false} />
              <p className="text-[11px] text-muted-foreground">
                Paste a distinct list out of the source system — <span className="mono">SELECT DISTINCT local_code FROM …</span>
              </p>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
            <Panel
              title="Not in the table"
              count={crosswalk.unmapped.length}
              tone={crosswalk.unmapped.length ? "bad" : "ok"}
              note="These arrive in the feed and the table has no row. This is the list that turns up on go-live day."
            >
              {crosswalk.unmapped.map((code) => (
                <div key={code} className="mono">{code}</div>
              ))}
            </Panel>
            <Panel
              title="Bad targets"
              count={crosswalk.invalidTargets.length}
              tone={crosswalk.invalidTargets.length ? "bad" : "ok"}
              note="Rows whose standard code fails its own structure check — a typo in the table itself."
            >
              {crosswalk.invalidTargets.map(({ entry }) => (
                <div key={entry.local} className="mono">
                  {entry.local} → {entry.standard}
                </div>
              ))}
            </Panel>
            <Panel
              title="Unused rows"
              count={crosswalk.unused.length}
              tone="info"
              note="In the table, never seen in the feed. Usually harmless; sometimes a code that was renamed upstream."
            >
              {crosswalk.unused.map((entry) => (
                <div key={entry.local} className="mono">{entry.local}</div>
              ))}
            </Panel>
          </div>

          {crosswalk.mapped.length > 0 && (
            <div className="mt-3 rounded-md border border-border">
              <div className="border-b border-border px-3 py-1.5 text-xs font-medium">
                Mapped <Badge variant="outline" className="ml-2 text-[9px]">{crosswalk.mapped.length}</Badge>
              </div>
              <div className="max-h-56 overflow-auto">
                <table className="w-full text-xs">
                  <tbody className="divide-y divide-border">
                    {crosswalk.mapped.map((row, i) => (
                      <tr key={i} className="hover:bg-secondary/40">
                        <td className="mono px-3 py-1">{row.local}</td>
                        <td className="px-3 py-1 text-muted-foreground">→</td>
                        <td className="mono px-3 py-1">{row.entry.standard}</td>
                        <td className="px-3 py-1 text-muted-foreground">
                          {row.entry.system ? SYSTEM_BY_ID[row.entry.system].label : "system unknown"}
                        </td>
                        <td className="px-3 py-1 text-muted-foreground">{row.entry.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </ToolShell>
  );
}

function Panel({
  title,
  count,
  tone,
  note,
  children,
}: {
  title: string;
  count: number;
  tone: "ok" | "bad" | "info";
  note: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-md border border-border">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <span className="text-xs font-medium">{title}</span>
        <Badge variant={tone === "bad" ? "destructive" : tone === "ok" ? "success" : "outline"} className="text-[9px]">
          {count}
        </Badge>
      </div>
      <div className="max-h-40 overflow-auto px-3 py-1.5 text-[11px]">
        {count === 0 ? <span className="text-muted-foreground">none</span> : children}
      </div>
      <p className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">{note}</p>
    </div>
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
