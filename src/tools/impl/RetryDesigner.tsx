import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Code2, Info, ListChecks, Timer, Zap } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/CopyButton";
import { cn } from "@/lib/utils";
import {
  breakerFindings,
  DEFAULT_BREAKER,
  DEFAULT_POLICY,
  herdImpact,
  humanMs,
  IDEMPOTENCY_CHECKS,
  policyFindings,
  POISON_PLAYBOOK,
  seededRandom,
  simulate,
  STATUS_ADVICE,
  toPolly,
  toResiliencePipeline,
  type BackoffStrategy,
  type BreakerPolicy,
  type JitterMode,
  type ResilienceFinding,
  type RetryPolicy,
} from "@/tools/lib/resilience";

type Tab = "policy" | "idempotency" | "queue" | "code";

const JITTERS: { id: JitterMode; label: string; note: string }[] = [
  { id: "none", label: "none", note: "Every client retries at the same moment." },
  { id: "full", label: "full", note: "Anywhere in [0, delay]. Maximum spread — the usual right answer." },
  { id: "equal", label: "equal", note: "Half fixed, half random. Keeps some of the backoff's shape." },
  { id: "decorrelated", label: "decorrelated", note: "Grows from the previous actual delay. Converges fastest on short outages." },
];

export function RetryDesigner() {
  const [tab, setTab] = useState<Tab>("policy");
  const [policy, setPolicy] = useState<RetryPolicy>(DEFAULT_POLICY);
  const [breaker, setBreaker] = useState<BreakerPolicy>(DEFAULT_BREAKER);
  const [callerTimeout, setCallerTimeout] = useState(30_000);
  const [clients, setClients] = useState(500);
  const [rps, setRps] = useState(10);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const run = useMemo(() => simulate(policy, seededRandom(42)), [policy]);
  const findings = useMemo(() => policyFindings(policy, run, callerTimeout || undefined), [policy, run, callerTimeout]);
  const breakerIssues = useMemo(() => breakerFindings(breaker, rps), [breaker, rps]);
  const herd = useMemo(() => herdImpact(policy, clients), [policy, clients]);

  const set = (patch: Partial<RetryPolicy>) => setPolicy({ ...policy, ...patch });
  const setBreak = (patch: Partial<BreakerPolicy>) => setBreaker({ ...breaker, ...patch });

  return (
    <ToolShell
      toolId="retry-designer"
      title="Retry & Resilience Designer"
      description="Work out what a retry policy actually costs, then emit it as configuration."
    >
      <div className="mb-3 flex flex-wrap gap-1 border-b border-border">
        {([
          { id: "policy" as Tab, label: "Policy", icon: Timer },
          { id: "idempotency" as Tab, label: "Is it safe to retry?", icon: ListChecks },
          { id: "queue" as Tab, label: "Poison messages", icon: Zap },
          { id: "code" as Tab, label: "Code", icon: Code2 },
        ]).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-sm",
              tab === t.id ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <t.icon className="size-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "policy" && (
        <>
          <div className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
            <F label="Attempts (including the first)">
              <Input type="number" min={1} max={20} className="h-8 w-24" value={policy.attempts} onChange={(e) => set({ attempts: Number(e.target.value) || 1 })} />
            </F>
            <F label="Backoff">
              <select className="h-8 rounded-md border border-border bg-background px-2 text-sm" value={policy.strategy} onChange={(e) => set({ strategy: e.target.value as BackoffStrategy })}>
                <option value="fixed">fixed</option>
                <option value="linear">linear</option>
                <option value="exponential">exponential</option>
              </select>
            </F>
            <F label="Base delay (ms)">
              <Input type="number" className="h-8 w-28" value={policy.baseMs} onChange={(e) => set({ baseMs: Number(e.target.value) || 0 })} />
            </F>
            <F label="Max delay (ms)">
              <Input type="number" className="h-8 w-28" value={policy.maxDelayMs} onChange={(e) => set({ maxDelayMs: Number(e.target.value) || 0 })} />
            </F>
            <F label="Jitter">
              <select className="h-8 rounded-md border border-border bg-background px-2 text-sm" value={policy.jitter} onChange={(e) => set({ jitter: e.target.value as JitterMode })}>
                {JITTERS.map((j) => (
                  <option key={j.id} value={j.id}>{j.label}</option>
                ))}
              </select>
            </F>
            <F label="Per-attempt timeout (ms)">
              <Input type="number" className="h-8 w-32" value={policy.timeoutMs} onChange={(e) => set({ timeoutMs: Number(e.target.value) || 0 })} />
            </F>
            <F label="Overall budget (ms, 0 = none)">
              <Input type="number" className="h-8 w-36" value={policy.overallBudgetMs ?? 0} onChange={(e) => set({ overallBudgetMs: Number(e.target.value) || undefined })} />
            </F>
            <F label="Caller gives up at (ms)">
              <Input type="number" className="h-8 w-32" value={callerTimeout} onChange={(e) => setCallerTimeout(Number(e.target.value) || 0)} />
            </F>
            <p className="w-full text-[11px] text-muted-foreground">{JITTERS.find((j) => j.id === policy.jitter)?.note}</p>
          </div>

          <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            <Tile label="Worst case" value={humanMs(run.worstCaseMs)} tone={callerTimeout && run.worstCaseMs > callerTimeout ? "bad" : "ok"} />
            <Tile label="Delays only" value={humanMs(run.delayOnlyMs)} />
            <Tile label="Attempts that run" value={String(run.attempts.length)} />
            <Tile label="Peak on recovery" value={`${herd.peakPerSecond.toLocaleString()}/s`} tone={policy.jitter === "none" ? "bad" : "ok"} />
          </div>

          <div className="mb-3 rounded-md border border-border">
            <table className="w-full text-xs">
              <thead className="border-b border-border text-left text-muted-foreground">
                <tr>
                  {["Attempt", "Waits", "Starts at", "Gives up at"].map((c) => (
                    <th key={c} className="px-3 py-1 font-medium">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {run.attempts.map((attempt) => (
                  <tr key={attempt.attempt} className="hover:bg-secondary/40">
                    <td className="px-3 py-1">{attempt.attempt}</td>
                    <td className="px-3 py-1 text-muted-foreground">{attempt.delayMs ? humanMs(attempt.delayMs) : "—"}</td>
                    <td className="px-3 py-1">{humanMs(attempt.startsAtMs)}</td>
                    <td className="px-3 py-1">
                      {humanMs(attempt.endsAtMs)}
                      {attempt.cutByBudget && <Badge variant="warning" className="ml-2 text-[9px]">cut by budget</Badge>}
                    </td>
                  </tr>
                ))}
                {run.droppedByBudget > 0 && (
                  <tr className="bg-secondary/30">
                    <td colSpan={4} className="px-3 py-1 text-muted-foreground">
                      {run.droppedByBudget} further attempt(s) never happen — the budget runs out first.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <p className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
              Assumes every attempt fails at its timeout. A fast failure costs almost nothing; a policy is sized by how
              bad it gets when nothing works. Jitter is seeded, so this schedule is one real roll of the dice, not an
              average.
            </p>
          </div>

          {findings.length > 0 && (
            <div className="mb-3 flex flex-col gap-1 rounded-md border border-warning/40 bg-warning/5 p-2">
              {findings.map((finding, i) => (
                <FindingRow key={i} finding={finding} />
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-end gap-2">
                <F label="Clients retrying together">
                  <Input type="number" className="h-8 w-28" value={clients} onChange={(e) => setClients(Number(e.target.value) || 0)} />
                </F>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">{herd.message}</p>
            </div>

            <div className="rounded-md border border-border p-3">
              <p className="text-xs font-medium">Circuit breaker</p>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <F label="Failure ratio">
                  <Input type="number" step="0.05" min={0} max={1} className="h-8 w-20" value={breaker.failureRatio} onChange={(e) => setBreak({ failureRatio: Number(e.target.value) })} />
                </F>
                <F label="Min throughput">
                  <Input type="number" className="h-8 w-24" value={breaker.minimumThroughput} onChange={(e) => setBreak({ minimumThroughput: Number(e.target.value) || 0 })} />
                </F>
                <F label="Sampling (ms)">
                  <Input type="number" className="h-8 w-28" value={breaker.samplingDurationMs} onChange={(e) => setBreak({ samplingDurationMs: Number(e.target.value) || 0 })} />
                </F>
                <F label="Break (ms)">
                  <Input type="number" className="h-8 w-28" value={breaker.breakDurationMs} onChange={(e) => setBreak({ breakDurationMs: Number(e.target.value) || 0 })} />
                </F>
                <F label="Endpoint traffic (req/s)">
                  <Input type="number" className="h-8 w-28" value={rps} onChange={(e) => setRps(Number(e.target.value) || 0)} />
                </F>
              </div>
              <div className="mt-2 flex flex-col gap-1">
                {breakerIssues.length === 0 ? (
                  <p className="text-[11px] text-success">These numbers work together at this traffic level.</p>
                ) : (
                  breakerIssues.map((finding, i) => <FindingRow key={i} finding={finding} />)
                )}
              </div>
            </div>
          </div>

          <div className="mt-3 rounded-md border border-border">
            <p className="border-b border-border px-3 py-1.5 text-xs font-medium">Which statuses to retry</p>
            <div className="max-h-56 overflow-auto">
              <table className="w-full text-xs">
                <tbody className="divide-y divide-border">
                  {STATUS_ADVICE.map((advice) => (
                    <tr key={advice.status} className="hover:bg-secondary/40">
                      <td className="mono w-16 px-3 py-1">{advice.status}</td>
                      <td className="w-24 px-3 py-1">
                        <Badge variant={advice.retry ? "success" : "secondary"} className="text-[9px]">
                          {advice.retry ? "retry" : "do not"}
                        </Badge>
                      </td>
                      <td className="px-3 py-1 text-[11px] text-muted-foreground">{advice.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === "idempotency" && (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] text-muted-foreground">
            Questions rather than rules, because the answers belong to the operation — and a checklist that pretends
            otherwise gets ticked without being read. {checked.size} of {IDEMPOTENCY_CHECKS.length} answered.
          </p>
          {IDEMPOTENCY_CHECKS.map((check) => (
            <label key={check.id} className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2 hover:bg-secondary/30">
              <input
                type="checkbox"
                className="mt-1"
                checked={checked.has(check.id)}
                onChange={(e) => {
                  const next = new Set(checked);
                  if (e.target.checked) next.add(check.id);
                  else next.delete(check.id);
                  setChecked(next);
                }}
              />
              <span>
                <span className="text-sm font-medium">{check.question}</span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">{check.why}</span>
              </span>
            </label>
          ))}
        </div>
      )}

      {tab === "queue" && (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] text-muted-foreground">
            The queue equivalent of a retry policy, with a different failure mode: an HTTP retry gives up, a queue retry
            does not. A message that always fails and has nowhere to go is redelivered forever, and the handler spends
            its whole capacity on one bad message.
          </p>
          {POISON_PLAYBOOK.map((entry, i) => (
            <div key={i} className="rounded-md border border-border p-2">
              <p className="text-sm font-medium">{i + 1}. {entry.step}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{entry.detail}</p>
            </div>
          ))}
        </div>
      )}

      {tab === "code" && (
        <div className="flex flex-col gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <span className="text-xs font-medium">.NET 8 resilience pipeline (HttpClient)</span>
              <CopyButton className="ml-auto" value={toResiliencePipeline(policy, breaker)} />
            </div>
            <pre className="mono max-h-96 overflow-auto whitespace-pre rounded-md border border-border bg-muted/20 p-3 text-[11px]">
              {toResiliencePipeline(policy, breaker)}
            </pre>
          </div>
          <div>
            <div className="mb-1 flex items-center gap-2">
              <span className="text-xs font-medium">Polly v8 directly</span>
              <CopyButton className="ml-auto" value={toPolly(policy, breaker)} />
            </div>
            <pre className="mono max-h-96 overflow-auto whitespace-pre rounded-md border border-border bg-muted/20 p-3 text-[11px]">
              {toPolly(policy, breaker)}
            </pre>
          </div>
        </div>
      )}
    </ToolShell>
  );
}

function FindingRow({ finding }: { finding: ResilienceFinding }) {
  return (
    <p className="text-[11px]">
      {finding.level === "error" ? (
        <AlertTriangle className="mr-1 inline size-3 text-destructive" />
      ) : finding.level === "warn" ? (
        <AlertTriangle className="mr-1 inline size-3 text-warning" />
      ) : (
        <Info className="mr-1 inline size-3 text-muted-foreground" />
      )}
      <b>{finding.subject}:</b> {finding.message}
    </p>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "ok" | "bad" }) {
  return (
    <div className="rounded-md border border-border p-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn("truncate text-sm font-medium", tone === "bad" && "text-destructive", tone === "ok" && "text-success")}>{value}</div>
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
