import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Plug, RefreshCw, Send, AlertTriangle, Activity, Inbox, Shuffle, Server } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/CopyButton";
import { AddToDebug } from "@/components/AddToDebug";
import { executeRequest, corsLimited } from "@/lib/http";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  brokerFindings,
  deadLetterExchange,
  formatBytes,
  limitUsage,
  mgmtPortAdvice,
  mgmtUrl,
  routingKeyProblem,
  sortQueuesByAttention,
  withMgmtPort,
  type Exchange,
  type Node,
  type Overview,
  type Queue,
  type Severity,
} from "@/tools/lib/rabbitMonitor";
import { brokerUnreachableEvent, rabbitBrokerEvent, rabbitPublishEvent } from "@/tools/lib/mqCapture";

type Tab = "overview" | "queues" | "exchanges" | "nodes" | "publish";

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: "overview", label: "Overview", icon: <Activity className="size-3.5" /> },
  { id: "queues", label: "Queues", icon: <Inbox className="size-3.5" /> },
  { id: "exchanges", label: "Exchanges", icon: <Shuffle className="size-3.5" /> },
  { id: "nodes", label: "Nodes", icon: <Server className="size-3.5" /> },
  { id: "publish", label: "Publish", icon: <Send className="size-3.5" /> },
];

const SEVERITY_CLASS: Record<Severity, string> = {
  ok: "text-success",
  warn: "text-warning",
  bad: "text-destructive",
  unknown: "text-muted-foreground",
};

