import { describe, it, expect } from "vitest";
import {
  editorLanguage,
  formatterDialect,
  maskSqlNoise,
  statementSpans,
  sqlMarkers,
  quoteIdent,
  qualifiedName,
  selectPreviewSql,
  sqlCompletions,
} from "./sqlEditor";
import type { DbObject } from "./dbTypes";

describe("editorLanguage / formatterDialect", () => {
  it("maps engines to bundled monaco grammars", () => {
    expect(editorLanguage("postgres")).toBe("pgsql");
    expect(editorLanguage("mysql")).toBe("mysql");
    expect(editorLanguage("mssql")).toBe("sql");
    expect(editorLanguage("sqlite")).toBe("sql");
    expect(editorLanguage("oracle")).toBe("sql");
  });
  it("maps engines to sql-formatter dialects", () => {
    expect(formatterDialect("mssql")).toBe("tsql");
    expect(formatterDialect("postgres")).toBe("postgresql");
    expect(formatterDialect("oracle")).toBe("plsql");
    expect(formatterDialect("sqlite")).toBe("sqlite");
    expect(formatterDialect("mysql")).toBe("mysql");
  });
});

describe("maskSqlNoise", () => {
  it("preserves length exactly", () => {
    const sql = "SELECT 'a;b' -- DROP\n/* x */ FROM t";
    expect(maskSqlNoise(sql)).toHaveLength(sql.length);
  });
  it("blanks line comments, block comments and literals", () => {
    const m = maskSqlNoise("SELECT 'DROP' -- TRUNCATE\n/* DELETE */ FROM t");
    expect(m).not.toMatch(/DROP|TRUNCATE|DELETE/);
    expect(m).toContain("SELECT");
    expect(m).toContain("FROM t");
  });
  it("keeps newlines so line numbers survive", () => {
    expect(maskSqlNoise("/* a\nb */\nSELECT 1")).toBe("    \n    \nSELECT 1");
  });
  it("handles doubled quotes as escapes", () => {
    const m = maskSqlNoise("SELECT 'it''s DROP' FROM t");
    expect(m).not.toContain("DROP");
    expect(m).toContain("FROM t");
  });
  it("masks to end of input when a literal or block comment is unterminated", () => {
    expect(maskSqlNoise("SELECT 'abc")).toBe("SELECT ''''");
    expect(maskSqlNoise("SELECT /* abc").trim()).toBe("SELECT");
  });
  it("masks literals to non-whitespace so trailing literals keep their offsets", () => {
    expect(maskSqlNoise("SELECT 'a;b'")).toBe("SELECT '''''");
  });
  it("masks backtick and double-quoted identifiers", () => {
    expect(maskSqlNoise('SELECT "DROP" FROM t')).not.toContain("DROP");
    expect(maskSqlNoise("SELECT `DROP` FROM t")).not.toContain("DROP");
  });
});

describe("statementSpans", () => {
  it("returns offsets that index back into the original text", () => {
    const sql = "SELECT 1; DELETE FROM users";
    const spans = statementSpans(sql);
    expect(spans).toHaveLength(2);
    expect(sql.slice(spans[0].start, spans[0].end)).toBe("SELECT 1");
    expect(sql.slice(spans[1].start, spans[1].end)).toBe("DELETE FROM users");
  });
  it("ignores semicolons inside literals and comments", () => {
    const spans = statementSpans("SELECT 'a;b' -- c;d");
    expect(spans).toHaveLength(1);
    expect(spans[0].text).toBe("SELECT 'a;b'");
  });
  it("drops empty and comment-only fragments", () => {
    expect(statementSpans("SELECT 1;;  ; -- trailing")).toHaveLength(1);
    expect(statementSpans("   \n  ")).toHaveLength(0);
  });
  it("exposes the original text and the mask side by side", () => {
    const [span] = statementSpans("SELECT 'x' FROM t");
    expect(span.text).toBe("SELECT 'x' FROM t");
    expect(span.masked).toHaveLength(span.text.length);
    expect(span.masked).not.toContain("x");
  });
});

describe("sqlMarkers", () => {
  it("locates a destructive statement inside a script", () => {
    const sql = "SELECT 1;\nDROP TABLE users;\nSELECT 2";
    const markers = sqlMarkers(sql);
    expect(markers).toHaveLength(1);
    expect(markers[0].risk).toBe("destructive");
    expect(sql.slice(markers[0].start, markers[0].end)).toBe("DROP TABLE users");
  });
  it("marks each risky statement separately", () => {
    const markers = sqlMarkers("DELETE FROM a; ALTER TABLE b ADD c int");
    expect(markers.map((m) => m.risk)).toEqual(["unfiltered-write", "schema-change"]);
  });
  it("returns nothing for a filtered read", () => {
    expect(sqlMarkers("SELECT * FROM t WHERE id = 1")).toHaveLength(0);
  });
  it("does not flag a DROP that only appears in a comment", () => {
    expect(sqlMarkers("SELECT 1 -- DROP TABLE users")).toHaveLength(0);
  });
});

