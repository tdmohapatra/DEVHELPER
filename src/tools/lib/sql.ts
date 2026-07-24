import { format, type FormatOptionsWithLanguage, type SqlLanguage } from "sql-formatter";

export const SQL_DIALECTS: { value: SqlLanguage; label: string }[] = [
  { value: "sql", label: "Standard SQL" },
  { value: "tsql", label: "SQL Server (T-SQL)" },
  { value: "postgresql", label: "PostgreSQL" },
  { value: "mysql", label: "MySQL" },
  { value: "plsql", label: "Oracle (PL/SQL)" },
  { value: "sqlite", label: "SQLite" },
];

export interface SqlFormatOptions {
  language: SqlLanguage;
  uppercase: boolean;
  tabWidth: number;
}

export function formatSql(input: string, opts: SqlFormatOptions): string {
  const options: FormatOptionsWithLanguage = {
    language: opts.language,
    tabWidth: opts.tabWidth,
    keywordCase: opts.uppercase ? "upper" : "preserve",
  };
  return format(input, options);
}

const DESTRUCTIVE = /\b(drop|delete|truncate|alter|update|insert|grant|revoke|create)\b/i;

/** Flag potentially destructive SQL so the UI can warn before it is run elsewhere. */
export function isDestructiveSql(input: string): boolean {
  return DESTRUCTIVE.test(input);
}
