import type { QueryResult } from "./dbTypes";

/** A neutral inferred type for a result column, mapped per-language by the generators. */
export type InferredType = "int" | "long" | "decimal" | "bool" | "datetime" | "guid" | "string";

const INT_RE = /^-?\d{1,9}$/;
const LONG_RE = /^-?\d{10,18}$/;
const DECIMAL_RE = /^-?\d+\.\d+$/;
const BOOL_RE = /^(true|false|t|f|0|1)$/i;
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?/;

function inferOne(v: string): InferredType {
  if (GUID_RE.test(v)) return "guid";
  if (INT_RE.test(v)) return "int";
  if (LONG_RE.test(v)) return "long";
  if (DECIMAL_RE.test(v)) return "decimal";
  if (BOOL_RE.test(v) && (v.toLowerCase() === "true" || v.toLowerCase() === "false" || v === "t" || v === "f")) return "bool";
  if (DATE_RE.test(v)) return "datetime";
  return "string";
}

export interface ColumnInfo {
  name: string;
  type: InferredType;
  nullable: boolean;
}

/** Infer per-column types + nullability from a result set's sampled rows. */
export function inferColumns(result: QueryResult, sample = 50): ColumnInfo[] {
  return result.columns.map((name, i) => {
    let type: InferredType | null = null;
    let nullable = false;
    for (let r = 0; r < Math.min(result.rows.length, sample); r++) {
      const cell = result.rows[r][i];
      if (cell === null || cell === "") {
        nullable = true;
        continue;
      }
      const t = inferOne(cell);
      type = type === null ? t : mergeType(type, t);
    }
    return { name, type: type ?? "string", nullable };
  });
}

/** When a column has mixed inferred types, widen to the most permissive. */
function mergeType(a: InferredType, b: InferredType): InferredType {
  if (a === b) return a;
  const numeric: InferredType[] = ["int", "long", "decimal"];
  if (numeric.includes(a) && numeric.includes(b)) {
    if (a === "decimal" || b === "decimal") return "decimal";
    return "long";
  }
  return "string";
}

const pascal = (s: string) =>
  s
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("") || "Column";

const camel = (s: string) => {
  const p = pascal(s);
  return p[0].toLowerCase() + p.slice(1);
};

const CSHARP: Record<InferredType, string> = {
  int: "int",
  long: "long",
  decimal: "decimal",
  bool: "bool",
  datetime: "DateTime",
  guid: "Guid",
  string: "string",
};

const TS: Record<InferredType, string> = {
  int: "number",
  long: "number",
  decimal: "number",
  bool: "boolean",
  datetime: "string",
  guid: "string",
  string: "string",
};

/** C# class with nullable annotations. */
export function toCsharpClass(cols: ColumnInfo[], name = "Row"): string {
  const lines = cols.map((c) => {
    const t = CSHARP[c.type];
    const nt = c.nullable ? (c.type === "string" ? `${t}?` : `${t}?`) : t;
    return `    public ${nt} ${pascal(c.name)} { get; set; }`;
  });
  return `public class ${pascal(name)}\n{\n${lines.join("\n")}\n}`;
}

/** C# positional record. */
export function toCsharpRecord(cols: ColumnInfo[], name = "Row"): string {
  const params = cols
    .map((c) => {
      const t = CSHARP[c.type];
      const nt = c.nullable ? `${t}?` : t;
      return `${nt} ${pascal(c.name)}`;
    })
    .join(", ");
  return `public record ${pascal(name)}(${params});`;
}

/** EF Core entity: class + [Table]/[Column] hints. */
export function toEfEntity(cols: ColumnInfo[], name = "Row"): string {
  const lines = cols.map((c) => {
    const t = CSHARP[c.type];
    const nt = c.nullable ? `${t}?` : t;
    const attr = pascal(c.name) !== c.name ? `    [Column("${c.name}")]\n` : "";
    return `${attr}    public ${nt} ${pascal(c.name)} { get; set; }`;
  });
  return `[Table("${name}")]\npublic class ${pascal(name)}\n{\n${lines.join("\n")}\n}`;
}

/** TypeScript interface. */
export function toTsInterface(cols: ColumnInfo[], name = "Row"): string {
  const lines = cols.map((c) => `  ${camel(c.name)}${c.nullable ? "?" : ""}: ${TS[c.type]};`);
  return `export interface ${pascal(name)} {\n${lines.join("\n")}\n}`;
}

/** A single-row JSON example built from the first data row (or nulls). */
export function toJsonExample(result: QueryResult, cols: ColumnInfo[]): string {
  const row = result.rows[0];
  const obj: Record<string, unknown> = {};
  cols.forEach((c, i) => {
    const raw = row ? row[i] : null;
    if (raw === null || raw === undefined) obj[c.name] = null;
    else if (c.type === "int" || c.type === "long" || c.type === "decimal") obj[c.name] = Number(raw);
    else if (c.type === "bool") obj[c.name] = /^(true|t|1)$/i.test(raw);
    else obj[c.name] = raw;
  });
  return JSON.stringify(obj, null, 2);
}
