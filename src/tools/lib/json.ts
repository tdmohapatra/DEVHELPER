/** Pure JSON helpers used by the Data & Code tools. No React, fully testable. */

export interface JsonValidation {
  valid: boolean;
  error?: string;
}

export function validateJson(input: string): JsonValidation {
  if (!input.trim()) return { valid: false, error: "Input is empty" };
  try {
    JSON.parse(input);
    return { valid: true };
  } catch (e) {
    return { valid: false, error: (e as Error).message };
  }
}

export function formatJson(input: string, indent = 2): string {
  return JSON.stringify(JSON.parse(input), null, indent);
}

export function minifyJson(input: string): string {
  return JSON.stringify(JSON.parse(input));
}

/** Recursively sort object keys for stable output / diffing. */
export function sortJsonKeys(input: string, indent = 2): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") {
      return Object.keys(v as object)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = sort((v as Record<string, unknown>)[k]);
          return acc;
        }, {});
    }
    return v;
  };
  return JSON.stringify(sort(JSON.parse(input)), null, indent);
}

// ---- Structural diff -------------------------------------------------------

export type DiffKind = "added" | "removed" | "changed" | "unchanged";
export interface DiffEntry {
  path: string;
  kind: DiffKind;
  left?: unknown;
  right?: unknown;
}

/** Deep diff of two parsed JSON values, keyed by dotted path. */
export function diffJson(leftText: string, rightText: string): DiffEntry[] {
  const left = JSON.parse(leftText);
  const right = JSON.parse(rightText);
  const entries: DiffEntry[] = [];

  const walk = (a: unknown, b: unknown, path: string) => {
    const aMissing = a === undefined;
    const bMissing = b === undefined;
    if (aMissing && !bMissing) return entries.push({ path, kind: "added", right: b });
    if (!aMissing && bMissing) return entries.push({ path, kind: "removed", left: a });

    const bothObjects =
      a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) === !Array.isArray(b);

    if (bothObjects && !Array.isArray(a)) {
      const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
      for (const k of keys) {
        walk(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
          path ? `${path}.${k}` : k,
        );
      }
      return;
    }

    if (JSON.stringify(a) === JSON.stringify(b)) {
      entries.push({ path, kind: "unchanged", left: a, right: b });
    } else {
      entries.push({ path, kind: "changed", left: a, right: b });
    }
  };

  walk(left, right, "");
  return entries;
}

// ---- JSON -> C# ------------------------------------------------------------

export interface CSharpOptions {
  rootName: string;
  useRecords: boolean;
  nullableRefs: boolean;
  useRequired: boolean;
  framework: "SystemTextJson" | "Newtonsoft";
}

export const DEFAULT_CSHARP_OPTIONS: CSharpOptions = {
  rootName: "Root",
  useRecords: false,
  nullableRefs: true,
  useRequired: false,
  framework: "SystemTextJson",
};

interface CSharpClass {
  name: string;
  props: { name: string; jsonName: string; type: string }[];
}

function pascalCase(s: string): string {
  const parts = s.replace(/[^a-zA-Z0-9]+/g, " ").trim().split(/\s+/);
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("") || "Item";
}

function singularize(s: string): string {
  if (s.endsWith("ies")) return s.slice(0, -3) + "y";
  if (s.endsWith("s") && !s.endsWith("ss")) return s.slice(0, -1);
  return s;
}

/** Generate C# classes/records from a JSON sample. */
export function jsonToCSharp(input: string, opts: CSharpOptions): string {
  const root = JSON.parse(input);
  const classes: CSharpClass[] = [];
  const seen = new Set<string>();

  const uniqueName = (base: string): string => {
    let name = pascalCase(base);
    let i = 1;
    while (seen.has(name)) name = `${pascalCase(base)}${++i}`;
    seen.add(name);
    return name;
  };

  const typeOf = (value: unknown, keyHint: string): string => {
    if (value === null) return opts.nullableRefs ? "object?" : "object";
    if (Array.isArray(value)) {
      if (value.length === 0) return "List<object>";
      const inner = typeOf(value[0], singularize(keyHint));
      return `List<${inner}>`;
    }
    switch (typeof value) {
      case "string":
        return "string";
      case "boolean":
        return "bool";
      case "number":
        return Number.isInteger(value) ? "long" : "double";
      case "object":
        return buildClass(value as Record<string, unknown>, keyHint);
      default:
        return "object";
    }
  };

  const buildClass = (obj: Record<string, unknown>, keyHint: string): string => {
    const name = uniqueName(keyHint);
    const cls: CSharpClass = { name, props: [] };
    for (const [key, val] of Object.entries(obj)) {
      cls.props.push({ name: pascalCase(key), jsonName: key, type: typeOf(val, key) });
    }
    classes.push(cls);
    return name;
  };

  buildClass(typeof root === "object" && root && !Array.isArray(root) ? root : { value: root }, opts.rootName);

  const attr = (jsonName: string) =>
    opts.framework === "SystemTextJson"
      ? `    [JsonPropertyName("${jsonName}")]`
      : `    [JsonProperty("${jsonName}")]`;

  const usings =
    opts.framework === "SystemTextJson"
      ? "using System.Collections.Generic;\nusing System.Text.Json.Serialization;\n\n"
      : "using System.Collections.Generic;\nusing Newtonsoft.Json;\n\n";

  const body = classes
    .reverse()
    .map((cls) => {
      const keyword = opts.useRecords ? "public record" : "public class";
      const lines = cls.props.map((p) => {
        const req = opts.useRequired ? "required " : "";
        return `${attr(p.jsonName)}\n    public ${req}${p.type} ${p.name} { get; set; }`;
      });
      return `${keyword} ${cls.name}\n{\n${lines.join("\n\n")}\n}`;
    })
    .join("\n\n");

  return usings + body + "\n";
}
