import { useState } from "react";
import { Plug, RefreshCw } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { executeRequest, corsLimited } from "@/lib/http";
import { toast } from "@/components/ui/toast";

export function NatsTool() {
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState("8222");
  const [varz, setVarz] = useState<any>(null);
  const [connz, setConnz] = useState<any>(null);
  const [subsz, setSubsz] = useState<any>(null);

  const get = async (path: string) => {
    const res = await executeRequest({ method: "GET", url: `http://${host}:${port}${path}`, headers: {} });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return JSON.parse(res.body);
  };

  const refresh = async () => {
    try {
      setVarz(await get("/varz"));
      setConnz(await get("/connz"));
      setSubsz(await get("/subsz?subs=1"));
      toast.success("Fetched NATS monitoring data");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <ToolShell toolId="nats" title="NATS" description="Inspect a NATS server via its HTTP monitoring endpoint (port 8222).">
      {corsLimited() && <div className="mb-3 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">Browser dev mode: monitoring endpoint may be blocked by CORS. Use the desktop app.</div>}
      <div className="mb-2 rounded-md border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
        Read-only monitoring (server/connections/subscriptions). Publish/subscribe over the NATS protocol is not included in this build.
      </div>
      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
        <label className="flex flex-col gap-1 text-sm"><span className="text-xs text-muted-foreground">Host</span><Input className="h-8 w-40" value={host} onChange={(e) => setHost(e.target.value)} /></label>
        <label className="flex flex-col gap-1 text-sm"><span className="text-xs text-muted-foreground">Monitor port</span><Input className="h-8 w-24" value={port} onChange={(e) => setPort(e.target.value)} /></label>
        <Button size="sm" onClick={refresh}><Plug /> Fetch</Button>
        {varz && <Button size="sm" variant="outline" onClick={refresh}><RefreshCw /> Refresh</Button>}
      </div>

      {varz && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <div className="rounded-md border border-border p-3">
            <div className="mb-1 text-xs font-medium text-muted-foreground">Server</div>
            <dl className="space-y-1 text-sm">
              <Row k="Version" v={varz.version} />
              <Row k="Uptime" v={varz.uptime} />
              <Row k="Connections" v={String(varz.connections ?? "")} />
              <Row k="In / Out msgs" v={`${varz.in_msgs ?? 0} / ${varz.out_msgs ?? 0}`} />
              <Row k="Subscriptions" v={String(varz.subscriptions ?? "")} />
            </dl>
          </div>
          <div className="rounded-md border border-border p-3">
            <div className="mb-1 text-xs font-medium text-muted-foreground">Connections ({connz?.num_connections ?? 0})</div>
            <div className="max-h-56 overflow-auto font-mono text-xs">
              {(connz?.connections ?? []).map((c: any, i: number) => (
                <div key={i} className="py-0.5">{c.ip}:{c.port} <Badge variant="secondary" className="ml-1">{c.lang ?? "?"}</Badge></div>
              ))}
            </div>
          </div>
          <div className="rounded-md border border-border p-3">
            <div className="mb-1 text-xs font-medium text-muted-foreground">Subscriptions</div>
            <div className="max-h-56 overflow-auto font-mono text-xs">
              {(subsz?.subscriptions_list ?? subsz?.subscriptions ?? []).slice?.(0, 100)?.map?.((s: any, i: number) => (
                <div key={i} className="py-0.5">{typeof s === "string" ? s : s.subject}</div>
              )) ?? <span className="text-muted-foreground">{subsz?.num_subscriptions ?? 0} subscriptions</span>}
            </div>
          </div>
        </div>
      )}
    </ToolShell>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-2"><dt className="text-muted-foreground">{k}</dt><dd className="font-mono text-xs">{v}</dd></div>;
}
