import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Plus, Trash2, Upload, Code2, AlertTriangle, ArrowRight } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { CopyButton } from "@/components/CopyButton";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { useMappingStore } from "@/stores/useMappingStore";
import {
  applyMapping,
  coverage,
  describeTransforms,
  exportMapping,
  importMapping,
  readSource,
  toCSharp,
  type MappingRule,
  type SourceKind,
  type TransformKind,
  type TransformStep,
} from "@/tools/lib/fieldMap";

const SAMPLES: Record<SourceKind, string> = {
  hl7: [
    "MSH|^~\\&|LIS|LAB|EMR|HOSP|20260817103000||ORU^R01|MSG00001|P|2.5",
    "PID|1||100234^^^HOSP^MR||sharma^priya^k||19750214|F|||12 MG Road^^Bengaluru^KA^560001||9845012345",
    "OBX|1|NM|718-7^Haemoglobin||9.1|g/dL|13.0-17.0|L|||F",
  ].join("\r\n"),
  json: JSON.stringify(
    { name: [{ family: "Sharma", given: ["Priya"] }], birthDate: "1975-02-14", identifier: [{ value: "100234" }] },
    null,
    2,
  ),
  csv: 'mrn,family,given,dob\n100234,sharma,priya,1975-02-14',
};

const KINDS: { id: SourceKind; label: string; hint: string }[] = [
  { id: "hl7", label: "HL7 v2", hint: "Paths are SEG-field or SEG-field.component, e.g. PID-5.1" },
  { id: "json", label: "JSON / FHIR", hint: "Paths are dotted with array indexes, e.g. name[0].family" },
  { id: "csv", label: "CSV", hint: "Paths are the column name, or its 1-based position" },
];

const TRANSFORMS: { kind: TransformKind; label: string; a?: string; b?: string }[] = [
  { kind: "trim", label: "trim" },
  { kind: "upper", label: "upper" },
  { kind: "lower", label: "lower" },
  { kind: "titlecase", label: "title case" },
  { kind: "digitsOnly", label: "digits only" },
  { kind: "substring", label: "substring", a: "from", b: "to" },
  { kind: "replace", label: "replace", a: "find", b: "with" },
  { kind: "split", label: "split", a: "separator", b: "index" },
  { kind: "pad", label: "pad", a: "length", b: "char" },
  { kind: "prefix", label: "prefix", a: "text" },
  { kind: "suffix", label: "suffix", a: "text" },
  { kind: "hl7DateToIso", label: "HL7 date → ISO" },
  { kind: "isoToHl7Date", label: "ISO → HL7 date" },
  { kind: "lookup", label: "lookup table" },
];

