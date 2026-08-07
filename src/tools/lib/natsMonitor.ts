/**
 * The NATS monitoring endpoints, and what their numbers mean.
 *
 * A NATS server exposes JSON over its monitoring port (8222 by default): `varz`
 * for the server, `connz` for connections, `subsz` for subscriptions, `jsz` for
 * JetStream, `routez`/`leafz`/`gatewayz` for the cluster mesh, `healthz` for a
 * liveness verdict. It is read-only, which makes it the safe half of a NATS tool.
 *
 * The shapes below cover the fields worth showing. Servers add fields between
 * versions, so everything is optional and nothing is required to be present.
 */

export const NATS_ENDPOINTS = [
  { path: "/varz", label: "Server", description: "Version, uptime, memory, message counters and configured limits." },
  { path: "/connz?subs=1", label: "Connections", description: "Every client connection with its subscriptions, pending bytes and idle time." },
  { path: "/subsz?subs=1", label: "Subscriptions", description: "The subscription interest graph the server is routing against." },
  { path: "/jsz?streams=1&consumers=1&config=1", label: "JetStream", description: "Streams, consumers, storage use and per-consumer backlog." },
  { path: "/routez", label: "Routes", description: "Connections to other servers in the cluster." },
  { path: "/leafz?subs=1", label: "Leaf nodes", description: "Leaf node connections, which is how edge and spoke deployments attach." },
  { path: "/gatewayz", label: "Gateways", description: "Super-cluster gateway connections between clusters." },
  { path: "/healthz", label: "Health", description: "The server's own readiness verdict, including JetStream." },
] as const;

export interface Varz {
  server_id?: string;
  server_name?: string;
  version?: string;
  go?: string;
  host?: string;
  port?: number;
  uptime?: string;
  mem?: number;
  cpu?: number;
  connections?: number;
  total_connections?: number;
  routes?: number;
  remotes?: number;
  leafnodes?: number;
  in_msgs?: number;
  out_msgs?: number;
  in_bytes?: number;
  out_bytes?: number;
  slow_consumers?: number;
  subscriptions?: number;
  max_connections?: number;
  max_payload?: number;
  max_pending?: number;
  write_deadline?: number;
  jetstream?: { config?: { max_memory?: number; max_storage?: number; store_dir?: string }; stats?: JetStreamStats };
  cluster?: { name?: string };
}

export interface JetStreamStats {
  memory?: number;
  storage?: number;
  streams?: number;
  consumers?: number;
  messages?: number;
  bytes?: number;
  api?: { total?: number; errors?: number };
}

export interface ConnzConn {
  cid?: number;
  name?: string;
  lang?: string;
  version?: string;
  ip?: string;
  port?: number;
  start?: string;
  last_activity?: string;
  idle?: string;
  uptime?: string;
  pending_bytes?: number;
  in_msgs?: number;
  out_msgs?: number;
  in_bytes?: number;
  out_bytes?: number;
  subscriptions?: number;
  subscriptions_list?: string[];
  account?: string;
  tls_version?: string;
  authorized_user?: string;
}

export interface Connz {
  num_connections?: number;
  total?: number;
  offset?: number;
  limit?: number;
  connections?: ConnzConn[];
}

export interface StreamState {
  messages?: number;
  bytes?: number;
  first_seq?: number;
  last_seq?: number;
  consumer_count?: number;
  num_subjects?: number;
  num_deleted?: number;
}

export interface StreamConfig {
  name?: string;
  subjects?: string[];
  retention?: string;
  storage?: string;
  max_msgs?: number;
  max_bytes?: number;
  max_age?: number;
  max_msgs_per_subject?: number;
  num_replicas?: number;
  discard?: string;
  duplicate_window?: number;
}

export interface ConsumerConfig {
  durable_name?: string;
  name?: string;
  ack_policy?: string;
  ack_wait?: number;
  max_deliver?: number;
  filter_subject?: string;
  deliver_policy?: string;
  max_ack_pending?: number;
}

