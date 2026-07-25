import { useMemo, useState } from "react";
import { CalendarClock, CheckCircle2, XCircle } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/CopyButton";
import { cn } from "@/lib/utils";
import { parseCron, describeCron, nextRuns } from "@/tools/lib/cron";

const PRESETS: { label: string; expr: string }[] = [
  { label: "Every minute", expr: "* * * * *" },
  { label: "Every 15 min", expr: "*/15 * * * *" },
  { label: "Hourly", expr: "0 * * * *" },
  { label: "Daily midnight", expr: "0 0 * * *" },
  { label: "Weekdays 9am", expr: "0 9 * * 1-5" },
  { label: "Mondays 8:30", expr: "30 8 * * MON" },
  { label: "1st of month", expr: "0 0 1 * *" },
  { label: "Every 30s", expr: "*/30 * * * * *" },
];

function relative(from: Date, to: Date): string {
  const s = Math.round((to.getTime() - from.getTime()) / 1000);
  if (s < 60) return `in ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `in ${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `in ${h}h`;
  return `in ${Math.round(h / 24)}d`;
}

export function CronTool() {
  const [expr, setExpr] = useState("0 9 * * 1-5");
  const now = useMemo(() => new Date(), []);

  const parsed = useMemo(() => {
    try {
      const cron = parseCron(expr);
      return { ok: true as const, cron, runs: nextRuns(cron, new Date(), 8), desc: describeCron(cron) };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  }, [expr]);

  return (
    <ToolShell toolId="cron" title="Cron Expression" description="Parse and validate a cron expression, read it in plain English, and preview the next run times. Supports 5- and 6-field (seconds) crons.">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <div className="flex items-center gap-2">
          <Input value={expr} onChange={(e) => setExpr(e.target.value)} className="mono text-base" placeholder="* * * * *" />
          <CopyButton value={expr} />
        </div>

        <div className="flex flex-wrap gap-1">
          {PRESETS.map((p) => (
            <button key={p.expr} onClick={() => setExpr(p.expr)} className={cn("rounded-full px-2.5 py-1 text-xs", expr === p.expr ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground hover:text-foreground")} title={p.expr}>
              {p.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-5 gap-1 text-center text-[10px] text-muted-foreground">
          {(parsed.ok && parsed.cron.hasSeconds ? ["second", "minute", "hour", "day (month)", "month", "day (week)"] : ["minute", "hour", "day (month)", "month", "day (week)"]).map((f) => (
            <div key={f} className="rounded bg-secondary/50 py-1">{f}</div>
          ))}
        </div>

        {parsed.ok ? (
          <>
            <div className="flex items-center gap-2 rounded-md border border-success/40 bg-success/10 p-3 text-sm">
              <CheckCircle2 className="size-4 text-success" />
              <span>{parsed.desc}</span>
            </div>

            <div>
              <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <CalendarClock className="size-3.5" /> Next runs
                <CopyButton className="ml-auto" variant="ghost" label="Copy" value={parsed.runs.map((r) => r.toISOString()).join("\n")} />
              </div>
              <div className="overflow-hidden rounded-md border border-border">
                {parsed.runs.length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground">No runs found in the search window.</p>
                ) : parsed.runs.map((r, i) => (
                  <div key={i} className={cn("flex items-center gap-3 px-3 py-1.5 text-sm", i > 0 && "border-t border-border")}>
                    <Badge variant="outline" className="text-[10px]">{i + 1}</Badge>
                    <span className="mono">{r.toLocaleString()}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{relative(now, r)}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <XCircle className="size-4" /> {parsed.error}
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">
          Fields: <span className="mono">minute hour day-of-month month day-of-week</span> (prepend a seconds field for 6-field crons).
          Supports <span className="mono">*</span>, ranges <span className="mono">a-b</span>, steps <span className="mono">*/n</span>, lists <span className="mono">a,b</span>, and month/day names.
          Times are shown in your local timezone.
        </p>
      </div>
    </ToolShell>
  );
}
