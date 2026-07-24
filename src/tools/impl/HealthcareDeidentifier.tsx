import { useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/CopyButton";
import { detectPii, deidentify, summarize, type RedactMode } from "@/tools/lib/deidentify";

const SAMPLE = `Patient: John Doe
DOB: 01/01/1980
MRN: 123456
Phone: 555-987-6543
Email: john.doe@hospital.org
SSN: 123-45-6789
Server: 10.0.0.42`;

const MODES: { value: RedactMode; label: string }[] = [
  { value: "label", label: "Label ([EMAIL])" },
  { value: "mask", label: "Mask (XXX)" },
  { value: "pseudo", label: "Pseudonymize" },
];

export function HealthcareDeidentifier() {
  const [input, setInput] = useState(SAMPLE);
  const [mode, setMode] = useState<RedactMode>("label");

  const findings = useMemo(() => detectPii(input), [input]);
  const summary = useMemo(() => summarize(findings), [findings]);
  const output = useMemo(() => deidentify(input, mode), [input, mode]);

  return (
    <ToolShell
      toolId="healthcare-deidentifier"
      title="Healthcare Data De-identifier"
      description="Detect and remove sensitive data. 100% local — nothing is ever transmitted. Best-effort, not a compliance guarantee."
      actions={<CopyButton value={output} label="Copy result" />}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-success/40 bg-success/10 p-2 text-xs">
        <ShieldCheck className="size-4 text-success" />
        All detection and redaction runs locally in this app. No network calls.
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Found:</span>
        {summary.total === 0 ? (
          <Badge variant="secondary">nothing detected</Badge>
        ) : (
          Object.entries(summary.byType).map(([label, n]) => <Badge key={label} variant="warning">{n} {label}</Badge>)
        )}
        <label className="ml-auto flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Mode</span>
          <select className="h-8 rounded-md border border-input bg-transparent px-2 text-sm" value={mode} onChange={(e) => setMode(e.target.value as RedactMode)}>
            {MODES.map((m) => (<option key={m.value} value={m.value}>{m.label}</option>))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Input (raw)</label>
          <Textarea mono className="h-[calc(100vh-380px)] min-h-64" value={input} onChange={(e) => setInput(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">De-identified</label>
          <Textarea mono readOnly className="h-[calc(100vh-380px)] min-h-64 bg-muted/30" value={output} />
        </div>
      </div>
    </ToolShell>
  );
}
