import { useEffect, useState } from "react";
import { RefreshCw, CheckCircle2, XCircle } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { NativeNotice } from "@/components/NativeNotice";
import { invokeNative, isTauri } from "@/lib/platform";

interface ToolStatus { name: string; installed: boolean; version: string; }

export function EnvironmentChecker() {
  const [tools, setTools] = useState<ToolStatus[]>([]);
  const [loading, setLoading] = useState(false);

  const check = async () => {
    if (!isTauri()) return;
    setLoading(true);
    try { setTools(await invokeNative<ToolStatus[]>("check_environment")); }
    finally { setLoading(false); }
  };
  useEffect(() => { check(); }, []);

  return (
    <ToolShell toolId="environment-checker" title="Environment Checker" description="Detect installed developer tooling and versions." requiresNative
      actions={<Button size="sm" variant="outline" onClick={check} disabled={!isTauri() || loading}><RefreshCw /> Re-check</Button>}>
      {!isTauri() && <NativeNotice what="The environment checker" />}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {tools.map((t) => (
          <div key={t.name} className="flex items-center gap-2 rounded-md border border-border p-3">
            {t.installed ? <CheckCircle2 className="size-4 text-success" /> : <XCircle className="size-4 text-muted-foreground" />}
            <div className="min-w-0">
              <div className="text-sm font-medium">{t.name}</div>
              <div className="truncate font-mono text-xs text-muted-foreground">{t.installed ? t.version || "installed" : "not found"}</div>
            </div>
          </div>
        ))}
      </div>
    </ToolShell>
  );
}
