import { useState, type ReactNode } from "react";
import { Plug, Search, Trash2, Save } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { NativeNotice } from "@/components/NativeNotice";
import { invokeNative, isTauri } from "@/lib/platform";
import { toast } from "@/components/ui/toast";

export function RedisTool() {
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState("6379");
  const [password, setPassword] = useState("");
  const [connected, setConnected] = useState(false);
  const [pattern, setPattern] = useState("*");
  const [keys, setKeys] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ type: string; ttl: number; value: string } | null>(null);

  const exec = async (args: string[]) =>
    invokeNative<unknown>("redis_exec", { host, port: Number(port), password: password || null, args });

  const connect = async () => {
    if (!isTauri()) return toast.error("Desktop app only");
    try {
      await exec(["PING"]);
      setConnected(true);
      toast.success("Connected");
      loadKeys();
    } catch (e) {
      setConnected(false);
      toast.error((e as Error).message);
    }
  };

  const loadKeys = async () => {
    try {
      const res = (await exec(["KEYS", pattern])) as string[];
      setKeys(Array.isArray(res) ? res.slice(0, 500) : []);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const openKey = async (key: string) => {
    setSelected(key);
    try {
      const type = String(await exec(["TYPE", key]));
      const ttl = Number(await exec(["TTL", key]));
      let value = "";
      if (type === "string") value = String((await exec(["GET", key])) ?? "");
      else if (type === "list") value = JSON.stringify(await exec(["LRANGE", key, "0", "100"]), null, 2);
      else if (type === "hash") value = JSON.stringify(await exec(["HGETALL", key]), null, 2);
      else if (type === "set") value = JSON.stringify(await exec(["SMEMBERS", key]), null, 2);
      else value = `(type ${type} — preview not supported)`;
      setDetail({ type, ttl, value });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const saveString = async () => {
    if (!selected || !detail) return;
    try { await exec(["SET", selected, detail.value]); toast.success("Saved"); }
    catch (e) { toast.error((e as Error).message); }
  };
  const delKey = async () => {
    if (!selected) return;
    try { await exec(["DEL", selected]); toast.success("Deleted"); setSelected(null); setDetail(null); loadKeys(); }
    catch (e) { toast.error((e as Error).message); }
  };

  return (
    <ToolShell toolId="redis" title="Redis" description="Browse keys and inspect values on a Redis server." requiresNative>
      {!isTauri() && <NativeNotice what="The Redis client" />}
      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
        <Field label="Host"><Input className="h-8 w-40" value={host} onChange={(e) => setHost(e.target.value)} /></Field>
        <Field label="Port"><Input className="h-8 w-24" value={port} onChange={(e) => setPort(e.target.value)} /></Field>
        <Field label="Password"><Input type="password" className="h-8 w-40" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <Button size="sm" onClick={connect} disabled={!isTauri()}><Plug /> Connect</Button>
        {connected && <Badge variant="success">connected</Badge>}
      </div>

      {connected && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[280px_1fr]">
          <div className="flex flex-col gap-2">
            <div className="flex gap-1">
              <Input className="h-8 font-mono text-xs" value={pattern} onChange={(e) => setPattern(e.target.value)} onKeyDown={(e) => e.key === "Enter" && loadKeys()} />
              <Button size="icon" variant="outline" className="h-8 w-8" onClick={loadKeys}><Search className="size-4" /></Button>
            </div>
            <div className="h-[calc(100vh-420px)] overflow-auto rounded-md border border-border">
              {keys.map((k) => (
                <button key={k} onClick={() => openKey(k)} className={`block w-full truncate px-2 py-1 text-left font-mono text-xs ${selected === k ? "bg-primary/15 text-primary" : "hover:bg-secondary"}`}>{k}</button>
              ))}
              {keys.length === 0 && <p className="p-2 text-xs text-muted-foreground">No keys.</p>}
            </div>
          </div>

          <div>
            {selected && detail ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm">{selected}</span>
                  <Badge variant="secondary">{detail.type}</Badge>
                  <Badge variant="outline">TTL {detail.ttl < 0 ? "∞" : `${detail.ttl}s`}</Badge>
                  <div className="ml-auto flex gap-1">
                    {detail.type === "string" && <Button size="sm" variant="outline" onClick={saveString}><Save /> Save</Button>}
                    <Button size="sm" variant="ghost" onClick={delKey}><Trash2 /> Delete</Button>
                  </div>
                </div>
                <Textarea mono className="h-[calc(100vh-440px)]" value={detail.value} readOnly={detail.type !== "string"} onChange={(e) => setDetail({ ...detail, value: e.target.value })} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Select a key to inspect its value.</p>
            )}
          </div>
        </div>
      )}
    </ToolShell>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
