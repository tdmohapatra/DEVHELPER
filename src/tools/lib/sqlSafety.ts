/**
 * Lightweight, dependency-free static checks for dangerous SQL.
 *
 * This is a safety net, not a parser. It errs toward warning: it strips string
 * literals and comments first (so text inside quotes/comments never triggers a
 * finding), then scans for destructive statements. Used to gate execution behind
 * a confirmation, and to hard-block writes when a connection is in safe mode.
 */

export type SqlRisk = "destructive" | "unfiltered-write" | "schema-change";

export interface SqlFinding {
  risk: SqlRisk;
  statement: string;
  message: string;
}

/** Remove string/identifier literals and comments so keyword scanning is not fooled by them. */
export function stripSqlNoise(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, " ") // line comments
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments
    .replace(/'(?:''|[^'])*'/g, "''") // single-quoted strings
    .replace(/"(?:""|[^"])*"/g, '""') // double-quoted identifiers
    .replace(/`(?:``|[^`])*`/g, "``"); // backtick identifiers
}

/** Split a script into individual statements on semicolons, ignoring those inside literals. */
export function splitStatements(sql: string): string[] {
  const cleaned = stripSqlNoise(sql);
  // Split the cleaned text, then map spans back is overkill here — callers only need
  // the cleaned statement text for keyword analysis, so return cleaned fragments.
  return cleaned
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

const DESTRUCTIVE = /\b(DROP|TRUNCATE)\b/i;
const SCHEMA_CHANGE = /\b(ALTER|CREATE)\s+(TABLE|DATABASE|SCHEMA|INDEX|VIEW|PROCEDURE|FUNCTION|TRIGGER)\b/i;
const WRITE = /\b(DELETE|UPDATE)\b/i;
const HAS_WHERE = /\bWHERE\b/i;

/** Analyze SQL and return findings, most dangerous first. Empty = looks read-only/safe. */
export function analyzeSql(sql: string): SqlFinding[] {
  const findings: SqlFinding[] = [];
  for (const stmt of splitStatements(sql)) {
    if (DESTRUCTIVE.test(stmt)) {
      const kw = /\bDROP\b/i.test(stmt) ? "DROP" : "TRUNCATE";
      findings.push({ risk: "destructive", statement: stmt, message: `${kw} permanently removes data or objects.` });
      continue;
    }
    if (WRITE.test(stmt)) {
      const kw = /\bUPDATE\b/i.test(stmt) ? "UPDATE" : "DELETE";
      if (!HAS_WHERE.test(stmt)) {
        findings.push({ risk: "unfiltered-write", statement: stmt, message: `${kw} without a WHERE clause affects every row.` });
      }
      continue;
    }
    if (SCHEMA_CHANGE.test(stmt)) {
      findings.push({ risk: "schema-change", statement: stmt, message: "Schema change (ALTER/CREATE) modifies database structure." });
    }
  }
  return findings;
}

/** True if the SQL contains any statement that writes or changes structure (not a pure read). */
export function isWriteSql(sql: string): boolean {
  const cleaned = stripSqlNoise(sql);
  return /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|MERGE|GRANT|REVOKE)\b/i.test(cleaned);
}

/** Highest-severity risk in the SQL, or null if none. */
export function highestRisk(findings: SqlFinding[]): SqlRisk | null {
  if (findings.some((f) => f.risk === "destructive")) return "destructive";
  if (findings.some((f) => f.risk === "unfiltered-write")) return "unfiltered-write";
  if (findings.some((f) => f.risk === "schema-change")) return "schema-change";
  return null;
}
