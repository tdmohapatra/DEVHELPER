/**
 * Mapping one system's fields onto another's.
 *
 * This is the job that has no tool. Every integration is, underneath, a table
 * saying "their PID-5.1 is our patient.familyName, trimmed and upper-cased" —
 * and that table normally lives in a spreadsheet that drifts from the code, or
 * in the code where nobody but a developer can read it.
 *
 * So the mapping here is **data**, not code. A `Mapping` is a plain object that
 * can be exported, diffed against last release, reviewed by someone who does not
 * write C#, and carried to another environment. Code generation is a projection
 * of it, never the source of truth.
 *
 * Three things follow from that:
 *
 * - **Every rule says where its value came from.** A run produces not just the
 *   output but a trace per field: the source path, the raw value, each transform
 *   step and what it returned. That trace is what you paste into a ticket when
 *   the receiving system says the name is wrong.
 * - **Unmapped is reported in both directions.** Source fields nobody consumes
 *   are usually fine; target fields nobody fills are usually a bug, and the ones
 *   the receiver marked required are certainly one. Neither is visible if you
 *   only look at the output.
 * - **Transforms are a fixed, small vocabulary.** Not expressions, not a
 *   scripting language. Anything a mapping cannot express should be obvious
 *   rather than hidden in a one-line lambda nobody audits.
 */

import { parseHl7 } from "./hl7";
import { getHl7Value } from "./hl7Advanced";

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export type SourceKind = "hl7" | "json" | "csv";

export type TransformKind =
  | "trim"
  | "upper"
  | "lower"
  | "titlecase"
  | "substring"
  | "replace"
  | "split"
  | "pad"
  | "prefix"
  | "suffix"
  | "hl7DateToIso"
  | "isoToHl7Date"
  | "lookup"
  | "digitsOnly";

export interface TransformStep {
  kind: TransformKind;
  /** Meaning depends on the kind; see `applyTransform`. */
  a?: string;
  b?: string;
  /** `lookup` only: the value table, plus whether an unlisted value is an error. */
  table?: Record<string, string>;
  strict?: boolean;
}

export interface MappingRule {
  id: string;
  /** Dotted path in the output, e.g. `patient.name.family`. */
  target: string;
  /** Path in the source. Omitted when the rule is a constant. */
  source?: string;
  /** Used instead of a source path. */
  constant?: string;
  transforms?: TransformStep[];
  /** The receiver rejects the message without this. */
  required?: boolean;
  /** Used when the source is absent or empty. */
  fallback?: string;
  note?: string;
}

export interface Mapping {
  name: string;
  sourceKind: SourceKind;
  /** Free text: which interface, which version, who agreed it. */
  note?: string;
  rules: MappingRule[];
}

export const EMPTY_MAPPING: Mapping = { name: "New mapping", sourceKind: "hl7", rules: [] };

// ---------------------------------------------------------------------------
// Reading a source
// ---------------------------------------------------------------------------

export class SourceError extends Error {}

/**
 * A source document, parsed once and queried many times.
 *
 * Parsing per rule would be quadratic on a message with fifty rules, and for
 * HL7 it would also re-run the segment split for every field.
 */
export interface Source {
  kind: SourceKind;
  /** Every path this document actually contains, for the unmapped report. */
  paths: string[];
  get(path: string): string | undefined;
}

/** Read a value out of a parsed JSON object by dotted path with array indexes. */
export function jsonPath(root: unknown, path: string): unknown {
  const parts = path.split(".").filter(Boolean);
  let node: unknown = root;
  for (const part of parts) {
    if (node === null || node === undefined) return undefined;
    const match = /^(.*?)\[(\d+)\]$/.exec(part);
    if (match) {
      const [, name, index] = match;
      if (name) node = (node as Record<string, unknown>)[name];
      if (!Array.isArray(node)) return undefined;
      node = node[Number(index)];
    } else {
      if (typeof node !== "object") return undefined;
      node = (node as Record<string, unknown>)[part];
    }
  }
  return node;
}

/** Every leaf path in a JSON document, in the notation `jsonPath` accepts. */
export function jsonPaths(root: unknown, prefix = "", out: string[] = []): string[] {
  if (root === null || root === undefined) return out;
  if (Array.isArray(root)) {
    root.forEach((item, i) => jsonPaths(item, `${prefix}[${i}]`, out));
    return out;
  }
  if (typeof root === "object") {
    for (const [key, value] of Object.entries(root as Record<string, unknown>)) {
      jsonPaths(value, prefix ? `${prefix}.${key}` : key, out);
    }
    return out;
  }
  if (prefix) out.push(prefix);
  return out;
}

