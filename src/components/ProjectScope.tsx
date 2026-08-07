import { FolderKanban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useProjectStore } from "@/stores/useProjectStore";
import { scopeCounts, type ScopeKind } from "@/lib/projectScope";

/**
 * "Only show this project's things" — the control that makes a project profile
 * mean something in a list.
 *
 * Renders nothing when there is no active project, or when the profile claims
 * nothing of this kind and nothing else does either: a toggle that provably
 * cannot change what is on screen is noise.
 *
 * The count is spelled out rather than left implicit, because a filter that
 * hides rows without saying how many is a filter people forget is on.
 */
export function ProjectScope({ kind, ids }: { kind: ScopeKind; ids: string[] }) {
  const profiles = useProjectStore((s) => s.profiles);
  const activeId = useProjectStore((s) => s.activeId);
  const enabled = useProjectStore((s) => s.scopeEnabled);
  const setScopeEnabled = useProjectStore((s) => s.setScopeEnabled);

  const active = profiles.find((p) => p.id === activeId);
  if (!active) return null;

  const counts = scopeCounts(ids, kind, profiles, activeId);
  if (counts.mine === 0 && counts.hidden === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant={enabled ? "secondary" : "ghost"}
        onClick={() => setScopeEnabled(!enabled)}
        title={enabled ? "Show everything again" : `Show only what ${active.name} uses, plus anything unfiled`}
      >
        <FolderKanban /> {enabled ? `Scoped to ${active.name}` : `Scope to ${active.name}`}
      </Button>
      <span className={cn("text-[11px]", enabled ? "text-muted-foreground" : "text-muted-foreground/70")}>
        {enabled
          ? `${counts.hidden} hidden — claimed by another project. ${counts.unfiled} unfiled item(s) stay visible.`
          : `${counts.mine} belong to ${active.name}, ${counts.hidden} to other projects, ${counts.unfiled} unfiled.`}
      </span>
    </div>
  );
}

/** Per-row "belongs to this project" checkbox, for the assignment lists. */
export function ProjectMemberToggle({ kind, id, label }: { kind: ScopeKind; id: string; label?: string }) {
  const profiles = useProjectStore((s) => s.profiles);
  const activeId = useProjectStore((s) => s.activeId);
  const toggle = useProjectStore((s) => s.toggleMember);

  const active = profiles.find((p) => p.id === activeId);
  if (!active) return null;
  const claimed = (active.members?.[kind] ?? []).includes(id);

  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
      <input type="checkbox" checked={claimed} onChange={() => toggle(active.id, kind, id)} />
      {label ?? `In ${active.name}`}
    </label>
  );
}
