/**
 * Small dependency-free JSONPath evaluator.
 *
 * Supported syntax:
 *   $                      root
 *   .name  ['name']        child (bracket form allows any characters)
 *   .*     [*]             wildcard over object values / array elements
 *   [0]  [-1]  [0,2]       index, negative index, union
 *   [1:4]  [::2]           slice with optional step
 *   ..name  ..*  ..[0]     recursive descent
 *   [?(@.a > 1)]           filter over array elements / object values
 *   [?(@.a)]               filter on existence / truthiness
 *
 * Filter comparisons: == != > >= < <= against a number, quoted string,
 * true, false or null.
 */

import { appendPath, valueKind } from "./json";

export interface JsonPathMatch {
  /** Canonical path of the match, e.g. `$.items[0].name`. */
  path: string;
  value: unknown;
}

type CompareOp = "==" | "!=" | ">" | ">=" | "<" | "<=";

interface FilterExpr {
  /** Relative property chain from `@`, empty for `@` itself. */
  keys: string[];
  op?: CompareOp;
  literal?: unknown;
}

type Step =
  | { t: "child"; names: string[] }
  | { t: "index"; indices: number[] }
  | { t: "slice"; start?: number; end?: number; step?: number }
  | { t: "wild" }
  | { t: "descend" }
  | { t: "filter"; expr: FilterExpr };

export class JsonPathError extends Error {}

// ---- Parsing ---------------------------------------------------------------

function parseBracket(src: string, from: number): { step: Step; next: number } {
  const close = findClosingBracket(src, from);
  const body = src.slice(from + 1, close).trim();
  const next = close + 1;

  if (!body) throw new JsonPathError("Empty [] selector");

  if (body === "*") return { step: { t: "wild" }, next };

  if (body.startsWith("?")) {
    const inner = body.replace(/^\?\s*/, "");
    const expr = inner.startsWith("(") && inner.endsWith(")") ? inner.slice(1, -1) : inner;
    return { step: { t: "filter", expr: parseFilter(expr) }, next };
  }

  if (body.includes(":") && !/^['"]/.test(body)) {
    const [start, end, step] = body.split(":").map((p) => p.trim());
    return {
      step: {
        t: "slice",
        start: start === "" ? undefined : toInt(start),
        end: end === "" ? undefined : toInt(end),
        step: step === undefined || step === "" ? undefined : toInt(step),
      },
      next,
    };
  }

  const parts = splitUnion(body);

  if (parts.every((p) => /^-?\d+$/.test(p))) {
    return { step: { t: "index", indices: parts.map((p) => parseInt(p, 10)) }, next };
  }

  const names = parts.map((p) => {
    const m = /^(['"])(.*)\1$/.exec(p);
    if (!m) throw new JsonPathError(`Unquoted name in []: ${p}`);
    return m[2];
  });
  return { step: { t: "child", names }, next };
}

function findClosingBracket(src: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') quote = c;
    else if (c === "[") depth++;
    else if (c === "]" && --depth === 0) return i;
  }
  throw new JsonPathError("Unclosed [");
}

/** Split on commas that are not inside quotes. */
function splitUnion(body: string): string[] {
  const parts: string[] = [];
  let buf = "";
  let quote: string | null = null;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) {
      buf += c;
      if (c === "\\") buf += body[++i] ?? "";
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      buf += c;
    } else if (c === ",") {
      parts.push(buf.trim());
      buf = "";
    } else {
      buf += c;
    }
  }
  parts.push(buf.trim());
  return parts.filter((p) => p !== "");
}

function toInt(text: string): number {
  const n = parseInt(text, 10);
  if (Number.isNaN(n)) throw new JsonPathError(`Expected a number, got "${text}"`);
  return n;
}

function parseFilter(expr: string): FilterExpr {
  const m = /^(.*?)(==|!=|>=|<=|>|<)(.*)$/.exec(expr);
  if (!m) return { keys: relativeKeys(expr.trim()) };
  return {
    keys: relativeKeys(m[1].trim()),
    op: m[2] as CompareOp,
    literal: parseLiteral(m[3].trim()),
  };
}

