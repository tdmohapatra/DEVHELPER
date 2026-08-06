/**
 * Whole-schema snapshots, for comparing one database against another.
 *
 * The per-object queries in `dbSchema.ts` cost one round trip per table, which
 * is fine for the details panel and hopeless for a 400-table schema. These read
 * every column in a single query and normalize the engine-specific shapes into
 * one structure that the differ can work on.
 *
 * A snapshot is also serializable, so a production schema can be captured once,
 * exported, and diffed later from a machine that cannot reach that server.
 */

import type { DbEngine, QueryResult } from "./dbTypes";

export interface SnapshotColumn {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  pk: boolean;
  /** 1-based ordinal position within the table */
  position: number;
}

export interface SnapshotTable {
  schema: string | null;
  name: string;
  columns: SnapshotColumn[];
}

export interface SchemaSnapshot {
  version: 1;
  kind: "devhelper-schema";
  engine: DbEngine;
  /** human label — usually the connection name */
  label: string;
  capturedAt: number;
  tables: SnapshotTable[];
}

/**
 * One query returning every column in the current database.
 *
 * Column aliases are uniform across engines (`table_schema`, `table_name`,
 * `column_name`, `data_type`, `is_nullable`, `column_default`,
 * `ordinal_position`, `is_pk`) so `buildSnapshot` needs no per-engine branch.
 * `data_type` carries the declared length where the engine exposes one,
 * because `varchar(50)` vs `varchar(200)` is exactly the drift worth catching.
 */
export function allColumnsQuery(engine: DbEngine): string {
  switch (engine) {
    case "postgres":
      return (
        `SELECT c.table_schema, c.table_name, c.column_name, ` +
        `c.data_type || COALESCE('(' || c.character_maximum_length || ')', '') AS data_type, ` +
        `c.is_nullable, c.column_default, c.ordinal_position, ` +
        `CASE WHEN pk.column_name IS NULL THEN 'NO' ELSE 'YES' END AS is_pk ` +
        `FROM information_schema.columns c ` +
        `LEFT JOIN (SELECT tc.table_schema, tc.table_name, kcu.column_name ` +
        `FROM information_schema.table_constraints tc ` +
        `JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name ` +
        `AND tc.table_schema = kcu.table_schema WHERE tc.constraint_type = 'PRIMARY KEY') pk ` +
        `ON pk.table_schema = c.table_schema AND pk.table_name = c.table_name AND pk.column_name = c.column_name ` +
        `WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema') ` +
        `ORDER BY c.table_schema, c.table_name, c.ordinal_position`
      );
    case "mssql":
      return (
        `SELECT c.TABLE_SCHEMA AS table_schema, c.TABLE_NAME AS table_name, c.COLUMN_NAME AS column_name, ` +
        `c.DATA_TYPE + ISNULL('(' + CASE WHEN c.CHARACTER_MAXIMUM_LENGTH = -1 THEN 'max' ` +
        `ELSE CAST(c.CHARACTER_MAXIMUM_LENGTH AS varchar(11)) END + ')', '') AS data_type, ` +
        `c.IS_NULLABLE AS is_nullable, c.COLUMN_DEFAULT AS column_default, c.ORDINAL_POSITION AS ordinal_position, ` +
        `CASE WHEN pk.COLUMN_NAME IS NULL THEN 'NO' ELSE 'YES' END AS is_pk ` +
        `FROM INFORMATION_SCHEMA.COLUMNS c ` +
        `LEFT JOIN (SELECT tc.TABLE_SCHEMA, tc.TABLE_NAME, kcu.COLUMN_NAME ` +
        `FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc ` +
        `JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME ` +
        `AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY') pk ` +
        `ON pk.TABLE_SCHEMA = c.TABLE_SCHEMA AND pk.TABLE_NAME = c.TABLE_NAME AND pk.COLUMN_NAME = c.COLUMN_NAME ` +
        `ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION`
      );
    case "mysql":
      // COLUMN_TYPE already carries the length and unsigned flag; DATA_TYPE does not.
      return (
        `SELECT TABLE_SCHEMA AS table_schema, TABLE_NAME AS table_name, COLUMN_NAME AS column_name, ` +
        `COLUMN_TYPE AS data_type, IS_NULLABLE AS is_nullable, COLUMN_DEFAULT AS column_default, ` +
        `ORDINAL_POSITION AS ordinal_position, ` +
        `CASE WHEN COLUMN_KEY = 'PRI' THEN 'YES' ELSE 'NO' END AS is_pk ` +
        `FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ` +
        `ORDER BY TABLE_NAME, ORDINAL_POSITION`
      );
    case "sqlite":
      // pragma_table_info as a table-valued function (SQLite 3.16+) turns the
      // per-table PRAGMA into one join. `notnull` is a keyword, hence the quotes.
      return (
        `SELECT NULL AS table_schema, m.name AS table_name, p.name AS column_name, p.type AS data_type, ` +
        `CASE WHEN p."notnull" = 0 THEN 'YES' ELSE 'NO' END AS is_nullable, ` +
        `p.dflt_value AS column_default, p.cid + 1 AS ordinal_position, ` +
        `CASE WHEN p.pk > 0 THEN 'YES' ELSE 'NO' END AS is_pk ` +
        `FROM sqlite_master m JOIN pragma_table_info(m.name) p ` +
        `WHERE m.type IN ('table', 'view') AND m.name NOT LIKE 'sqlite_%' ` +
        `ORDER BY m.name, p.cid`
      );
    case "oracle":
      // DATA_DEFAULT is a LONG and cannot be selected alongside other columns
      // without PL/SQL, and the PK would need another join — both are reported
      // as absent rather than wrong, so an Oracle diff never claims a default
      // or key changed.
      return (
        `SELECT owner AS table_schema, table_name, column_name, data_type, ` +
        `CASE WHEN nullable = 'Y' THEN 'YES' ELSE 'NO' END AS is_nullable, ` +
        `NULL AS column_default, column_id AS ordinal_position, 'NO' AS is_pk ` +
        `FROM all_tab_columns WHERE owner = USER ORDER BY table_name, column_id`
      );
  }
}

