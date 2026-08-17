import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Activity, AlertTriangle, Pause, Play, Plus, RotateCcw, Trash2 } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AddToDebug } from "@/components/AddToDebug";
import { executeRequest, corsLimited } from "@/lib/http";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { useHealthStore } from "@/stores/useHealthStore";
import {
  boardSummary,
  DEFAULT_WATCHER,
  errorBudget,
  health,
  isDue,
  judge,
  missingSecrets,
  stagger,
  stateChangeEvent,
  type Health,
  type HealthState,
  type Watcher,
} from "@/tools/lib/healthBoard";

const STATE_CLASS: Record<HealthState, string> = {
  up: "text-success",
  slow: "text-warning",
  degraded: "text-warning",
  down: "text-destructive",
  unknown: "text-muted-foreground",
};

/** How often the loop wakes to see what is due. */
const TICK_MS = 2000;

export function HealthBoard() {
  const { watchers, probes, target, running } = useHealthStore();
  const { add, update, remove, record, clear, setTarget, setRunning } = useHealthStore();

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  // Not state: writing here must not re-render, and the loop reads it directly.
  const lastAt = useRef<Record<string, number>>({});
  const startedAt = useRef(Date.now());
  const previousState = useRef<Record<string, HealthState>>({});

  const entries = useMemo(
    () => watchers.map((watcher) => ({ watcher, health: health(watcher, probes[watcher.id] ?? []) })),
    [watchers, probes],
  );

  useEffect(() => {
    if (!running) return;
    let cancelled = false;

    const probe = async (watcher: Watcher) => {
      const started = performance.now();
      try {
        const res = await executeRequest(
          { method: watcher.method, url: watcher.url, headers: watcher.headers, body: watcher.body },
          undefined,
          { timeoutMs: watcher.timeoutMs },
        );
        record(watcher.id, judge(watcher, { status: res.status, ms: res.timeMs, body: res.body }, Date.now()));
      } catch (e) {
        record(
          watcher.id,
          judge(
            watcher,
            { status: 0, ms: Math.round(performance.now() - started), body: "", error: e instanceof Error ? e.message : String(e) },
            Date.now(),
          ),
        );
      }
    };

    const tick = () => {
      if (cancelled) return;
      const now = Date.now();
      useHealthStore.getState().watchers.forEach((watcher, index) => {
        // Stagger the first probe so a board of twenty does not fire twenty
        // requests in one instant, every interval, forever.
        const offset = stagger(index, useHealthStore.getState().watchers.length, watcher.intervalMs);
        if (lastAt.current[watcher.id] === undefined && now - startedAt.current < offset) return;
        if (!isDue(watcher, lastAt.current[watcher.id], now)) return;
        lastAt.current[watcher.id] = now;
        void probe(watcher);
      });
    };

    tick();
    const timer = setInterval(tick, TICK_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [running, record]);

  // Toast on a state change, so the board is useful in a background tab.
  useEffect(() => {
    for (const entry of entries) {
      const before = previousState.current[entry.watcher.id];
      const now = entry.health.state;
      if (before && before !== now && now !== "unknown") {
        if (now === "down") toast.error(`${entry.watcher.name} is down`);
        else if (before === "down") toast.success(`${entry.watcher.name} recovered`);
      }
      previousState.current[entry.watcher.id] = now;
    }
  }, [entries]);

  const addWatcher = () => {
    if (!url.trim()) return toast.error("Give a URL to watch.");
    add({ ...DEFAULT_WATCHER, id: `w${Date.now().toString(36)}`, name: name.trim() || new URL(url.trim()).hostname, url: url.trim() });
    setName("");
    setUrl("");
  };

  return (
    <ToolShell
      toolId="health-board"
      title="Integration Health Board"
      description="Watch the endpoints your integration depends on — percentiles, not averages, and an error budget."
      actions={
        <Button size="sm" variant={running ? "outline" : "default"} onClick={() => setRunning(!running)}>
          {running ? <Pause className="size-3.5" /> : <Play className="size-3.5" />} {running ? "Pause" : "Start"}
        </Button>
      }
    >
      {corsLimited() && (
        <div className="mb-3 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
          Browser dev mode: cross-origin probes are blocked. Use the desktop app.
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
        <F label="Name"><Input className="h-8 w-40" value={name} onChange={(e) => setName(e.target.value)} placeholder="Orders API" /></F>
        <F label="URL">
          <Input
            className="mono h-8 w-[28rem]"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://api.example/health"
            onKeyDown={(e) => e.key === "Enter" && addWatcher()}
          />
        </F>
        <Button size="sm" onClick={addWatcher}><Plus className="size-3.5" /> Watch</Button>
        <F label="Availability target (%)">
          <Input type="number" step="0.1" className="h-8 w-24" value={target} onChange={(e) => setTarget(Number(e.target.value) || 99.5)} />
        </F>
        {watchers.length > 0 && (
          <>
            <Badge variant="outline">{boardSummary(entries)}</Badge>
            <Button size="sm" variant="ghost" onClick={() => clear()}><RotateCcw className="size-3.5" /> Clear history</Button>
          </>
        )}
      </div>

      {watchers.length === 0 ? (
        <div className="rounded-md border border-border p-4 text-[11px] text-muted-foreground">
          <p className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Activity className="size-4" /> Nothing being watched
          </p>
          <p className="mt-2">
            This is for the endpoints proper monitoring does not cover: the third-party sandbox you are integrating
            against this week, the on-premise service reachable only from this laptop, the endpoint you have just
            changed and want to keep an eye on for an hour. Add one above and press Start.
          </p>
          <p className="mt-2">
            Latency is reported as percentiles rather than an average, because an endpoint answering in 40 ms nineteen
            times and 9 seconds once averages 490 ms and looks healthy while one user in twenty times out.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {entries.map(({ watcher, health: current }) => {
            const budget = errorBudget(current.probes, current.failures, target);
            const missing = missingSecrets(watcher);
            const open = expanded === watcher.id;
            return (
              <div key={watcher.id} className="rounded-md border border-border">
                <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className={cn("text-sm font-medium", STATE_CLASS[current.state])}>●</span>
                  <button className="text-sm font-medium hover:underline" onClick={() => setExpanded(open ? null : watcher.id)}>
                    {watcher.name}
                  </button>
                  <Badge variant={current.state === "down" ? "destructive" : current.state === "up" ? "success" : "warning"} className="text-[9px]">
                    {current.state}
                  </Badge>
                  <span className="mono truncate text-[10px] text-muted-foreground">{watcher.url}</span>

                  <div className="ml-auto flex items-center gap-3 text-[11px]">
                    <span title="50th percentile">p50 {Math.round(current.p50)}ms</span>
                    <span className={cn(watcher.sloMs > 0 && current.p95 > watcher.sloMs && "text-warning")} title="95th percentile">
                      p95 {Math.round(current.p95)}ms
                    </span>
                    <span title="99th percentile">p99 {Math.round(current.p99)}ms</span>
                    <span>{current.probes ? `${current.availability.toFixed(1)}%` : "—"}</span>
                    <Badge variant={budget.remaining === 0 && budget.allowed > 0 ? "destructive" : "outline"} className="text-[9px]">
                      {budget.allowed > 0 ? `${budget.remaining}/${budget.allowed} left` : "budget n/a"}
                    </Badge>
                    <AddToDebug
                      variant="ghost"
                      label="Debug"
                      makeEvent={() => stateChangeEvent(watcher, "unknown", current.state, current)}
                    />
                    <Button size="sm" variant="ghost" onClick={() => remove(watcher.id)}><Trash2 className="size-3" /></Button>
                  </div>
                </div>

                <Sparkline health={current} probes={(probes[watcher.id] ?? []).slice(-60)} />

                <p className="px-3 pb-2 text-[11px] text-muted-foreground">
                  {current.message} {budget.message}
                  {missing.length > 0 && (
                    <b className="text-warning"> {missing.join(", ")} was cleared on restart — credential headers are never written to disk.</b>
                  )}
                </p>

                {open && (
                  <div className="flex flex-wrap items-end gap-2 border-t border-border px-3 py-2">
                    <F label="Method">
                      <select className="h-7 rounded-md border border-border bg-background px-1 text-[11px]" value={watcher.method} onChange={(e) => update(watcher.id, { method: e.target.value })}>
                        {["GET", "POST", "HEAD", "PUT"].map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </F>
                    <F label="Interval (ms)">
                      <Input type="number" className="h-7 w-24 text-[11px]" value={watcher.intervalMs} onChange={(e) => update(watcher.id, { intervalMs: Math.max(2000, Number(e.target.value) || 30000) })} />
                    </F>
                    <F label="Timeout (ms)">
                      <Input type="number" className="h-7 w-24 text-[11px]" value={watcher.timeoutMs} onChange={(e) => update(watcher.id, { timeoutMs: Number(e.target.value) || 10000 })} />
                    </F>
                    <F label="SLO (ms)">
                      <Input type="number" className="h-7 w-24 text-[11px]" value={watcher.sloMs} onChange={(e) => update(watcher.id, { sloMs: Number(e.target.value) || 0 })} />
                    </F>
                    <F label="Expect status (0 = any 2xx)">
                      <Input type="number" className="h-7 w-28 text-[11px]" value={watcher.expectStatus} onChange={(e) => update(watcher.id, { expectStatus: Number(e.target.value) || 0 })} />
                    </F>
                    <F label="Body must contain">
                      <Input className="h-7 w-56 text-[11px]" value={watcher.expectBody ?? ""} onChange={(e) => update(watcher.id, { expectBody: e.target.value })} placeholder='"status":"ok"' />
                    </F>
                    <F label="Authorization header">
                      <Input
                        type="password"
                        className="h-7 w-56 text-[11px]"
                        value={watcher.headers.Authorization ?? ""}
                        onChange={(e) => update(watcher.id, { headers: { ...watcher.headers, Authorization: e.target.value } })}
                        placeholder="Bearer … (session only)"
                      />
                    </F>
                    <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <input type="checkbox" checked={watcher.enabled} onChange={(e) => update(watcher.id, { enabled: e.target.checked })} />
                      enabled
                    </label>
                    <p className="w-full text-[10px] text-muted-foreground">
                      A body check earns its place: a 200 from a load balancer, a WAF page or a login redirect is not the
                      service answering, and an availability figure built on those is worse than none.
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {watchers.length > 0 && !running && (
        <p className="mt-3 text-[11px] text-warning">
          <AlertTriangle className="mr-1 inline size-3" />
          Paused — nothing is being probed. The board never starts on its own after a restart.
        </p>
      )}
    </ToolShell>
  );
}

/** A bar per probe: height is latency, colour is outcome. */
function Sparkline({ health: current, probes }: { health: Health; probes: { ok: boolean; ms: number; slow?: boolean }[] }) {
  if (probes.length === 0) return null;
  const max = Math.max(current.p99, 1);
  return (
    <div className="flex h-8 items-end gap-px px-3">
      {probes.map((probe, i) => (
        <div
          key={i}
          title={probe.ok ? `${probe.ms} ms` : "failed"}
          className={cn(
            "w-1.5 rounded-sm",
            !probe.ok ? "bg-destructive" : probe.slow ? "bg-warning" : "bg-success/70",
          )}
          style={{ height: `${probe.ok ? Math.max(8, Math.min(100, (probe.ms / max) * 100)) : 100}%` }}
        />
      ))}
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
