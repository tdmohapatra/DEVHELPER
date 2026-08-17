import { useMemo, useState } from "react";
import { ShieldAlert, ShieldCheck, ShieldX, Trash2, Eye, EyeOff } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { CopyButton } from "@/components/CopyButton";
import { cn } from "@/lib/utils";
import { activePolicy, aiDestinationLabel } from "@/lib/ai";
import { usePhiStore } from "@/stores/usePhiStore";
import {
  applyPolicy,
  detectFormat,
  groupFindings,
  KIND_LABEL,
  reidentify,
  summarise,
  type Format,
  type PhiPolicy,
} from "@/tools/lib/phi";

const POLICIES: { id: PhiPolicy; label: string; detail: string }[] = [
  { id: "off", label: "Off", detail: "Send exactly what was written. Nothing is examined." },
  { id: "warn", label: "Warn", detail: "Report what was found, send it anyway. Useful for seeing what your prompts contain." },
  { id: "redact", label: "Redact", detail: "Replace identifiers with tokens, put the real values back into the answer." },
  { id: "block", label: "Block", detail: "Redact, then refuse to send if anything identifying survived." },
];

const FORMAT_LABEL: Record<Format, string> = {
  hl7: "HL7 v2 — redacted by field position",
  fhir: "FHIR JSON — redacted by property name",
  dicom: "DICOM tag dump — redacted by tag",
  text: "free text — redacted by pattern",
};

const SAMPLE = [
  "MSH|^~\\&|LIS|LAB|EMR|HOSP|20260817103000||ORU^R01|MSG00001|P|2.5",
  "PID|1||100234^^^HOSP^MR||SHARMA^PRIYA^K||19750214|F|||12 MG Road^^Bengaluru^KA^560001||9845012345||||||123-45-6789",
  "OBX|1|NM|718-7^Haemoglobin||9.1|g/dL|13.0-17.0|L|||F",
  "NTE|1||Repeat sample requested; call priya.sharma@hospital.in",
].join("\r\n");

