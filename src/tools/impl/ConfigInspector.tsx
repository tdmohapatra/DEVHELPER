import { useMemo, useRef, useState } from "react";
import { Plus, Trash2, Eye, EyeOff, Upload } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/CopyButton";
import { cn } from "@/lib/utils";
import { parseConfig, diffConfigs, countConfigStates, type ConfigState } from "@/tools/lib/configInspect";
import { maskValue } from "@/tools/lib/envCompare";

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(performance.now()));

const SAMPLE_DEV = JSON.stringify(
  { ConnectionStrings: { Default: "Server=localhost;Database=App;User=sa;Password=dev123" }, Logging: { LogLevel: { Default: "Debug" } }, Api: { BaseUrl: "https://dev.api", Timeout: 30 }, Features: { NewCheckout: true } },
  null, 2,
);
const SAMPLE_PROD = JSON.stringify(
  { ConnectionStrings: { Default: "Server=prod-sql;Database=App;User=app;Password=prodSecret!" }, Logging: { LogLevel: { Default: "Warning" } }, Api: { BaseUrl: "https://api.company.com", Timeout: 30 }, JwtSecret: "super-secret-key" },
  null, 2,
);

const STATE_STYLE: Record<ConfigState, string> = {
  same: "text-muted-foreground",
  changed: "text-warning",
  partial: "text-destructive",
};

interface Pane { id: string; name: string; text: string }

export function ConfigInspector() {
  const [panes, setPanes] = useState<Pane[]>([
    { id: uid(), name: "DEV", text: SAMPLE_DEV },
    { id: uid(), name: "PROD", text: SAMPLE_PROD },
  ]);
  const [reveal, setReveal] = useState(false);
  const [diffOnly, setDiffOnly] = useState(true);
  const [filter, setFilter] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const loadTargetId = useRef<string | null>(null);

  const parsed = useMemo(() => panes.map((p) => ({ pane: p, ...parseConfig(p.text) })), [panes]);
  const rows = useMemo(() => diffConfigs(parsed.map((p) => p.flat)), [parsed]);
  const counts = countConfigStates(rows);

  const visible = rows.filter((r) => {
    if (diffOnly && r.state === "same") return false;
    if (filter && !r.key.toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  });

  const setPane = (id: string, patch: Partial<Pane>) => setPanes((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const addPane = () => setPanes((ps) => [...ps, { id: uid(), name: `ENV ${ps.length + 1}`, text: "" }]);
  const removePane = (id: string) => setPanes((ps) => (ps.length <= 1 ? ps : ps.filter((p) => p.id !== id)));

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const id = loadTargetId.current;
    if (!file || !id) return;
    const reader = new FileReader();
    reader.onload = () => setPane(id, { text: String(reader.result), name: file.name.replace(/\.json$/i, "") });
    reader.readAsText(file);
    e.target.value = "";
  };

  const show = (secret: boolean, v?: string) => (v === undefined ? "—" : secret && !reveal ? maskValue(v) : v);

  return (
    <ToolShell
      toolId="config-inspector"
      title="Config Inspector"
      description="Compare appsettings.json across environments — added / removed / changed keys, with automatic secret masking."
      actions={<Button size="sm" variant="outline" onClick={addPane}><Plus /> Add config</Button>}
    >
      <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={onFile} />

      {/* Config panes */}
      <div className="mb-4 grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(panes.length, 3)}, minmax(0, 1fr))` }}>
        {parsed.map(({ pane, ok, error }) => (
          <div key={pane.id} className="flex flex-col gap-1 rounded-md border border-border p-2">
            <div className="flex items-center gap-1">
              <Input value={pane.name} onChange={(e) => setPane(pane.id, { name: e.target.value })} className="h-7 text-sm font-medium" />
              <Button size="sm" variant="ghost" title="Load .json file" onClick={() => { loadTargetId.current = pane.id; fileRef.current?.click(); }}><Upload className="size-3.5" /></Button>
              <Button size="sm" variant="ghost" title="Remove" onClick={() => removePane(pane.id)} disabled={panes.length <= 1}><Trash2 className="size-3.5" /></Button>
            </div>
            <Textarea mono value={pane.text} onChange={(e) => setPane(pane.id, { text: e.target.value })} className="min-h-32" placeholder="Paste appsettings.json…" />
            {!ok && pane.text.trim() && <span className="text-[11px] text-destructive">Invalid JSON: {error}</span>}
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge variant="warning">{counts.changed} changed</Badge>
        <Badge variant="destructive">{counts.partial} missing in some</Badge>
        <Badge variant="outline">{counts.same} same</Badge>
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter keys…" className="h-8 max-w-xs" />
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={diffOnly} onChange={(e) => setDiffOnly(e.target.checked)} /> Differences only</label>
        <button onClick={() => setReveal((v) => !v)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          {reveal ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />} {reveal ? "Hide" : "Reveal"} secrets
        </button>
        <CopyButton className="ml-auto" label="Copy diff" value={toDiffText(visible, panes.map((p) => p.name))} />
      </div>

      {/* Diff table */}
      <div className="overflow-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 border-b border-border bg-card text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5">Key</th>
              {panes.map((p) => <th key={p.id} className="px-3 py-1.5">{p.name}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visible.length === 0 ? (
              <tr><td colSpan={panes.length + 1} className="px-3 py-3 text-muted-foreground">{rows.length === 0 ? "Paste configs above to compare." : "No differences."}</td></tr>
            ) : visible.map((r) => (
              <tr key={r.key} className={cn(r.state === "changed" && "bg-warning/5", r.state === "partial" && "bg-destructive/5")}>
                <td className="px-3 py-1.5">
                  <span className={cn("mr-1", STATE_STYLE[r.state])}>●</span>
                  <span className="mono text-xs">{r.key}</span>
                  {r.secret && <span className="ml-1 text-[10px] text-muted-foreground">secret</span>}
                </td>
                {r.values.map((v, i) => (
                  <td key={i} className={cn("mono px-3 py-1.5 text-xs break-all", v === undefined && "text-muted-foreground")}>{show(r.secret, v)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground">Secrets (passwords, keys, tokens, connection strings) are masked by default and processed locally — nothing is sent anywhere.</p>
    </ToolShell>
  );
}

function toDiffText(rows: { key: string; values: (string | undefined)[]; state: string }[], names: string[]): string {
  const header = `Key\t${names.join("\t")}\tState`;
  const lines = rows.map((r) => `${r.key}\t${r.values.map((v) => v ?? "").join("\t")}\t${r.state}`);
  return [header, ...lines].join("\n");
}
