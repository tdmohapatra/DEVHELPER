import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Send, Save, X, Plus, FolderPlus, Ban, AlertTriangle, ChevronRight, Terminal, Upload, Download, Check, PlayCircle } from "lucide-react";
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
import { useHandoffStore } from "@/stores/useHandoffStore";
import {
  HTTP_METHODS,
  emptyRequest,
  type ApiRequest,
  type ApiResponse,
  type AuthType,
  type BodyType,
  type HttpMethod,
} from "@/tools/lib/apiTypes";
import { resolveRequest, type ResolvedRequest } from "@/tools/lib/apiRequest";
import { ApiResponseBody } from "@/tools/impl/ApiResponseBody";
import { detectBodyKind, formatBody, headerValue } from "@/tools/lib/responseBody";
import { parseCurl, looksLikeCurl } from "@/tools/lib/curlImport";
import { importPostmanCollection, exportPostmanCollection } from "@/tools/lib/postmanCollection";
import { runAssertions, summarize, defaultAssertion, describeAssertion, type AssertionResult } from "@/tools/lib/apiAssert";
import { runCollection, runReportText, type RunResult } from "@/tools/lib/collectionRunner";
import {
  buildTokenRequest,
  parseTokenResponse,
  isTokenUsable,
  tokenCacheKey,
  authorizationHeader,
  describeToken,
  type TokenResponse,
} from "@/tools/lib/oauth2";
import { interpolate } from "@/tools/lib/interpolate";
import { DYNAMIC_VARS } from "@/tools/lib/dynamicVars";
import {
  API_SAMPLES,
  SAMPLE_CATEGORIES,
  requestFromSample,
  sampleById as apiSampleById,
  type ApiSample,
} from "@/tools/lib/apiSamples";
import { log } from "@/lib/logBus";
import type { Assertion, AssertionKind, AssertionOp } from "@/tools/lib/apiTypes";
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

type Tab = "params" | "headers" | "auth" | "body" | "tests" | "settings" | "code";

/** Variables still unresolved after interpolation, e.g. `{{token}}` with no env value. */
function unresolvedVars(resolved: ResolvedRequest | null): string[] {
  if (!resolved) return [];
  const text = [resolved.url, JSON.stringify(resolved.headers), resolved.body ?? ""].join(" ");
  return [...new Set([...text.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)].map((m) => m[1]))];
}

