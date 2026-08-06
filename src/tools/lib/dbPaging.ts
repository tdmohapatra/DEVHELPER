/**
 * Server-side paging for ad-hoc editor queries.
 *
 * The native layer caps every result at `maxRows`, so a big SELECT comes back
 * truncated with no way to reach the rest. These helpers turn a single SELECT
 * into a windowed one so the grid can walk through it a page at a time.
 *
 * The window is APPENDED to the user's statement rather than wrapped in a
 * derived table. Wrapping looks tidier but breaks in three real cases:
 * duplicate column names from `SELECT a.*, b.*` (an error in PostgreSQL, MySQL
 * and SQL Server), a CTE inside a derived table (illegal in T-SQL), and
 * Oracle's ban on `AS` for table aliases. Every engine here accepts a trailing
 * LIMIT/OFFSET or OFFSET/FETCH on any SELECT, CTE included.
 */

import type { DbEngine } from "./dbTypes";
import { statementSpans } from "./sqlEditor";

export interface PageableQuery {
  /** the single statement, semicolon and surrounding whitespace removed */
  body: string;
  /** same span with comments/literals blanked — safe for keyword tests */
  masked: string;
  /** the statement already carries a top-level ORDER BY */
  hasOrderBy: boolean;
}

/** Index of the first top-level (paren depth 0) match, or -1. */
function topLevelIndex(masked: string, re: RegExp): number {
  const scan = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  let depth = 0;
  const depthAt: number[] = [];
  for (let i = 0; i < masked.length; i++) {
    depthAt[i] = depth;
    if (masked[i] === "(") depth++;
    else if (masked[i] === ")") depth = Math.max(0, depth - 1);
  }
  let m: RegExpExecArray | null;
  while ((m = scan.exec(masked)) !== null) {
    if (depthAt[m.index] === 0) return m.index;
    if (m.index === scan.lastIndex) scan.lastIndex++; // guard zero-width
  }
  return -1;
}

const ORDER_BY = /\border\s+by\b/i;
// A window the user wrote themselves. Paging on top of one would silently
// change what they asked for, so those statements are left alone.
const OWN_WINDOW = /\b(limit|offset|fetch\s+(first|next))\b/i;
/**
 * TOP is checked at any depth, unlike the rest.
 *
 * T-SQL rejects TOP and OFFSET together outright — "A TOP can not be used in
 * the same query or sub-query as a OFFSET" — so appending a window to
 * `SELECT TOP 10 *` does not merely change the meaning, it fails to run. The
 * server's rule is per query block, which would make a TOP inside a derived
 * table harmless, but the error text says "or sub-query" and being wrong costs
 * a failed query. Refusing at any depth costs only the pager.
 */
const ANY_TOP = /\btop\b/i;
// `SELECT ... INTO t` creates a table; it is not a result set to page through.
const SELECT_INTO = /\binto\b/i;

/**
 * Can this SQL be paged? Only a single SELECT/WITH with no window of its own.
 * Returns null when it cannot — the caller then runs the statement unchanged.
 */
export function pageableStatement(sql: string): PageableQuery | null {
  const spans = statementSpans(sql);
  if (spans.length !== 1) return null;
  const { text, masked } = spans[0];
  if (!/^\s*(select|with)\b/i.test(masked)) return null;
  if (topLevelIndex(masked, OWN_WINDOW) >= 0) return null;
  if (ANY_TOP.test(masked)) return null;
  if (topLevelIndex(masked, SELECT_INTO) >= 0) return null;
  return { body: text, masked, hasOrderBy: topLevelIndex(masked, ORDER_BY) >= 0 };
}

/**
 * The statement windowed to one page. `offset` and `size` are row counts.
 *
 * SQL Server requires an ORDER BY before OFFSET; when the query has none,
 * `ORDER BY (SELECT NULL)` supplies the mandatory clause without imposing an
 * order. Row order across pages is then whatever the server returns, the same
 * caveat that applies to any unordered query.
 */
export function pagedSql(engine: DbEngine, q: PageableQuery, offset: number, size: number): string {
  const off = Math.max(0, Math.trunc(offset));
  const n = Math.max(1, Math.trunc(size));
  switch (engine) {
    case "mssql": {
      const order = q.hasOrderBy ? "" : " ORDER BY (SELECT NULL)";
      return `${q.body}${order} OFFSET ${off} ROWS FETCH NEXT ${n} ROWS ONLY`;
    }
    case "oracle":
      return `${q.body} OFFSET ${off} ROWS FETCH NEXT ${n} ROWS ONLY`;
    case "mysql":
      return `${q.body} LIMIT ${off}, ${n}`;
    default: // postgres, sqlite
      return `${q.body} LIMIT ${n} OFFSET ${off}`;
  }
}

/** Cut a top-level ORDER BY: it is illegal inside the count's derived table and pointless there. */
export function stripOrderBy(q: PageableQuery): string {
  const i = topLevelIndex(q.masked, ORDER_BY);
  return i < 0 ? q.body : q.body.slice(0, i).trimEnd();
}

/**
 * Total row count for the statement, or null when it cannot be expressed.
 *
 * This one has to wrap, so it inherits the wrapping hazards: T-SQL rejects a
 * CTE inside a derived table, and every engine rejects duplicate column names
 * there. Callers must treat a failure as "unknown total", not as an error.
 */
export function countSql(engine: DbEngine, q: PageableQuery): string | null {
  const isCte = /^\s*with\b/i.test(q.masked);
  if (engine === "mssql" && isCte) return null;
  const inner = stripOrderBy(q);
  // Oracle has no AS for table aliases, and no identifier may start with `_`.
  const alias = engine === "oracle" ? "dh_count" : "AS dh_count";
  return `SELECT COUNT(*) AS n FROM (${inner}) ${alias}`;
}

/** Human range label for the current page, e.g. "rows 201–400 of 12,043". */
export function pageLabel(offset: number, fetched: number, total: number | null): string {
  if (fetched === 0) return total === null ? "no rows" : `0 of ${total.toLocaleString()} rows`;
  const from = offset + 1;
  const to = offset + fetched;
  const of = total === null ? "" : ` of ${total.toLocaleString()}`;
  return `rows ${from.toLocaleString()}–${to.toLocaleString()}${of}`;
}

/** Last 0-based page index for a known total, or null when the total is unknown. */
export function lastPageIndex(total: number | null, size: number): number | null {
  if (total === null || size <= 0) return null;
  return Math.max(0, Math.ceil(total / size) - 1);
}
