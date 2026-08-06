import { describe, it, expect } from "vitest";
import {
  DEFAULT_DIFF_OPTIONS,
  normalizeType,
  columnChanges,
  diffSchemas,
  changedTables,
  migrationSql,
  diffSummary,
  type DiffOptions,
} from "./dbDiff";
import type { SchemaSnapshot, SnapshotColumn, SnapshotTable } from "./dbSnapshot";
import type { DbEngine } from "./dbTypes";

const col = (name: string, type: string, extra: Partial<SnapshotColumn> = {}): SnapshotColumn => ({
  name, type, nullable: true, default: null, pk: false, position: 1, ...extra,
});

const table = (name: string, columns: SnapshotColumn[], schema: string | null = "public"): SnapshotTable => ({ schema, name, columns });

const snap = (label: string, tables: SnapshotTable[], engine: DbEngine = "postgres"): SchemaSnapshot => ({
  version: 1, kind: "devhelper-schema", engine, label, capturedAt: 0, tables,
});

const opts = (over: Partial<DiffOptions> = {}): DiffOptions => ({ ...DEFAULT_DIFF_OPTIONS, ...over });

describe("normalizeType", () => {
  it("folds known spellings onto one name", () => {
    expect(normalizeType("INT4", true)).toBe("int");
    expect(normalizeType("integer", true)).toBe("int");
    expect(normalizeType("character varying(50)", true)).toBe("varchar(50)");
    expect(normalizeType("NVARCHAR(50)", true)).toBe("varchar(50)");
  });

  it("keeps the declared length, because a shortened column is real drift", () => {
    expect(normalizeType("varchar(50)", true)).not.toBe(normalizeType("varchar(200)", true));
  });

  it("only lowercases when aliasing is off", () => {
    expect(normalizeType("INT4", false)).toBe("int4");
  });

  it("leaves an unknown type alone", () => {
    expect(normalizeType("geography", true)).toBe("geography");
  });
});

describe("columnChanges", () => {
  it("reports a type change", () => {
    expect(columnChanges(col("a", "int"), col("a", "bigint"), opts())).toEqual(["type int → bigint"]);
  });

  it("says nothing when only the spelling differs", () => {
    expect(columnChanges(col("a", "int4"), col("a", "integer"), opts())).toEqual([]);
    expect(columnChanges(col("a", "int4"), col("a", "integer"), opts({ ignoreTypeAliases: false }))).toHaveLength(1);
  });

  it("reports nullability in both directions", () => {
    expect(columnChanges(col("a", "int", { nullable: false }), col("a", "int"), opts())).toEqual(["NOT NULL → nullable"]);
    expect(columnChanges(col("a", "int"), col("a", "int", { nullable: false }), opts())).toEqual(["nullable → NOT NULL"]);
  });

  it("reports a default change unless defaults are ignored", () => {
    const l = col("a", "int", { default: "0" });
    const r = col("a", "int", { default: "1" });
    expect(columnChanges(l, r, opts())).toEqual(["default 0 → 1"]);
    expect(columnChanges(l, r, opts({ ignoreDefaults: true }))).toEqual([]);
  });

  it("treats a null default and an empty one as the same absence", () => {
    expect(columnChanges(col("a", "int", { default: null }), col("a", "int", { default: "  " }), opts())).toEqual([]);
  });

  it("reports primary-key membership", () => {
    expect(columnChanges(col("a", "int"), col("a", "int", { pk: true }), opts())).toEqual(["became part of the primary key"]);
  });

  it("reports position only when order matters", () => {
    const l = col("a", "int", { position: 1 });
    const r = col("a", "int", { position: 3 });
    expect(columnChanges(l, r, opts())).toEqual([]);
    expect(columnChanges(l, r, opts({ ignoreOrder: false }))).toEqual(["position 1 → 3"]);
  });
});

