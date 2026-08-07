import { useCallback, useState, type ReactNode } from "react";
import { Plug, Search, Trash2, Save, RefreshCw, Terminal, AlertTriangle, Activity, Users, Radio, Clock, KeyRound } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { CopyButton } from "@/components/CopyButton";
import { AddToDebug } from "@/components/AddToDebug";
import { NativeNotice } from "@/components/NativeNotice";
import { invokeNative, isTauri } from "@/lib/platform";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  parseInfo,
  healthMetrics,
  parseKeyspace,
  totalKeys,
  orderedSections,
  parseCommandStats,
  formatUptime,
  infoValue,
  type InfoSections,
  type Severity,
} from "@/tools/lib/redisInfo";
import {
  parseClientList,
  describeClientFlags,
  clientConcerns,
  parseSlowlog,
  parsePubSubNumSub,
  asStringList,
  type RedisClient,
  type SlowlogEntry,
  type PubSubChannel,
} from "@/tools/lib/redisClients";
import { brokerUnreachableEvent, redisCommandEvent, redisHealthEvent } from "@/tools/lib/mqCapture";

type Tab = "keys" | "health" | "clients" | "pubsub" | "slowlog" | "console";

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: "keys", label: "Keys", icon: <KeyRound className="size-3.5" /> },
  { id: "health", label: "Health", icon: <Activity className="size-3.5" /> },
  { id: "clients", label: "Clients", icon: <Users className="size-3.5" /> },
  { id: "pubsub", label: "Pub/Sub", icon: <Radio className="size-3.5" /> },
  { id: "slowlog", label: "Slow log", icon: <Clock className="size-3.5" /> },
  { id: "console", label: "Console", icon: <Terminal className="size-3.5" /> },
];

/** Commands that can take a server down or wipe it. Typed in the console, they get a confirm. */
const DANGEROUS = /^(FLUSHALL|FLUSHDB|SHUTDOWN|DEBUG|CONFIG\s+SET|SCRIPT\s+FLUSH|CLUSTER\s+RESET|REPLICAOF|SLAVEOF|MIGRATE|SWAPDB)\b/i;

const SEVERITY_CLASS: Record<Severity, string> = {
  ok: "text-success",
  warn: "text-warning",
  bad: "text-destructive",
  unknown: "text-muted-foreground",
};

