import { useMemo, useState } from "react";
import { Search, Sparkles, TriangleAlert, ClipboardPaste, FolderPlus, Clock, List, BarChart3, Lightbulb } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/CopyButton";
import { Markdown } from "@/components/Markdown";
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
  serviceEdges,
  toMermaidFlow,
  traceSummary,
  parseLogEntries,
  buildAiContext,
  toMarkdown,
  formatEventTime,
  type DebugEvent,
  type DebugStatus,
  type ServiceHop,
} from "@/tools/lib/debugSession";
import {
  traceGaps,
  traceInsights,
  traceSpan,
  waterfall,
  type InsightSeverity,
} from "@/tools/lib/traceAnalysis";

const STATUS_DOT: Record<DebugStatus, string> = {
  ok: "bg-success",
  error: "bg-destructive",
  warn: "bg-warning",
  info: "bg-muted-foreground/50",
  pending: "bg-muted-foreground/30",
};
const NODE_STYLE: Record<DebugStatus, { rect: string; text: string }> = {
  ok: { rect: "fill-success/10 stroke-success", text: "fill-success" },
  error: { rect: "fill-destructive/10 stroke-destructive", text: "fill-destructive" },
  warn: { rect: "fill-warning/10 stroke-warning", text: "fill-warning" },
  info: { rect: "fill-secondary stroke-border", text: "fill-foreground" },
  pending: { rect: "fill-secondary stroke-border", text: "fill-muted-foreground" },
};

