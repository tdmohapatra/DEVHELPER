import { useState } from "react";
import { RefreshCw, Download } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/CopyButton";
import { ENTITIES, generateRecords, exportRecords, type EntityKind, type ExportFormat } from "@/tools/lib/testdata";

const FORMATS: { value: ExportFormat; label: string; ext: string }[] = [
  { value: "json", label: "JSON", ext: "json" },
  { value: "csv", label: "CSV", ext: "csv" },
  { value: "sql", label: "SQL INSERT", ext: "sql" },
  { value: "xml", label: "XML", ext: "xml" },
];

export function TestDataGenerator() {
  const [kind, setKind] = useState<EntityKind>("user");
  const [count, setCount] = useState(10);
  const [format, setFormat] = useState<ExportFormat>("json");
  const [output, setOutput] = useState("");

  const table = ENTITIES.find((e) => e.value === kind)!.table;

  const generate = () => {
    const records = generateRecords(kind, count);
    setOutput(exportRecords(records, format, table));
  };

  const download = () => {
    if (!output) return;
    const ext = FORMATS.find((f) => f.value === format)!.ext;
    const blob = new Blob([output], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${table}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <ToolShell
      toolId="test-data-generator"
      title="Test Data Generator"
      description="Generate synthetic records. All data is fake — never real personal information or PHI."
      actions={
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={download} disabled={!output}><Download /> Download</Button>
          <CopyButton value={output} />
        </div>
      }
    >
      <div className="mb-3 flex flex-wrap items-end gap-3 rounded-md border border-border p-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Entity</span>
          <select className="h-8 rounded-md border border-input bg-transparent px-2 text-sm" value={kind} onChange={(e) => setKind(e.target.value as EntityKind)}>
            {ENTITIES.map((e) => (<option key={e.value} value={e.value}>{e.label}</option>))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Count</span>
          <Input type="number" min={1} max={1000} className="h-8 w-24" value={count} onChange={(e) => setCount(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Format</span>
          <select className="h-8 rounded-md border border-input bg-transparent px-2 text-sm" value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
            {FORMATS.map((f) => (<option key={f.value} value={f.value}>{f.label}</option>))}
          </select>
        </label>
        <Button size="sm" onClick={generate}><RefreshCw /> Generate</Button>
        {kind === "patient" && <Badge variant="warning" className="ml-auto">Synthetic PHI-free data</Badge>}
      </div>
      <Textarea mono readOnly className="h-[calc(100vh-340px)] min-h-64 bg-muted/30" value={output} placeholder="Click Generate…" />
    </ToolShell>
  );
}
