import { useState, type ReactNode } from "react";
import { AlertTriangle, FolderSearch, FileText, Table2, Loader2 } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { CopyButton } from "@/components/CopyButton";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { isTauri } from "@/lib/platform";
import { KIND_LABEL, type PhiKind } from "@/tools/lib/phi";
import {
  scanRows,
  scanText,
  selectCandidates,
  summarise,
  toMarkdown,
  type ColumnScan,
  type ScanSummary,
  type TextScan,
} from "@/tools/lib/phiScan";

type Tab = "folder" | "paste" | "columns";

/** Bytes of each file to read. The Rust side returns the tail when it is larger. */
const READ_BYTES = 2_000_000;

const SAMPLE_CSV = [
  "id,status,notes,patient_ref",
  "1,ok,routine bloods,100234",
  "2,ok,called MRN: 100235 about the repeat sample,100235",
  "3,failed,rejected haemolysed,100236",
  "4,ok,spoke to priya@hospital.in re results,100237",
].join("\n");

export function PhiScanner() {
  const [tab, setTab] = useState<Tab>("paste");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [root, setRoot] = useState("");
  const [scans, setScans] = useState<TextScan[]>([]);
  const [skipped, setSkipped] = useState<{ name: string; why: string }[]>([]);
  const [summary, setSummary] = useState<ScanSummary | null>(null);

  const [pasted, setPasted] = useState("");
  const [csv, setCsv] = useState(SAMPLE_CSV);
  const [columns, setColumns] = useState<ColumnScan[]>([]);

  const runFolder = async () => {
    if (!isTauri()) return toast.error("Reading files needs the desktop app.");
    if (!root.trim()) return toast.error("Give a folder to scan.");
    setBusy(true);
    setError("");
    setScans([]);
    setSummary(null);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const entries = await invoke<{ path: string; name: string; is_dir: boolean; size: number }[]>("list_files", {
        root: root.trim(),
        maxDepth: 4,
        maxEntries: 2000,
      });
      const { chosen, skipped: notChosen } = selectCandidates(entries);
      setSkipped(notChosen);
      if (chosen.length === 0) {
        setError("No text files under that folder. Logs, CSV, JSON, HL7 and EDI files are read; binaries are skipped.");
        return;
      }

      const results: TextScan[] = [];
      for (const file of chosen) {
        try {
          const text = await invoke<string>("read_text_file", { path: file.path, maxBytes: READ_BYTES });
          results.push(scanText(file.path, text));
        } catch (e) {
          results.push({ source: file.path, bytes: 0, lines: 0, hits: [], counts: {}, truncated: `Could not read: ${e}` });
        }
      }
      setScans(results);
      setSummary(summarise(results));
      toast.success(`Scanned ${results.length} file(s)`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const runPaste = () => {
    const result = scanText("pasted", pasted);
    setScans([result]);
    setSummary(summarise([result]));
    setSkipped([]);
  };

  const runColumns = () => {
    const lines = csv.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) {
      setError("Paste a header row and at least one data row.");
      return;
    }
    setError("");
    const split = (line: string) => line.split(",").map((c) => c.trim());
    setColumns(scanRows(split(lines[0]), lines.slice(1).map(split)));
  };

  return (
    <ToolShell
      toolId="phi-scanner"
      title="PHI Scanner"
      description="Find patient data in logs, exports and database columns — with a line number you can act on."
    >
      <div className="mb-3 flex flex-wrap gap-1 border-b border-border">
        {([
          { id: "paste" as Tab, label: "Paste", icon: FileText },
          { id: "folder" as Tab, label: "Folder of logs", icon: FolderSearch },
          { id: "columns" as Tab, label: "Table columns", icon: Table2 },
        ]).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-sm",
              tab === t.id ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <t.icon className="size-3.5" /> {t.label}
          </button>
        ))}
      </div>

      <p className="mb-3 rounded-md border border-border bg-muted/30 p-2 text-[11px] text-muted-foreground">
        The same detectors the <b>PHI Gateway</b> uses on an AI prompt, pointed at where data leaks by accident instead:
        a request body somebody logged once to debug an interface and never removed, a <span className="mono">notes</span>{" "}
        column that was meant to hold a status, a CSV mailed to a supplier for testing. Nothing is sent anywhere, and
        every excerpt has its values masked so the report can go straight into a ticket.
      </p>

      {tab === "paste" && (
        <div className="flex flex-col gap-2">
          <Textarea
            mono
            className="h-40"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            spellCheck={false}
            placeholder="Paste a log excerpt, an export, a fixture…"
          />
          <div>
            <Button size="sm" onClick={runPaste} disabled={!pasted.trim()}>Scan</Button>
          </div>
        </div>
      )}

      {tab === "folder" && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-end gap-2">
            <F label="Folder">
              <Input
                className="mono h-8 w-[32rem]"
                value={root}
                onChange={(e) => setRoot(e.target.value)}
                placeholder="D:\logs\interface"
                onKeyDown={(e) => e.key === "Enter" && runFolder()}
              />
            </F>
            <Button size="sm" onClick={runFolder} disabled={busy}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <FolderSearch className="size-3.5" />} Scan
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Four levels deep, 2000 entries and 200 files at most, biggest first; <span className="mono">node_modules</span>,{" "}
            <span className="mono">.git</span>, <span className="mono">target</span> and friends are skipped. Files over{" "}
            {(READ_BYTES / 1_000_000).toFixed(0)} MB are read from the tail, which is where the entries still in retention are.
          </p>
          {skipped.length > 0 && (
            <details className="text-[11px] text-muted-foreground">
              <summary className="cursor-pointer">{skipped.length} file(s) skipped</summary>
              <div className="mt-1 flex flex-col gap-0.5">
                {skipped.slice(0, 40).map((s, i) => (
                  <span key={i} className="mono">{s.name} — {s.why}</span>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {tab === "columns" && (
        <div className="flex flex-col gap-2">
          <Textarea mono className="h-40" value={csv} onChange={(e) => setCsv(e.target.value)} spellCheck={false} />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={runColumns}>Scan columns</Button>
            <span className="text-[11px] text-muted-foreground">
              Paste a header row and a sample of rows — <span className="mono">SELECT TOP 500 * FROM …</span> as CSV.
              Columns are judged by what proportion of values match, so one stray phone number is not a finding and a
              column that is 90% MRNs is one whatever it is called.
            </span>
          </div>

          {columns.length > 0 && (
            <div className="rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="border-b border-border text-left text-muted-foreground">
                  <tr>
                    {["Column", "Verdict", "Matched", "Kinds", "What it means"].map((c) => (
                      <th key={c} className="whitespace-nowrap px-3 py-1 font-medium">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {columns.map((column) => (
                    <tr key={column.column} className="hover:bg-secondary/40">
                      <td className="mono px-3 py-1">{column.column}</td>
                      <td className="px-3 py-1">
                        <Badge
                          variant={
                            column.verdict === "certain" ? "destructive"
                            : column.verdict === "likely" ? "warning"
                            : column.verdict === "occasional" ? "secondary"
                            : "success"
                          }
                          className="text-[9px]"
                        >
                          {column.verdict}
                        </Badge>
                      </td>
                      <td className="px-3 py-1 text-muted-foreground">
                        {column.matched}/{column.sampled} ({Math.round(column.ratio * 100)}%)
                      </td>
                      <td className="px-3 py-1 text-muted-foreground">
                        {Object.entries(column.counts).map(([k, n]) => `${n}× ${KIND_LABEL[k as PhiKind]}`).join(", ") || "—"}
                      </td>
                      <td className="px-3 py-1 text-[11px] text-muted-foreground">{column.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{error}</div>
      )}

      {summary && (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={summary.total > 0 ? "destructive" : "success"}>
              {summary.total} finding(s)
            </Badge>
            <span className="text-[11px] text-muted-foreground">
              in {summary.withFindings} of {summary.sources} source(s)
            </span>
            {Object.entries(summary.counts)
              .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
              .map(([kind, n]) => (
                <Badge key={kind} variant="outline" className="text-[9px]">{n}× {KIND_LABEL[kind as PhiKind]}</Badge>
              ))}
            <CopyButton className="ml-auto" value={toMarkdown(scans, summary)} />
          </div>

          {scans
            .filter((scan) => scan.hits.length > 0 || scan.truncated)
            .map((scan) => (
              <div key={scan.source} className="rounded-md border border-border">
                <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-1.5">
                  <span className="mono text-xs">{scan.source}</span>
                  <Badge variant="outline" className="text-[9px]">{scan.hits.length} shown</Badge>
                  {scan.truncated && <span className="text-[10px] text-warning">{scan.truncated}</span>}
                </div>
                <div className="max-h-64 overflow-auto">
                  <table className="w-full text-xs">
                    <tbody className="divide-y divide-border">
                      {scan.hits.map((hit, i) => (
                        <tr key={i} className="hover:bg-secondary/40">
                          <td className="mono w-20 px-3 py-1 text-muted-foreground">:{hit.line}</td>
                          <td className="w-32 px-3 py-1">
                            {hit.label}
                            {!hit.certain && <span className="ml-1 text-[10px] text-muted-foreground">(guess)</span>}
                          </td>
                          <td className="mono px-3 py-1 text-[11px]">{hit.excerpt}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}

          {summary.total === 0 && (
            <p className="text-sm text-success">
              Nothing identifying found. Detection is best-effort — it cannot recognise a name in prose, and it does not
              know your local identifier formats.
            </p>
          )}

          {summary.total > 0 && (
            <p className="text-[11px] text-muted-foreground">
              <AlertTriangle className="mr-1 inline size-3 text-warning" />
              Copy the report as Markdown for a ticket: every value is masked in it, so the report itself carries no
              identifiers. What it cannot tell you is whether the leak is already downstream — a log line found here is
              usually also in whatever aggregator ships these files.
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
