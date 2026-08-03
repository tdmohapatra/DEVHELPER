import { Component, lazy, Suspense, type ReactNode } from "react";
import type { EditorMarker, MonacoEditorProps } from "./MonacoEditor";
import { cn } from "@/lib/utils";

export type { EditorMarker };

// Monaco is ~1MB of JS. Keeping it behind React.lazy puts it in its own chunk, so
// tools that never open an editor (and the app shell) never download it.
const MonacoEditor = lazy(() => import("./MonacoEditor"));

export interface CodeEditorProps extends Omit<MonacoEditorProps, "className"> {
  /** editor height in px */
  height?: number;
  className?: string;
}

/**
 * Code editor with graceful degradation: a plain monospace textarea is shown
 * while the Monaco chunk loads, and permanently if it fails to load at all.
 * Either way the value stays editable.
 */
export function CodeEditor({ height = 200, className, ...props }: CodeEditorProps) {
  const fallback = (
    <PlainEditor
      value={props.value}
      onChange={props.onChange}
      placeholder={props.placeholder}
      readOnly={props.readOnly}
      ariaLabel={props.ariaLabel}
      height={height}
      className={className}
    />
  );
  return (
    <EditorBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <MonacoEditor {...props} className={className} style={{ height }} />
      </Suspense>
    </EditorBoundary>
  );
}

interface PlainEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  ariaLabel?: string;
  height: number;
  className?: string;
}

function PlainEditor({ value, onChange, placeholder, readOnly, ariaLabel, height, className }: PlainEditorProps) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      readOnly={readOnly}
      aria-label={ariaLabel}
      spellCheck={false}
      style={{ height }}
      className={cn(
        "w-full resize-none rounded-md border border-input bg-background p-2 font-mono text-[13px] leading-5",
        "placeholder:text-muted-foreground focus-visible:outline-none",
        className,
      )}
    />
  );
}

class EditorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