describe("quoteIdent / qualifiedName", () => {
  it("leaves plain identifiers unquoted", () => {
    expect(quoteIdent("mssql", "Users")).toBe("Users");
    expect(quoteIdent("postgres", "user_id")).toBe("user_id");
  });
  it("quotes per engine when needed", () => {
    expect(quoteIdent("mssql", "order details")).toBe("[order details]");
    expect(quoteIdent("mysql", "order details")).toBe("`order details`");
    expect(quoteIdent("postgres", "order details")).toBe('"order details"');
    expect(quoteIdent("sqlite", "2fa")).toBe('"2fa"');
  });
  it("escapes the closing delimiter", () => {
    expect(quoteIdent("mssql", "a]b c")).toBe("[a]]b c]");
    expect(quoteIdent("mysql", "a`b c")).toBe("`a``b c`");
    expect(quoteIdent("postgres", 'a"b c')).toBe('"a""b c"');
  });
  it("qualifies with the schema when present", () => {
    const obj: DbObject = { name: "Users", kind: "table", schema: "dbo" };
    expect(qualifiedName("mssql", obj)).toBe("dbo.Users");
    expect(qualifiedName("mssql", { ...obj, schema: null })).toBe("Users");
  });
});

describe("selectPreviewSql", () => {
  const users: DbObject = { name: "Users", kind: "table", schema: "dbo" };

  it("uses TOP for SQL Server, not LIMIT", () => {
    expect(selectPreviewSql("mssql", users)).toBe("SELECT TOP 100 * FROM dbo.Users;");
  });
  it("uses FETCH FIRST for Oracle", () => {
    expect(selectPreviewSql("oracle", users)).toBe("SELECT * FROM dbo.Users FETCH FIRST 100 ROWS ONLY;");
  });
  it("uses LIMIT for postgres, mysql and sqlite", () => {
    expect(selectPreviewSql("postgres", users)).toBe("SELECT * FROM dbo.Users LIMIT 100;");
    expect(selectPreviewSql("mysql", users)).toBe("SELECT * FROM dbo.Users LIMIT 100;");
    expect(selectPreviewSql("sqlite", { name: "logs", kind: "table", schema: null })).toBe("SELECT * FROM logs LIMIT 100;");
  });
  it("honours a custom limit and quotes awkward names", () => {
    expect(selectPreviewSql("mysql", { name: "order details", kind: "view", schema: null }, 10))
      .toBe("SELECT * FROM `order details` LIMIT 10;");
  });
});

describe("sqlCompletions", () => {
  const objects: DbObject[] = [
    { name: "Users", kind: "table", schema: "dbo" },
    { name: "ActiveUsers", kind: "view", schema: "dbo" },
    { name: "sp_Sync", kind: "procedure", schema: "dbo" },
  ];

  it("offers snippets, schema objects, columns and keywords", () => {
    const items = sqlCompletions({ engine: "mssql", objects, columns: ["Id", "Email"] });
    const byKind = (k: string) => items.filter((i) => i.kind === k).map((i) => i.label);
    expect(byKind("snippet")).toContain("sel100");
    expect(byKind("table")).toEqual(["dbo.Users"]);
    expect(byKind("view")).toEqual(["dbo.ActiveUsers"]);
    expect(byKind("routine")).toEqual(["dbo.sp_Sync"]);
    expect(byKind("column")).toEqual(["Id", "Email"]);
    expect(byKind("keyword")).toContain("SELECT");
  });
  it("sorts snippets and schema items above keywords", () => {
    const items = sqlCompletions({ engine: "postgres", objects, columns: ["Id"] });
    const sortOf = (label: string) => items.find((i) => i.label === label)!.sortText;
    expect(sortOf("sel100") < sortOf("dbo.Users")).toBe(true);
    expect(sortOf("dbo.Users") < sortOf("Id")).toBe(true);
    expect(sortOf("Id") < sortOf("SELECT")).toBe(true);
  });
  it("uses TOP for SQL Server and LIMIT elsewhere", () => {
    const mssql = sqlCompletions({ engine: "mssql" }).find((i) => i.label === "sel100")!;
    const pg = sqlCompletions({ engine: "postgres" }).find((i) => i.label === "sel100")!;
    expect(mssql.insertText).toContain("TOP 100");
    expect(pg.insertText).toContain("LIMIT 100");
  });
  it("inserts engine-quoted identifiers", () => {
    const items = sqlCompletions({ engine: "mysql", objects: [{ name: "order details", kind: "table", schema: null }] });
    expect(items.find((i) => i.kind === "table")!.insertText).toBe("`order details`");
  });
  it("deduplicates and drops empty column names", () => {
    const items = sqlCompletions({ engine: "sqlite", columns: ["Id", "Id", ""] });
    expect(items.filter((i) => i.kind === "column")).toHaveLength(1);
  });
  it("works with no schema loaded", () => {
    const items = sqlCompletions({ engine: "sqlite" });
    expect(items.some((i) => i.kind === "keyword")).toBe(true);
    expect(items.some((i) => i.kind === "table")).toBe(false);
  });
});
