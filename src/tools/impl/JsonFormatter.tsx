import { useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, XCircle } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/CopyButton";
import {
  childEntries,
  escapeJsonString,
  formatJson,
  minifyJson,
  parseJsonLoose,
  previewValue,
  sortJsonKeys,
  unescapeJsonString,
  validateJson,
  valueKind,
  type JsonKind,
} from "@/tools/lib/json";
import { queryJsonPath, type JsonPathMatch } from "@/tools/lib/jsonPath";
import { toast } from "@/components/ui/toast";
import { copyToClipboard } from "@/lib/utils";
import { cn } from "@/lib/utils";

const SAMPLE = `{"id":123,"name":"DevHelper","tags":["fast","local"],"nested":{"active":true}}`;

const EXAMPLES = [
  "$.name",
  "$.tags[*]",
  "$..active",
  "$.tags[0:2]",
  "$..[?(@.active == true)]",
];

type View = "format" | "tree" | "query";

export function JsonFormatter() {
  const [input, setInput] = useState(SAMPLE);
  const [output, setOutput] = useState("");
  const [view, setView] = useState<View>("format");
  const [loose, setLoose] = useState(false);

  const validation = useMemo(() => validateJson(input, loose), [input, loose]);

  const parsed = useMemo(() => {
    try {
      return { value: loose ? parseJsonLoose(input) : JSON.parse(input), error: "" };
    } catch (e) {
      return { value: undefined, error: (e as Error).message };
    }
  }, [input, loose]);

  const run = (fn: (s: string) => string) => {
    try {
      setOutput(fn(input));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <ToolShell
      toolId="json-formatter"
      title="JSON Formatter"
      description="Format, explore and query JSON. Fully local."
      actions={<CopyButton value={output} />}
    >
      <div className="mb-3 flex flex-wrap items-center gap-1">
        <TabBtn active={view === "format"} onClick={() => setView("format")} label="Format" />
        <TabBtn active={view === "tree"} onClick={() => setView("tree")} label="Tree" />
        <TabBtn active={view === "query"} onClick={() => setView("query")} label="Query" />
        <label className="ml-4 flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={loose} onChange={(e) => setLoose(e.target.checked)} />
          Allow comments &amp; trailing commas
        </label>
        <span className="ml-auto">
          {validation.valid ? (
            <Badge variant="success" className="gap-1"><CheckCircle2 className="size-3" /> Valid JSON</Badge>
          ) : (
            <Badge variant="destructive" className="gap-1" title={validation.error}>
              <XCircle className="size-3" /> Invalid
            </Badge>
          )}
        </span>
      </div>

      {view === "format" && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => run((s) => formatJson(s, 2, loose))}>Format</Button>
            <Button size="sm" variant="outline" onClick={() => run((s) => formatJson(s, 4, loose))}>Format (4)</Button>
            <Button size="sm" variant="outline" onClick={() => run((s) => minifyJson(s, loose))}>Minify</Button>
            <Button size="sm" variant="outline" onClick={() => run((s) => sortJsonKeys(s))}>Sort keys</Button>
            <span className="mx-1 h-5 w-px bg-border" />
            <Button size="sm" variant="outline" title="Turn an escaped payload like {\&quot;a\&quot;:1} back into JSON" onClick={() => run(unescapeJsonString)}>
              Unescape
            </Button>
            <Button size="sm" variant="outline" title="Wrap the document as an escaped JSON string literal" onClick={() => run(escapeJsonString)}>
              Escape
            </Button>
            {output && (
              <Button size="sm" variant="ghost" onClick={() => { setInput(output); setOutput(""); }}>
                Output → input
              </Button>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Pane label="Input">
              <Textarea mono className="h-[calc(100vh-360px)] min-h-64" value={input} onChange={(e) => setInput(e.target.value)} />
            </Pane>
            <Pane label="Output">
              <Textarea mono readOnly className="h-[calc(100vh-360px)] min-h-64 bg-muted/30" value={output} placeholder="Result appears here…" />
            </Pane>
          </div>
          {!validation.valid && input.trim() && <p className="mt-2 text-xs text-destructive">{validation.error}</p>}
        </>
      )}

      {view === "tree" && <TreeView value={parsed.value} error={parsed.error} input={input} onInput={setInput} />}

      {view === "query" && <QueryView value={parsed.value} error={parsed.error} input={input} onInput={setInput} />}
    </ToolShell>
  );
}

function Pane({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={active ? "border-b-2 border-primary px-3 py-1 text-sm" : "px-3 py-1 text-sm text-muted-foreground hover:text-foreground"}
    >
      {label}
    </button>
  );
}

// ---- Tree ------------------------------------------------------------------

const kindColor: Record<JsonKind, string> = {
  string: "text-success",
  number: "text-warning",
  boolean: "text-primary",
  null: "text-muted-foreground",
  object: "text-foreground",
  array: "text-foreground",
};

/** True when the node itself or anything beneath it matches the filter. */
function subtreeMatches(key: string, value: unknown, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  if (key.toLowerCase().includes(needle)) return true;
  const kind = valueKind(value);
  if (kind !== "object" && kind !== "array") {
    return String(JSON.stringify(value)).toLowerCase().includes(needle);
  }
  return childEntries(value, "$").some((c) => subtreeMatches(c.key, c.value, q));
}

function TreeView({
  value,
  error,
  input,
  onInput,
}: {
  value: unknown;
  error: string;
  input: string;
  onInput: (s: string) => void;
}) {
  const [filter, setFilter] = useState("");

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <Pane label="Input">
        <Textarea mono className="h-[calc(100vh-360px)] min-h-64" value={input} onChange={(e) => onInput(e.target.value)} />
      </Pane>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-muted-foreground">Tree</label>
          <Input
            className="ml-auto h-7 w-56 text-xs"
            placeholder="Filter keys and values…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div className="h-[calc(100vh-360px)] min-h-64 overflow-auto rounded-md border border-border bg-muted/20 p-2 font-mono text-[12px]">
          {error ? (
            <p className="p-2 text-destructive">{error}</p>
          ) : (
            <TreeNode nodeKey="$" value={value} path="$" depth={0} filter={filter} />
          )}
        </div>
      </div>
    </div>
  );
}

