import { useState } from "react";
import { Check, Copy, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Markdown } from "@/components/Markdown";
import { toast } from "@/components/ui/toast";
import { aiChat, AiNotConfiguredError, activePolicy } from "@/lib/ai";
import { useAiStore } from "@/stores/useAiStore";
import { useAppStore } from "@/stores/useAppStore";
import { notReadyReason } from "@/lib/aiRouting";
import { detectPhi, summarise } from "@/tools/lib/phi";
import {
  applyNoteResult,
  buildNotePrompt,
  noteAiProblem,
  NOTE_ACTIONS,
  parseMeta,
  type NoteAction,
} from "@/tools/lib/noteAi";

interface Props {
  title: string;
  body: string;
  /** The editor's current selection, when there is one. */
  selection?: { start: number; end: number };
  /** Called with the new body once the user accepts a change. */
  onBody: (body: string) => void;
  /** Called when the user accepts a suggested title or tags. */
  onMeta?: (meta: { title?: string; tags?: string[] }) => void;
}

/**
 * AI help for the open note.
 *
 * Every result lands in a review box first. Summaries and analyses are worth
 * reading and throwing away; a rewrite is a destructive edit to something the
 * user typed themselves, and the difference between a useful writing tool and an
 * infuriating one is whether it asks. So: run, read, then Apply or Discard.
 *
 * The work itself is in `tools/lib/noteAi.ts` — prompts and the apply rules — and
 * goes out through `aiChat`, so a note pasted full of identifiers is redacted on
 * the way to a hosted model exactly like everything else.
 */
export function NoteAiPanel({ title, body, selection, onBody, onMeta }: Props) {
  const ai = useAiStore();
  const configured = useAiStore((s) => s.isConfigured());
  const openView = useAppStore((s) => s.openView);
  const [running, setRunning] = useState<string | null>(null);
  const [action, setAction] = useState<NoteAction | null>(null);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

  const selectedText =
    selection && selection.end > selection.start ? body.slice(selection.start, selection.end) : undefined;
  const problem = noteAiProblem(body, selectedText);
  const { policy } = activePolicy();
  const phi = policy === "off" ? [] : detectPhi(selectedText ?? body);

  const run = async (a: NoteAction) => {
    setRunning(a.id);
    setError("");
    setResult("");
    setAction(a);
    try {
      const answer = await aiChat(buildNotePrompt(a, { title, body }, selectedText), "notes");
      setResult(answer.trim());
    } catch (e) {
      setError(e instanceof AiNotConfiguredError ? e.message : (e as Error).message);
    } finally {
      setRunning(null);
    }
  };

  const apply = () => {
    if (!action) return;
    if (action.apply === "meta") {
      const { title: t, tags } = parseMeta(result);
      if (!t && !tags.length) {
        toast.error("Could not read a title or tags out of that answer.");
        return;
      }
      onMeta?.({ title: t || undefined, tags: tags.length ? tags : undefined });
    } else {
      onBody(applyNoteResult(action, body, result, selection));
    }
    setResult("");
    setAction(null);
  };

  return (
    <div className="space-y-2 rounded-md border border-border p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Sparkles className="size-3.5" /> AI
        </span>
        {NOTE_ACTIONS.map((a) => (
          <Button
            key={a.id}
            size="sm"
            variant="outline"
            title={a.hint}
            disabled={!configured || !!problem || running !== null}
            onClick={() => void run(a)}
          >
            {running === a.id ? "…" : a.label}
          </Button>
        ))}
        {selectedText && (
          <Badge variant="secondary" title="Only the selected text is sent">
            selection · {selectedText.length} chars
          </Badge>
        )}
      </div>

      {!configured ? (
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {notReadyReason(ai, ai.provider)}
          <button type="button" className="underline" onClick={() => openView({ kind: "settings" })}>
            Open Settings
          </button>
        </p>
      ) : problem ? (
        <p className="text-xs text-muted-foreground">{problem}</p>
      ) : (
        phi.length > 0 && (
          <p className="text-xs text-warning">{summarise(phi)} — redacted before sending.</p>
        )
      )}

      {error && <p className="rounded border border-destructive/40 bg-destructive/10 p-2 text-xs">{error}</p>}

      {result && action && (
        <div className="space-y-2 rounded border border-primary/40 bg-primary/5 p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium">
              {action.label}
              <span className="ml-2 font-normal text-muted-foreground">
                {action.apply === "read"
                  ? "for reading"
                  : action.apply === "meta"
                    ? "sets the title and tags"
                    : action.apply === "append"
                      ? `will be added${action.heading ? ` under “${action.heading}”` : " at the end"}`
                      : selectedText
                        ? "will replace the selection"
                        : "will replace the whole note"}
              </span>
            </span>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                title="Copy"
                onClick={() => void navigator.clipboard.writeText(result).then(() => toast.success("Copied"))}
              >
                <Copy className="size-3.5" />
              </Button>
              {action.apply !== "read" && (
                <Button size="sm" onClick={apply}>
                  <Check className="size-3.5" /> {action.apply === "meta" ? "Use these" : "Apply"}
                </Button>
              )}
              <Button size="sm" variant="ghost" title="Discard" onClick={() => { setResult(""); setAction(null); }}>
                <X className="size-3.5" />
              </Button>
            </div>
          </div>
          <div className="max-h-64 overflow-auto text-sm">
            <Markdown content={result} />
          </div>
        </div>
      )}
    </div>
  );
}
