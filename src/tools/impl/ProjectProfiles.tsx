import { useState } from "react";
import { Plus, Trash2, CheckCircle2 } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { useProjectStore, type ProjectProfile } from "@/stores/useProjectStore";

export function ProjectProfiles() {
  const { profiles, activeId, upsert, remove, setActive } = useProjectStore();
  const [selectedId, setSelectedId] = useState<string | null>(activeId);
  const [techInput, setTechInput] = useState("");

  const selected = profiles.find((p) => p.id === selectedId);

  const create = () => {
    const id = upsert({ name: "New Project", technologies: [], notes: "" });
    setSelectedId(id);
    setTechInput("");
  };

  const patch = (p: Partial<ProjectProfile>) => {
    if (!selected) return;
    upsert({ ...selected, ...p });
  };

  return (
    <ToolShell toolId="project-profiles" title="Project Profiles" description="Optional per-project context (tech stack, notes) to tailor your workflow.">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[260px_1fr]">
        <div className="flex flex-col gap-2">
          <Button size="sm" onClick={create}><Plus /> New profile</Button>
          <div className="flex flex-col gap-1">
            {profiles.map((p) => (
              <button key={p.id} onClick={() => { setSelectedId(p.id); setTechInput(p.technologies.join(", ")); }}
                className={cn("flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm", selectedId === p.id ? "border-primary bg-primary/10" : "border-border hover:bg-secondary")}>
                <span className="truncate font-medium">{p.name}</span>
                {activeId === p.id && <CheckCircle2 className="ml-auto size-3.5 text-success" />}
              </button>
            ))}
            {profiles.length === 0 && <p className="text-sm text-muted-foreground">No profiles yet.</p>}
          </div>
        </div>

        <div>
          {selected ? (
            <div className="rounded-md border border-border p-4">
              <div className="mb-3 flex items-center gap-2">
                <Input className="h-8 w-56 font-medium" value={selected.name} onChange={(e) => patch({ name: e.target.value })} />
                <div className="ml-auto flex gap-2">
                  <Button size="sm" variant={activeId === selected.id ? "secondary" : "default"} onClick={() => setActive(selected.id)}>{activeId === selected.id ? "Active" : "Set active"}</Button>
                  <Button size="sm" variant="ghost" onClick={() => { remove(selected.id); setSelectedId(null); }}><Trash2 /> Delete</Button>
                </div>
              </div>
              <label className="text-xs font-medium text-muted-foreground">Technologies (comma separated)</label>
              <Input className="mt-1 mb-2" value={techInput} onChange={(e) => setTechInput(e.target.value)} onBlur={() => patch({ technologies: techInput.split(",").map((t) => t.trim()).filter(Boolean) })} placeholder=".NET, PostgreSQL, Redis, Docker" />
              <div className="mb-3 flex flex-wrap gap-1">{selected.technologies.map((t) => <Badge key={t} variant="secondary">{t}</Badge>)}</div>
              <label className="text-xs font-medium text-muted-foreground">Notes</label>
              <Textarea mono className="mt-1 h-56" value={selected.notes} onChange={(e) => patch({ notes: e.target.value })} onBlur={() => toast.success("Saved")} placeholder="Connection strings format, conventions, useful links…" />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Select or create a profile.</p>
          )}
        </div>
      </div>
    </ToolShell>
  );
}
