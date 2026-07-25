import type { DbEngine, QueryResult } from "./dbTypes";

export interface ColumnMeta {
  name: string;
  type: string;
  nullable: boolean;
  default?: string | null;
  pk: boolean;
}

/** SQL to list a table's columns, per engine. `SHOW COLUMNS`/`PRAGMA` also carry key info. */
export function columnsQuery(engine: DbEngine, schema: string | null, table: string): string {
  switch (engine) {
    case "sqlite":
      return `PRAGMA table_info('${table.replace(/'/g, "''")}')`;
    case "mysql":
      return `SHOW COLUMNS FROM \`${table.replace(/`/g, "``")}\``;
    case "postgres":
    case "mssql":
      return (
        `SELECT column_name, data_type, is_nullable, column_default ` +
        `FROM information_schema.columns ` +
        `WHERE table_name = '${table.replace(/'/g, "''")}'` +
        (schema ? ` AND table_schema = '${schema.replace(/'/g, "''")}'` : "") +
        ` ORDER BY ordinal_position`
      );
    default:
      return "";
  }
}

/** SQL to fetch primary-key column names (pg + mssql only; others carry it inline). */
export function pkQuery(engine: DbEngine, schema: string | null, table: string): string | null {
  if (engine !== "postgres" && engine !== "mssql") return null;
  return (
    `SELECT kcu.column_name FROM information_schema.table_constraints tc ` +
    `JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name ` +
    `AND tc.table_schema = kcu.table_schema ` +
    `WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name = '${table.replace(/'/g, "''")}'` +
    (schema ? ` AND tc.table_schema = '${schema.replace(/'/g, "''")}'` : "")
  );
}

/** Case-insensitive column index lookup for a QueryResult. */
function col(result: QueryResult, name: string): number {
  return result.columns.findIndex((c) => c.toLowerCase() === name.toLowerCase());
}

/** Normalize the engine-specific column result into a common ColumnMeta[]. */
export function normalizeColumns(engine: DbEngine, result: QueryResult, pkResult?: QueryResult): ColumnMeta[] {
  const at = (row: (string | null)[], name: string) => {
    const i = col(result, name);
    return i >= 0 ? row[i] : null;
  };

  if (engine === "sqlite") {
    return result.rows.map((r) => ({
      name: at(r, "name") ?? "",
      type: at(r, "type") ?? "",
      nullable: (at(r, "notnull") ?? "0") === "0",
      default: at(r, "dflt_value"),
      pk: (at(r, "pk") ?? "0") !== "0",
    }));
  }

  if (engine === "mysql") {
    return result.rows.map((r) => ({
      name: at(r, "Field") ?? "",
      type: at(r, "Type") ?? "",
      nullable: (at(r, "Null") ?? "").toUpperCase() === "YES",
      default: at(r, "Default"),
      pk: (at(r, "Key") ?? "").toUpperCase() === "PRI",
    }));
  }

  // postgres / mssql — information_schema.columns + separate PK set
  const pks = new Set<string>();
  if (pkResult) {
    const pi = col(pkResult, "column_name");
    for (const r of pkResult.rows) if (pi >= 0 && r[pi]) pks.add(r[pi]!.toLowerCase());
  }
  return result.rows.map((r) => {
    const name = at(r, "column_name") ?? "";
    return {
      name,
      type: at(r, "data_type") ?? "",
      nullable: (at(r, "is_nullable") ?? "").toUpperCase() === "YES",
      default: at(r, "column_default"),
      pk: pks.has(name.toLowerCase()),
    };
  });
}

/** Render a CREATE TABLE statement from normalized columns. */
export function buildCreateTable(table: string, columns: ColumnMeta[]): string {
  if (columns.length === 0) return `-- no columns found for ${table}`;
  const lines = columns.map((c) => {
    let s = `  ${c.name} ${c.type}`;
    if (!c.nullable) s += " NOT NULL";
    if (c.default != null && c.default !== "") s += ` DEFAULT ${c.default}`;
    return s;
  });
  const pks = columns.filter((c) => c.pk).map((c) => c.name);
  if (pks.length > 0) lines.push(`  PRIMARY KEY (${pks.join(", ")})`);
  return `CREATE TABLE ${table} (\n${lines.join(",\n")}\n);`;
}
