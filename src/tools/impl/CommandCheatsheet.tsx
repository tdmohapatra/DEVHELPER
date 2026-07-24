import { useMemo, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/CopyButton";
import { COMMAND_GROUPS } from "@/tools/lib/commandCheatsheet";

export function CommandCheatsheet() {
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COMMAND_GROUPS;
    return COMMAND_GROUPS.map((g) => ({
      ...g,
      commands: g.commands.filter(
        (c) => c.cmd.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q) || g.label.toLowerCase().includes(q),
      ),
    })).filter((g) => g.commands.length > 0);
  }, [query]);

  const total = groups.reduce((n, g) => n + g.commands.length, 0);

  return (
    <ToolShell
      toolId="command-cheatsheet"
      title="Command Reference"
      description="Everyday terminal commands for Git, SSH, Linux, Windows, databases, messaging and CLIs — grouped, searchable, copy-ready."
    >
      <div className="mb-4 flex items-center gap-3">
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search commands, descriptions or tools…"
          className="max-w-md"
        />
        <span className="text-xs text-muted-foreground">{total} command{total === 1 ? "" : "s"}</span>
      </div>

      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">No commands match "{query}".</p>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((g) => (
            <section key={g.id}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.label}</h2>
              <div className="overflow-hidden rounded-lg border border-border">
                {g.commands.map((c, i) => (
                  <div
                    key={c.cmd}
                    className={`flex items-center gap-3 px-3 py-2 ${i > 0 ? "border-t border-border" : ""} ${c.danger ? "bg-destructive/5" : ""}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <code className="mono truncate text-foreground">{c.cmd}</code>
                        {c.danger && (
                          <Badge variant="destructive" className="shrink-0 gap-1">
                            <TriangleAlert className="size-3" /> destructive
                          </Badge>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{c.desc}</p>
                    </div>
                    <CopyButton value={c.cmd} className="shrink-0" />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </ToolShell>
  );
}
