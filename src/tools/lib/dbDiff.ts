/**
 * Structural diff between two schema snapshots, plus a draft migration.
 *
 * Direction is fixed and worth stating once: `left` is the baseline being
 * changed and `right` is the desired shape. "Added" therefore means present in
 * right only, and the generated migration turns left into right.
 *
 * Pure functions over snapshots — nothing here touches a database, so the whole
 * comparison is testable without a server.
 */

import type { DbEngine } from "./dbTypes";
import type { SchemaSnapshot, SnapshotColumn, SnapshotTable } from "./dbSnapshot";
import { buildCreateTable } from "./dbSchema";

export interface DiffOptions {
  /** Compare table and column names case-insensitively. */
  ignoreCase: boolean;
  /** Match tables on bare name — needed when one side has schemas and the other does not. */
  ignoreSchema: boolean;
  /** Skip column defaults, which differ cosmetically across engines. */
  ignoreDefaults: boolean;
  /** Skip ordinal position, which almost never matters to an application. */
  ignoreOrder: boolean;
  /** Treat known type spellings as equal (`int4` = `integer`, `character varying` = `varchar`). */
  ignoreTypeAliases: boolean;
}

export const DEFAULT_DIFF_OPTIONS: DiffOptions = {
  ignoreCase: true,
  ignoreSchema: false,
  ignoreDefaults: false,
  ignoreOrder: true,
  ignoreTypeAliases: true,
};

export type ChangeKind = "added" | "removed" | "changed" | "same";

export interface ColumnDiff {
  name: string;
  kind: ChangeKind;
  left: SnapshotColumn | null;
  right: SnapshotColumn | null;
  /** one human line per differing attribute; empty unless kind is "changed" */
  changes: string[];
}

export interface TableDiff {
  key: string;
  schema: string | null;
  name: string;
  kind: ChangeKind;
  left: SnapshotTable | null;
  right: SnapshotTable | null;
  columns: ColumnDiff[];
}

export interface SchemaDiff {
  leftLabel: string;
  rightLabel: string;
  tables: TableDiff[];
  counts: { added: number; removed: number; changed: number; same: number };
  /** true when nothing differs under the current options */
  identical: boolean;
}

/**
 * Spellings that mean the same thing across (and within) engines.
 *
 * Only the base word is mapped — `varchar(50)` and `varchar(200)` stay
 * different, because a shortened column is real drift.
 */
const TYPE_ALIASES: Record<string, string> = {
  int: "int", int4: "int", integer: "int", mediumint: "int",
  int8: "bigint", bigint: "bigint",
  int2: "smallint", smallint: "smallint", tinyint: "smallint",
  varchar: "varchar", varchar2: "varchar", nvarchar: "varchar", "character varying": "varchar",
  char: "char", nchar: "char", bpchar: "char", character: "char",
  text: "text", ntext: "text", longtext: "text", mediumtext: "text", clob: "text", nclob: "text",
  bool: "boolean", boolean: "boolean", bit: "boolean",
  timestamp: "timestamp", datetime: "timestamp", datetime2: "timestamp",
  "timestamp without time zone": "timestamp", "timestamp with time zone": "timestamptz",
  timestamptz: "timestamptz", datetimeoffset: "timestamptz",
  float4: "real", real: "real",
  float8: "double", "double precision": "double", double: "double",
  numeric: "decimal", decimal: "decimal", number: "decimal", money: "decimal",
  blob: "blob", bytea: "blob", varbinary: "blob", binary: "blob", raw: "blob",
  uuid: "uuid", uniqueidentifier: "uuid",
  json: "json", jsonb: "json",
};

/** Lowercase, collapse whitespace, and optionally fold the base word onto its canonical alias. */
export function normalizeType(type: string, useAliases: boolean): string {
  const t = type.trim().toLowerCase().replace(/\s+/g, " ");
  if (!useAliases) return t;
  const m = /^([a-z0-9_ ]+?)\s*(\(([^)]*)\))?$/.exec(t);
  if (!m) return t;
  const base = TYPE_ALIASES[m[1].trim()] ?? m[1].trim();
  return m[3] !== undefined ? `${base}(${m[3].replace(/\s+/g, "")})` : base;
}

