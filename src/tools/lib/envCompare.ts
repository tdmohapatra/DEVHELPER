import type { Environment, EnvConnection } from "./apiTypes";

export type DiffState = "added" | "removed" | "changed" | "same";

export interface VarDiff {
  key: string;
  a?: string;
  b?: string;
  state: DiffState;
  secret: boolean;
}

export interface ConnDiff {
  name: string;
  kind: string;
  state: DiffState;
}

// Keys whose values are likely sensitive and should be masked in the UI.
const SECRET_RE = /(pass|pwd|secret|token|apikey|api[-_]?key|connectionstring|conn[-_]?str|private|credential|auth)/i;

export function isSecretKey(key: string): boolean {
  return SECRET_RE.test(key);
}

/** Mask a value, keeping a hint of the ends so you can still tell two secrets apart. */
export function maskValue(v: string): string {
  if (!v) return v;
  if (v.length <= 4) return "••••";
  return `${v.slice(0, 2)}••••${v.slice(-2)}`;
}

function varsMap(env: Environment): Record<string, string> {
  const m: Record<string, string> = {};
  for (const kv of env.variables) if (kv.enabled !== false && kv.key) m[kv.key] = kv.value;
  return m;
}

/** Diff the variables of two environments: added (in B), removed (in A), changed, same. */
export function diffVariables(a: Environment, b: Environment): VarDiff[] {
  return diffVariableMaps(varsMap(a), varsMap(b));
}

/**
 * Diff two already-resolved variable maps.
 *
 * Separate from `diffVariables` because once environments can inherit, the
 * comparison worth seeing is between what each one *resolves to*, not between
 * the handful of values each happens to declare itself.
 */
export function diffVariableMaps(ma: Record<string, string>, mb: Record<string, string>): VarDiff[] {
  const keys = [...new Set([...Object.keys(ma), ...Object.keys(mb)])].sort();
  return keys.map((key) => {
    const inA = key in ma;
    const inB = key in mb;
    let state: DiffState;
    if (inA && !inB) state = "removed";
    else if (!inA && inB) state = "added";
    else if (ma[key] !== mb[key]) state = "changed";
    else state = "same";
    return { key, a: ma[key], b: mb[key], state, secret: isSecretKey(key) };
  });
}

const connKey = (c: EnvConnection) => `${c.kind}:${c.name}`;

/** Diff the connection references of two environments by kind + name. */
export function diffConnections(a: Environment, b: Environment): ConnDiff[] {
  const ma = new Map((a.connections ?? []).map((c) => [connKey(c), c]));
  const mb = new Map((b.connections ?? []).map((c) => [connKey(c), c]));
  const keys = [...new Set([...ma.keys(), ...mb.keys()])].sort();
  return keys.map((k) => {
    const av = ma.get(k);
    const bv = mb.get(k);
    let state: DiffState;
    if (av && !bv) state = "removed";
    else if (!av && bv) state = "added";
    else state = JSON.stringify(av?.fields) !== JSON.stringify(bv?.fields) ? "changed" : "same";
    const c = (av ?? bv)!;
    return { name: c.name, kind: c.kind, state };
  });
}

export interface DiffCounts { added: number; removed: number; changed: number; same: number }

export function countStates(rows: { state: DiffState }[]): DiffCounts {
  return {
    added: rows.filter((r) => r.state === "added").length,
    removed: rows.filter((r) => r.state === "removed").length,
    changed: rows.filter((r) => r.state === "changed").length,
    same: rows.filter((r) => r.state === "same").length,
  };
}