function ServiceFlowSvg({ hops }: { hops: ServiceHop[] }) {
  const GAP = 64, PAD = 8, NY = 18, NH = 38;
  let x = PAD;
  const nodes = hops.map((h) => {
    const w = Math.max(90, h.service.length * 7.2 + 30);
    const n = { ...h, x, w };
    x += w + GAP;
    return n;
  });
  const width = Math.max(x - GAP + PAD, 120);
  const edges = serviceEdges(hops);
  const midY = NY + NH / 2;

  return (
    <div className="overflow-x-auto">
      <svg width={width} height={NY + NH + 14} className="text-muted-foreground">
        <defs>
          <marker id="tf-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 Z" className="fill-muted-foreground" />
          </marker>
        </defs>
        {edges.map((e, i) => {
          const a = nodes[i], b = nodes[i + 1];
          const x1 = a.x + a.w, x2 = b.x;
          return (
            <g key={i}>
              <line x1={x1} y1={midY} x2={x2 - 2} y2={midY} className="stroke-muted-foreground" strokeWidth={1.5} markerEnd="url(#tf-arrow)" />
              <text x={(x1 + x2) / 2} y={midY - 5} textAnchor="middle" className="fill-muted-foreground text-[10px]">{e.ms}ms</text>
            </g>
          );
        })}
        {nodes.map((n) => {
          const st = NODE_STYLE[n.status];
          return (
            <g key={n.service}>
              <rect x={n.x} y={NY} width={n.w} height={NH} rx={6} className={cn(st.rect)} strokeWidth={1.5} />
              <text x={n.x + n.w / 2} y={NY + 17} textAnchor="middle" className={cn("text-[12px] font-medium", st.text)}>{n.service}</text>
              <text x={n.x + n.w / 2} y={NY + 30} textAnchor="middle" className="fill-muted-foreground text-[9px]">{n.count} event{n.count === 1 ? "" : "s"}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

const INSIGHT_STYLE: Record<InsightSeverity, string> = {
  bad: "border-destructive/40 bg-destructive/5",
  warn: "border-warning/40 bg-warning/5",
  info: "border-border bg-secondary/20",
};
const INSIGHT_ICON: Record<InsightSeverity, string> = {
  bad: "text-destructive",
  warn: "text-warning",
  info: "text-muted-foreground",
};

const BAR_STYLE: Record<DebugStatus, string> = {
  ok: "bg-success",
  error: "bg-destructive",
  warn: "bg-warning",
  info: "bg-primary/60",
  pending: "bg-muted-foreground/40",
};

/**
 * Events laid out proportionally across the span.
 *
 * The point of a waterfall over a list is that a gap is as visible as a step:
 * four seconds of nothing between two services is the thing worth seeing, and a
 * chronological list renders it as an unremarkable "+4000ms".
 */
function Waterfall({ events }: { events: DebugEvent[] }) {
  const rows = waterfall(events);
  const span = traceSpan(events).ms;
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-3 py-1 text-[10px] text-muted-foreground">
        <span>0 ms</span>
        <span>{span} ms</span>
      </div>
      {rows.map((r, i) => (
        <div
          key={r.event.id}
          className={cn(
            "flex items-center gap-2 px-3 py-1",
            i > 0 && "border-t border-border",
            r.event.status === "error" && "bg-destructive/5",
          )}
        >
          <span className="w-40 shrink-0 truncate text-xs" title={`${r.event.service ? `${r.event.service} — ` : ""}${r.event.title}`}>
            {r.event.service && <span className="text-muted-foreground">{r.event.service} </span>}
            {r.event.title}
          </span>
          <div className="relative h-4 min-w-0 flex-1 rounded bg-secondary/40">
            <div
              className={cn(
                "absolute top-0.5 h-3 rounded-sm",
                BAR_STYLE[r.event.status],
                // A point in time is drawn as a tick, not as a measured span.
                r.instant && "opacity-60",
              )}
              style={{ left: `${r.leftPct}%`, width: `${Math.min(r.widthPct, 100 - r.leftPct)}%` }}
              title={r.instant ? `at +${r.offsetMs} ms (no duration reported)` : `+${r.offsetMs} ms for ${r.durationMs} ms`}
            />
          </div>
          <span className="w-20 shrink-0 text-right text-[11px] text-muted-foreground">
            {r.instant ? `+${r.offsetMs} ms` : `${r.durationMs} ms`}
          </span>
        </div>
      ))}
    </div>
  );
}

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
  const insights = useMemo(() => traceInsights(matches), [matches]);
  const gaps = useMemo(() => traceGaps(matches).slice(0, 3), [matches]);
  const [view, setView] = useState<"waterfall" | "list">("waterfall");

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
                {/* Span, not last-start-minus-first-start: the final step's own duration counts. */}
                <span className="flex items-center gap-1 text-muted-foreground"><Clock className="size-3.5" /> {traceSpan(matches).ms} ms span</span>
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

              {/* What the numbers add up to */}
              {insights.length > 0 && (
                <div className="flex flex-col gap-2">
                  {insights.map((ins, i) => (
                    <div key={i} className={cn("flex gap-2 rounded-md border p-2", INSIGHT_STYLE[ins.severity])}>
                      <Lightbulb className={cn("mt-0.5 size-3.5 shrink-0", INSIGHT_ICON[ins.severity])} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{ins.headline}</p>
                        <p className="text-[11px] text-muted-foreground">{ins.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {gaps.length > 0 && (
                <div className="rounded-md border border-border p-2">
                  <div className="mb-1 text-xs font-medium text-muted-foreground">Largest unaccounted gaps</div>
                  <table className="w-full text-xs">
                    <tbody className="divide-y divide-border">
                      {gaps.map((g, i) => (
                        <tr key={i}>
                          <td className="py-1 pr-2 text-muted-foreground">{Math.round(g.pctOfSpan)}%</td>
                          <td className="py-1 pr-2 font-medium">{g.ms} ms</td>
                          <td className="truncate py-1 text-muted-foreground">
                            after &ldquo;{g.after.title}&rdquo; → before &ldquo;{g.before.title}&rdquo;
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Measured from when the previous step finished, so time a step reported as its own duration is not
                    counted twice. What is left is queue time, network time, or something not instrumented.
                  </p>
                </div>
              )}

              {/* Service flow diagram */}
              {hops.length > 0 && (
                <div className="rounded-md border border-border p-2">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">Service flow</span>
                    <CopyButton className="ml-auto" label="Mermaid" variant="ghost" value={toMermaidFlow(hops)} />
                  </div>
                  <ServiceFlowSvg hops={hops} />
                </div>
              )}

              {aiOut && (
                <div className="relative rounded-md border border-primary/30 bg-primary/5 p-3">
                  <CopyButton value={aiOut} className="absolute right-2 top-2" />
                  <Markdown content={aiOut} className="pr-16" />
                </div>
              )}

              {/* Timeline */}
              <div className="flex items-center gap-1">
                <span className="text-xs font-medium text-muted-foreground">Timeline</span>
                <div className="ml-auto flex gap-1">
                  <Button size="sm" variant={view === "waterfall" ? "secondary" : "ghost"} onClick={() => setView("waterfall")}>
                    <BarChart3 /> Waterfall
                  </Button>
                  <Button size="sm" variant={view === "list" ? "secondary" : "ghost"} onClick={() => setView("list")}>
                    <List /> List
                  </Button>
                </div>
              </div>
              <div className="overflow-hidden rounded-md border border-border">
                {view === "waterfall" ? <Waterfall events={matches} /> : matches.map((e, i) => {
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
