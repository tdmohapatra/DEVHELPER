import { useMemo, useState } from "react";
import { ToolShell } from "@/components/ToolShell";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

const FLAG_LIST = ["g", "i", "m", "s", "u", "y"] as const;

interface MatchResult {
  match: string;
  index: number;
  groups: string[];
}

export function RegexTester() {
  const [pattern, setPattern] = useState("(\\w+)@(\\w+)\\.(\\w+)");
  const [flags, setFlags] = useState("g");
  const [text, setText] = useState("Contact: john@dev.io, admin@tradelab.co");
  const [replacement, setReplacement] = useState("$1 [at] $2");

  const result = useMemo(() => {
    try {
      const re = new RegExp(pattern, flags.includes("g") ? flags : flags + "g");
      const matches: MatchResult[] = [];
      for (const m of text.matchAll(re)) {
        matches.push({ match: m[0], index: m.index ?? 0, groups: m.slice(1) });
      }
      const replaced = text.replace(new RegExp(pattern, flags), replacement);
      return { matches, replaced, error: "" };
    } catch (e) {
      return { matches: [], replaced: "", error: (e as Error).message };
    }
  }, [pattern, flags, text, replacement]);

  const toggleFlag = (f: string) =>
    setFlags((cur) => (cur.includes(f) ? cur.replace(f, "") : cur + f));

  return (
    <ToolShell toolId="regex-tester" title="Regex Tester" description="Test regular expressions with live match highlighting, groups and replace.">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">Pattern</label>
        <div className="flex items-center gap-2">
          <span className="font-mono text-muted-foreground">/</span>
          <Input className="mono" value={pattern} onChange={(e) => setPattern(e.target.value)} />
          <span className="font-mono text-muted-foreground">/</span>
          <div className="flex gap-1">
            {FLAG_LIST.map((f) => (
              <button
                key={f}
                onClick={() => toggleFlag(f)}
                className={`h-8 w-8 rounded-md border text-sm font-mono ${
                  flags.includes(f) ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>
      {result.error && <p className="mt-2 text-xs text-destructive">{result.error}</p>}

      <div className="mt-3 flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">Test string</label>
          <Badge variant="secondary">{result.matches.length} match{result.matches.length === 1 ? "" : "es"}</Badge>
        </div>
        <Textarea mono className="h-40" value={text} onChange={(e) => setText(e.target.value)} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Matches</label>
          <div className="mt-1 max-h-48 overflow-auto rounded-md border border-border">
            {result.matches.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">No matches.</p>
            ) : (
              <ul className="divide-y divide-border font-mono text-[13px]">
                {result.matches.map((m, i) => (
                  <li key={i} className="px-3 py-1.5">
                    <span className="text-primary">{m.match}</span>
                    <span className="text-muted-foreground"> @ {m.index}</span>
                    {m.groups.length > 0 && (
                      <span className="text-muted-foreground"> · groups: {m.groups.map((g) => JSON.stringify(g)).join(", ")}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Replace with</label>
          <Input className="mono mt-1" value={replacement} onChange={(e) => setReplacement(e.target.value)} />
          <Textarea mono readOnly className="mt-2 h-32 bg-muted/30" value={result.replaced} />
        </div>
      </div>
    </ToolShell>
  );
}