export interface ConsumerInfo {
  name?: string;
  stream_name?: string;
  config?: ConsumerConfig;
  /** Messages the consumer has not been delivered yet — the backlog. */
  num_pending?: number;
  /** Delivered but not yet acknowledged. */
  num_ack_pending?: number;
  /** Messages delivered more than once. */
  num_redelivered?: number;
  num_waiting?: number;
  delivered?: { consumer_seq?: number; stream_seq?: number };
  ack_floor?: { consumer_seq?: number; stream_seq?: number };
}

export interface StreamDetail {
  name?: string;
  config?: StreamConfig;
  state?: StreamState;
  cluster?: { leader?: string; replicas?: { name?: string; current?: boolean; active?: number; lag?: number }[] };
  consumer_detail?: ConsumerInfo[];
}

export interface Jsz extends JetStreamStats {
  server_id?: string;
  disabled?: boolean;
  config?: { max_memory?: number; max_storage?: number; store_dir?: string };
  account_details?: { name?: string; stream_detail?: StreamDetail[] }[];
}

/** Every stream across every account, flattened with its account name. */
export function allStreams(jsz: Jsz | null): { account: string; stream: StreamDetail }[] {
  if (!jsz?.account_details) return [];
  return jsz.account_details.flatMap((acc) =>
    (acc.stream_detail ?? []).map((stream) => ({ account: acc.name ?? "$G", stream })),
  );
}

/** Every consumer across every stream, flattened with where it came from. */
export function allConsumers(jsz: Jsz | null): { account: string; stream: string; consumer: ConsumerInfo }[] {
  return allStreams(jsz).flatMap(({ account, stream }) =>
    (stream.consumer_detail ?? []).map((consumer) => ({ account, stream: stream.name ?? "", consumer })),
  );
}

export type Severity = "ok" | "warn" | "bad" | "unknown";

export interface Finding {
  severity: Severity;
  subject: string;
  message: string;
}

/**
 * Percentage of a limit in use, or undefined when the limit is unset.
 *
 * NATS uses 0 and -1 for "no limit" depending on the field, and treating either
 * as a limit produces a division that reports 100% of nothing.
 */
export function limitUsage(used: number | undefined, limit: number | undefined): number | undefined {
  if (used === undefined || limit === undefined || limit <= 0) return undefined;
  return (100 * used) / limit;
}

/**
 * Things a NATS operator would want flagged.
 *
 * Ordered worst-first. Each finding names the subject it concerns so the UI can
 * link it, and says what the number implies rather than only what it is.
 */