/** Engines whose snapshot cannot see defaults or primary keys — the UI says so up front. */
export const SNAPSHOT_BLIND_SPOTS: Partial<Record<DbEngine, string>> = {
  oracle: "Oracle snapshots omit column defaults and primary keys, so neither is compared.",
};

/**
 * Concatenate paged results of the same query into one.
 *
 * The native layer caps a result at 5000 rows, which a few hundred tables
 * exceed on column count alone. A truncated snapshot is worse than none — the
 * missing columns would read as deletions — so the caller walks the query with
 * `dbPaging` and merges the pages here. Column headers come from the first
 * non-empty page; every page is the same statement, so they agree.
 */
export function mergePages(pages: QueryResult[]): QueryResult {
  const first = pages.find((p) => p.columns.length > 0);
  const rows = pages.flatMap((p) => p.rows);
  return {
    columns: first?.columns ?? [],
    rows,
    rowCount: rows.length,
    elapsedMs: pages.reduce((sum, p) => sum + p.elapsedMs, 0),
    truncated: pages.some((p) => p.truncated),
  };
}

/** Case-insensitive column index lookup. */
function idx(result: QueryResult, name: string): number {
  return result.columns.findIndex((c) => c.toLowerCase() === name.toLowerCase());
}

/** Turn the uniform `allColumnsQuery` result into a snapshot, grouped by table. */
export function buildSnapshot(
  engine: DbEngine,
  label: string,
  result: QueryResult,
  capturedAt: number,
): SchemaSnapshot {
  const at = {
    schema: idx(result, "table_schema"),
    table: idx(result, "table_name"),
    column: idx(result, "column_name"),
    type: idx(result, "data_type"),
    nullable: idx(result, "is_nullable"),
    def: idx(result, "column_default"),
    position: idx(result, "ordinal_position"),
    pk: idx(result, "is_pk"),
  };
  const get = (row: (string | null)[], i: number) => (i >= 0 ? row[i] : null);

  const byKey = new Map<string, SnapshotTable>();
  for (const row of result.rows) {
    const table = get(row, at.table);
    const column = get(row, at.column);
    if (!table || !column) continue;
    const schema = get(row, at.schema) || null;
    const key = `${schema ?? ""}.${table}`;
    let entry = byKey.get(key);
    if (!entry) {
      entry = { schema, name: table, columns: [] };
      byKey.set(key, entry);
    }
    entry.columns.push({
      name: column,
      type: get(row, at.type) ?? "",
      nullable: (get(row, at.nullable) ?? "").toUpperCase() !== "NO",
      default: get(row, at.def),
      pk: (get(row, at.pk) ?? "").toUpperCase() === "YES",
      position: Number(get(row, at.position) ?? 0) || entry.columns.length + 1,
    });
  }

  const tables = [...byKey.values()].sort((a, b) =>
    `${a.schema ?? ""}.${a.name}`.localeCompare(`${b.schema ?? ""}.${b.name}`),
  );
  return { version: 1, kind: "devhelper-schema", engine, label, capturedAt, tables };
}

export function serializeSnapshot(snapshot: SchemaSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

/** Parse an exported snapshot. Throws with a usable message on bad input. */
export function parseSnapshotFile(text: string): SchemaSnapshot {
  const data = JSON.parse(text);
  if (!data || data.kind !== "devhelper-schema") throw new Error("Not a DevHelper schema snapshot");
  if (!Array.isArray(data.tables)) throw new Error("Snapshot has no 'tables' array");
  return {
    version: 1,
    kind: "devhelper-schema",
    engine: data.engine ?? "postgres",
    label: data.label ?? "imported snapshot",
    capturedAt: Number(data.capturedAt) || 0,
    tables: data.tables.filter((t: unknown): t is SnapshotTable => {
      const c = t as SnapshotTable;
      return !!c && typeof c.name === "string" && Array.isArray(c.columns);
    }),
  };
}
