import { useMemo, useState } from "react";
import { ToolShell } from "@/components/ToolShell";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { CopyButton } from "@/components/CopyButton";
import {
  jsonToCSharp,
  DEFAULT_CSHARP_OPTIONS,
  type CSharpOptions,
} from "@/tools/lib/json";

const SAMPLE = `{
  "id": 123,
  "userName": "jdoe",
  "isActive": true,
  "balance": 42.5,
  "roles": ["admin", "user"],
  "profile": { "firstName": "John", "lastName": "Doe" }
}`;

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-primary" />
      {label}
    </label>
  );
}

export function JsonToCsharp() {
  const [input, setInput] = useState(SAMPLE);
  const [opts, setOpts] = useState<CSharpOptions>(DEFAULT_CSHARP_OPTIONS);
  const [error, setError] = useState("");

  const output = useMemo(() => {
    try {
      setError("");
      return jsonToCSharp(input, opts);
    } catch (e) {
      setError((e as Error).message);
      return "";
    }
  }, [input, opts]);

  const set = <K extends keyof CSharpOptions>(k: K, v: CSharpOptions[K]) => setOpts((o) => ({ ...o, [k]: v }));

  return (
    <ToolShell
      toolId="json-to-csharp"
      title="JSON → C#"
      description="Generate C# classes or records from a JSON sample."
      actions={<CopyButton value={output} />}
    >
      <div className="mb-3 flex flex-wrap items-center gap-4 rounded-md border border-border p-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Root</span>
          <Input className="h-8 w-40" value={opts.rootName} onChange={(e) => set("rootName", e.target.value)} />
        </div>
        <Toggle label="Records" checked={opts.useRecords} onChange={(v) => set("useRecords", v)} />
        <Toggle label="Nullable refs" checked={opts.nullableRefs} onChange={(v) => set("nullableRefs", v)} />
        <Toggle label="required" checked={opts.useRequired} onChange={(v) => set("useRequired", v)} />
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Attrs</span>
          <select
            className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
            value={opts.framework}
            onChange={(e) => set("framework", e.target.value as CSharpOptions["framework"])}
          >
            <option value="SystemTextJson">System.Text.Json</option>
            <option value="Newtonsoft">Newtonsoft.Json</option>
          </select>
        </label>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">JSON</label>
          <Textarea mono className="h-[calc(100vh-380px)] min-h-64" value={input} onChange={(e) => setInput(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">C#</label>
          <Textarea mono readOnly className="h-[calc(100vh-380px)] min-h-64 bg-muted/30" value={output} />
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </ToolShell>
  );
}