export function serverFindings(varz: Varz | null, connz: Connz | null, jsz: Jsz | null): Finding[] {
  const findings: Finding[] = [];

  if (varz?.slow_consumers) {
    findings.push({
      severity: "bad",
      subject: "slow consumers",
      message: `${varz.slow_consumers} slow consumer event(s). The server dropped messages for a client that could not keep up — in core NATS those messages are gone, not queued.`,
    });
  }

  const connUsage = limitUsage(varz?.connections, varz?.max_connections);
  if (connUsage !== undefined && connUsage >= 80) {
    findings.push({
      severity: connUsage >= 95 ? "bad" : "warn",
      subject: "connections",
      message: `${varz?.connections} of ${varz?.max_connections} connections in use (${connUsage.toFixed(0)}%). At the limit new clients are refused at the handshake.`,
    });
  }

  // A client with a large pending queue is the one about to become a slow consumer.
  const backedUp = (connz?.connections ?? []).filter((c) => (c.pending_bytes ?? 0) > 1024 * 1024);
  for (const c of backedUp) {
    findings.push({
      severity: "warn",
      subject: `connection ${c.cid ?? "?"}`,
      message: `${c.name || c.lang || "client"} at ${c.ip}:${c.port} has ${Math.round((c.pending_bytes ?? 0) / 1024)} KB pending. It is not reading fast enough and will be cut off at max_pending.`,
    });
  }

  const memUsage = limitUsage(jsz?.memory, jsz?.config?.max_memory ?? varz?.jetstream?.config?.max_memory);
  if (memUsage !== undefined && memUsage >= 75) {
    findings.push({
      severity: memUsage >= 90 ? "bad" : "warn",
      subject: "JetStream memory",
      message: `${memUsage.toFixed(0)}% of the JetStream memory limit is in use. Streams hit their own limits first, but the account limit rejects publishes outright.`,
    });
  }

  const storeUsage = limitUsage(jsz?.storage, jsz?.config?.max_storage ?? varz?.jetstream?.config?.max_storage);
  if (storeUsage !== undefined && storeUsage >= 75) {
    findings.push({
      severity: storeUsage >= 90 ? "bad" : "warn",
      subject: "JetStream storage",
      message: `${storeUsage.toFixed(0)}% of the JetStream storage limit is in use.`,
    });
  }

  const apiErrors = jsz?.api?.errors ?? 0;
  if (apiErrors > 0) {
    findings.push({
      severity: "warn",
      subject: "JetStream API",
      message: `${apiErrors} API error(s) out of ${jsz?.api?.total ?? 0} calls. Usually a client asking for a stream or consumer that does not exist, or exceeding a limit.`,
    });
  }

  for (const { stream } of allStreams(jsz)) {
    const cfg = stream.config;
    const state = stream.state;
    const byteUse = limitUsage(state?.bytes, cfg?.max_bytes);
    if (byteUse !== undefined && byteUse >= 85) {
      findings.push({
        severity: byteUse >= 95 ? "bad" : "warn",
        subject: `stream ${stream.name}`,
        message: `${byteUse.toFixed(0)}% of max_bytes. With discard=${cfg?.discard ?? "old"} the stream will ${cfg?.discard === "new" ? "reject new publishes" : "drop its oldest messages"} on reaching it.`,
      });
    }
    const lagging = (stream.cluster?.replicas ?? []).filter((r) => r.current === false || (r.lag ?? 0) > 0);
    for (const r of lagging) {
      findings.push({
        severity: r.current === false ? "bad" : "warn",
        subject: `stream ${stream.name}`,
        message: `Replica ${r.name} is ${r.current === false ? "not current" : `${r.lag} message(s) behind`}. A stream below quorum stops accepting writes.`,
      });
    }
  }

  for (const { stream, consumer } of allConsumers(jsz)) {
    const name = consumer.name ?? consumer.config?.durable_name ?? "(ephemeral)";
    if ((consumer.num_redelivered ?? 0) > 0) {
      findings.push({
        severity: "warn",
        subject: `consumer ${stream}/${name}`,
        message: `${consumer.num_redelivered} redelivery(ies). Either handlers are failing, or they take longer than ack_wait (${formatNanos(consumer.config?.ack_wait)}) and the message is redelivered while still being processed.`,
      });
    }
    const ackPending = consumer.num_ack_pending ?? 0;
    const maxAck = consumer.config?.max_ack_pending ?? 0;
    if (maxAck > 0 && ackPending >= maxAck) {
      findings.push({
        severity: "bad",
        subject: `consumer ${stream}/${name}`,
        message: `Unacknowledged messages have reached max_ack_pending (${maxAck}). Delivery is now stalled until something is acked.`,
      });
    }
  }

  const order: Severity[] = ["bad", "warn", "ok", "unknown"];
  return findings.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
}

/** Nanoseconds — how NATS reports durations — as something readable. */
export function formatNanos(ns: number | undefined): string {
  if (ns === undefined || ns === 0) return "—";
  const ms = ns / 1e6;
  if (ms < 1000) return `${ms.toFixed(0)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = s / 60;
  if (m < 60) return `${m.toFixed(0)} m`;
  const h = m / 60;
  return h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(0)} d`;
}

