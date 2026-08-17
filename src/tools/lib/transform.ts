/**
 * Reshaping a payload with a template.
 *
 * The JSON Formatter queries a document and the Field Mapper maps flat fields.
 * Neither builds a *differently shaped* document, which is what an integration
 * spends its time doing: an array of database rows becomes a FHIR Bundle, a
 * nested FHIR resource becomes the flat row a warehouse wants.
 *
 * The template is the output document with holes in it. That choice does most of
 * the work: the thing on screen looks like what will be produced, so it can be
 * checked against the receiving system's example by eye — which is how these
 * specifications actually arrive. The alternative, a list of assignments, is
 * only readable by whoever wrote it.
 *
 * Three rules make it behave:
 *
 * - **A value that is exactly one expression keeps its type.** `"{{ $.count }}"`
 *   produces the number 5, not the string "5". A schema that wants a number and
 *   receives a string is rejected, and the reason is invisible in a diff.
 * - **A key whose expression finds nothing is omitted, not nulled.** FHIR
 *   distinguishes absent from null and validators enforce it; so does most of
 *   X12. Emitting `null` for a missing optional field is a validation error, not
 *   a tidy default.
 * - **Errors are collected, never thrown.** A template with one bad expression
 *   still shows the rest of the output, and the one broken field is named. A
 *   thrown exception shows nothing and names a line number in a parser.
 *
 * Expressions are JSONPath (the engine in `jsonPath.ts`) optionally piped
 * through the Field Mapper's transform vocabulary, so a transform written here
 * and a mapping written there speak the same language.
 */

import { queryJsonPath } from "./jsonPath";
import { applyTransform, type TransformKind, type TransformStep } from "./fieldMap";

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

export class TemplateError extends Error {}

export interface Expression {
  /** The JSONPath, with any bound-variable prefix already resolved. */
  path: string;
  /** The variable it reads from, when it is not the root. */
  variable?: string;
  steps: TransformStep[];
}

const TRANSFORM_NAMES = new Set<TransformKind>([
  "trim", "upper", "lower", "titlecase", "substring", "replace", "split", "pad",
  "prefix", "suffix", "hl7DateToIso", "isoToHl7Date", "lookup", "digitsOnly",
]);

/**
 * Parse `path | step(a, b) | step`.
 *
 * Arguments are split on commas and unquoted, which is enough for the vocabulary
 * — none of the steps take a value with a comma in it, and inventing a quoting
 * grammar for a case that does not arise makes every template harder to read.
 */
export function parseExpression(raw: string): Expression {
  const parts = raw.split("|").map((p) => p.trim());
  const head = parts[0];
  if (!head) throw new TemplateError("Empty expression.");

  let path = head;
  let variable: string | undefined;
  if (!head.startsWith("$")) {
    // `row.mrn` inside an $each block: the first segment names the binding.
    const dot = head.search(/[.[]/);
    variable = dot === -1 ? head : head.slice(0, dot);
    path = `$${dot === -1 ? "" : head.slice(dot)}`;
  }

  const steps: TransformStep[] = [];
  for (const part of parts.slice(1)) {
    const m = /^(\w+)\s*(?:\(([^)]*)\))?$/.exec(part);
    if (!m) throw new TemplateError(`"${part}" is not a transform. Write it as name or name(arg, arg).`);
    const kind = m[1] as TransformKind;
    if (!TRANSFORM_NAMES.has(kind)) {
      throw new TemplateError(`"${kind}" is not a known transform. Available: ${[...TRANSFORM_NAMES].join(", ")}.`);
    }
    const args = (m[2] ?? "").split(",").map((a) => a.trim()).filter(Boolean);
    if (kind === "lookup") {
      // `lookup(F, female, M, male)` — pairs, because a table written as
      // positional arguments is the only spelling that fits on one line, and a
      // lookup with one pair is by far the common case.
      if (args.length % 2 !== 0) {
        throw new TemplateError(`lookup takes pairs: lookup(F, female, M, male). Got ${args.length} argument(s).`);
      }
      const table: Record<string, string> = {};
      for (let i = 0; i < args.length; i += 2) table[args[i]] = args[i + 1];
      steps.push({ kind, table });
      continue;
    }
    steps.push({ kind, a: args[0], b: args[1] });
  }

  return { path, variable, steps };
}

