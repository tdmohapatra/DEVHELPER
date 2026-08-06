import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { queryJsonPath } from "@/tools/lib/jsonPath";
import {
  KIND_LABELS,
  availableModes,
  bodyStats,
  detectBodyKind,
  formatBody,
  headerValue,
  htmlSummary,
  mediaType,
  supportsJsonPath,
  type ViewMode,
} from "@/tools/lib/responseBody";

const MODE_LABELS: Record<ViewMode, string> = { pretty: "Pretty", raw: "Raw", preview: "Preview" };

/**
 * The response body, shown the way its content actually is.
 *
 * The kind is detected rather than trusted (see `responseBody.ts`), and the
 * available view modes follow from it — there is no Preview tab on a JSON
 * payload, and no Pretty tab on binary.
 */
export function ApiResponseBody({ body, headers }: { body: string; headers: Record<string, string> }) {
  const contentType = headerValue(headers, "content-type");
  const kind = useMemo(() => detectBodyKind(contentType, body), [contentType, body]);
  const modes = useMemo(() => availableModes(kind), [kind]);
  const [mode, setMode] = useState<ViewMode>(modes[0]);
  const [filter, setFilter] = useState("");

  // A new response can be a different kind, whose modes may not include the
  // one currently selected.
  useEffect(() => {
    if (!modes.includes(mode)) setMode(modes[0]);
  }, [modes, mode]);

  const pretty = useMemo(() => formatBody(kind, body), [kind, body]);
  const stats = useMemo(() => bodyStats(body), [body]);

  /** JSONPath over the parsed body — drilling into a large payload without scrolling. */
  const filtered = useMemo(() => {
    const expr = filter.trim();
    if (!expr) return null;
    try {
      const matches = queryJsonPath(JSON.parse(body), expr);
      if (matches.length === 0) return "No matches.";
      return JSON.stringify(matches.length === 1 ? matches[0].value : matches.map((m) => m.value), null, 2);
    } catch (e) {
      return (e as Error).message;
    }
  }, [filter, body]);

  const shown = mode === "raw" ? body : (filtered ?? pretty.text);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {modes.map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                "rounded px-2 py-0.5 text-xs",
                mode === m ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>

        <Badge variant="outline" className="text-[10px]">{KIND_LABELS[kind]}</Badge>
        {contentType && mediaType(contentType) !== expectedType(kind) && (
          <Badge
            variant="warning"
            className="text-[10px]"
            title={`The server said ${mediaType(contentType)}, but the body is ${KIND_LABELS[kind]}.`}
          >
            declared {mediaType(contentType)}
          </Badge>
        )}
        <span className="text-[11px] text-muted-foreground">
          {stats.lines.toLocaleString()} lines · {stats.chars.toLocaleString()} chars
        </span>

        {supportsJsonPath(kind) && mode !== "raw" && (
          <div className="ml-auto flex items-center gap-1">
            <Input
              className="h-7 w-64 font-mono text-xs"
              placeholder="JSONPath — $.data.items[*].id"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            {filter && (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setFilter("")}>Clear</Button>
            )}
          </div>
        )}
      </div>

      {pretty.note && mode === "pretty" && (
        <p className="rounded border border-warning/40 bg-warning/10 px-2 py-1 text-[11px]">{pretty.note}</p>
      )}

      {mode === "preview" ? (
        <HtmlPreview body={body} />
      ) : (
        <Textarea mono readOnly className="h-full min-h-40 bg-muted/30" value={shown} />
      )}
    </div>
  );
}

/** The media type a body of this kind would normally be served as. */
function expectedType(kind: string): string {
  switch (kind) {
    case "json": return "application/json";
    case "html": return "text/html";
    case "xml": return "application/xml";
    case "csv": return "text/csv";
    case "css": return "text/css";
    case "javascript": return "application/javascript";
    default: return "text/plain";
  }
}

/**
 * Rendered HTML, plus the facts worth reading off a page.
 *
 * The frame is `sandbox=""` with no allow list, so scripts never run, forms
 * cannot submit, and it has no access to this app. Being a `srcdoc` frame it
 * also inherits DevHelper's `default-src 'self'` policy, so the page's own
 * stylesheets, fonts, images and trackers are never fetched. That means the
 * render shows structure and text, not the site as a browser would draw it —
 * which is the honest thing for a request inspector to show, and why the
 * summary sits next to it.
 */
function HtmlPreview({ body }: { body: string }) {
  const summary = useMemo(() => htmlSummary(body), [body]);
  const [showRendered, setShowRendered] = useState(true);

  return (
    <div className="flex h-full min-h-40 flex-col gap-2">
      <div className="rounded-md border border-border p-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-sm font-medium">{summary.title || "(no <title>)"}</span>
          <span className="text-[11px] text-muted-foreground">
            {summary.links} links · {summary.scripts} scripts · {summary.images} images · {summary.forms} forms
          </span>
          <button
            className="ml-auto text-[11px] text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => setShowRendered((v) => !v)}
          >
            {showRendered ? "Show text only" : "Show rendered"}
          </button>
        </div>
        {summary.description && <p className="mt-1 text-xs text-muted-foreground">{summary.description}</p>}
        {summary.headings.length > 0 && (
          <p className="mt-1 truncate text-xs" title={summary.headings.join(" · ")}>
            <span className="text-muted-foreground">Headings: </span>
            {summary.headings.slice(0, 6).join(" · ")}
            {summary.headings.length > 6 ? ` … +${summary.headings.length - 6}` : ""}
          </p>
        )}
      </div>

      {showRendered ? (
        <>
          <iframe
            // No allow-scripts and no allow-same-origin: inert by construction.
            sandbox=""
            title="Response preview"
            srcDoc={body}
            className="min-h-0 flex-1 rounded-md border border-border bg-white"
          />
          <p className="text-[11px] text-muted-foreground">
            Scripts, styles, fonts and images are blocked, so this shows structure and text rather than the styled page.
          </p>
        </>
      ) : (
        <Textarea mono readOnly className="h-full min-h-40 bg-muted/30" value={summary.text} />
      )}
    </div>
  );
}