/**
 * Split one CSV line.
 *
 * Written out rather than split(",") because a name field is exactly where a
 * comma inside quotes turns up, and getting it wrong shifts every column after
 * it — which looks like a mapping bug for the rest of the afternoon.
 */
export function csvLine(line: string): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cell);
      cell = "";
    } else cell += c;
  }
  out.push(cell);
  return out;
}

/** Parse a document into something the mapper can query. */
export function readSource(kind: SourceKind, text: string): Source {
  if (kind === "hl7") {
    let message;
    try {
      message = parseHl7(text);
    } catch (e) {
      // `parseHl7` requires MSH, and the commonest paste is a bare segment out
      // of a log. Say that, rather than repeating the parser's error.
      throw new SourceError(
        `${(e as Error).message}. A mapping needs a whole message: paste from the MSH line down, not just the segment that failed.`,
      );
    }
    const paths: string[] = [];
    for (const segment of message.segments) {
      segment.fields.forEach((field, i) => {
        if (!field.value.trim()) return;
        const base = `${segment.name}-${i + 1}`;
        paths.push(base);
        // Components only when there are some; PID-5.1 is a path, PID-8.1 is noise.
        if (field.components.length > 1) {
          field.components.forEach((component, j) => component.trim() && paths.push(`${base}.${j + 1}`));
        }
      });
    }
    return {
      kind,
      paths,
      get: (path) => {
        const value = getHl7Value(message, path);
        return value === undefined || value === "" ? undefined : value;
      },
    };
  }

  if (kind === "json") {
    let root: unknown;
    try {
      root = JSON.parse(text);
    } catch (e) {
      throw new SourceError(`The source is not valid JSON: ${(e as Error).message}`);
    }
    return {
      kind,
      paths: jsonPaths(root),
      get: (path) => {
        const value = jsonPath(root, path);
        if (value === null || value === undefined) return undefined;
        return typeof value === "object" ? JSON.stringify(value) : String(value);
      },
    };
  }

  // CSV: the first row names the columns, and the second is the row being mapped.
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim());
  if (lines.length === 0) throw new SourceError("The source is empty.");
  const headers = csvLine(lines[0]).map((h) => h.trim());
  const row = lines.length > 1 ? csvLine(lines[1]) : [];
  const byName = new Map<string, string>();
  headers.forEach((h, i) => h && byName.set(h, row[i] ?? ""));
  return {
    kind,
    paths: headers.filter(Boolean),
    get: (path) => {
      // A column can be addressed by name or by 1-based position.
      const byIndex = /^\d+$/.test(path.trim()) ? row[Number(path) - 1] : undefined;
      const value = byIndex ?? byName.get(path.trim());
      return value === undefined || value === "" ? undefined : value;
    },
  };
}

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------

export class TransformError extends Error {}

/** One transform step. Pure, and throws rather than silently passing bad data on. */
export function applyTransform(value: string, step: TransformStep): string {
  switch (step.kind) {
    case "trim":
      return value.trim();
    case "upper":
      return value.toUpperCase();
    case "lower":
      return value.toLowerCase();
    case "titlecase":
      return value.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
    case "digitsOnly":
      return value.replace(/\D/g, "");
    case "substring": {
      const from = Number(step.a ?? 0);
      const to = step.b === undefined || step.b === "" ? undefined : Number(step.b);
      return value.slice(from, to);
    }
    case "replace":
      // Literal, not a regex: a mapping is reviewed by people who do not read regex.
      return value.split(step.a ?? "").join(step.b ?? "");
    case "split": {
      const parts = value.split(step.a ?? "^");
      const index = Number(step.b ?? 0);
      return parts[index] ?? "";
    }
    case "pad": {
      const length = Number(step.a ?? 0);
      return value.padStart(length, step.b || "0");
    }
    case "prefix":
      return `${step.a ?? ""}${value}`;
    case "suffix":
      return `${value}${step.a ?? ""}`;
    case "hl7DateToIso": {
      const iso = hl7DateToIso(value);
      if (!iso) throw new TransformError(`"${value}" is not an HL7 timestamp (expected YYYYMMDD, optionally with a time).`);
      return iso;
    }
    case "isoToHl7Date": {
      const hl7 = isoToHl7Date(value);
      if (!hl7) throw new TransformError(`"${value}" is not an ISO date.`);
      return hl7;
    }
    case "lookup": {
      const table = step.table ?? {};
      const mapped = table[value];
      if (mapped !== undefined) return mapped;
      if (step.strict) {
        throw new TransformError(`"${value}" is not in the lookup table. The receiving system will not recognise it.`);
      }
      return value;
    }
  }
}

