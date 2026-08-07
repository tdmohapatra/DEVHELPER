/**
 * Moving environments between machines.
 *
 * An environment file is the one artefact here that people are likely to email,
 * commit or paste into a ticket, so secrets get an explicit decision rather than
 * a default. Exporting without secrets keeps every key — a redacted file still
 * tells the recipient what has to be filled in, which a file with the keys
 * removed does not.
 *
 * Import is deliberately forgiving about shape and strict about identity:
 * anything that does not look like an environment is reported rather than
 * silently dropped, and an incoming environment never overwrites a local one
 * unless the caller asked for that.
 */

import type { Environment, EnvConnection, KeyValue } from "./apiTypes";
import { isSecretKey } from "./envCompare";

export const ENV_FILE_KIND = "devhelper.environments";
export const ENV_FILE_VERSION = 1;

export interface EnvFile {
  kind: typeof ENV_FILE_KIND;
  version: number;
  exportedAt?: string;
  /** True when secret values were stripped, so an importer can say so. */
  secretsRedacted: boolean;
  environments: Environment[];
}

/** The placeholder a redacted value is replaced with. */
export const REDACTED = "";

/** Strip the values of secret-looking variables, keeping the keys. */
export function redactEnvironment(env: Environment): Environment {
  return {
    ...env,
    variables: env.variables.map((v) => (isSecretKey(v.key) ? { ...v, value: REDACTED } : v)),
  };
}

/** Which variables would lose their value on a redacted export. */
export function secretKeys(env: Environment): string[] {
  return env.variables.filter((v) => v.key && isSecretKey(v.key)).map((v) => v.key);
}

export interface ExportOptions {
  includeSecrets?: boolean;
  /** ISO timestamp; passed in rather than read from the clock so this stays pure. */
  exportedAt?: string;
}

/** Serialize environments to the interchange format. */
export function exportEnvironments(envs: Environment[], options: ExportOptions = {}): string {
  const includeSecrets = options.includeSecrets === true;
  const file: EnvFile = {
    kind: ENV_FILE_KIND,
    version: ENV_FILE_VERSION,
    exportedAt: options.exportedAt,
    secretsRedacted: !includeSecrets,
    environments: includeSecrets ? envs : envs.map(redactEnvironment),
  };
  return JSON.stringify(file, null, 2);
}

function asKeyValues(value: unknown): KeyValue[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is Record<string, unknown> => !!v && typeof v === "object")
    .map((v, i) => ({
      id: typeof v.id === "string" && v.id ? v.id : `v${i}`,
      key: typeof v.key === "string" ? v.key : "",
      value: typeof v.value === "string" ? v.value : String(v.value ?? ""),
      enabled: v.enabled !== false,
    }))
    .filter((v) => v.key !== "");
}

function asConnections(value: unknown): EnvConnection[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
    .map((c, i) => ({
      id: typeof c.id === "string" && c.id ? c.id : `c${i}`,
      kind: String(c.kind ?? "api") as EnvConnection["kind"],
      name: typeof c.name === "string" ? c.name : `connection ${i + 1}`,
      fields:
        c.fields && typeof c.fields === "object"
          ? Object.fromEntries(Object.entries(c.fields as Record<string, unknown>).map(([k, v]) => [k, String(v ?? "")]))
          : {},
    }));
  return out.length ? out : undefined;
}

export interface ParseResult {
  environments: Environment[];
  /** Whether the file said its secrets were stripped. */
  secretsRedacted: boolean;
  /** Entries that could not be read, described rather than dropped. */
  problems: string[];
}

/**
 * Parse an environment file.
 *
 * A bare array of environments is accepted too — that is what someone gets by
 * copying the `environments` key out of the app's own storage, and refusing it
 * would be pedantry.
 */