function fold(value: string, ignoreCase: boolean): string {
  return ignoreCase ? value.toLowerCase() : value;
}

function tableKey(t: { schema: string | null; name: string }, o: DiffOptions): string {
  const name = fold(t.name, o.ignoreCase);
  if (o.ignoreSchema) return name;
  return `${fold(t.schema ?? "", o.ignoreCase)}.${name}`;
}

/** Defaults are compared as trimmed text; `NULL` and the empty string both mean "none". */
function defaultOf(c: SnapshotColumn): string {
  return (c.default ?? "").trim();
}

/** The attribute-level differences between two versions of one column. */
export function columnChanges(left: SnapshotColumn, right: SnapshotColumn, o: DiffOptions): string[] {
  const changes: string[] = [];
  const lt = normalizeType(left.type, o.ignoreTypeAliases);
  const rt = normalizeType(right.type, o.ignoreTypeAliases);
  if (lt !== rt) changes.push(`type ${left.type || "?"} → ${right.type || "?"}`);
  if (left.nullable !== right.nullable) {
    changes.push(right.nullable ? "NOT NULL → nullable" : "nullable → NOT NULL");
  }
  if (!o.ignoreDefaults && defaultOf(left) !== defaultOf(right)) {
    changes.push(`default ${defaultOf(left) || "none"} → ${defaultOf(right) || "none"}`);
  }
  if (left.pk !== right.pk) changes.push(right.pk ? "became part of the primary key" : "left the primary key");
  if (!o.ignoreOrder && left.position !== right.position) {
    changes.push(`position ${left.position} → ${right.position}`);
  }
  return changes;
}

function diffColumns(left: SnapshotTable | null, right: SnapshotTable | null, o: DiffOptions): ColumnDiff[] {
  const l = new Map((left?.columns ?? []).map((c) => [fold(c.name, o.ignoreCase), c]));
  const r = new Map((right?.columns ?? []).map((c) => [fold(c.name, o.ignoreCase), c]));
  const keys = [...new Set([...l.keys(), ...r.keys()])].sort();
  return keys.map((k) => {
    const lc = l.get(k) ?? null;
    const rc = r.get(k) ?? null;
    const name = (rc ?? lc)!.name;
    if (!lc) return { name, kind: "added" as const, left: null, right: rc, changes: [] };
    if (!rc) return { name, kind: "removed" as const, left: lc, right: null, changes: [] };
    const changes = columnChanges(lc, rc, o);
    return { name, kind: changes.length ? ("changed" as const) : ("same" as const), left: lc, right: rc, changes };
  });
}

export function diffSchemas(left: SchemaSnapshot, right: SchemaSnapshot, o: DiffOptions): SchemaDiff {
  const l = new Map(left.tables.map((t) => [tableKey(t, o), t]));
  const r = new Map(right.tables.map((t) => [tableKey(t, o), t]));
  const keys = [...new Set([...l.keys(), ...r.keys()])].sort();

  const tables: TableDiff[] = keys.map((key) => {
    const lt = l.get(key) ?? null;
    const rt = r.get(key) ?? null;
    const ref = (rt ?? lt)!;
    const columns = diffColumns(lt, rt, o);
    const kind: ChangeKind = !lt ? "added" : !rt ? "removed" : columns.some((c) => c.kind !== "same") ? "changed" : "same";
    return { key, schema: ref.schema, name: ref.name, kind, left: lt, right: rt, columns };
  });

  const counts = { added: 0, removed: 0, changed: 0, same: 0 };
  for (const t of tables) counts[t.kind]++;
  return {
    leftLabel: left.label,
    rightLabel: right.label,
    tables,
    counts,
    identical: counts.added + counts.removed + counts.changed === 0,
  };
}

/** Only the tables that differ — what the UI shows by default. */
export function changedTables(diff: SchemaDiff): TableDiff[] {
  return diff.tables.filter((t) => t.kind !== "same");
}

/** Schema-qualified name for generated SQL. */
function qualified(t: TableDiff): string {
  return t.schema ? `${t.schema}.${t.name}` : t.name;
}

function columnClause(c: SnapshotColumn): string {
  let s = `${c.name} ${c.type}`;
  if (!c.nullable) s += " NOT NULL";
  if (c.default != null && c.default !== "") s += ` DEFAULT ${c.default}`;
  return s;
}