export function RabbitMqTool() {
  const [server, setServer] = useState("localhost:15672");
  const [user, setUser] = useState("guest");
  const [pass, setPass] = useState("guest");
  const [vhost, setVhost] = useState("/");

  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  const [overview, setOverview] = useState<Overview | null>(null);
  const [queues, setQueues] = useState<Queue[]>([]);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [nodes, setNodes] = useState<Node[]>([]);

  const [pubExchange, setPubExchange] = useState("");
  const [pubKey, setPubKey] = useState("");
  const [pubBody, setPubBody] = useState('{"hello":"world"}');
  const [pubResult, setPubResult] = useState<{ routed: boolean; text: string } | null>(null);

  const auth = () => `Basic ${btoa(`${user}:${pass}`)}`;

  /**
   * Fetch a management endpoint.
   *
   * Routed through the HTTP layer rather than `window.fetch` for the same reason
   * the NATS tool is: the webview's CSP blocks a cross-origin request before it
   * leaves, and the management API sends no CORS headers either.
   */
  const get = useCallback(
    async (path: string): Promise<unknown> => {
      const res = await executeRequest(
        { method: "GET", url: mgmtUrl(server, path), headers: { Authorization: auth() } },
        undefined,
        { timeoutMs: 8000 },
      );
      if (res.status === 401) throw new Error("401 Unauthorized — check the user and password.");
      if (!res.ok) throw new Error(`${path} returned ${res.status} ${res.statusText}`);
      try {
        return JSON.parse(res.body);
      } catch {
        throw new Error(`${path} did not return JSON. ${res.body.slice(0, 120)}`);
      }
    },
    // `auth` closes over user/pass, so both belong in the dependency list.
    [server, user, pass],
  );

  const refresh = async () => {
    setBusy(true);
    setError("");
    try {
      // Overview first: if the address or credentials are wrong, fail on one request.
      const ov = (await get("/overview")) as Overview;
      setOverview(ov);
      // The rest are best-effort — a restricted user can be denied /nodes while
      // still being able to see its own vhost's queues.
      const [q, ex, n] = await Promise.all([
        get("/queues").catch(() => []),
        get("/exchanges").catch(() => []),
        get("/nodes").catch(() => []),
      ]);
      setQueues(Array.isArray(q) ? (q as Queue[]) : []);
      setExchanges(Array.isArray(ex) ? (ex as Exchange[]) : []);
      setNodes(Array.isArray(n) ? (n as Node[]) : []);
      setLoaded(true);
    } catch (e) {
      const reason = e instanceof Error && e.message ? e.message : String(e);
      // An auth failure means the address was right, so the port advice would mislead.
      setError(reason.startsWith("401") ? reason : `${reason}${mgmtPortAdvice(server)}`);
      setLoaded(false);
    } finally {
      setBusy(false);
    }
  };

  const findings = useMemo(() => brokerFindings(overview, queues, nodes), [overview, queues, nodes]);
  const sortedQueues = useMemo(() => sortQueuesByAttention(queues), [queues]);
  const totals = useMemo(
    () => ({
      messages: queues.reduce((n, q) => n + (q.messages ?? 0), 0),
      unacked: queues.reduce((n, q) => n + (q.messages_unacknowledged ?? 0), 0),
      consumers: queues.reduce((n, q) => n + (q.consumers ?? 0), 0),
    }),
    [queues],
  );

  const exchangeType = exchanges.find((x) => (x.name ?? "") === pubExchange)?.type ?? "direct";
  const keyProblem = routingKeyProblem(pubKey, pubExchange === "" ? "direct" : exchangeType);

  const publish = async () => {
    if (keyProblem) return toast.error(keyProblem);
    setBusy(true);
    try {
      // An empty exchange name is the default exchange, which routes by exact queue name.
      const target = pubExchange === "" ? "amq.default" : pubExchange;
      const res = await executeRequest({
        method: "POST",
        url: mgmtUrl(server, `/exchanges/${encodeURIComponent(vhost)}/${encodeURIComponent(target)}/publish`),
        headers: { Authorization: auth(), "Content-Type": "application/json" },
        body: JSON.stringify({
          properties: {},
          routing_key: pubKey.trim(),
          payload: pubBody,
          payload_encoding: "string",
        }),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      // `routed: false` is the failure that looks like a success: the broker
      // accepted the message and then discarded it for want of a binding.
      const routed = (JSON.parse(res.body) as { routed?: boolean }).routed === true;
      setPubResult({ routed, text: res.body });
      if (routed) toast.success("Published and routed");
      else toast.error("Published, but no binding matched — the message was discarded");
      refresh();
    } catch (e) {
      const reason = e instanceof Error && e.message ? e.message : String(e);
      setPubResult({ routed: false, text: reason });
      toast.error(reason);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolShell
      toolId="rabbitmq"
      title="RabbitMQ"
      description="Queues, exchanges, node headroom and publishing, over the management API (port 15672)."
    >
      {corsLimited() && (
        <div className="mb-3 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
          Browser dev mode: the management API may be blocked by CORS. Use the desktop app.
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
        <F label="Management address">
          <Input
            className="h-8 w-56"
            value={server}
            onChange={(e) => setServer(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && refresh()}
            placeholder="localhost:15672"
          />
        </F>
        <F label="User"><Input className="h-8 w-28" value={user} onChange={(e) => setUser(e.target.value)} /></F>
        <F label="Password">
          <Input type="password" className="h-8 w-28" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="session only" />
        </F>
        <F label="Vhost"><Input className="h-8 w-20" value={vhost} onChange={(e) => setVhost(e.target.value)} /></F>
        <Button size="sm" onClick={refresh} disabled={busy}>
          {busy ? <RefreshCw className="size-3.5 animate-spin" /> : <Plug className="size-3.5" />} Connect
        </Button>
        {loaded && overview && (
          <>
            <Badge variant="success">{overview.cluster_name || "connected"}</Badge>
            {overview.rabbitmq_version && <Badge variant="outline">v{overview.rabbitmq_version}</Badge>}
            {overview.erlang_version && <Badge variant="outline">Erlang {overview.erlang_version}</Badge>}
          </>
        )}
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
          <p>{error}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {withMgmtPort(server) !== server.trim() && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setServer(withMgmtPort(server)); setError(""); }}
              >
                Use {withMgmtPort(server)} instead
              </Button>
            )}
            <AddToDebug
              variant="outline"
              label="Add to Debug"
              makeEvent={() => brokerUnreachableEvent("rabbitmq", server.trim() || "rabbitmq", error)}
            />
          </div>
        </div>
      )}

      {loaded && (
        <>
          <div className="mb-3 flex flex-wrap gap-1 border-b border-border">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-sm",
                  tab === t.id ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.icon} {t.label}
              </button>
            ))}
            <AddToDebug
              className="ml-auto"
              variant="ghost"
              label="Debug"
              makeEvent={() =>
                rabbitBrokerEvent({
                  target: server.trim(),
                  version: overview?.rabbitmq_version,
                  cluster: overview?.cluster_name,
                  queues: queues.length,
                  messages: totals.messages,
                  unacked: totals.unacked,
                  consumers: totals.consumers,
                  findings,
                })
              }
            />
            <Button size="sm" variant="ghost" onClick={refresh}>
              <RefreshCw className={cn("size-3.5", busy && "animate-spin")} /> Refresh
            </Button>
          </div>

          {findings.length > 0 && (
            <div className="mb-3 flex flex-col gap-1 rounded-md border border-warning/40 bg-warning/5 p-2">
              {findings.map((f, i) => (
                <p key={i} className="text-[11px]">
                  <AlertTriangle className={cn("mr-1 inline size-3", SEVERITY_CLASS[f.severity])} />
                  <b>{f.subject}:</b> {f.message}
                </p>
              ))}
            </div>
          )}

          {tab === "overview" && (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-5">
              <Tile label="Queues" value={String(overview?.object_totals?.queues ?? queues.length)} />
              <Tile label="Exchanges" value={String(overview?.object_totals?.exchanges ?? exchanges.length)} />
              <Tile label="Connections" value={String(overview?.object_totals?.connections ?? 0)} />
              <Tile label="Channels" value={String(overview?.object_totals?.channels ?? 0)} />
              <Tile label="Consumers" value={String(overview?.object_totals?.consumers ?? totals.consumers)} />
              <Tile label="Messages" value={(overview?.queue_totals?.messages ?? totals.messages).toLocaleString()} />
              <Tile label="Ready" value={(overview?.queue_totals?.messages_ready ?? 0).toLocaleString()} />
              <Tile
                label="Unacknowledged"
                value={(overview?.queue_totals?.messages_unacknowledged ?? totals.unacked).toLocaleString()}
                tone={(overview?.queue_totals?.messages_unacknowledged ?? totals.unacked) > 0 ? "warn" : "ok"}
              />
              <Tile label="Publish rate" value={`${(overview?.message_stats?.publish_details?.rate ?? 0).toFixed(1)}/s`} />
              <Tile label="Deliver rate" value={`${(overview?.message_stats?.deliver_get_details?.rate ?? 0).toFixed(1)}/s`} />
              <Tile
                label="Unroutable"
                value={`${(overview?.message_stats?.return_unroutable_details?.rate ?? 0).toFixed(1)}/s`}
                tone={(overview?.message_stats?.return_unroutable_details?.rate ?? 0) > 0 ? "bad" : "ok"}
              />
            </div>
          )}

          {tab === "queues" && (
            <div className="flex flex-col gap-2">
              <p className="text-[11px] text-muted-foreground">
                Ordered by what needs attention: a queue with a backlog and no consumer first, then by depth. Unacked
                messages have been delivered and not acknowledged — they are not lost, but no other consumer can have them
                until the channel that holds them acks or dies.
              </p>
              {sortedQueues.length === 0 ? (
                <p className="text-sm text-muted-foreground">No queues exist.</p>
              ) : (
                <Table
                  columns={["Queue", "Vhost", "State", "Total", "Ready", "Unacked", "Consumers", "Memory", "DLX", "Durable", "Node"]}
                  rows={sortedQueues.map((q) => [
                    q.name ?? "—",
                    q.vhost ?? "/",
                    q.state ?? "—",
                    (q.messages ?? 0).toLocaleString(),
                    (q.messages_ready ?? 0).toLocaleString(),
                    (q.messages_unacknowledged ?? 0).toLocaleString(),
                    String(q.consumers ?? 0),
                    formatBytes(q.memory),
                    deadLetterExchange(q) ?? "none",
                    q.durable ? "yes" : "no",
                    q.node ?? "—",
                  ])}
                />
              )}
            </div>
          )}

          {tab === "exchanges" && (
            <div className="flex flex-col gap-2">
              <p className="text-[11px] text-muted-foreground">
                The unnamed exchange (shown as <span className="mono">(default)</span>) routes by exact queue name. A
                message published to any exchange that matches no binding is discarded, and the publisher is not told
                unless it set the mandatory flag.
              </p>
              <Table
                columns={["Exchange", "Vhost", "Type", "Durable", "Auto-delete", "Internal"]}
                rows={exchanges.map((x) => [
                  x.name || "(default)",
                  x.vhost ?? "/",
                  x.type ?? "—",
                  x.durable ? "yes" : "no",
                  x.auto_delete ? "yes" : "no",
                  x.internal ? "yes" : "no",
                ])}
              />
            </div>
          )}

          {tab === "nodes" && (
            <div className="flex flex-col gap-2">
              {nodes.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No node detail — this usually means the user lacks the monitoring tag.
                </p>
              ) : (
                <Table
                  columns={["Node", "Running", "Memory", "Mem %", "Alarm", "Disk free", "Disk alarm", "FDs", "Sockets", "Uptime"]}
                  rows={nodes.map((n) => [
                    n.name ?? "—",
                    n.running === false ? "no" : "yes",
                    `${formatBytes(n.mem_used)}${n.mem_limit ? ` / ${formatBytes(n.mem_limit)}` : ""}`,
                    limitUsage(n.mem_used, n.mem_limit)?.toFixed(0).concat("%") ?? "—",
                    n.mem_alarm ? "MEMORY" : "—",
                    `${formatBytes(n.disk_free)}${n.disk_free_limit ? ` / ${formatBytes(n.disk_free_limit)} limit` : ""}`,
                    n.disk_free_alarm ? "DISK" : "—",
                    n.fd_total ? `${n.fd_used ?? 0} / ${n.fd_total}` : "—",
                    n.sockets_total ? `${n.sockets_used ?? 0} / ${n.sockets_total}` : "—",
                    n.uptime ? `${Math.floor(n.uptime / 3600000)}h` : "—",
                  ])}
                />
              )}
            </div>
          )}

          {tab === "publish" && (
            <div className="flex max-w-2xl flex-col gap-2">
              <F label="Exchange">
                <select
                  value={pubExchange}
                  onChange={(e) => setPubExchange(e.target.value)}
                  className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
                >
                  <option value="">(default) — routes by exact queue name</option>
                  {exchanges
                    .filter((x) => x.name)
                    .map((x) => (
                      <option key={`${x.vhost}/${x.name}`} value={x.name}>
                        {x.name} ({x.type})
                      </option>
                    ))}
                </select>
              </F>
              <F label="Routing key">
                <Input
                  className="h-8 font-mono text-xs"
                  value={pubKey}
                  onChange={(e) => setPubKey(e.target.value)}
                  placeholder={pubExchange === "" ? "queue name" : "orders.created"}
                />
              </F>
              {pubKey && keyProblem && <p className="text-[11px] text-warning">{keyProblem}</p>}
              <F label="Payload">
                <textarea
                  className="mono h-32 w-full rounded-md border border-input bg-transparent p-2 text-xs"
                  value={pubBody}
                  onChange={(e) => setPubBody(e.target.value)}
                />
              </F>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={publish} disabled={busy || !!keyProblem}>
                  <Send className="size-3.5" /> Publish
                </Button>
                {pubResult && (
                  <>
                    <Badge variant={pubResult.routed ? "success" : "destructive"}>
                      {pubResult.routed ? "routed" : "not routed"}
                    </Badge>
                    <AddToDebug
                      variant="ghost"
                      label="Debug"
                      makeEvent={() =>
                        rabbitPublishEvent(
                          server.trim(),
                          pubKey.trim(),
                          pubResult.routed,
                          pubResult.routed ? pubBody : `${pubResult.text} — no binding matched, the message was discarded`,
                        )
                      }
                    />
                    <CopyButton value={pubResult.text} label="Response" />
                  </>
                )}
              </div>
              {pubResult && !pubResult.routed && (
                <p className="text-[11px] text-muted-foreground">
                  The broker accepted the publish and then dropped it: nothing is bound to that exchange for that routing
                  key. Publishing to the default exchange requires the routing key to be an existing queue's exact name.
                </p>
              )}
            </div>
          )}
        </>
      )}

      {!loaded && !error && (
        <p className="text-sm text-muted-foreground">
          Enter the management address and connect. This is the HTTP management port (15672 by default, provided by the
          <span className="mono"> rabbitmq_management</span> plugin), not the AMQP client port 5672.
        </p>
      )}
    </ToolShell>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "bad" }) {
  return (
    <div className="rounded-md border border-border p-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div
        className={cn(
          "truncate text-sm font-medium",
          tone === "bad" && "text-destructive",
          tone === "warn" && "text-warning",
          tone === "ok" && "text-success",
        )}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

function Table({ columns, rows }: { columns: string[]; rows: string[][] }) {
  return (
    <div className="max-h-[60vh] overflow-auto rounded-md border border-border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 border-b border-border bg-card text-left text-muted-foreground">
          <tr>{columns.map((c) => <th key={c} className="whitespace-nowrap px-2 py-1 font-medium">{c}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-secondary/40">
              {row.map((cell, j) => (
                <td key={j} className="mono max-w-[320px] truncate px-2 py-1" title={cell}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function F({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
