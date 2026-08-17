import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Wand2 } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { CopyButton } from "@/components/CopyButton";
import { runTransform, SAMPLES, templateExpressions } from "@/tools/lib/transform";

export function TransformPlayground() {
  const [input, setInput] = useState(SAMPLES[0].input);
  const [template, setTemplate] = useState(SAMPLES[0].template);

  const result = useMemo(() => {
    try {
      return { ...runTransform(template, input), error: "" };
    } catch (e) {
      return { output: null, issues: [], error: e instanceof Error ? e.message : String(e) };
    }
  }, [template, input]);

  const expressions = useMemo(() => templateExpressions(template), [template]);

  return (
    <ToolShell
      toolId="transform-playground"
      title="Transform Playground"
      description="Reshape a payload with a template that looks like the output you want."
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {SAMPLES.map((sample) => (
          <Button
            key={sample.name}
            size="sm"
            variant="outline"
            title={sample.note}
            onClick={() => {
              setInput(sample.input);
              setTemplate(sample.template);
            }}
          >
            <Wand2 className="size-3.5" /> {sample.name}
          </Button>
        ))}
        {result.error ? (
          <Badge variant="destructive">not runnable</Badge>
        ) : (
          <Badge variant={result.issues.length ? "warning" : "success"}>
            {result.issues.length ? `${result.issues.length} issue(s)` : "clean"}
          </Badge>
        )}
        <Badge variant="outline">{expressions.length} expression(s)</Badge>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Input</label>
          <Textarea mono className="h-[26rem]" value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} />
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground">Template</label>
            <ArrowRight className="size-3 text-muted-foreground" />
          </div>
          <Textarea mono className="h-[26rem]" value={template} onChange={(e) => setTemplate(e.target.value)} spellCheck={false} />
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground">Output</label>
            {!result.error && <CopyButton className="ml-auto" value={JSON.stringify(result.output, null, 2)} />}
          </div>
          {result.error ? (
            <div className="h-[26rem] overflow-auto rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {result.error}
            </div>
          ) : (
            <pre className="mono h-[26rem] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/20 p-3 text-[11px]">
              {JSON.stringify(result.output, null, 2)}
            </pre>
          )}
        </div>
      </div>

      {result.issues.length > 0 && (
        <div className="mt-3 flex flex-col gap-1 rounded-md border border-warning/40 bg-warning/5 p-2">
          {result.issues.map((issue, i) => (
            <p key={i} className="text-[11px]">
              <AlertTriangle className="mr-1 inline size-3 text-warning" />
              <b className="mono">{issue.at || "(root)"}</b>: {issue.message}
            </p>
          ))}
          <p className="text-[10px] text-muted-foreground">
            One bad expression does not stop the rest — an exception would show nothing and name a line number in a
            parser rather than the field that is wrong.
          </p>
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-md border border-border p-3 text-[11px]">
          <p className="text-xs font-medium text-foreground">How the template works</p>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
            <li>
              The template <i>is</i> the output document, with <span className="mono">{"{{ }}"}</span> holes. It looks
              like what will be produced, so it can be checked against the receiving system's example by eye — which is
              how those specifications actually arrive.
            </li>
            <li>
              A value that is <b>exactly one expression keeps its type</b>: <span className="mono">"{"{{ $.count }}"}"</span>{" "}
              produces the number 5, not the string "5". A schema expecting a number and given a string rejects it, and
              the reason is invisible in a diff.
            </li>
            <li>
              A key whose expression <b>finds nothing is omitted, not nulled</b>. FHIR and X12 both distinguish absent
              from null, and validators enforce it.
            </li>
            <li>
              Paths are JSONPath — <span className="mono">$.name[0].family</span>, <span className="mono">$.rows[*]</span>{" "}
              — the same engine the JSON Formatter uses.
            </li>
          </ul>
        </div>

        <div className="rounded-md border border-border p-3 text-[11px]">
          <p className="text-xs font-medium text-foreground">Repeating and transforming</p>
          <pre className="mono mt-2 overflow-auto whitespace-pre rounded bg-muted/30 p-2 text-[10px]">
{`"entry": {
  "$each": "$.rows[*]",
  "$as": "row",
  "$template": { "id": "{{ row.mrn }}" }
}`}
          </pre>
          <p className="mt-2">
            Inside <span className="mono">$template</span> the binding names each item. An outer binding stays visible
            inside a nested <span className="mono">$each</span>.
          </p>
          <p className="mt-2">
            Pipe through the same transforms the Field Mapper uses:{" "}
            <span className="mono">{"{{ $.dob | hl7DateToIso }}"}</span>,{" "}
            <span className="mono">{"{{ $.family | titlecase }}"}</span>,{" "}
            <span className="mono">{"{{ $.sex | lookup(F, female, M, male) }}"}</span>.
          </p>
        </div>
      </div>

      {expressions.length > 0 && (
        <div className="mt-3 rounded-md border border-border p-3">
          <p className="text-xs font-medium">What this template reads</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {expressions.map((expression) => (
              <span key={expression} className="mono rounded bg-secondary px-1.5 py-0.5 text-[10px]">{expression}</span>
            ))}
          </div>
        </div>
      )}
    </ToolShell>
  );
}
