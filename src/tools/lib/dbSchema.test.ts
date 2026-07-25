import { describe, it, expect } from "vitest";
import { columnsQuery, pkQuery, normalizeColumns, buildCreateTable } from "./dbSchema";
import type { QueryResult } from "./dbTypes";

const qr = (columns: string[], rows: (string | null)[][]): QueryResult => ({ columns, rows, rowCount: rows.length, elapsedMs: 0, truncated: false });

describe("columnsQuery / pkQuery", () => {
  it("uses PRAGMA for sqlite, SHOW COLUMNS for mysql, information_schema for pg/mssql", () => {
    expect(columnsQuery("sqlite", null, "users")).toContain("PRAGMA table_info('users')");
    expect(columnsQuery("mysql", null, "users")).toContain("SHOW COLUMNS FROM `users`");
    expect(columnsQuery("postgres", "public", "users")).toContain("information_schema.columns");
    expect(columnsQuery("postgres", "public", "users")).toContain("table_schema = 'public'");
  });
  it("returns a PK query only for pg/mssql", () => {
    expect(pkQuery("postgres", "public", "t")).toContain("PRIMARY KEY");
    expect(pkQuery("mysql", null, "t")).toBeNull();
    expect(pkQuery("sqlite", null, "t")).toBeNull();
  });
});

describe("normalizeColumns", () => {
  it("parses sqlite PRAGMA table_info", () => {
    const r = qr(["cid", "name", "type", "notnull", "dflt_value", "pk"], [
      ["0", "id", "INTEGER", "1", null, "1"],
      ["1", "name", "TEXT", "0", null, "0"],
    ]);
    const cols = normalizeColumns("sqlite", r);
    expect(cols[0]).toMatchObject({ name: "id", type: "INTEGER", nullable: false, pk: true });
    expect(cols[1]).toMatchObject({ name: "name", nullable: true, pk: false });
  });

  it("parses mysql SHOW COLUMNS including PRI key", () => {
    const r = qr(["Field", "Type", "Null", "Key", "Default", "Extra"], [
      ["id", "int", "NO", "PRI", null, "auto_increment"],
      ["email", "varchar(255)", "YES", "", null, ""],
    ]);
    const cols = normalizeColumns("mysql", r);
    expect(cols[0]).toMatchObject({ name: "id", nullable: false, pk: true });
    expect(cols[1]).toMatchObject({ name: "email", nullable: true, pk: false });
  });

  it("parses postgres information_schema + a separate PK set", () => {
    const r = qr(["column_name", "data_type", "is_nullable", "column_default"], [
      ["id", "integer", "NO", "nextval('s')"],
      ["name", "text", "YES", null],
    ]);
    const pk = qr(["column_name"], [["id"]]);
    const cols = normalizeColumns("postgres", r, pk);
    expect(cols[0]).toMatchObject({ name: "id", type: "integer", nullable: false, pk: true, default: "nextval('s')" });
    expect(cols[1].pk).toBe(false);
  });
});

describe("buildCreateTable", () => {
  it("renders columns, NOT NULL, defaults and a PRIMARY KEY clause", () => {
    const out = buildCreateTable("users", [
      { name: "id", type: "int", nullable: false, pk: true },
      { name: "email", type: "varchar(255)", nullable: true, pk: false },
      { name: "active", type: "boolean", nullable: false, default: "true", pk: false },
    ]);
    expect(out).toContain("CREATE TABLE users (");
    expect(out).toContain("id int NOT NULL");
    expect(out).toContain("active boolean NOT NULL DEFAULT true");
    expect(out).toContain("PRIMARY KEY (id)");
  });
});