export function PhiGateway() {
  const { policy, trustLocal, log } = usePhiStore();
  const setPhi = usePhiStore((s) => s.set);
  const clearLog = usePhiStore((s) => s.clearLog);

  const [input, setInput] = useState(SAMPLE);
  const [reveal, setReveal] = useState(false);

  const effective = activePolicy();
  const format = useMemo(() => detectFormat(input), [input]);
  const decision = useMemo(() => applyPolicy(input, policy === "off" ? "redact" : policy), [input, policy]);
  const groups = useMemo(() => groupFindings(decision.findings), [decision]);

  return (
    <ToolShell
      toolId="phi-gateway"
      title="PHI Gateway"
      description="What leaves this machine when an AI tool runs — and what is removed first."
    >
      <div className="mb-3 flex flex-col gap-2 rounded-md border border-border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Policy</span>
          {POLICIES.map((p) => (
            <button
              key={p.id}
              onClick={() => setPhi({ policy: p.id })}
              title={p.detail}
              className={cn(
                "rounded-md border px-2 py-1 text-xs",
                policy === p.id ? "border-primary text-primary" : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {p.label}
            </button>
          ))}
          <label className="ml-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={trustLocal} onChange={(e) => setPhi({ trustLocal: e.target.checked })} />
            Skip redaction when the model is on this machine
          </label>
        </div>
        <p className="text-[11px] text-muted-foreground">{POLICIES.find((p) => p.id === policy)?.detail}</p>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          {effective.local ? <ShieldCheck className="size-3.5 text-success" /> : <ShieldAlert className="size-3.5 text-warning" />}
          <span className="text-muted-foreground">
            Right now AI tools send to {aiDestinationLabel()}, so the policy in force is{" "}
            <b className={effective.policy === "off" ? "text-warning" : "text-foreground"}>{effective.policy}</b>
            {effective.policy !== policy && " — relaxed because that address is on this machine"}.
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground">Try it on something</label>
            <Badge variant="outline" className="text-[9px]">{FORMAT_LABEL[format]}</Badge>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setInput(SAMPLE)}>
              Sample
            </Button>
          </div>
          <Textarea mono className="h-64" value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} />
          <p className="text-[11px] text-muted-foreground">
            Nothing typed here is sent anywhere — this screen only shows what the gateway would do. The redaction itself
            runs inside every AI tool, on the way out.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground">What would be sent</label>
            <CopyButton className="ml-auto" value={decision.text} />
          </div>
          <pre className="mono h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/20 p-3 text-[11px]">
            {decision.text}
          </pre>
          <p className="text-[11px] text-muted-foreground">
            {summarise(decision.findings)}
            {decision.residual.length > 0 && (
              <b className="text-destructive"> · {decision.residual.length} still identifiable after redaction</b>
            )}
          </p>
        </div>
      </div>

      {groups.length > 0 && (
        <div className="mt-3 flex flex-col gap-1 rounded-md border border-border">
          <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
            <span className="text-xs font-medium">What was found</span>
            <Badge variant="outline" className="text-[9px]">{decision.findings.length}</Badge>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setReveal((v) => !v)}>
              {reveal ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />} {reveal ? "Hide values" : "Show values"}
            </Button>
          </div>
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-xs">
              <tbody className="divide-y divide-border">
                {groups.map((g) => (
                  <tr key={g.kind} className="hover:bg-secondary/40">
                    <td className="w-40 px-3 py-1.5">
                      {KIND_LABEL[g.kind]}
                      <Badge variant={g.certain ? "success" : "secondary"} className="ml-2 text-[9px]">
                        {g.certain ? "field" : "guess"}
                      </Badge>
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">{g.values.length}</td>
                    <td className="mono max-w-[420px] truncate px-3 py-1.5" title={reveal ? g.values.join(", ") : undefined}>
                      {reveal ? g.values.join(", ") : "•".repeat(Math.min(24, g.values.join(", ").length))}
                    </td>
                    <td className="px-3 py-1.5 text-[11px] text-muted-foreground">{g.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-3 py-1.5 text-[11px] text-muted-foreground">
            <b>field</b> means the format said so — an HL7 field position, a FHIR property, a DICOM tag — and is exact.
            <b> guess</b> means a pattern matched, which is best-effort and can be wrong in both directions.
          </p>
        </div>
      )}

      {Object.keys(decision.map).length > 0 && (
        <div className="mt-3 rounded-md border border-border p-3">
          <p className="text-xs font-medium">Round trip</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            An answer that mentions a token comes back with the real value in it. This is that substitution, run on a
            pretend answer:
          </p>
          <pre className="mono mt-2 overflow-auto whitespace-pre-wrap rounded bg-muted/20 p-2 text-[11px]">
            {reidentify(
              `The message for ${Object.keys(decision.map)[0]} failed validation.`,
              reveal ? decision.map : { [Object.keys(decision.map)[0]]: "«the real value»" },
            )}
          </pre>
        </div>
      )}

      <div className="mt-3 rounded-md border border-border">
        <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
          <span className="text-xs font-medium">What has left this machine</span>
          <Badge variant="outline" className="text-[9px]">{log.length}</Badge>
          {log.length > 0 && (
            <Button size="sm" variant="ghost" className="ml-auto" onClick={clearLog}>
              <Trash2 className="size-3.5" /> Clear
            </Button>
          )}
        </div>
        {log.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            No AI request has been made yet. Every one is recorded here — counts and categories only, never a value.
          </p>
        ) : (
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 border-b border-border bg-card text-left text-muted-foreground">
                <tr>
                  {["When", "Tool", "Destination", "Policy", "Found", "Sent"].map((c) => (
                    <th key={c} className="whitespace-nowrap px-3 py-1 font-medium">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {log.map((entry, i) => (
                  <tr key={i} className="hover:bg-secondary/40" title={entry.message}>
                    <td className="whitespace-nowrap px-3 py-1 text-muted-foreground">{new Date(entry.at).toLocaleTimeString()}</td>
                    <td className="px-3 py-1">{entry.tool}</td>
                    <td className="mono max-w-[260px] truncate px-3 py-1 text-muted-foreground">
                      {entry.destination}
                      {entry.local && <Badge variant="secondary" className="ml-2 text-[9px]">local</Badge>}
                    </td>
                    <td className="px-3 py-1">{entry.policy}</td>
                    <td className="px-3 py-1">
                      {entry.found === 0 ? "—" : Object.entries(entry.kinds).map(([k, n]) => `${n}× ${KIND_LABEL[k as keyof typeof KIND_LABEL]}`).join(", ")}
                    </td>
                    <td className="px-3 py-1">
                      {entry.sent ? (
                        <span className="text-muted-foreground">yes</span>
                      ) : (
                        <span className="flex items-center gap-1 text-destructive">
                          <ShieldX className="size-3.5" /> blocked
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground">
        This is a seatbelt, not a compliance control. Detection is best-effort and always will be: it cannot recognise a
        name in prose, and it does not know your local identifier formats. It makes the common accident survivable. It is
        not a substitute for a BAA with your provider, a de-identification review, or not pasting the record at all.
      </p>
    </ToolShell>
  );
}
