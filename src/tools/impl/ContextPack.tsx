import { useMemo, useState } from "react";
import { Sparkles, Copy, AlertTriangle, Settings as SettingsIcon } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { copyToClipboard } from "@/lib/utils";
import { aiChat, aiDestinationLabel, AiNotConfiguredError } from "@/lib/ai";
import { useAiStore } from "@/stores/useAiStore";
import { useAppStore } from "@/stores/useAppStore";

interface Piece {
  key: string;
  label: string;
}
const PIECES: Piece[] = [
  { key: "problem", label: "Problem statement" },
  { key: "request", label: "API Request" },
  { key: "response", label: "API Response" },
  { key: "error", label: "Error" },
  { key: "stack", label: "Stack Trace" },
  { key: "logs", label: "Logs" },
  { key: "docker", label: "Docker Status" },
  { key: "gitdiff", label: "Git Diff" },
  { key: "env", label: "Environment Info" },
];

export function ContextPack() {
  const [enabled, setEnabled] = useState<Record<string, boolean>>({ problem: true, error: true });
  const [values, setValues] = useState<Record<string, string>>({});
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const configured = useAiStore((s) => s.isConfigured());
  const openView = useAppStore((s) => s.openView);

  const context = useMemo(() => {
    return PIECES.filter((p) => enabled[p.key] && (values[p.key] ?? "").trim())
      .map((p) => `## ${p.label}\n${values[p.key].trim()}`)
      .join("\n\n");
  }, [enabled, values]);

  const analyze = async () => {
    if (!context.trim()) return toast.error("Enable and fill at least one section");
    setLoading(true);
    setError("");
    setOutput("");
    try {
      setOutput(
        await aiChat([
          {
            role: "system",
            content:
              "You are a senior engineer doing root-cause analysis. Given structured debugging context, respond with sections: Problem, Evidence, Root Cause, Suggested Fix, and a Confidence percentage. Be specific and reference the evidence.",
          },
          { role: "user", content: `Analyze this debugging context:\n\n${context}` },
        ]),
      );
    } catch (e) {
      setError(e instanceof AiNotConfiguredError ? e.message : (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ToolShell
      toolId="context-pack"
      title="DevHelper Context Pack"
      description="Assemble request, response, errors, logs, Docker & git into one structured diagnosis."
      actions={
        <Button size="sm" variant="outline" onClick={async () => { await copyToClipboard(context); toast.success("Context copied"); }} disabled={!context.trim()}>
          <Copy /> Copy context
        </Button>
      }
    >
      {!configured && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-sm">
          <AlertTriangle className="size-4 text-warning" /> AI not configured (you can still assemble and copy context).
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => openView({ kind: "settings" })}><SettingsIcon /> Configure AI</Button>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1fr]">
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {PIECES.map((p) => (
              <button
                key={p.key}
                onClick={() => setEnabled((e) => ({ ...e, [p.key]: !e[p.key] }))}
                className={`rounded-md border px-2 py-1 text-xs ${enabled[p.key] ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"}`}
              >
                {enabled[p.key] ? "☑" : "☐"} {p.label}
              </button>
            ))}
          </div>
          <div className="max-h-[calc(100vh-380px)] space-y-2 overflow-auto pr-1">
            {PIECES.filter((p) => enabled[p.key]).map((p) => (
              <div key={p.key} className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">{p.label}</label>
                <Textarea mono className="h-24" value={values[p.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [p.key]: e.target.value }))} />
              </div>
            ))}
          </div>
          <div className="rounded-md border border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
            ⚠ Analyze sends the assembled context to {aiDestinationLabel()}.
          </div>
          <Button disabled={loading || !configured || !context.trim()} onClick={analyze}>
            <Sparkles /> {loading ? "Analyzing everything…" : "Analyze Everything"}
          </Button>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Diagnosis</label>
          <div className="h-[calc(100vh-340px)] min-h-56 overflow-auto rounded-md border border-border bg-muted/20 p-3">
            {error ? <p className="text-sm text-destructive">{error}</p> : output ? <pre className="whitespace-pre-wrap text-sm leading-relaxed">{output}</pre> : <p className="text-sm text-muted-foreground">Assemble context and click Analyze Everything.</p>}
          </div>
        </div>
      </div>
    </ToolShell>
  );
}
