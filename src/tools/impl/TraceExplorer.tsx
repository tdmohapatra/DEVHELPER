import { useMemo, useState } from "react";
import { Search, Sparkles, ArrowRight, TriangleAlert, ClipboardPaste, FolderPlus, Clock } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/CopyButton";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { useDebugStore } from "@/stores/useDebugStore";
import { useAiStore } from "@/stores/useAiStore";
import { aiChat, aiDestinationLabel } from "@/lib/ai";
import {
  DEBUG_SOURCES,
  sortEvents,
  eventMatchesId,
  serviceFlow,
  traceSummary,
  parseLogEntries,
  buildAiContext,
  toMarkdown,
  formatEventTime,
  type DebugEvent,
  type DebugStatus,
} from "@/tools/lib/debugSession";

const STATUS_DOT: Record<DebugStatus, string> = {
  ok: "bg-success",
  error: "bg-destructive",
  warn: "bg-warning",
  info: "bg-muted-foreground/50",
  pending: "bg-muted-foreground/30",
};
const HOP_STYLE: Record<DebugStatus, string> = {
  ok: "border-success/40 bg-success/10 text-success",
  error: "border-destructive/40 bg-destructive/10 text-destructive",
  warn: "border-warning/40 bg-warning/10 text-warning",
  info: "border-border bg-secondary text-foreground",
  pending: "border-border bg-secondary text-muted-foreground",
};

let SYNTH = 0;
const synthId = () => `trace-${++SYNTH}`;