function TreeNode({
  nodeKey,
  value,
  path,
  depth,
  filter,
}: {
  nodeKey: string;
  value: unknown;
  path: string;
  depth: number;
  filter: string;
}) {
  const [manual, setManual] = useState<boolean | null>(null);
  const kind = valueKind(value);
  const container = kind === "object" || kind === "array";
  const open = manual ?? (filter ? true : depth < 2);

  if (!subtreeMatches(nodeKey, value, filter)) return null;

  const children = open && container ? childEntries(value, path) : [];

  return (
    <div style={{ paddingLeft: depth === 0 ? 0 : 14 }}>
      <div className="group flex items-start gap-1 rounded px-1 hover:bg-muted/50">
        {container ? (
          <button
            className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => setManual(!open)}
            aria-label={open ? "Collapse" : "Expand"}
          >
            {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <span
          className="cursor-pointer select-none text-foreground"
          title={`${path} — click to copy path`}
          onClick={async () => {
            if (await copyToClipboard(path)) toast.success(`Copied ${path}`);
          }}
        >
          {nodeKey}
        </span>
        <span className="text-muted-foreground">:</span>
        <span className={cn("break-all", kindColor[kind])}>{previewValue(value)}</span>
      </div>
      {children.map((c) => (
        <TreeNode key={c.path} nodeKey={c.key} value={c.value} path={c.path} depth={depth + 1} filter={filter} />
      ))}
    </div>
  );
}

// ---- Query -----------------------------------------------------------------

function QueryView({
  value,
  error,
  input,
  onInput,
}: {
  value: unknown;
  error: string;
  input: string;
  onInput: (s: string) => void;
}) {
  const [expr, setExpr] = useState("$..*");

  const result = useMemo(() => {
    if (error) return { matches: [] as JsonPathMatch[], error: "" };
    try {
      return { matches: queryJsonPath(value, expr), error: "" };
    } catch (e) {
      return { matches: [] as JsonPathMatch[], error: (e as Error).message };
    }
  }, [value, expr, error]);

  const asJson = useMemo(
    () => JSON.stringify(result.matches.map((m) => m.value), null, 2),
    [result.matches],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="h-8 min-w-72 flex-1 font-mono"
          value={expr}
          onChange={(e) => setExpr(e.target.value)}
          placeholder="$.store.books[?(@.price > 10)].title"
          spellCheck={false}
        />
        <Badge variant={result.error ? "destructive" : "success"}>
          {result.error ? "Bad expression" : `${result.matches.length} match${result.matches.length === 1 ? "" : "es"}`}
        </Badge>
        <CopyButton value={asJson} label="Copy values" />
      </div>

      <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        <span>Examples:</span>
        {EXAMPLES.map((e) => (
          <button key={e} onClick={() => setExpr(e)} className="rounded border border-border px-1.5 py-0.5 font-mono hover:bg-muted">
            {e}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Pane label="Input">
          <Textarea mono className="h-[calc(100vh-420px)] min-h-64" value={input} onChange={(e) => onInput(e.target.value)} />
        </Pane>
        <Pane label="Matches">
          <div className="h-[calc(100vh-420px)] min-h-64 overflow-auto rounded-md border border-border bg-muted/20">
            {error || result.error ? (
              <p className="p-3 text-xs text-destructive">{error || result.error}</p>
            ) : result.matches.length === 0 ? (
              <p className="p-3 text-xs text-muted-foreground">No matches.</p>
            ) : (
              <ul className="divide-y divide-border font-mono text-[12px]">
                {result.matches.map((m) => (
                  <li key={m.path} className="flex items-start gap-3 px-3 py-1.5">
                    <button
                      className="w-56 shrink-0 truncate text-left text-muted-foreground hover:text-foreground"
                      title={`${m.path} — click to copy path`}
                      onClick={async () => {
                        if (await copyToClipboard(m.path)) toast.success(`Copied ${m.path}`);
                      }}
                    >
                      {m.path}
                    </button>
                    <span className={cn("break-all", kindColor[valueKind(m.value)])}>{previewValue(m.value, 120)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Pane>
      </div>
    </div>
  );
}
