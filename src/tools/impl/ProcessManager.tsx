import { useEffect, useState } from "react";
import { RefreshCw, Skull, Search } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeNotice } from "@/components/NativeNotice";
import { invokeNative, isTauri } from "@/lib/platform";
import { toast } from "@/components/ui/toast";

interface Proc { pid: number; name: string; cpu: number; memory_mb: number; exe?: string; }

export function ProcessManager() {
  const [filter, setFilter] = useState("");
  const [procs, setProcs] = useState<Proc[]>([]);
  const [confirmPid, setConfirmPid] = useState<number | null>(null);

  const refresh = async () => {
    if (!isTauri()) return;
    try {
      setProcs(await invokeNative<Proc[]>("list_processes", { filter: filter || null }));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  useEffect(() => { refresh(); }, []);

  const kill = async (pid: number) => {
    if (confirmPid !== pid) return setConfirmPid(pid);
    try {
      await invokeNative("kill_pid", { pid });
      toast.success(`Killed PID ${pid}`);
      setConfirmPid(null);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <ToolShell toolId="process-manager" title="Process Manager" description="Search, inspect and kill running processes (top 300 by memory)." requiresNative
      actions={<Button size="sm" variant="outline" onClick={refresh} disabled={!isTauri()}><RefreshCw /> Refresh</Button>}>
      {!isTauri() && <NativeNotice what="The process manager" />}
      <div className="mb-3 flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Filter by name…" value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => e.key === "Enter" && refresh()} disabled={!isTauri()} />
        </div>
        <Button size="sm" onClick={refresh} disabled={!isTauri()}>Search</Button>
      </div>
      <div className="overflow-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs text-muted-foreground">
            <tr><th className="px-3 py-2">PID</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Mem (MB)</th><th className="px-3 py-2">CPU %</th><th className="px-3 py-2">Path</th><th className="px-3 py-2"></th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {procs.map((p) => (
              <tr key={p.pid}>
                <td className="px-3 py-1.5 font-mono text-xs">{p.pid}</td>
                <td className="px-3 py-1.5">{p.name}</td>
                <td className="px-3 py-1.5 font-mono text-xs">{p.memory_mb}</td>
                <td className="px-3 py-1.5 font-mono text-xs">{p.cpu.toFixed(1)}</td>
                <td className="px-3 py-1.5 max-w-xs truncate font-mono text-[11px] text-muted-foreground" title={p.exe}>{p.exe ?? "—"}</td>
                <td className="px-3 py-1.5">
                  <Button size="sm" variant={confirmPid === p.pid ? "destructive" : "ghost"} onClick={() => kill(p.pid)}>
                    <Skull className="size-3.5" /> {confirmPid === p.pid ? "Confirm" : ""}
                  </Button>
                </td>
              </tr>
            ))}
            {procs.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">{isTauri() ? "No processes." : "—"}</td></tr>}
          </tbody>
        </table>
      </div>
    </ToolShell>
  );
}