/** Find `{{ … }}` holes in a string. */
export function holes(text: string): { raw: string; start: number; end: number }[] {
  const out: { raw: string; start: number; end: number }[] = [];
  const re = /\{\{([^}]*)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ raw: m[1].trim(), start: m.index, end: m.index + m[0].length });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export interface TransformIssue {
  /** Where in the output template, as a dotted path. */
  at: string;
  message: string;
}

interface Scope {
  root: unknown;
  bindings: Record<string, unknown>;
}

/** Resolve one expression to a value, or undefined when it finds nothing. */
function evaluate(expression: Expression, scope: Scope): unknown {
  const source = expression.variable ? scope.bindings[expression.variable] : scope.root;
  if (expression.variable && !(expression.variable in scope.bindings)) {
    throw new TemplateError(`"${expression.variable}" is not bound here. A variable only exists inside the $each that declared it.`);
  }
  if (source === undefined || source === null) return undefined;

  const matches = expression.path === "$" ? [{ value: source }] : queryJsonPath(source, expression.path);
  if (matches.length === 0) return undefined;

  // A path that matches several nodes yields an array; one match yields the
  // value. Wrapping a single match in an array would make every template that
  // reads one field produce a one-element array.
  const value = matches.length === 1 ? matches[0].value : matches.map((m) => m.value);
  if (expression.steps.length === 0) return value;

  let text = typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
  for (const step of expression.steps) text = applyTransform(text, step);
  return text;
}

/**
 * Render a string that may contain holes.
 *
 * The single-expression case is separated deliberately: it keeps the value's
 * type, while an expression embedded in surrounding text has to become a string
 * because that is what concatenation means.
 */
function renderString(text: string, scope: Scope, at: string, issues: TransformIssue[]): unknown {
  const found = holes(text);
  if (found.length === 0) return text;

  const whole = found.length === 1 && found[0].start === 0 && found[0].end === text.length;

  if (whole) {
    try {
      return evaluate(parseExpression(found[0].raw), scope);
    } catch (e) {
      issues.push({ at, message: e instanceof Error ? e.message : String(e) });
      return undefined;
    }
  }

  let out = "";
  let cursor = 0;
  for (const hole of found) {
    out += text.slice(cursor, hole.start);
    try {
      const value = evaluate(parseExpression(hole.raw), scope);
      out += value === undefined || value === null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
    } catch (e) {
      issues.push({ at, message: e instanceof Error ? e.message : String(e) });
    }
    cursor = hole.end;
  }
  return out + text.slice(cursor);
}

/** Directive keys, which are interpreted rather than emitted. */
const EACH = "$each";
const AS = "$as";
const TEMPLATE = "$template";

function isEach(node: unknown): node is Record<string, unknown> {
  return typeof node === "object" && node !== null && !Array.isArray(node) && EACH in (node as Record<string, unknown>);
}

function renderNode(node: unknown, scope: Scope, at: string, issues: TransformIssue[]): unknown {
  if (typeof node === "string") return renderString(node, scope, at, issues);
  if (node === null || typeof node !== "object") return node;

  if (Array.isArray(node)) {
    return node.map((item, i) => renderNode(item, scope, `${at}[${i}]`, issues)).filter((v) => v !== undefined);
  }

  const object = node as Record<string, unknown>;

  if (isEach(object)) {
    const listExpression = String(object[EACH] ?? "");
    const binding = String(object[AS] ?? "item");
    const template = object[TEMPLATE];
    if (template === undefined) {
      issues.push({ at, message: `$each needs a $template saying what each item becomes.` });
      return [];
    }
    let items: unknown[];
    try {
      const matched = queryJsonPath(scope.root, listExpression.startsWith("$") ? listExpression : `$.${listExpression}`);
      // One match that is itself an array means the path named the array rather
      // than its elements — both spellings are common, so accept either.
      items = matched.length === 1 && Array.isArray(matched[0].value) ? (matched[0].value as unknown[]) : matched.map((m) => m.value);
    } catch (e) {
      issues.push({ at, message: e instanceof Error ? e.message : String(e) });
      return [];
    }
    return items.map((item, i) =>
      renderNode(template, { root: scope.root, bindings: { ...scope.bindings, [binding]: item } }, `${at}[${i}]`, issues),
    );
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(object)) {
    const rendered = renderNode(value, scope, at ? `${at}.${key}` : key, issues);
    // Absent rather than null: FHIR and X12 both distinguish them, and a null
    // where a field should be missing is a validation error rather than a
    // harmless default.
    if (rendered === undefined) continue;
    if (typeof rendered === "object" && rendered !== null && !Array.isArray(rendered) && Object.keys(rendered).length === 0) continue;
    out[key] = rendered;
  }
  return out;
}

