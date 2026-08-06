import { describe, it, expect } from "vitest";
import { allColumnsQuery, buildSnapshot, serializeSnapshot, parseSnapshotFile, mergePages } from "./dbSnapshot";
import type { QueryResult } from "./dbTypes";

const COLS = ["table_schema", "table_name", "column_name", "data_type", "is_nullable", "column_default", "ordinal_position", "is_pk"];
const qr = (rows: (string | null)[][]): QueryResult => ({ columns: COLS, rows, rowCount: rows.length, elapsedMs: 1, truncated: false });

describe("allColumnsQuery", () => {
  it("returns the uniform alias set for every engine", () => {
    for (const engine of ["postgres", "mysql", "mssql", "sqlite", "oracle"] as const) {
      const sql = allColumnsQuery(engine);
      for (const alias of ["table_name", "column_name", "data_type", "is_nullable", "ordinal_position", "is_pk"]) {
        expect(sql, `${engine} is missing ${alias}`).toContain(alias);
      }
    }
  });

  it("excludes the catalog schemas on postgres", () => {
    expect(allColumnsQuery("postgres")).toContain("pg_catalog");
  });

  it("scopes MySQL to the connected database", () => {
    expect(allColumnsQuery("mysql")).toContain("TABLE_SCHEMA = DATABASE()");
  });

  it("uses COLUMN_TYPE on MySQL so the declared length survives", () => {
    expect(allColumnsQuery("mysql")).toContain("COLUMN_TYPE AS data_type");
  });

  it("skips SQLite's internal tables", () => {
    expect(allColumnsQuery("sqlite")).toContain("NOT LIKE 'sqlite_%'");
  });
});

describe("buildSnapshot", () => {
  const result = qr([
    ["public", "users", "id", "integer", "NO", null, "1", "YES"],
    ["public", "users", "email", "varchar(255)", "YES", null, "2", "NO"],
    ["public", "orders", "id", "integer", "NO", null, "1", "YES"],
  ]);

  it("groups columns by table", () => {
    const s = buildSnapshot("postgres", "dev", result, 1000);
    expect(s.tables.map((t) => t.name)).toEqual(["orders", "users"]); // sorted
    expect(s.tables.find((t) => t.name === "users")!.columns.map((c) => c.name)).toEqual(["id", "email"]);
  });

  it("normalizes nullability, keys and position", () => {
    const users = buildSnapshot("postgres", "dev", result, 1000).tables.find((t) => t.name === "users")!;
    expect(users.columns[0]).toMatchObject({ name: "id", type: "integer", nullable: false, pk: true, position: 1 });
    expect(users.columns[1]).toMatchObject({ name: "email", nullable: true, pk: false, position: 2 });
  });

  it("carries the label, engine and capture time", () => {
    expect(buildSnapshot("mysql", "prod", result, 42)).toMatchObject({ engine: "mysql", label: "prod", capturedAt: 42 });
  });

  it("treats a null schema as no schema", () => {
    const s = buildSnapshot("sqlite", "file", qr([[null, "t", "a", "TEXT", "YES", null, "1", "NO"]]), 0);
    expect(s.tables[0].schema).toBeNull();
  });

  it("keeps same-named tables in different schemas apart", () => {
    const s = buildSnapshot("postgres", "dev", qr([
      ["a", "t", "x", "int", "YES", null, "1", "NO"],
      ["b", "t", "y", "int", "YES", null, "1", "NO"],
    ]), 0);
    expect(s.tables).toHaveLength(2);
  });

  it("skips rows with no table or column name", () => {
    const s = buildSnapshot("postgres", "dev", qr([[null, null, null, null, null, null, null, null]]), 0);
    expect(s.tables).toEqual([]);
  });
});

describe("mergePages", () => {
  it("concatenates rows and sums the elapsed time", () => {
    const a = qr([["s", "t", "a", "int", "YES", null, "1", "NO"]]);
    const b = qr([["s", "t", "b", "int", "YES", null, "2", "NO"]]);
    const merged = mergePages([a, b]);
    expect(merged.rows).toHaveLength(2);
    expect(merged.rowCount).toBe(2);
    expect(merged.elapsedMs).toBe(2);
  });

  it("takes headers from the first page that has them", () => {
    const empty: QueryResult = { columns: [], rows: [], rowCount: 0, elapsedMs: 0, truncated: false };
    expect(mergePages([empty, qr([["s", "t", "a", "int", "YES", null, "1", "NO"]])]).columns).toEqual(COLS);
  });

  it("stays truncated if any page was", () => {
    const cut = { ...qr([]), truncated: true };
    expect(mergePages([qr([]), cut]).truncated).toBe(true);
  });

  it("handles no pages at all", () => {
    expect(mergePages([])).toMatchObject({ columns: [], rows: [], rowCount: 0 });
  });
});

describe("snapshot round trip", () => {
  it("survives serialize then parse", () => {
    const s = buildSnapshot("postgres", "dev", qr([["public", "t", "a", "int", "NO", "0", "1", "YES"]]), 7);
    expect(parseSnapshotFile(serializeSnapshot(s))).toEqual(s);
  });

  it("rejects a file that is not a snapshot", () => {
    expect(() => parseSnapshotFile('{"kind":"something-else"}')).toThrow(/not a devhelper schema snapshot/i);
    expect(() => parseSnapshotFile('{"kind":"devhelper-schema"}')).toThrow(/tables/i);
  });
});
