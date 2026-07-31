import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Trash2, Terminal, X, CircleAlert, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/CopyButton";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/useAppStore";
import { getTool } from "@/tools/registry";
import { Tips } from "@/components/Tips";
import { ALL_TIPS } from "@/lib/tipsData";
import { domainForSource, matchTips } from "@/lib/tips";
import {
  clearLogs,
  formatTime,
  getLogs,
  logsToText,
  subscribeLogs,
  type LogEntry,
  type LogLevel,
} from "@/lib/logBus";

const LEVEL_STYLE: Record<LogLevel, string> = {
  info: "text-muted-foreground",
  success: "text-success",
  warn: "text-warning",
  error: "text-destructive",
};

/** Live subscription to the log bus. */
function useLogEntries(): LogEntry[] {
  const [entries, setEntries] = useState<LogEntry[]>(getLogs);
  useEffect(() => subscribeLogs(setEntries), []);
  return entries;
}

/**
 * Application-wide activity log, docked at the bottom of every screen.
 *
 * Three states, persisted across sessions:
 *   `open`   — full console
 *   `bar`    — one-line status strip showing the latest entry (default)
 *   `hidden` — nothing; reopened from the header button or Ctrl+`
 *
 * Native failures used to vanish with their toast; here they stay, filterable and
 * copyable, whichever tool produced them.
 */
