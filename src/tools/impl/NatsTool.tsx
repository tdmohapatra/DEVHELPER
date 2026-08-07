import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RefreshCw, Antenna, Activity, Plug, Layers, Network, AlertTriangle, Radio, Search, Send, Square, Trash2 } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/CopyButton";
import { AddToDebug } from "@/components/AddToDebug";
import { cn } from "@/lib/utils";
import { executeRequest } from "@/lib/http";
import { NativeNotice } from "@/components/NativeNotice";
import { isTauri } from "@/lib/platform";
import {
  allConsumers,
  allStreams,
  formatBytes,
  formatNanos,
  limitUsage,
  monitorUrl,
  serverFindings,
  subjectMatches,
  matchingFilters,
  portAdvice,
  publishSubjectProblem,
  withClientPort,
  withMonitorPort,
  type Connz,
  type Jsz,
  type Severity,
  type Varz,
} from "@/tools/lib/natsMonitor";
import { brokerUnreachableEvent, natsServerEvent } from "@/tools/lib/mqCapture";
import { useHandoffStore } from "@/stores/useHandoffStore";
import { toast } from "@/components/ui/toast";
import {
  NATS_EVENT,
  appendMessage,
  filterFeed,
  isStatusEvent,
  natsPublish,
  natsRequest,
  natsSubscribe,
  natsUnsubscribe,
  subjectCounts,
  subscribeSubjectProblem,
  type FeedMessage,
  type NatsAuth,
  type NatsIncoming,
  type NatsStatusEvent,
} from "@/tools/lib/natsClient";

type Tab = "overview" | "jetstream" | "connections" | "subjects" | "pubsub" | "raw";

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: "overview", label: "Overview", icon: <Activity className="size-3.5" /> },
  { id: "jetstream", label: "JetStream", icon: <Layers className="size-3.5" /> },
  { id: "connections", label: "Connections", icon: <Plug className="size-3.5" /> },
  { id: "subjects", label: "Subjects", icon: <Radio className="size-3.5" /> },
  { id: "pubsub", label: "Pub/Sub", icon: <Send className="size-3.5" /> },
  { id: "raw", label: "Raw", icon: <Network className="size-3.5" /> },
];

const SEVERITY_CLASS: Record<Severity, string> = {
  ok: "text-success",
  warn: "text-warning",
  bad: "text-destructive",
  unknown: "text-muted-foreground",
};

/** Endpoints the Raw tab can fetch on demand. */
const RAW_PATHS = [
  "/varz",
  "/connz?subs=1",
  "/subsz?subs=1",
  "/jsz?streams=1&consumers=1&config=1",
  "/routez",
  "/leafz?subs=1",
  "/gatewayz",
  "/accountz",
  "/healthz",
];

