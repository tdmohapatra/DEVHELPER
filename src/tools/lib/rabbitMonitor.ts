/**
 * Reading a RabbitMQ broker through its management HTTP API.
 *
 * The management plugin exposes JSON on port 15672: `/api/overview` for the
 * broker, `/api/queues` for depth and consumer counts, `/api/exchanges` for the
 * routing topology, `/api/nodes` for memory, disk and file-descriptor headroom.
 * It is a separate listener from the AMQP port and a separate plugin from the
 * broker itself, which is the single most common reason it appears to be down.
 *
 * Everything here is shapes and arithmetic over that JSON, so it is testable
 * without a broker. Fields are all optional — the management API adds and moves
 * them between versions, and a queue's `arguments` are whatever the declarer set.
 */

export type Severity = "ok" | "warn" | "bad" | "unknown";

export interface Finding {
  severity: Severity;
  subject: string;
  message: string;
}

export interface QueueTotals {
  messages?: number;
  messages_ready?: number;
  messages_unacknowledged?: number;
}

export interface ObjectTotals {
  queues?: number;
  exchanges?: number;
  connections?: number;
  channels?: number;
  consumers?: number;
}

export interface RateDetail {
  rate?: number;
}

export interface MessageStats {
  publish?: number;
  publish_details?: RateDetail;
  deliver_get?: number;
  deliver_get_details?: RateDetail;
  ack?: number;
  ack_details?: RateDetail;
  redeliver?: number;
  redeliver_details?: RateDetail;
  /** Published to an exchange that routed them nowhere — silently discarded. */
  return_unroutable?: number;
  return_unroutable_details?: RateDetail;
}

export interface Overview {
  rabbitmq_version?: string;
  erlang_version?: string;
  cluster_name?: string;
  node?: string;
  management_version?: string;
  queue_totals?: QueueTotals;
  object_totals?: ObjectTotals;
  message_stats?: MessageStats;
  listeners?: { protocol?: string; port?: number; node?: string }[];
}

export interface Queue {
  name?: string;
  vhost?: string;
  state?: string;
  messages?: number;
  messages_ready?: number;
  messages_unacknowledged?: number;
  consumers?: number;
  consumer_capacity?: number;
  consumer_utilisation?: number;
  memory?: number;
  durable?: boolean;
  auto_delete?: boolean;
  exclusive?: boolean;
  node?: string;
  idle_since?: string;
  type?: string;
  /** Whatever was passed at declare time: x-dead-letter-exchange, x-message-ttl, x-max-length… */
  arguments?: Record<string, unknown>;
  message_stats?: MessageStats;
}

export interface Exchange {
  name?: string;
  vhost?: string;
  type?: string;
  durable?: boolean;
  auto_delete?: boolean;
  internal?: boolean;
}

