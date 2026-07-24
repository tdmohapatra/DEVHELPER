import { useMemo, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/CopyButton";
import { formatYaml, yamlToJson, jsonToYaml, validateYaml } from "@/tools/lib/yaml";
import { toast } from "@/components/ui/toast";

const SAMPLE = `name: DevHelper\nversion: 0.1.0\ntools:\n  - json\n  - yaml\nactive: true`;

export function YamlTool() {
  const [input, setInput] = useState(SAMPLE);
  const [output, setOutput] = useState("");
  const validation = useMemo(() => validateYaml(input), [input]);

  const run = (fn: (s: string) => string) => {
    try {
      setOutput(fn(input));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <ToolShell
      toolId="yaml-tools"
      title="YAML Tools"
      description="Format, validate and convert YAML ↔ JSON."
      actions={<CopyButton value={output} />}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => run((s) => formatYaml(s))}>Format</Button>
        <Button size="sm" variant="outline" onClick={() => run((s) => yamlToJson(s))}>YAML → JSON</Button>
        <Button size="sm" variant="outline" onClick={() => run((s) => jsonToYaml(s))}>JSON → YAML</Button>
        <span className="ml-auto">
          {validation.valid ? (
            <Badge variant="success" className="gap-1"><CheckCircle2 className="size-3" /> Valid YAML</Badge>
          ) : (
            <Badge variant="destructive" className="gap-1" title={validation.error}><XCircle className="size-3" /> Invalid</Badge>
          )}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Input</label>
          <Textarea mono className="h-[calc(100vh-320px)] min-h-64" value={input} onChange={(e) => setInput(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Output</label>
          <Textarea mono readOnly className="h-[calc(100vh-320px)] min-h-64 bg-muted/30" value={output} placeholder="Result appears here…" />
        </div>
      </div>
      {!validation.valid && input.trim() && <p className="mt-2 text-xs text-destructive">{validation.error}</p>}
    </ToolShell>
  );
}
