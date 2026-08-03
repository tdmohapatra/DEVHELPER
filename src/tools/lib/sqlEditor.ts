/**
 * Editor-side SQL helpers: everything the Monaco surface needs that can be
 * computed and unit-tested without a DOM.
 *
 * Deliberately separate from `sqlSafety.ts`: that module answers "is this
 * dangerous?" over whole scripts, while this one needs *positions* in the
 * original text so findings can be drawn as squiggles. The masking here is
 * length-preserving for that reason (`stripSqlNoise` is not, and its output
 * shape is relied on elsewhere).
 */

import type { SqlLanguage } from "sql-formatter";
import type { DbEngine, DbObject } from "./dbTypes";
import { analyzeSql, type SqlRisk } from "./sqlSafety";

/** Monaco language id per engine. Only these three grammars are bundled. */
export function editorLanguage(engine: DbEngine): "sql" | "pgsql" | "mysql" {
  if (engine === "postgres") return "pgsql";
  if (engine === "mysql") return "mysql";
  return "sql";
}

/** sql-formatter dialect per engine, for the editor's format action. */
export function formatterDialect(engine: DbEngine): SqlLanguage {
  switch (engine) {
    case "postgres": return "postgresql";
    case "mysql": return "mysql";
    case "mssql": return "tsql";
    case "sqlite": return "sqlite";
    case "oracle": return "plsql";
  }
}

/**
 * Neutralize comments and quoted spans without changing any offset, so every
 * index in the result maps 1:1 to the input. Keyword scanning and statement
 * splitting then run on the mask while positions stay valid against the
 * original text.
 *
 * Comments become spaces (they are not part of a statement), literals become
 * runs of `'` — non-whitespace, so a statement that ends in a string literal
 * still trims to the right offset, but with no keyword or `;` left to match.
 */
export function maskSqlNoise(sql: string): string {
  const out = sql.split("");
  const fill = (from: number, to: number, ch: string) => {
    for (let k = from; k < to && k < out.length; k++) {
      if (out[k] !== "\n") out[k] = ch; // keep line structure intact
    }
  };
  const blank = (from: number, to: number) => fill(from, to, " ");
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      const end = nl === -1 ? sql.length : nl;
      blank(i, end);
      i = end;
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      const close = sql.indexOf("*/", i + 2);
      const end = close === -1 ? sql.length : close + 2;
      blank(i, end);
      i = end;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === c) {
          if (sql[j + 1] === c) { j += 2; continue; } // doubled = escaped
          j++;
          break;
        }
        j++;
      }
      fill(i, j, "'");
      i = j;
      continue;
    }
    i++;
  }
  return out.join("");
}

export interface SqlStatementSpan {
  /** statement text exactly as the user wrote it */
  text: string;
  /** same span with comments/literals blanked — safe for keyword tests */
  masked: string;
  /** inclusive start offset in the original SQL */
  start: number;
  /** exclusive end offset in the original SQL */
  end: number;
}

/**
 * Split into statements on top-level semicolons, keeping original offsets.
 * Blank-only fragments are dropped.
 */
export function statementSpans(sql: string): SqlStatementSpan[] {
  const masked = maskSqlNoise(sql);
  const spans: SqlStatementSpan[] = [];
  let from = 0;
  const push = (lo: number, hi: number) => {
    // Trim using the mask so leading comments are not counted as statement text.
    let s = lo;
    let e = hi;
    while (s < e && /\s/.test(masked[s])) s++;
    while (e > s && /\s/.test(masked[e - 1])) e--;
    if (e <= s || masked.slice(s, e).trim() === "") return;
    spans.push({ text: sql.slice(s, e), masked: masked.slice(s, e), start: s, end: e });
  };
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] === ";") {
      push(from, i);
      from = i + 1;
    }
  }
  push(from, masked.length);
  return spans;
}

export interface SqlMarker {
  start: number;
  end: number;
  risk: SqlRisk;
  message: string;
}

/**
 * Risk findings with offsets, ready to convert into editor markers.
 * Same rules as `analyzeSql` — one finding per statement at most.
 */
export function sqlMarkers(sql: string): SqlMarker[] {
  const markers: SqlMarker[] = [];
  for (const span of statementSpans(sql)) {
    // The mask has no literals or comments left, so analyzeSql sees exactly one
    // statement and reports at most one finding for it.
    const [finding] = analyzeSql(span.masked);
    if (finding) {
      markers.push({ start: span.start, end: span.end, risk: finding.risk, message: finding.message });
    }
  }
  return markers;
}

const NEEDS_QUOTING = /[^A-Za-z0-9_]|^\d/;

