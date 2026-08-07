import { useMemo, useState } from "react";
import {
  Plus,
  Trash2,
  Download,
  ClipboardPaste,
  Sparkles,
  Filter,
  X,
  Bug,
  ChevronRight,
  ChevronDown,
  Lightbulb,
  Layers,
  Link2,
  Copy,
} from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  filterEvents,
  correlationIds,
  parseLogEntries,
  toMarkdown,
  buildAiContext,
  formatEventTime,
  type DebugSource,
  type DebugStatus,
  type DebugEvent,
} from "@/tools/lib/debugSession";
import { traceInsights, type InsightSeverity } from "@/tools/lib/traceAnalysis";
import {
  attachToGroup,
  dedupeEvents,
  groupLabel,
  groupTraces,
  sessionOverview,
  suggestAttachments,
  type TraceGroup,
} from "@/tools/lib/sessionAnalysis";

const STATUS_STYLE: Record<DebugStatus, string> = {
  ok: "bg-success",
  error: "bg-destructive",
  warn: "bg-warning",
  info: "bg-muted-foreground/50",
  pending: "bg-muted-foreground/30",
};

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

export function DebugSession() {
  const sessions = useDebugStore((s) => s.sessions);
  const activeId = useDebugStore((s) => s.activeId);
  const createSession = useDebugStore((s) => s.createSession);
  const renameSession = useDebugStore((s) => s.renameSession);
  const deleteSession = useDebugStore((s) => s.deleteSession);
  const setActive = useDebugStore((s) => s.setActive);
  const importEvents = useDebugStore((s) => s.importEvents);
  const removeEvent = useDebugStore((s) => s.removeEvent);
  const updateEvent = useDebugStore((s) => s.updateEvent);
  const setEvents = useDebugStore((s) => s.setEvents);
  const clearEvents = useDebugStore((s) => s.clearEvents);

  const active = sessions.find((s) => s.id === activeId) ?? null;

  const [showImport, setShowImport] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // filters
  const [sourceFilter, setSourceFilter] = useState<DebugSource[]>([]);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [corrFilter, setCorrFilter] = useState("");

  const [aiOut, setAiOut] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const aiConfigured = useAiStore((s) => s.isConfigured());

  const timeline = useMemo(() => {
    if (!active) return [];
    return sortEvents(filterEvents(active.events, {
      sources: sourceFilter,
      errorsOnly,
      query,
      correlationId: corrFilter || undefined,
    }));
  }, [active, sourceFilter, errorsOnly, query, corrFilter]);

  const corrs = active ? correlationIds(active.events) : [];

  // A session accumulates captures from several different flows; grouping turns
  // the single list back into the flows it is made of.
  const groups = useMemo(() => (active ? groupTraces(active.events) : []), [active]);
  const overview = useMemo(() => sessionOverview(active?.events ?? []), [active]);
  const attachments = useMemo(() => (active ? suggestAttachments(active.events) : []), [active]);
  const duplicates = useMemo(() => (active ? dedupeEvents(active.events).removed : []), [active]);
  // Insights describe what is on screen, so they follow the filters.
  const insights = useMemo(() => traceInsights(timeline), [timeline]);
  const [showFlows, setShowFlows] = useState(true);

  /** Filter the timeline down to one flow, whichever id it is keyed by. */
  const focusGroup = (g: TraceGroup) => {
    setCorrFilter(g.kind === "correlation" ? g.key : "");
    setQuery(g.kind === "correlation" ? "" : g.key);
    setErrorsOnly(false);
    setSourceFilter([]);
  };

  const removeDuplicates = () => {
    if (!active || duplicates.length === 0) return;
    setEvents(active.id, dedupeEvents(active.events).kept);
    toast.success(`Removed ${duplicates.length} duplicate event${duplicates.length === 1 ? "" : "s"}`);
  };

  const attachAll = () => {
    if (!active) return;
    for (const a of attachments) {
      const { correlationId, traceId } = attachToGroup(a.event, a.group);
      updateEvent(active.id, a.event.id, { correlationId, traceId });
    }
    toast.success(`Attached ${attachments.length} capture(s) to the flow they fall inside`);
  };

  const toggleExpand = (id: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const toggleSource = (src: DebugSource) =>
    setSourceFilter((cur) => (cur.includes(src) ? cur.filter((s) => s !== src) : [...cur, src]));

  async function diagnose() {
    if (!active) return;
    setAiBusy(true);
    setAiOut("");
    try {
      const context = buildAiContext(active);
      const out = await aiChat([
        {
          role: "system",
          content:
            "You are a senior distributed-systems engineer. Given a chronological debug timeline, identify the most likely failure point and root cause. Respond with sections: Root Cause, Evidence, Likely Failure Point, Confidence (low/medium/high), Recommended Actions. Clearly separate fact from inference. Be concise.",
        },
        { role: "user", content: context },
      ]);
      setAiOut(out);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <ToolShell
      toolId="debug-session"
      title="Debug Session"
      description="Reconstruct a distributed flow on one timeline — aggregate API calls, logs, exceptions, DB queries and messages by correlation / trace id, then diagnose."
      actions={
        <Button size="sm" variant="outline" onClick={() => createSession()}>
          <Plus /> New session
        </Button>
      }
    >
      <div className="grid grid-cols-[220px_1fr] gap-4">
        {/* Sessions rail */}
        <div className="flex flex-col gap-1">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sessions</div>
          {sessions.length === 0 && <p className="text-sm text-muted-foreground">No sessions yet.</p>}
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => setActive(s.id)}
              className={cn(
                "group flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm transition-colors",
                s.id === activeId ? "border-primary/50 bg-primary/10" : "border-border hover:bg-secondary",
              )}
            >
              <Bug className="size-3.5 shrink-0 text-orange-500" />
              <span className="truncate">{s.name}</span>
              <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{s.events.length}</span>
              <span
                role="button"
                title="Delete session"
                onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
              >
                <Trash2 className="size-3.5 text-destructive" />
              </span>
            </button>
          ))}
        </div>

        {/* Main */}
        <div className="min-w-0">
          {!active ? (
            <div className="grid h-64 place-items-center text-center text-sm text-muted-foreground">
              <div>
                Create a session, then <b>Import logs</b> or <b>Add event</b> to build the timeline.
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {/* Session header */}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={active.name}
                  onChange={(e) => renameSession(active.id, e.target.value)}
                  className="rounded-md border border-transparent bg-transparent px-1 text-sm font-semibold hover:border-border focus:border-border focus:outline-none"
                />
                <Badge variant="secondary">{active.events.length} events</Badge>
                {overview.correlatedFlows > 0 && (
                  <Badge variant="outline" className="gap-1">
                    <Layers className="size-3" /> {overview.correlatedFlows} flow{overview.correlatedFlows === 1 ? "" : "s"}
                  </Badge>
                )}
                {overview.failedFlows > 0 && (
                  <Badge variant="destructive">{overview.failedFlows} failed</Badge>
                )}
                <div className="ml-auto flex flex-wrap gap-1">
                  <Button size="sm" variant="outline" onClick={() => setShowImport((v) => !v)}><ClipboardPaste /> Import logs</Button>
                  <Button size="sm" variant="outline" onClick={() => setShowAdd((v) => !v)}><Plus /> Add event</Button>
                  <CopyButton value={toMarkdown(active)} label="Markdown" />
                  <CopyButton value={JSON.stringify(active, null, 2)} label="JSON" />
                  <Button size="sm" variant="ghost" onClick={() => downloadText(`${active.name}.md`, toMarkdown(active))}><Download /></Button>
                  <Button size="sm" variant="ghost" onClick={() => { if (confirm("Clear all events in this session?")) clearEvents(active.id); }}><Trash2 /></Button>
                </div>
              </div>

              {showImport && (
                <ImportPanel
                  onImport={(text) => {
                    const parsed = parseLogEntries(text);
                    if (parsed.length === 0) { toast.error("No events parsed"); return; }
                    const n = importEvents(active.id, parsed);
                    toast.success(`Imported ${n} event${n === 1 ? "" : "s"}`);
                    setShowImport(false);
                  }}
                  onCancel={() => setShowImport(false)}
                />
              )}

              {showAdd && (
                <AddEventPanel
                  onAdd={(ev) => { importEvents(active.id, [ev]); setShowAdd(false); }}
                  onCancel={() => setShowAdd(false)}
                />
              )}

              {/* Housekeeping the session can do for itself */}
              {(duplicates.length > 0 || attachments.length > 0) && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-secondary/20 p-2 text-xs">
                  {duplicates.length > 0 && (
                    <>
                      <Copy className="size-3.5 text-muted-foreground" />
                      <span>
                        {duplicates.length} event{duplicates.length === 1 ? " is" : "s are"} indistinguishable from
                        {duplicates.length === 1 ? " another" : " others"} — usually the same log imported twice.
                      </span>
                      <Button size="sm" variant="outline" className="h-7" onClick={removeDuplicates}>Remove duplicates</Button>
                    </>
                  )}
                  {attachments.length > 0 && (
                    <>
                      <Link2 className="size-3.5 text-muted-foreground" />
                      <span>
                        {attachments.length} capture{attachments.length === 1 ? "" : "s"} without a correlation id fall
                        inside exactly one flow's window.
                      </span>
                      <Button size="sm" variant="outline" className="h-7" onClick={attachAll}>Attach to that flow</Button>
                    </>
                  )}
                </div>
              )}

              {/* Flows in this session */}
              {groups.length > 1 && (
                <div className="rounded-md border border-border">
                  <button
                    onClick={() => setShowFlows((v) => !v)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-secondary/40"
                  >
                    {showFlows ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                    Flows in this session ({groups.length})
                  </button>
                  {showFlows && (
                    <table className="w-full text-xs">
                      <thead className="border-t border-border text-left text-muted-foreground">
                        <tr>
                          <th className="px-3 py-1 font-medium">Flow</th>
                          <th className="px-3 py-1 font-medium">Events</th>
                          <th className="px-3 py-1 font-medium">Span</th>
                          <th className="px-3 py-1 font-medium">Services</th>
                          <th className="px-3 py-1 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {groups.map((g) => (
                          <tr
                            key={g.key}
                            onClick={() => focusGroup(g)}
                            className={cn("cursor-pointer hover:bg-secondary/40", g.errors > 0 && "bg-destructive/5")}
                            title="Filter the timeline to this flow"
                          >
                            <td className="mono max-w-[240px] truncate px-3 py-1">{groupLabel(g)}</td>
                            <td className="px-3 py-1">{g.events.length}</td>
                            <td className="px-3 py-1 text-muted-foreground">{g.spanMs} ms</td>
                            <td className="max-w-[220px] truncate px-3 py-1 text-muted-foreground">
                              {g.services.join(" → ") || "—"}
                            </td>
                            <td className="px-3 py-1">
                              <span className={cn("mr-1 inline-block size-2 rounded-full align-middle", STATUS_STYLE[g.status])} />
                              {g.errors > 0 ? `${g.errors} error${g.errors === 1 ? "" : "s"}` : g.status}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* Filters */}
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2">
                <Filter className="size-3.5 text-muted-foreground" />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search events…" className="h-8 max-w-xs" />
                <button
                  onClick={() => setErrorsOnly((v) => !v)}
                  className={cn("rounded-md px-2 py-1 text-xs", errorsOnly ? "bg-destructive/15 text-destructive" : "text-muted-foreground hover:bg-secondary")}
                >
                  Errors only
                </button>
                {corrs.length > 0 && (
                  <select value={corrFilter} onChange={(e) => setCorrFilter(e.target.value)} className="h-8 rounded-md border border-input bg-transparent px-2 text-xs">
                    <option value="">All correlation ids</option>
                    {corrs.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                )}
                <div className="flex flex-wrap gap-1">
                  {DEBUG_SOURCES.filter((s) => active.events.some((e) => e.source === s.id)).map((s) => (
                    <button
                      key={s.id}
                      onClick={() => toggleSource(s.id)}
                      className={cn("rounded-full px-2 py-0.5 text-[11px]", sourceFilter.includes(s.id) ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground")}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                {(query || errorsOnly || corrFilter || sourceFilter.length > 0) && (
                  <button onClick={() => { setQuery(""); setErrorsOnly(false); setCorrFilter(""); setSourceFilter([]); }} className="ml-auto text-xs text-muted-foreground hover:text-foreground">
                    <X className="mr-1 inline size-3" />Clear
                  </button>
                )}
              </div>

              {/* AI diagnose */}
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={diagnose} disabled={aiBusy || !aiConfigured || active.events.length === 0}>
                  <Sparkles /> {aiBusy ? "Diagnosing…" : "Diagnose with AI"}
                </Button>
                <CopyButton value={buildAiContext(active)} label="Copy AI context" variant="ghost" />
                {!aiConfigured && <span className="text-xs text-muted-foreground">Configure AI in Settings to diagnose.</span>}
                {aiConfigured && <span className="text-[11px] text-muted-foreground">Sends timeline to {aiDestinationLabel()}.</span>}
              </div>

              {aiOut && (
                <div className="relative rounded-md border border-primary/30 bg-primary/5 p-3">
                  <CopyButton value={aiOut} className="absolute right-2 top-2" />
                  <Markdown content={aiOut} className="pr-16" />
                </div>
              )}

              {/* What the timeline on screen adds up to */}
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

              {/* Timeline */}
              <div className="text-xs text-muted-foreground">{timeline.length} of {active.events.length} events</div>
              {timeline.length === 0 ? (
                <p className="text-sm text-muted-foreground">No events match the filters.</p>
              ) : (
                <div className="overflow-hidden rounded-md border border-border">
                  {timeline.map((e, i) => (
                    <TimelineRow
                      key={e.id}
                      event={e}
                      first={i === 0}
                      expanded={expanded.has(e.id)}
                      onToggle={() => toggleExpand(e.id)}
                      onRemove={() => removeEvent(active.id, e.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </ToolShell>
  );
}

function TimelineRow({ event, first, expanded, onToggle, onRemove }: { event: DebugEvent; first: boolean; expanded: boolean; onToggle: () => void; onRemove: () => void }) {
  const label = DEBUG_SOURCES.find((s) => s.id === event.source)?.label ?? event.source;
  return (
    <div className={cn(!first && "border-t border-border", event.status === "error" && "bg-destructive/5")}>
      <div className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-secondary/40" onClick={onToggle}>
        <span className={cn("size-2 shrink-0 rounded-full", STATUS_STYLE[event.status])} />
        <span className="mono shrink-0 text-xs text-muted-foreground">{formatEventTime(event.at)}</span>
        <Badge variant="outline" className="shrink-0 text-[10px]">{label}</Badge>
        {event.service && <span className="shrink-0 text-xs text-muted-foreground">{event.service}</span>}
        <span className="truncate text-sm">{event.title}</span>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {event.durationMs != null && <span className="text-[11px] text-muted-foreground">{event.durationMs} ms</span>}
          {event.correlationId && <span className="rounded bg-secondary px-1.5 text-[10px] text-muted-foreground">{event.correlationId}</span>}
          {expanded ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}
        </div>
      </div>
      {expanded && (
        <div className="space-y-2 border-t border-border bg-secondary/20 px-3 py-2 text-xs">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
            <Meta k="Source" v={label} />
            <Meta k="Status" v={event.status} />
            {event.service && <Meta k="Service" v={event.service} />}
            {event.traceId && <Meta k="Trace id" v={event.traceId} />}
            {event.correlationId && <Meta k="Correlation id" v={event.correlationId} />}
            {event.durationMs != null && <Meta k="Duration" v={`${event.durationMs} ms`} />}
          </div>
          {event.error && <pre className="whitespace-pre-wrap rounded bg-destructive/10 p-2 text-destructive">{event.error}</pre>}
          {event.payload && <pre className="mono max-h-52 overflow-auto whitespace-pre-wrap rounded bg-background p-2">{prettyMaybe(event.payload)}</pre>}
          <button onClick={onRemove} className="text-[11px] text-destructive hover:underline">Remove event</button>
        </div>
      )}
    </div>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <span className="text-muted-foreground">{k}: </span>
      <span className="break-all">{v}</span>
    </div>
  );
}

function ImportPanel({ onImport, onCancel }: { onImport: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState("");
  return (
    <div className="rounded-md border border-border p-3">
      <div className="mb-1 text-sm font-medium">Import logs</div>
      <p className="mb-2 text-xs text-muted-foreground">Paste a JSON array, NDJSON (one JSON object per line), or plain log lines. Common fields (timestamp, level, message, service, traceId, correlationId, duration) are auto-detected.</p>
      <Textarea mono value={text} onChange={(e) => setText(e.target.value)} className="min-h-40" placeholder='{"@t":"2024-01-01T00:00:01Z","@l":"Error","@m":"DB timeout","SourceContext":"OrderSvc","CorrelationId":"c-1"}' />
      <div className="mt-2 flex gap-2">
        <Button size="sm" onClick={() => onImport(text)} disabled={!text.trim()}>Parse &amp; add</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function AddEventPanel({ onAdd, onCancel }: { onAdd: (e: import("@/tools/lib/debugSession").ParsedEvent) => void; onCancel: () => void }) {
  const [source, setSource] = useState<DebugSource>("api");
  const [status, setStatus] = useState<DebugStatus>("ok");
  const [title, setTitle] = useState("");
  const [service, setService] = useState("");
  const [correlationId, setCorrelationId] = useState("");
  const [durationMs, setDurationMs] = useState("");
  const [payload, setPayload] = useState("");

  return (
    <div className="rounded-md border border-border p-3">
      <div className="mb-2 text-sm font-medium">Add event</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <select value={source} onChange={(e) => setSource(e.target.value as DebugSource)} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm">
          {DEBUG_SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as DebugStatus)} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm">
          {(["ok", "error", "warn", "info", "pending"] as DebugStatus[]).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <Input value={service} onChange={(e) => setService(e.target.value)} placeholder="Service" />
        <Input value={durationMs} onChange={(e) => setDurationMs(e.target.value)} placeholder="Duration ms" type="number" />
      </div>
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (e.g. POST /orders 500)" className="mt-2" />
      <Input value={correlationId} onChange={(e) => setCorrelationId(e.target.value)} placeholder="Correlation id" className="mt-2" />
      <Textarea mono value={payload} onChange={(e) => setPayload(e.target.value)} placeholder="Payload / error (optional)" className="mt-2 min-h-20" />
      <div className="mt-2 flex gap-2">
        <Button
          size="sm"
          disabled={!title.trim()}
          onClick={() =>
            onAdd({
              source,
              status,
              title: title.trim(),
              service: service || undefined,
              correlationId: correlationId || undefined,
              durationMs: durationMs ? Number(durationMs) : undefined,
              payload: payload || undefined,
              error: status === "error" ? payload || undefined : undefined,
            })
          }
        >
          Add
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function prettyMaybe(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

function downloadText(name: string, content: string) {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