export function RedisTool() {
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState("6379");
  const [password, setPassword] = useState("");
  const [db, setDb] = useState("0");
  const [connected, setConnected] = useState(false);
  const [version, setVersion] = useState("");
  const [tab, setTab] = useState<Tab>("health");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Keys
  const [pattern, setPattern] = useState("*");
  const [keys, setKeys] = useState<string[]>([]);
  const [scanTruncated, setScanTruncated] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ type: string; ttl: number; value: string; bytes?: number } | null>(null);

  // Diagnostics
  const [info, setInfo] = useState<InfoSections | null>(null);
  const [clients, setClients] = useState<RedisClient[] | null>(null);
  const [channels, setChannels] = useState<PubSubChannel[] | null>(null);
  const [numPat, setNumPat] = useState<number | null>(null);
  const [slowlog, setSlowlog] = useState<SlowlogEntry[] | null>(null);

  // Console
  const [command, setCommand] = useState("");
  const [output, setOutput] = useState<{ cmd: string; text: string; ok: boolean }[]>([]);

  /**
   * One command per call, on its own connection.
   *
   * The native side applies SELECT for the chosen database before running the
   * command, so key operations address the right one. Connection-scoped state
   * beyond that — MULTI, WATCH, SUBSCRIBE — cannot span two calls.
   */
  const exec = useCallback(
    async (args: string[]): Promise<unknown> =>
      invokeNative<unknown>("redis_exec", {
        host,
        port: Number(port) || 6379,
        password: password || null,
        db: Number(db) || 0,
        args,
      }),
    [host, port, password, db],
  );

  /** Alias kept for the keyspace calls, which are the ones the database index matters for. */
  const execDb = exec;

  const run = async <T,>(work: () => Promise<T>): Promise<T | null> => {
    setBusy(true);
    setError("");
    try {
      return await work();
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    if (!isTauri()) return toast.error("Desktop app only");
    const ok = await run(async () => {
      await exec(["PING"]);
      const text = String(await exec(["INFO", "ALL"]));
      const parsed = parseInfo(text);
      setInfo(parsed);
      setVersion(infoValue(parsed, "redis_version") ?? "");
      return true;
    });
    setConnected(!!ok);
    if (ok) toast.success("Connected");
  };

  const loadInfo = () =>
    run(async () => {
      const parsed = parseInfo(String(await exec(["INFO", "ALL"])));
      setInfo(parsed);
      setVersion(infoValue(parsed, "redis_version") ?? "");
    });

  /**
   * List keys with SCAN rather than KEYS.
   *
   * KEYS walks the whole keyspace in one blocking pass — on a production server
   * with millions of keys that is a stall every client feels. SCAN returns a
   * cursor and is safe to run against a live server; the trade is that results
   * arrive in batches and the count per batch is only a hint.
   */
  const loadKeys = () =>
    run(async () => {
      const found: string[] = [];
      let cursor = "0";
      let rounds = 0;
      do {
        const reply = (await exec(["SCAN", cursor, "MATCH", pattern, "COUNT", "500"])) as unknown[];
        if (!Array.isArray(reply) || reply.length < 2) break;
        cursor = String(reply[0]);
        found.push(...asStringList(reply[1]));
        rounds++;
        // Bounded so a `*` on a huge keyspace cannot spin forever.
      } while (cursor !== "0" && found.length < 1000 && rounds < 20);
      setScanTruncated(cursor !== "0");
      setKeys(found.slice(0, 1000));
    });

  const openKey = (key: string) =>
    run(async () => {
      setSelected(key);
      const type = String(await execDb(["TYPE", key]));
      const ttl = Number(await execDb(["TTL", key]));
      let bytes: number | undefined;
      try {
        // MEMORY USAGE is Redis 4+; a server without it just does not show a size.
        bytes = Number(await execDb(["MEMORY", "USAGE", key])) || undefined;
      } catch {
        bytes = undefined;
      }
      let value = "";
      if (type === "string") value = String((await execDb(["GET", key])) ?? "");
      else if (type === "list") value = JSON.stringify(await execDb(["LRANGE", key, "0", "200"]), null, 2);
      else if (type === "hash") value = JSON.stringify(await execDb(["HGETALL", key]), null, 2);
      else if (type === "set") value = JSON.stringify(await execDb(["SMEMBERS", key]), null, 2);
      else if (type === "zset") value = JSON.stringify(await execDb(["ZRANGE", key, "0", "200", "WITHSCORES"]), null, 2);
      else if (type === "stream") value = JSON.stringify(await execDb(["XRANGE", key, "-", "+", "COUNT", "50"]), null, 2);
      else value = `(type ${type} — no preview)`;
      setDetail({ type, ttl, value, bytes });
    });

  const loadClients = () =>
    run(async () => setClients(parseClientList(String(await exec(["CLIENT", "LIST"])))));

  const loadPubSub = () =>
    run(async () => {
      const names = asStringList(await exec(["PUBSUB", "CHANNELS"]));
      setNumPat(Number(await exec(["PUBSUB", "NUMPAT"])) || 0);
      setChannels(names.length === 0 ? [] : parsePubSubNumSub(await exec(["PUBSUB", "NUMSUB", ...names])));
    });

  const loadSlowlog = () =>
    run(async () => setSlowlog(parseSlowlog(await exec(["SLOWLOG", "GET", "64"]))));

  const openTab = (next: Tab) => {
    setTab(next);
    if (!connected) return;
    if (next === "health" && !info) loadInfo();
    if (next === "clients" && !clients) loadClients();
    if (next === "pubsub" && !channels) loadPubSub();
    if (next === "slowlog" && !slowlog) loadSlowlog();
    if (next === "keys" && keys.length === 0) loadKeys();
  };

  const saveString = () =>
    detail && selected && run(async () => { await execDb(["SET", selected, detail.value]); toast.success("Saved"); });

  const delKey = () =>
    selected &&
    run(async () => {
      if (!confirm(`Delete ${selected}? This cannot be undone.`)) return;
      await execDb(["DEL", selected]);
      toast.success("Deleted");
      setSelected(null);
      setDetail(null);
      loadKeys();
    });

  const runConsole = async () => {
    const text = command.trim();
    if (!text) return;
    if (DANGEROUS.test(text) && !confirm(`"${text.split(/\s+/)[0].toUpperCase()}" can destroy data or stop the server. Run it anyway?`)) {
      return;
    }
    // Split on whitespace outside quotes, so a value with spaces survives.
    const args = text.match(/"[^"]*"|'[^']*'|\S+/g)?.map((a) => a.replace(/^["']|["']$/g, "")) ?? [];
    try {
      const reply = await exec(args);
      setOutput((cur) => [{ cmd: text, text: typeof reply === "string" ? reply : JSON.stringify(reply, null, 2), ok: true }, ...cur].slice(0, 50));
    } catch (e) {
      setOutput((cur) => [{ cmd: text, text: (e as Error).message, ok: false }, ...cur].slice(0, 50));
    }
    setCommand("");
  };

  const metrics = info ? healthMetrics(info) : [];
  const dbs = info ? parseKeyspace(info) : [];
  /** How this server is named on a Debug Session timeline. */
  const target = `redis://${host}:${port}/${db}`;

  return (
    <ToolShell
      toolId="redis"
      title="Redis"
      description="Inspect memory, clients, pub/sub and slow commands, and browse keys."
      requiresNative
    >
      {!isTauri() && <NativeNotice what="The Redis client" />}

      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
        <Field label="Host"><Input className="h-8 w-40" value={host} onChange={(e) => setHost(e.target.value)} /></Field>
        <Field label="Port"><Input className="h-8 w-20" value={port} onChange={(e) => setPort(e.target.value)} /></Field>
        <Field label="DB"><Input className="h-8 w-14" value={db} onChange={(e) => setDb(e.target.value)} /></Field>
        <Field label="Password">
          <Input type="password" className="h-8 w-40" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="session only" />
        </Field>
        <Button size="sm" onClick={connect} disabled={!isTauri() || busy}>
          {busy ? <RefreshCw className="size-3.5 animate-spin" /> : <Plug className="size-3.5" />} Connect
        </Button>
        {connected && (
          <>
            <Badge variant="success">connected</Badge>
            {version && <Badge variant="outline">v{version}</Badge>}
            <Badge variant="outline">up {formatUptime(Number(infoValue(info ?? {}, "uptime_in_seconds")))}</Badge>
          </>
        )}
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
          <p>{error}</p>
          <AddToDebug
            className="mt-2"
            variant="outline"
            label="Add to Debug"
            makeEvent={() => brokerUnreachableEvent("redis", target, error)}
          />
        </div>
      )}

      {connected && (
        <>
          <div className="mb-3 flex flex-wrap gap-1 border-b border-border">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => openTab(t.id)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-sm",
                  tab === t.id ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>

          {tab === "health" && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={loadInfo}>
                  <RefreshCw className={cn("size-3.5", busy && "animate-spin")} /> Refresh
                </Button>
                {dbs.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {totalKeys(dbs).toLocaleString()} keys across {dbs.length} database{dbs.length === 1 ? "" : "s"}
                  </span>
                )}
                {info && (
                  <AddToDebug
                    className="ml-auto"
                    variant="ghost"
                    label="Debug"
                    makeEvent={() =>
                      redisHealthEvent({
                        target,
                        version,
                        metrics,
                        keys: dbs.length ? totalKeys(dbs) : undefined,
                        clients: clients?.length,
                      })
                    }
                  />
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">
                {metrics.map((m) => (
                  <div key={m.id} className="rounded-md border border-border p-2" title={m.detail}>
                    <div className="text-[11px] text-muted-foreground">{m.label}</div>
                    <div className={cn("text-sm font-medium", SEVERITY_CLASS[m.severity])}>{m.value}</div>
                  </div>
                ))}
              </div>

              {metrics.filter((m) => m.severity === "warn" || m.severity === "bad").length > 0 && (
                <div className="flex flex-col gap-1 rounded-md border border-warning/40 bg-warning/5 p-2">
                  {metrics
                    .filter((m) => m.severity === "warn" || m.severity === "bad")
                    .map((m) => (
                      <p key={m.id} className="text-[11px]">
                        <AlertTriangle className={cn("mr-1 inline size-3", SEVERITY_CLASS[m.severity])} />
                        <b>{m.label}:</b> {m.detail}
                      </p>
                    ))}
                </div>
              )}

              {dbs.length > 0 && (
                <Table
                  columns={["Database", "Keys", "With TTL", "Avg TTL"]}
                  rows={dbs.map((d) => [d.db, d.keys.toLocaleString(), d.expires.toLocaleString(), d.avgTtlMs ? `${d.avgTtlMs} ms` : "—"])}
                />
              )}

              {info && parseCommandStats(info).length > 0 && (
                <section>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Commands by total time
                  </h3>
                  <Table
                    columns={["Command", "Calls", "Total µs", "µs/call", "Rejected", "Failed"]}
                    rows={parseCommandStats(info)
                      .slice(0, 20)
                      .map((c) => [
                        c.command,
                        c.calls.toLocaleString(),
                        c.usec.toLocaleString(),
                        c.usecPerCall.toFixed(1),
                        String(c.rejected),
                        String(c.failed),
                      ])}
                  />
                </section>
              )}

              {info && (
                <details className="rounded-md border border-border p-2">
                  <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Full INFO</summary>
                  <div className="mt-2 flex flex-col gap-3">
                    {orderedSections(info).map((name) => (
                      <div key={name}>
                        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{name}</div>
                        <Table columns={["Field", "Value"]} rows={Object.entries(info[name]).map(([k, v]) => [k, v])} dense />
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}

          {tab === "clients" && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={loadClients}>
                  <RefreshCw className={cn("size-3.5", busy && "animate-spin")} /> Refresh
                </Button>
                {clients && <span className="text-xs text-muted-foreground">{clients.length} connection(s)</span>}
              </div>

              {clients && clientConcerns(clients).length > 0 && (
                <div className="flex flex-col gap-1 rounded-md border border-warning/40 bg-warning/5 p-2">
                  {clientConcerns(clients).map(({ client, reason }) => (
                    <p key={client.id} className="text-[11px]">
                      <AlertTriangle className="mr-1 inline size-3 text-warning" />
                      <span className="mono">{client.addr}</span>
                      {client.name ? ` (${client.name})` : ""} — {reason}
                    </p>
                  ))}
                </div>
              )}

              {clients && (
                <Table
                  columns={["ID", "Address", "Name", "User", "DB", "Age", "Idle", "Sub", "PSub", "Output buf", "Total mem", "Last cmd", "Flags"]}
                  rows={clients.map((c) => [
                    c.id,
                    c.addr,
                    c.name || "—",
                    c.user ?? "—",
                    c.db,
                    `${c.age}s`,
                    `${c.idle}s`,
                    String(c.sub),
                    String(c.psub),
                    c.omem ? `${Math.round(c.omem / 1024)} KB` : "0",
                    c.totMem ? `${Math.round(c.totMem / 1024)} KB` : "0",
                    c.lastCmd || "—",
                    describeClientFlags(c.flags).join(", ") || c.flags,
                  ])}
                />
              )}
            </div>
          )}

          {tab === "pubsub" && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={loadPubSub}>
                  <RefreshCw className={cn("size-3.5", busy && "animate-spin")} /> Refresh
                </Button>
                {channels && <span className="text-xs text-muted-foreground">{channels.length} active channel(s)</span>}
                {numPat !== null && <span className="text-xs text-muted-foreground">· {numPat} pattern subscription(s)</span>}
              </div>
              <p className="text-[11px] text-muted-foreground">
                PUBSUB only reports channels that have at least one subscriber right now. A channel nobody is listening
                on does not exist as far as Redis is concerned, and a message published to it is discarded rather than queued.
              </p>
              {channels &&
                (channels.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No channel has a subscriber.</p>
                ) : (
                  <Table columns={["Channel", "Subscribers"]} rows={channels.map((c) => [c.channel, String(c.subscribers)])} />
                ))}
            </div>
          )}

          {tab === "slowlog" && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={loadSlowlog}>
                  <RefreshCw className={cn("size-3.5", busy && "animate-spin")} /> Refresh
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => run(async () => { await exec(["SLOWLOG", "RESET"]); toast.success("Slow log cleared"); loadSlowlog(); })}
                >
                  <Trash2 className="size-3.5" /> Reset
                </Button>
                {slowlog && <span className="text-xs text-muted-foreground">{slowlog.length} entr{slowlog.length === 1 ? "y" : "ies"}</span>}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Execution time only — network and queue time are excluded, so a command listed at 2 ms can still have taken
                far longer from the client's point of view.
              </p>
              {slowlog &&
                (slowlog.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing has exceeded slowlog-log-slower-than.</p>
                ) : (
                  <Table
                    columns={["When", "Duration", "Client", "Name", "Command"]}
                    rows={slowlog.map((s) => [
                      new Date(s.at * 1000).toLocaleString(),
                      s.usec >= 1000 ? `${(s.usec / 1000).toFixed(1)} ms` : `${s.usec} µs`,
                      s.clientAddr ?? "—",
                      s.clientName ?? "—",
                      s.command.join(" "),
                    ])}
                  />
                ))}
            </div>
          )}

          {tab === "keys" && (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[300px_1fr]">
              <div className="flex flex-col gap-2">
                <div className="flex gap-1">
                  <Input
                    className="h-8 font-mono text-xs"
                    value={pattern}
                    onChange={(e) => setPattern(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && loadKeys()}
                    placeholder="user:*"
                  />
                  <Button size="icon" variant="outline" className="h-8 w-8" onClick={loadKeys}><Search className="size-4" /></Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Scanned with SCAN, not KEYS — safe to run against a live server.
                  {scanTruncated && " Stopped early; narrow the pattern to see the rest."}
                </p>
                <div className="h-[52vh] overflow-auto rounded-md border border-border">
                  {keys.map((k) => (
                    <button
                      key={k}
                      onClick={() => openKey(k)}
                      className={cn(
                        "block w-full truncate px-2 py-1 text-left font-mono text-xs",
                        selected === k ? "bg-primary/15 text-primary" : "hover:bg-secondary",
                      )}
                    >
                      {k}
                    </button>
                  ))}
                  {keys.length === 0 && <p className="p-2 text-xs text-muted-foreground">No keys matched.</p>}
                </div>
              </div>

              <div>
                {selected && detail ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="mono text-sm">{selected}</span>
                      <Badge variant="secondary">{detail.type}</Badge>
                      <Badge variant="outline">TTL {detail.ttl < 0 ? "none" : `${detail.ttl}s`}</Badge>
                      {detail.bytes !== undefined && <Badge variant="outline">{Math.max(1, Math.round(detail.bytes / 1024))} KB</Badge>}
                      <div className="ml-auto flex gap-1">
                        <CopyButton value={detail.value} label="Value" />
                        {detail.type === "string" && <Button size="sm" variant="outline" onClick={saveString}><Save className="size-3.5" /> Save</Button>}
                        <Button size="sm" variant="ghost" onClick={delKey}><Trash2 className="size-3.5" /> Delete</Button>
                      </div>
                    </div>
                    <Textarea
                      mono
                      className="h-[52vh]"
                      value={detail.value}
                      readOnly={detail.type !== "string"}
                      onChange={(e) => setDetail({ ...detail, value: e.target.value })}
                    />
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Select a key to inspect its value.</p>
                )}
              </div>
            </div>
          )}

          {tab === "console" && (
            <div className="flex flex-col gap-2">
              <div className="flex gap-1">
                <Input
                  className="h-8 font-mono text-xs"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && runConsole()}
                  placeholder='CONFIG GET maxmemory   ·   MEMORY DOCTOR   ·   LATENCY LATEST'
                />
                <Button size="sm" onClick={runConsole}><Terminal className="size-3.5" /> Run</Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                One command per line, quoted values kept whole. Destructive commands ask first. Each call opens its own
                connection, so MULTI, WATCH, SUBSCRIBE and SELECT do not carry across commands.
              </p>
              <div className="flex flex-col gap-2">
                {output.map((o, i) => (
                  <div key={i} className="rounded-md border border-border">
                    <div className="flex items-center gap-2 border-b border-border px-2 py-1">
                      <span className="mono text-xs">{o.cmd}</span>
                      {!o.ok && <Badge variant="destructive" className="text-[10px]">error</Badge>}
                      <AddToDebug
                        className="ml-auto"
                        variant="ghost"
                        label="Debug"
                        makeEvent={() => redisCommandEvent(target, o.cmd, o.text, o.ok)}
                      />
                      <CopyButton value={o.text} />
                    </div>
                    <pre className={cn("mono max-h-60 overflow-auto p-2 text-[11px]", !o.ok && "text-destructive")}>{o.text}</pre>
                  </div>
                ))}
                {output.length === 0 && <p className="text-sm text-muted-foreground">Nothing run yet.</p>}
              </div>
            </div>
          )}
        </>
      )}
    </ToolShell>
  );
}

function Table({ columns, rows, dense }: { columns: string[]; rows: string[][]; dense?: boolean }) {
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
                <td key={j} className={cn("mono max-w-[340px] truncate px-2", dense ? "py-0.5" : "py-1")} title={cell}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
