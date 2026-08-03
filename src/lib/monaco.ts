/**
 * The app's single Monaco entry point.
 *
 * We import `edcore.main` (the full standalone editor — find/replace, suggest
 * widget, folding, multi-cursor, command palette) plus only the SQL grammars,
 * rather than the `monaco-editor` barrel. That leaves out the TypeScript, JSON,
 * CSS and HTML language services, so the one web worker we have to ship is the
 * generic `editor.worker`.
 *
 * Everything is bundled locally and the worker comes in through Vite's `?worker`
 * import: Monaco never fetches from a CDN, which is required because DevHelper
 * runs offline inside Tauri from the `tauri://` scheme.
 */

import * as monaco from "monaco-editor/esm/vs/editor/edcore.main";
import "monaco-editor/esm/vs/basic-languages/sql/sql.contribution";
import "monaco-editor/esm/vs/basic-languages/pgsql/pgsql.contribution";
import "monaco-editor/esm/vs/basic-languages/mysql/mysql.contribution";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import type { SqlCompletion, SqlCompletionKind } from "@/tools/lib/sqlEditor";

self.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

/** The SQL dialects whose grammars are bundled — see the imports above. */
export const SQL_LANGUAGE_IDS = ["sql", "pgsql", "mysql"] as const;

export const MONACO_THEME = { dark: "devhelper-dark", light: "devhelper-light" } as const;

// Hex equivalents of the HSL design tokens in index.css. The editor background is
// left fully transparent so the surrounding card surface shows through and the
// editor never fights the app's own background.
const DARK = {
  fg: "#edeff3",
  muted: "#8d94a5",
  primary: "#7f67f4",
  string: "#31b97a",
  number: "#f6a327",
  destructive: "#d73c3c",
  selection: "#7f67f433",
  lineHighlight: "#ffffff08",
};
const LIGHT = {
  fg: "#181c25",
  muted: "#6b7280",
  primary: "#5c45ed",
  string: "#1c7a52",
  number: "#a35c07",
  destructive: "#c02626",
  selection: "#5c45ed26",
  lineHighlight: "#0000000a",
};

function defineTheme(name: string, base: "vs" | "vs-dark", c: typeof DARK) {
  monaco.editor.defineTheme(name, {
    base,
    inherit: true,
    rules: [
      { token: "", foreground: c.fg.slice(1) },
      { token: "comment", foreground: c.muted.slice(1), fontStyle: "italic" },
      { token: "keyword", foreground: c.primary.slice(1) },
      { token: "keyword.sql", foreground: c.primary.slice(1) },
      { token: "operator.sql", foreground: c.muted.slice(1) },
      { token: "predefined", foreground: c.primary.slice(1) },
      { token: "string", foreground: c.string.slice(1) },
      { token: "string.sql", foreground: c.string.slice(1) },
      { token: "number", foreground: c.number.slice(1) },
      { token: "delimiter", foreground: c.muted.slice(1) },
      { token: "invalid", foreground: c.destructive.slice(1) },
    ],
    colors: {
      "editor.background": "#00000000",
      "editor.foreground": c.fg,
      "editorLineNumber.foreground": c.muted + "80",
      "editorLineNumber.activeForeground": c.fg,
      "editor.selectionBackground": c.selection,
      "editor.lineHighlightBackground": c.lineHighlight,
      "editorCursor.foreground": c.primary,
      "editorIndentGuide.background1": c.muted + "26",
      "editorWhitespace.foreground": c.muted + "40",
    },
  });
}

defineTheme(MONACO_THEME.dark, "vs-dark", DARK);
defineTheme(MONACO_THEME.light, "vs", LIGHT);

const COMPLETION_KIND: Record<SqlCompletionKind, monaco.languages.CompletionItemKind> = {
  keyword: monaco.languages.CompletionItemKind.Keyword,
  table: monaco.languages.CompletionItemKind.Struct,
  view: monaco.languages.CompletionItemKind.Interface,
  routine: monaco.languages.CompletionItemKind.Function,
  column: monaco.languages.CompletionItemKind.Field,
  snippet: monaco.languages.CompletionItemKind.Snippet,
};

/**
 * Live source of SQL completions. Providers are registered once per language
 * here (registering from a component would double up on remount); the mounted
 * editor swaps in a closure over its own connection state.
 */
let completionSource: (() => SqlCompletion[]) | null = null;

export function setSqlCompletionSource(source: (() => SqlCompletion[]) | null): void {
  completionSource = source;
}

for (const languageId of SQL_LANGUAGE_IDS) {
  monaco.languages.registerCompletionItemProvider(languageId, {
    provideCompletionItems(model, position) {
      if (!completionSource) return { suggestions: [] };
      const word = model.getWordUntilPosition(position);
      const range: monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      return {
        suggestions: completionSource().map((c) => ({
          label: c.label,
          detail: c.detail,
          kind: COMPLETION_KIND[c.kind],
          insertText: c.insertText,
          sortText: c.sortText,
          range,
          insertTextRules: c.kind === "snippet"
            ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
            : undefined,
        })),
      };
    },
  });
}

export { monaco };
