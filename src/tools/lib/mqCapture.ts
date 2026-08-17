/**
 * Turning a broker's current state into a Debug Session event.
 *
 * The messaging tools are point-in-time views: you look at Redis, or NATS, or
 * RabbitMQ, and the numbers are whatever they are right now. A distributed
 * failure is the opposite — it is a sequence, and the broker's state at the
 * moment of the failure is one entry in it. These builders snapshot what a tool
 * is showing into a `ParsedEvent` so it can sit on the timeline next to the API
 * call and the database query it belongs with.
 *
 * A snapshot's status is the worst thing in it: one bad finding makes the whole
 * event an error, because that is what a reader scanning the timeline needs to
 * see. The findings themselves go into `error` (when something is wrong) or
 * `payload` (when nothing is), which is how the Debug Session and the AI context
 * builder already distinguish the two.
 */

import type { DebugStatus, ParsedEvent } from "./debugSession";

/** The severity vocabulary shared by redisInfo, natsMonitor and rabbitMonitor. */
export type OpsSeverity = "ok" | "warn" | "bad" | "unknown";

export interface OpsFinding {
  severity: OpsSeverity;
  subject: string;
  message: string;
}

/** Map a broker severity onto a timeline status. */
export function severityStatus(severity: OpsSeverity): DebugStatus {
  if (severity === "bad") return "error";
  if (severity === "warn") return "warn";
  if (severity === "ok") return "ok";
  return "info";
}

const RANK: Record<OpsSeverity, number> = { bad: 3, warn: 2, unknown: 1, ok: 0 };

/** The worst severity present, or `ok` when there is nothing to report. */
export function worstSeverity(findings: { severity: OpsSeverity }[]): OpsSeverity {
  return findings.reduce<OpsSeverity>((worst, f) => (RANK[f.severity] > RANK[worst] ? f.severity : worst), "ok");
}

/** Findings as `subject: message` lines, worst first. */
export function findingLines(findings: OpsFinding[]): string {
  const order: OpsSeverity[] = ["bad", "warn", "unknown", "ok"];
  return [...findings]
    .sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity))
    .map((f) => `${f.subject}: ${f.message}`)
    .join("\n");
}

/** Short "3 problems, 1 warning" style summary, or "healthy". */
export function findingSummary(findings: { severity: OpsSeverity }[]): string {
  const bad = findings.filter((f) => f.severity === "bad").length;
  const warn = findings.filter((f) => f.severity === "warn").length;
  if (!bad && !warn) return "healthy";
  const parts = [bad && `${bad} problem${bad === 1 ? "" : "s"}`, warn && `${warn} warning${warn === 1 ? "" : "s"}`];
  return parts.filter(Boolean).join(", ");
}

/** Shared shape: a snapshot of one broker, described by its findings. */
function snapshotEvent(
  source: ParsedEvent["source"],
  target: string,
  headline: string,
  findings: OpsFinding[],
  facts: Record<string, unknown>,
): ParsedEvent {
  const severity = worstSeverity(findings);
  const status = severityStatus(severity);
  const lines = findingLines(findings);
  return {
    source,
    status,
    service: target,
    title: `${headline} — ${findingSummary(findings)}`,
    // A healthy snapshot still carries its numbers; a failing one leads with why.
    error: status === "error" || status === "warn" ? lines : undefined,
    payload: JSON.stringify({ target, ...facts, findings: findings.length }),
  };
}

export interface RedisSnapshot {
  target: string;
  version?: string;
  /** `healthMetrics()` output — id/label/value/severity/detail. */
  metrics: { id: string; label: string; value: string; severity: OpsSeverity; detail: string }[];
  keys?: number;
  clients?: number;
}

/** Capture the Redis health view: every metric that is not ok becomes a finding. */
export function redisHealthEvent(s: RedisSnapshot): ParsedEvent {
  const findings: OpsFinding[] = s.metrics
    .filter((m) => m.severity === "warn" || m.severity === "bad")
    .map((m) => ({ severity: m.severity, subject: m.label, message: `${m.value} — ${m.detail}` }));
  return snapshotEvent("redis", s.target, `Redis ${s.version ? `v${s.version} ` : ""}health`, findings, {
    version: s.version,
    keys: s.keys,
    clients: s.clients,
    metrics: s.metrics.map((m) => `${m.label}=${m.value}`),
  });
}

/** Capture one Redis console command and its reply — the ad-hoc half of the tool. */
export function redisCommandEvent(target: string, command: string, reply: string, ok: boolean): ParsedEvent {
  return {
    source: "redis",
    status: ok ? "ok" : "error",
    service: target,
    title: `Redis ${command}${ok ? "" : " → failed"}`,
    error: ok ? undefined : reply.slice(0, 800),
    payload: JSON.stringify({ target, command, reply: reply.slice(0, 2000) }),
  };
}