/**
 * HL7 timestamp to ISO. Length decides precision, which is the whole point of
 * the format: `1975` means the year, not midnight on the 1st of January.
 */
export function hl7DateToIso(value: string): string | null {
  const digits = value.trim().split(/[+-]/)[0].replace(/\D/g, "");
  if (digits.length < 4) return null;
  const year = digits.slice(0, 4);
  if (digits.length < 6) return year;
  const month = digits.slice(4, 6);
  if (digits.length < 8) return `${year}-${month}`;
  const day = digits.slice(6, 8);
  if (digits.length < 10) return `${year}-${month}-${day}`;
  const hour = digits.slice(8, 10);
  const minute = digits.slice(10, 12) || "00";
  const second = digits.slice(12, 14) || "00";
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

/** ISO date to HL7. Drops the offset — HL7 carries it separately. */
export function isoToHl7Date(value: string): string | null {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(value.trim());
  if (!m) return /^\d{4}$/.test(value.trim()) ? value.trim() : null;
  const [, year, month, day, hour, minute, second] = m;
  if (!day) return `${year}${month}`;
  if (!hour) return `${year}${month}${day}`;
  return `${year}${month}${day}${hour}${minute}${second ?? "00"}`;
}

// ---------------------------------------------------------------------------
// Running a mapping
// ---------------------------------------------------------------------------

export interface StepTrace {
  kind: TransformKind;
  from: string;
  to: string;
}

export interface FieldTrace {
  ruleId: string;
  target: string;
  source?: string;
  /** What the source held before any transform. */
  raw?: string;
  steps: StepTrace[];
  value?: string;
  /** Set when the value came from `fallback` rather than the source. */
  usedFallback: boolean;
  error?: string;
}

export type IssueLevel = "error" | "warn" | "info";

export interface MappingIssue {
  level: IssueLevel;
  ruleId?: string;
  subject: string;
  message: string;
}

export interface MappingResult {
  /** The mapped document. */
  output: Record<string, unknown>;
  traces: FieldTrace[];
  issues: MappingIssue[];
}

/** Write a value into a nested object, creating the objects on the way down. */
export function setPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".").filter(Boolean);
  let node = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (typeof node[key] !== "object" || node[key] === null || Array.isArray(node[key])) node[key] = {};
    node = node[key] as Record<string, unknown>;
  }
  node[parts[parts.length - 1]] = value;
}

/**
 * Run a mapping over one source document.
 *
 * A rule that fails does not stop the run: the rest of the mapping still tells
 * you what it would produce, and one bad transform reported as one issue is far
 * more useful than an exception with a stack trace in it.
 */
