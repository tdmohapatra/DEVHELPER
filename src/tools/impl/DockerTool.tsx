import { useEffect, useState } from "react";
import { RefreshCw, Play, Square, RotateCw, FileText } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { NativeNotice } from "@/components/NativeNotice";
import { invokeNative, isTauri } from "@/lib/platform";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

interface Container { id: string; name: string; image: string; status: string; ports: string; }
interface Image { repository: string; tag: string; id: string; size: string; }

export function DockerTool() {
  const [tab, setTab] = useState<"containers" | "images">("containers");
  const [containers, setContainers] = useState<Container[]>([]);
  const [images, setImages] = useState<Image[]>([]);
  const [logs, setLogs] = useState<{ name: string; text: string } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    if (!isTauri()) return;
    setLoading(true);
    setError("");
    try {
      setContainers(await invokeNative<Container[]>("docker_ps"));
      setImages(await invokeNative<Image[]>("docker_images"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const action = async (act: string, id: string, name: string) => {
    try {
      await invokeNative("docker_action", { action: act, id });
      toast.success(`${act} ${name}`);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const showLogs = async (id: string, name: string) => {
    try {
      const text = await invokeNative<string>("docker_logs", { id, tail: 200 });
      setLogs({ name, text });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const running = (s: string) => s.toLowerCase().startsWith("up");

  return (
    <ToolShell toolId="docker" title="Docker" description="View and control local Docker containers and images." requiresNative
      actions={<Button size="sm" variant="outline" onClick={refresh} disabled={!isTauri() || loading}><RefreshCw className={cn(loading && "animate-spin")} /> Refresh</Button>}>
      {!isTauri() && <NativeNotice what="Docker control" />}
      {error && <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{error}</div>}

      <div className="mb-3 flex gap-1 border-b border-border">
        {(["containers", "images"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={tab === t ? "border-b-2 border-primary px-3 py-1.5 text-sm capitalize" : "px-3 py-1.5 text-sm capitalize text-muted-foreground"}>{t}</button>
        ))}
      </div>

      {tab === "containers" ? (
        <div className="overflow-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-muted-foreground">
              <tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Image</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Ports</th><th className="px-3 py-2">Actions</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {containers.map((c) => (
                <tr key={c.id}>
                  <td className="px-3 py-1.5 font-medium">{c.name}</td>
                  <td className="px-3 py-1.5 font-mono text-xs">{c.image}</td>
                  <td className="px-3 py-1.5"><Badge variant={running(c.status) ? "success" : "secondary"}>{c.status}</Badge></td>
                  <td className="px-3 py-1.5 font-mono text-xs">{c.ports}</td>
                  <td className="px-3 py-1.5">
                    <div className="flex gap-1">
                      {running(c.status)
                        ? <Button size="icon" variant="ghost" className="h-7 w-7" title="Stop" onClick={() => action("stop", c.id, c.name)}><Square className="size-3.5" /></Button>
                        : <Button size="icon" variant="ghost" className="h-7 w-7" title="Start" onClick={() => action("start", c.id, c.name)}><Play className="size-3.5" /></Button>}
                      <Button size="icon" variant="ghost" className="h-7 w-7" title="Restart" onClick={() => action("restart", c.id, c.name)}><RotateCw className="size-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" title="Logs" onClick={() => showLogs(c.id, c.name)}><FileText className="size-3.5" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
              {containers.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">{isTauri() ? "No containers." : "—"}</td></tr>}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-muted-foreground">
              <tr><th className="px-3 py-2">Repository</th><th className="px-3 py-2">Tag</th><th className="px-3 py-2">ID</th><th className="px-3 py-2">Size</th></tr>
            </thead>
            <tbody className="divide-y divide-border font-mono text-xs">
              {images.map((im, i) => (
                <tr key={i}><td className="px-3 py-1.5">{im.repository}</td><td className="px-3 py-1.5">{im.tag}</td><td className="px-3 py-1.5">{im.id}</td><td className="px-3 py-1.5">{im.size}</td></tr>
              ))}
              {images.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">{isTauri() ? "No images." : "—"}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {logs && (
        <div className="mt-4">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-sm font-medium">Logs — {logs.name}</span>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setLogs(null)}>Close</Button>
          </div>
          <Textarea mono readOnly className="h-64 bg-muted/30" value={logs.text} />
        </div>
      )}
    </ToolShell>
  );
}
