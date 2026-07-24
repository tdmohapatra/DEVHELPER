import { useState } from "react";
import { Sparkles, AlertTriangle, Settings as SettingsIcon } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CopyButton } from "@/components/CopyButton";
import { aiChat, aiDestinationLabel, AiNotConfiguredError, type ChatMessage } from "@/lib/ai";
import { useAiStore } from "@/stores/useAiStore";
import { useAppStore } from "@/stores/useAppStore";

interface Props {
  toolId: string;
  title: string;
  description: string;
  inputLabel: string;
  placeholder: string;
  systemPrompt: string;
  buildUserPrompt: (input: string) => string;
  sample?: string;
}

/** Shared scaffold for "paste input → AI analyses it → markdown-ish output" tools. */
export function AiPromptTool({ toolId, title, description, inputLabel, placeholder, systemPrompt, buildUserPrompt, sample }: Props) {
  const [input, setInput] = useState(sample ?? "");
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const configured = useAiStore((s) => s.isConfigured());
  const openView = useAppStore((s) => s.openView);

  const run = async () => {
    if (!input.trim()) return;
    setLoading(true);
    setError("");
    setOutput("");
    try {
      const messages: ChatMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: buildUserPrompt(input) },
      ];
      setOutput(await aiChat(messages));
    } catch (e) {
      setError(e instanceof AiNotConfiguredError ? e.message : (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ToolShell toolId={toolId} title={title} description={description} actions={output && <CopyButton value={output} />}>
      {!configured && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-sm">
          <AlertTriangle className="size-4 text-warning" />
          AI is not configured.
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => openView({ kind: "settings" })}>
            <SettingsIcon /> Configure AI
          </Button>
        </div>
      )}
      <div className="mb-2 rounded-md border border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
        ⚠ Running this sends your input to {aiDestinationLabel()}.
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">{inputLabel}</label>
          <Textarea mono className="h-[calc(100vh-380px)] min-h-56" value={input} onChange={(e) => setInput(e.target.value)} placeholder={placeholder} />
          <Button className="mt-1 self-start" disabled={loading || !configured || !input.trim()} onClick={run}>
            <Sparkles /> {loading ? "Analyzing…" : "Analyze"}
          </Button>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Result</label>
          <div className="h-[calc(100vh-380px)] min-h-56 overflow-auto rounded-md border border-border bg-muted/20 p-3">
            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : output ? (
              <pre className="whitespace-pre-wrap text-sm leading-relaxed">{output}</pre>
            ) : (
              <p className="text-sm text-muted-foreground">{loading ? "Waiting for the model…" : "Result appears here."}</p>
            )}
          </div>
        </div>
      </div>
    </ToolShell>
  );
}
