import { useMemo, useRef, useState } from "react";
import { Send, Save, X, Plus, FolderPlus, Ban, AlertTriangle, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/CopyButton";
import { AddToDebug } from "@/components/AddToDebug";
import { KeyValueEditor } from "@/components/KeyValueEditor";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { useApiStore } from "@/stores/useApiStore";
import {
  HTTP_METHODS,
  emptyRequest,
  type ApiRequest,
  type ApiResponse,
  type AuthType,
  type BodyType,
  type HttpMethod,
} from "@/tools/lib/apiTypes";
import { resolveRequest } from "@/tools/lib/apiRequest";
import { executeRequest, corsLimited } from "@/lib/http";
import { generateCode, CODE_TARGETS, type CodeTarget } from "@/tools/lib/apiCodegen";

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(performance.now()));

const METHOD_COLOR: Record<string, string> = {
  GET: "text-success",
  POST: "text-warning",
  PUT: "text-primary",
  PATCH: "text-primary",
  DELETE: "text-destructive",
  HEAD: "text-muted-foreground",
  OPTIONS: "text-muted-foreground",
};

type Tab = "params" | "headers" | "auth" | "body" | "code";

export function ApiTester() {
  const store = useApiStore();
  const [req, setReq] = useState<ApiRequest>(() => emptyRequest(uid()));
  const [tab, setTab] = useState<Tab>("params");
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [respTab, setRespTab] = useState<"body" | "headers">("body");
  const [codeTarget, setCodeTarget] = useState<CodeTarget>("curl");
  const abortRef = useRef<AbortController | null>(null);

  const activeEnv = store.activeEnv();
  const vars = store.activeVars();
  const patch = (p: Partial<ApiRequest>) => setReq((r) => ({ ...r, ...p }));

  const resolved = useMemo(() => {
    try {
      return resolveRequest(req, vars);
    } catch {
      return null;
    }
  }, [req, vars]);

  const send = async () => {
    if (!req.url.trim()) return toast.error("Enter a URL");
    if (!resolved) return toast.error("Could not resolve request");
    setLoading(true);
    setError("");
    setResponse(null);
    abortRef.current = new AbortController();
    try {
      const res = await executeRequest(resolved, abortRef.current.signal);
      setResponse(res);
      setRespTab("body");
      store.pushHistory({ method: req.method, url: resolved.url, status: res.status, timeMs: res.timeMs });
    } catch (e) {
      const msg = (e as Error).name === "AbortError" ? "Request cancelled" : (e as Error).message;
      setError(msg);
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  const cancel = () => abortRef.current?.abort();

  const targetUrl = resolved?.url ?? req.url;
  const capturedIds = () => extractIds(resolved?.headers ?? {}, response?.headers ?? {});

  const responseEvent = () => {
    const ids = capturedIds();
    return {
      source: "api" as const,
      status: response!.ok ? ("ok" as const) : ("error" as const),
      title: `${req.method} ${targetUrl} → ${response!.status} ${response!.statusText}`.trim(),
      durationMs: response!.timeMs,
      correlationId: ids.correlationId,
      traceId: ids.traceId,
      payload: JSON.stringify({ method: req.method, url: targetUrl, status: response!.status, body: response!.body.slice(0, 2000) }),
      error: response!.ok ? undefined : response!.body.slice(0, 800),
    };
  };

  const errorEvent = () => ({
    source: "api" as const,
    status: "error" as const,
    title: `${req.method} ${targetUrl} → failed`,
    payload: JSON.stringify({ method: req.method, url: targetUrl }),
    error,
    ...extractIds(resolved?.headers ?? {}, {}),
  });

  const save = () => {
    const name = req.name?.trim() || req.url || "Untitled";
    const toSave = { ...req, name };
    setReq(toSave);
    store.saveRequest(toSave);
    store.assignRequestToFolder(toSave.id, null);
    toast.success(`Saved "${name}"`);
  };

  const loadRequest = (r: ApiRequest) => {
    setReq({ ...r });
    setResponse(null);
    setError("");
  };

  const newRequest = () => loadRequest(emptyRequest(uid()));

  const prettyBody = useMemo(() => {
    if (!response) return "";
    const ct = Object.entries(response.headers).find(([k]) => k.toLowerCase() === "content-type")?.[1] ?? "";
    if (ct.includes("json")) {
      try {
        return JSON.stringify(JSON.parse(response.body), null, 2);
      } catch {
        return response.body;
      }
    }
    return response.body;
  }, [response]);

  return (
    <div className="flex h-full">
      <CollectionsPanel currentId={req.id} onNew={newRequest} onLoad={loadRequest} />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Input
            className="h-8 w-48 font-medium"
            value={req.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder="Request name"
          />
          <div className="ml-auto flex items-center gap-2">
            <EnvSelector />
            {activeEnv?.isProduction && (
              <Badge variant="destructive" className="gap-1"><AlertTriangle className="size-3" /> PRODUCTION</Badge>
            )}
          </div>
        </div>

        {/* URL bar */}
        <div className="flex items-center gap-2 px-4 py-3">
          <select
            className={cn("h-9 rounded-md border border-input bg-transparent px-2 text-sm font-semibold", METHOD_COLOR[req.method])}
            value={req.method}
            onChange={(e) => patch({ method: e.target.value as HttpMethod })}
          >
            {HTTP_METHODS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <Input
            className="flex-1 font-mono text-sm"
            placeholder="https://api.example.com/path  (use {{BASE_URL}} for env vars)"
            value={req.url}
            onChange={(e) => patch({ url: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          {loading ? (
            <Button variant="destructive" onClick={cancel}><Ban /> Cancel</Button>
          ) : (
            <Button onClick={send}><Send /> Send</Button>
          )}
          <Button variant="outline" onClick={save}><Save /> Save</Button>
        </div>

        {corsLimited() && (
          <div className="mx-4 mb-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs">
            Browser dev mode: requests are subject to CORS. The desktop app sends them natively (no CORS).
          </div>
        )}

        {/* Request tabs */}
        <div className="flex gap-1 border-b border-border px-4">
          {(["params", "headers", "auth", "body", "code"] as Tab[]).map((t) => (
            <TabButton key={t} active={tab === t} onClick={() => setTab(t)} label={tabLabel(t, req)} />
          ))}
        </div>

        <div className="max-h-64 overflow-auto p-4">
          {tab === "params" && <KeyValueEditor rows={req.query} onChange={(query) => patch({ query })} keyPlaceholder="param" />}
          {tab === "headers" && <KeyValueEditor rows={req.headers} onChange={(headers) => patch({ headers })} keyPlaceholder="Header" />}
          {tab === "auth" && <AuthEditor req={req} patch={patch} />}
          {tab === "body" && <BodyEditor req={req} patch={patch} />}
          {tab === "code" && (
            <div>
              <div className="mb-2 flex items-center gap-2">
                <select className="h-8 rounded-md border border-input bg-transparent px-2 text-sm" value={codeTarget} onChange={(e) => setCodeTarget(e.target.value as CodeTarget)}>
                  {CODE_TARGETS.map((t) => (<option key={t.value} value={t.value}>{t.label}</option>))}
                </select>
                <CopyButton value={resolved ? generateCode(codeTarget, resolved) : ""} />
              </div>
              <Textarea mono readOnly className="h-40 bg-muted/30" value={resolved ? generateCode(codeTarget, resolved) : ""} />
            </div>
          )}
        </div>

        {/* Response */}
        <div className="min-h-0 flex-1 border-t border-border">
          {loading && <div className="p-6 text-sm text-muted-foreground">Sending request…</div>}
          {error && !loading && (
            <div className="m-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium text-destructive">Request failed</div>
                <AddToDebug makeEvent={errorEvent} label="Add to Debug" variant="ghost" />
              </div>
              <div className="mt-1 text-muted-foreground">{error}</div>
            </div>
          )}
          {response && !loading && (
            <div className="flex h-full flex-col">
              <div className="flex items-center gap-3 px-4 py-2 text-sm">
                <Badge variant={response.ok ? "success" : "destructive"}>{response.status} {response.statusText}</Badge>
                <span className="text-muted-foreground">{response.timeMs} ms</span>
                <span className="text-muted-foreground">{formatBytes(response.sizeBytes)}</span>
                <div className="ml-auto flex gap-1">
                  <TabButton active={respTab === "body"} onClick={() => setRespTab("body")} label="Body" />
                  <TabButton active={respTab === "headers"} onClick={() => setRespTab("headers")} label={`Headers (${Object.keys(response.headers).length})`} />
                  <CopyButton value={respTab === "body" ? prettyBody : JSON.stringify(response.headers, null, 2)} size="sm" variant="ghost" />
                  <AddToDebug makeEvent={responseEvent} label="Debug" variant="ghost" />
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
                {respTab === "body" ? (
                  <Textarea mono readOnly className="h-full min-h-40 bg-muted/30" value={prettyBody} />
                ) : (
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-border font-mono text-[13px]">
                      {Object.entries(response.headers).map(([k, v]) => (
                        <tr key={k}><td className="py-1 pr-4 text-muted-foreground">{k}</td><td className="py-1 break-all">{v}</td></tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
          {!response && !loading && !error && (
            <div className="p-6 text-sm text-muted-foreground">Send a request to see the response here.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function tabLabel(t: Tab, req: ApiRequest): string {
  const n = (arr: { key: string; enabled: boolean }[]) => arr.filter((r) => r.enabled && r.key).length;
  switch (t) {
    case "params": return `Params${n(req.query) ? ` (${n(req.query)})` : ""}`;
    case "headers": return `Headers${n(req.headers) ? ` (${n(req.headers)})` : ""}`;
    case "auth": return req.auth.type === "none" ? "Auth" : "Auth •";
    case "body": return req.bodyType === "none" ? "Body" : "Body •";
    case "code": return "Code";
  }
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-t-md px-3 py-1.5 text-sm transition-colors",
        active ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

function AuthEditor({ req, patch }: { req: ApiRequest; patch: (p: Partial<ApiRequest>) => void }) {
  const setAuth = (p: Partial<ApiRequest["auth"]>) => patch({ auth: { ...req.auth, ...p } });
  return (
    <div className="flex flex-col gap-3">
      <select className="h-8 w-48 rounded-md border border-input bg-transparent px-2 text-sm" value={req.auth.type} onChange={(e) => setAuth({ type: e.target.value as AuthType })}>
        <option value="none">No Auth</option>
        <option value="bearer">Bearer Token</option>
        <option value="basic">Basic Auth</option>
      </select>
      {req.auth.type === "bearer" && (
        <Input className="max-w-xl font-mono text-xs" placeholder="Token (supports {{TOKEN}})" value={req.auth.token ?? ""} onChange={(e) => setAuth({ token: e.target.value })} />
      )}
      {req.auth.type === "basic" && (
        <div className="flex max-w-xl gap-2">
          <Input placeholder="Username" value={req.auth.username ?? ""} onChange={(e) => setAuth({ username: e.target.value })} />
          <Input placeholder="Password" value={req.auth.password ?? ""} onChange={(e) => setAuth({ password: e.target.value })} />
        </div>
      )}
    </div>
  );
}

function BodyEditor({ req, patch }: { req: ApiRequest; patch: (p: Partial<ApiRequest>) => void }) {
  const types: BodyType[] = ["none", "json", "xml", "x-www-form-urlencoded", "raw"];
  return (
    <div className="flex flex-col gap-2">
      <select className="h-8 w-56 rounded-md border border-input bg-transparent px-2 text-sm" value={req.bodyType} onChange={(e) => patch({ bodyType: e.target.value as BodyType })}>
        {types.map((t) => (<option key={t} value={t}>{t}</option>))}
      </select>
      {req.bodyType !== "none" && (
        <Textarea mono className="h-40" value={req.body} onChange={(e) => patch({ body: e.target.value })} placeholder="Request body (supports {{VAR}})" />
      )}
    </div>
  );
}

function EnvSelector() {
  const { environments, activeEnvId, setActiveEnv } = useApiStore();
  return (
    <select
      className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
      value={activeEnvId ?? ""}
      onChange={(e) => setActiveEnv(e.target.value || null)}
    >
      <option value="">No environment</option>
      {environments.map((e) => (<option key={e.id} value={e.id}>{e.name}</option>))}
    </select>
  );
}

function CollectionsPanel({ currentId, onNew, onLoad }: { currentId: string; onNew: () => void; onLoad: (r: ApiRequest) => void }) {
  const { requests, folders, addFolder, deleteRequest } = useApiStore();
  const all = Object.values(requests);
  const foldered = new Set(folders.flatMap((f) => f.requestIds));
  const unfiled = all.filter((r) => !foldered.has(r.id));

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-card/30">
      <div className="flex items-center gap-1 border-b border-border p-2">
        <span className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Collections</span>
        <div className="ml-auto flex gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" title="New folder" onClick={() => addFolder("New Folder")}><FolderPlus className="size-4" /></Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" title="New request" onClick={onNew}><Plus className="size-4" /></Button>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-1.5">
        {folders.map((f) => (
          <div key={f.id} className="mb-1">
            <div className="flex items-center gap-1 px-1 py-1 text-xs font-medium text-muted-foreground">
              <ChevronRight className="size-3" /> {f.name}
            </div>
            {f.requestIds.map((rid) => requests[rid] && (
              <RequestRow key={rid} r={requests[rid]} active={rid === currentId} onLoad={onLoad} onDelete={deleteRequest} />
            ))}
          </div>
        ))}
        {unfiled.map((r) => (
          <RequestRow key={r.id} r={r} active={r.id === currentId} onLoad={onLoad} onDelete={deleteRequest} />
        ))}
        {all.length === 0 && <p className="p-2 text-xs text-muted-foreground">No saved requests yet. Build one and press Save.</p>}
      </div>
    </aside>
  );
}

function RequestRow({ r, active, onLoad, onDelete }: { r: ApiRequest; active: boolean; onLoad: (r: ApiRequest) => void; onDelete: (id: string) => void }) {
  return (
    <div className={cn("group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm", active ? "bg-primary/15" : "hover:bg-secondary")}>
      <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => onLoad(r)}>
        <span className={cn("shrink-0 text-[10px] font-bold", METHOD_COLOR[r.method])}>{r.method}</span>
        <span className="truncate">{r.name}</span>
      </button>
      <button className="opacity-0 group-hover:opacity-100" onClick={() => onDelete(r.id)} title="Delete">
        <X className="size-3.5 text-muted-foreground hover:text-destructive" />
      </button>
    </div>
  );
}

/** Pull correlation/trace ids from request + response headers (common conventions). */
function extractIds(reqHeaders: Record<string, string>, resHeaders: Record<string, string>): { correlationId?: string; traceId?: string } {
  const all: Record<string, string> = {};
  for (const [k, v] of Object.entries(reqHeaders || {})) all[k.toLowerCase()] = v;
  for (const [k, v] of Object.entries(resHeaders || {})) all[k.toLowerCase()] = v;
  const correlationId = all["x-correlation-id"] || all["correlation-id"] || all["x-request-id"] || all["request-id"] || undefined;
  let traceId = all["x-trace-id"] || all["trace-id"] || undefined;
  const tp = all["traceparent"];
  if (!traceId && tp) {
    const parts = tp.split("-");
    if (parts.length >= 2 && parts[1]) traceId = parts[1];
  }
  return { correlationId, traceId };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
