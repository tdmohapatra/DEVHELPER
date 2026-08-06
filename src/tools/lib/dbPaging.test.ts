import { describe, it, expect } from "vitest";
import { pageableStatement, pagedSql, stripOrderBy, countSql, pageLabel, lastPageIndex } from "./dbPaging";

const q = (sql: string) => {
  const p = pageableStatement(sql);
  if (!p) throw new Error(`expected pageable: ${sql}`);
  return p;
};

describe("pageableStatement", () => {
  it("accepts a plain SELECT", () => {
    const p = q("SELECT * FROM users");
    expect(p.body).toBe("SELECT * FROM users");
    expect(p.hasOrderBy).toBe(false);
  });

  it("drops the trailing semicolon and surrounding whitespace", () => {
    expect(q("  SELECT 1 ;  ").body).toBe("SELECT 1");
  });

  it("accepts a CTE", () => {
    expect(q("WITH c AS (SELECT 1 AS n) SELECT * FROM c")).toBeTruthy();
  });

  it("flags a top-level ORDER BY", () => {
    expect(q("SELECT * FROM users ORDER BY id DESC").hasOrderBy).toBe(true);
  });

  it("ignores an ORDER BY nested in a subquery", () => {
    expect(q("SELECT * FROM (SELECT id FROM users ORDER BY id) t").hasOrderBy).toBe(false);
  });

  it("refuses anything that is not a SELECT", () => {
    expect(pageableStatement("UPDATE users SET a = 1")).toBeNull();
    expect(pageableStatement("EXEC sp_who")).toBeNull();
  });

  it("refuses a multi-statement script", () => {
    expect(pageableStatement("SELECT 1; SELECT 2;")).toBeNull();
  });

  it("refuses a query that already windows itself", () => {
    expect(pageableStatement("SELECT * FROM users LIMIT 10")).toBeNull();
    expect(pageableStatement("SELECT * FROM users ORDER BY id OFFSET 5 ROWS FETCH NEXT 5 ROWS ONLY")).toBeNull();
  });

  it("allows a LIMIT that only appears inside a subquery", () => {
    expect(q("SELECT * FROM (SELECT id FROM users LIMIT 10) t")).toBeTruthy();
  });

  it("refuses SELECT ... INTO, which creates a table rather than a result set", () => {
    expect(pageableStatement("SELECT * INTO #tmp FROM users")).toBeNull();
  });

  it("is not fooled by keywords inside literals or comments", () => {
    expect(q("SELECT 'limit 5' AS s FROM t -- order by nothing")).toMatchObject({ hasOrderBy: false });
  });

  it("leads with SELECT even when a comment comes first", () => {
    expect(q("-- listing\nSELECT * FROM users").body).toBe("SELECT * FROM users");
  });
});

describe("pagedSql", () => {
  it("appends LIMIT/OFFSET for postgres and sqlite", () => {
    expect(pagedSql("postgres", q("SELECT * FROM users"), 200, 100)).toBe("SELECT * FROM users LIMIT 100 OFFSET 200");
    expect(pagedSql("sqlite", q("SELECT * FROM users"), 0, 50)).toBe("SELECT * FROM users LIMIT 50 OFFSET 0");
  });

  it("uses MySQL's offset-first LIMIT form", () => {
    expect(pagedSql("mysql", q("SELECT * FROM users"), 40, 20)).toBe("SELECT * FROM users LIMIT 40, 20");
  });

  it("supplies the ORDER BY that SQL Server requires before OFFSET", () => {
    expect(pagedSql("mssql", q("SELECT * FROM users"), 0, 25)).toBe(
      "SELECT * FROM users ORDER BY (SELECT NULL) OFFSET 0 ROWS FETCH NEXT 25 ROWS ONLY",
    );
  });

  it("keeps the user's own ORDER BY instead of adding one", () => {
    expect(pagedSql("mssql", q("SELECT * FROM users ORDER BY id"), 10, 10)).toBe(
      "SELECT * FROM users ORDER BY id OFFSET 10 ROWS FETCH NEXT 10 ROWS ONLY",
    );
  });

  it("omits the filler ORDER BY on Oracle, which does not need one", () => {
    expect(pagedSql("oracle", q("SELECT * FROM users"), 5, 5)).toBe(
      "SELECT * FROM users OFFSET 5 ROWS FETCH NEXT 5 ROWS ONLY",
    );
  });

  it("clamps a negative offset and a zero page size", () => {
    expect(pagedSql("postgres", q("SELECT 1"), -10, 0)).toBe("SELECT 1 LIMIT 1 OFFSET 0");
  });

  it("truncates fractional values so nothing unquoted reaches the SQL", () => {
    expect(pagedSql("postgres", q("SELECT 1"), 10.9, 5.7)).toBe("SELECT 1 LIMIT 5 OFFSET 10");
  });
});

describe("stripOrderBy", () => {
  it("cuts a top-level ORDER BY", () => {
    expect(stripOrderBy(q("SELECT * FROM users ORDER BY id DESC"))).toBe("SELECT * FROM users");
  });

  it("keeps an ORDER BY that belongs to a subquery", () => {
    const sql = "SELECT * FROM (SELECT id FROM users ORDER BY id) t";
    expect(stripOrderBy(q(sql))).toBe(sql);
  });
});

describe("countSql", () => {
  it("wraps the statement in a COUNT(*)", () => {
    expect(countSql("postgres", q("SELECT * FROM users"))).toBe("SELECT COUNT(*) AS n FROM (SELECT * FROM users) AS dh_count");
  });

  it("drops the ORDER BY, which is illegal in the derived table", () => {
    expect(countSql("mssql", q("SELECT * FROM users ORDER BY id"))).toBe(
      "SELECT COUNT(*) AS n FROM (SELECT * FROM users) AS dh_count",
    );
  });

  it("omits AS for Oracle, which rejects it on a table alias", () => {
    expect(countSql("oracle", q("SELECT * FROM users"))).toBe("SELECT COUNT(*) AS n FROM (SELECT * FROM users) dh_count");
  });

  it("gives up on a T-SQL CTE, which cannot sit inside a derived table", () => {
    expect(countSql("mssql", q("WITH c AS (SELECT 1 AS n) SELECT * FROM c"))).toBeNull();
    expect(countSql("postgres", q("WITH c AS (SELECT 1 AS n) SELECT * FROM c"))).not.toBeNull();
  });
});

describe("pageLabel", () => {
  it("shows the range and the total", () => {
    expect(pageLabel(200, 100, 12043)).toBe("rows 201–300 of 12,043");
  });

  it("omits the total while it is unknown", () => {
    expect(pageLabel(0, 50, null)).toBe("rows 1–50");
  });

  it("handles an empty page", () => {
    expect(pageLabel(0, 0, null)).toBe("no rows");
    expect(pageLabel(0, 0, 0)).toBe("0 of 0 rows");
  });
});

describe("lastPageIndex", () => {
  it("returns the 0-based last page", () => {
    expect(lastPageIndex(250, 100)).toBe(2);
    expect(lastPageIndex(200, 100)).toBe(1);
  });

  it("returns page 0 for an empty result", () => {
    expect(lastPageIndex(0, 100)).toBe(0);
  });

  it("is null when the total is unknown", () => {
    expect(lastPageIndex(null, 100)).toBeNull();
  });
});