export function FieldMapper() {
  const { mappings, current, samples, expected } = useMappingStore();
  const { select, add, update, remove, setSample, setExpected } = useMappingStore();
  const mapping = mappings[current] ?? mappings[0];

  const [showCode, setShowCode] = useState(false);
  const [openRule, setOpenRule] = useState<string | null>(null);

  const sample = samples[mapping.sourceKind] ?? SAMPLES[mapping.sourceKind];
  const expectedTargets = useMemo(() => expected.split(/\r?\n/).map((l) => l.trim()).filter(Boolean), [expected]);

  const run = useMemo(() => {
    try {
      const source = readSource(mapping.sourceKind, sample);
      return { source, result: applyMapping(mapping, source), cover: coverage(mapping, source, expectedTargets), error: "" };
    } catch (e) {
      return { source: null, result: null, cover: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [mapping, sample, expectedTargets]);

  const setRule = (id: string, patch: Partial<MappingRule>) =>
    update({ ...mapping, rules: mapping.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) });

  const addRule = () =>
    update({
      ...mapping,
      rules: [...mapping.rules, { id: `r${Date.now().toString(36)}`, target: "", source: "" }],
    });

  const removeRule = (id: string) => update({ ...mapping, rules: mapping.rules.filter((r) => r.id !== id) });

  const setStep = (ruleId: string, index: number, patch: Partial<TransformStep>) => {
    const rule = mapping.rules.find((r) => r.id === ruleId);
    if (!rule) return;
    setRule(ruleId, { transforms: (rule.transforms ?? []).map((s, i) => (i === index ? { ...s, ...patch } : s)) });
  };

  const doImport = async () => {
    try {
      const text = await navigator.clipboard.readText();
      add(importMapping(text));
      toast.success("Mapping imported from the clipboard");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const errors = run.result?.issues.filter((i) => i.level === "error") ?? [];
  const warnings = run.result?.issues.filter((i) => i.level === "warn") ?? [];

  return (
    <ToolShell
      toolId="field-mapper"
      title="Field Mapper"
      description="Map one system's fields onto another's, run the map over a real message, and see what is not covered."
    >
      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
        <F label="Mapping">
          <select
            className="h-8 rounded-md border border-border bg-background px-2 text-sm"
            value={current}
            onChange={(e) => select(Number(e.target.value))}
          >
            {mappings.map((m, i) => (
              <option key={i} value={i}>{m.name}</option>
            ))}
          </select>
        </F>
        <F label="Name">
          <Input className="h-8 w-56" value={mapping.name} onChange={(e) => update({ ...mapping, name: e.target.value })} />
        </F>
        <F label="Source">
          <select
            className="h-8 rounded-md border border-border bg-background px-2 text-sm"
            value={mapping.sourceKind}
            onChange={(e) => update({ ...mapping, sourceKind: e.target.value as SourceKind })}
          >
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>{k.label}</option>
            ))}
          </select>
        </F>
        <Button size="sm" variant="outline" onClick={() => add()}>
          <Plus className="size-3.5" /> New
        </Button>
        <Button size="sm" variant="ghost" onClick={doImport}>
          <Upload className="size-3.5" /> Import
        </Button>
        <CopyButton value={exportMapping(mapping)} />
        <Button size="sm" variant="ghost" onClick={() => setShowCode((v) => !v)}>
          <Code2 className="size-3.5" /> {showCode ? "Hide C#" : "C#"}
        </Button>
        {mappings.length > 1 && (
          <Button size="sm" variant="ghost" onClick={() => remove(current)}>
            <Trash2 className="size-3.5" />
          </Button>
        )}
        <p className="w-full text-[11px] text-muted-foreground">
          {KINDS.find((k) => k.id === mapping.sourceKind)?.hint}. The mapping is the artefact — export it, diff it against
          last release, review it with someone who does not write code. The generated C# is a projection of it: regenerate
          rather than edit.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground">Sample message</label>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSample(mapping.sourceKind, SAMPLES[mapping.sourceKind])}>
              Reset sample
            </Button>
          </div>
          <Textarea
            mono
            className="h-44"
            value={sample}
            onChange={(e) => setSample(mapping.sourceKind, e.target.value)}
            spellCheck={false}
          />
          <p className="text-[11px] text-muted-foreground">
            Saved with the mapping, so an edit can be re-run against the message it was built for. A real message is PHI —
            it is stored locally and a workspace backup copies it.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground">Output</label>
            {errors.length > 0 && <Badge variant="destructive" className="text-[9px]">{errors.length} error(s)</Badge>}
            {warnings.length > 0 && <Badge variant="warning" className="text-[9px]">{warnings.length} warning(s)</Badge>}
            {run.result && <CopyButton className="ml-auto" value={JSON.stringify(run.result.output, null, 2)} />}
          </div>
          {run.error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{run.error}</p>
          ) : (
            <pre className="mono h-44 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/20 p-2 text-[11px]">
              {JSON.stringify(run.result?.output ?? {}, null, 2)}
            </pre>
          )}
        </div>
      </div>

      {run.result && run.result.issues.length > 0 && (
        <div className="mt-3 flex flex-col gap-1 rounded-md border border-warning/40 bg-warning/5 p-2">
          {run.result.issues.map((issue, i) => (
            <p key={i} className="text-[11px]">
              <AlertTriangle className={cn("mr-1 inline size-3", issue.level === "error" ? "text-destructive" : "text-warning")} />
              <b>{issue.subject}:</b> {issue.message}
            </p>
          ))}
        </div>
      )}

      <div className="mt-3 rounded-md border border-border">
        <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
          <span className="text-xs font-medium">Rules</span>
          <Badge variant="outline" className="text-[9px]">{mapping.rules.length}</Badge>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={addRule}>
            <Plus className="size-3.5" /> Add rule
          </Button>
        </div>
        {mapping.rules.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted-foreground">
            No rules yet. A rule reads one source path, runs it through transforms, and writes one target field.
          </p>
        ) : (
          <div className="max-h-[45vh] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 border-b border-border bg-card text-left text-muted-foreground">
                <tr>
                  {["Source path", "", "Target field", "Transforms", "Value now", ""].map((c, i) => (
                    <th key={i} className="whitespace-nowrap px-2 py-1 font-medium">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {mapping.rules.map((rule) => {
                  const trace = run.result?.traces.find((t) => t.ruleId === rule.id);
                  const open = openRule === rule.id;
                  return (
                    // The fragment is the list child, so it carries the key.
                    <Fragment key={rule.id}>
                      <tr className="hover:bg-secondary/40">
                        <td className="px-2 py-1">
                          <Input
                            className="mono h-7 w-40 text-[11px]"
                            value={rule.source ?? ""}
                            placeholder={rule.constant ? "(constant)" : "PID-5.1"}
                            onChange={(e) => setRule(rule.id, { source: e.target.value })}
                          />
                        </td>
                        <td className="px-1 py-1 text-muted-foreground"><ArrowRight className="size-3" /></td>
                        <td className="px-2 py-1">
                          <Input
                            className="mono h-7 w-48 text-[11px]"
                            value={rule.target}
                            placeholder="patient.family"
                            onChange={(e) => setRule(rule.id, { target: e.target.value })}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <button
                            className="text-left text-[11px] text-muted-foreground underline decoration-dotted hover:text-foreground"
                            onClick={() => setOpenRule(open ? null : rule.id)}
                          >
                            {describeTransforms(rule.transforms)}
                          </button>
                        </td>
                        <td className="mono max-w-[220px] truncate px-2 py-1" title={trace?.value ?? trace?.error}>
                          {trace?.error ? (
                            <span className="text-destructive">{trace.error}</span>
                          ) : trace?.value !== undefined ? (
                            <>
                              {trace.value}
                              {trace.usedFallback && <Badge variant="secondary" className="ml-1 text-[9px]">fallback</Badge>}
                            </>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-2 py-1">
                          <div className="flex items-center gap-1">
                            <label className="flex items-center gap-1 text-[10px] text-muted-foreground" title="The receiver rejects the message without this">
                              <input
                                type="checkbox"
                                checked={!!rule.required}
                                onChange={(e) => setRule(rule.id, { required: e.target.checked })}
                              />
                              req
                            </label>
                            <Button size="sm" variant="ghost" onClick={() => removeRule(rule.id)}>
                              <Trash2 className="size-3" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                      {open && (
                        <tr className="bg-secondary/20">
                          <td colSpan={6} className="px-3 py-2">
                            <div className="flex flex-wrap items-end gap-2">
                              <F label="Constant (instead of a source)">
                                <Input
                                  className="h-7 w-40 text-[11px]"
                                  value={rule.constant ?? ""}
                                  onChange={(e) => setRule(rule.id, { constant: e.target.value })}
                                />
                              </F>
                              <F label="Fallback (when empty)">
                                <Input
                                  className="h-7 w-40 text-[11px]"
                                  value={rule.fallback ?? ""}
                                  onChange={(e) => setRule(rule.id, { fallback: e.target.value })}
                                />
                              </F>
                              <F label="Note">
                                <Input
                                  className="h-7 w-64 text-[11px]"
                                  value={rule.note ?? ""}
                                  placeholder="why this mapping is what it is"
                                  onChange={(e) => setRule(rule.id, { note: e.target.value })}
                                />
                              </F>
                            </div>
                            <div className="mt-2 flex flex-col gap-1">
                              {(rule.transforms ?? []).map((step, i) => {
                                const def = TRANSFORMS.find((t) => t.kind === step.kind);
                                return (
                                  <div key={i} className="flex flex-wrap items-center gap-1">
                                    <select
                                      className="h-7 rounded-md border border-border bg-background px-1 text-[11px]"
                                      value={step.kind}
                                      onChange={(e) => setStep(rule.id, i, { kind: e.target.value as TransformKind })}
                                    >
                                      {TRANSFORMS.map((t) => (
                                        <option key={t.kind} value={t.kind}>{t.label}</option>
                                      ))}
                                    </select>
                                    {def?.a && (
                                      <Input
                                        className="h-7 w-24 text-[11px]"
                                        placeholder={def.a}
                                        value={step.a ?? ""}
                                        onChange={(e) => setStep(rule.id, i, { a: e.target.value })}
                                      />
                                    )}
                                    {def?.b && (
                                      <Input
                                        className="h-7 w-24 text-[11px]"
                                        placeholder={def.b}
                                        value={step.b ?? ""}
                                        onChange={(e) => setStep(rule.id, i, { b: e.target.value })}
                                      />
                                    )}
                                    {step.kind === "lookup" && (
                                      <>
                                        <Input
                                          className="mono h-7 w-64 text-[11px]"
                                          placeholder="F=female, M=male"
                                          value={Object.entries(step.table ?? {}).map(([k, v]) => `${k}=${v}`).join(", ")}
                                          onChange={(e) => {
                                            const table: Record<string, string> = {};
                                            for (const pair of e.target.value.split(",")) {
                                              const [k, v] = pair.split("=");
                                              if (k?.trim()) table[k.trim()] = (v ?? "").trim();
                                            }
                                            setStep(rule.id, i, { table });
                                          }}
                                        />
                                        <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                          <input
                                            type="checkbox"
                                            checked={!!step.strict}
                                            onChange={(e) => setStep(rule.id, i, { strict: e.target.checked })}
                                          />
                                          fail on an unlisted code
                                        </label>
                                      </>
                                    )}
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => setRule(rule.id, { transforms: (rule.transforms ?? []).filter((_, j) => j !== i) })}
                                    >
                                      <Trash2 className="size-3" />
                                    </Button>
                                  </div>
                                );
                              })}
                              <Button
                                size="sm"
                                variant="outline"
                                className="w-fit"
                                onClick={() => setRule(rule.id, { transforms: [...(rule.transforms ?? []), { kind: "trim" }] })}
                              >
                                <Plus className="size-3" /> Add transform
                              </Button>
                            </div>
                            {trace && trace.steps.length > 0 && (
                              <p className="mono mt-2 text-[10px] text-muted-foreground">
                                {trace.raw} {trace.steps.map((s) => `→ ${s.to}`).join(" ")}
                              </p>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Target fields the receiver expects</label>
          <Textarea
            mono
            className="h-28"
            value={expected}
            placeholder={"patient.mrn\npatient.family\npatient.birthDate"}
            onChange={(e) => setExpected(e.target.value)}
            spellCheck={false}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Coverage</label>
          <div className="h-28 overflow-auto rounded-md border border-border p-2 text-[11px]">
            {run.cover ? (
              <>
                {run.cover.unmappedTarget.length > 0 && (
                  <p className="text-destructive">
                    <b>Not filled ({run.cover.unmappedTarget.length}):</b> {run.cover.unmappedTarget.join(", ")} — the
                    receiver expects these and no rule writes them.
                  </p>
                )}
                {run.cover.missingSource.length > 0 && (
                  <p className="mt-1 text-warning">
                    <b>Not in this message ({run.cover.missingSource.length}):</b> {run.cover.missingSource.join(", ")} —
                    rules point at paths this sample does not carry.
                  </p>
                )}
                <p className="mt-1 text-muted-foreground">
                  <b>Not read ({run.cover.unmappedSource.length}):</b> {run.cover.unmappedSource.join(", ") || "none"} —
                  usually fine; most of a message is not wanted.
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">Fix the sample to see coverage.</p>
            )}
          </div>
        </div>
      </div>

      {showCode && (
        <div className="mt-3 flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground">Generated C#</label>
            <CopyButton className="ml-auto" value={toCSharp(mapping)} />
          </div>
          <pre className="mono max-h-96 overflow-auto whitespace-pre rounded-md border border-border bg-muted/20 p-3 text-[11px]">
            {toCSharp(mapping)}
          </pre>
        </div>
      )}
    </ToolShell>
  );
}

function F({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
