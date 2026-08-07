/**
 * Making your own saved work findable from the command palette.
 *
 * The palette searches the 41 tools. It cannot find the request you saved last
 * week, the connection you named "prod-readonly", or the snippet you wrote so
 * you would not have to remember the command again. Those are the things you
 * actually go looking for, and finding them currently means opening the right
 * tool first and then searching inside it — which requires already knowing
 * which tool it was in.
 *
 * This module flattens every saved artefact into one searchable list. It takes
 * plain data rather than reading the stores itself, so it can be tested without
 * a browser, and the palette supplies the action that opens each result.
 */

import { fuzzyMatch } from "./fuzzy";

export type ArtifactKind =
  | "request"
  | "environment"
  | "connection"
  | "snippet"
  | "session"
  | "project";

export interface ArtifactEntry {
  /** Unique across kinds — the palette uses it as a React key. */
  id: string;
  kind: ArtifactKind;
  /** The artefact's own id, for whatever opens it. */
  refId: string;
  name: string;
  /** Secondary line: enough to tell two similarly-named things apart. */
  detail: string;
  /** Tool this artefact belongs to. */
  toolId: string;
  /** Extra text to match against that is not worth displaying. */
  keywords: string[];
}

export const KIND_LABEL: Record<ArtifactKind, string> = {
  request: "Request",
  environment: "Environment",
  connection: "Connection",
  snippet: "Snippet",
  session: "Debug session",
  project: "Project",
};

/** The minimum each source has to supply. Kept structural so stores stay decoupled. */
export interface ArtifactSources {
  requests?: { id: string; name: string; method?: string; url?: string }[];
  environments?: { id: string; name: string; isProduction?: boolean; variables?: unknown[] }[];
  connections?: { id: string; name: string; engine?: string; host?: string; database?: string; filePath?: string }[];
  snippets?: { id: string; title: string; language?: string; tags?: string[]; favorite?: boolean }[];
  sessions?: { id: string; name: string; events?: unknown[] }[];
  projects?: { id: string; name: string; technologies?: string[] }[];
}

/** Where a saved database connection points, in one line. */
function connectionTarget(c: NonNullable<ArtifactSources["connections"]>[number]): string {
  if (c.filePath) return c.filePath;
  const host = c.host ?? "";
  return c.database ? `${host}/${c.database}` : host;
}

/** Flatten every saved artefact into one list. */
export function buildArtifactIndex(sources: ArtifactSources): ArtifactEntry[] {
  const entries: ArtifactEntry[] = [];

  for (const r of sources.requests ?? []) {
    entries.push({
      id: `request:${r.id}`,
      kind: "request",
      refId: r.id,
      name: r.name,
      detail: [r.method, r.url].filter(Boolean).join(" ") || "no URL",
      toolId: "api-tester",
      keywords: [r.method ?? "", r.url ?? ""].filter(Boolean),
    });
  }

  for (const e of sources.environments ?? []) {
    entries.push({
      id: `environment:${e.id}`,
      kind: "environment",
      refId: e.id,
      name: e.name,
      detail: `${e.variables?.length ?? 0} variable(s)${e.isProduction ? " · PRODUCTION" : ""}`,
      toolId: "environments",
      keywords: e.isProduction ? ["production", "prod"] : [],
    });
  }

  for (const c of sources.connections ?? []) {
    entries.push({
      id: `connection:${c.id}`,
      kind: "connection",
      refId: c.id,
      name: c.name,
      detail: [c.engine, connectionTarget(c)].filter(Boolean).join(" · "),
      toolId: "database-toolkit",
      keywords: [c.engine ?? "", c.host ?? "", c.database ?? ""].filter(Boolean),
    });
  }

  for (const s of sources.snippets ?? []) {
    entries.push({
      id: `snippet:${s.id}`,
      kind: "snippet",
      refId: s.id,
      name: s.title,
      detail: [s.language, (s.tags ?? []).join(", ")].filter(Boolean).join(" · "),
      toolId: "snippet-library",
      keywords: [s.language ?? "", ...(s.tags ?? [])].filter(Boolean),
    });
  }

  for (const s of sources.sessions ?? []) {
    entries.push({
      id: `session:${s.id}`,
      kind: "session",
      refId: s.id,
      name: s.name,
      detail: `${s.events?.length ?? 0} event(s)`,
      toolId: "debug-session",
      keywords: [],
    });
  }

  for (const p of sources.projects ?? []) {
    entries.push({
      id: `project:${p.id}`,
      kind: "project",
      refId: p.id,
      name: p.name,
      detail: (p.technologies ?? []).join(", ") || "no stack recorded",
      toolId: "project-profiles",
      keywords: p.technologies ?? [],
    });
  }

  return entries;
}

export interface ScoredArtifact extends ArtifactEntry {
  score: number;
  /** Matched character positions in `name`, for highlighting. */
  positions: number[];
}

/**
 * Rank artefacts against a query.
 *
 * A name match outranks a detail or keyword match by a wide margin: searching
 * "orders" should find the request called "orders" before every request whose
 * URL happens to contain the word. Below that, a keyword hit beats a detail
 * hit, because keywords were chosen and details are incidental.
 */
export function searchArtifacts(entries: ArtifactEntry[], query: string, limit = 8): ScoredArtifact[] {
  const q = query.trim();
  if (!q) return [];

  const scored: ScoredArtifact[] = [];
  for (const entry of entries) {
    const byName = fuzzyMatch(q, entry.name);
    if (byName) {
      scored.push({ ...entry, score: byName.score + 20, positions: byName.positions });
      continue;
    }
    const byKeyword = entry.keywords
      .map((k) => fuzzyMatch(q, k))
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => b.score - a.score)[0];
    if (byKeyword) {
      scored.push({ ...entry, score: byKeyword.score + 8, positions: [] });
      continue;
    }
    const byDetail = fuzzyMatch(q, entry.detail);
    if (byDetail) scored.push({ ...entry, score: byDetail.score, positions: [] });
  }

  return scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)).slice(0, limit);
}

/** How many artefacts of each kind exist, for an empty-state hint. */
export function countByKind(entries: ArtifactEntry[]): Record<ArtifactKind, number> {
  const counts = { request: 0, environment: 0, connection: 0, snippet: 0, session: 0, project: 0 };
  for (const e of entries) counts[e.kind] += 1;
  return counts;
}
