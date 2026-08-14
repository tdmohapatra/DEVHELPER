/**
 * Backing up everything DevHelper has ever saved for you.
 *
 * Every store persists through zustand into localStorage, which in the desktop
 * build is WebView2's storage: not a file you can copy, not something a backup
 * tool sees, and gone if the webview data directory is reset. Collections,
 * environments, database connections, snippets, debug sessions and interview
 * progress all live there. That is a lot of accumulated work with no way out.
 *
 * This module is the way out: one versioned JSON document containing every
 * store, and a restore that puts them back. It works at the storage layer
 * rather than through each store's API deliberately — a backup that has to be
 * taught about every new store is a backup that silently stops being complete.
 *
 * Secrets get the same treatment as the environment export: an explicit
 * decision, and a redacted backup still restores the structure.
 */

export const WORKSPACE_KIND = "devhelper.workspace";
export const WORKSPACE_VERSION = 1;

/**
 * The app's own version.
 *
 * Stamped into a backup so a file found later can be matched against the build
 * that wrote it. Kept here rather than read from package.json because the
 * frontend bundle has no reader for it, and a wrong number in a backup is worse
 * than an explicit one.
 */
export const APP_VERSION = "0.2.1";

export interface StoreSpec {
  /** localStorage key. */
  key: string;
  label: string;
  /** What a user would lose with this one. */
  describes: string;
  /**
   * Dotted paths inside the persisted `state` object holding secrets.
   * A trailing `[]` means "every element of this array".
   */
  secretPaths?: string[];
}

/**
 * Every store DevHelper persists.
 *
 * Kept as data rather than discovered at runtime so a backup is reviewable:
 * you can see what is in it without running it, and adding a store is a
 * one-line change that fails review if it is forgotten.
 */
export const STORES: StoreSpec[] = [
  { key: "devhelper-api", label: "API", describes: "requests, folders, environments and history" },
  { key: "devhelper-db", label: "Database", describes: "saved connections (passwords were never persisted)" },
  { key: "devhelper-debug", label: "Debug sessions", describes: "captured timelines" },
  { key: "devhelper-snippets", label: "Snippets", describes: "saved code snippets and tags" },
  { key: "devhelper-notes", label: "Notes", describes: "notes, their tags and their local history" },
  { key: "devhelper-projects", label: "Projects", describes: "project profiles and notes" },
  { key: "devhelper-learn", label: "Interview prep", describes: "revision progress and bookmarks" },
  { key: "devhelper-app", label: "App", describes: "theme, favorites and recents" },
  { key: "devhelper-sound", label: "Sound", describes: "audio cue preferences" },
  {
    key: "devhelper-ai",
    label: "AI",
    describes: "provider, model and API key",
    secretPaths: ["openaiKey"],
  },
];

export interface WorkspaceFile {
  kind: typeof WORKSPACE_KIND;
  version: number;
  appVersion?: string;
  exportedAt?: string;
  secretsRedacted: boolean;
  /** Raw persisted value per store key. Absent keys were simply never written. */
  stores: Record<string, unknown>;
}

/** Minimal storage surface, so this is testable without a browser. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Blank out a dotted path inside a persisted store value.
 *
 * zustand wraps state as `{ state: {...}, version: n }`, so paths are resolved
 * against `state` when that wrapper is present and against the root when it is
 * not — older or hand-written entries should still redact.
 */
export function redactPath(value: unknown, path: string): unknown {
  if (!value || typeof value !== "object") return value;
  const root = value as Record<string, unknown>;
  const wrapped = root.state && typeof root.state === "object";
  const target = wrapped ? { ...(root.state as Record<string, unknown>) } : { ...root };

  const segments = path.split(".");
  const last = segments.pop()!;
  let cursor: Record<string, unknown> = target;
  for (const segment of segments) {
    const next = cursor[segment];
    if (!next || typeof next !== "object") return value; // path does not exist; nothing to hide
    cursor[segment] = Array.isArray(next) ? [...next] : { ...(next as Record<string, unknown>) };
    cursor = cursor[segment] as Record<string, unknown>;
  }
  if (last in cursor) cursor[last] = "";

  return wrapped ? { ...root, state: target } : target;
}

function redactStore(value: unknown, spec: StoreSpec): unknown {
  return (spec.secretPaths ?? []).reduce((acc, path) => redactPath(acc, path), value);
}

/** Store keys that currently hold something. */
export function presentStores(storage: StorageLike, specs: StoreSpec[] = STORES): StoreSpec[] {
  return specs.filter((s) => storage.getItem(s.key) !== null);
}

/** Which stores in the backup would carry a secret value if included. */
export function storesWithSecrets(specs: StoreSpec[] = STORES): StoreSpec[] {
  return specs.filter((s) => (s.secretPaths ?? []).length > 0);
}

export interface ExportOptions {
  includeSecrets?: boolean;
  appVersion?: string;
  /** Passed in rather than read from the clock, so this stays pure. */
  exportedAt?: string;
  /** Subset of store keys to include. Defaults to all present. */
  only?: string[];
}

