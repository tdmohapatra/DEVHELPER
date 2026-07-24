import { useState } from "react";
import { Search, Skull, FolderOpen, Copy } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { invokeNative, isTauri, NativeUnavailableError } from "@/lib/platform";
import { copyToClipboard } from "@/lib/utils";
import { toast } from "@/components/ui/toast";

interface PortInfo {
  port: number;
  in_use: boolean;
  pid?: number;
  process_name?: string;
  process_path?: string;
}

export function PortChecker() {
  const [port, setPort] = useState("8080");
  const [result, setResult] = useState<PortInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmKill, setConfirmKill] = useState(false);

  const check = async () => {
    const p = Number(port);
    if (!p || p < 1 || p > 65535) return toast.error("Enter a port between 1 and 65535");
    setLoading(true);
    setConfirmKill(false);
    try {
      const info = await invokeNative<PortInfo>("check_port", { port: p });
      setResult(info);
    } catch (e) {
      if (e instanceof NativeUnavailableError) toast.error("Port checking needs the DevHelper desktop app");
      else toast.error((e as Error).message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const kill = async () => {
    if (!result?.pid) return;
    if (!confirmKill) {
      setConfirmKill(true);
      return;
    }
    try {
      await invokeNative("kill_process", { pid: result.pid });
      toast.success(`Killed PID ${result.pid}`);
      setConfirmKill(false);
      await check();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <ToolShell
      toolId="port-checker"
      title="Port Checker"
      description="Check which process owns a TCP port and free it if needed."
      requiresNative
    >
      {!isTauri() && (
        <div className="mb-4 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          This tool inspects live OS network state and only runs in the <b>DevHelper desktop app</b> (Tauri). In browser dev
          mode it is disabled.
        </div>
      )}

      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Port</label>
          <Input
            type="number"
            className="w-40"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && check()}
          />
        </div>
        <Button onClick={check} disabled={loading || !isTauri()}>
          <Search /> {loading ? "Checking…" : "Check"}
        </Button>
      </div>

      {result && (
        <div className="mt-5 rounded-lg border border-border p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-sm font-medium">Port {result.port}</span>
            {result.in_use ? <Badge variant="destructive">In use</Badge> : <Badge variant="success">Free</Badge>}
          </div>
          {result.in_use ? (
            <>
              <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                <Row label="PID" value={String(result.pid)} />
                <Row label="Process" value={result.process_name ?? "—"} />
                <Row label="Path" value={result.process_path ?? "—"} full />
              </dl>
              <div className="mt-4 flex gap-2">
                <Button variant="destructive" size="sm" onClick={kill}>
                  <Skull /> {confirmKill ? `Confirm kill PID ${result.pid}` : "Kill process"}
                </Button>
                {result.pid && (
                  <Button variant="outline" size="sm" onClick={async () => { await copyToClipboard(String(result.pid)); toast.success("PID copied"); }}>
                    <Copy /> Copy PID
                  </Button>
                )}
                {result.process_path && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      try {
                        const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
                        await revealItemInDir(result.process_path!);
                      } catch {
                        toast.error("Could not open location");
                      }
                    }}
                  >
                    <FolderOpen /> Open location
                  </Button>
                )}
              </div>
              {confirmKill && (
                <p className="mt-2 text-xs text-warning">Click again to confirm. This terminates the process immediately.</p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing is listening on this port.</p>
          )}
        </div>
      )}
    </ToolShell>
  );
}

function Row({ label, value, full }: { label: string; value: string; full?: boolean }) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mono truncate" title={value}>{value}</dd>
    </div>
  );
}