export interface NatsSnapshot {
  target: string;
  serverName?: string;
  version?: string;
  connections?: number;
  slowConsumers?: number;
  streams?: number;
  consumers?: number;
  findings: OpsFinding[];
}

/** Capture the NATS server view, findings and all. */
export function natsServerEvent(s: NatsSnapshot): ParsedEvent {
  return snapshotEvent("nats", s.serverName || s.target, `NATS ${s.version ? `v${s.version} ` : ""}server`, s.findings, {
    server: s.serverName,
    version: s.version,
    connections: s.connections,
    slowConsumers: s.slowConsumers,
    streams: s.streams,
    consumers: s.consumers,
  });
}

export interface RabbitSnapshot {
  target: string;
  version?: string;
  cluster?: string;
  queues?: number;
  /** Total depth across every queue — the number that matters when a flow stalls. */
  messages?: number;
  unacked?: number;
  consumers?: number;
  findings: OpsFinding[];
}

/** Capture the RabbitMQ broker view. */
export function rabbitBrokerEvent(s: RabbitSnapshot): ParsedEvent {
  return snapshotEvent("rabbitmq", s.cluster || s.target, `RabbitMQ ${s.version ? `v${s.version} ` : ""}broker`, s.findings, {
    version: s.version,
    cluster: s.cluster,
    queues: s.queues,
    messages: s.messages,
    unacked: s.unacked,
    consumers: s.consumers,
  });
}

/** Capture a single publish — the one thing the RabbitMQ tool does that changes state. */
export function rabbitPublishEvent(target: string, routingKey: string, ok: boolean, detail?: string): ParsedEvent {
  return {
    source: "rabbitmq",
    status: ok ? "ok" : "error",
    service: target,
    title: `Publish → ${routingKey}${ok ? "" : " failed"}`,
    error: ok ? undefined : detail?.slice(0, 800),
    payload: JSON.stringify({ target, routingKey, body: detail?.slice(0, 1000) }),
  };
}

export interface ServiceBusSnapshot {
  /** The namespace host, which is what identifies it in a timeline. */
  target: string;
  queues?: number;
  topics?: number;
  subscriptions?: number;
  active?: number;
  /** Dead-lettered plus transfer dead-lettered — the number an incident turns on. */
  deadLettered?: number;
  findings: OpsFinding[];
}

/** Capture the Service Bus namespace view. */
export function serviceBusNamespaceEvent(s: ServiceBusSnapshot): ParsedEvent {
  return snapshotEvent("servicebus", s.target, "Service Bus namespace", s.findings, {
    queues: s.queues,
    topics: s.topics,
    subscriptions: s.subscriptions,
    active: s.active,
    deadLettered: s.deadLettered,
  });
}

/**
 * Capture one peeked message.
 *
 * A dead-lettered message is captured as an error even though the peek itself
 * succeeded: on a timeline, "this is the message that failed" is the event, and
 * the reason the broker recorded is the closest thing to a stack trace there is.
 */
export function serviceBusMessageEvent(
  target: string,
  entity: string,
  message: { properties: Record<string, unknown>; body: string },
  deadLetter: boolean,
): ParsedEvent {
  const props = message.properties;
  const reason = typeof props.DeadLetterReason === "string" ? props.DeadLetterReason : undefined;
  const description = typeof props.DeadLetterErrorDescription === "string" ? props.DeadLetterErrorDescription : undefined;
  return {
    source: "servicebus",
    status: deadLetter ? "error" : "info",
    service: entity,
    title: `${deadLetter ? "Dead-lettered" : "Message"} on ${entity}${reason ? ` — ${reason}` : ""}`,
    correlationId: typeof props.CorrelationId === "string" ? props.CorrelationId : undefined,
    error: deadLetter ? [reason, description].filter(Boolean).join(": ").slice(0, 800) || "Dead-lettered with no reason recorded." : undefined,
    payload: JSON.stringify({ target, entity, properties: props, body: message.body.slice(0, 2000) }),
  };
}

/** Capture a single send — the one thing the Service Bus tool does that changes state. */
export function serviceBusSendEvent(target: string, entity: string, ok: boolean, detail?: string): ParsedEvent {
  return {
    source: "servicebus",
    status: ok ? "ok" : "error",
    service: entity,
    title: `Send → ${entity}${ok ? "" : " failed"}`,
    error: ok ? undefined : detail?.slice(0, 800),
    payload: JSON.stringify({ target, entity, body: detail?.slice(0, 1000) }),
  };
}

/**
 * Capture a connection that never came up.
 *
 * Worth its own builder: "could not reach the broker at all" and "the broker is
 * unhealthy" look identical on a timeline unless the first one says so.
 */
export function brokerUnreachableEvent(
  source: ParsedEvent["source"],
  target: string,
  reason: string,
): ParsedEvent {
  return {
    source,
    status: "error",
    service: target,
    title: `${target} unreachable`,
    error: reason.slice(0, 800),
    payload: JSON.stringify({ target, reason }),
  };
}
