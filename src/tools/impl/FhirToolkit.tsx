import { useMemo, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/CopyButton";
import { validateFhir, summarizeFhir } from "@/tools/lib/fhir";
import { formatJson, jsonToCSharp, DEFAULT_CSHARP_OPTIONS } from "@/tools/lib/json";

const SAMPLE = JSON.stringify(
  {
    resourceType: "Patient",
    id: "example",
    name: [{ given: ["John", "A"], family: "Doe" }],
    gender: "male",
    birthDate: "1980-01-01",
    identifier: [{ system: "urn:mrn", value: "12345" }],
  },
  null,
  2,
);

export function FhirToolkit() {
  const [input, setInput] = useState(SAMPLE);
  const [view, setView] = useState<"formatted" | "summary" | "csharp">("summary");

  const validation = useMemo(() => validateFhir(input), [input]);
  const summary = useMemo(() => summarizeFhir(input), [input]);
  const formatted = useMemo(() => { try { return formatJson(input); } catch { return ""; } }, [input]);
  const csharp = useMemo(() => {
    try {
      return jsonToCSharp(input, { ...DEFAULT_CSHARP_OPTIONS, rootName: summary?.resourceType ?? "Resource" });
    } catch {
      return "";
    }
  }, [input, summary]);

  const outValue = view === "formatted" ? formatted : view === "csharp" ? csharp : "";

  return (
    <ToolShell
      toolId="fhir-toolkit"
      title="FHIR Toolkit (R4)"
      description="Validate, explore and convert FHIR resources. Local-only integration utility — not clinical software."
      actions={outValue && <CopyButton value={outValue} />}
    >
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">FHIR JSON</label>
          <Textarea mono className="h-[calc(100vh-360px)] min-h-64" value={input} onChange={(e) => setInput(e.target.value)} />
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            {validation.resourceType && <Badge>{validation.resourceType}</Badge>}
            {validation.resourceType && !validation.knownResource && <Badge variant="warning">Unknown R4 type</Badge>}
            {validation.valid ? (
              <Badge variant="success" className="ml-auto gap-1"><CheckCircle2 className="size-3" /> Valid</Badge>
            ) : (
              <Badge variant="destructive" className="ml-auto gap-1"><XCircle className="size-3" /> {validation.errors.length} issue(s)</Badge>
            )}
          </div>
          {!validation.valid && validation.errors.map((e, i) => <p key={i} className="text-xs text-destructive">• {e}</p>)}
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <TabBtn active={view === "summary"} onClick={() => setView("summary")} label="Summary" />
            <TabBtn active={view === "formatted"} onClick={() => setView("formatted")} label="Formatted" />
            <TabBtn active={view === "csharp"} onClick={() => setView("csharp")} label="C# model" />
          </div>
          <div className="h-[calc(100vh-360px)] min-h-64 overflow-auto rounded-md border border-border bg-muted/20 p-2">
            {view === "summary" ? (
              summary ? (
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <Badge>{summary.resourceType}</Badge>
                    {summary.id && <span className="font-mono text-xs text-muted-foreground">id: {summary.id}</span>}
                  </div>
                  <dl className="space-y-1">
                    {summary.fields.map((f, i) => (
                      <div key={i} className="grid grid-cols-[140px_1fr] gap-2 text-sm">
                        <dt className="text-muted-foreground">{f.label}</dt>
                        <dd className="mono break-all">{f.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : (
                <p className="p-2 text-sm text-muted-foreground">Enter a FHIR resource with a resourceType.</p>
              )
            ) : (
              <pre className="mono whitespace-pre-wrap text-[12px]">{outValue}</pre>
            )}
          </div>
        </div>
      </div>
    </ToolShell>
  );
}

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className={active ? "border-b-2 border-primary px-3 py-1 text-sm" : "px-3 py-1 text-sm text-muted-foreground hover:text-foreground"}>
      {label}
    </button>
  );
}
