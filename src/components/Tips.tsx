import { useState } from "react";
import { ChevronDown, ChevronRight, Lightbulb, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/CopyButton";
import { cn } from "@/lib/utils";
import { ALL_TIPS } from "@/lib/tipsData";
import { matchTips, resolveCommand, type Tip, type TipContext, type TipDomain } from "@/lib/tips";

/**
 * Troubleshooting tips for a failure.
 *
 * Matching tips are listed first with the strongest one expanded, because the fix is
 * rarely in the message the user just read. With no error, it is a browsable reference.
 */
export function Tips({
  error,
  domain,
  context,
  className,
  compact,
}: {
  error?: string;
  /** Restrict to one tool family. Omit to search every domain. */
  domain?: TipDomain;
  /** Real instance/host names, so commands come out ready to run. */
  context?: TipContext;
  className?: string;
  /** Hide the "show all" affordance — used where space is tight. */
  compact?: boolean;
}) {
  const pool = domain ? ALL_TIPS.filter((t) => t.domain === domain) : ALL_TIPS;
  const matched = error ? matchTips(ALL_TIPS, error, domain) : [];
  const matchedIds = new Set(matched.map((t) => t.id));
  const ordered = [...matched, ...pool.filter((t) => !matchedIds.has(t.id))];

  const [showAll, setShowAll] = useState(!error);
  const visible = showAll ? ordered : matched;

  if (compact && matched.length === 0) return null;

  return (
    <div className={cn("rounded-md border border-border", className)}>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Lightbulb className="size-3.5 text-warning" />
        <span className="text-xs font-medium">{domain ? `${DOMAIN_LABEL[domain]} tips` : "Troubleshooting tips"}</span>
        {matched.length > 0 && (
          <Badge variant="warning" className="text-[10px]">{matched.length} match this error</Badge>
        )}
        {!compact && (
          <button
            className="ml-auto text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? "Show matching only" : `Show all ${ordered.length}`}
          </button>
        )}
      </div>

      <div className="divide-y divide-border">
        {visible.length === 0 ? (
          <p className="px-3 py-2 text-[11px] text-muted-foreground">No tip matches this error yet.</p>
        ) : (
          visible.map((tip, i) => (
            <TipRow
              key={tip.id}
              tip={tip}
              context={context}
              highlighted={matchedIds.has(tip.id)}
              defaultOpen={i === 0 && matched.length > 0}
              showDomain={!domain}
            />
          ))
        )}
      </div>
    </div>
  );
}

const DOMAIN_LABEL: Record<TipDomain, string> = {
  mssql: "SQL Server",
  postgres: "PostgreSQL",
  mysql: "MySQL",
  sqlite: "SQLite",
  oracle: "Oracle",
  redis: "Redis",
  docker: "Docker",
  http: "HTTP",
  app: "App",
};

function TipRow({
  tip,
  context,
  highlighted,
  defaultOpen,
  showDomain,
}: {
  tip: Tip;
  context?: TipContext;
  highlighted: boolean;
  defaultOpen: boolean;
  showDomain: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const command = tip.command ? resolveCommand(tip.command, context) : null;

  return (
    <div className={cn(highlighted && "bg-warning/5")}>
      <button className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs" onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
        {showDomain && (
          <Badge variant="secondary" className="shrink-0 text-[10px]">{DOMAIN_LABEL[tip.domain]}</Badge>
        )}
        <span className="font-medium">{tip.title}</span>
        {highlighted && <Badge variant="warning" className="ml-auto shrink-0 text-[10px]">likely</Badge>}
      </button>

      {open && (
        <div className="flex flex-col gap-2 px-3 pb-3 pl-8 text-[11px]">
          <p className="text-muted-foreground">{tip.cause}</p>
          <ol className="list-decimal space-y-0.5 pl-4">
            {tip.steps.map((s) => <li key={s}>{s}</li>)}
          </ol>
          {tip.warning && (
            <p className="flex items-start gap-1.5 rounded border border-warning/40 bg-warning/10 p-1.5 text-warning">
              <TriangleAlert className="mt-0.5 size-3 shrink-0" /> {tip.warning}
            </p>
          )}
          {command && (
            <div className="flex flex-col gap-1">
              {!command.resolved && (
                <p className="text-warning">Replace the &lt;…&gt; placeholders before running.</p>
              )}
              <div className="relative">
                <pre className="overflow-x-auto rounded border border-border bg-muted/40 p-2 pr-16 font-mono text-[11px] leading-relaxed">
                  {command.text}
                </pre>
                <CopyButton value={command.text} label="Copy" className="absolute right-1.5 top-1.5 h-6 px-1.5 text-[10px]" />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