export function applyMapping(mapping: Mapping, source: Source): MappingResult {
  const output: Record<string, unknown> = {};
  const traces: FieldTrace[] = [];
  const issues: MappingIssue[] = [];
  const seenTargets = new Set<string>();

  for (const rule of mapping.rules) {
    const trace: FieldTrace = { ruleId: rule.id, target: rule.target, source: rule.source, steps: [], usedFallback: false };

    if (!rule.target.trim()) {
      issues.push({ level: "error", ruleId: rule.id, subject: "(no target)", message: "The rule has no target field, so its value has nowhere to go." });
      traces.push({ ...trace, error: "no target" });
      continue;
    }
    if (seenTargets.has(rule.target)) {
      issues.push({
        level: "warn",
        ruleId: rule.id,
        subject: rule.target,
        message: "Two rules write this same target. The later one wins, which makes the earlier one dead — and it is not obvious in the output.",
      });
    }
    seenTargets.add(rule.target);

    let value: string | undefined;
    if (rule.constant !== undefined && rule.constant !== "") {
      value = rule.constant;
    } else if (rule.source) {
      value = source.get(rule.source);
      trace.raw = value;
    }

    if ((value === undefined || value === "") && rule.fallback !== undefined && rule.fallback !== "") {
      value = rule.fallback;
      trace.usedFallback = true;
    }

    if (value === undefined || value === "") {
      if (rule.required) {
        issues.push({
          level: "error",
          ruleId: rule.id,
          subject: rule.target,
          message: rule.source
            ? `Required, and ${rule.source} is empty in this message. The receiving system will reject it.`
            : "Required, and the rule has no source or constant to fill it from.",
        });
      }
      traces.push(trace);
      continue;
    }

    let current = value;
    let failed = false;
    for (const step of rule.transforms ?? []) {
      try {
        const next = applyTransform(current, step);
        trace.steps.push({ kind: step.kind, from: current, to: next });
        current = next;
      } catch (e) {
        trace.error = e instanceof Error ? e.message : String(e);
        issues.push({ level: "error", ruleId: rule.id, subject: rule.target, message: trace.error });
        failed = true;
        break;
      }
    }
    if (failed) {
      traces.push(trace);
      continue;
    }

    trace.value = current;
    traces.push(trace);
    setPath(output, rule.target, current);
  }

  return { output, traces, issues };
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

export interface Coverage {
  /** Paths present in the document that no rule reads. */
  unmappedSource: string[];
  /** Targets the receiver expects that no rule fills. */
  unmappedTarget: string[];
  /** Rules whose source path is not present in this document. */
  missingSource: string[];
  mappedCount: number;
}

/**
 * What the mapping does and does not cover.
 *
 * Both directions, because they mean opposite things. A source field nobody
 * reads is usually fine — most of an ADT is not wanted. A target field nobody
 * fills is usually a gap, and one the receiver marked required is certainly a
 * rejected message. Only the first is visible from the output alone.
 */
export function coverage(mapping: Mapping, source: Source, expectedTargets: string[] = []): Coverage {
  const sourcesUsed = new Set(mapping.rules.map((r) => r.source).filter((s): s is string => !!s));
  const targetsFilled = new Set(mapping.rules.map((r) => r.target).filter(Boolean));

  return {
    unmappedSource: source.paths.filter((p) => !sourcesUsed.has(p)),
    unmappedTarget: expectedTargets.filter((t) => !targetsFilled.has(t)),
    missingSource: [...sourcesUsed].filter((s) => source.get(s) === undefined),
    mappedCount: targetsFilled.size,
  };
}

// ---------------------------------------------------------------------------
// Import / export
// ---------------------------------------------------------------------------

/** A mapping as a file: stable key order, so a diff shows real changes only. */
export function exportMapping(mapping: Mapping): string {
  return JSON.stringify(
    {
      devhelper: "field-mapping",
      version: 1,
      name: mapping.name,
      sourceKind: mapping.sourceKind,
      note: mapping.note,
      rules: mapping.rules.map((r) => ({
        id: r.id,
        target: r.target,
        source: r.source,
        constant: r.constant,
        required: r.required,
        fallback: r.fallback,
        note: r.note,
        transforms: r.transforms,
      })),
    },
    null,
    2,
  );
}

export function importMapping(text: string): Mapping {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new SourceError(`Not a mapping file: ${(e as Error).message}`);
  }
  const obj = parsed as Partial<Mapping> & { devhelper?: string; rules?: unknown };
  if (!Array.isArray(obj.rules)) throw new SourceError("A mapping file needs a `rules` array.");
  const kind: SourceKind = obj.sourceKind === "json" || obj.sourceKind === "csv" ? obj.sourceKind : "hl7";
  return {
    name: obj.name || "Imported mapping",
    sourceKind: kind,
    note: obj.note,
    rules: (obj.rules as MappingRule[]).map((r, i) => ({
      ...r,
      // An id is what a diff and an issue list refer to; invent one if the file lacks it.
      id: r.id || `rule-${i + 1}`,
      target: r.target ?? "",
    })),
  };
}

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

