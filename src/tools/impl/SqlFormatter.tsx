import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { SqlLanguage } from "sql-formatter";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/CopyButton";
import { formatSql, isDestructiveSql, SQL_DIALECTS } from "@/tools/lib/sql";
import { toast } from "@/components/ui/toast";

const SAMPLE = "select u.id, u.name, o.total from users u join orders o on o.user_id=u.id where u.active=1 order by o.total desc";

export function SqlFormatter() {
  const [input, setInput] = useState(SAMPLE);
  const [output, setOutput] = useState("");
  const [language, setLanguage] = useState<SqlLanguage>("sql");
  const [uppercase, setUppercase] = useState(true);

  const destructive = useMemo(() => isDestructiveSql(input), [input]);

  const run = () => {
    try {
      setOutput(formatSql(input, { language, uppercase, tabWidth: 2 }));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <ToolShell
      toolId="sql-formatter"
      title="SQL Formatter"
      description="Beautify SQL across dialects. Flags potentially destructive statements."
      actions={<CopyButton value={output} />}
    >
      <div className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-border p-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Dialect</span>
          <select className="h-8 rounded-md border border-input bg-transparent px-2 text-sm" value={language} onChange={(e) => setLanguage(e.target.value as SqlLanguage)}>
            {SQL_DIALECTS.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={uppercase} onChange={(e) => setUppercase(e.target.checked)} className="accent-primary" />
          Uppercase keywords
        </label>
        <Button size="sm" onClick={run}>Format</Button>
        {destructive && (
          <Badge variant="warning" className="ml-auto gap-1"><AlertTriangle className="size-3" /> Destructive statement detected</Badge>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Input</label>
          <Textarea mono className="h-[calc(100vh-340px)] min-h-64" value={input} onChange={(e) => setInput(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Formatted</label>
          <Textarea mono readOnly className="h-[calc(100vh-340px)] min-h-64 bg-muted/30" value={output} />
        </div>
      </div>
    </ToolShell>
  );
}