/** Quote an identifier the way the engine expects, but only when it needs it. */
export function quoteIdent(engine: DbEngine, name: string): string {
  if (!NEEDS_QUOTING.test(name)) return name;
  if (engine === "mssql") return `[${name.replace(/]/g, "]]")}]`;
  if (engine === "mysql") return `\`${name.replace(/`/g, "``")}\``;
  return `"${name.replace(/"/g, '""')}"`;
}

/** Fully-qualified, correctly-quoted reference to a database object. */
export function qualifiedName(engine: DbEngine, obj: DbObject): string {
  const bare = quoteIdent(engine, obj.name);
  return obj.schema ? `${quoteIdent(engine, obj.schema)}.${bare}` : bare;
}

/** Row-limited SELECT against an already-quoted target, in the engine's own syntax. */
function previewQuery(engine: DbEngine, target: string, limit: number): string {
  if (engine === "mssql") return `SELECT TOP ${limit} * FROM ${target}`;
  if (engine === "oracle") return `SELECT * FROM ${target} FETCH FIRST ${limit} ROWS ONLY`;
  return `SELECT * FROM ${target} LIMIT ${limit}`;
}

/**
 * "Show me this table" query for the object explorer. Engine-specific because
 * `LIMIT` is not valid T-SQL and not valid in older Oracle.
 */
export function selectPreviewSql(engine: DbEngine, obj: DbObject, limit = 100): string {
  return `${previewQuery(engine, qualifiedName(engine, obj), limit)};`;
}

export const SQL_KEYWORDS = [
  "SELECT", "FROM", "WHERE", "GROUP BY", "ORDER BY", "HAVING", "LIMIT", "OFFSET",
  "INSERT INTO", "VALUES", "UPDATE", "SET", "DELETE FROM", "JOIN", "LEFT JOIN",
  "RIGHT JOIN", "INNER JOIN", "FULL JOIN", "CROSS JOIN", "ON", "AS", "AND", "OR",
  "NOT", "NULL", "IS NULL", "IS NOT NULL", "IN", "EXISTS", "BETWEEN", "LIKE",
  "DISTINCT", "COUNT", "SUM", "AVG", "MIN", "MAX", "COALESCE", "CASE", "WHEN",
  "THEN", "ELSE", "END", "WITH", "UNION", "UNION ALL", "CAST", "CURRENT_TIMESTAMP",
] as const;

export type SqlCompletionKind = "keyword" | "table" | "view" | "routine" | "column" | "snippet";

export interface SqlCompletion {
  label: string;
  detail: string;
  /** text to insert; may contain `$0`-style tab stops for snippet kinds */
  insertText: string;
  kind: SqlCompletionKind;
  /** snippets and schema items sort above raw keywords */
  sortText: string;
}

const ROUTINE_KINDS = new Set(["procedure", "function"]);

/**
 * Completion list for the query editor: engine snippets, then loaded schema
 * objects, then columns of the last result, then plain keywords.
 *
 * Columns come from the last executed result because `db_objects` returns object
 * names only — there is no column metadata to offer until something has run.
 */
export function sqlCompletions(opts: {
  engine: DbEngine;
  objects?: DbObject[];
  columns?: string[];
}): SqlCompletion[] {
  const { engine, objects = [], columns = [] } = opts;
  const items: SqlCompletion[] = [];

  const limitSnippet = previewQuery(engine, "${1:table}", 100);
  items.push(
    { label: "sel100", detail: "SELECT first 100 rows", insertText: limitSnippet, kind: "snippet", sortText: "0sel100" },
    { label: "cnt", detail: "COUNT(*) for a table", insertText: "SELECT COUNT(*) FROM ${1:table}", kind: "snippet", sortText: "0cnt" },
  );

  for (const o of objects) {
    const kind: SqlCompletionKind = o.kind === "view" ? "view" : ROUTINE_KINDS.has(o.kind) ? "routine" : "table";
    const qualified = qualifiedName(engine, o);
    items.push({
      label: o.schema ? `${o.schema}.${o.name}` : o.name,
      detail: o.kind,
      insertText: qualified,
      kind,
      sortText: `1${o.name}`,
    });
  }

  for (const c of dedupe(columns)) {
    items.push({ label: c, detail: "column (last result)", insertText: quoteIdent(engine, c), kind: "column", sortText: `2${c}` });
  }

  for (const kw of SQL_KEYWORDS) {
    items.push({ label: kw, detail: "keyword", insertText: kw, kind: "keyword", sortText: `3${kw}` });
  }

  return items;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
