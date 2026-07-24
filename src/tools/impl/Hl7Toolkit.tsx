import { useMemo, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/CopyButton";
import { parseHl7, formatHl7, hl7ToJson, validateHl7, describeMessageType } from "@/tools/lib/hl7";

const SAMPLE = [
  "MSH|^~\\&|EPIC|HOSP|LAB|DH|20240101120000||ADT^A01|MSG00001|P|2.5",
  "EVN|A01|20240101120000",
  "PID|1||12345^^^HOSP^MR||DOE^JOHN^A||19800101|M|||123 MAIN ST^^SPRINGFIELD^CA^90001||555-123-4567",
  "PV1|1|I|ICU^101^A|||||1234^SMITH^JANE",
].join("\n");

export function Hl7Toolkit() {
  const [input, setInput] = useState(SAMPLE);
  const [view, setView] = useState<"tree" | "json">("tree");

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

  return (
    <ToolShell
      toolId="hl7-toolkit"
      title="HL7 Toolkit"
      description="Parse, explore and convert HL7 v2 messages. Local-only integration utility — not clinical software."
      actions={<CopyButton value={view === "json" ? json : formatHl7(input)} label={view === "json" ? "Copy JSON" : "Copy HL7"} />}
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
              {validation.valid ? (
                <Badge variant="success" className="ml-auto gap-1"><CheckCircle2 className="size-3" /> Valid</Badge>
              ) : (
                <Badge variant="destructive" className="ml-auto gap-1"><XCircle className="size-3" /> {validation.errors.length} issue(s)</Badge>
              )}
            </div>
          )}
          {parsed.error && <p className="mt-1 text-xs text-destructive">{parsed.error}</p>}
          {!validation.valid && validation.errors.map((e, i) => <p key={i} className="text-xs text-destructive">• {e}</p>)}
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <TabBtn active={view === "tree"} onClick={() => setView("tree")} label="Segment Explorer" />
            <TabBtn active={view === "json"} onClick={() => setView("json")} label="JSON" />
          </div>
          <div className="h-[calc(100vh-360px)] min-h-64 overflow-auto rounded-md border border-border bg-muted/20 p-2">
            {view === "json" ? (
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