/** Collect every persisted store into one document. */
export function exportWorkspace(storage: StorageLike, options: ExportOptions = {}): string {
  const includeSecrets = options.includeSecrets === true;
  const wanted = options.only ? STORES.filter((s) => options.only!.includes(s.key)) : STORES;
  const stores: Record<string, unknown> = {};

  for (const spec of wanted) {
    const raw = storage.getItem(spec.key);
    if (raw === null) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Unparseable is still worth carrying: restoring it byte-for-byte is
      // closer to correct than dropping whatever it was.
      parsed = raw;
    }
    stores[spec.key] = includeSecrets ? parsed : redactStore(parsed, spec);
  }

  const file: WorkspaceFile = {
    kind: WORKSPACE_KIND,
    version: WORKSPACE_VERSION,
    appVersion: options.appVersion,
    exportedAt: options.exportedAt,
    secretsRedacted: !includeSecrets,
    stores,
  };
  return JSON.stringify(file, null, 2);
}

export interface ParsedWorkspace {
  stores: Record<string, unknown>;
  /** Store keys the file carries that this build recognises. */
  known: StoreSpec[];
  /** Keys in the file that this build has no store for. */
  unknownKeys: string[];
  secretsRedacted: boolean;
  appVersion?: string;
  exportedAt?: string;
  problems: string[];
}

/** Read a workspace file, describing anything wrong rather than throwing. */
export function parseWorkspace(text: string): ParsedWorkspace {
  const empty: ParsedWorkspace = {
    stores: {},
    known: [],
    unknownKeys: [],
    secretsRedacted: false,
    problems: [],
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ...empty, problems: [`Not valid JSON: ${(e as Error).message}`] };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ...empty, problems: ["File is not a workspace document."] };
  }

  const file = parsed as Record<string, unknown>;
  const problems: string[] = [];
  if (file.kind !== undefined && file.kind !== WORKSPACE_KIND) {
    problems.push(`Unexpected file kind "${String(file.kind)}" — expected ${WORKSPACE_KIND}.`);
  }
  if (typeof file.version === "number" && file.version > WORKSPACE_VERSION) {
    problems.push(`File version ${file.version} is newer than this build understands (${WORKSPACE_VERSION}).`);
  }
  if (!file.stores || typeof file.stores !== "object") {
    return { ...empty, problems: [...problems, "No stores in the file."] };
  }

  const stores = file.stores as Record<string, unknown>;
  const knownKeys = new Set(STORES.map((s) => s.key));
  const unknownKeys = Object.keys(stores).filter((k) => !knownKeys.has(k));
  if (unknownKeys.length) {
    problems.push(`${unknownKeys.length} store(s) in the file are not part of this build and will be skipped: ${unknownKeys.join(", ")}.`);
  }

  return {
    stores,
    known: STORES.filter((s) => s.key in stores),
    unknownKeys,
    secretsRedacted: file.secretsRedacted === true,
    appVersion: typeof file.appVersion === "string" ? file.appVersion : undefined,
    exportedAt: typeof file.exportedAt === "string" ? file.exportedAt : undefined,
    problems,
  };
}

export interface RestoreResult {
  restored: string[];
  skipped: string[];
}

/**
 * Write a parsed workspace back into storage.
 *
 * Whole-store replacement, not a merge. A half-merged store is a state neither
 * document describes, and the failure mode — a collection that is partly the
 * backup and partly what was there — is worse than losing one of the two.
 * Callers confirm first; restoring is not reversible from inside the app.
 */
export function restoreWorkspace(
  storage: StorageLike,
  parsed: ParsedWorkspace,
  only?: string[],
): RestoreResult {
  const result: RestoreResult = { restored: [], skipped: [] };
  for (const spec of parsed.known) {
    if (only && !only.includes(spec.key)) {
      result.skipped.push(spec.key);
      continue;
    }
    const value = parsed.stores[spec.key];
    storage.setItem(spec.key, typeof value === "string" ? value : JSON.stringify(value));
    result.restored.push(spec.key);
  }
  return result;
}

/** Remove every DevHelper store. Returns the keys that actually existed. */
export function clearWorkspace(storage: StorageLike, only?: string[]): string[] {
  const cleared: string[] = [];
  for (const spec of STORES) {
    if (only && !only.includes(spec.key)) continue;
    if (storage.getItem(spec.key) === null) continue;
    storage.removeItem(spec.key);
    cleared.push(spec.key);
  }
  return cleared;
}

/** Rough size of what is stored, for showing what a backup will contain. */
export function storageFootprint(storage: StorageLike, specs: StoreSpec[] = STORES): { key: string; bytes: number }[] {
  return specs
    .map((s) => ({ key: s.key, bytes: (storage.getItem(s.key) ?? "").length }))
    .filter((r) => r.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes);
}

/** Byte counts as a human string. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}