export function LogDock() {
  const state = useAppStore((s) => s.logDock);
  const setLogDock = useAppStore((s) => s.setLogDock);
  const entries = useLogEntries();

  const [filter, setFilter] = useState("");
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [thisToolOnly, setThisToolOnly] = useState(false);
  /** Error the tips panel is explaining; defaults to the most recent one. */
  const [tipsFor, setTipsFor] = useState<LogEntry | null>(null);
  const [showTips, setShowTips] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const view = useAppStore((s) => s.view);
  const toolId = view.kind === "tool" ? view.toolId : null;
  const toolName = toolId ? getTool(toolId)?.name ?? toolId : null;

  const errorCount = useMemo(() => entries.filter((e) => e.level === "error").length, [entries]);
  const latest = entries[entries.length - 1];
  const lastError = useMemo(() => [...entries].reverse().find((e) => e.level === "error"), [entries]);

  // Whichever error the user picked, else the newest one.
  const explained = tipsFor ?? lastError;
  const tipCount = useMemo(
    () => (explained ? matchTips(ALL_TIPS, explained.message, domainForSource(explained.source)).length : 0),
    [explained],
  );

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return entries.filter((e) => {
      if (problemsOnly && e.level !== "error" && e.level !== "warn") return false;
      if (thisToolOnly && toolId && e.tool !== toolId) return false;
      if (!needle) return true;
      return (
        e.message.toLowerCase().includes(needle) ||
        e.source.toLowerCase().includes(needle) ||
        (e.detail?.toLowerCase().includes(needle) ?? false)
      );
    });
  }, [entries, filter, problemsOnly, thisToolOnly, toolId]);

  useEffect(() => {
    if (state === "open") bottom.current?.scrollIntoView({ block: "end" });
  }, [shown.length, state]);

  if (state === "hidden") return null;

  // Collapsed: a single strip that shows the last thing that happened.
  if (state === "bar") {
    return (
      <div className="flex h-7 shrink-0 items-center gap-2 border-t border-border bg-background/80 px-3 text-[11px] backdrop-blur">
        <button
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
          onClick={() => setLogDock("open")}
          title="Open the activity log (Ctrl+`)"
        >
          <Terminal className="size-3.5" />
          <span>Activity log</span>
          <ChevronUp className="size-3" />
        </button>
        {errorCount > 0 && (
          <span className="flex items-center gap-1 text-destructive">
            <CircleAlert className="size-3" /> {errorCount}
          </span>
        )}
        {latest && (
          <button
            className="min-w-0 flex-1 truncate text-left text-muted-foreground hover:text-foreground"
            onClick={() => setLogDock("open")}
          >
            <span className={LEVEL_STYLE[latest.level]}>{latest.level}</span> · {latest.source} — {latest.message}
          </button>
        )}
        <button
          className="ml-auto text-muted-foreground hover:text-foreground"
          onClick={() => setLogDock("hidden")}
          title="Hide the activity log"
          aria-label="Hide the activity log"
        >
          <X className="size-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-64 shrink-0 flex-col border-t border-border bg-background">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-1.5">
        <button className="flex items-center gap-1.5 text-xs font-medium" onClick={() => setLogDock("bar")}>
          <Terminal className="size-3.5 text-muted-foreground" />
          Activity log
          <ChevronDown className="size-3.5" />
        </button>
        <Badge variant="outline" className="text-[10px]">{shown.length}/{entries.length}</Badge>
        {errorCount > 0 && (
          <Badge variant="destructive" className="text-[10px]">{errorCount} error{errorCount === 1 ? "" : "s"}</Badge>
        )}

        <Input
          className="h-7 w-48 text-xs"
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
          <input type="checkbox" checked={problemsOnly} onChange={(e) => setProblemsOnly(e.target.checked)} />
          Problems only
        </label>
        {toolName && (
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
            <input type="checkbox" checked={thisToolOnly} onChange={(e) => setThisToolOnly(e.target.checked)} />
            {toolName} only
          </label>
        )}

        {tipCount > 0 && (
          <button
            className={cn(
              "flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px]",
              showTips ? "border-warning bg-warning/10 text-warning" : "border-border text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setShowTips((v) => !v)}
            title="Troubleshooting tips for the selected error"
          >
            <Lightbulb className="size-3" />
            {tipCount} fix{tipCount === 1 ? "" : "es"}
          </button>
        )}

        <div className="ml-auto flex items-center gap-1">
          <CopyButton value={logsToText(shown)} label="Copy" className="h-7 px-2 text-xs" />
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={clearLogs} title="Clear the log" aria-label="Clear the log">
            <Trash2 className="size-3.5" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setLogDock("hidden")} title="Hide the activity log" aria-label="Hide the activity log">
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      {showTips && explained && (
        <div className="max-h-48 shrink-0 overflow-auto border-b border-border p-2">
          <p className="mb-1 px-1 text-[11px] text-muted-foreground">
            Explaining: <span className="font-mono">{explained.source}</span> — {explained.message.split("\n")[0]}
          </p>
          <Tips error={explained.message} domain={domainForSource(explained.source)} compact />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto bg-muted/20 px-3 py-1 font-mono text-[11px] leading-relaxed">
        {shown.length === 0 ? (
          <p className="py-2 text-muted-foreground">
            {entries.length === 0 ? "Nothing logged yet — actions appear here as they run." : "No entries match the filter."}
          </p>
        ) : (
          shown.map((e) => (
            <div
              key={e.id}
              className={cn(
                "flex items-start gap-2 border-b border-border/40 py-0.5 last:border-0",
                e.level === "error" && "cursor-pointer hover:bg-warning/10",
                explained?.id === e.id && showTips && "bg-warning/10",
              )}
              // Any past error can be explained, not only the newest.
              onClick={e.level === "error" ? () => { setTipsFor(e); setShowTips(true); } : undefined}
              title={e.level === "error" ? "Show troubleshooting tips for this error" : undefined}
            >
              <span className="shrink-0 text-muted-foreground">{formatTime(e.ts)}</span>
              <span className={cn("w-14 shrink-0 uppercase", LEVEL_STYLE[e.level])}>{e.level}</span>
              <span className="w-44 shrink-0 truncate text-muted-foreground" title={e.source}>{e.source}</span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                {e.message}
                {e.elapsedMs !== undefined && <span className="text-muted-foreground"> ({e.elapsedMs} ms)</span>}
                {e.detail && <span className="block text-muted-foreground">{e.detail}</span>}
              </span>
            </div>
          ))
        )}
        <div ref={bottom} />
      </div>
    </div>
  );
}