export interface TransformResult {
  output: unknown;
  issues: TransformIssue[];
}

/**
 * Run a template over an input document.
 *
 * Both are text: this is what a person pastes, and reporting "the template is
 * not valid JSON" is a far more useful failure than a type error further in.
 */
export function runTransform(templateText: string, inputText: string): TransformResult {
  let template: unknown;
  try {
    template = JSON.parse(templateText);
  } catch (e) {
    throw new TemplateError(`The template is not valid JSON: ${(e as Error).message}`);
  }

  let input: unknown;
  try {
    input = JSON.parse(inputText);
  } catch (e) {
    throw new TemplateError(`The input is not valid JSON: ${(e as Error).message}`);
  }

  const issues: TransformIssue[] = [];
  const output = renderNode(template, { root: input, bindings: {} }, "", issues);
  return { output, issues };
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

/** Every expression a template contains, for the "what does this read" question. */
export function templateExpressions(templateText: string): string[] {
  const out = new Set<string>();
  const walk = (node: unknown) => {
    if (typeof node === "string") {
      for (const hole of holes(node)) out.add(hole.raw);
      return;
    }
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === EACH) out.add(String(value));
        else walk(value);
      }
    }
  };
  try {
    walk(JSON.parse(templateText));
  } catch {
    // A template being edited is not valid JSON most of the time; that is the
    // editor's problem to report, not this function's.
  }
  return [...out];
}

// ---------------------------------------------------------------------------
// Samples
// ---------------------------------------------------------------------------

export interface Sample {
  name: string;
  note: string;
  input: string;
  template: string;
}

/**
 * Starting points, each a shape change that actually comes up.
 *
 * Chosen so the first thing anyone sees is the case they have: rows to a Bundle,
 * a resource to a flat row, and a list to the CSV a finance system wants.
 */
export const SAMPLES: Sample[] = [
  {
    name: "Rows → FHIR Bundle",
    note: "The commonest direction: a query result becomes the Bundle a FHIR server will accept.",
    input: JSON.stringify(
      {
        rows: [
          { mrn: "100234", family: "sharma", given: "priya", dob: "19750214", sex: "F" },
          { mrn: "100235", family: "kumar", given: "arjun", dob: "19801130", sex: "M" },
        ],
      },
      null,
      2,
    ),
    template: JSON.stringify(
      {
        resourceType: "Bundle",
        type: "collection",
        entry: {
          $each: "$.rows[*]",
          $as: "row",
          $template: {
            resource: {
              resourceType: "Patient",
              identifier: [{ system: "urn:oid:2.16.840.1", value: "{{ row.mrn }}" }],
              name: [{ family: "{{ row.family | titlecase }}", given: ["{{ row.given | titlecase }}"] }],
              birthDate: "{{ row.dob | hl7DateToIso }}",
              gender: "{{ row.sex | lookup(F, female) }}",
            },
          },
        },
      },
      null,
      2,
    ),
  },
  {
    name: "FHIR → flat row",
    note: "The other direction, for a warehouse or a spreadsheet. Note the fields that are simply absent when the source has none.",
    input: JSON.stringify(
      {
        resourceType: "Patient",
        identifier: [{ value: "100234" }],
        name: [{ family: "Sharma", given: ["Priya"] }],
        birthDate: "1975-02-14",
      },
      null,
      2,
    ),
    template: JSON.stringify(
      {
        mrn: "{{ $.identifier[0].value }}",
        surname: "{{ $.name[0].family | upper }}",
        forename: "{{ $.name[0].given[0] }}",
        dob: "{{ $.birthDate | isoToHl7Date }}",
        phone: "{{ $.telecom[0].value }}",
        label: "{{ $.name[0].family }}, {{ $.name[0].given[0] }} ({{ $.birthDate }})",
      },
      null,
      2,
    ),
  },
];
