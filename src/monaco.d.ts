/**
 * Monaco ships `.d.ts` only for its public API entry (`editor.api`). We import
 * deeper ESM entry points to control exactly what gets bundled, so those need
 * declaring here.
 */

declare module "monaco-editor/esm/vs/editor/edcore.main" {
  export * from "monaco-editor/esm/vs/editor/editor.api";
}

declare module "monaco-editor/esm/vs/basic-languages/sql/sql.contribution";
declare module "monaco-editor/esm/vs/basic-languages/pgsql/pgsql.contribution";
declare module "monaco-editor/esm/vs/basic-languages/mysql/mysql.contribution";
