import { describe, it, expect } from "vitest";
import {
  SNIPPETS,
  CATEGORY_LABELS,
  snippetsFor,
  snippetSql,
  searchSnippets,
  snippetsByCategory,
  diagnosticsFor,
} from "./dbSnippets";
import { pageableStatement } from "./dbPaging";
import type { DbEngine } from "./dbTypes";

const ENGINES: DbEngine[] = ["mssql", "postgres", "mysql", "sqlite", "oracle"];

describe("catalog integrity", () => {
  it("has unique ids", () => {
    const ids = SNIPPETS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every snippet a title, description, category and at least one engine", () => {
    for (const s of SNIPPETS) {
      expect(s.title.length, s.id).toBeGreaterThan(0);
      expect(s.description.length, s.id).toBeGreaterThan(0);
      expect(CATEGORY_LABELS[s.category], s.id).toBeDefined();
      expect(Object.keys(s.sql).length, `${s.id} has no SQL`).toBeGreaterThan(0);
    }
  });

  it("gives every snippet searchable tags", () => {
    for (const s of SNIPPETS) expect(s.tags.length, s.id).toBeGreaterThan(0);
  });

  it("only lists engines that exist", () => {
    for (const s of SNIPPETS) {
      for (const engine of Object.keys(s.sql)) {
        expect(ENGINES, `${s.id} lists ${engine}`).toContain(engine);
      }
    }
  });

  it("never has an empty SQL body", () => {
    for (const s of SNIPPETS) {
      for (const [engine, sql] of Object.entries(s.sql)) {
        expect(sql.trim().length, `${s.id}/${engine}`).toBeGreaterThan(0);
      }
    }
  });

  it("covers SQL Server for every diagnostic, since that is what the dashboard runs", () => {
    for (const s of diagnosticsFor("mssql")) expect(s.sql.mssql, s.id).toBeDefined();
  });
});

describe("snippetsFor", () => {
  it("returns only snippets written for that engine", () => {
    for (const engine of ENGINES) {
      for (const s of snippetsFor(engine)) expect(s.sql[engine], `${s.id}/${engine}`).toBeDefined();
    }
  });

  it("offers a useful number for the main engines", () => {
    expect(snippetsFor("mssql").length).toBeGreaterThan(25);
    expect(snippetsFor("postgres").length).toBeGreaterThan(20);
  });

  it("offers nothing for an engine no snippet targets", () => {
    expect(snippetsFor("oracle")).toEqual([]);
  });
});

describe("snippetSql", () => {
  it("returns null rather than another engine's SQL", () => {
    const tempdb = SNIPPETS.find((s) => s.id === "perf-tempdb")!;
    expect(snippetSql(tempdb, "mssql")).toContain("dm_db_session_space_usage");
    expect(snippetSql(tempdb, "postgres")).toBeNull();
  });
});

describe("searchSnippets", () => {
  it("matches on title", () => {
    expect(searchSnippets("mssql", "running total").map((s) => s.id)).toContain("win-running-total");
  });

  it("matches on tags", () => {
    expect(searchSnippets("mssql", "deadlock").map((s) => s.id)).toContain("act-blocking-tree");
  });

  it("narrows as terms are added rather than widening", () => {
    const broad = searchSnippets("mssql", "index");
    const narrow = searchSnippets("mssql", "index unused");
    expect(narrow.length).toBeLessThan(broad.length);
    expect(narrow.map((s) => s.id)).toContain("idx-unused");
  });

  it("returns everything for an empty query", () => {
    expect(searchSnippets("mssql", "   ")).toEqual(snippetsFor("mssql"));
  });

  it("finds nothing for nonsense instead of throwing", () => {
    expect(searchSnippets("mssql", "zzzznotathing")).toEqual([]);
  });
});

describe("snippetsByCategory", () => {
  it("groups in catalog order and drops empty groups", () => {
    const groups = snippetsByCategory(searchSnippets("mssql", "index"));
    expect(groups.every((g) => g.items.length > 0)).toBe(true);
    expect(groups.map((g) => g.category)).toContain("indexes");
  });
});

describe("diagnostics", () => {
  it("excludes teaching templates, which are written over invented tables", () => {
    for (const s of diagnosticsFor("mssql")) expect(s.template, s.id).toBeFalsy();
  });

  it("excludes the categories that only hold templates", () => {
    const categories = new Set(diagnosticsFor("mssql").map((s) => s.category));
    expect(categories.has("windows")).toBe(false);
    expect(categories.has("patterns")).toBe(false);
  });

  it("offers a real set for SQL Server", () => {
    expect(diagnosticsFor("mssql").length).toBeGreaterThan(10);
  });
});

describe("paging interaction", () => {
  it("leaves diagnostics that window themselves alone", () => {
    // Several diagnostics use TOP or LIMIT. The pager must refuse them rather
    // than append a second window and fail on SQL Server.
    const topQueries = SNIPPETS.find((s) => s.id === "perf-top-queries")!;
    expect(pageableStatement(topQueries.sql.mssql!)).toBeNull();
    expect(pageableStatement(topQueries.sql.postgres!)).toBeNull();
  });

  it("still pages a diagnostic that has no window of its own", () => {
    const sizes = SNIPPETS.find((s) => s.id === "sto-table-sizes")!;
    expect(pageableStatement(sizes.sql.mssql!)).not.toBeNull();
  });
});
