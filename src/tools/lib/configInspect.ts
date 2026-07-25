import { isSecretKey } from "./envCompare";

/**
 * Flatten a nested config object (e.g. appsettings.json) into dotted keys using the
 * .NET ":" section separator. Arrays use numeric indices. Empty containers are preserved
 * as "{}" / "[]" so structure differences still show up.
 */
export function flatten(value: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (v: unknown, key: string) => {
    if (v === null) {
      out[key] = "null";
      return;
    }
    if (Array.isArray(v)) {
      if (v.length === 0) { out[key] = "[]"; return; }
      v.forEach((x, i) => walk(x, key ? `${key}:${i}` : String(i)));
      return;
    }
    if (typeof v === "object") {
      const keys = Object.keys(v as object);
      if (keys.length === 0) { out[key] = "{}"; return; }
      for (const k of keys) walk((v as Record<string, unknown>)[k], key ? `${key}:${k}` : k);
      return;
    }
    out[key] = typeof v === "string" ? v : String(v);
  };
  walk(value, prefix);
  return out;
}

export interface ParsedConfig {
  ok: boolean;
  flat: Record<string, string>;
  error?: string;
}

/** Parse config JSON text and flatten it. Never throws. */
export function parseConfig(text: string): ParsedConfig {
  if (!text.trim()) return { ok: false, flat: {}, error: "empty" };
  try {
    return { ok: true, flat: flatten(JSON.parse(text)) };
  } catch (e) {
    return { ok: false, flat: {}, error: (e as Error).message };
  }
}

export type ConfigState = "same" | "changed" | "partial";

export interface ConfigRow {
  key: string;
  /** value in each config, in input order; undefined = key missing there */
  values: (string | undefined)[];
  state: ConfigState;
  secret: boolean;
}

/** Diff N flattened configs into per-key rows with a same/changed/partial state. */
export function diffConfigs(flats: Record<string, string>[]): ConfigRow[] {
  const keys = [...new Set(flats.flatMap((f) => Object.keys(f)))].sort();
  return keys.map((key) => {
    const values = flats.map((f) => (key in f ? f[key] : undefined));
    const present = values.filter((v): v is string => v !== undefined);
    let state: ConfigState;
    if (flats.length <= 1) state = "same";
    else if (present.length < flats.length) state = "partial";
    else state = present.every((v) => v === present[0]) ? "same" : "changed";
    return { key, values, state, secret: isSecretKey(key) };
  });
}

export interface ConfigCounts { same: number; changed: number; partial: number }

export function countConfigStates(rows: ConfigRow[]): ConfigCounts {
  return {
    same: rows.filter((r) => r.state === "same").length,
    changed: rows.filter((r) => r.state === "changed").length,
    partial: rows.filter((r) => r.state === "partial").length,
  };
}