/** Byte counts as a human string. */
export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value < 10 ? 2 : 1)} ${units[i]}`;
}

/**
 * Does a NATS subject match a subscription filter?
 *
 * `*` matches exactly one token; `>` matches one or more trailing tokens and is
 * only legal as the last one. Worth having as a tested function: getting this
 * wrong is how a stream ends up capturing nothing, or everything.
 */
export function subjectMatches(filter: string, subject: string): boolean {
  if (filter === "" || subject === "") return false;
  const f = filter.split(".");
  const s = subject.split(".");
  for (let i = 0; i < f.length; i++) {
    const token = f[i];
    if (token === ">") return i < s.length; // must cover at least one token
    if (i >= s.length) return false;
    if (token !== "*" && token !== s[i]) return false;
  }
  return f.length === s.length;
}

/** Filters in this list that would capture the subject. */
export function matchingFilters(filters: string[], subject: string): string[] {
  return filters.filter((f) => subjectMatches(f, subject));
}

/**
 * Is this a legal subject to publish to?
 *
 * Wildcards are for subscribing; publishing to `a.*` sends to the literal
 * subject `a.*`, which nothing sensible is listening on. Empty tokens come from
 * a stray or doubled dot and are silently useless in the same way.
 */
export function publishSubjectProblem(subject: string): string | null {
  if (!subject.trim()) return "Subject is required.";
  if (/\s/.test(subject)) return "Subjects cannot contain whitespace.";
  const tokens = subject.split(".");
  if (tokens.some((t) => t === "")) return "Empty token — check for a leading, trailing or doubled dot.";
  if (tokens.includes("*") || tokens.includes(">")) return "Wildcards are for subscribing; a publish subject must be literal.";
  return null;
}

/** Normalize a monitoring base URL: bare host, host:port, or a full URL. */
export function monitorUrl(input: string, path: string): string {
  let base = input.trim().replace(/\/+$/, "");
  if (!base) base = "http://localhost:8222";
  if (!/^https?:\/\//i.test(base)) base = `http://${base}`;
  // A bare host with no port gets the monitoring default rather than 80.
  if (!/:\d+(\/|$)/.test(base)) base = `${base}:8222`;
  return `${base}${path}`;
}

/**
 * Extra guidance for a failed monitoring request, chosen from what was typed.
 *
 * 4222 is worth naming outright: it is the client protocol port, it speaks the
 * NATS wire protocol rather than HTTP, and no retry makes it answer JSON.
 * JetStream running changes nothing here — monitoring is a separate listener
 * that has to be enabled on its own.
 */
export function portAdvice(server: string): string {
  const port = /:(\d+)/.exec(server)?.[1];
  const named: Record<string, string> = { "4222": "client protocol", "6222": "cluster route", "7422": "leafnode" };
  if (port && named[port]) {
    return ` — ${port} is the ${named[port]} port and speaks NATS, not HTTP. The monitoring port is a separate listener, 8222 by default, enabled with -m 8222 or http_port in the config. JetStream being enabled does not enable it.`;
  }
  if (!port) return " — no port given, so 8222 was assumed. Enable monitoring with -m 8222 if it is not running.";
  return ` — check that a monitoring listener is running on ${port}. It is enabled with -m <port> or http_port, separately from the client port.`;
}

/** The same address with its port replaced by the monitoring default. */
export function withMonitorPort(server: string): string {
  const trimmed = server.trim().replace(/\/+$/, "");
  return /:\d+/.test(trimmed) ? trimmed.replace(/:(\d+)/, ":8222") : `${trimmed}:8222`;
}

/**
 * The same address with its port replaced by the client default.
 *
 * The inverse of `withMonitorPort`, and needed for the same reason: the two
 * ports are different listeners, so the address typed for one is never the
 * address for the other.
 */
export function withClientPort(server: string): string {
  const trimmed = server.trim().replace(/\/+$/, "") || "localhost";
  return /:\d+/.test(trimmed) ? trimmed.replace(/:(\d+)/, ":4222") : `${trimmed}:4222`;
}
