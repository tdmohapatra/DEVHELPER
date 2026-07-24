import { useState } from "react";
import { Activity, Globe, Plug } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { NativeNotice } from "@/components/NativeNotice";
import { invokeNative, isTauri } from "@/lib/platform";
import { toast } from "@/components/ui/toast";

export function NetworkTools() {
  const [host, setHost] = useState("github.com");
  const [port, setPort] = useState("443");
  const [pingOut, setPingOut] = useState("");
  const [dns, setDns] = useState<string[]>([]);
  const [tcp, setTcp] = useState<string>("");
  const [busy, setBusy] = useState("");

  const guard = () => { if (!isTauri()) { toast.error("Desktop app only"); return false; } return true; };

  const doPing = async () => {
    if (!guard()) return;
    setBusy("ping"); setPingOut("");
    try { setPingOut(await invokeNative<string>("ping", { host })); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(""); }
  };
  const doDns = async () => {
    if (!guard()) return;
    setBusy("dns"); setDns([]);
    try { const r = await invokeNative<{ addresses: string[] }>("dns_lookup", { host }); setDns(r.addresses); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(""); }
  };
  const doTcp = async () => {
    if (!guard()) return;
    setBusy("tcp"); setTcp("");
    try {
      const r = await invokeNative<{ open: boolean; latency_ms?: number }>("tcp_check", { host, port: Number(port) });
      setTcp(r.open ? `open (${r.latency_ms} ms)` : "closed / unreachable");
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(""); }
  };

  return (
    <ToolShell toolId="network-tools" title="Network Utilities" description="Ping, DNS lookup and TCP port checks." requiresNative>
      {!isTauri() && <NativeNotice what="Network utilities" />}
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Host</span>
          <Input className="h-9 w-64 font-mono text-sm" value={host} onChange={(e) => setHost(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Port (for TCP)</span>
          <Input className="h-9 w-24" value={port} onChange={(e) => setPort(e.target.value)} />
        </label>
        <Button size="sm" onClick={doPing} disabled={!!busy}><Activity /> Ping</Button>
        <Button size="sm" variant="outline" onClick={doDns} disabled={!!busy}><Globe /> DNS</Button>
        <Button size="sm" variant="outline" onClick={doTcp} disabled={!!busy}><Plug /> TCP check</Button>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          {dns.length > 0 && (
            <div className="rounded-md border border-border p-3">
              <div className="mb-1 text-xs font-medium text-muted-foreground">DNS — {host}</div>
              <div className="flex flex-wrap gap-1">{dns.map((a) => <Badge key={a} variant="secondary" className="font-mono">{a}</Badge>)}</div>
            </div>
          )}
          {tcp && (
            <div className="rounded-md border border-border p-3 text-sm">
              <span className="text-muted-foreground">TCP {host}:{port} — </span>
              <Badge variant={tcp.startsWith("open") ? "success" : "destructive"}>{tcp}</Badge>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Ping output</label>
          <Textarea mono readOnly className="h-56 bg-muted/30" value={pingOut} placeholder={busy === "ping" ? "Pinging…" : ""} />
        </div>
      </div>
    </ToolShell>
  );
}
