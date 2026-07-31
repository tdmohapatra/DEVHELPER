import { useMemo, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/CopyButton";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { parseHl7, formatHl7, hl7ToJson, validateHl7, describeMessageType } from "@/tools/lib/hl7";
import {
  ACK_CODES,
  buildAck,
  describeFraming,
  diffHl7,
  flattenHl7,
  getHl7Value,
  hl7ToFhirBundle,
  mllpUnwrap,
  mllpWrap,
  validateHl7Structure,
  type AckCode,
} from "@/tools/lib/hl7Advanced";

const SAMPLE = [
  "MSH|^~\\&|EPIC|HOSP|LAB|DH|20240101120000||ADT^A01|MSG00001|P|2.5",
  "EVN|A01|20240101120000",
  "PID|1||12345^^^HOSP^MR||DOE^JOHN^A||19800101|M|||123 MAIN ST^^SPRINGFIELD^CA^90001||555-123-4567",
  "PV1|1|I|ICU^101^A|||||1234^SMITH^JANE",
].join("\n");

type View = "tree" | "json" | "paths" | "validate" | "ack" | "fhir" | "diff" | "mllp";

export function Hl7Toolkit() {
  const [input, setInput] = useState(SAMPLE);
  const [view, setView] = useState<View>("tree");
  const [pathExpr, setPathExpr] = useState("PID-5.1");
  const [ackCode, setAckCode] = useState<AckCode>("AA");
  const [ackText, setAckText] = useState("");
  const [compareTo, setCompareTo] = useState("");

  const parsed = useMemo(() => {
    try {
      return { msg: parseHl7(input), error: "" };
    } catch (e) {
      return { msg: null, error: (e as Error).message };
    }
  }, [input]);

  const validation = useMemo(() => validateHl7(input), [input]);
  const json = useMemo(() => {
    try {
      return hl7ToJson(input);
    } catch {
      return "";
    }
  }, [input]);

  const structure = useMemo(() => validateHl7Structure(input), [input]);
  const structureErrors = structure.filter((i) => i.severity === "error");
  const paths = useMemo(() => (parsed.msg ? flattenHl7(parsed.msg) : []), [parsed.msg]);
  const pathResult = useMemo(() => {
    if (!parsed.msg || !pathExpr.trim()) return null;
    try {
      const value = getHl7Value(parsed.msg, pathExpr);
      return { value, error: "" };
    } catch (e) {
      return { value: undefined, error: (e as Error).message };
    }
  }, [parsed.msg, pathExpr]);

  const ack = useMemo(() => {
    try {
      return buildAck(input, ackCode, ackText);
    } catch (e) {
      return `Cannot build an acknowledgement: ${(e as Error).message}`;
    }
  }, [input, ackCode, ackText]);

  const fhirBundle = useMemo(() => {
    try {
      return hl7ToFhirBundle(input);
    } catch (e) {
      return `Cannot map to FHIR: ${(e as Error).message}`;
    }
  }, [input]);

  const differences = useMemo(() => {
    if (!compareTo.trim()) return [];
    try {
      return diffHl7(input, compareTo);
    } catch {
      return [];
    }
  }, [input, compareTo]);

  /** What the header Copy button offers, per tab. */
  const copyValue =
    view === "json" ? json
    : view === "fhir" ? fhirBundle
    : view === "ack" ? ack
    : view === "mllp" ? describeFraming(mllpWrap(input))
    : view === "paths" ? paths.map((p) => `${p.path}\t${p.value}`).join("\n")
    : formatHl7(input);

  return (
    <ToolShell
      toolId="hl7-toolkit"
      title="HL7 Toolkit"
      description="Parse, explore and convert HL7 v2 messages. Local-only integration utility — not clinical software."
      actions={<CopyButton value={copyValue} label="Copy" />}
    >
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground">HL7 message</label>
            <Button size="sm" variant="ghost" className="ml-auto h-6" onClick={() => setInput(formatHl7(input))}>Format</Button>
          </div>
          <Textarea mono className="h-[calc(100vh-360px)] min-h-64" value={input} onChange={(e) => setInput(e.target.value)} />
          {parsed.msg && (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
              <Badge>{parsed.msg.messageType || "?"}</Badge>
              <span className="text-muted-foreground">{describeMessageType(parsed.msg.messageType)}</span>
              {validation.valid && structureErrors.length === 0 ? (
                <Badge variant="success" className="ml-auto gap-1"><CheckCircle2 className="size-3" /> Valid</Badge>
              ) : (
                <Badge variant="destructive" className="ml-auto gap-1">
                  <XCircle className="size-3" /> {validation.errors.length + structureErrors.length} issue(s)
                </Badge>
              )}
            </div>
          )}
          {parsed.error && <p className="mt-1 text-xs text-destructive">{parsed.error}</p>}
          {!validation.valid && validation.errors.map((e, i) => <p key={i} className="text-xs text-destructive">• {e}</p>)}
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-1">
            <TabBtn active={view === "tree"} onClick={() => setView("tree")} label="Segments" />
            <TabBtn active={view === "paths"} onClick={() => setView("paths")} label="Paths" />
            <TabBtn active={view === "validate"} onClick={() => setView("validate")} label={`Validate${structureErrors.length ? ` (${structureErrors.length})` : ""}`} />
            <TabBtn active={view === "ack"} onClick={() => setView("ack")} label="ACK" />
            <TabBtn active={view === "fhir"} onClick={() => setView("fhir")} label="FHIR" />
            <TabBtn active={view === "diff"} onClick={() => setView("diff")} label="Diff" />
            <TabBtn active={view === "mllp"} onClick={() => setView("mllp")} label="MLLP" />
            <TabBtn active={view === "json"} onClick={() => setView("json")} label="JSON" />
          </div>
          <div className="h-[calc(100vh-360px)] min-h-64 overflow-auto rounded-md border border-border bg-muted/20 p-2">
            {view === "paths" ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Input
                    className="h-8 font-mono text-xs"
                    value={pathExpr}
                    onChange={(e) => setPathExpr(e.target.value)}
                    placeholder="PID-5.1  ·  OBX[2]-5  ·  PID-3(2).1"
                  />
                  {pathResult && (
                    <span className={cn("shrink-0 font-mono text-xs", pathResult.value === undefined && "text-muted-foreground")}>
                      {pathResult.error || (pathResult.value === undefined ? "not present" : pathResult.value)}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Every populated location, with escape sequences decoded. Click one to query it.
                </p>
                <table className="w-full font-mono text-[12px]">
                  <tbody className="divide-y divide-border">
                    {paths.map((p) => (
                      <tr key={p.path} className="cursor-pointer hover:bg-muted/50" onClick={() => setPathExpr(p.path)}>
                        <td className="w-40 px-2 py-0.5 text-muted-foreground">{p.path}</td>
                        <td className="px-2 py-0.5 break-all">{p.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : view === "validate" ? (
              <div className="flex flex-col gap-1 p-1">
                {structure.length === 0 ? (
                  <p className="flex items-center gap-1.5 text-sm text-success">
                    <CheckCircle2 className="size-4" /> No structural problems found.
                  </p>
                ) : (
                  structure.map((issue, i) => (
                    <div key={i} className={cn("flex items-start gap-2 rounded border p-2 text-xs",
                      issue.severity === "error" ? "border-destructive/40 bg-destructive/10" : "border-warning/40 bg-warning/10")}>
                      <Badge variant={issue.severity === "error" ? "destructive" : "warning"} className="shrink-0 text-[10px]">
                        {issue.severity}
                      </Badge>
                      <span className="min-w-0 flex-1">{issue.message}</span>
                      {issue.location && <span className="shrink-0 font-mono text-muted-foreground">{issue.location}</span>}
                    </div>
                  ))
                )}
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Structural checks only — mandatory segments, control id, timestamps and value types. This is not a
                  conformance statement and says nothing about clinical correctness.
                </p>
              </div>
            ) : view === "ack" ? (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
                    value={ackCode}
                    onChange={(e) => setAckCode(e.target.value as AckCode)}
                  >
                    {ACK_CODES.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}
                  </select>
                  <Input
                    className="h-8 flex-1 text-xs"
                    value={ackText}
                    onChange={(e) => setAckText(e.target.value)}
                    placeholder="Optional MSA-3 text, e.g. why it was rejected"
                  />
                </div>
                <pre className="mono whitespace-pre-wrap break-all rounded border border-border bg-card p-2 text-[12px]">{ack}</pre>
                <p className="text-[11px] text-muted-foreground">
                  The acknowledgement an engine would return: sender and receiver swapped, MSH-10 echoed into MSA-2.
                </p>
              </div>
            ) : view === "fhir" ? (
              <div className="flex flex-col gap-2">
                <p className="text-[11px] text-muted-foreground">
                  PID → Patient, PV1 → Encounter, OBX → Observation, as a transaction Bundle. Fields that do not map
                  cleanly are left out rather than guessed at.
                </p>
                <pre className="mono whitespace-pre-wrap text-[12px]">{fhirBundle}</pre>
              </div>
            ) : view === "diff" ? (
              <div className="flex flex-col gap-2">
                <Textarea
                  mono
                  className="h-32 text-[12px]"
                  value={compareTo}
                  onChange={(e) => setCompareTo(e.target.value)}
                  placeholder="Paste a second message to compare against the one on the left"
                />
                {compareTo.trim() && (
                  <>
                    <p className="text-[11px] text-muted-foreground">{differences.length} difference(s)</p>
                    <table className="w-full font-mono text-[12px]">
                      <tbody className="divide-y divide-border">
                        {differences.map((d) => (
                          <tr key={d.path}>
                            <td className="w-32 px-2 py-0.5 text-muted-foreground">{d.path}</td>
                            <td className="w-16 px-2 py-0.5">
                              <span className={cn(
                                d.kind === "added" && "text-success",
                                d.kind === "removed" && "text-destructive",
                                d.kind === "changed" && "text-warning",
                              )}>{d.kind}</span>
                            </td>
                            <td className="px-2 py-0.5 break-all">
                              {d.kind === "changed" ? `${d.left} → ${d.right}` : (d.left ?? d.right)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </div>
            ) : view === "mllp" ? (
              <div className="flex flex-col gap-2">
                <p className="text-[11px] text-muted-foreground">
                  MLLP framing as an interface engine expects it: {"<VT>"} message {"<FS><CR>"}. Copy takes the readable
                  form; the framing characters themselves are invisible bytes.
                </p>
                <pre className="mono whitespace-pre-wrap break-all rounded border border-border bg-card p-2 text-[12px]">
                  {describeFraming(mllpWrap(input))}
                </pre>
                <Button size="sm" variant="outline" className="self-start" onClick={() => setInput(mllpUnwrap(input))}>
                  Strip framing from the input
                </Button>
              </div>
            ) : view === "json" ? (
              <pre className="mono whitespace-pre-wrap text-[12px]">{json}</pre>
            ) : parsed.msg ? (
              <div className="space-y-2">
                {parsed.msg.segments.map((seg, si) => (
                  <div key={si} className="rounded-md border border-border bg-card">
                    <div className="flex items-center gap-2 border-b border-border px-2 py-1 text-sm">
                      <span className="font-bold text-primary">{seg.name}</span>
                      <span className="text-xs text-muted-foreground">{seg.description}</span>
                    </div>
                    <table className="w-full text-[12px]">
                      <tbody className="divide-y divide-border font-mono">
                        {seg.fields.filter((f) => f.value !== "").map((f) => (
                          <tr key={f.index}>
                            <td className="w-10 px-2 py-0.5 text-muted-foreground">{seg.name}-{f.index}</td>
                            <td className="w-40 px-2 py-0.5 text-muted-foreground">{f.name}</td>
                            <td className="px-2 py-0.5 break-all">{f.components.length > 1 ? f.components.join(" · ") : f.value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            ) : (
              <p className="p-2 text-sm text-muted-foreground">Enter a valid HL7 message to explore its segments.</p>
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
