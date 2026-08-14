import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, GraduationCap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/CopyButton";
import { Markdown } from "@/components/Markdown";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/useAppStore";
import { BUILT_IN_QUESTIONS, questionsForTool, type Question } from "@/tools/lib/learn";

/**
 * The concepts behind the tool you are looking at.
 *
 * A toolbox teaches you which buttons exist. It does not teach you why MLLP
 * needs an accumulating reader or what an ACK code means, and those are the
 * things that make the buttons worth pressing. The learning catalogue already
 * holds that material and cards name the tools they can be practised in, so
 * every tool can offer its own theory without knowing anything about the
 * catalogue's contents.
 *
 * Rendered inline rather than as a link, because the point is to read it while
 * the tool is in front of you.
 */
export function useConceptCount(toolId: string): number {
  return useMemo(() => questionsForTool(BUILT_IN_QUESTIONS, toolId).length, [toolId]);
}

export function Concepts({ toolId, onClose }: { toolId: string; onClose: () => void }) {
  const cards = useMemo(() => questionsForTool(BUILT_IN_QUESTIONS, toolId), [toolId]);
  const openTool = useAppStore((s) => s.openTool);
  const [openId, setOpenId] = useState<string | null>(cards[0]?.id ?? null);

  if (!cards.length) return null;

  return (
    <section className="mb-4 rounded-lg border border-border bg-secondary/20">
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 text-xs font-medium">
          <GraduationCap className="size-3.5" />
          Concepts behind this tool
          <Badge variant="secondary" className="text-[10px]">{cards.length}</Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => openTool("learn-hub")}>
            Open in Interview Prep
          </Button>
          <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={onClose}>
            Hide
          </Button>
        </div>
      </header>

      <div className="divide-y divide-border">
        {cards.map((card) => (
          <ConceptCard key={card.id} card={card} open={openId === card.id} onToggle={() => setOpenId(openId === card.id ? null : card.id)} />
        ))}
      </div>
    </section>
  );
}

function ConceptCard({ card, open, onToggle }: { card: Question; open: boolean; onToggle: () => void }) {
  return (
    <div>
      <button className="flex w-full items-start gap-2 px-3 py-2 text-left" onClick={onToggle}>
        {open ? <ChevronDown className="mt-0.5 size-3.5 shrink-0" /> : <ChevronRight className="mt-0.5 size-3.5 shrink-0" />}
        <span className="min-w-0 flex-1 text-xs font-medium">{card.question}</span>
        <span className={cn("shrink-0 text-[10px]", card.mustKnow ? "text-warning" : "text-muted-foreground")}>
          {card.mustKnow ? "must know" : card.level}
        </span>
      </button>

      {open && (
        <div className="space-y-2 px-3 pb-3 pl-8">
          <Markdown content={card.answer} className="text-xs" />

          {card.diagram && (
            <pre className="mono overflow-x-auto rounded border border-border bg-background p-2 text-[11px] leading-relaxed">{card.diagram}</pre>
          )}

          {card.code && (
            <div className="group relative rounded border border-border bg-background">
              <CopyButton value={card.code} className="absolute right-1 top-1 h-5 px-1.5 text-[10px] opacity-0 transition-opacity group-hover:opacity-100" />
              <pre className="mono overflow-x-auto p-2 pr-14 text-[11px] leading-relaxed">{card.code}</pre>
            </div>
          )}

          {card.followUps?.map((f, i) => (
            <div key={i} className="rounded border border-border/60 px-2 py-1.5">
              <p className="text-[11px] font-medium">{f.question}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{f.answer}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
