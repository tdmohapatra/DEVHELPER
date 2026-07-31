/** Pure JSON helpers used by the Data & Code tools. No React, fully testable. */

export interface JsonValidation {
  valid: boolean;
  error?: string;
}

// ---- Lenient parsing -------------------------------------------------------

/**
 * Remove `//` and block comments plus trailing commas, so config-style documents
 * (appsettings.json, tsconfig.json) can be parsed by the strict JSON.parse.
 * String literals are scanned so their contents are never touched.
 */
export function stripJsonComments(input: string): string {
  let out = "";
  let i = 0;
  while (i < input.length) {
    const c = input[i];

    if (c === '"') {
      out += c;
      i++;
      while (i < input.length) {
        out += input[i];
        if (input[i] === "\\") {
          i++;
          if (i < input.length) out += input[i];
          i++;
          continue;
        }
        if (input[i] === '"') {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    if (c === "/" && input[i + 1] === "/") {
      while (i < input.length && input[i] !== "\n") i++;
      continue;
    }

    if (c === "/" && input[i + 1] === "*") {
      i += 2;
      while (i < input.length && !(input[i] === "*" && input[i + 1] === "/")) i++;
      i += 2;
      continue;
    }

    out += c;
    i++;
  }

  // Drop commas that sit directly before a closing brace/bracket.
  return out.replace(/,(\s*[}\]])/g, "$1");
}

/** Parse JSON, tolerating comments and trailing commas. */
export function parseJsonLoose(input: string): unknown {
  return JSON.parse(stripJsonComments(input));
}

const parseWith = (input: string, loose: boolean): unknown =>
  loose ? parseJsonLoose(input) : JSON.parse(input);

export function validateJson(input: string, loose = false): JsonValidation {
  if (!input.trim()) return { valid: false, error: "Input is empty" };
  try {
    parseWith(input, loose);
    return { valid: true };
  } catch (e) {
    return { valid: false, error: (e as Error).message };
  }
}

export function formatJson(input: string, indent = 2, loose = false): string {
  return JSON.stringify(parseWith(input, loose), null, indent);
}

export function minifyJson(input: string, loose = false): string {
  return JSON.stringify(parseWith(input, loose));
}

// ---- Escaped-string helpers ------------------------------------------------

/**
 * Turn an escaped JSON string literal into its raw text — the common case of a
 * log/DB field holding `{\"a\":1}`. Surrounding quotes are optional.
 */
export function unescapeJsonString(input: string): string {
  const text = input.trim();
  if (!text) throw new Error("Input is empty");
  if (text.startsWith('"') && text.endsWith('"') && text.length > 1) {
    const parsed = JSON.parse(text);
    if (typeof parsed !== "string") throw new Error("Not a JSON string literal");
    return parsed;
  }
  return JSON.parse(`"${text}"`) as string;
}

/** Wrap raw text as an escaped JSON string literal, quotes included. */
export function escapeJsonString(input: string): string {
  return JSON.stringify(input);
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

// ---- Tree model ------------------------------------------------------------

export type JsonKind = "object" | "array" | "string" | "number" | "boolean" | "null";

export interface JsonChild {
  /** Property name, or the index as a string for array elements. */
  key: string;
  value: unknown;
  /** JSONPath of the child, e.g. `$.items[0].name`. */
  path: string;
}

export function valueKind(v: unknown): JsonKind {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  const t = typeof v;
  if (t === "object") return "object";
  if (t === "number") return "number";
  if (t === "boolean") return "boolean";
  return "string";
}

/** `.key` when the name is a plain identifier, `['key']` otherwise. */
export function appendPath(parent: string, key: string, isIndex: boolean): string {
  if (isIndex) return `${parent}[${key}]`;
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `${parent}.${key}` : `${parent}['${key}']`;
}

/** Direct children of a container, already carrying their JSONPath. */
export function childEntries(value: unknown, path: string): JsonChild[] {
  if (Array.isArray(value)) {
    return value.map((v, i) => ({ key: String(i), value: v, path: appendPath(path, String(i), true) }));
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).map(([k, v]) => ({
      key: k,
      value: v,
      path: appendPath(path, k, false),
    }));
  }
  return [];
}

/** One-line summary shown next to a collapsed node or a leaf value. */
export function previewValue(v: unknown, maxLen = 60): string {
  const kind = valueKind(v);
  if (kind === "array") {
    const n = (v as unknown[]).length;
    return `[] ${n} item${n === 1 ? "" : "s"}`;
  }
  if (kind === "object") {
    const n = Object.keys(v as object).length;
    return `{} ${n} key${n === 1 ? "" : "s"}`;
  }
  const text = JSON.stringify(v) ?? "undefined";
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
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
