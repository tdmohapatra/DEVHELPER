import { useEffect, useLayoutEffect, useRef, type CSSProperties } from "react";
import { monaco, MONACO_THEME, setSqlCompletionSource } from "@/lib/monaco";
import type { SqlCompletion } from "@/tools/lib/sqlEditor";
import { useAppStore } from "@/stores/useAppStore";
import { cn } from "@/lib/utils";

/** A finding to underline, expressed as offsets into `value`. */
export interface EditorMarker {
  start: number;
  end: number;
  severity: "error" | "warning" | "info";
  message: string;
}

export interface MonacoEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Monaco language id — see SQL_LANGUAGE_IDS for what is bundled. */
  language: string;
  markers?: EditorMarker[];
  /**
   * Suggestions for the SQL languages, as a getter so the provider always sees
   * current connection state. Passed as a prop (rather than the caller importing
   * the Monaco module directly) to keep Monaco out of every tool's chunk.
   */
  completions?: () => SqlCompletion[];
  readOnly?: boolean;
  placeholder?: string;
  /** Ctrl/Cmd+Enter */
  onRun?: () => void;
  /** Ctrl/Cmd+Shift+F */
  onFormat?: () => void;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
}

const SEVERITY = {
  error: monaco.MarkerSeverity.Error,
  warning: monaco.MarkerSeverity.Warning,
  info: monaco.MarkerSeverity.Info,
} as const;

const MARKER_OWNER = "devhelper";

/**
 * Thin controlled wrapper around a standalone Monaco editor.
 *
 * Loaded only through `CodeEditor`, which lazy-imports this file so Monaco lands
 * in its own chunk instead of any tool's bundle.
 */
export default function MonacoEditor({
  value,
  onChange,
  language,
  markers,
  completions,
  readOnly,
  placeholder,
  onRun,
  onFormat,
  className,
  style,
  ariaLabel,
}: MonacoEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const theme = useAppStore((s) => s.theme);

  // Keep callbacks in refs: Monaco commands and listeners are bound once at
  // creation, but must always call the latest props.
  const handlers = useRef({ onChange, onRun, onFormat });
  handlers.current = { onChange, onRun, onFormat };

  useEffect(() => {
    if (!hostRef.current) return;
    const editor = monaco.editor.create(hostRef.current, {
      value,
      language,
      theme: theme === "dark" ? MONACO_THEME.dark : MONACO_THEME.light,
      automaticLayout: true,
      minimap: { enabled: false },
      fontFamily: '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
      fontSize: 13,
      lineHeight: 20,
      tabSize: 2,
      wordWrap: "on",
      scrollBeyondLastLine: false,
      renderLineHighlight: "line",
      lineNumbersMinChars: 3,
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      overviewRulerBorder: false,
      padding: { top: 8, bottom: 8 },
      smoothScrolling: true,
      // Suggest/hover widgets are rendered in the body so surrounding
      // `overflow-hidden` cards cannot clip them.
      fixedOverflowWidgets: true,
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
    });
    editorRef.current = editor;

    const sub = editor.onDidChangeModelContent(() => handlers.current.onChange(editor.getValue()));
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => handlers.current.onRun?.());
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, () => handlers.current.onFormat?.());

    if (ariaLabel) editor.updateOptions({ ariaLabel });

    return () => {
      sub.dispose();
      editor.getModel()?.dispose();
      editor.dispose();
      editorRef.current = null;
    };
    // Created once. Value/language/theme/markers are pushed by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Controlled value: only write back when it actually diverged, otherwise every
  // keystroke would reset the cursor to the end of the document.
  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.getValue() !== value) editor.setValue(value);
  }, [value]);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (model) monaco.editor.setModelLanguage(model, language);
  }, [language]);

  useEffect(() => {
    monaco.editor.setTheme(theme === "dark" ? MONACO_THEME.dark : MONACO_THEME.light);
  }, [theme]);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly: !!readOnly });
  }, [readOnly]);

  useEffect(() => {
    if (!completions) return;
    setSqlCompletionSource(completions);
    return () => setSqlCompletionSource(null);
  }, [completions]);

  useLayoutEffect(() => {
    const model = editorRef.current?.getModel();
    if (!model) return;
    monaco.editor.setModelMarkers(model, MARKER_OWNER, (markers ?? []).map((m) => {
      const from = model.getPositionAt(m.start);
      const to = model.getPositionAt(m.end);
      return {
        severity: SEVERITY[m.severity],
        message: m.message,
        startLineNumber: from.lineNumber,
        startColumn: from.column,
        endLineNumber: to.lineNumber,
        endColumn: to.column,
      };
    }));
  }, [markers, value]);

  return (
    <div style={style} className={cn("relative overflow-hidden rounded-md border border-input bg-background", className)}>
      <div ref={hostRef} className="size-full" />
      {placeholder && value === "" && (
        <span
          className="pointer-events-none absolute left-[52px] top-2 select-none font-mono text-[13px] leading-5 text-muted-foreground"
          aria-hidden
        >
          {placeholder}
        </span>
      )}
    </div>
  );
}
