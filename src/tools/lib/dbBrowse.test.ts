import { describe, it, expect } from "vitest";
import { qualify, pageQuery, countQuery, definitionQuery, indexQuery } from "./dbBrowse";

describe("qualify", () => {
  it("schema-qualifies when a schema is present", () => {
    expect(qualify("dbo", "Users")).toBe("dbo.Users");
    expect(qualify(null, "Users")).toBe("Users");
  });
});

describe("pageQuery", () => {
  it("uses OFFSET/FETCH for mssql & oracle", () => {
    expect(pageQuery("mssql", "dbo", "Users", 100, 50)).toContain("OFFSET 100 ROWS FETCH NEXT 50 ROWS ONLY");
    expect(pageQuery("oracle", null, "Users", 0, 25)).toContain("OFFSET 0 ROWS FETCH NEXT 25 ROWS ONLY");
  });
  it("uses LIMIT offset,size for mysql", () => {
    expect(pageQuery("mysql", null, "users", 40, 20)).toBe("SELECT * FROM users LIMIT 40, 20");
  });
  it("uses LIMIT/OFFSET for postgres & sqlite", () => {
    expect(pageQuery("postgres", "public", "users", 10, 5)).toBe("SELECT * FROM public.users LIMIT 5 OFFSET 10");
    expect(pageQuery("sqlite", null, "users", 0, 50)).toBe("SELECT * FROM users LIMIT 50 OFFSET 0");
  });
});

describe("countQuery", () => {
  it("counts rows of a qualified object", () => {
    expect(countQuery("postgres", "public", "users")).toBe("SELECT COUNT(*) AS n FROM public.users");
  });
});

describe("definitionQuery", () => {
  it("returns engine-appropriate definition SQL", () => {
    expect(definitionQuery("mssql", "procedure", "dbo", "MyProc")).toContain("OBJECT_DEFINITION(OBJECT_ID('dbo.MyProc'))");
    expect(definitionQuery("mysql", "view", null, "v")).toBe("SHOW CREATE VIEW v");
    expect(definitionQuery("sqlite", "view", null, "v")).toContain("FROM sqlite_master WHERE name = 'v'");
    expect(definitionQuery("postgres", "view", "public", "v")).toContain("information_schema.views");
  });
});

describe("indexQuery", () => {
  it("returns engine-appropriate index SQL or null", () => {
    expect(indexQuery("mssql", "dbo", "Users")).toContain("sys.indexes");
    expect(indexQuery("mysql", null, "users")).toBe("SHOW INDEX FROM users");
    expect(indexQuery("sqlite", null, "users")).toBe("PRAGMA index_list('users')");
    expect(indexQuery("postgres", "public", "users")).toContain("pg_indexes");
  });
});
