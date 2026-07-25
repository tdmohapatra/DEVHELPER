import { useMemo, useState } from "react";
import { Sparkles, MapPin } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { AddToDebug } from "@/components/AddToDebug";
import { Markdown } from "@/components/Markdown";
import { cn } from "@/lib/utils";
import { parseStackTrace, rootFrame } from "@/tools/lib/stacktrace";
import { aiChat, AiNotConfiguredError } from "@/lib/ai";
import { useAiStore } from "@/stores/useAiStore";

const SAMPLE = `System.NullReferenceException: Object reference not set to an instance of an object.
   at OrderService.CalculateTotal(Order order) in C:\\app\\OrderService.cs:line 87
   at OrderController.Post(OrderDto dto) in C:\\app\\OrderController.cs:line 34
   at System.Web.Mvc.ActionMethodDispatcher.Execute()
 ---> System.InvalidOperationException: Sequence contains no elements`;

export function StackTraceAnalyzer() {
  const [input, setInput] = useState(SAMPLE);
  const [aiOut, setAiOut] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiErr, setAiErr] = useState("");
  const configured = useAiStore((s) => s.isConfigured());

  const parsed = useMemo(() => parseStackTrace(input), [input]);
  const root = useMemo(() => rootFrame(parsed), [parsed]);

  const explain = async () => {
    setAiLoading(true);
    setAiErr("");
    setAiOut("");
    try {
      setAiOut(
        await aiChat([
          { role: "system", content: "You are a debugging expert. Explain the stack trace's root cause and fix concisely." },
          { role: "user", content: `Explain this stack trace:\n\n${input}` },
        ]),
      );
    } catch (e) {
      setAiErr(e instanceof AiNotConfiguredError ? e.message : (e as Error).message);
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <ToolShell toolId="stack-trace-analyzer" title="Stack Trace Analyzer" description="Parse .NET / Java / JS stack traces locally. AI explanation optional.">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Stack trace</label>
          <Textarea mono className="h-[calc(100vh-360px)] min-h-56" value={input} onChange={(e) => setInput(e.target.value)} />
        </div>

        <div className="flex flex-col gap-2 overflow-auto">
          {parsed.exceptionType ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="font-mono text-sm font-semibold text-destructive">{parsed.exceptionType}</div>
                <AddToDebug
                  variant="ghost"
                  label="Add to Debug"
                  makeEvent={() => ({
                    source: "exception",
                    status: "error",
                    title: `${parsed.exceptionType}${root ? ` @ ${root.method}` : ""}`,
                    service: root?.file ?? undefined,
                    error: `${parsed.exceptionType}: ${parsed.message ?? ""}\n${root ? `${root.method} ${root.file ?? ""}${root.line ? `:${root.line}` : ""}` : ""}`.trim(),
                    payload: input.slice(0, 1500),
                  })}
                />
              </div>
              {parsed.message && <div className="mt-1 text-sm">{parsed.message}</div>}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No exception header detected.</p>
          )}

          {root && (
            <div className="rounded-md border border-primary/40 bg-primary/10 p-3 text-sm">
              <div className="mb-1 flex items-center gap-1 text-xs font-medium text-primary"><MapPin className="size-3" /> Likely origin</div>
              <div className="font-mono text-[13px]">{root.method}</div>
              {root.file && <div className="font-mono text-xs text-muted-foreground">{root.file}{root.line ? `:${root.line}` : ""}</div>}
            </div>
          )}

          {parsed.inner.length > 0 && (
            <div>
              <div className="text-xs font-medium text-muted-foreground">Inner exceptions</div>
              {parsed.inner.map((x, i) => (
                <div key={i} className="mt-1 rounded-md border border-border p-2 text-xs">
                  <span className="font-mono font-semibold">{x.exceptionType}</span> {x.message}
                </div>
              ))}
            </div>
          )}

          <div>
            <div className="text-xs font-medium text-muted-foreground">Call frames ({parsed.frames.length})</div>
            <div className="mt-1 max-h-56 overflow-auto rounded-md border border-border">
              <ul className="divide-y divide-border font-mono text-[12px]">
                {parsed.frames.map((f, i) => (
                  <li key={i} className={cn("px-2 py-1", f.isUserCode ? "text-foreground" : "text-muted-foreground")}>
                    {f.isUserCode && <span className="mr-1 text-primary">▸</span>}
                    {f.method}
                    {f.file && <span className="text-muted-foreground"> — {f.file}{f.line ? `:${f.line}` : ""}</span>}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div>
            <Button size="sm" variant="outline" disabled={!configured || aiLoading} onClick={explain}>
              <Sparkles /> {aiLoading ? "Explaining…" : "Explain with AI"}
            </Button>
            {!configured && <span className="ml-2 text-xs text-muted-foreground">Configure AI in Settings to enable.</span>}
            {aiErr && <p className="mt-1 text-xs text-destructive">{aiErr}</p>}
            {aiOut && <div className="mt-2 rounded-md border border-border bg-muted/20 p-3"><Markdown content={aiOut} /></div>}
          </div>
        </div>
      </div>
    </ToolShell>
  );
}
