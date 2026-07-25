import type { DbEngine } from "./dbTypes";

/** Qualified object name for SQL (schema-qualified where the engine has schemas). */
export function qualify(schema: string | null, name: string): string {
  return schema ? `${schema}.${name}` : name;
}

/** Paginated SELECT for a table/view, per engine. `offset`/`size` are row counts. */
export function pageQuery(engine: DbEngine, schema: string | null, name: string, offset: number, size: number): string {
  const q = qualify(schema, name);
  switch (engine) {
    case "mssql":
      return `SELECT * FROM ${q} ORDER BY (SELECT NULL) OFFSET ${offset} ROWS FETCH NEXT ${size} ROWS ONLY`;
    case "oracle":
      return `SELECT * FROM ${q} OFFSET ${offset} ROWS FETCH NEXT ${size} ROWS ONLY`;
    case "mysql":
      return `SELECT * FROM ${q} LIMIT ${offset}, ${size}`;
    default: // postgres, sqlite
      return `SELECT * FROM ${q} LIMIT ${size} OFFSET ${offset}`;
  }
}

/** Row-count query for a table/view. (Engine-agnostic; param kept for call-site symmetry.) */
export function countQuery(_engine: DbEngine, schema: string | null, name: string): string {
  return `SELECT COUNT(*) AS n FROM ${qualify(schema, name)}`;
}

export type ObjectKind = "table" | "view" | "procedure" | "function";

/** SQL returning the source/definition of a view/procedure/function (single "definition" cell). */
export function definitionQuery(engine: DbEngine, kind: ObjectKind, schema: string | null, name: string): string | null {
  const q = qualify(schema, name);
  const nameLit = name.replace(/'/g, "''");
  const schemaCond = schema ? ` AND table_schema = '${schema.replace(/'/g, "''")}'` : "";
  switch (engine) {
    case "mssql":
      return `SELECT OBJECT_DEFINITION(OBJECT_ID('${q.replace(/'/g, "''")}')) AS definition`;
    case "sqlite":
      return `SELECT sql AS definition FROM sqlite_master WHERE name = '${nameLit}'`;
    case "mysql":
      if (kind === "view") return `SHOW CREATE VIEW ${q}`;
      if (kind === "procedure") return `SHOW CREATE PROCEDURE ${q}`;
      if (kind === "function") return `SHOW CREATE FUNCTION ${q}`;
      return null;
    case "postgres":
      if (kind === "view") return `SELECT view_definition AS definition FROM information_schema.views WHERE table_name = '${nameLit}'${schemaCond}`;
      return `SELECT routine_definition AS definition FROM information_schema.routines WHERE routine_name = '${nameLit}'${schema ? ` AND routine_schema = '${schema.replace(/'/g, "''")}'` : ""}`;
    default:
      return null;
  }
}

/** SQL listing a table's indexes (returned as a raw grid; shapes differ per engine). */
export function indexQuery(engine: DbEngine, schema: string | null, name: string): string | null {
  const q = qualify(schema, name);
  const nameLit = name.replace(/'/g, "''");
  switch (engine) {
    case "mssql":
      return (
        `SELECT i.name AS index_name, i.type_desc AS type, i.is_unique AS is_unique, ` +
        `COL_NAME(ic.object_id, ic.column_id) AS column_name ` +
        `FROM sys.indexes i JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id ` +
        `WHERE i.object_id = OBJECT_ID('${q.replace(/'/g, "''")}') AND i.name IS NOT NULL ` +
        `ORDER BY i.name, ic.key_ordinal`
      );
    case "postgres":
      return `SELECT indexname AS index_name, indexdef AS definition FROM pg_indexes WHERE tablename = '${nameLit}'${schema ? ` AND schemaname = '${schema.replace(/'/g, "''")}'` : ""} ORDER BY indexname`;
    case "mysql":
      return `SHOW INDEX FROM ${q}`;
    case "sqlite":
      return `PRAGMA index_list('${nameLit}')`;
    default:
      return null;
  }
}
