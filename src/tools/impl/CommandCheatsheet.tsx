import { useMemo, useState } from "react";
import { Info, TriangleAlert } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { CopyButton } from "@/components/CopyButton";
import { COMMAND_GROUPS, type CheatCommand } from "@/tools/lib/commandCheatsheet";
import { cn } from "@/lib/utils";

function CommandRow({ c, showGroup }: { c: CheatCommand; showGroup?: string }) {
  return (
    <div className={cn("flex items-center gap-3 px-3 py-2", c.danger && "bg-destructive/5")}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {showGroup && <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{showGroup}</span>}
          <code className="mono truncate text-foreground">{c.cmd}</code>
          <Tooltip content={c.desc}>
            <button type="button" className="text-muted-foreground transition-colors hover:text-foreground" aria-label={c.desc}>
              <Info className="size-3.5" />
            </button>
          </Tooltip>
          {c.danger && (
            <Badge variant="destructive" className="shrink-0 gap-1">
              <TriangleAlert className="size-3" /> destructive
            </Badge>
          )}
        </div>
      </div>
      <CopyButton value={c.cmd} className="shrink-0" />
    </div>
  );
}

export function CommandCheatsheet() {
  const [query, setQuery] = useState("");
  const [activeGroup, setActiveGroup] = useState(COMMAND_GROUPS[0].id);

  const searching = query.trim().length > 0;

  const filtered = useMemo(() => {
    if (!searching) return [];
    const q = query.trim().toLowerCase();
    return COMMAND_GROUPS.flatMap((g) =>
      g.commands
        .filter((c) => c.cmd.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q) || c.type.toLowerCase().includes(q) || g.label.toLowerCase().includes(q))
        .map((c) => ({ ...c, group: g.label })),
    );
  }, [query, searching]);

  const current = COMMAND_GROUPS.find((g) => g.id === activeGroup) ?? COMMAND_GROUPS[0];
  const byType = useMemo(() => {
    const map = new Map<string, CheatCommand[]>();
    for (const c of current.commands) {
      if (!map.has(c.type)) map.set(c.type, []);
      map.get(c.type)!.push(c);
    }
    return [...map.entries()];
  }, [current]);

  return (
    <ToolShell
      toolId="command-cheatsheet"
      title="Command Reference"
      description="Everyday terminal commands for Git, SSH, Linux, Windows, databases, messaging and CLIs — organized by tool and usage, copy-ready."
    >
      <div className="mb-4">
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search commands, descriptions or tools…"
          className="max-w-md"
        />
      </div>

      {searching ? (
        filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">No commands match "{query}".</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            {filtered.map((c, i) => (
              <div key={`${c.group}-${c.cmd}`} className={i > 0 ? "border-t border-border" : ""}>
                <CommandRow c={c} showGroup={c.group} />
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-1 border-b border-border pb-2">
            {COMMAND_GROUPS.map((g) => (
              <button
                key={g.id}
                onClick={() => setActiveGroup(g.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors",
                  g.id === activeGroup ? "bg-primary/15 font-medium text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                {g.label}
                <span className="rounded-full bg-secondary px-1.5 text-[10px] text-muted-foreground">{g.commands.length}</span>
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-5">
            {byType.map(([type, commands]) => (
              <section key={type}>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{type}</h2>
                <div className="overflow-hidden rounded-lg border border-border">
                  {commands.map((c, i) => (
                    <div key={c.cmd} className={i > 0 ? "border-t border-border" : ""}>
                      <CommandRow c={c} />
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}
    </ToolShell>
  );
}
