import { useState } from "react";
import { Plus, Trash2, AlertTriangle, CheckCircle2, GitCompareArrows, Pencil, Eye, EyeOff, Database, Globe, HardDrive, Antenna, Rabbit, Radio, Cable } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { KeyValueEditor } from "@/components/KeyValueEditor";
import { cn } from "@/lib/utils";
import { useApiStore } from "@/stores/useApiStore";
import { useDbStore } from "@/stores/useDbStore";
import { useAppStore } from "@/stores/useAppStore";
import { toast } from "@/components/ui/toast";
import { dbConnectionFromEnvRef } from "@/tools/lib/dbTypes";
import type { Environment, EnvConnection, EnvConnKind } from "@/tools/lib/apiTypes";
import { diffVariables, diffConnections, countStates, maskValue, type DiffState } from "@/tools/lib/envCompare";

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(performance.now()));

const KIND_META: Record<EnvConnKind, { label: string; icon: typeof Database; fields: string[] }> = {
  database: { label: "Database", icon: Database, fields: ["engine", "host", "port", "database", "user"] },
  api: { label: "API", icon: Globe, fields: ["baseUrl"] },
  redis: { label: "Redis", icon: HardDrive, fields: ["host", "port"] },
  nats: { label: "NATS", icon: Antenna, fields: ["url"] },
  rabbitmq: { label: "RabbitMQ", icon: Rabbit, fields: ["url"] },
  mqtt: { label: "MQTT", icon: Radio, fields: ["broker", "port"] },
  websocket: { label: "WebSocket", icon: Cable, fields: ["url"] },
};

const STATE_STYLE: Record<DiffState, string> = {
  added: "text-success",
  removed: "text-destructive",
  changed: "text-warning",
  same: "text-muted-foreground",
};

export function Environments() {
  const { environments, activeEnvId, addEnvironment, updateEnvironment, deleteEnvironment, setActiveEnv } = useApiStore();
  const [mode, setMode] = useState<"edit" | "compare">("edit");
  const [newName, setNewName] = useState("");
  const [newProd, setNewProd] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(activeEnvId);

  const selected = environments.find((e) => e.id === selectedId) ?? environments[0];

  const add = () => {
    const name = newName.trim();
    if (!name) return;
    const id = addEnvironment(name, newProd);
    setNewName("");
    setNewProd(false);
    setSelectedId(id);
  };

  return (
    <ToolShell
      toolId="environments"
      title="Environment Manager"
      description="Per-environment variables and typed connection references (DB / Redis / NATS / RabbitMQ / MQTT / API / WS). Compare environments; production is flagged."
      actions={
        <div className="flex gap-1">
          <Button size="sm" variant={mode === "edit" ? "secondary" : "ghost"} onClick={() => setMode("edit")}><Pencil /> Edit</Button>
          <Button size="sm" variant={mode === "compare" ? "secondary" : "ghost"} onClick={() => setMode("compare")}><GitCompareArrows /> Compare</Button>
        </div>
      }
    >
      {mode === "compare" ? (
        <CompareView environments={environments} />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
          {/* Env list */}
          <div className="flex flex-col gap-3">
            <div className="rounded-md border border-border p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">New environment</div>
              <Input className="mb-2 h-8" placeholder="e.g. DEV, QA, PROD" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
              <label className="mb-2 flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" checked={newProd} onChange={(e) => setNewProd(e.target.checked)} className="accent-destructive" />
                Production environment
              </label>
              <Button size="sm" className="w-full" onClick={add}><Plus /> Add</Button>
            </div>

            <div className="flex flex-col gap-1">
              {environments.length === 0 && <p className="text-sm text-muted-foreground">No environments yet.</p>}
              {environments.map((e) => (
                <button
                  key={e.id}
                  onClick={() => setSelectedId(e.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm",
                    selected?.id === e.id ? "border-primary bg-primary/10" : "border-border hover:bg-secondary",
                  )}
                >
                  <span className="truncate font-medium">{e.name}</span>
                  {e.isProduction && <AlertTriangle className="size-3.5 text-destructive" />}
                  {(e.connections?.length ?? 0) > 0 && <Badge variant="outline" className="text-[10px]">{e.connections!.length} conn</Badge>}
                  {activeEnvId === e.id && <Badge variant="success" className="ml-auto gap-1"><CheckCircle2 className="size-3" /> active</Badge>}
                </button>
              ))}
            </div>
          </div>

          {/* Selected env editor */}
          <div>
            {selected ? (
              <EnvEditor
                env={selected}
                active={activeEnvId === selected.id}
                onUpdate={updateEnvironment}
                onSetActive={() => setActiveEnv(selected.id)}
                onDelete={() => { deleteEnvironment(selected.id); setSelectedId(null); }}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Select or create an environment to edit it.</p>
            )}
          </div>
        </div>
      )}
    </ToolShell>
  );
}