export function ApiTester() {
  const store = useApiStore();
  const [req, setReq] = useState<ApiRequest>(() => emptyRequest(uid()));
  const [tab, setTab] = useState<Tab>("params");
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [respTab, setRespTab] = useState<"body" | "headers">("body");
  const [codeTarget, setCodeTarget] = useState<CodeTarget>("curl");
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [tokenNote, setTokenNote] = useState<string | undefined>();
  const [fetchingToken, setFetchingToken] = useState(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const collectionFileRef = useRef<HTMLInputElement>(null);
  /** Session-only OAuth tokens, keyed by client + scope. */
  const tokenCache = useRef<Record<string, TokenResponse>>({});
  const cancelRun = useRef(false);

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

  /**
   * Obtain a bearer token for an OAuth 2.0 request, reusing a cached one while it lasts.
   * Tokens live in a ref: session-only, and never written to the persisted store.
   */
  const ensureToken = useCallback(
    async (request: ApiRequest): Promise<string | null> => {
      if (request.auth.type !== "oauth2") return null;
      const key = tokenCacheKey(request.auth);
      const cached = tokenCache.current[key];
      if (isTokenUsable(cached)) return authorizationHeader(cached!);

      const tokenReq = buildTokenRequest({
        ...request.auth,
        tokenUrl: interpolate(request.auth.tokenUrl ?? "", vars),
        clientId: interpolate(request.auth.clientId ?? "", vars),
        clientSecret: interpolate(request.auth.clientSecret ?? "", vars),
      });
      const res = await executeRequest(tokenReq);
      const token = parseTokenResponse(res.status, res.body);
      tokenCache.current[key] = token;
      setTokenNote(describeToken(token));
      log.success("api:oauth", describeToken(token));
      return authorizationHeader(token);
    },
    [vars],
  );

  const fetchToken = async () => {
    setFetchingToken(true);
    try {
      await ensureToken({ ...req, auth: { ...req.auth } });
      toast.success("Token acquired");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setTokenNote(msg);
      toast.error(msg);
    } finally {
      setFetchingToken(false);
    }
  };

  const send = async () => {
    if (!req.url.trim()) return toast.error("Enter a URL");
    if (!resolved) return toast.error("Could not resolve request");
    setLoading(true);
    setError("");
    setResponse(null);
    abortRef.current = new AbortController();
    try {
      const bearer = await ensureToken(req);
      const outgoing = bearer ? { ...resolved, headers: { ...resolved.headers, Authorization: bearer } } : resolved;
      const res = await executeRequest(outgoing, abortRef.current.signal, req.settings);
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

  /** Assertions are re-evaluated live, so editing a check does not need another send. */
  const assertionResults: AssertionResult[] = useMemo(
    () => (response ? runAssertions(req.assertions, response) : []),
    [response, req.assertions],
  );
  const assertionSummary = summarize(assertionResults);
  const missingVars = useMemo(() => unresolvedVars(resolved), [resolved]);

  /** Load a sample and send it immediately — one click to a real response. */
  const runSample = async (sample: ApiSample) => {
    const loaded = requestFromSample(sample, req.id);
    setReq(loaded);
    setResponse(null);
    setError("");
    setTab(loaded.assertions?.length ? "tests" : "params");
    toast.success(sample.description);

    setLoading(true);
    abortRef.current = new AbortController();
    try {
      const resolvedSample = resolveRequest(loaded, vars);
      const res = await executeRequest(resolvedSample, abortRef.current.signal, loaded.settings);
      setResponse(res);
      setRespTab("body");
      store.pushHistory({ method: loaded.method, url: resolvedSample.url, status: res.status, timeMs: res.timeMs });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  const importCurl = () => {
    try {
      const imported = parseCurl(importText);
      // Keep the current id so an open request is replaced rather than orphaned.
      setReq({ ...imported, id: req.id });
      setResponse(null);
      setError("");
      setImportOpen(false);
      setImportText("");
      toast.success(`Imported ${imported.method} ${imported.url}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const importCollection = (text: string) => {
    try {
      const collection = importPostmanCollection(text);
      let count = 0;
      for (const folder of collection.folders) {
        const folderId = folder.name ? store.addFolder(folder.name) : null;
        for (const r of folder.requests) {
          store.saveRequest(r);
          store.assignRequestToFolder(r.id, folderId);
          count++;
        }
      }
      if (collection.variables.length > 0) {
        const envId = store.addEnvironment(`${collection.name} vars`, false);
        store.updateEnvironment({ id: envId, name: `${collection.name} vars`, isProduction: false, variables: collection.variables });
      }
      toast.success(`Imported ${count} request${count === 1 ? "" : "s"} from "${collection.name}"`);
      if (collection.skipped.length > 0) {
        toast.error(`Not imported: ${collection.skipped.slice(0, 3).join(", ")}`);
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  /**
   * Run every saved request in order, evaluating each one's checks — a smoke test for the
   * whole collection rather than one request at a time.
   */
  const runAll = async () => {
    const requests = Object.values(store.requests);
    if (requests.length === 0) return toast.error("Save some requests first");
    setRunning(true);
    setRunResult(null);
    cancelRun.current = false;
    try {
      const result = await runCollection(
        requests,
        async (r) => {
          const bearer = await ensureToken(r);
          const resolvedItem = resolveRequest(r, vars);
          const outgoing = bearer
            ? { ...resolvedItem, headers: { ...resolvedItem.headers, Authorization: bearer } }
            : resolvedItem;
          return executeRequest(outgoing, undefined, r.settings);
        },
        { delayMs: 0, stopOnFailure: false },
        {
          isCancelled: () => cancelRun.current,
          onResult: (item) =>
            setRunResult((cur) => ({
              items: [...(cur?.items ?? []), item],
              summary: cur?.summary ?? { total: 0, passed: 0, failed: 0, assertionsPassed: 0, assertionsFailed: 0, totalTimeMs: 0, stoppedEarly: false },
            })),
        },
      );
      setRunResult(result);
      log.info("api:runner", `Ran ${result.summary.total} requests — ${result.summary.passed} passed`);
      toast.success(`${result.summary.passed}/${result.summary.total} requests passed`);
    } finally {
      setRunning(false);
    }
  };

  const exportCollection = () => {
    const all = Object.values(store.requests);
    if (all.length === 0) return toast.error("No saved requests to export");
    const folders = store.folders.map((f) => ({
      name: f.name,
      requests: f.requestIds.map((id) => store.requests[id]).filter(Boolean),
    }));
    const foldered = new Set(store.folders.flatMap((f) => f.requestIds));
    const loose = all.filter((r) => !foldered.has(r.id));
    if (loose.length > 0) folders.unshift({ name: "", requests: loose });

    const blob = new Blob([exportPostmanCollection("DevHelper", folders)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "devhelper-collection.postman_collection.json";
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${all.length} request${all.length === 1 ? "" : "s"}`);
  };

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

  // Opened straight onto one saved request from the command palette.
  useEffect(() => {
    const handoff = useHandoffStore.getState().take("api-tester");
    const wanted = handoff?.fields.selectId;
    if (!wanted) return;
    const found = useApiStore.getState().requests[wanted];
    if (found) loadRequest(found);
    // loadRequest only touches setState functions, which are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Formatted body, for the Copy button in the response header. */
  const prettyBody = useMemo(() => {
    if (!response) return "";
    const ct = headerValue(response.headers, "content-type");
    return formatBody(detectBodyKind(ct, response.body), response.body).text || response.body;
  }, [response]);

  return (
    <div className="flex h-full">
      <CollectionsPanel currentId={req.id} onNew={newRequest} onLoad={loadRequest} />

      <div
        className="flex min-w-0 flex-1 flex-col"
        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !loading) { e.preventDefault(); send(); } }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Input
            className="h-8 w-48 font-medium"
            value={req.name}
            onChange={(e) => patch({ name: e.target.value })}
            placeholder="Request name"
          />
          <Button size="sm" variant="outline" onClick={() => setImportOpen((v) => !v)} title="Paste a cURL command">
            <Terminal /> Import cURL
          </Button>
          <input
            ref={collectionFileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => importCollection(String(reader.result));
              reader.readAsText(file);
              e.target.value = "";
            }}
          />
          <Button size="sm" variant="outline" onClick={() => collectionFileRef.current?.click()} title="Import a Postman collection (v2.1)">
            <Upload /> Postman
          </Button>
          <Button size="sm" variant="ghost" onClick={exportCollection} title="Export saved requests as a Postman collection">
            <Download />
          </Button>
          {running ? (
            <Button size="sm" variant="destructive" onClick={() => { cancelRun.current = true; }}>
              <Ban /> Stop run
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={runAll} title="Run every saved request and evaluate its checks">
              <PlayCircle /> Run all
            </Button>
          )}
          {/* Verified public endpoints, so the tester works before you own an API. */}
          <select
            className="h-8 max-w-56 rounded-md border border-input bg-transparent px-2 text-xs"
            value=""
            onChange={(e) => {
              const sample = apiSampleById(e.target.value);
              if (sample) runSample(sample);
            }}
            title="Load and send a public sample request"
          >
            <option value="">Sample request…</option>
            {SAMPLE_CATEGORIES.map((category) => (
              <optgroup key={category} label={category}>
                {API_SAMPLES.filter((s) => s.category === category).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <div className="ml-auto flex items-center gap-2">
            <EnvSelector />
            {activeEnv?.isProduction && (
              <Badge variant="destructive" className="gap-1"><AlertTriangle className="size-3" /> PRODUCTION</Badge>
            )}
          </div>
        </div>

        {importOpen && (
          <div className="mx-4 mt-3 flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-3">
            <Textarea
              mono
              autoFocus
              className="min-h-24 text-[12px]"
              placeholder={`curl 'https://api.example.com/users' \\\n  -H 'Authorization: Bearer token' \\\n  -d '{"name":"Ada"}'`}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
            {importText.trim() && !looksLikeCurl(importText) && (
              <p className="text-[11px] text-warning">
                This does not start with “curl”. Import still tries, but a copied command usually does.
              </p>
            )}
            <div className="flex items-center gap-2">
              <Button size="sm" disabled={!importText.trim()} onClick={importCurl}>Import</Button>
              <Button size="sm" variant="ghost" onClick={() => { setImportOpen(false); setImportText(""); }}>Cancel</Button>
              <span className="text-[11px] text-muted-foreground">
                Accepts anything curl accepts, including browser “Copy as cURL”.
              </span>
            </div>
          </div>
        )}

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
          {(["params", "headers", "auth", "body", "tests", "settings", "code"] as Tab[]).map((t) => (
            <TabButton key={t} active={tab === t} onClick={() => setTab(t)} label={tabLabel(t, req)} />
          ))}
          {missingVars.length > 0 && (
            <span
              className="ml-auto self-center text-[11px] text-warning"
              title={`No value in the active environment for: ${missingVars.join(", ")}`}
            >
              {missingVars.length} unresolved variable{missingVars.length === 1 ? "" : "s"}: {missingVars.slice(0, 3).join(", ")}
            </span>
          )}
        </div>

        <div className="max-h-64 overflow-auto p-4">
          {tab === "params" && <KeyValueEditor rows={req.query} onChange={(query) => patch({ query })} keyPlaceholder="param" />}
          {tab === "headers" && <KeyValueEditor rows={req.headers} onChange={(headers) => patch({ headers })} keyPlaceholder="Header" />}
          {tab === "auth" && (
            <AuthEditor req={req} patch={patch} token={tokenNote} onFetchToken={fetchToken} fetchingToken={fetchingToken} />
          )}
          {tab === "settings" && <SettingsEditor req={req} patch={patch} />}
          {tab === "body" && <BodyEditor req={req} patch={patch} />}
          {tab === "tests" && (
            <AssertionEditor
              assertions={req.assertions ?? []}
              results={assertionResults}
              onChange={(assertions) => patch({ assertions })}
            />
          )}
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

        {runResult && (
          <div className="mx-4 mb-2 rounded-md border border-border">
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
              <span className="font-medium">Collection run</span>
              <Badge variant={runResult.summary.failed === 0 && !running ? "success" : running ? "outline" : "destructive"}>
                {runResult.summary.passed ?? runResult.items.filter((i) => i.passed).length}/{runResult.items.length} passed
              </Badge>
              {running && <span className="text-muted-foreground">running…</span>}
              {runResult.summary.stoppedEarly && <Badge variant="warning">stopped early</Badge>}
              <div className="ml-auto flex items-center gap-1">
                <CopyButton value={runReportText(runResult)} label="Copy report" className="h-6 px-2 text-[10px]" />
                <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => setRunResult(null)}>Close</Button>
              </div>
            </div>
            <div className="max-h-40 overflow-auto">
              {runResult.items.map((item, i) => (
                <button
                  key={`${item.request.id}-${item.iteration}-${i}`}
                  onClick={() => loadRequest(item.request)}
                  className="flex w-full items-center gap-2 border-b border-border/40 px-3 py-1 text-left text-[11px] last:border-0 hover:bg-muted/50"
                >
                  <span className={cn("w-10 shrink-0 font-medium", item.passed ? "text-success" : "text-destructive")}>
                    {item.passed ? "PASS" : "FAIL"}
                  </span>
                  <span className={cn("w-14 shrink-0 font-mono", METHOD_COLOR[item.request.method])}>{item.request.method}</span>
                  <span className="min-w-0 flex-1 truncate">{item.request.name}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {item.error ? item.error : `${item.response?.status} · ${item.timeMs} ms`}
                  </span>
                  {item.assertions.length > 0 && (
                    <span className="shrink-0 text-muted-foreground">
                      {item.assertions.filter((a) => a.passed).length}/{item.assertions.length} checks
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

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
                {assertionSummary.total > 0 && (
                  <button
                    onClick={() => setTab("tests")}
                    title="Open the Tests tab"
                    className={cn(
                      "rounded border px-1.5 py-0.5 text-[11px]",
                      assertionSummary.allPassed
                        ? "border-success/50 bg-success/10 text-success"
                        : "border-destructive/50 bg-destructive/10 text-destructive",
                    )}
                  >
                    Tests {assertionSummary.passed}/{assertionSummary.total} passed
                  </button>
                )}
                <div className="ml-auto flex gap-1">
                  <TabButton active={respTab === "body"} onClick={() => setRespTab("body")} label="Body" />
                  <TabButton active={respTab === "headers"} onClick={() => setRespTab("headers")} label={`Headers (${Object.keys(response.headers).length})`} />
                  <CopyButton value={respTab === "body" ? prettyBody : JSON.stringify(response.headers, null, 2)} size="sm" variant="ghost" />
                  <AddToDebug makeEvent={responseEvent} label="Debug" variant="ghost" />
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
                {respTab === "body" ? (
                  <ApiResponseBody body={response.body} headers={response.headers} />
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
    case "tests": {
      const active = (req.assertions ?? []).filter((a) => a.enabled).length;
      return `Tests${active ? ` (${active})` : ""}`;
    }
    case "settings": return req.settings?.timeoutMs || req.settings?.followRedirects === false ? "Settings •" : "Settings";
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

function AuthEditor({
  req,
  patch,
  token,
  onFetchToken,
  fetchingToken,
}: {
  req: ApiRequest;
  patch: (p: Partial<ApiRequest>) => void;
  token?: string;
  onFetchToken?: () => void;
  fetchingToken?: boolean;
}) {
  const setAuth = (p: Partial<ApiRequest["auth"]>) => patch({ auth: { ...req.auth, ...p } });
  return (
    <div className="flex flex-col gap-3">
      <select className="h-8 w-48 rounded-md border border-input bg-transparent px-2 text-sm" value={req.auth.type} onChange={(e) => setAuth({ type: e.target.value as AuthType })}>
        <option value="none">No Auth</option>
        <option value="bearer">Bearer Token</option>
        <option value="basic">Basic Auth</option>
        <option value="apikey">API Key</option>
        <option value="oauth2">OAuth 2.0 (client credentials)</option>
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
      {req.auth.type === "apikey" && (
        <div className="flex max-w-2xl flex-col gap-2">
          <div className="flex gap-2">
            <Input placeholder="Key name, e.g. X-API-Key" value={req.auth.apiKeyName ?? ""} onChange={(e) => setAuth({ apiKeyName: e.target.value })} />
            <Input className="font-mono text-xs" placeholder="Value (supports {{API_KEY}})" value={req.auth.apiKeyValue ?? ""} onChange={(e) => setAuth({ apiKeyValue: e.target.value })} />
            <select
              className="h-9 w-32 rounded-md border border-input bg-transparent px-2 text-sm"
              value={req.auth.apiKeyIn ?? "header"}
              onChange={(e) => setAuth({ apiKeyIn: e.target.value as "header" | "query" })}
            >
              <option value="header">Header</option>
              <option value="query">Query</option>
            </select>
          </div>
        </div>
      )}
      {req.auth.type === "oauth2" && (
        <div className="flex max-w-2xl flex-col gap-2">
          <Input placeholder="Token URL — https://id.example.com/oauth2/token" value={req.auth.tokenUrl ?? ""} onChange={(e) => setAuth({ tokenUrl: e.target.value })} />
          <div className="flex gap-2">
            <Input placeholder="Client ID" value={req.auth.clientId ?? ""} onChange={(e) => setAuth({ clientId: e.target.value })} />
            <Input type="password" placeholder="Client secret" value={req.auth.clientSecret ?? ""} onChange={(e) => setAuth({ clientSecret: e.target.value })} />
          </div>
          <div className="flex gap-2">
            <Input placeholder="Scope (optional)" value={req.auth.scope ?? ""} onChange={(e) => setAuth({ scope: e.target.value })} />
            <select
              className="h-9 w-56 rounded-md border border-input bg-transparent px-2 text-sm"
              value={req.auth.clientAuth ?? "header"}
              onChange={(e) => setAuth({ clientAuth: e.target.value as "header" | "body" })}
            >
              <option value="header">Credentials in header</option>
              <option value="body">Credentials in body</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={onFetchToken} disabled={fetchingToken}>
              {fetchingToken ? "Requesting…" : "Get token"}
            </Button>
            <span className={cn("text-[11px]", token ? "text-success" : "text-muted-foreground")}>
              {token ?? "No token yet — one is fetched automatically on send."}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            The client credentials grant, for machine-to-machine APIs. The token is cached per client and scope,
            refreshed before it expires, and never written to disk.
          </p>
        </div>
      )}
    </div>
  );
}

/** Per-request transport settings, plus the dynamic-variable reference. */
function SettingsEditor({ req, patch }: { req: ApiRequest; patch: (p: Partial<ApiRequest>) => void }) {
  const set = (p: Partial<NonNullable<ApiRequest["settings"]>>) => patch({ settings: { ...req.settings, ...p } });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          Timeout
          <Input
            type="number"
            className="h-8 w-28"
            placeholder="none"
            value={req.settings?.timeoutMs ?? ""}
            onChange={(e) => set({ timeoutMs: e.target.value === "" ? undefined : Number(e.target.value) })}
          />
          <span className="text-xs text-muted-foreground">ms</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={req.settings?.followRedirects !== false}
            onChange={(e) => set({ followRedirects: e.target.checked })}
          />
          Follow redirects
        </label>
        <span className="text-[11px] text-muted-foreground">
          Turn redirects off to inspect the 3xx and its Location header instead of the destination.
        </span>
      </div>

      <div>
        <p className="mb-1 text-xs font-medium">Dynamic variables</p>
        <p className="mb-2 text-[11px] text-muted-foreground">
          Generated fresh on every send, anywhere in the URL, headers or body. Two occurrences produce two values.
        </p>
        <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
          {DYNAMIC_VARS.map((v) => (
            <div key={v.name} className="flex items-baseline gap-2 text-[11px]">
              <code className="mono shrink-0 rounded bg-muted px-1">{`{{${v.name}}}`}</code>
              <span className="text-muted-foreground">{v.description}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Declarative response checks — Postman's Tests tab without running user scripts. */
function AssertionEditor({
  assertions,
  results,
  onChange,
}: {
  assertions: Assertion[];
  results: AssertionResult[];
  onChange: (a: Assertion[]) => void;
}) {
  const patchAt = (id: string, p: Partial<Assertion>) =>
    onChange(assertions.map((a) => (a.id === id ? { ...a, ...p } : a)));
  const resultFor = (id: string) => results.find((r) => r.assertion.id === id);

  const KINDS: { value: AssertionKind; label: string; needsTarget: boolean }[] = [
    { value: "status", label: "Status code", needsTarget: false },
    { value: "jsonPath", label: "JSONPath", needsTarget: true },
    { value: "header", label: "Header", needsTarget: true },
    { value: "bodyContains", label: "Body", needsTarget: false },
    { value: "responseTime", label: "Response time", needsTarget: false },
  ];
  const OPS: AssertionOp[] = ["equals", "notEquals", "contains", "lessThan", "greaterThan", "exists"];

  return (
    <div className="flex flex-col gap-2">
      {assertions.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No checks yet. A check runs against every response — status codes, JSONPath values, headers or timing.
        </p>
      )}

      {assertions.map((a) => {
        const kind = KINDS.find((k) => k.value === a.kind)!;
        const result = resultFor(a.id);
        return (
          <div key={a.id} className="flex flex-wrap items-center gap-2">
            <input type="checkbox" checked={a.enabled} onChange={(e) => patchAt(a.id, { enabled: e.target.checked })} title="Enabled" />
            <select
              className="h-8 w-36 rounded-md border border-input bg-transparent px-2 text-xs"
              value={a.kind}
              onChange={(e) => patchAt(a.id, { kind: e.target.value as AssertionKind })}
            >
              {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
            {kind.needsTarget && (
              <Input
                className="h-8 w-56 font-mono text-xs"
                placeholder={a.kind === "jsonPath" ? "$.data.items[0].id" : "Header name"}
                value={a.target ?? ""}
                onChange={(e) => patchAt(a.id, { target: e.target.value })}
              />
            )}
            <select
              className="h-8 w-28 rounded-md border border-input bg-transparent px-2 text-xs"
              value={a.op}
              onChange={(e) => patchAt(a.id, { op: e.target.value as AssertionOp })}
            >
              {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            {a.op !== "exists" && (
              <Input
                className="h-8 w-40 font-mono text-xs"
                placeholder="expected"
                value={a.expected ?? ""}
                onChange={(e) => patchAt(a.id, { expected: e.target.value })}
              />
            )}

            {result && (
              <span className={cn("flex items-center gap-1 text-[11px]", result.passed ? "text-success" : "text-destructive")}>
                {result.passed ? <Check className="size-3" /> : <X className="size-3" />}
                got {result.actual}
                {result.detail && <span className="text-muted-foreground">({result.detail})</span>}
              </span>
            )}

            <button
              className="ml-auto text-muted-foreground hover:text-destructive"
              title="Remove this check"
              aria-label="Remove this check"
              onClick={() => onChange(assertions.filter((x) => x.id !== a.id))}
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}

      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => onChange([...assertions, defaultAssertion(uid())])}>
          <Plus /> Add check
        </Button>
        {results.length > 0 && (
          <span className="text-[11px] text-muted-foreground">
            {results.filter((r) => r.passed).length}/{results.length} passing — {results.map((r) => describeAssertion(r.assertion)).slice(0, 2).join("; ")}
          </span>
        )}
      </div>
    </div>
  );
}

function BodyEditor({ req, patch }: { req: ApiRequest; patch: (p: Partial<ApiRequest>) => void }) {
  const types: BodyType[] = ["none", "json", "graphql", "xml", "x-www-form-urlencoded", "raw"];

  if (req.bodyType === "graphql") {
    return (
      <div className="flex flex-col gap-2">
        <select className="h-8 w-56 rounded-md border border-input bg-transparent px-2 text-sm" value={req.bodyType} onChange={(e) => patch({ bodyType: e.target.value as BodyType })}>
          {types.map((t) => (<option key={t} value={t}>{t}</option>))}
        </select>
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Query</span>
            <Textarea mono className="h-36" value={req.body} onChange={(e) => patch({ body: e.target.value })} placeholder={"query Orders($id: ID!) {\n  order(id: $id) { id total }\n}"} />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Variables (JSON)</span>
            <Textarea mono className="h-36" value={req.graphqlVariables ?? ""} onChange={(e) => patch({ graphqlVariables: e.target.value })} placeholder={'{ "id": "42" }'} />
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Sent as JSON — <span className="mono">{'{ "query": …, "variables": … }'}</span> — with a POST to the GraphQL endpoint.
        </p>
      </div>
    );
  }

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
