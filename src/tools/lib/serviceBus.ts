/**
 * Reading an Azure Service Bus namespace through its REST API.
 *
 * Service Bus has no management plugin to enable and no broker port to get
 * wrong: everything here is HTTPS against `https://{namespace}.servicebus.
 * windows.net`, authenticated with a SAS token computed from a shared access
 * key. That is the one credential a developer already has — it is the second
 * half of every connection string in every appsettings file — so this tool asks
 * for a connection string and nothing else.
 *
 * Two things about the REST surface shape everything below.
 *
 * The *management* half returns Atom XML, not JSON. `$Resources/Queues`,
 * `$Resources/Topics` and `{topic}/Subscriptions` each return a feed whose
 * entries carry a `QueueDescription` / `TopicDescription` /
 * `SubscriptionDescription` with the settings and, crucially, a `CountDetails`
 * block: active, dead-lettered, scheduled, and the two transfer counts. Those
 * five numbers are the whole operational picture.
 *
 * The *runtime* half has no browse. AMQP clients can peek a queue without
 * touching it; REST cannot. The nearest thing is peek-lock — `POST
 * {entity}/messages/head` — which returns the message at the head AND locks it
 * for the lock duration. Reading ten messages means locking ten in a row and
 * unlocking each afterwards. Anything not unlocked stays invisible to the real
 * consumer until its lock expires, so unlocking is not optional politeness.
 *
 * Everything in this file is pure over strings, so it is testable without a
 * namespace. The one exception is `sasToken`, which needs WebCrypto to HMAC.
 */

import type { OpsFinding, OpsSeverity } from "./mqCapture";

export type Severity = OpsSeverity;
export type Finding = OpsFinding;

/** The API version the management endpoints are addressed with. */
export const API_VERSION = "2017-04";

// ---------------------------------------------------------------------------
// Connection strings
// ---------------------------------------------------------------------------

export interface ServiceBusConnection {
  /** `https://ns.servicebus.windows.net` — normalised from the sb:// endpoint. */
  endpoint: string;
  /** Namespace host, e.g. `ns.servicebus.windows.net`. */
  host: string;
  /** Short namespace name, e.g. `ns`. */
  namespace: string;
  keyName: string;
  key: string;
  /** Present when the string was scoped to one entity. */
  entityPath?: string;
}

export class ConnectionStringError extends Error {}

/**
 * Parse a Service Bus connection string.
 *
 * The portal hands out four shapes of these and they are easy to confuse:
 * a namespace-level string (RootManageSharedAccessKey), an entity-level string
 * with `EntityPath`, an Event Hubs string that looks identical, and a
 * `SharedAccessSignature=` string that carries an already-signed token instead
 * of a key. The last cannot be re-signed for a different resource, so it is
 * rejected by name rather than failing later as a 401.
 */