export interface Node {
  name?: string;
  running?: boolean;
  mem_used?: number;
  mem_limit?: number;
  mem_alarm?: boolean;
  disk_free?: number;
  disk_free_limit?: number;
  disk_free_alarm?: boolean;
  fd_used?: number;
  fd_total?: number;
  sockets_used?: number;
  sockets_total?: number;
  proc_used?: number;
  proc_total?: number;
  uptime?: number;
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
 * Percentage of a limit in use, or undefined when there is no usable limit.
 *
 * A node with no memory limit configured reports 0, and dividing by it reports
 * 100% of nothing.
 */
export function limitUsage(used: number | undefined, limit: number | undefined): number | undefined {
  if (used === undefined || limit === undefined || limit <= 0) return undefined;
  return (100 * used) / limit;
}

/** The dead-letter exchange a queue was declared with, if any. */
export function deadLetterExchange(q: Queue): string | undefined {
  const v = q.arguments?.["x-dead-letter-exchange"];
  return typeof v === "string" && v ? v : undefined;
}

/** Does this queue look like a dead-letter / retry queue by name? */
export function looksLikeDeadLetter(name: string | undefined): boolean {
  return /(^|[._-])(dlq|dlx|dead[._-]?letter|error|poison|retry)([._-]|$)/i.test(name ?? "");
}

/**
 * Things a RabbitMQ operator would want flagged, worst first.
 *
 * The recurring theme is that RabbitMQ discards quietly: an unroutable publish
 * vanishes, a queue nobody consumes grows until it hits a limit and then drops
 * messages, and a broker in flow control slows publishers rather than erroring.
 * None of those raise an exception on the client, so they have to be looked for.
 */
export function brokerFindings(overview: Overview | null, queues: Queue[], nodes: Node[]): Finding[] {
  const findings: Finding[] = [];

  for (const n of nodes) {
    const name = n.name ?? "node";
    if (n.running === false) {
      findings.push({ severity: "bad", subject: name, message: "Node is not running. Queues homed on it are unavailable, not merely empty." });
    }
    if (n.mem_alarm) {
      findings.push({
        severity: "bad",
        subject: name,
        message: `Memory alarm is on (${formatBytes(n.mem_used)} of ${formatBytes(n.mem_limit)}). Every publisher on this node is blocked until it clears.`,
      });
    }
    if (n.disk_free_alarm) {
      findings.push({
        severity: "bad",
        subject: name,
        message: `Disk free alarm is on (${formatBytes(n.disk_free)} left, limit ${formatBytes(n.disk_free_limit)}). Publishers are blocked until space is reclaimed.`,
      });
    }
    const mem = limitUsage(n.mem_used, n.mem_limit);
    if (!n.mem_alarm && mem !== undefined && mem >= 80) {
      findings.push({
        severity: mem >= 90 ? "bad" : "warn",
        subject: name,
        message: `${mem.toFixed(0)}% of the memory watermark in use. At 100% the broker blocks publishers rather than rejecting them, so clients hang instead of failing.`,
      });
    }
    const fd = limitUsage(n.fd_used, n.fd_total);
    if (fd !== undefined && fd >= 80) {
      findings.push({
        severity: fd >= 90 ? "bad" : "warn",
        subject: name,
        message: `${fd.toFixed(0)}% of file descriptors in use (${n.fd_used} of ${n.fd_total}). New connections are refused at the limit.`,
      });
    }
  }

  for (const q of queues) {
    const name = `${q.name ?? "(unnamed)"}${q.vhost && q.vhost !== "/" ? ` @${q.vhost}` : ""}`;
    const depth = q.messages ?? 0;
    const unacked = q.messages_unacknowledged ?? 0;
    const consumers = q.consumers ?? 0;

    if (q.state === "flow") {
      findings.push({
        severity: "warn",
        subject: name,
        message: "Queue is in flow control — the broker is deliberately slowing its publishers because it cannot keep up.",
      });
    }
    if (depth > 0 && consumers === 0) {
      findings.push({
        severity: depth >= 1000 ? "bad" : "warn",
        subject: name,
        message: `${depth.toLocaleString()} message(s) with no consumer. Nothing is reading this queue; it grows until a length or TTL limit drops the oldest.`,
      });
    }
    if (unacked > 0 && consumers > 0 && unacked === depth) {
      findings.push({
        severity: "warn",
        subject: name,
        message: `All ${unacked.toLocaleString()} message(s) are delivered but unacknowledged. A consumer took them and has not acked — usually a handler that is stuck, or one that never calls ack.`,
      });
    }
    const redeliverRate = q.message_stats?.redeliver_details?.rate ?? 0;
    if (redeliverRate > 0) {
      findings.push({
        severity: "warn",
        subject: name,
        message: `Redelivering ${redeliverRate.toFixed(1)}/s. Messages are being nacked or the channel is closing before ack — without a dead-letter exchange this loops forever.`,
      });
    }
    if (looksLikeDeadLetter(q.name) && depth > 0) {
      findings.push({
        severity: depth >= 100 ? "bad" : "warn",
        subject: name,
        message: `${depth.toLocaleString()} message(s) sitting in what looks like a dead-letter queue. These already failed once and nothing is draining them.`,
      });
    }
    if (!deadLetterExchange(q) && depth > 0 && !looksLikeDeadLetter(q.name)) {
      const limited = q.arguments?.["x-max-length"] ?? q.arguments?.["x-max-length-bytes"] ?? q.arguments?.["x-message-ttl"];
      if (limited !== undefined) {
        findings.push({
          severity: "warn",
          subject: name,
          message: "Has a length or TTL limit but no x-dead-letter-exchange. Messages dropped at the limit are discarded with no record of them.",
        });
      }
    }
  }

  const unroutable = overview?.message_stats?.return_unroutable_details?.rate ?? 0;
  if (unroutable > 0) {
    findings.push({
      severity: "warn",
      subject: "routing",
      message: `${unroutable.toFixed(1)} unroutable publish(es)/s. Messages are reaching an exchange that matches no binding and are being discarded — publishers see success either way unless they set mandatory.`,
    });
  }

  const order: Severity[] = ["bad", "warn", "ok", "unknown"];
  return findings.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
}

/** Normalize a management address: bare host, host:port, or a full URL. */
export function mgmtUrl(input: string, path: string): string {
  let base = input.trim().replace(/\/+$/, "");
  if (!base) base = "http://localhost:15672";
  if (!/^https?:\/\//i.test(base)) base = `http://${base}`;
  // A bare host with no port gets the management default rather than 80.
  if (!/:\d+(\/|$)/.test(base)) base = `${base}:15672`;
  return `${base}/api${path}`;
}

/**
 * Extra guidance for a failed management request, chosen from what was typed.
 *
 * 5672 is worth naming outright: it is the AMQP port, it speaks a binary frame
 * protocol rather than HTTP, and no retry makes it answer JSON. Even on the
 * right port the API only exists if the management plugin is enabled — the
 * broker runs perfectly well without it.
 */
export function mgmtPortAdvice(server: string): string {
  const port = /:(\d+)/.exec(server.trim())?.[1];
  const named: Record<string, string> = {
    "5672": "AMQP client",
    "5671": "AMQP over TLS",
    "25672": "inter-node clustering",
    "1883": "MQTT",
    "61613": "STOMP",
  };
  if (port && named[port]) {
    return ` — ${port} is the ${named[port]} port and does not speak HTTP. The management API is a separate listener, 15672 by default, and only exists once the plugin is on: rabbitmq-plugins enable rabbitmq_management.`;
  }
  if (!port) return " — no port given, so 15672 was assumed. Enable the API with rabbitmq-plugins enable rabbitmq_management if it is not running.";
  return ` — check that the management plugin is listening on ${port}. It is enabled separately from the broker with rabbitmq-plugins enable rabbitmq_management.`;
}

/** The same address with its port replaced by the management default. */
export function withMgmtPort(server: string): string {
  const trimmed = server.trim().replace(/\/+$/, "");
  return /:\d+/.test(trimmed) ? trimmed.replace(/:(\d+)/, ":15672") : `${trimmed}:15672`;
}

/**
 * Is this a legal routing key to publish with?
 *
 * Publishing to the default exchange routes by exact queue name, so a key with
 * topic wildcards in it addresses a queue literally named `a.*` — which almost
 * never exists, and the message is discarded unroutable.
 */
export function routingKeyProblem(key: string, exchangeType: string): string | null {
  if (!key.trim()) return "Routing key is required — the default exchange routes by exact queue name.";
  if (/\s/.test(key)) return "Routing keys cannot contain whitespace.";
  if (key.length > 255) return "Routing keys are limited to 255 bytes.";
  if (exchangeType !== "topic" && /[*#]/.test(key)) {
    return `Wildcards only mean something on a topic exchange; on a ${exchangeType} exchange this is matched literally and will not route.`;
  }
  return null;
}

export interface PeekedMessage {
  payload?: string;
  payload_bytes?: number;
  payload_encoding?: string;
  routing_key?: string;
  redelivered?: boolean;
  exchange?: string;
  message_count?: number;
  properties?: {
    headers?: Record<string, unknown>;
    content_type?: string;
    correlation_id?: string;
    message_id?: string;
    timestamp?: number;
    delivery_mode?: number;
    priority?: number;
    reply_to?: string;
    expiration?: string;
  };
}

/**
 * How a peek should treat the messages it reads.
 *
 * `reject_requeue_true` puts them back, which is what inspection means and the
 * only mode this tool offers by default. The others exist in the API and are
 * destructive: `ack_requeue_false` removes the message permanently.
 */
export type PeekMode = "reject_requeue_true" | "ack_requeue_false";

/** Request body for the management API's queue `get`. */
export function peekBody(count: number, mode: PeekMode): string {
  return JSON.stringify({
    count: Math.max(1, Math.min(count, 50)),
    ackmode: mode,
    encoding: "auto",
    // Long payloads are truncated server-side rather than pulled in whole.
    truncate: 50000,
  });
}

/**
 * What a peek does to the queue, in words.
 *
 * Worth stating on screen every time: the difference between the two modes is
 * whether the messages still exist afterwards, and the API's own naming does
 * not make that obvious.
 */
export function peekWarning(mode: PeekMode): string {
  return mode === "reject_requeue_true"
    ? "Messages are put back. They briefly leave the queue and return marked as redelivered, and their position is not guaranteed."
    : "Messages are removed permanently. There is no undo, and nothing else will ever receive them.";
}

/**
 * Decode a peeked payload.
 *
 * The API returns base64 when the body is not valid UTF-8, and says which via
 * `payload_encoding`. Rendering base64 as though it were text is how a protobuf
 * body ends up looking like corruption.
 */
export function decodePayload(message: PeekedMessage): { text: string; binary: boolean } {
  const raw = message.payload ?? "";
  if (message.payload_encoding !== "base64") return { text: raw, binary: false };
  try {
    const decoded = atob(raw);
    // Still shown as binary: it decoded, but it was not sent as text.
    return { text: decoded, binary: true };
  } catch {
    return { text: `<${message.payload_bytes ?? 0} bytes, base64>`, binary: true };
  }
}

/** Queues ordered by how much attention they need: depth first, then unacked. */
export function sortQueuesByAttention(queues: Queue[]): Queue[] {
  return [...queues].sort((a, b) => {
    const idle = (q: Queue) => ((q.messages ?? 0) > 0 && (q.consumers ?? 0) === 0 ? 1 : 0);
    return (
      idle(b) - idle(a) ||
      (b.messages ?? 0) - (a.messages ?? 0) ||
      (b.messages_unacknowledged ?? 0) - (a.messages_unacknowledged ?? 0) ||
      (a.name ?? "").localeCompare(b.name ?? "")
    );
  });
}