function EnvEditor({ env, active, onUpdate, onSetActive, onDelete }: { env: Environment; active: boolean; onUpdate: (e: Environment) => void; onSetActive: () => void; onDelete: () => void }) {
  const connections = env.connections ?? [];
  const setConnections = (c: EnvConnection[]) => onUpdate({ ...env, connections: c });

  const addConnection = (kind: EnvConnKind) =>
    setConnections([...connections, { id: uid(), kind, name: `${KIND_META[kind].label.toLowerCase()}`, fields: {} }]);

  return (
    <div className="rounded-md border border-border p-4">
      <div className="mb-3 flex items-center gap-2">
        <Input className="h-8 w-48 font-medium" value={env.name} onChange={(e) => onUpdate({ ...env, name: e.target.value })} />
        {env.isProduction && <Badge variant="destructive" className="gap-1"><AlertTriangle className="size-3" /> PRODUCTION</Badge>}
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant={active ? "secondary" : "default"} onClick={onSetActive}>{active ? "Active" : "Set active"}</Button>
          <Button size="sm" variant="ghost" onClick={onDelete}><Trash2 /> Delete</Button>
        </div>
      </div>
      <label className="mb-3 flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
        <input type="checkbox" checked={env.isProduction} onChange={(e) => onUpdate({ ...env, isProduction: e.target.checked })} className="accent-destructive" />
        Mark as production (shows warnings before requests)
      </label>

      <div className="text-xs font-medium text-muted-foreground">Variables</div>
      <div className="mt-1">
        <KeyValueEditor rows={env.variables} onChange={(v) => onUpdate({ ...env, variables: v })} keyPlaceholder="BASE_URL" valuePlaceholder="https://api.dev" />
      </div>

      <div className="mt-4 flex items-center justify-between">
        <div className="text-xs font-medium text-muted-foreground">Connections</div>
        <select
          value=""
          onChange={(e) => { if (e.target.value) addConnection(e.target.value as EnvConnKind); }}
          className="h-7 rounded-md border border-input bg-transparent px-2 text-xs"
        >
          <option value="">+ Add connection…</option>
          {(Object.keys(KIND_META) as EnvConnKind[]).map((k) => <option key={k} value={k}>{KIND_META[k].label}</option>)}
        </select>
      </div>
      <div className="mt-2 flex flex-col gap-2">
        {connections.length === 0 && <p className="text-xs text-muted-foreground">No connections. Add a database, cache or broker this environment points at.</p>}
        {connections.map((c) => (
          <ConnectionRow
            key={c.id}
            conn={c}
            envName={env.name}
            onChange={(next) => setConnections(connections.map((x) => (x.id === c.id ? next : x)))}
            onRemove={() => setConnections(connections.filter((x) => x.id !== c.id))}
          />
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">Connection references are metadata only — no passwords are stored here.</p>
    </div>
  );
}

function ConnectionRow({ conn, envName, onChange, onRemove }: { conn: EnvConnection; envName: string; onChange: (c: EnvConnection) => void; onRemove: () => void }) {
  const meta = KIND_META[conn.kind];
  const Icon = meta.icon;
  const setField = (k: string, v: string) => onChange({ ...conn, fields: { ...conn.fields, [k]: v } });

  const openInDbToolkit = () => {
    const id = useDbStore.getState().upsert(dbConnectionFromEnvRef(conn, envName));
    useDbStore.getState().setActive(id);
    useAppStore.getState().openTool("database-toolkit");
    toast.success(`Opened "${envName} · ${conn.name}" in Database Toolkit`);
  };

  return (
    <div className="rounded-md border border-border p-2">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" />
        <Input className="h-7 w-40 text-sm" value={conn.name} onChange={(e) => onChange({ ...conn, name: e.target.value })} />
        <Badge variant="outline" className="text-[10px]">{meta.label}</Badge>
        {conn.kind === "database" && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={openInDbToolkit}><Database className="size-3.5" /> Open in DB Toolkit</Button>
        )}
        <button onClick={onRemove} className="ml-auto text-muted-foreground hover:text-destructive" title="Remove"><Trash2 className="size-3.5" /></button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {meta.fields.map((f) => (
          <label key={f} className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{f}</span>
            <Input className="h-7 text-xs" value={conn.fields[f] ?? ""} onChange={(e) => setField(f, e.target.value)} />
          </label>
        ))}
      </div>
    </div>
  );
}

function CompareView({ environments }: { environments: Environment[] }) {
  const [aId, setAId] = useState(environments[0]?.id ?? "");
  const [bId, setBId] = useState(environments[1]?.id ?? environments[0]?.id ?? "");
  const [reveal, setReveal] = useState(false);
  const [hideSame, setHideSame] = useState(true);

  const a = environments.find((e) => e.id === aId);
  const b = environments.find((e) => e.id === bId);

  if (environments.length < 2) {
    return <p className="text-sm text-muted-foreground">Create at least two environments to compare.</p>;
  }
  if (!a || !b) return null;

  const varRows = diffVariables(a, b).filter((r) => !hideSame || r.state !== "same");
  const connRows = diffConnections(a, b).filter((r) => !hideSame || r.state !== "same");
  const counts = countStates(diffVariables(a, b));

  const show = (secret: boolean, v?: string) => (v === undefined ? "—" : secret && !reveal ? maskValue(v) : v);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <EnvSelect value={aId} onChange={setAId} environments={environments} />
        <GitCompareArrows className="size-4 text-muted-foreground" />
        <EnvSelect value={bId} onChange={setBId} environments={environments} />
        <div className="ml-auto flex items-center gap-2 text-xs">
          <label className="flex items-center gap-1"><input type="checkbox" checked={hideSame} onChange={(e) => setHideSame(e.target.checked)} /> Hide identical</label>
          <button onClick={() => setReveal((v) => !v)} className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
            {reveal ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />} {reveal ? "Hide" : "Reveal"} secrets
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant="success">+{counts.added} added</Badge>
        <Badge variant="destructive">−{counts.removed} removed</Badge>
        <Badge variant="warning">{counts.changed} changed</Badge>
        <Badge variant="outline">{counts.same} same</Badge>
      </div>

      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Variables</div>
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-muted-foreground">
              <tr><th className="px-3 py-1.5">Key</th><th className="px-3 py-1.5">{a.name}</th><th className="px-3 py-1.5">{b.name}</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {varRows.length === 0 ? (
                <tr><td colSpan={3} className="px-3 py-2 text-muted-foreground">No differences.</td></tr>
              ) : varRows.map((r) => (
                <tr key={r.key} className={cn(r.state === "changed" && "bg-warning/5", r.state === "added" && "bg-success/5", r.state === "removed" && "bg-destructive/5")}>
                  <td className="px-3 py-1.5">
                    <span className={cn("mr-1 text-xs", STATE_STYLE[r.state])}>●</span>
                    <span className="mono">{r.key}</span>
                    {r.secret && <span className="ml-1 text-[10px] text-muted-foreground">secret</span>}
                  </td>
                  <td className="mono px-3 py-1.5 text-xs break-all">{show(r.secret, r.a)}</td>
                  <td className="mono px-3 py-1.5 text-xs break-all">{show(r.secret, r.b)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Connections</div>
        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-muted-foreground">
              <tr><th className="px-3 py-1.5">Connection</th><th className="px-3 py-1.5">Kind</th><th className="px-3 py-1.5">State</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {connRows.length === 0 ? (
                <tr><td colSpan={3} className="px-3 py-2 text-muted-foreground">No differences.</td></tr>
              ) : connRows.map((r) => (
                <tr key={`${r.kind}:${r.name}`}>
                  <td className="px-3 py-1.5"><span className={cn("mr-1 text-xs", STATE_STYLE[r.state])}>●</span>{r.name}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{r.kind}</td>
                  <td className={cn("px-3 py-1.5", STATE_STYLE[r.state])}>{r.state}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function EnvSelect({ value, onChange, environments }: { value: string; onChange: (v: string) => void; environments: Environment[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm font-medium">
      {environments.map((e) => <option key={e.id} value={e.id}>{e.name}{e.isProduction ? " (PROD)" : ""}</option>)}
    </select>
  );
}
