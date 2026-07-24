import { useMemo, useState } from "react";
import { Info } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/CopyButton";
import { findAbbreviations, expandInline, lookup } from "@/tools/lib/medterms";

const SAMPLE = "Pt c/o SOB, Hx of HTN and DM. BP elevated. Admitted for CP, r/o MI.";

export function MedicalTextUtility() {
  const [input, setInput] = useState(SAMPLE);
  const [query, setQuery] = useState("");

  const hits = useMemo(() => findAbbreviations(input), [input]);
  const expanded = useMemo(() => expandInline(input), [input]);
  const lookupResult = query.trim() ? lookup(query.trim()) : undefined;

  // Unique abbreviations found.
  const unique = useMemo(() => {
    const seen = new Map<string, string>();
    hits.forEach((h) => seen.set(h.token.toUpperCase(), h.expansion));
    return [...seen.entries()];
  }, [hits]);

  return (
    <ToolShell
      toolId="medical-text-utility"
      title="Medical Text Utility"
      description="Expand medical abbreviations for integration/terminology work. NOT medical advice."
      actions={<CopyButton value={expanded} label="Copy expanded" />}
    >
      <div className="mb-3 flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
        <Info className="size-4 text-warning" />
        Terminology convenience only. Do not use for clinical decisions.
      </div>

      <div className="mb-4 flex items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Quick lookup</span>
          <Input className="h-8 w-40" placeholder="e.g. HTN" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        {query.trim() && (
          lookupResult ? <Badge variant="success" className="mb-1">{query.trim()} → {lookupResult}</Badge> : <Badge variant="secondary" className="mb-1">not found</Badge>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Text</label>
          <Textarea mono className="h-56" value={input} onChange={(e) => setInput(e.target.value)} />
          <label className="mt-2 text-xs font-medium text-muted-foreground">Expanded inline</label>
          <Textarea mono readOnly className="h-32 bg-muted/30" value={expanded} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Abbreviations found ({unique.length})</label>
          <div className="h-[calc(100%-1.5rem)] min-h-56 overflow-auto rounded-md border border-border">
            {unique.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">No known abbreviations detected.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-border">
                  {unique.map(([abbr, exp]) => (
                    <tr key={abbr}>
                      <td className="w-20 px-3 py-1.5 font-mono font-semibold text-primary">{abbr}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{exp}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </ToolShell>
  );
}
