import { useEffect, useMemo, useRef, useState } from "react";
import { Send, Trash2, Settings as SettingsIcon, ShieldAlert, ShieldCheck, User, Bot } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/CopyButton";
import { Markdown } from "@/components/Markdown";
import { activePolicy, aiChat, aiDestinationLabel, AiNotConfiguredError, type ChatMessage } from "@/lib/ai";
import { detectPhi, summarise } from "@/tools/lib/phi";
import { useAiStore } from "@/stores/useAiStore";
import { useAppStore } from "@/stores/useAppStore";
import { useChatStore, DEFAULT_SYSTEM_PROMPT } from "@/stores/useChatStore";
import { notReadyReason } from "@/lib/aiRouting";
import { cn } from "@/lib/utils";

/**
 * A conversation with whichever AI is switched on.
 *
 * The six other AI tools each own one task and one prompt. This one owns none:
 * it is for the questions that do not fit a form. What it adds over them is
 * history — every previous turn is sent again, which is the only way a model can
 * follow up — and that is also why the destination is shown on every reply. A
 * conversation that silently changed machines halfway through would be
 * impossible to reason about afterwards.
 */
export function AiChat() {
  const { turns, systemPrompt, add, clear, setSystemPrompt } = useChatStore();
  const configured = useAiStore((s) => s.isConfigured());
  const ai = useAiStore();
  const openView = useAppStore((s) => s.openView);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showSystem, setShowSystem] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const { policy } = activePolicy();
  const phi = useMemo(() => (policy === "off" ? [] : detectPhi(input)), [input, policy]);

  // Follow the conversation as it grows, the way every chat does.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns.length, busy]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setError("");
    add({ role: "user", content: text });
    setInput("");
    setBusy(true);

    // The whole conversation goes out, not just this line — that is what makes
    // a follow-up question work. `aiChat` redacts each message on the way out
    // and re-identifies the answer, so history does not weaken the gateway.
    const history: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...useChatStore.getState().turns.map(({ role, content }) => ({ role, content })),
    ];

    try {
      const answer = await aiChat(history, "ai-chat");
      add({ role: "assistant", content: answer, via: aiDestinationLabel() });
    } catch (e) {
      setError(e instanceof AiNotConfiguredError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolShell
      toolId="ai-chat"
      title="AI Chat"
      description="Ask anything, with the conversation kept — answered by whichever AI is switched on."
      actions={
        <div className="flex items-center gap-2">
          <Badge variant={configured ? "success" : "secondary"}>{aiDestinationLabel()}</Badge>
          <Button size="sm" variant="ghost" onClick={() => setShowSystem((v) => !v)}>System prompt</Button>
          <Button size="sm" variant="ghost" onClick={clear} disabled={!turns.length}>
            <Trash2 className="size-4" /> Clear
          </Button>
        </div>
      }
    >
      <div className="flex h-full flex-col gap-3 p-4">
        {!configured && (
          <div className="flex items-center gap-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
            <span className="flex-1">{notReadyReason(ai, ai.provider)}</span>
            <Button size="sm" variant="outline" onClick={() => openView({ kind: "settings" })}>
              <SettingsIcon className="size-4" /> Settings
            </Button>
          </div>
        )}

        {showSystem && (
          <div className="space-y-2 rounded-md border p-3">
            <p className="text-xs text-muted-foreground">
              Sent before every message. Change it to point the assistant at a domain.
            </p>
            <Textarea rows={3} value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} />
            <Button size="sm" variant="ghost" onClick={() => setSystemPrompt(DEFAULT_SYSTEM_PROMPT)}>Reset</Button>
          </div>
        )}

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {turns.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nothing yet. Ask about an error, a query, an HL7 segment, a design call.
            </p>
          )}
          {turns.map((t) => (
            <div key={t.id} className={cn("flex gap-3", t.role === "user" && "justify-end")}>
              {t.role === "assistant" && <Bot className="mt-1 size-4 shrink-0 text-muted-foreground" />}
              <div
                className={cn(
                  "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                  t.role === "user" ? "bg-primary/10" : "bg-muted",
                )}
              >
                {t.role === "assistant" ? <Markdown content={t.content} /> : <p className="whitespace-pre-wrap">{t.content}</p>}
                <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span>{new Date(t.at).toLocaleTimeString()}</span>
                  {t.via && <span className="truncate">· {t.via}</span>}
                  <CopyButton value={t.content} />
                </div>
              </div>
              {t.role === "user" && <User className="mt-1 size-4 shrink-0 text-muted-foreground" />}
            </div>
          ))}
          {busy && <p className="text-sm text-muted-foreground">Thinking…</p>}
          {error && <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">{error}</p>}
          <div ref={endRef} />
        </div>

        <div className="space-y-2">
          {phi.length > 0 && (
            <p className="flex items-center gap-2 text-xs text-warning">
              <ShieldAlert className="size-3.5" /> {summarise(phi)} — redacted before sending.
            </p>
          )}
          {phi.length === 0 && policy !== "off" && input.trim() && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="size-3.5" /> No identifiers found in this message.
            </p>
          )}
          <div className="flex gap-2">
            <Textarea
              rows={3}
              value={input}
              placeholder={configured ? "Ask a question…  (Enter sends, Shift+Enter for a new line)" : "Switch on an AI in Settings first"}
              disabled={!configured || busy}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends because this is a chat; a multi-line paste still
                // works, and Shift+Enter is the escape hatch for typing one.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <Button onClick={() => void send()} disabled={!configured || busy || !input.trim()}>
              <Send className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </ToolShell>
  );
}
