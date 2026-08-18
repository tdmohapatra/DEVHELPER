import { useCallback, useEffect, useRef, useState } from "react";
import { HardDrive, Play, RefreshCw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import { useAiStore } from "@/stores/useAiStore";
import { findRuntime, scanModels, serverStatus, startServer, stopServer, type LlmStatus } from "@/lib/localLlmClient";
import { formatModelSize, offlineProblem, type LocalModel } from "@/tools/lib/localLlm";
import { cn } from "@/lib/utils";

/**
 * Settings → AI → Offline: pick a downloaded model and run it.
 *
 * The panel is deliberately honest about the two-part state. A model can be
 * chosen and not running; the badge says which, because every AI tool in
 * DevHelper is unavailable in the first case and the user is the only one who
 * can change that.
 */
export function OfflineLlmPanel() {
  const ai = useAiStore();
  const [models, setModels] = useState<LocalModel[]>([]);
  const [runtime, setRuntime] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<LlmStatus | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const alive = useRef(true);

  useEffect(() => () => { alive.current = false; }, []);

  const refresh = useCallback(async (quiet = false) => {
    setScanning(true);
    try {
      const [found, rt] = await Promise.all([
        scanModels(ai.localHubDir),
        findRuntime(ai.localHubDir, ai.localRuntimePath),
      ]);
      if (!alive.current) return;
      setModels(found);
      setRuntime(rt);
      if (!quiet) toast.success(`${found.length} model${found.length === 1 ? "" : "s"} in ${ai.localHubDir}`);
    } catch (e) {
      if (!alive.current) return;
      setModels([]);
      // A folder that does not exist yet is the normal first run, not an error
      // worth a red toast.
      if (!quiet) toast.error((e as Error).message);
    } finally {
      if (alive.current) setScanning(false);
    }
  }, [ai.localHubDir, ai.localRuntimePath]);

  // Scan once on open, and re-sync with whatever server is already running —
  // Settings can be closed and reopened while a model stays loaded.
  useEffect(() => {
    void refresh(true);
    void serverStatus().then((s) => {
      if (!alive.current) return;
      setStatus(s);
      if (s.running && s.port) useAiStore.getState().set({ localPort: s.port, localRunning: true });
      else useAiStore.getState().set({ localRunning: false });
    });
    // Only on mount: re-scanning on every keystroke in the folder box would walk
    // the disk per character.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = models.find((m) => m.path === ai.localModelPath) ?? null;
  const problem = offlineProblem({
    hubDir: ai.localHubDir,
    runtimePath: runtime,
    modelPath: ai.localModelPath,
    models,
  });

  const start = async () => {
    if (!selected) return;
    setBusy(true);
    setLog([]);
    try {
      const port = await startServer({
        model: selected,
        hubDir: ai.localHubDir,
        runtimePath: ai.localRuntimePath,
        ctxSize: ai.localCtxSize,
        gpuLayers: ai.localGpuLayers,
        threads: ai.localThreads,
        onProgress: (s) => { if (alive.current) { setStatus(s); setLog(s.log.slice(-8)); } },
      });
      if (!alive.current) return;
      setStatus(await serverStatus());
      toast.success(`${selected.name} is loaded on port ${port}`);
    } catch (e) {
      if (!alive.current) return;
      const err = e as Error & { log?: string[] };
      setLog(err.log ?? []);
      setStatus(await serverStatus());
      toast.error(err.message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      await stopServer();
      setStatus(null);
      setLog([]);
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Labeled label="Model folder" full>
          <div className="flex gap-2">
            <Input
              value={ai.localHubDir}
              onChange={(e) => ai.set({ localHubDir: e.target.value })}
              placeholder="C:/TDM/TDM_OFFLINE_LLMHUB"
            />
            <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={scanning}>
              <RefreshCw className={cn("size-4", scanning && "animate-spin")} /> Scan
            </Button>
          </div>
        </Labeled>
      </div>

      <div className="rounded-md border">
        <div className="flex items-center justify-between border-b px-3 py-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-2"><HardDrive className="size-3.5" /> {models.length} GGUF model{models.length === 1 ? "" : "s"}</span>
          <span>{runtime ? `runtime: ${runtime}` : "runtime: not found"}</span>
        </div>
        {models.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            Nothing found under {ai.localHubDir}. Put .gguf files there and press Scan.
          </p>
        ) : (
          <ul className="max-h-56 overflow-y-auto">
            {models.map((m) => {
              const active = m.path === ai.localModelPath;
              return (
                <li key={m.path}>
                  <button
                    type="button"
                    onClick={() => ai.set({ localModelPath: m.path, localModelLabel: m.quant ? `${m.name}-${m.quant}` : m.name })}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent",
                      active && "bg-accent",
                    )}
                  >
                    <span className="truncate">
                      <span className={cn(active && "font-medium")}>{m.name}</span>
                      {/* The kind is on the badge, so it is left out here. */}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {[m.quant, formatModelSize(m.size), m.shards > 1 ? `${m.shards} shards` : null].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    {m.problem
                      ? <Badge variant="destructive" className="shrink-0">{m.problem}</Badge>
                      : m.kind === "embedding"
                        // Not an error — an embedding model in the hub is normal,
                        // it just cannot answer anything.
                        ? <Badge variant="secondary" className="shrink-0">embedding</Badge>
                        : active && status?.running && status.model === m.path
                          ? <Badge variant="success" className="shrink-0">loaded</Badge>
                          : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Labeled label="Context">
          <Input
            type="number"
            value={ai.localCtxSize}
            onChange={(e) => ai.set({ localCtxSize: Math.max(256, Number(e.target.value) || 0) })}
          />
        </Labeled>
        <Labeled label="GPU layers (-1 = all)">
          <Input
            type="number"
            value={ai.localGpuLayers}
            onChange={(e) => ai.set({ localGpuLayers: Number(e.target.value) || 0 })}
          />
        </Labeled>
        <Labeled label="Threads (0 = auto)">
          <Input
            type="number"
            value={ai.localThreads}
            onChange={(e) => ai.set({ localThreads: Math.max(0, Number(e.target.value) || 0) })}
          />
        </Labeled>
        <Labeled label="llama-server path (optional)" full>
          <Input
            value={ai.localRuntimePath}
            onChange={(e) => ai.set({ localRuntimePath: e.target.value })}
            placeholder={`${ai.localHubDir.replace(/[/\\]+$/, "")}/runtime/llama-server.exe`}
          />
        </Labeled>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {status?.running ? (
          <Button size="sm" variant="outline" onClick={() => void stop()} disabled={busy}>
            <Square className="size-4" /> Stop
          </Button>
        ) : (
          <Button size="sm" onClick={() => void start()} disabled={busy || !!problem}>
            <Play className="size-4" /> {busy ? "Loading…" : "Start model"}
          </Button>
        )}
        <Badge variant={status?.running ? "success" : "secondary"}>
          {busy ? "loading" : status?.running ? `running · port ${status.port}` : "stopped"}
        </Badge>
        {problem && <span className="text-xs text-muted-foreground">{problem}</span>}
        <span className="text-xs text-muted-foreground">Prompts stay on this machine.</span>
      </div>

      {log.length > 0 && (
        <pre className="max-h-40 overflow-auto rounded-md bg-muted p-2 text-[11px] leading-snug">
          {log.join("\n")}
        </pre>
      )}
    </div>
  );
}

function Labeled({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <label className={cn("block space-y-1", full && "col-span-full")}>
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
