import { useMemo, useState } from "react";
import { ToolShell } from "@/components/ToolShell";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { diffJson, type DiffEntry } from "@/tools/lib/json";
import { cn } from "@/lib/utils";

const kindStyle: Record<DiffEntry["kind"], string> = {
  added: "text-success",
  removed: "text-destructive",
  changed: "text-warning",
  unchanged: "text-muted-foreground",
};
const kindSymbol: Record<DiffEntry["kind"], string> = {
  added: "+",
  removed: "−",
  changed: "~",
  unchanged: " ",
};

export function JsonDiff() {
  const [left, setLeft] = useState(`{"name":"A","port":8080,"tags":["x"]}`);
  const [right, setRight] = useState(`{"name":"B","port":8080,"tags":["x","y"]}`);
  const [error, setError] = useState("");

  const entries = useMemo(() => {
    try {
      setError("");
      return diffJson(left, right).filter((e) => e.kind !== "unchanged");
    } catch (e) {
      setError((e as Error).message);
      return [];
    }
  }, [left, right]);

  const counts = useMemo(() => {
    const c = { added: 0, removed: 0, changed: 0 };
    entries.forEach((e) => e.kind in c && (c[e.kind as keyof typeof c] += 1));
    return c;
  }, [entries]);

  return (
    <ToolShell toolId="json-diff" title="JSON Diff" description="Structural diff of two JSON documents by path.">
      <div className="mb-3 flex gap-2">
        <Badge variant="success">+{counts.added} added</Badge>
        <Badge variant="destructive">−{counts.removed} removed</Badge>
        <Badge variant="warning">~{counts.changed} changed</Badge>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Textarea mono className="h-56" value={left} onChange={(e) => setLeft(e.target.value)} placeholder="Left JSON" />
        <Textarea mono className="h-56" value={right} onChange={(e) => setRight(e.target.value)} placeholder="Right JSON" />
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <div className="mt-4 rounded-md border border-border">
        {entries.length === 0 && !error ? (
          <p className="p-4 text-sm text-muted-foreground">No differences.</p>
        ) : (
          <ul className="divide-y divide-border font-mono text-[13px]">
            {entries.map((e, i) => (
              <li key={i} className={cn("flex items-start gap-3 px-3 py-1.5", kindStyle[e.kind])}>
                <span className="w-3 shrink-0 font-bold">{kindSymbol[e.kind]}</span>
                <span className="w-56 shrink-0 truncate text-foreground">{e.path || "(root)"}</span>
                <span className="truncate">
                  {e.kind === "changed"
                    ? `${JSON.stringify(e.left)} → ${JSON.stringify(e.right)}`
                    : JSON.stringify(e.kind === "added" ? e.right : e.left)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </ToolShell>
  );
}
