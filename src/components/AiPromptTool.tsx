import { useMemo, useState } from "react";
import { Sparkles, AlertTriangle, Settings as SettingsIcon, ShieldCheck, ShieldAlert } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CopyButton } from "@/components/CopyButton";
import { Markdown } from "@/components/Markdown";
import { AddToDebug } from "@/components/AddToDebug";
import { activePolicy, aiChat, aiDestinationLabel, AiNotConfiguredError, type ChatMessage } from "@/lib/ai";
import { detectPhi, summarise } from "@/tools/lib/phi";
import { useAiStore } from "@/stores/useAiStore";
import { useAppStore } from "@/stores/useAppStore";
import type { ParsedEvent } from "@/tools/lib/debugSession";

interface Props {
  toolId: string;
  title: string;
  description: string;
  inputLabel: string;
  placeholder: string;
  systemPrompt: string;
  buildUserPrompt: (input: string) => string;
  sample?: string;
  /** When set, shows an "Add to Debug Session" button that captures the current input. */
  capture?: (input: string, output: string) => ParsedEvent;
}

/** Shared scaffold for "paste input → AI analyses it → markdown-ish output" tools. */
export function AiPromptTool({ toolId, title, description, inputLabel, placeholder, systemPrompt, buildUserPrompt, sample, capture }: Props) {
  const [input, setInput] = useState(sample ?? "");
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const configured = useAiStore((s) => s.isConfigured());
  const openView = useAppStore((s) => s.openView);

  /*
   * What the gateway would do to this input, shown before it is sent rather
   * than after. `lib/ai` applies the policy either way — this is so the decision
   * is visible while there is still time to change the input.
   */
  const { policy, local } = activePolicy();
  const phi = useMemo(() => (policy === "off" ? [] : detectPhi(input)), [input, policy]);

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
      setOutput(await aiChat(messages, toolId));
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

      {policy === "off" ? (
        local && (
          <div className="mb-2 flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5" />
            The model is on this machine, so nothing is redacted. Change that in the PHI Gateway.
          </div>
        )
      ) : phi.length > 0 ? (
        <div className="mb-2 flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs">
          <ShieldAlert className="size-3.5 text-warning" />
          {policy === "warn"
            ? `${summarise(phi)} found and will be sent as written — the policy is warn only.`
            : `${summarise(phi)} will be replaced with tokens before this leaves, and put back into the answer.`}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => openView({ kind: "tool", toolId: "phi-gateway" })}>
            Review
          </Button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">{inputLabel}</label>
          <Textarea
            mono
            className="h-[calc(100vh-380px)] min-h-56"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !loading && configured && input.trim()) { e.preventDefault(); run(); } }}
            placeholder={placeholder}
          />
          <div className="mt-1 flex items-center gap-2">
            <Button disabled={loading || !configured || !input.trim()} onClick={run} title="Ctrl+Enter">
              <Sparkles /> {loading ? "Analyzing…" : "Analyze"}
            </Button>
            {capture && input.trim() && <AddToDebug makeEvent={() => capture(input, output)} label="Add to Debug" variant="ghost" />}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Result</label>
          <div className="h-[calc(100vh-380px)] min-h-56 overflow-auto rounded-md border border-border bg-muted/20 p-3">
            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : output ? (
              <Markdown content={output} />
            ) : (
              <p className="text-sm text-muted-foreground">{loading ? "Waiting for the model…" : "Result appears here."}</p>
            )}
          </div>
        </div>
      </div>
    </ToolShell>
  );
}