export function parseEnvironmentsFile(text: string): ParseResult {
  const problems: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { environments: [], secretsRedacted: false, problems: [`Not valid JSON: ${(e as Error).message}`] };
  }

  let raw: unknown[];
  let secretsRedacted = false;
  if (Array.isArray(parsed)) {
    raw = parsed;
  } else if (parsed && typeof parsed === "object") {
    const file = parsed as Record<string, unknown>;
    if (file.kind !== undefined && file.kind !== ENV_FILE_KIND) {
      problems.push(`Unexpected file kind "${String(file.kind)}" — expected ${ENV_FILE_KIND}.`);
    }
    if (typeof file.version === "number" && file.version > ENV_FILE_VERSION) {
      problems.push(`File version ${file.version} is newer than this build understands (${ENV_FILE_VERSION}); unknown fields are ignored.`);
    }
    secretsRedacted = file.secretsRedacted === true;
    raw = Array.isArray(file.environments) ? file.environments : [];
    if (!Array.isArray(file.environments)) problems.push("No environments array in the file.");
  } else {
    return { environments: [], secretsRedacted: false, problems: ["File is not an object or an array."] };
  }

  const environments: Environment[] = [];
  raw.forEach((entry, i) => {
    if (!entry || typeof entry !== "object") {
      problems.push(`Entry ${i + 1} is not an object.`);
      return;
    }
    const e = entry as Record<string, unknown>;
    const name = typeof e.name === "string" && e.name.trim() ? e.name.trim() : "";
    if (!name) {
      problems.push(`Entry ${i + 1} has no name.`);
      return;
    }
    environments.push({
      id: typeof e.id === "string" && e.id ? e.id : `imported-${i}`,
      name,
      isProduction: e.isProduction === true,
      variables: asKeyValues(e.variables),
      connections: asConnections(e.connections),
      extendsId: typeof e.extendsId === "string" && e.extendsId ? e.extendsId : undefined,
    });
  });

  // An inheritance link to an environment that was not in the file is dead weight.
  const ids = new Set(environments.map((e) => e.id));
  for (const env of environments) {
    if (env.extendsId && !ids.has(env.extendsId)) {
      problems.push(`"${env.name}" inherits from an environment that is not in this file; the link was dropped.`);
      env.extendsId = undefined;
    }
  }

  return { environments, secretsRedacted, problems };
}

export type MergeMode = "skip" | "replace" | "rename";

export interface MergeResult {
  environments: Environment[];
  added: string[];
  replaced: string[];
  renamed: string[];
  skipped: string[];
}

/** A name that does not collide with any in `taken`, by suffixing a counter. */
export function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  for (let i = 2; ; i++) {
    const candidate = `${name} (${i})`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Merge imported environments into the existing set, matching on name.
 *
 * Name rather than id: the same environment exported from two machines has two
 * ids and one name, and treating those as different environments is the outcome
 * nobody wants. `skip` keeps what is local, `replace` prefers the file, `rename`
 * keeps both.
 */
export function mergeEnvironments(existing: Environment[], incoming: Environment[], mode: MergeMode): MergeResult {
  const result: MergeResult = { environments: [...existing], added: [], replaced: [], renamed: [], skipped: [] };
  const taken = new Set(existing.map((e) => e.name));
  // Imported ids can collide with local ones; remap so inheritance still points inside the import.
  const idMap = new Map<string, string>();

  for (const env of incoming) {
    const clash = result.environments.find((e) => e.name === env.name);
    if (!clash) {
      const id = freeId(env.id, result.environments);
      idMap.set(env.id, id);
      result.environments.push({ ...env, id });
      result.added.push(env.name);
      taken.add(env.name);
      continue;
    }
    if (mode === "skip") {
      // The local environment stands in for the incoming one when links are rewritten.
      idMap.set(env.id, clash.id);
      result.skipped.push(env.name);
    } else if (mode === "replace") {
      idMap.set(env.id, clash.id);
      result.environments = result.environments.map((e) => (e.id === clash.id ? { ...env, id: clash.id } : e));
      result.replaced.push(env.name);
    } else {
      const name = uniqueName(env.name, taken);
      const id = freeId(env.id, result.environments);
      idMap.set(env.id, id);
      result.environments.push({ ...env, id, name });
      result.renamed.push(name);
      taken.add(name);
    }
  }

  // Rewrite inheritance links onto whatever id each incoming environment ended up with.
  const incomingIds = new Set(incoming.map((e) => e.id));
  result.environments = result.environments.map((e) => {
    if (!e.extendsId || !incomingIds.has(e.extendsId)) return e;
    return { ...e, extendsId: idMap.get(e.extendsId) ?? undefined };
  });

  return result;
}

function freeId(preferred: string, taken: Environment[]): string {
  if (!taken.some((e) => e.id === preferred)) return preferred;
  for (let i = 2; ; i++) {
    const candidate = `${preferred}-${i}`;
    if (!taken.some((e) => e.id === candidate)) return candidate;
  }
}