export function TraceExplorer() {
  const sessions = useDebugStore((s) => s.sessions);
  const createSession = useDebugStore((s) => s.createSession);
  const importEvents = useDebugStore((s) => s.importEvents);
  const aiConfigured = useAiStore((s) => s.isConfigured());

  const [id, setId] = useState("");
  const [ran, setRan] = useState(false);
  const [pasted, setPasted] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [aiOut, setAiOut] = useState("");
  const [aiBusy, setAiBusy] = useState(false);

  // All events across every session, plus any pasted-and-parsed logs.
  const allEvents = useMemo(() => {
    const fromSessions: DebugEvent[] = sessions.flatMap((s) =>
      s.events.map((e) => ({ ...e, service: e.service })),
    );
    const fromPaste: DebugEvent[] = pasted.trim()
      ? parseLogEntries(pasted).map((p) => ({ ...p, id: synthId(), at: p.at ?? 0 }))
      : [];
    return [...fromSessions, ...fromPaste];
  }, [sessions, pasted]);

  const matches = useMemo(() => {
    if (!id.trim()) return [];
    return sortEvents(allEvents.filter((e) => eventMatchesId(e, id)));
  }, [allEvents, id]);

  const hops = useMemo(() => serviceFlow(matches), [matches]);
  const summary = useMemo(() => traceSummary(matches), [matches]);

  const suggestions = useMemo(() => {
    const ids = new Set<string>();
    for (const e of allEvents) {
      if (e.correlationId) ids.add(e.correlationId);
      if (e.traceId) ids.add(e.traceId);
    }
    return [...ids].slice(0, 12);
  }, [allEvents]);

  const pseudoSession = { id: "trace", name: `Trace ${id}`, createdAt: 0, events: matches };

  function openInSession() {
    if (matches.length === 0) return;
    const sid = createSession(`Trace ${id}`);
    importEvents(sid, matches.map(({ id: _id, at, ...rest }) => ({ ...rest, at })));
    toast.success(`Created session "Trace ${id}"`);
  }

  async function diagnose() {
    setAiBusy(true);
    setAiOut("");
    try {
      const out = await aiChat([
        {
          role: "system",
          content:
            "You are a distributed-systems SRE. Given a single correlation/trace's chronological events across services, identify where and why it failed. Sections: Root Cause, Evidence, Failure Point, Confidence, Recommended Actions. Separate fact from inference. Be concise.",
        },
        { role: "user", content: buildAiContext(pseudoSession) },
      ]);
      setAiOut(out);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAiBusy(false);
    }
  }

  const search = () => setRan(true);

  return (
    <ToolShell
      toolId="trace-explorer"
      title="Trace Explorer"
      description="Enter a correlation / trace / request id and reconstruct its path across every captured source — timeline, service flow and failure point."
    >
      <div className="flex flex-col gap-4">
        {/* Search bar */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-64 flex-1 items-center gap-2 rounded-md border border-border px-2">
            <Search className="size-4 text-muted-foreground" />
            <input
              value={id}
              onChange={(e) => { setId(e.target.value); setRan(true); }}
              onKeyDown={(e) => e.key === "Enter" && search()}
              placeholder="Correlation id, trace id, request id, order id…"
              className="h-9 flex-1 bg-transparent text-sm outline-none"
            />
          </div>
          <Button size="sm" variant="outline" onClick={() => setShowPaste((v) => !v)}><ClipboardPaste /> Add logs</Button>
        </div>

        {suggestions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <span className="text-muted-foreground">Known ids:</span>
            {suggestions.map((s) => (
              <button key={s} onClick={() => { setId(s); setRan(true); }} className="rounded-full bg-secondary px-2 py-0.5 text-[11px] hover:bg-primary/15 hover:text-primary">{s}</button>
            ))}
          </div>
        )}

        {showPaste && (
          <div className="rounded-md border border-border p-3">
            <p className="mb-2 text-xs text-muted-foreground">Paste extra logs (JSON array / NDJSON / plain lines) to include them in the search — parsed the same way as Debug Session import.</p>
            <Textarea mono value={pasted} onChange={(e) => setPasted(e.target.value)} className="min-h-32" placeholder='{"@t":"...","@m":"...","CorrelationId":"..."}' />
          </div>
        )}

        {ran && id.trim() && (
          matches.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No events found for <code className="mono">{id}</code>. Capture events via the Debug button in API Tester / Database Toolkit, or paste logs above.
            </p>
          ) : (
            <>
              {/* Summary */}
              <div className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3 text-sm">
                <span className="font-medium">{matches.length} events</span>
                <span className="flex items-center gap-1 text-muted-foreground"><Clock className="size-3.5" /> {summary.durationMs} ms span</span>
                {summary.errors > 0 ? (
                  <Badge variant="destructive" className="gap-1"><TriangleAlert className="size-3" /> {summary.errors} error{summary.errors === 1 ? "" : "s"}</Badge>
                ) : (
                  <Badge variant="success">healthy</Badge>
                )}
                {summary.failurePoint && (
                  <span className="text-destructive">Failure at <b>{summary.failurePoint.service || summary.failurePoint.source}</b> — {summary.failurePoint.title}</span>
                )}
                <div className="ml-auto flex gap-1">
                  <Button size="sm" onClick={diagnose} disabled={aiBusy || !aiConfigured}><Sparkles /> {aiBusy ? "Diagnosing…" : "Diagnose"}</Button>
                  <CopyButton value={buildAiContext(pseudoSession)} label="AI context" variant="ghost" />
                  <CopyButton value={toMarkdown(pseudoSession)} label="Markdown" variant="ghost" />
                  <Button size="sm" variant="ghost" onClick={openInSession}><FolderPlus /> Session</Button>
                </div>
              </div>

              {/* Service flow */}
              {hops.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                  {hops.map((h, i) => (
                    <div key={h.service} className="flex items-center gap-1">
                      <div className={cn("rounded-md border px-2 py-1 text-xs", HOP_STYLE[h.status])} title={`${h.count} event(s)`}>
                        {h.service}
                        {h.count > 1 && <span className="ml-1 opacity-70">×{h.count}</span>}
                      </div>
                      {i < hops.length - 1 && <ArrowRight className="size-3.5 text-muted-foreground" />}
                    </div>
                  ))}
                </div>
              )}

              {aiOut && (
                <div className="relative rounded-md border border-primary/30 bg-primary/5 p-3">
                  <CopyButton value={aiOut} className="absolute right-2 top-2" />
                  <pre className="whitespace-pre-wrap pr-16 text-sm">{aiOut}</pre>
                </div>
              )}

              {/* Timeline */}
              <div className="overflow-hidden rounded-md border border-border">
                {matches.map((e, i) => {
                  const label = DEBUG_SOURCES.find((s) => s.id === e.source)?.label ?? e.source;
                  const prev = i > 0 ? matches[i - 1].at : e.at;
                  const delta = e.at - prev;
                  return (
                    <div key={e.id} className={cn("flex items-center gap-2 px-3 py-2", i > 0 && "border-t border-border", e.status === "error" && "bg-destructive/5")}>
                      <span className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[e.status])} />
                      <span className="mono shrink-0 text-xs text-muted-foreground">{formatEventTime(e.at)}</span>
                      {i > 0 && delta > 0 && <span className="shrink-0 text-[10px] text-muted-foreground">+{delta}ms</span>}
                      <Badge variant="outline" className="shrink-0 text-[10px]">{label}</Badge>
                      {e.service && <span className="shrink-0 text-xs text-muted-foreground">{e.service}</span>}
                      <span className="truncate text-sm">{e.title}</span>
                      {e.durationMs != null && <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{e.durationMs} ms</span>}
                    </div>
                  );
                })}
              </div>
              {aiConfigured && <p className="text-[11px] text-muted-foreground">Diagnose sends this trace to {aiDestinationLabel()}.</p>}
            </>
          )
        )}

        {!id.trim() && (
          <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Enter an id to search across all captured Debug Session events. Tip: use the <b>Debug</b> button in API Tester and Database Toolkit to capture events first.
          </div>
        )}
      </div>
    </ToolShell>
  );
}
