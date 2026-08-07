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
import { useApiStore } from "@/stores/useApiStore";
import { useDbStore } from "@/stores/useDbStore";
import { useSnippetStore } from "@/stores/useSnippetStore";
import { SCOPE_KINDS, SCOPE_LABEL, claimedBy, isMember, totalClaims, type ScopeKind } from "@/lib/projectScope";

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
              <Textarea mono className="mt-1 h-40" value={selected.notes} onChange={(e) => patch({ notes: e.target.value })} onBlur={() => toast.success("Saved")} placeholder="Connection strings format, conventions, useful links…" />

              <MembershipEditor profile={selected} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Select or create a profile.</p>
          )}
        </div>
      </div>
    </ToolShell>
  );
}

/**
 * Which environments, connections, snippets and request folders this project uses.
 *
 * Claiming is not exclusive — a shared staging database belongs to several
 * projects — and anything nobody claims stays visible everywhere, so filing is
 * something you do when it starts to pay off rather than a prerequisite.
 */
function MembershipEditor({ profile }: { profile: ProjectProfile }) {
  const toggle = useProjectStore((s) => s.toggleMember);
  const profiles = useProjectStore((s) => s.profiles);

  const environments = useApiStore((s) => s.environments);
  const folders = useApiStore((s) => s.folders);
  const connections = useDbStore((s) => s.connections);
  const snippets = useSnippetStore((s) => s.snippets);

  const lists: Record<ScopeKind, { id: string; label: string }[]> = {
    environments: environments.map((e) => ({ id: e.id, label: e.name })),
    connections: connections.map((c) => ({ id: c.id, label: `${c.name} (${c.engine})` })),
    snippets: snippets.map((s) => ({ id: s.id, label: s.title })),
    folders: folders.map((f) => ({ id: f.id, label: f.name })),
  };

  const claims = totalClaims(profile);

  return (
    <div className="mt-4 border-t border-border pt-3">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Used by this project</span>
        <Badge variant="outline" className="text-[10px]">{claims} claimed</Badge>
      </div>
      <p className="mb-2 text-[11px] text-muted-foreground">
        Tick what this project uses, then turn on <b>Scope to {profile.name}</b> in the Database Toolkit, Environment
        Manager or Snippet Library. Anything no project has claimed stays visible everywhere, so nothing disappears
        because you have not filed it yet. An item can belong to more than one project.
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {SCOPE_KINDS.map((kind) => (
          <div key={kind} className="rounded-md border border-border p-2">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {SCOPE_LABEL[kind]}
            </div>
            {lists[kind].length === 0 ? (
              <p className="text-[11px] text-muted-foreground">None saved yet.</p>
            ) : (
              <div className="flex max-h-40 flex-col gap-0.5 overflow-auto">
                {lists[kind].map((item) => {
                  const others = claimedBy(profiles, kind, item.id).filter((p) => p.id !== profile.id);
                  return (
                    <label key={item.id} className="flex cursor-pointer items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={isMember(profile, kind, item.id)}
                        onChange={() => toggle(profile.id, kind, item.id)}
                      />
                      <span className="truncate">{item.label}</span>
                      {others.length > 0 && (
                        <span className="shrink-0 text-[10px] text-muted-foreground" title={others.map((p) => p.name).join(", ")}>
                          also in {others.length}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