export function parseConnectionString(raw: string): ServiceBusConnection {
  const text = raw.trim();
  if (!text) throw new ConnectionStringError("Paste a connection string from the portal: Shared access policies → your policy → Primary Connection String.");

  const parts: Record<string, string> = {};
  for (const segment of text.split(";")) {
    const at = segment.indexOf("=");
    if (at <= 0) continue;
    // Keys contain no "=", but the base64 key value certainly does — split once.
    const name = segment.slice(0, at).trim().toLowerCase();
    parts[name] = segment.slice(at + 1).trim();
  }

  if (parts["sharedaccesssignature"]) {
    throw new ConnectionStringError(
      "This string carries an already-signed SAS token, not a key. A signed token is bound to one resource and cannot be re-signed for another entity — use a policy string with SharedAccessKey= in it.",
    );
  }

  const endpoint = parts["endpoint"];
  if (!endpoint) throw new ConnectionStringError("No Endpoint= in the string. It should start with Endpoint=sb://<namespace>.servicebus.windows.net/.");

  const keyName = parts["sharedaccesskeyname"];
  const key = parts["sharedaccesskey"];
  if (!keyName) throw new ConnectionStringError("No SharedAccessKeyName= in the string.");
  if (!key) throw new ConnectionStringError("No SharedAccessKey= in the string.");

  const host = endpoint
    .replace(/^sb:\/\//i, "")
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
  if (!host) throw new ConnectionStringError("The Endpoint= has no host in it.");

  return {
    endpoint: `https://${host}`,
    host,
    namespace: host.split(".")[0] ?? host,
    keyName,
    key,
    entityPath: parts["entitypath"] || undefined,
  };
}

/**
 * What the endpoint host says about which service this string is for.
 *
 * Event Hubs and Relay connection strings are the same format on a different
 * suffix, and pasting one here produces a namespace with no queues rather than
 * an error — which reads as "my queues disappeared".
 */
export function endpointWarning(host: string): string | null {
  const lower = host.toLowerCase();
  if (/\.servicebus\.windows\.net$/.test(lower)) return null;
  if (/\.servicebus\.(chinacloudapi\.cn|usgovcloudapi\.net|cloudapi\.de)$/.test(lower)) return null;
  if (/\.azure-devices\.net$/.test(lower)) {
    return "That is an IoT Hub connection string. IoT Hub has a built-in Event Hub endpoint, not Service Bus queues.";
  }
  return `Endpoint host is ${host}, which is not a *.servicebus.windows.net namespace. Event Hubs and Relay strings look identical to this one and will authenticate, but will list no queues.`;
}

// ---------------------------------------------------------------------------
// SAS tokens
// ---------------------------------------------------------------------------

/** Percent-encode for a SAS resource URI: encodeURIComponent, but `!'()*` too. */
function strictEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** The exact string a SAS signature is computed over. Split out so it is testable. */
export function sasStringToSign(resourceUri: string, expirySeconds: number): string {
  return `${strictEncode(resourceUri)}\n${expirySeconds}`;
}

/** Assemble the Authorization header value from an already-computed signature. */
export function sasHeader(resourceUri: string, signature: string, expirySeconds: number, keyName: string): string {
  return (
    `SharedAccessSignature sr=${strictEncode(resourceUri)}` +
    `&sig=${strictEncode(signature)}` +
    `&se=${expirySeconds}` +
    `&skn=${strictEncode(keyName)}`
  );
}

/**
 * Sign a SAS token for a resource.
 *
 * `nowMs` is a parameter rather than a call to `Date.now()` so the expiry is
 * assertable. The signature covers the resource URI, so a token minted for the
 * namespace root works for every entity beneath it — which is why this signs
 * the root by default and not each entity in turn.
 *
 * The token is only as safe as where it goes: it is sent to Azure over TLS and
 * never stored. Anything that logs it has logged a bearer credential valid
 * until `expiry`.
 */
export async function sasToken(
  conn: Pick<ServiceBusConnection, "endpoint" | "keyName" | "key">,
  ttlSeconds = 3600,
  nowMs = Date.now(),
): Promise<string> {
  const expiry = Math.floor(nowMs / 1000) + Math.max(60, ttlSeconds);
  const toSign = sasStringToSign(conn.endpoint, expiry);

  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("WebCrypto is unavailable, so a SAS token cannot be signed here.");

  const encoder = new TextEncoder();
  const cryptoKey = await subtle.importKey("raw", encoder.encode(conn.key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await subtle.sign("HMAC", cryptoKey, encoder.encode(toSign));

  let binary = "";
  for (const byte of new Uint8Array(mac)) binary += String.fromCharCode(byte);
  return sasHeader(conn.endpoint, btoa(binary), expiry, conn.keyName);
}

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

/** Path-encode an entity name, keeping the `/` that separates topic from subscription. */
function encodePath(entity: string): string {
  return entity
    .split("/")
    .filter(Boolean)
    .map((s) => encodeURIComponent(s))
    .join("/");
}

/** A management (Atom XML) URL under the namespace. */
export function managementUrl(conn: Pick<ServiceBusConnection, "endpoint">, path: string): string {
  const clean = path.replace(/^\/+/, "");
  return `${conn.endpoint}/${clean}${clean.includes("?") ? "&" : "?"}api-version=${API_VERSION}`;
}

export const queuesUrl = (conn: Pick<ServiceBusConnection, "endpoint">) => managementUrl(conn, "$Resources/Queues");
export const topicsUrl = (conn: Pick<ServiceBusConnection, "endpoint">) => managementUrl(conn, "$Resources/Topics");
export const subscriptionsUrl = (conn: Pick<ServiceBusConnection, "endpoint">, topic: string) =>
  managementUrl(conn, `${encodePath(topic)}/Subscriptions`);

/**
 * The runtime path for an entity, optionally its dead-letter sub-queue.
 *
 * A subscription's dead-letter queue is `{topic}/Subscriptions/{sub}/
 * $deadletterqueue` — note that `$DeadLetterQueue` hangs off the subscription,
 * not off the topic, because a topic has no messages of its own.
 */
export function entityPath(entity: string, deadLetter = false): string {
  return `${encodePath(entity)}${deadLetter ? "/$deadletterqueue" : ""}`;
}

/** `POST` here to peek-lock the message at the head of an entity. */
export function peekLockUrl(conn: Pick<ServiceBusConnection, "endpoint">, entity: string, deadLetter = false, timeoutSeconds = 5): string {
  return `${conn.endpoint}/${entityPath(entity, deadLetter)}/messages/head?timeout=${Math.max(1, Math.min(timeoutSeconds, 55))}`;
}

/** `POST` here to send a message to an entity. */
export function sendUrl(conn: Pick<ServiceBusConnection, "endpoint">, entity: string): string {
  return `${conn.endpoint}/${entityPath(entity)}/messages`;
}

// ---------------------------------------------------------------------------
// Atom XML → descriptions
// ---------------------------------------------------------------------------

export interface CountDetails {
  active: number;
  deadLetter: number;
  scheduled: number;
  transfer: number;
  transferDeadLetter: number;
}

export interface EntityDescription {
  name: string;
  kind: "queue" | "topic" | "subscription";
  /** Present on subscriptions: the topic they belong to. */
  topic?: string;
  status?: string;
  counts: CountDetails;
  /** Queue/subscription total, or a topic's stored bytes. */
  sizeBytes?: number;
  maxSizeMb?: number;
  maxDeliveryCount?: number;
  lockDurationSeconds?: number;
  defaultTtlSeconds?: number;
  autoDeleteOnIdleSeconds?: number;
  requiresSession?: boolean;
  requiresDuplicateDetection?: boolean;
  deadLetterOnExpiration?: boolean;
  enablePartitioning?: boolean;
  forwardTo?: string;
  subscriptionCount?: number;
  createdAt?: string;
  updatedAt?: string;
  accessedAt?: string;
}

const EMPTY_COUNTS: CountDetails = { active: 0, deadLetter: 0, scheduled: 0, transfer: 0, transferDeadLetter: 0 };

/** Text of the first descendant with this local name, ignoring namespace prefixes. */
function childText(parent: Element, localName: string): string | undefined {
  for (const el of Array.from(parent.getElementsByTagName("*"))) {
    if (el.localName === localName) return el.textContent?.trim() ?? undefined;
  }
  return undefined;
}

function num(parent: Element, localName: string): number | undefined {
  const text = childText(parent, localName);
  if (text === undefined || text === "") return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

function bool(parent: Element, localName: string): boolean | undefined {
  const text = childText(parent, localName)?.toLowerCase();
  if (text === "true") return true;
  if (text === "false") return false;
  return undefined;
}

/**
 * Parse an ISO-8601 duration into seconds.
 *
 * Every timespan in a Service Bus description is one of these: `PT1M` for a
 * lock, `P14D` for a TTL, and `P10675199DT2H48M5.4775807S` — `TimeSpan.MaxValue`
 * — for "no limit at all", which is what an unset TTL looks like on the wire.
 */
export function parseDuration(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const m = /^P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value.trim());
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s] = m;
  const seconds =
    Number(y ?? 0) * 31557600 + Number(mo ?? 0) * 2629800 + Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(mi ?? 0) * 60 + Number(s ?? 0);
  return Number.isFinite(seconds) ? seconds : undefined;
}

/** True when a duration is Service Bus's "effectively infinite" TimeSpan.MaxValue. */
export function isUnlimitedDuration(seconds: number | undefined): boolean {
  return seconds !== undefined && seconds >= 86400 * 3650;
}

function duration(parent: Element, localName: string): number | undefined {
  return parseDuration(childText(parent, localName));
}

function countsFrom(entry: Element): CountDetails {
  const details = Array.from(entry.getElementsByTagName("*")).find((el) => el.localName === "CountDetails");
  if (!details) return { ...EMPTY_COUNTS };
  return {
    active: num(details, "ActiveMessageCount") ?? 0,
    deadLetter: num(details, "DeadLetterMessageCount") ?? 0,
    scheduled: num(details, "ScheduledMessageCount") ?? 0,
    transfer: num(details, "TransferMessageCount") ?? 0,
    transferDeadLetter: num(details, "TransferDeadLetterMessageCount") ?? 0,
  };
}

/**
 * Entity names out of an Atom feed.
 *
 * `<title>` is the entity name for queues and topics. For subscriptions the
 * title is the subscription name alone, so the topic has to be supplied by the
 * caller — the feed does not repeat it in a place worth trusting.
 */
export function parseFeed(xml: string, kind: EntityDescription["kind"], topic?: string): EntityDescription[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) return [];

  const out: EntityDescription[] = [];
  for (const entry of Array.from(doc.getElementsByTagName("*")).filter((el) => el.localName === "entry")) {
    const name = Array.from(entry.getElementsByTagName("*")).find((el) => el.localName === "title")?.textContent?.trim();
    if (!name) continue;

    const item: EntityDescription = {
      name,
      kind,
      topic,
      status: childText(entry, "Status"),
      counts: countsFrom(entry),
      sizeBytes: num(entry, "SizeInBytes"),
      maxSizeMb: num(entry, "MaxSizeInMegabytes"),
      maxDeliveryCount: num(entry, "MaxDeliveryCount"),
      lockDurationSeconds: duration(entry, "LockDuration"),
      defaultTtlSeconds: duration(entry, "DefaultMessageTimeToLive"),
      autoDeleteOnIdleSeconds: duration(entry, "AutoDeleteOnIdle"),
      requiresSession: bool(entry, "RequiresSession"),
      requiresDuplicateDetection: bool(entry, "RequiresDuplicateDetection"),
      deadLetterOnExpiration: bool(entry, "DeadLetteringOnMessageExpiration"),
      enablePartitioning: bool(entry, "EnablePartitioning"),
      forwardTo: childText(entry, "ForwardTo") || undefined,
      subscriptionCount: num(entry, "SubscriptionCount"),
      createdAt: childText(entry, "CreatedAt"),
      updatedAt: childText(entry, "UpdatedAt"),
      accessedAt: childText(entry, "AccessedAt"),
    };
    out.push(item);
  }
  return out;
}

/** A queue or subscription's full name for display: `topic/sub` or `queue`. */
export function displayName(entity: Pick<EntityDescription, "name" | "topic">): string {
  return entity.topic ? `${entity.topic}/${entity.name}` : entity.name;
}

/** The runtime path of an entity — subscriptions need the `/Subscriptions/` infix. */
export function runtimePath(entity: Pick<EntityDescription, "name" | "topic" | "kind">): string {
  return entity.kind === "subscription" && entity.topic ? `${entity.topic}/Subscriptions/${entity.name}` : entity.name;
}

/** Every message the entity is holding, in any state. */
export function totalMessages(counts: CountDetails): number {
  return counts.active + counts.deadLetter + counts.scheduled + counts.transfer + counts.transferDeadLetter;
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

function humanDuration(seconds: number | undefined): string {
  if (seconds === undefined) return "—";
  if (isUnlimitedDuration(seconds)) return "unlimited";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
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

const SEVERITY_ORDER: Severity[] = ["bad", "warn", "unknown", "ok"];

/**
 * What a Service Bus operator would want flagged, worst first.
 *
 * The failure modes are different from RabbitMQ's. Service Bus does not discard
 * quietly — it dead-letters, which means the message still exists and is
 * costing quota while being invisible to the consumer. The recurring shape of
 * an incident is therefore: something dead-lettered, nobody looked, and the
 * entity filled to its size quota, at which point *sends start failing* with
 * QuotaExceededException even though the consumer is healthy.
 *
 * Transfer dead-letters get their own line because they are genuinely obscure:
 * a message forwarded to an entity that no longer exists, or that the sender
 * has no rights on, lands in the *source's* transfer DLQ, so it is missing from
 * both ends of the hop the operator is looking at.
 */
export function entityFindings(entities: EntityDescription[]): Finding[] {
  const findings: Finding[] = [];

  for (const e of entities) {
    const subject = displayName(e);
    const c = e.counts;

    if (e.status && e.status !== "Active") {
      const disabled = /Disabled|ReceiveDisabled|SendDisabled/i.test(e.status);
      findings.push({
        severity: disabled ? "bad" : "warn",
        subject,
        message:
          e.status === "ReceiveDisabled"
            ? "Status is ReceiveDisabled — senders still succeed and the entity keeps filling, but nothing can be received. This is the state that looks like a stuck consumer."
            : e.status === "SendDisabled"
              ? "Status is SendDisabled — every send fails while the existing backlog can still be drained."
              : `Status is ${e.status}, not Active.`,
      });
    }

    if (c.deadLetter > 0) {
      findings.push({
        severity: c.deadLetter >= 100 ? "bad" : "warn",
        subject,
        message: `${c.deadLetter.toLocaleString()} dead-lettered message(s). These already failed ${e.maxDeliveryCount ?? 10} deliveries or expired; they still count against the entity's size quota and nothing will retry them until something reads the $deadletterqueue.`,
      });
    }

    if (c.transferDeadLetter > 0) {
      findings.push({
        severity: "bad",
        subject,
        message: `${c.transferDeadLetter.toLocaleString()} message(s) in the transfer dead-letter queue. A forward or auto-forward could not complete — usually the destination was deleted, is full, or the sending policy has no rights on it. They are not in the destination and not in this entity's own DLQ.`,
      });
    }

    if (c.transfer > 0) {
      findings.push({
        severity: "warn",
        subject,
        message: `${c.transfer.toLocaleString()} message(s) pending transfer to a forwarded destination. A steady non-zero count means the hop is not keeping up.`,
      });
    }

    if (c.scheduled > 0) {
      findings.push({
        severity: "unknown",
        subject,
        message: `${c.scheduled.toLocaleString()} scheduled message(s) waiting for their enqueue time. They are invisible to receivers until then and cannot be peeked normally.`,
      });
    }

    const quota = e.maxSizeMb !== undefined && e.maxSizeMb > 0 && e.sizeBytes !== undefined ? (100 * e.sizeBytes) / (e.maxSizeMb * 1024 * 1024) : undefined;
    if (quota !== undefined && quota >= 75) {
      findings.push({
        severity: quota >= 90 ? "bad" : "warn",
        subject,
        message: `${quota.toFixed(0)}% of the ${e.maxSizeMb} MB size quota used (${formatBytes(e.sizeBytes)}). At 100% Service Bus rejects sends with QuotaExceededException — the producer breaks, not the consumer.`,
      });
    }

    if (e.maxDeliveryCount !== undefined && e.maxDeliveryCount <= 1 && e.kind !== "topic") {
      findings.push({
        severity: "warn",
        subject,
        message: "MaxDeliveryCount is 1, so a single transient handler failure dead-letters the message with no retry at all.",
      });
    }

    if (e.lockDurationSeconds !== undefined && e.lockDurationSeconds > 0 && e.lockDurationSeconds < 30 && e.kind !== "topic") {
      findings.push({
        severity: "warn",
        subject,
        message: `Lock duration is ${humanDuration(e.lockDurationSeconds)}. A handler slower than that loses the lock mid-flight, the message is redelivered to someone else, and the original completes into a MessageLockLostException. Renew the lock or raise it (5 minutes is the maximum).`,
      });
    }

    if (e.requiresSession && c.active > 0) {
      findings.push({
        severity: "unknown",
        subject,
        message: `Session-enabled with ${c.active.toLocaleString()} active message(s). A plain receiver gets nothing from this entity — only a session receiver can, and only for one session id at a time.`,
      });
    }

    if (e.forwardTo) {
      findings.push({
        severity: "unknown",
        subject,
        message: `Auto-forwards to ${e.forwardTo}. Messages sent here are not consumed here; look at the destination for the backlog.`,
      });
    }

    if (e.defaultTtlSeconds !== undefined && !isUnlimitedDuration(e.defaultTtlSeconds) && e.defaultTtlSeconds <= 3600 && e.deadLetterOnExpiration === false) {
      findings.push({
        severity: "warn",
        subject,
        message: `TTL is ${humanDuration(e.defaultTtlSeconds)} with dead-lettering on expiration off. Anything not consumed in time is deleted with no record of it.`,
      });
    }

    if (e.autoDeleteOnIdleSeconds !== undefined && !isUnlimitedDuration(e.autoDeleteOnIdleSeconds) && e.autoDeleteOnIdleSeconds <= 86400 * 7) {
      findings.push({
        severity: "warn",
        subject,
        message: `AutoDeleteOnIdle is ${humanDuration(e.autoDeleteOnIdleSeconds)} — the entity itself disappears after that long with no traffic, taking its subscriptions and rules with it.`,
      });
    }

    if (e.kind === "topic" && e.subscriptionCount === 0) {
      findings.push({
        severity: "warn",
        subject,
        message: "Topic has no subscriptions. Sends succeed and the messages go nowhere — a topic with no subscription is a message shredder.",
      });
    }
  }

  return findings.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
}

/** Entities ordered by how much attention they need. */
export function sortByAttention(entities: EntityDescription[]): EntityDescription[] {
  return [...entities].sort((a, b) => {
    const bad = (e: EntityDescription) => (e.counts.deadLetter > 0 || e.counts.transferDeadLetter > 0 ? 1 : 0);
    return (
      bad(b) - bad(a) ||
      b.counts.deadLetter + b.counts.transferDeadLetter - (a.counts.deadLetter + a.counts.transferDeadLetter) ||
      b.counts.active - a.counts.active ||
      displayName(a).localeCompare(displayName(b))
    );
  });
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/**
 * The system properties of a message, sent as a JSON `BrokerProperties` header.
 *
 * They travel in a header rather than the body because the body is the user's
 * payload and Service Bus will not touch it. Anything the application set as a
 * *custom* property arrives as its own HTTP header instead, which is why they
 * are collected separately below.
 */
export interface BrokerProperties {
  MessageId?: string;
  CorrelationId?: string;
  SessionId?: string;
  Label?: string;
  To?: string;
  ReplyTo?: string;
  ContentType?: string;
  DeliveryCount?: number;
  EnqueuedSequenceNumber?: number;
  SequenceNumber?: number;
  EnqueuedTimeUtc?: string;
  LockedUntilUtc?: string;
  LockToken?: string;
  TimeToLive?: number;
  /** Set on messages sitting in a $deadletterqueue. */
  DeadLetterReason?: string;
  DeadLetterErrorDescription?: string;
  PartitionKey?: string;
}

export interface PeekedMessage {
  properties: BrokerProperties;
  /** Application-set properties, from the response headers. */
  custom: Record<string, string>;
  body: string;
  /** The URI to PUT to in order to release the lock. */
  lockUri?: string;
}

/** Headers Service Bus sets itself, so the rest can be shown as the app's own. */
const RESERVED_HEADERS = new Set([
  "brokerproperties",
  "content-type",
  "content-length",
  "date",
  "location",
  "server",
  "strict-transport-security",
  "transfer-encoding",
  "connection",
  "cache-control",
  "expires",
  "pragma",
  "vary",
  "x-ms-request-id",
  "x-ms-activity-id",
]);

/**
 * Turn a peek-lock response into a message.
 *
 * `BrokerProperties` is JSON in a header, and a malformed one must not lose the
 * body — a message you cannot read the metadata of is still a message you want
 * to see. Custom properties arrive quoted, because the REST gateway serialises
 * string values as JSON.
 */
export function parsePeekResponse(headers: Record<string, string>, body: string): PeekedMessage {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;

  let properties: BrokerProperties = {};
  const raw = lower["brokerproperties"];
  if (raw) {
    try {
      properties = JSON.parse(raw) as BrokerProperties;
    } catch {
      properties = {};
    }
  }

  const custom: Record<string, string> = {};
  for (const [k, v] of Object.entries(lower)) {
    if (RESERVED_HEADERS.has(k) || k.startsWith("x-ms-")) continue;
    // Quoted strings are how the gateway encodes a string property; unquote for reading.
    custom[k] = /^".*"$/.test(v) ? v.slice(1, -1) : v;
  }

  return { properties, custom, body, lockUri: lower["location"] };
}

/**
 * Why a message was dead-lettered, in a sentence.
 *
 * `MaxDeliveryCountExceeded` is by far the most common and says the least: it
 * means the handler threw or abandoned N times, and the exception that caused
 * it is in the application's logs, not here.
 */
export function deadLetterExplanation(props: BrokerProperties): string | null {
  const reason = props.DeadLetterReason;
  if (!reason) return null;
  const detail = props.DeadLetterErrorDescription ? ` ${props.DeadLetterErrorDescription}` : "";
  const known: Record<string, string> = {
    MaxDeliveryCountExceeded:
      "The handler abandoned or threw on every delivery until MaxDeliveryCount ran out. Service Bus does not record the exception — it is in the consumer's own logs, at the times in DeliveryCount above.",
    TTLExpiredException: "The message sat longer than the entity's TimeToLive without being completed.",
    HeaderSizeExceeded: "The message's properties exceeded the 64 KB header limit. The body was fine; the metadata was not.",
    Session: "A session-related failure — usually the session lock was lost while the handler held it.",
  };
  return `${reason}: ${known[reason] ?? "See the description for what the broker recorded."}${detail}`;
}

/**
 * What a peek did to the entity, in words.
 *
 * Stated every time because peek-lock is not a peek. The message leaves the
 * visible queue for the lock duration whether or not this tool unlocks it, and
 * a receiver polling in that window gets nothing.
 */
export const PEEK_WARNING =
  "This is a peek-lock: each message is locked while it is read and then unlocked again. A real consumer cannot see a locked message, so reading a busy queue briefly takes messages out of its reach. Nothing is deleted.";

/**
 * Peek-lock returns the head message, so reading N of them locks N in a row.
 *
 * Worth its own note on screen: the loop only advances because each previous
 * message is still locked. If unlocking is fast enough to beat the next
 * request, the same message comes back twice — which is what a duplicate in
 * the list means, not a duplicate in the queue.
 */
export function peekPlan(count: number): { locks: number; note: string } {
  const locks = Math.max(1, Math.min(count, 50));
  return {
    locks,
    note: `Reading ${locks} message(s) means holding ${locks} locks at once — the head only advances while the message before it stays locked. All of them are released afterwards.`,
  };
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Extra guidance for a failed request, chosen from the status and what was typed.
 *
 * 401 is the interesting one. Service Bus returns it for three unrelated
 * problems — a wrong key, a right key with the wrong rights, and a token whose
 * expiry has already passed because the machine's clock is off — and the body
 * says only "InvalidSignature".
 */
export function requestAdvice(status: number, entity?: string): string {
  switch (status) {
    case 401:
      return "401 — the SAS signature was rejected. Either the SharedAccessKey is wrong, the policy lacks the right claim (Listen to peek, Send to send, Manage to list entities), or this machine's clock is far enough off that the token's expiry is already in the past.";
    case 403:
      return "403 — authenticated, but forbidden. Usually the namespace has an IP filter or private endpoint, or the policy has Listen but not Manage, which is what listing entities needs.";
    case 404:
      return entity
        ? `404 — no entity named ${entity} in this namespace. Names are case-insensitive but paths are not: a subscription is {topic}/Subscriptions/{name}.`
        : "404 — the namespace answered but the path does not exist. A namespace-level connection string is required to list entities; an EntityPath-scoped one only reaches its own entity.";
    case 410:
      return "410 — the entity was deleted while this was open.";
    case 429:
      return "429 — throttled. A Basic or Standard namespace shares throughput; the request is not wrong, just too frequent.";
    case 503:
      return "503 — the namespace is busy or being moved between nodes. This is normally transient and retried automatically by the SDKs.";
    default:
      return `${status} — see the response body for what the namespace reported.`;
  }
}

/** A one-line summary of a namespace, for the header and for Debug Session capture. */
export function namespaceSummary(entities: EntityDescription[]): string {
  const queues = entities.filter((e) => e.kind === "queue").length;
  const topics = entities.filter((e) => e.kind === "topic").length;
  const subs = entities.filter((e) => e.kind === "subscription").length;
  const dead = entities.reduce((sum, e) => sum + e.counts.deadLetter + e.counts.transferDeadLetter, 0);
  const active = entities.reduce((sum, e) => sum + e.counts.active, 0);
  const parts = [
    `${queues} queue${queues === 1 ? "" : "s"}`,
    `${topics} topic${topics === 1 ? "" : "s"}`,
    `${subs} subscription${subs === 1 ? "" : "s"}`,
    `${active.toLocaleString()} active`,
  ];
  if (dead > 0) parts.push(`${dead.toLocaleString()} dead-lettered`);
  return parts.join(", ");
}