/** `ALTER TABLE t <retype>` for a column whose type or nullability moved. */
function retypeStatement(engine: DbEngine, table: string, c: SnapshotColumn): string[] {
  const nullClause = c.nullable ? "NULL" : "NOT NULL";
  switch (engine) {
    case "postgres":
      return [
        `ALTER TABLE ${table} ALTER COLUMN ${c.name} TYPE ${c.type};`,
        `ALTER TABLE ${table} ALTER COLUMN ${c.name} ${c.nullable ? "DROP NOT NULL" : "SET NOT NULL"};`,
      ];
    case "mysql":
      return [`ALTER TABLE ${table} MODIFY COLUMN ${c.name} ${c.type} ${nullClause};`];
    case "mssql":
      return [`ALTER TABLE ${table} ALTER COLUMN ${c.name} ${c.type} ${nullClause};`];
    case "oracle":
      return [`ALTER TABLE ${table} MODIFY (${c.name} ${c.type} ${c.nullable ? "NULL" : "NOT NULL"});`];
    case "sqlite":
      // SQLite has no ALTER COLUMN; changing a type means rebuilding the table.
      return [`-- SQLite cannot alter a column: rebuild ${table} to change ${c.name} to ${c.type}.`];
  }
}

/**
 * A draft migration turning the left schema into the right one.
 *
 * Every destructive statement is emitted commented out. Dropping a table or a
 * column is not something a diff tool should hand over ready to paste, and a
 * diff cannot tell a rename from a drop-plus-add — the two look identical at
 * this level, and guessing wrong destroys data.
 */
export function migrationSql(engine: DbEngine, diff: SchemaDiff): string {
  const out: string[] = [
    `-- Draft migration: ${diff.leftLabel} → ${diff.rightLabel}`,
    `-- Generated from a schema comparison. Review every statement before running it.`,
    `-- Drops are commented out on purpose, and a renamed object looks exactly like a`,
    `-- drop plus an add at this level — check those by hand.`,
    "",
  ];
  const changed = changedTables(diff);
  if (changed.length === 0) {
    out.push("-- Schemas match; nothing to do.");
    return out.join("\n");
  }

  for (const t of changed) {
    const table = qualified(t);
    out.push(`-- ${table}`);

    if (t.kind === "added" && t.right) {
      out.push(buildCreateTable(table, t.right.columns));
      out.push("");
      continue;
    }
    if (t.kind === "removed") {
      out.push(`-- DROP TABLE ${table};`, "");
      continue;
    }

    for (const c of t.columns) {
      if (c.kind === "added" && c.right) {
        const keyword = engine === "mssql" || engine === "oracle" ? "ADD" : "ADD COLUMN";
        if (!c.right.nullable && (c.right.default == null || c.right.default === "")) {
          out.push(`-- ${c.name} is NOT NULL with no default; this fails unless ${table} is empty.`);
        }
        out.push(`ALTER TABLE ${table} ${keyword} ${columnClause(c.right)};`);
      } else if (c.kind === "removed") {
        out.push(`-- ALTER TABLE ${table} DROP COLUMN ${c.name};`);
      } else if (c.kind === "changed" && c.left && c.right) {
        // Type and nullability are what ALTER COLUMN can express. Defaults and key
        // membership are left as notes: both need their own DDL, and the right form
        // depends on constraint names this snapshot does not carry.
        const structural =
          normalizeType(c.left.type, true) !== normalizeType(c.right.type, true) ||
          c.left.nullable !== c.right.nullable;
        if (structural) out.push(...retypeStatement(engine, table, c.right));
        if (c.left.pk !== c.right.pk || defaultOf(c.left) !== defaultOf(c.right)) {
          out.push(`-- ${c.name}: ${c.changes.join("; ")} — apply by hand.`);
        }
      }
    }
    out.push("");
  }
  return out.join("\n").trimEnd() + "\n";
}

/** One-line summary for the header and for the log. */
export function diffSummary(diff: SchemaDiff): string {
  const { added, removed, changed, same } = diff.counts;
  if (diff.identical) return `Schemas match — ${same} table${same === 1 ? "" : "s"} compared`;
  return `${added} added · ${removed} removed · ${changed} changed · ${same} identical`;
}
