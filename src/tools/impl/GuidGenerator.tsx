import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CopyButton } from "@/components/CopyButton";
import { generateGuids, type GuidOptions } from "@/tools/lib/guid";

export function GuidGenerator() {
  const [opts, setOpts] = useState<GuidOptions>({ count: 5, uppercase: false, hyphens: true, braces: false });
  const [guids, setGuids] = useState<string[]>(() => generateGuids({ count: 5, uppercase: false, hyphens: true, braces: false }));

  const regen = (o = opts) => setGuids(generateGuids(o));
  const set = <K extends keyof GuidOptions>(k: K, v: GuidOptions[K]) => {
    const next = { ...opts, [k]: v };
    setOpts(next);
    regen(next);
  };

  const text = guids.join("\n");

  return (
    <ToolShell
      toolId="guid-generator"
      title="GUID Generator"
      description="Generate UUID v4 identifiers with formatting options."
      actions={<CopyButton value={text} label="Copy all" />}
    >
      <div className="mb-3 flex flex-wrap items-center gap-4 rounded-md border border-border p-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Count</span>
          <Input
            type="number"
            min={1}
            max={1000}
            className="h-8 w-24"
            value={opts.count}
            onChange={(e) => set("count", Math.max(1, Math.min(1000, Number(e.target.value) || 1)))}
          />
        </label>
        <Check label="Uppercase" checked={opts.uppercase} onChange={(v) => set("uppercase", v)} />
        <Check label="Hyphens" checked={opts.hyphens} onChange={(v) => set("hyphens", v)} />
        <Check label="Braces { }" checked={opts.braces} onChange={(v) => set("braces", v)} />
        <Button size="sm" className="ml-auto" onClick={() => regen()}>
          <RefreshCw /> Regenerate
        </Button>
      </div>
      <Textarea mono readOnly className="h-[calc(100vh-320px)] min-h-64 bg-muted/30" value={text} />
    </ToolShell>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-primary" />
      {label}
    </label>
  );
}