function relativeKeys(text: string): string[] {
  if (!text.startsWith("@")) throw new JsonPathError("Filter must start with @");
  const rest = text.slice(1);
  const keys: string[] = [];
  const re = /\.([A-Za-z_$][A-Za-z0-9_$]*)|\[\s*(['"])(.*?)\2\s*\]/g;
  let consumed = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest))) {
    if (m.index !== consumed) break;
    keys.push(m[1] ?? m[3]);
    consumed = re.lastIndex;
  }
  if (consumed !== rest.trim().length) throw new JsonPathError(`Unsupported filter path: ${text}`);
  return keys;
}

function parseLiteral(text: string): unknown {
  const q = /^(['"])(.*)\1$/.exec(text);
  if (q) return q[2];
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null") return null;
  const n = Number(text);
  if (!Number.isNaN(n) && text !== "") return n;
  throw new JsonPathError(`Unsupported literal: ${text}`);
}

export function parseJsonPath(expr: string): Step[] {
  let src = expr.trim();
  if (!src) throw new JsonPathError("Expression is empty");
  if (src.startsWith("$")) src = src.slice(1);

  const steps: Step[] = [];
  let i = 0;

  while (i < src.length) {
    const c = src[i];

    if (c === "." && src[i + 1] === ".") {
      steps.push({ t: "descend" });
      i += 2;
      // `..[0]` — the descent is followed directly by a bracket selector.
      if (src[i] === "[") continue;
      if (src[i] === "*") {
        steps.push({ t: "wild" });
        i++;
        continue;
      }
      const name = /^[A-Za-z_$][A-Za-z0-9_$-]*/.exec(src.slice(i));
      if (!name) throw new JsonPathError("Expected a property name after ..");
      steps.push({ t: "child", names: [name[0]] });
      i += name[0].length;
      continue;
    }

    if (c === ".") {
      i++;
      if (src[i] === "*") {
        steps.push({ t: "wild" });
        i++;
        continue;
      }
      const m = /^[A-Za-z_$][A-Za-z0-9_$-]*/.exec(src.slice(i));
      if (!m) throw new JsonPathError(`Expected a property name at position ${i}`);
      steps.push({ t: "child", names: [m[0]] });
      i += m[0].length;
      continue;
    }

    if (c === "[") {
      const { step, next } = parseBracket(src, i);
      steps.push(step);
      i = next;
      continue;
    }

    if (steps.length === 0) {
      // Allow a leading bare name: `items[0]` behaves like `$.items[0]`.
      const m = /^[A-Za-z_$][A-Za-z0-9_$-]*/.exec(src.slice(i));
      if (m) {
        steps.push({ t: "child", names: [m[0]] });
        i += m[0].length;
        continue;
      }
    }

    throw new JsonPathError(`Unexpected "${c}" at position ${i}`);
  }

  return steps;
}

// ---- Evaluation ------------------------------------------------------------

function descendants(match: JsonPathMatch): JsonPathMatch[] {
  const out: JsonPathMatch[] = [match];
  const walk = (m: JsonPathMatch) => {
    const kind = valueKind(m.value);
    if (kind === "array") {
      (m.value as unknown[]).forEach((v, idx) => {
        const child = { path: appendPath(m.path, String(idx), true), value: v };
        out.push(child);
        walk(child);
      });
    } else if (kind === "object") {
      for (const [k, v] of Object.entries(m.value as Record<string, unknown>)) {
        const child = { path: appendPath(m.path, k, false), value: v };
        out.push(child);
        walk(child);
      }
    }
  };
  walk(match);
  return out;
}

function resolveRelative(value: unknown, keys: string[]): unknown {
  let cur = value;
  for (const k of keys) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

function compare(left: unknown, op: CompareOp, right: unknown): boolean {
  switch (op) {
    case "==":
      return left === right;
    case "!=":
      return left !== right;
    default:
      break;
  }
  if (typeof left !== "number" || typeof right !== "number") return false;
  if (op === ">") return left > right;
  if (op === ">=") return left >= right;
  if (op === "<") return left < right;
  return left <= right;
}

function matchesFilter(value: unknown, expr: FilterExpr): boolean {
  const target = resolveRelative(value, expr.keys);
  if (!expr.op) return target !== undefined && target !== false && target !== null;
  return compare(target, expr.op, expr.literal);
}

/** Elements of an array, or values of an object — the set a filter runs over. */
function containerEntries(m: JsonPathMatch): JsonPathMatch[] {
  const kind = valueKind(m.value);
  if (kind === "array") {
    return (m.value as unknown[]).map((v, i) => ({ path: appendPath(m.path, String(i), true), value: v }));
  }
  if (kind === "object") {
    return Object.entries(m.value as Record<string, unknown>).map(([k, v]) => ({
      path: appendPath(m.path, k, false),
      value: v,
    }));
  }
  return [];
}

function applyStep(input: JsonPathMatch[], step: Step): JsonPathMatch[] {
  const out: JsonPathMatch[] = [];

  for (const m of input) {
    switch (step.t) {
      case "descend":
        out.push(...descendants(m));
        break;

      case "wild":
        out.push(...containerEntries(m));
        break;

      case "child": {
        if (!m.value || typeof m.value !== "object" || Array.isArray(m.value)) break;
        const obj = m.value as Record<string, unknown>;
        for (const name of step.names) {
          if (Object.prototype.hasOwnProperty.call(obj, name)) {
            out.push({ path: appendPath(m.path, name, false), value: obj[name] });
          }
        }
        break;
      }

      case "index": {
        if (!Array.isArray(m.value)) break;
        const arr = m.value;
        for (const raw of step.indices) {
          const idx = raw < 0 ? arr.length + raw : raw;
          if (idx >= 0 && idx < arr.length) {
            out.push({ path: appendPath(m.path, String(idx), true), value: arr[idx] });
          }
        }
        break;
      }

      case "slice": {
        if (!Array.isArray(m.value)) break;
        const arr = m.value;
        const stride = step.step ?? 1;
        if (stride === 0) throw new JsonPathError("Slice step cannot be 0");
        const norm = (v: number | undefined, fallback: number) => {
          if (v === undefined) return fallback;
          return v < 0 ? Math.max(arr.length + v, 0) : Math.min(v, arr.length);
        };
        if (stride > 0) {
          for (let i = norm(step.start, 0); i < norm(step.end, arr.length); i += stride) {
            out.push({ path: appendPath(m.path, String(i), true), value: arr[i] });
          }
        } else {
          for (let i = norm(step.start, arr.length - 1); i > norm(step.end, -1); i += stride) {
            if (i >= 0 && i < arr.length) {
              out.push({ path: appendPath(m.path, String(i), true), value: arr[i] });
            }
          }
        }
        break;
      }

      case "filter":
        out.push(...containerEntries(m).filter((c) => matchesFilter(c.value, step.expr)));
        break;
    }
  }

  // Recursive descent can surface the same node twice when chained; keep first.
  if (step.t === "descend") {
    const seen = new Set<string>();
    return out.filter((m) => (seen.has(m.path) ? false : (seen.add(m.path), true)));
  }
  return out;
}

/** Run a JSONPath expression over an already-parsed value. */
export function queryJsonPath(root: unknown, expr: string): JsonPathMatch[] {
  const steps = parseJsonPath(expr);
  let current: JsonPathMatch[] = [{ path: "$", value: root }];
  for (const step of steps) current = applyStep(current, step);
  return current;
}

/** Convenience wrapper: parse the document, then query it. */
export function queryJsonText(text: string, expr: string, parse: (s: string) => unknown = JSON.parse): JsonPathMatch[] {
  return queryJsonPath(parse(text), expr);
}