describe("diffSchemas", () => {
  const left = snap("dev", [
    table("users", [col("id", "int", { pk: true, nullable: false }), col("email", "varchar(50)")]),
    table("legacy", [col("id", "int")]),
  ]);
  const right = snap("prod", [
    table("users", [col("id", "int", { pk: true, nullable: false }), col("email", "varchar(200)"), col("created", "timestamp")]),
    table("audit", [col("id", "int")]),
  ]);

  it("classifies tables from the left side's point of view", () => {
    const d = diffSchemas(left, right, opts());
    const byName = Object.fromEntries(d.tables.map((t) => [t.name, t.kind]));
    expect(byName).toEqual({ users: "changed", legacy: "removed", audit: "added" });
  });

  it("classifies columns within a changed table", () => {
    const users = diffSchemas(left, right, opts()).tables.find((t) => t.name === "users")!;
    const byName = Object.fromEntries(users.columns.map((c) => [c.name, c.kind]));
    expect(byName).toEqual({ id: "same", email: "changed", created: "added" });
  });

  it("counts and summarises", () => {
    const d = diffSchemas(left, right, opts());
    expect(d.counts).toEqual({ added: 1, removed: 1, changed: 1, same: 0 });
    expect(d.identical).toBe(false);
    expect(diffSummary(d)).toBe("1 added · 1 removed · 1 changed · 0 identical");
  });

  it("reports an identical schema as identical", () => {
    const d = diffSchemas(left, left, opts());
    expect(d.identical).toBe(true);
    expect(changedTables(d)).toEqual([]);
    expect(diffSummary(d)).toBe("Schemas match — 2 tables compared");
  });

  it("matches names case-insensitively by default", () => {
    const upper = snap("other", [table("USERS", [col("ID", "int", { pk: true, nullable: false }), col("EMAIL", "varchar(50)")])]);
    const only = snap("dev", [left.tables[0]]);
    expect(diffSchemas(only, upper, opts()).identical).toBe(true);
    expect(diffSchemas(only, upper, opts({ ignoreCase: false })).counts).toMatchObject({ added: 1, removed: 1 });
  });

  it("can match across differing schema names", () => {
    const a = snap("pg", [table("t", [col("id", "int")], "public")]);
    const b = snap("sqlite", [table("t", [col("id", "int")], null)]);
    expect(diffSchemas(a, b, opts()).identical).toBe(false);
    expect(diffSchemas(a, b, opts({ ignoreSchema: true })).identical).toBe(true);
  });

  it("keeps the labels for the report header", () => {
    expect(diffSchemas(left, right, opts())).toMatchObject({ leftLabel: "dev", rightLabel: "prod" });
  });
});

describe("migrationSql", () => {
  const left = snap("dev", [table("users", [col("id", "int", { pk: true, nullable: false })]), table("legacy", [col("id", "int")])]);
  const right = snap("prod", [
    table("users", [col("id", "int", { pk: true, nullable: false }), col("email", "varchar(200)")]),
    table("audit", [col("id", "int", { nullable: false })]),
  ]);
  const sql = (engine: DbEngine = "postgres") => migrationSql(engine, diffSchemas(left, right, opts()));

  it("names the direction it migrates", () => {
    expect(sql()).toContain("dev → prod");
  });

  it("creates a table that only the right side has", () => {
    expect(sql()).toContain("CREATE TABLE public.audit");
  });

  it("never emits an uncommented drop", () => {
    const body = sql();
    expect(body).toContain("-- DROP TABLE public.legacy;");
    for (const line of body.split("\n")) {
      if (/\bDROP\b/.test(line)) expect(line.trimStart().startsWith("--"), line).toBe(true);
    }
  });

  it("adds a missing column", () => {
    expect(sql()).toContain("ALTER TABLE public.users ADD COLUMN email varchar(200);");
    expect(sql("mssql")).toContain("ALTER TABLE public.users ADD email varchar(200);");
  });

  it("warns when a NOT NULL column is added with no default", () => {
    const l = snap("a", [table("t", [col("id", "int")])]);
    const r = snap("b", [table("t", [col("id", "int"), col("flag", "int", { nullable: false })])]);
    expect(migrationSql("postgres", diffSchemas(l, r, opts()))).toContain("NOT NULL with no default");
  });

  it("emits the engine's own ALTER for a retyped column", () => {
    const l = snap("a", [table("t", [col("c", "int")])]);
    const r = snap("b", [table("t", [col("c", "bigint")])]);
    const d = diffSchemas(l, r, opts());
    expect(migrationSql("postgres", d)).toContain("ALTER TABLE public.t ALTER COLUMN c TYPE bigint;");
    expect(migrationSql("mysql", d)).toContain("ALTER TABLE public.t MODIFY COLUMN c bigint NULL;");
    expect(migrationSql("mssql", d)).toContain("ALTER TABLE public.t ALTER COLUMN c bigint NULL;");
    expect(migrationSql("oracle", d)).toContain("ALTER TABLE public.t MODIFY (c bigint NULL);");
    expect(migrationSql("sqlite", d)).toContain("SQLite cannot alter a column");
  });

  it("leaves a default or key change as a note rather than guessing the DDL", () => {
    const l = snap("a", [table("t", [col("c", "int", { default: "0" })])]);
    const r = snap("b", [table("t", [col("c", "int", { default: "1" })])]);
    const body = migrationSql("postgres", diffSchemas(l, r, opts()));
    expect(body).toContain("-- c: default 0 → 1 — apply by hand.");
    expect(body).not.toContain("ALTER COLUMN c TYPE");
  });

  it("says so when there is nothing to migrate", () => {
    expect(migrationSql("postgres", diffSchemas(left, left, opts()))).toContain("nothing to do");
  });
});
