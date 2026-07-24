import { useState, type ReactNode } from "react";
import { FolderPlus, GitCompareArrows, AlertTriangle, Plus, Minus } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { useApiStore } from "@/stores/useApiStore";
import {
  parseOpenApi,
  endpointsToRequests,
  diffContracts,
  type ParsedSpec,
  type ContractDiff,
} from "@/tools/lib/openapi";

const METHOD_COLOR: Record<string, string> = {
  GET: "text-success", POST: "text-warning", PUT: "text-primary", PATCH: "text-primary",
  DELETE: "text-destructive", HEAD: "text-muted-foreground", OPTIONS: "text-muted-foreground",
};

export function OpenApiTool() {
  const [mode, setMode] = useState<"import" | "compare">("import");
  return (
    <ToolShell toolId="openapi" title="OpenAPI / Swagger" description="Import a spec into collections, or compare two versions for breaking changes.">
      <div className="mb-4 flex gap-1 border-b border-border">
        <TabBtn active={mode === "import"} onClick={() => setMode("import")} label="Import" />
        <TabBtn active={mode === "compare"} onClick={() => setMode("compare")} label="Contract Compare" />
      </div>
      {mode === "import" ? <ImportView /> : <CompareView />}
    </ToolShell>
  );
}

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className={cn("px-3 py-1.5 text-sm", active ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground")}>
      {label}
    </button>
  );
}

function ImportView() {
  const { saveRequest, addFolder, assignRequestToFolder } = useApiStore();
  const [text, setText] = useState("");
  const [spec, setSpec] = useState<ParsedSpec | null>(null);
  const [error, setError] = useState("");

  const parse = () => {
    try {
      setError("");
      setSpec(parseOpenApi(text));
    } catch (e) {
      setSpec(null);
      setError((e as Error).message);
    }
  };

  const addToCollections = () => {
    if (!spec) return;
    const requests = endpointsToRequests(spec);
    const folderId = addFolder(spec.title || "Imported API");
    requests.forEach((r) => {
      saveRequest(r);
      assignRequestToFolder(r.id, folderId);
    });
    toast.success(`Added ${requests.length} requests to "${spec.title}". Set BASE_URL in Environments${spec.baseUrl ? ` (spec: ${spec.baseUrl})` : ""}.`);
  };

  return (
    <div>
      <Textarea mono className="h-40" value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste openapi.json or swagger.json…" />
      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" onClick={parse}>Parse spec</Button>
        {spec && <Button size="sm" variant="outline" onClick={addToCollections}><FolderPlus /> Add {spec.endpoints.length} requests to Collections</Button>}
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      {spec && (
        <div className="mt-4">
          <div className="mb-2 flex items-center gap-2 text-sm">
            <span className="font-semibold">{spec.title}</span>
            {spec.version && <Badge variant="secondary">v{spec.version}</Badge>}
            {spec.baseUrl && <span className="font-mono text-xs text-muted-foreground">{spec.baseUrl}</span>}
            <Badge className="ml-auto">{spec.endpoints.length} endpoints</Badge>
          </div>
          <div className="max-h-[calc(100vh-460px)] overflow-auto rounded-md border border-border">
            <ul className="divide-y divide-border">
              {spec.endpoints.map((ep, i) => (
                <li key={i} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                  <span className={cn("w-14 shrink-0 text-xs font-bold", METHOD_COLOR[ep.method])}>{ep.method}</span>
                  <span className="font-mono text-[13px]">{ep.path}</span>
                  {ep.summary && <span className="truncate text-xs text-muted-foreground">— {ep.summary}</span>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function CompareView() {
  const [oldText, setOldText] = useState("");
  const [newText, setNewText] = useState("");
  const [diff, setDiff] = useState<ContractDiff | null>(null);
  const [error, setError] = useState("");

  const compare = () => {
    try {
      setError("");
      setDiff(diffContracts(parseOpenApi(oldText), parseOpenApi(newText)));
    } catch (e) {
      setDiff(null);
      setError((e as Error).message);
    }
  };

  const breakingCount =
    (diff?.removed.length ?? 0) +
    (diff?.changed.reduce((n, c) => n + c.changes.filter((ch) => ch.severity === "breaking").length, 0) ?? 0);

  return (
    <div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Old spec (v1)</label>
          <Textarea mono className="h-40" value={oldText} onChange={(e) => setOldText(e.target.value)} placeholder="Paste old openapi.json…" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">New spec (v2)</label>
          <Textarea mono className="h-40" value={newText} onChange={(e) => setNewText(e.target.value)} placeholder="Paste new openapi.json…" />
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" onClick={compare}><GitCompareArrows /> Compare</Button>
        {diff && (
          <>
            <Badge variant="success">+{diff.added.length} added</Badge>
            <Badge variant="destructive">−{diff.removed.length} removed</Badge>
            <Badge variant="warning">~{diff.changed.length} changed</Badge>
            {breakingCount > 0 ? (
              <Badge variant="destructive" className="ml-auto gap-1"><AlertTriangle className="size-3" /> {breakingCount} breaking</Badge>
            ) : (
              <Badge variant="success" className="ml-auto">No breaking changes</Badge>
            )}
          </>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      {diff && (
        <div className="mt-4 max-h-[calc(100vh-500px)] space-y-4 overflow-auto">
          {diff.added.length > 0 && (
            <Group title="Added endpoints" items={diff.added} icon={<Plus className="size-3 text-success" />} tone="text-success" />
          )}
          {diff.removed.length > 0 && (
            <Group title="Removed endpoints (breaking)" items={diff.removed} icon={<Minus className="size-3 text-destructive" />} tone="text-destructive" />
          )}
          {diff.changed.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Changed endpoints</div>
              <div className="rounded-md border border-border divide-y divide-border">
                {diff.changed.map((c) => (
                  <div key={c.key} className="px-3 py-2">
                    <div className="font-mono text-[13px]">{c.key}</div>
                    <ul className="mt-1 space-y-0.5">
                      {c.changes.map((ch, i) => (
                        <li key={i} className="flex items-center gap-2 text-xs">
                          <Badge variant={ch.severity === "breaking" ? "destructive" : "secondary"} className="text-[10px]">{ch.severity}</Badge>
                          <span className="text-muted-foreground">{ch.detail}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}
          {diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0 && (
            <p className="text-sm text-muted-foreground">Specs are identical at the endpoint/param level.</p>
          )}
        </div>
      )}
    </div>
  );
}

function Group({ title, items, icon, tone }: { title: string; items: string[]; icon: ReactNode; tone: string }) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      <ul className="rounded-md border border-border divide-y divide-border font-mono text-[13px]">
        {items.map((it) => (
          <li key={it} className={cn("flex items-center gap-2 px-3 py-1.5", tone)}>{icon} {it}</li>
        ))}
      </ul>
    </div>
  );
}
