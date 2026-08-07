/**
 * The NATS client protocol, from the frontend's side.
 *
 * The rest of the NATS tool reads the monitoring port over HTTP, which is
 * read-only by design. This is the other half: publishing a test message,
 * subscribing to see what is actually flowing, and making a request to check
 * that something is answering. All of it goes through Rust — the webview has no
 * TCP, and NATS is not an HTTP protocol.
 *
 * The pure parts live here so they can be tested without a server: the shape of
 * a received message, how a live feed is capped, and what a subscription's
 * subject means.
 */

import { invokeNative, isTauri } from "@/lib/platform";

/** Event channel Rust emits on. */
export const NATS_EVENT = "nats://message";

export interface NatsAuth {
  user?: string;
  password?: string;
  token?: string;
  credsPath?: string;
}

export interface NatsIncoming {
  id: string;
  subject: string;
  payload: string;
  binary: boolean;
  bytes: number;
  reply?: string;
  headers: [string, string][];
}

export interface NatsStatusEvent {
  id: string;
  kind: "open" | "closed" | "error";
  detail: string;
}

/** A message as it appears in the feed, once received. */
export interface FeedMessage extends NatsIncoming {
  /** Assigned on arrival, since NATS core messages carry no timestamp. */
  at: number;
  seq: number;
}

/** Rust sends both message and status objects on one channel; tell them apart. */
export function isStatusEvent(payload: unknown): payload is NatsStatusEvent {
  return !!payload && typeof payload === "object" && "kind" in payload && !("subject" in payload);
}

/** The most recent `limit` messages, newest first. */
export function appendMessage(feed: FeedMessage[], message: FeedMessage, limit = 500): FeedMessage[] {
  // A busy subject can deliver thousands a second; an uncapped list is a
  // freeze, not a feature.
  return [message, ...feed].slice(0, limit);
}

/** Feed entries matching a text filter over subject and payload. */
export function filterFeed(feed: FeedMessage[], query: string): FeedMessage[] {
  const q = query.trim().toLowerCase();
  if (!q) return feed;
  return feed.filter(
    (m) => m.subject.toLowerCase().includes(q) || m.payload.toLowerCase().includes(q),
  );
}

/** Distinct subjects seen in the feed, with how many of each. */
export function subjectCounts(feed: FeedMessage[]): { subject: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const m of feed) counts.set(m.subject, (counts.get(m.subject) ?? 0) + 1);
  return [...counts.entries()]
    .map(([subject, count]) => ({ subject, count }))
    .sort((a, b) => b.count - a.count || a.subject.localeCompare(b.subject));
}

/**
 * Is this a subject you can usefully subscribe to?
 *
 * Wildcards are legal here, unlike when publishing — subscribing to `orders.>`
 * is the normal thing to do. Empty tokens are still a mistake.
 */
export function subscribeSubjectProblem(subject: string): string | null {
  const s = subject.trim();
  if (!s) return "Subject is required.";
  if (/\s/.test(s)) return "Subjects cannot contain whitespace.";
  const tokens = s.split(".");
  if (tokens.some((t) => t === "")) return "Empty token — check for a leading, trailing or doubled dot.";
  const arrow = tokens.indexOf(">");
  if (arrow !== -1 && arrow !== tokens.length - 1) return "`>` matches the rest of the subject and is only legal as the last token.";
  return null;
}

/** Auth object in the shape Rust expects, or undefined when nothing was given. */
export function toNativeAuth(auth: NatsAuth): Record<string, string | null> | undefined {
  const hasAny = [auth.user, auth.token, auth.credsPath].some((v) => v && v.trim());
  if (!hasAny) return undefined;
  return {
    user: auth.user?.trim() || null,
    password: auth.password ?? null,
    token: auth.token?.trim() || null,
    creds_path: auth.credsPath?.trim() || null,
  };
}

const needsDesktop = () => {
  if (!isTauri()) throw new Error("The NATS client protocol needs the desktop app.");
};

export async function natsConnect(server: string, auth: NatsAuth): Promise<string> {
  needsDesktop();
  return invokeNative<string>("nats_connect", { server, auth: toNativeAuth(auth) });
}

export async function natsPublish(
  server: string,
  auth: NatsAuth,
  subject: string,
  payload: string,
  reply?: string,
): Promise<void> {
  needsDesktop();
  await invokeNative<void>("nats_publish", { server, auth: toNativeAuth(auth), subject, payload, reply: reply || null });
}

export async function natsRequest(
  server: string,
  auth: NatsAuth,
  subject: string,
  payload: string,
  timeoutMs = 5000,
): Promise<NatsIncoming> {
  needsDesktop();
  return invokeNative<NatsIncoming>("nats_request", {
    server,
    auth: toNativeAuth(auth),
    subject,
    payload,
    timeoutMs,
  });
}

export async function natsSubscribe(
  server: string,
  auth: NatsAuth,
  subject: string,
  queueGroup?: string,
): Promise<string> {
  needsDesktop();
  return invokeNative<string>("nats_subscribe", {
    server,
    auth: toNativeAuth(auth),
    subject,
    queueGroup: queueGroup || null,
  });
}

export async function natsUnsubscribe(id: string): Promise<void> {
  if (!isTauri()) return;
  await invokeNative<void>("nats_unsubscribe", { id });
}

export async function natsSubscriptions(): Promise<[string, string][]> {
  if (!isTauri()) return [];
  return invokeNative<[string, string][]>("nats_subscriptions");
}
