/**
 * Resolving what an environment's variables actually are.
 *
 * Environments repeat themselves: QA and UAT usually differ in three values and
 * agree on twenty. Inheritance lets the twenty live once, in a base environment,
 * and lets each child override only what differs — which also makes the Compare
 * view meaningful, because a difference is then something someone chose rather
 * than something someone forgot to copy.
 *
 * Every function here is cycle-safe. A chain built through a UI can always be
 * made circular by a determined user, and a resolver that recurses into one
 * hangs the app rather than reporting a mistake.
 */

import type { Environment, KeyValue } from "./apiTypes";
import { usedVariables } from "./interpolate";

/** The environments an id resolves through, base first, self last. */
export function inheritanceChain(env: Environment, all: Environment[]): Environment[] {
  const byId = new Map(all.map((e) => [e.id, e]));
  const chain: Environment[] = [];
  const seen = new Set<string>();
  let current: Environment | undefined = env;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(current);
    current = current.extendsId ? byId.get(current.extendsId) : undefined;
  }
  return chain;
}

/** Enabled, named variables of one environment as a plain map. */
export function ownVariables(env: Environment): Record<string, string> {
  const out: Record<string, string> = {};
  for (const kv of env.variables) if (kv.enabled !== false && kv.key) out[kv.key] = kv.value;
  return out;
}

/**
 * The variable map an environment resolves to, parents applied first.
 *
 * A child's own value wins, including when it is empty — "" is a deliberate
 * override of an inherited value, not an absence.
 */
export function resolveVariables(env: Environment, all: Environment[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const link of inheritanceChain(env, all)) Object.assign(out, ownVariables(link));
  return out;
}

export type VarOrigin = "own" | "inherited" | "override";

export interface ResolvedVar {
  key: string;
  value: string;
  /** Name of the environment the winning value came from. */
  source: string;
  origin: VarOrigin;
  /** The value this one shadows, when it overrides an inherited one. */
  shadows?: string;
}

/**
 * Every variable visible to an environment, with where each value came from.
 *
 * This is what makes inheritance safe to use: without it, an environment that
 * inherits twenty values looks empty, and nobody can tell an override from a
 * coincidence.
 */
export function resolvedVariables(env: Environment, all: Environment[]): ResolvedVar[] {
  const chain = inheritanceChain(env, all);
  const rows = new Map<string, ResolvedVar>();
  for (const link of chain) {
    const isSelf = link.id === env.id;
    for (const [key, value] of Object.entries(ownVariables(link))) {
      const prior = rows.get(key);
      rows.set(key, {
        key,
        value,
        source: link.name,
        origin: isSelf ? (prior ? "override" : "own") : "inherited",
        shadows: prior ? prior.value : undefined,
      });
    }
  }
  return [...rows.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Would making `parentId` the parent of `childId` create a cycle?
 *
 * Selecting yourself counts: an environment that inherits from itself resolves
 * to nothing useful and is never what was meant.
 */
export function wouldCycle(childId: string, parentId: string, all: Environment[]): boolean {
  if (childId === parentId) return true;
  const byId = new Map(all.map((e) => [e.id, e]));
  const seen = new Set<string>([childId]);
  let current = byId.get(parentId);
  while (current) {
    if (seen.has(current.id)) return true;
    seen.add(current.id);
    current = current.extendsId ? byId.get(current.extendsId) : undefined;
  }
  return false;
}

/** Environments that may legally be chosen as this one's parent. */
export function eligibleParents(env: Environment, all: Environment[]): Environment[] {
  return all.filter((candidate) => !wouldCycle(env.id, candidate.id, all));
}

/**
 * Variable names referenced by these strings that the map does not define.
 *
 * The failure this catches is a request that silently sends the literal text
 * `{{TOKEN}}` as its auth header because the variable was never defined in the
 * environment that happens to be active.
 */
export function missingVariables(texts: string[], vars: Record<string, string>): string[] {
  const missing = new Set<string>();
  for (const text of texts) {
    for (const name of usedVariables(text ?? "")) {
      if (!Object.prototype.hasOwnProperty.call(vars, name)) missing.add(name);
    }
  }
  return [...missing].sort();
}

/** Variables defined by an environment that nothing in these strings references. */
export function unusedVariables(texts: string[], vars: Record<string, string>): string[] {
  const used = new Set(texts.flatMap((t) => usedVariables(t ?? "")));
  return Object.keys(vars).filter((k) => !used.has(k)).sort();
}

/**
 * A variable whose value references another variable.
 *
 * Chains like `BASE_URL={{HOST}}/api` are convenient and are resolved by the
 * interpolator at send time, but only one level deep and only if `HOST` is also
 * defined — so a broken one is worth naming before a request goes out.
 */
export function danglingReferences(vars: Record<string, string>): { key: string; missing: string[] }[] {
  const out: { key: string; missing: string[] }[] = [];
  for (const [key, value] of Object.entries(vars)) {
    const missing = usedVariables(value).filter((n) => !Object.prototype.hasOwnProperty.call(vars, n));
    if (missing.length) out.push({ key, missing });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Turn a resolved map back into editable rows, for "flatten this environment".
 *
 * Ids default to the variable name, which is already unique within a map and is
 * stable across a re-render — a fresh random id per call would make the editor
 * lose focus on every keystroke.
 */
export function toKeyValues(vars: Record<string, string>, makeId: (key: string) => string = (k) => k): KeyValue[] {
  return Object.entries(vars)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({ id: makeId(key), key, value, enabled: true }));
}
