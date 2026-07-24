import { useState } from "react";
import { Plus, Trash2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { KeyValueEditor } from "@/components/KeyValueEditor";
import { cn } from "@/lib/utils";
import { useApiStore } from "@/stores/useApiStore";
import type { Environment } from "@/tools/lib/apiTypes";

export function Environments() {
  const { environments, activeEnvId, addEnvironment, updateEnvironment, deleteEnvironment, setActiveEnv } = useApiStore();
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

  const setVars = (env: Environment, variables: Environment["variables"]) => updateEnvironment({ ...env, variables });

  return (
    <ToolShell toolId="environments" title="Environment Manager" description="Define DEV/QA/UAT/PROD variables. Use {{VAR}} in requests. Production is clearly flagged.">
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
                {activeEnvId === e.id && <Badge variant="success" className="ml-auto gap-1"><CheckCircle2 className="size-3" /> active</Badge>}
              </button>
            ))}
          </div>
        </div>

        {/* Selected env editor */}
        <div>
          {selected ? (
            <div className="rounded-md border border-border p-4">
              <div className="mb-3 flex items-center gap-2">
                <Input
                  className="h-8 w-48 font-medium"
                  value={selected.name}
                  onChange={(e) => updateEnvironment({ ...selected, name: e.target.value })}
                />
                {selected.isProduction && <Badge variant="destructive" className="gap-1"><AlertTriangle className="size-3" /> PRODUCTION</Badge>}
                <div className="ml-auto flex gap-2">
                  <Button size="sm" variant={activeEnvId === selected.id ? "secondary" : "default"} onClick={() => setActiveEnv(selected.id)}>
                    {activeEnvId === selected.id ? "Active" : "Set active"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { deleteEnvironment(selected.id); setSelectedId(null); }}>
                    <Trash2 /> Delete
                  </Button>
                </div>
              </div>
              <label className="mb-2 flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <input type="checkbox" checked={selected.isProduction} onChange={(e) => updateEnvironment({ ...selected, isProduction: e.target.checked })} className="accent-destructive" />
                Mark as production (shows warnings before requests)
              </label>
              <div className="mt-3 text-xs font-medium text-muted-foreground">Variables</div>
              <div className="mt-1">
                <KeyValueEditor rows={selected.variables} onChange={(v) => setVars(selected, v)} keyPlaceholder="BASE_URL" valuePlaceholder="https://api.dev" />
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Select or create an environment to edit its variables.</p>
          )}
        </div>
      </div>
    </ToolShell>
  );
}