export function NatsTool() {
  const [server, setServer] = useState("localhost:8222");
  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  const [varz, setVarz] = useState<Varz | null>(null);
  const [connz, setConnz] = useState<Connz | null>(null);
  const [jsz, setJsz] = useState<Jsz | null>(null);
  const [subsz, setSubsz] = useState<Record<string, unknown> | null>(null);
  const [health, setHealth] = useState<string>("");

  const [rawPath, setRawPath] = useState(RAW_PATHS[0]);
  const [raw, setRaw] = useState("");

  const [subjectTest, setSubjectTest] = useState("orders.new.eu");
  const [filterInput, setFilterInput] = useState("orders.>\norders.*\nbilling.>");

  // Where the address came from, when the Environment Manager sent it here.
  const [prefilledFrom, setPrefilledFrom] = useState("");

  useEffect(() => {
    const handoff = useHandoffStore.getState().take("nats");
    if (!handoff?.fields.server) return;
    setServer(handoff.fields.server);
    setPrefilledFrom(handoff.from);
  }, []);

  /**
   * Fetch a monitoring endpoint through the Tauri HTTP plugin.
   *
   * Not `window.fetch`: the webview runs under `default-src 'self'`, so a request
   * to any other origin — including a NATS server on localhost — is blocked
   * before it leaves, and the server sends no CORS headers either. The plugin
   * issues the request from Rust, where neither applies.
   */
  const get = useCallback(
    async (path: string): Promise<unknown> => {
      const url = monitorUrl(server, path);
      const res = await executeRequest({ method: "GET", url, headers: {} }, undefined, { timeoutMs: 5000 });
      if (!res.ok) throw new Error(`${path} returned ${res.status} ${res.statusText}`);
      try {
        return JSON.parse(res.body);
      } catch {
        throw new Error(
          `${path} did not return JSON. ${res.body.slice(0, 120)}`,
        );
      }
    },
    [server],
  );

  const refresh = async () => {
    setBusy(true);
    setError("");
    try {
      // varz first: if the monitoring port is wrong, fail on one request rather than five.
      const v = (await get("/varz")) as Varz;
      setVarz(v);
      // The rest are best-effort — JetStream may be disabled, and older servers
      // do not have every endpoint.
      const [c, j, s, h] = await Promise.all([
        get("/connz?subs=1").catch(() => null),
        get("/jsz?streams=1&consumers=1&config=1").catch(() => null),
        get("/subsz?subs=1").catch(() => null),
        get("/healthz").catch(() => null),
      ]);
      setConnz(c as Connz | null);
      setJsz(j as Jsz | null);
      setSubsz(s as Record<string, unknown> | null);
      setHealth(h ? JSON.stringify(h) : "");
      setLoaded(true);
    } catch (e) {
      const reason = e instanceof Error && e.message ? e.message : String(e);
      setError(`${reason}${portAdvice(server)}`);
      setLoaded(false);
    } finally {
      setBusy(false);
    }
  };

  const fetchRaw = async () => {
    setBusy(true);
    setError("");
    try {
      setRaw(JSON.stringify(await get(rawPath), null, 2));
    } catch (e) {
      setRaw("");
      setError(e instanceof Error && e.message ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const findings = useMemo(() => serverFindings(varz, connz, jsz), [varz, connz, jsz]);
  const streams = useMemo(() => allStreams(jsz), [jsz]);
  const consumers = useMemo(() => allConsumers(jsz), [jsz]);

  /** Subscription filters seen across every consumer and connection, deduplicated. */
  const knownFilters = useMemo(() => {
    const set = new Set<string>();
    for (const { consumer } of consumers) {
      const f = consumer.config?.filter_subject;
      if (f) set.add(f);
    }
    for (const { stream } of streams) for (const s of stream.config?.subjects ?? []) set.add(s);
    for (const c of connz?.connections ?? []) for (const s of c.subscriptions_list ?? []) set.add(s);
    return [...set].sort();
  }, [consumers, streams, connz]);

  const jsMemLimit = jsz?.config?.max_memory ?? varz?.jetstream?.config?.max_memory;
  const jsStoreLimit = jsz?.config?.max_storage ?? varz?.jetstream?.config?.max_storage;

  return (
    <ToolShell
      toolId="nats"
      title="NATS"
      description="Server, connections, subjects and JetStream streams and consumers, over the monitoring port."
    >
      {!isTauri() && <NativeNotice what="Reading a NATS server" />}

      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Monitoring address</span>
          <Input
            className="h-8 w-64"
            value={server}
            onChange={(e) => setServer(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && refresh()}
            placeholder="localhost:8222"
          />
        </label>
        <Button size="sm" onClick={refresh} disabled={busy}>
          {busy ? <RefreshCw className="size-3.5 animate-spin" /> : <Antenna className="size-3.5" />} Connect
        </Button>
        {prefilledFrom && <Badge variant="outline">from {prefilledFrom}</Badge>}
        {loaded && varz && (
          <>
            <Badge variant="success">{varz.server_name || varz.server_id?.slice(0, 8)}</Badge>
            <Badge variant="outline">v{varz.version}</Badge>
            {varz.cluster?.name && <Badge variant="outline">cluster {varz.cluster.name}</Badge>}
            {jsz && !jsz.disabled && <Badge variant="outline">JetStream</Badge>}
            {health && <Badge variant={health.includes('"ok"') ? "success" : "warning"}>{health.slice(0, 40)}</Badge>}
          </>
        )}
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
          <p>{error}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {withMonitorPort(server) !== server.trim() && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => { const next = withMonitorPort(server); setServer(next); setError(""); }}
              >
                Use {withMonitorPort(server)} instead
              </Button>
            )}
            <AddToDebug
              variant="outline"
              label="Add to Debug"
              makeEvent={() => brokerUnreachableEvent("nats", server.trim() || "nats", error)}
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
                natsServerEvent({
                  target: server.trim(),
                  serverName: varz?.server_name,
                  version: varz?.version,
                  connections: varz?.connections,
                  slowConsumers: varz?.slow_consumers,
                  streams: jsz?.streams,
                  consumers: jsz?.consumers,
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

          {tab === "overview" && varz && (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-5">
                <Tile label="Uptime" value={varz.uptime ?? "—"} />
                <Tile label="Connections" value={`${varz.connections ?? 0}${varz.max_connections ? ` / ${varz.max_connections}` : ""}`} />
                <Tile label="Subscriptions" value={String(varz.subscriptions ?? 0)} />
                <Tile
                  label="Slow consumers"
                  value={String(varz.slow_consumers ?? 0)}
                  tone={varz.slow_consumers ? "bad" : "ok"}
                />
                <Tile label="Memory" value={formatBytes(varz.mem)} />
                <Tile label="Msgs in / out" value={`${(varz.in_msgs ?? 0).toLocaleString()} / ${(varz.out_msgs ?? 0).toLocaleString()}`} />
                <Tile label="Bytes in / out" value={`${formatBytes(varz.in_bytes)} / ${formatBytes(varz.out_bytes)}`} />
                <Tile label="Routes / leafs" value={`${varz.routes ?? 0} / ${varz.leafnodes ?? 0}`} />
                <Tile label="Max payload" value={formatBytes(varz.max_payload)} />
                <Tile label="Write deadline" value={formatNanos(varz.write_deadline)} />
              </div>

              {jsz && !jsz.disabled && (
                <section>
                  <SectionTitle>JetStream</SectionTitle>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-5">
                    <Tile label="Streams" value={String(jsz.streams ?? 0)} />
                    <Tile label="Consumers" value={String(jsz.consumers ?? 0)} />
                    <Tile label="Messages" value={(jsz.messages ?? 0).toLocaleString()} />
                    <Tile
                      label="Memory"
                      value={`${formatBytes(jsz.memory)}${jsMemLimit ? ` / ${formatBytes(jsMemLimit)}` : ""}`}
                      tone={pressureTone(limitUsage(jsz.memory, jsMemLimit))}
                    />
                    <Tile
                      label="Storage"
                      value={`${formatBytes(jsz.storage)}${jsStoreLimit ? ` / ${formatBytes(jsStoreLimit)}` : ""}`}
                      tone={pressureTone(limitUsage(jsz.storage, jsStoreLimit))}
                    />
                    <Tile label="API calls" value={`${(jsz.api?.total ?? 0).toLocaleString()} (${jsz.api?.errors ?? 0} errors)`} />
                  </div>
                </section>
              )}

              {jsz?.disabled && <p className="text-sm text-muted-foreground">JetStream is not enabled on this server.</p>}
            </div>
          )}

          {tab === "jetstream" && (
            <div className="flex flex-col gap-3">
              {!jsz || jsz.disabled ? (
                <p className="text-sm text-muted-foreground">
                  JetStream is not enabled, or this server does not expose /jsz. Start the server with -js to enable it.
                </p>
              ) : streams.length === 0 ? (
                <p className="text-sm text-muted-foreground">No streams exist yet.</p>
              ) : (
                <>
                  <SectionTitle>Streams ({streams.length})</SectionTitle>
                  <Table
                    columns={["Account", "Stream", "Subjects", "Messages", "Bytes", "Limit used", "Retention", "Storage", "Replicas", "Leader", "Consumers", "First–last seq"]}
                    rows={streams.map(({ account, stream }) => {
                      const use = limitUsage(stream.state?.bytes, stream.config?.max_bytes);
                      return [
                        account,
                        stream.name ?? "—",
                        (stream.config?.subjects ?? []).join(", ") || "—",
                        (stream.state?.messages ?? 0).toLocaleString(),
                        formatBytes(stream.state?.bytes),
                        use === undefined ? "no limit" : `${use.toFixed(0)}%`,
                        stream.config?.retention ?? "—",
                        stream.config?.storage ?? "—",
                        String(stream.config?.num_replicas ?? 1),
                        stream.cluster?.leader ?? "—",
                        String(stream.state?.consumer_count ?? 0),
                        `${stream.state?.first_seq ?? 0}–${stream.state?.last_seq ?? 0}`,
                      ];
                    })}
                  />

                  <SectionTitle>Consumers ({consumers.length})</SectionTitle>
                  <p className="text-[11px] text-muted-foreground">
                    Pending is the backlog not yet delivered. Ack pending is delivered but unacknowledged — when it reaches
                    max_ack_pending, delivery stops until something is acked.
                  </p>
                  {consumers.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No consumers. A stream with no consumer collects messages nobody reads.</p>
                  ) : (
                    <Table
                      columns={["Stream", "Consumer", "Filter", "Ack policy", "Ack wait", "Max deliver", "Pending", "Ack pending", "Max ack pending", "Redelivered", "Waiting"]}
                      rows={consumers.map(({ stream, consumer }) => [
                        stream,
                        consumer.name ?? consumer.config?.durable_name ?? "(ephemeral)",
                        consumer.config?.filter_subject || "all",
                        consumer.config?.ack_policy ?? "—",
                        formatNanos(consumer.config?.ack_wait),
                        String(consumer.config?.max_deliver ?? -1),
                        (consumer.num_pending ?? 0).toLocaleString(),
                        String(consumer.num_ack_pending ?? 0),
                        String(consumer.config?.max_ack_pending ?? 0),
                        String(consumer.num_redelivered ?? 0),
                        String(consumer.num_waiting ?? 0),
                      ])}
                    />
                  )}
                </>
              )}
            </div>
          )}

          {tab === "connections" && (
            <div className="flex flex-col gap-2">
              <SectionTitle>Connections ({connz?.num_connections ?? 0} of {connz?.total ?? 0})</SectionTitle>
              {(connz?.connections ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No client connections.</p>
              ) : (
                <Table
                  columns={["CID", "Name", "Address", "Language", "Account", "User", "Uptime", "Idle", "Subs", "Pending", "In msgs", "Out msgs", "TLS"]}
                  rows={(connz?.connections ?? []).map((c) => [
                    String(c.cid ?? "—"),
                    c.name || "—",
                    `${c.ip ?? "?"}:${c.port ?? "?"}`,
                    `${c.lang ?? "—"} ${c.version ?? ""}`.trim(),
                    c.account ?? "—",
                    c.authorized_user ?? "—",
                    c.uptime ?? "—",
                    c.idle ?? "—",
                    String(c.subscriptions ?? 0),
                    formatBytes(c.pending_bytes),
                    (c.in_msgs ?? 0).toLocaleString(),
                    (c.out_msgs ?? 0).toLocaleString(),
                    c.tls_version ?? "none",
                  ])}
                />
              )}

              {(connz?.connections ?? []).some((c) => (c.subscriptions_list ?? []).length > 0) && (
                <>
                  <SectionTitle>Subscriptions by connection</SectionTitle>
                  <div className="max-h-72 overflow-auto rounded-md border border-border p-2">
                    {(connz?.connections ?? [])
                      .filter((c) => (c.subscriptions_list ?? []).length > 0)
                      .map((c) => (
                        <div key={c.cid} className="mb-1 text-[11px]">
                          <span className="text-muted-foreground">cid {c.cid} {c.name ? `(${c.name})` : ""}: </span>
                          <span className="mono">{(c.subscriptions_list ?? []).join(", ")}</span>
                        </div>
                      ))}
                  </div>
                </>
              )}
            </div>
          )}

          {tab === "subjects" && (
            <div className="flex flex-col gap-3">
              <SectionTitle>Subject matcher</SectionTitle>
              <p className="text-[11px] text-muted-foreground">
                <span className="mono">*</span> matches exactly one token; <span className="mono">&gt;</span> matches one or
                more trailing tokens and is only legal last. Getting this wrong is how a stream captures nothing, or
                everything.
              </p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Subject to test</span>
                  <Input className="h-8 font-mono text-xs" value={subjectTest} onChange={(e) => setSubjectTest(e.target.value)} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Filters, one per line</span>
                  <textarea
                    className="mono min-h-24 rounded-md border border-input bg-transparent p-2 text-xs"
                    value={filterInput}
                    onChange={(e) => setFilterInput(e.target.value)}
                  />
                </label>
              </div>
              <Table
                columns={["Filter", "Matches"]}
                rows={filterInput
                  .split("\n")
                  .map((f) => f.trim())
                  .filter(Boolean)
                  .map((f) => [f, subjectMatches(f, subjectTest) ? "yes" : "no"])}
              />

              {knownFilters.length > 0 && (
                <>
                  <SectionTitle>Live subjects on this server ({knownFilters.length})</SectionTitle>
                  <p className="text-[11px] text-muted-foreground">
                    Stream subjects, consumer filters and client subscriptions found on the server. Highlighted rows would
                    receive <span className="mono">{subjectTest || "(nothing)"}</span>.
                  </p>
                  <div className="max-h-72 overflow-auto rounded-md border border-border">
                    {knownFilters.map((f) => {
                      const hit = subjectMatches(f, subjectTest);
                      return (
                        <div
                          key={f}
                          className={cn("mono px-2 py-0.5 text-[11px]", hit ? "bg-success/10 text-success" : "text-muted-foreground")}
                        >
                          {f}
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {matchingFilters(knownFilters, subjectTest).length} of {knownFilters.length} would match.
                  </p>
                </>
              )}

              {subsz && (
                <p className="text-[11px] text-muted-foreground">
                  Server-wide: {String((subsz as { num_subscriptions?: number }).num_subscriptions ?? 0)} subscriptions in
                  the interest graph.
                </p>
              )}
            </div>
          )}

          {tab === "pubsub" && <PubSub server={server} />}

          {tab === "raw" && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={rawPath}
                  onChange={(e) => setRawPath(e.target.value)}
                  className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
                >
                  {RAW_PATHS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <Button size="sm" variant="outline" onClick={fetchRaw}>
                  <Search className="size-3.5" /> Fetch
                </Button>
                {raw && <CopyButton value={raw} label="JSON" />}
                <span className="text-[11px] text-muted-foreground">{monitorUrl(server, rawPath)}</span>
              </div>
              {raw ? (
                <pre className="mono max-h-[60vh] overflow-auto rounded-md border border-border bg-secondary/30 p-2 text-[11px]">{raw}</pre>
              ) : (
                <p className="text-sm text-muted-foreground">Pick an endpoint and fetch it.</p>
              )}
            </div>
          )}
        </>
      )}

      {!loaded && !error && (
        <p className="text-sm text-muted-foreground">
          Enter the monitoring address and connect. This is the HTTP monitoring port (8222 by default, enabled with
          <span className="mono"> -m 8222</span>), not the client port 4222. Everything here is read-only.
        </p>
      )}
    </ToolShell>
  );
}

/**
 * Publish, subscribe and request over the client protocol.
 *
 * Everything else in this tool reads the monitoring port, which can tell you a
 * subject exists and that nobody is subscribed to it, but not what is flowing
 * through it. This is the half that answers "is anything actually being
 * published", which is the question behind most "the consumer is not getting
 * anything" reports.
 *
 * The address here is the client port (4222), not the monitoring port the tabs
 * above use — so it is derived rather than shared, and shown so the difference
 * is visible.
 */
function PubSub({ server }: { server: string }) {
  const [address, setAddress] = useState(() => withClientPort(server));
  const [auth, setAuth] = useState<NatsAuth>({});
  const [showAuth, setShowAuth] = useState(false);

  const [subject, setSubject] = useState("orders.>");
  const [queueGroup, setQueueGroup] = useState("");
  const [subs, setSubs] = useState<{ id: string; subject: string }[]>([]);

  const [publishSubject, setPublishSubject] = useState("orders.created");
  const [payload, setPayload] = useState('{"id":1}');
  const [replyTo, setReplyTo] = useState("");

  const [feed, setFeed] = useState<FeedMessage[]>([]);
  const [filter, setFilter] = useState("");
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reply, setReply] = useState<NatsIncoming | null>(null);

  const seq = useRef(0);
  // Read inside the event listener without resubscribing it on every keystroke.
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let live = true;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const stop = await listen<NatsIncoming | NatsStatusEvent>(NATS_EVENT, (event) => {
        const payload = event.payload;
        if (isStatusEvent(payload)) {
          if (payload.kind === "closed") setSubs((cur) => cur.filter((s) => s.id !== payload.id));
          if (payload.kind === "error") setError(payload.detail);
          return;
        }
        // Pausing stops the view updating; the subscription stays open, so
        // nothing is missed on the server side.
        if (pausedRef.current) return;
        seq.current += 1;
        setFeed((cur) => appendMessage(cur, { ...payload, at: Date.now(), seq: seq.current }));
      });
      if (live) unlisten = stop;
      else stop();
    })();
    return () => { live = false; unlisten?.(); };
  }, []);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const subscribeProblem = subscribeSubjectProblem(subject);
  const publishProblem = publishSubjectProblem(publishSubject);

  const subscribe = () =>
    run(async () => {
      const id = await natsSubscribe(address, auth, subject.trim(), queueGroup.trim() || undefined);
      setSubs((cur) => [...cur, { id, subject: subject.trim() }]);
      toast.success(`Subscribed to ${subject.trim()}`);
    });

  const unsubscribe = (id: string) =>
    run(async () => {
      await natsUnsubscribe(id);
      setSubs((cur) => cur.filter((s) => s.id !== id));
    });

  const publish = () =>
    run(async () => {
      await natsPublish(address, auth, publishSubject.trim(), payload, replyTo.trim() || undefined);
      toast.success("Published");
    });

  const request = () =>
    run(async () => {
      setReply(null);
      setReply(await natsRequest(address, auth, publishSubject.trim(), payload));
    });

  const shown = filterFeed(feed, filter);
  const counts = subjectCounts(feed);

  return (
    <div className="flex flex-col gap-3">
      {!isTauri() && <NativeNotice what="Publishing and subscribing" />}

      <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Client address (not the monitoring port)</span>
          <Input className="h-8 w-56" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="localhost:4222" />
        </label>
        <Button size="sm" variant="outline" onClick={() => setShowAuth((v) => !v)}>
          {showAuth ? "Hide" : "Add"} credentials
        </Button>
        {subs.length > 0 && <Badge variant="success">{subs.length} subscription(s)</Badge>}
      </div>

      {showAuth && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">User</span>
            <Input className="h-8 w-36" value={auth.user ?? ""} onChange={(e) => setAuth({ ...auth, user: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Password</span>
            <Input type="password" className="h-8 w-36" value={auth.password ?? ""} onChange={(e) => setAuth({ ...auth, password: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Token</span>
            <Input type="password" className="h-8 w-36" value={auth.token ?? ""} onChange={(e) => setAuth({ ...auth, token: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">.creds file path</span>
            <Input className="h-8 w-56" value={auth.credsPath ?? ""} onChange={(e) => setAuth({ ...auth, credsPath: e.target.value })} />
          </label>
          <span className="text-[11px] text-muted-foreground">Held for this session only; nothing is saved.</span>
        </div>
      )}

      {error && <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <section className="flex flex-col gap-2 rounded-md border border-border p-3">
          <SectionTitle>Subscribe</SectionTitle>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-xs text-muted-foreground">Subject (wildcards allowed)</span>
              <Input className="h-8 font-mono text-xs" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Queue group</span>
              <Input className="h-8 w-32 font-mono text-xs" value={queueGroup} onChange={(e) => setQueueGroup(e.target.value)} placeholder="optional" />
            </label>
            <Button size="sm" onClick={subscribe} disabled={busy || !!subscribeProblem || !isTauri()}>
              <Radio className="size-3.5" /> Subscribe
            </Button>
          </div>
          {subject && subscribeProblem && <p className="text-[11px] text-warning">{subscribeProblem}</p>}
          <p className="text-[11px] text-muted-foreground">
            Core NATS has no replay: a subscription only sees what is published while it is open. A queue group makes
            this one member of a load-balanced set, so it receives a share rather than everything.
          </p>
          {subs.length > 0 && (
            <div className="flex flex-col gap-1">
              {subs.map((s) => (
                <div key={s.id} className="flex items-center gap-2 rounded border border-border px-2 py-1 text-xs">
                  <Radio className="size-3 text-success" />
                  <span className="mono truncate">{s.subject}</span>
                  <Button size="sm" variant="ghost" className="ml-auto h-6" onClick={() => unsubscribe(s.id)}>
                    <Square className="size-3" /> Stop
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-2 rounded-md border border-border p-3">
          <SectionTitle>Publish or request</SectionTitle>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Subject (must be literal)</span>
            <Input className="h-8 font-mono text-xs" value={publishSubject} onChange={(e) => setPublishSubject(e.target.value)} />
          </label>
          {publishSubject && publishProblem && <p className="text-[11px] text-warning">{publishProblem}</p>}
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Payload</span>
            <textarea
              className="mono h-24 w-full rounded-md border border-input bg-transparent p-2 text-xs"
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Reply-to subject</span>
            <Input className="h-8 font-mono text-xs" value={replyTo} onChange={(e) => setReplyTo(e.target.value)} placeholder="optional" />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={publish} disabled={busy || !!publishProblem || !isTauri()}>
              <Send className="size-3.5" /> Publish
            </Button>
            <Button size="sm" variant="outline" onClick={request} disabled={busy || !!publishProblem || !isTauri()}>
              Request &amp; wait
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            A publish with nobody subscribed is discarded, not queued — core NATS delivers to whoever is listening at
            that moment and nobody else. Request waits for one reply and times out after 5 seconds.
          </p>
          {reply && (
            <div className="rounded-md border border-success/40 bg-success/5 p-2">
              <div className="mb-1 flex items-center gap-2 text-xs">
                <Badge variant="success">reply</Badge>
                <span className="mono">{reply.subject}</span>
                <CopyButton className="ml-auto" value={reply.payload} />
              </div>
              <pre className="mono max-h-40 overflow-auto text-[11px]">{reply.payload}</pre>
            </div>
          )}
        </section>
      </div>

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <SectionTitle>Live messages ({feed.length})</SectionTitle>
          <Input className="h-8 w-56" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter subject or payload" />
          <Button size="sm" variant={paused ? "secondary" : "ghost"} onClick={() => setPaused((p) => !p)}>
            {paused ? "Resume" : "Pause"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setFeed([])}><Trash2 className="size-3.5" /> Clear</Button>
          {feed.length > 0 && <CopyButton value={JSON.stringify(feed, null, 2)} label="JSON" />}
        </div>
        {paused && <p className="text-[11px] text-muted-foreground">Paused — the subscription is still open, so nothing is being missed on the server.</p>}
        {counts.length > 1 && (
          <div className="flex flex-wrap gap-1">
            {counts.slice(0, 12).map((c) => (
              <button
                key={c.subject}
                onClick={() => setFilter(c.subject)}
                className="rounded-full bg-secondary px-2 py-0.5 text-[10px] hover:bg-primary/15 hover:text-primary"
              >
                {c.subject} · {c.count}
              </button>
            ))}
          </div>
        )}
        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {feed.length === 0 ? "Nothing received yet. Subscribe to a subject to watch traffic." : "No message matches the filter."}
          </p>
        ) : (
          <div className="max-h-[46vh] overflow-auto rounded-md border border-border">
            {shown.map((m) => (
              <div key={m.seq} className="border-b border-border px-2 py-1 last:border-b-0">
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="mono text-muted-foreground">{new Date(m.at).toLocaleTimeString()}</span>
                  <span className="mono text-primary">{m.subject}</span>
                  <span className="text-muted-foreground">{m.bytes} B</span>
                  {m.reply && <Badge variant="outline" className="text-[9px]">reply→ {m.reply}</Badge>}
                  {m.binary && <Badge variant="warning" className="text-[9px]">binary</Badge>}
                  <CopyButton className="ml-auto" value={m.payload} />
                </div>
                <pre className="mono max-h-32 overflow-auto whitespace-pre-wrap text-[11px]">{m.payload}</pre>
                {m.headers.length > 0 && (
                  <div className="text-[10px] text-muted-foreground">
                    {m.headers.map(([k, v], i) => <span key={i} className="mr-2">{k}: {v}</span>)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function pressureTone(pct: number | undefined): "ok" | "warn" | "bad" | undefined {
  if (pct === undefined) return undefined;
  return pct >= 90 ? "bad" : pct >= 75 ? "warn" : "ok";
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

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</h3>;
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
