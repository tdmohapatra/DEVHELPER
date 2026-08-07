/**
 * Making a project profile actually scope the app.
 *
 * Project Profiles recorded a name, a stack and some notes, and nothing read
 * them. Meanwhile the connection list, the environment list and the snippet
 * list grow across every project you have ever worked on, and by the third one
 * you are reading past two thirds of each list every time.
 *
 * A profile can now claim artefacts. Claiming is deliberately not exclusive
 * ownership — a shared staging database belongs to several projects — and the
 * filtering rule is the important part: anything no profile has claimed stays
 * visible under every profile. Otherwise a scoped view silently hides
 * everything created before the feature existed, and everything created after
 * it until someone remembers to file it.
 */

export type ScopeKind = "environments" | "connections" | "snippets" | "folders";

export const SCOPE_KINDS: ScopeKind[] = ["environments", "connections", "snippets", "folders"];

export const SCOPE_LABEL: Record<ScopeKind, string> = {
  environments: "Environments",
  connections: "Database connections",
  snippets: "Snippets",
  folders: "Request folders",
};

/** Ids a profile claims, per kind. Absent means it has claimed nothing yet. */
export type ScopeMembers = Partial<Record<ScopeKind, string[]>>;

export interface ScopedProfile {
  id: string;
  name: string;
  members?: ScopeMembers;
}

/** Ids this profile claims of one kind. */
export function membersOf(profile: ScopedProfile | undefined, kind: ScopeKind): string[] {
  return profile?.members?.[kind] ?? [];
}

/** Does this profile claim that artefact? */
export function isMember(profile: ScopedProfile | undefined, kind: ScopeKind, id: string): boolean {
  return membersOf(profile, kind).includes(id);
}

/** Add or remove a claim, returning a new members object. */
export function toggleMember(profile: ScopedProfile, kind: ScopeKind, id: string): ScopeMembers {
  const current = membersOf(profile, kind);
  const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
  const members: ScopeMembers = { ...profile.members, [kind]: next };
  // An empty list is the same as no claim; not storing it keeps profiles clean.
  if (next.length === 0) delete members[kind];
  return members;
}

/** Set the whole claim list for one kind at once. */
export function setMembers(profile: ScopedProfile, kind: ScopeKind, ids: string[]): ScopeMembers {
  const members: ScopeMembers = { ...profile.members, [kind]: [...new Set(ids)] };
  if (ids.length === 0) delete members[kind];
  return members;
}

/** Every profile that claims this artefact. */
export function claimedBy(profiles: ScopedProfile[], kind: ScopeKind, id: string): ScopedProfile[] {
  return profiles.filter((p) => isMember(p, kind, id));
}

/** Is this artefact claimed by anyone at all? */
export function isClaimed(profiles: ScopedProfile[], kind: ScopeKind, id: string): boolean {
  return profiles.some((p) => isMember(p, kind, id));
}

/**
 * Filter a list to what the active profile should see.
 *
 * Three cases, and the third is the one that keeps this usable:
 * - No active profile, or scoping off: everything.
 * - Claimed by the active profile: shown.
 * - Claimed by nobody: shown. An unfiled artefact is not another project's, and
 *   hiding it would mean anything created outside this screen disappears.
 */
export function scopeItems<T>(
  items: T[],
  getId: (item: T) => string,
  kind: ScopeKind,
  profiles: ScopedProfile[],
  activeId: string | null,
  enabled: boolean,
): T[] {
  if (!enabled || !activeId) return items;
  const active = profiles.find((p) => p.id === activeId);
  if (!active) return items;
  return items.filter((item) => {
    const id = getId(item);
    return isMember(active, kind, id) || !isClaimed(profiles, kind, id);
  });
}

export interface ScopeCounts {
  total: number;
  mine: number;
  unfiled: number;
  /** Claimed by some other profile, and therefore hidden when scoping is on. */
  hidden: number;
}

/** How a scoped filter would break a list down, for explaining what is hidden. */
export function scopeCounts(
  ids: string[],
  kind: ScopeKind,
  profiles: ScopedProfile[],
  activeId: string | null,
): ScopeCounts {
  const active = profiles.find((p) => p.id === activeId);
  let mine = 0;
  let unfiled = 0;
  for (const id of ids) {
    if (isMember(active, kind, id)) mine += 1;
    else if (!isClaimed(profiles, kind, id)) unfiled += 1;
  }
  return { total: ids.length, mine, unfiled, hidden: ids.length - mine - unfiled };
}

/**
 * Drop claims on artefacts that no longer exist.
 *
 * Deleting a connection does not know about the profiles that claimed it, so
 * claims accumulate as dangling ids. Harmless to filtering, but they make a
 * profile's counts lie.
 */
export function pruneMembers(members: ScopeMembers | undefined, existing: Partial<Record<ScopeKind, string[]>>): ScopeMembers {
  const out: ScopeMembers = {};
  for (const kind of SCOPE_KINDS) {
    const claimed = members?.[kind];
    if (!claimed) continue;
    const alive = existing[kind];
    // A kind with no supplied list is one the caller could not enumerate; leave it alone.
    const kept = alive ? claimed.filter((id) => alive.includes(id)) : claimed;
    if (kept.length) out[kind] = kept;
  }
  return out;
}

/** Total claims across every kind, for a profile summary line. */
export function totalClaims(profile: ScopedProfile): number {
  return SCOPE_KINDS.reduce((n, kind) => n + membersOf(profile, kind).length, 0);
}