function csharpLiteral(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * The mapping as C#.
 *
 * A projection of the mapping, never the source of truth — regenerate it rather
 * than editing it, or the table and the code start disagreeing, which is the
 * problem this tool exists to solve. The generated method takes an accessor
 * delegate rather than a parsed type, so it compiles against whatever HL7 or
 * JSON library the project already uses.
 */
export function toCSharp(mapping: Mapping, className = "FieldMap"): string {
  const lines: string[] = [];
  lines.push("// Generated by DevHelper Field Mapper. Regenerate rather than edit —");
  lines.push("// the mapping file is the source of truth.");
  lines.push(`// Mapping: ${mapping.name} (source: ${mapping.sourceKind})`);
  if (mapping.note) lines.push(`// ${mapping.note}`);
  lines.push("");
  lines.push("using System;");
  lines.push("using System.Collections.Generic;");
  lines.push("");
  lines.push(`public static class ${className}`);
  lines.push("{");
  lines.push("    /// <summary>Maps one source document. `get` returns the raw value at a source path, or null.</summary>");
  lines.push("    public static Dictionary<string, string> Map(Func<string, string?> get, out List<string> errors)");
  lines.push("    {");
  lines.push("        var result = new Dictionary<string, string>();");
  lines.push("        errors = new List<string>();");
  lines.push("        string? value;");
  lines.push("");

  for (const rule of mapping.rules) {
    if (!rule.target) continue;
    lines.push(`        // ${rule.target}${rule.note ? ` — ${rule.note}` : ""}`);
    if (rule.constant) lines.push(`        value = ${csharpLiteral(rule.constant)};`);
    else if (rule.source) lines.push(`        value = get(${csharpLiteral(rule.source)});`);
    else lines.push("        value = null;");

    if (rule.fallback) {
      lines.push(`        if (string.IsNullOrEmpty(value)) value = ${csharpLiteral(rule.fallback)};`);
    }
    lines.push("        if (!string.IsNullOrEmpty(value))");
    lines.push("        {");
    for (const step of rule.transforms ?? []) lines.push(`            ${csharpStep(step)}`);
    lines.push(`            result[${csharpLiteral(rule.target)}] = value;`);
    lines.push("        }");
    if (rule.required) {
      lines.push(`        else errors.Add(${csharpLiteral(`${rule.target} is required and was empty`)});`);
    }
    lines.push("");
  }

  lines.push("        return result;");
  lines.push("    }");
  lines.push("}");
  return lines.join("\n");
}

function csharpStep(step: TransformStep): string {
  switch (step.kind) {
    case "trim":
      return "value = value.Trim();";
    case "upper":
      return "value = value.ToUpperInvariant();";
    case "lower":
      return "value = value.ToLowerInvariant();";
    case "titlecase":
      return "value = System.Globalization.CultureInfo.InvariantCulture.TextInfo.ToTitleCase(value.ToLowerInvariant());";
    case "digitsOnly":
      return "value = System.Text.RegularExpressions.Regex.Replace(value, @\"\\D\", \"\");";
    case "substring":
      return step.b
        ? `value = value.Length > ${Number(step.a ?? 0)} ? value.Substring(${Number(step.a ?? 0)}, Math.Min(${Number(step.b) - Number(step.a ?? 0)}, value.Length - ${Number(step.a ?? 0)})) : "";`
        : `value = value.Length > ${Number(step.a ?? 0)} ? value.Substring(${Number(step.a ?? 0)}) : "";`;
    case "replace":
      return `value = value.Replace(${csharpLiteral(step.a ?? "")}, ${csharpLiteral(step.b ?? "")});`;
    case "split":
      return `value = value.Split(${csharpLiteral(step.a ?? "^")}).ElementAtOrDefault(${Number(step.b ?? 0)}) ?? "";`;
    case "pad":
      return `value = value.PadLeft(${Number(step.a ?? 0)}, '${(step.b || "0").charAt(0)}');`;
    case "prefix":
      return `value = ${csharpLiteral(step.a ?? "")} + value;`;
    case "suffix":
      return `value = value + ${csharpLiteral(step.a ?? "")};`;
    case "hl7DateToIso":
      return 'value = DateTime.TryParseExact(value, new[] { "yyyyMMddHHmmss", "yyyyMMdd", "yyyyMM", "yyyy" }, null, System.Globalization.DateTimeStyles.None, out var d) ? d.ToString("o") : value;';
    case "isoToHl7Date":
      return 'value = DateTime.TryParse(value, out var iso) ? iso.ToString("yyyyMMddHHmmss") : value;';
    case "lookup": {
      const pairs = Object.entries(step.table ?? {})
        .map(([k, v]) => `{ ${csharpLiteral(k)}, ${csharpLiteral(v)} }`)
        .join(", ");
      return step.strict
        ? `{ var table = new Dictionary<string, string> { ${pairs} }; if (!table.TryGetValue(value, out var mapped)) errors.Add($"unmapped code {value}"); else value = mapped; }`
        : `{ var table = new Dictionary<string, string> { ${pairs} }; if (table.TryGetValue(value, out var mapped)) value = mapped; }`;
    }
  }
}

/** A short human description of a transform chain, for the rule list. */
export function describeTransforms(steps: TransformStep[] | undefined): string {
  if (!steps || steps.length === 0) return "as-is";
  return steps
    .map((s) => {
      switch (s.kind) {
        case "substring":
          return `substring ${s.a ?? 0}${s.b ? `–${s.b}` : "→end"}`;
        case "replace":
          return `replace "${s.a ?? ""}" → "${s.b ?? ""}"`;
        case "split":
          return `split on "${s.a ?? "^"}" take ${s.b ?? 0}`;
        case "pad":
          return `pad to ${s.a ?? 0}`;
        case "prefix":
          return `prefix "${s.a ?? ""}"`;
        case "suffix":
          return `suffix "${s.a ?? ""}"`;
        case "lookup":
          return `lookup (${Object.keys(s.table ?? {}).length} codes${s.strict ? ", strict" : ""})`;
        default:
          return s.kind;
      }
    })
    .join(" → ");
}
