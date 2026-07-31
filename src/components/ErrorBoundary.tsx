import { Component, type ReactNode } from "react";
import { AlertTriangle, RotateCcw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { log } from "@/lib/logBus";

interface Props {
  children: ReactNode;
  /** Called when the user clicks "Go to Dashboard". */
  onHome?: () => void;
}

interface State {
  error: Error | null;
}

/**
 * Isolates a crashing tool so a single render error doesn't white-screen the whole app.
 * Keyed by the active view in App, so navigating to another tool resets it automatically.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // The panel below shows only the message; the log keeps the stack for copying.
    log.error("app:render", error.message, error.stack ?? info.componentStack ?? undefined);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-lg rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center">
          <AlertTriangle className="mx-auto mb-3 size-8 text-destructive" />
          <h2 className="text-lg font-semibold">This tool hit an error</h2>
          <p className="mt-1 text-sm text-muted-foreground">The rest of DevHelper is unaffected — you can retry or switch tools.</p>
          <pre className="mono mt-3 max-h-40 overflow-auto rounded-md border border-border bg-background p-3 text-left text-xs text-destructive">{error.message}</pre>
          <div className="mt-4 flex justify-center gap-2">
            <Button size="sm" variant="outline" onClick={() => this.setState({ error: null })}><RotateCcw /> Try again</Button>
            {this.props.onHome && <Button size="sm" variant="ghost" onClick={() => { this.setState({ error: null }); this.props.onHome!(); }}><Home /> Dashboard</Button>}
          </div>
        </div>
      </div>
    );
  }
}
