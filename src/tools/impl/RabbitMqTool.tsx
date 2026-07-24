import { useState, type ReactNode } from "react";
import { Plug, RefreshCw, Send } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { executeRequest, corsLimited } from "@/lib/http";
import { toast } from "@/components/ui/toast";

interface Queue { name: string; messages: number; consumers: number; state?: string; }
interface Exchange { name: string; type: string; }

export function RabbitMqTool() {
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState("15672");
  const [user, setUser] = useState("guest");
  const [pass, setPass] = useState("guest");
  const [connected, setConnected] = useState(false);
  const [queues, setQueues] = useState<Queue[]>([]);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [pubQueue, setPubQueue] = useState("");
  const [pubBody, setPubBody] = useState('{"hello":"world"}');

  const base = () => `http://${host}:${port}/api`;
  const auth = () => `Basic ${btoa(`${user}:${pass}`)}`;

  const get = async (path: string) => {
    const res = await executeRequest({ method: "GET", url: `${base()}${path}`, headers: { Authorization: auth() } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return JSON.parse(res.body);
  };

  const connect = async () => {
    try {
      await get("/overview");
      setConnected(true);
      toast.success("Connected to RabbitMQ management API");
      refresh();
    } catch (e) {
      setConnected(false);
      toast.error((e as Error).message);
    }
  };

  const refresh = async () => {
    try {
      const q = (await get("/queues")) as any[];
      setQueues(q.map((x) => ({ name: x.name, messages: x.messages ?? 0, consumers: x.consumers ?? 0, state: x.state })));
      const ex = (await get("/exchanges")) as any[];
      setExchanges(ex.filter((x) => x.name).map((x) => ({ name: x.name, type: x.type })));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const publish = async () => {
    if (!pubQueue.trim()) return toast.error("Enter a routing key / queue name");
    try {
      const res = await executeRequest({
        method: "POST",
        url: `${base()}/exchanges/%2F/amq.default/publish`,
        headers: { Authorization: auth(), "Content-Type": "application/json" },
        body: JSON.stringify({ properties: {}, routing_key: pubQueue.trim(), payload: pubBody, payload_encoding: "string" }),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      toast.success("Published");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <ToolShell toolId="rabbitmq" title="RabbitMQ" description="Browse queues/exchanges and publish messages via the management API (port 15672).">
      {corsLimited() && <div className="mb-3 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">Browser dev mode: the management API may be blocked by CORS. Use the desktop app.</div>}
      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
        <F label="Host"><Input className="h-8 w-36" value={host} onChange={(e) => setHost(e.target.value)} /></F>
        <F label="Mgmt port"><Input className="h-8 w-24" value={port} onChange={(e) => setPort(e.target.value)} /></F>
        <F label="User"><Input className="h-8 w-28" value={user} onChange={(e) => setUser(e.target.value)} /></F>
        <F label="Password"><Input type="password" className="h-8 w-28" value={pass} onChange={(e) => setPass(e.target.value)} /></F>
        <Button size="sm" onClick={connect}><Plug /> Connect</Button>
        {connected && <><Badge variant="success">connected</Badge><Button size="sm" variant="outline" onClick={refresh}><RefreshCw /> Refresh</Button></>}
      </div>

      {connected && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">Queues ({queues.length})</div>
            <div className="overflow-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-xs text-muted-foreground"><tr><th className="px-3 py-1.5">Name</th><th className="px-3 py-1.5">Msgs</th><th className="px-3 py-1.5">Consumers</th></tr></thead>
                <tbody className="divide-y divide-border font-mono text-xs">
                  {queues.map((q) => (<tr key={q.name}><td className="px-3 py-1.5">{q.name}</td><td className="px-3 py-1.5">{q.messages}</td><td className="px-3 py-1.5">{q.consumers}</td></tr>))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 rounded-md border border-border p-3">
              <div className="mb-1 text-xs font-medium text-muted-foreground">Publish (via default exchange)</div>
              <Input className="mb-2 h-8 font-mono text-xs" placeholder="routing key / queue name" value={pubQueue} onChange={(e) => setPubQueue(e.target.value)} />
              <textarea className="mb-2 h-20 w-full rounded-md border border-input bg-transparent p-2 font-mono text-xs" value={pubBody} onChange={(e) => setPubBody(e.target.value)} />
              <Button size="sm" onClick={publish}><Send /> Publish</Button>
            </div>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">Exchanges ({exchanges.length})</div>
            <div className="overflow-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-xs text-muted-foreground"><tr><th className="px-3 py-1.5">Name</th><th className="px-3 py-1.5">Type</th></tr></thead>
                <tbody className="divide-y divide-border font-mono text-xs">
                  {exchanges.map((x) => (<tr key={x.name}><td className="px-3 py-1.5">{x.name}</td><td className="px-3 py-1.5">{x.type}</td></tr>))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </ToolShell>
  );
}

function F({ label, children }: { label: string; children: ReactNode }) {
  return <label className="flex flex-col gap-1 text-sm"><span className="text-xs text-muted-foreground">{label}</span>{children}</label>;
}
