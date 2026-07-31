/**
 * Heartbeats and automatic replies for WebSocket sessions.
 *
 * Most real-world sockets die without them: Socket.IO expects `3` in reply to `2`,
 * graphql-ws expects a `pong` message, STOMP expects a newline on a timer, SignalR sends
 * keep-alive frames. Answering by hand is impossible, and a connection that silently
 * drops after 25 seconds looks like a server bug rather than a missing ack.
 *
 * Matching and scheduling are pure so they can be tested without a socket.
 */

export type MatchKind = "contains" | "equals" | "regex" | "jsonField";

export interface AutoReplyRule {
  id: string;
  enabled: boolean;
  /** Shown in the frame log so an automatic reply is never mistaken for a manual one. */
  label: string;
  kind: MatchKind;
  /** Text to look for, the pattern, or the expected value for `jsonField`. */
  value: string;
  /** Property name for `jsonField`, e.g. `type`. */
  field?: string;
  /** What to send back. */
  reply: string;
}

export interface HeartbeatConfig {
  enabled: boolean;
  /** How often to send. Values below 1s are rejected to avoid flooding a server. */
  intervalMs: number;
  /** Payload to send; ignored when `useProtocolPing` is set. */
  message: string;
  /** Send a protocol-level ping frame instead of a text message. */
  useProtocolPing: boolean;
}

export const MIN_HEARTBEAT_MS = 1000;

export const DEFAULT_HEARTBEAT: HeartbeatConfig = {
  enabled: false,
  intervalMs: 25_000,
  message: "ping",
  useProtocolPing: true,
};

/** Does this inbound frame trigger the rule? */
export function ruleMatches(rule: AutoReplyRule, data: string): boolean {
  if (!rule.enabled) return false;
  switch (rule.kind) {
    case "contains":
      return rule.value !== "" && data.includes(rule.value);
    case "equals":
      return data.trim() === rule.value;
    case "regex":
      try {
        return new RegExp(rule.value).test(data);
      } catch {
        // An invalid pattern must not silently match everything.
        return false;
      }
    case "jsonField": {
      if (!rule.field) return false;
      try {
        // SignalR terminates each JSON frame with 0x1E, which JSON.parse rejects.
        const parsed = JSON.parse(data.replace(/+$/, "").trim()) as Record<string, unknown>;
        const actual = parsed?.[rule.field];
        return actual !== undefined && String(actual) === rule.value;
      } catch {
        return false;
      }
    }
  }
}

/** The first rule that matches, or null. Order is the user's priority. */
export function findAutoReply(rules: AutoReplyRule[], data: string): AutoReplyRule | null {
  return rules.find((r) => ruleMatches(r, data)) ?? null;
}

/** Clamp an interval to something a server will tolerate. */
export function normalizeInterval(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return DEFAULT_HEARTBEAT.intervalMs;
  return Math.max(MIN_HEARTBEAT_MS, Math.round(ms));
}

export interface WsPreset {
  id: string;
  name: string;
  description: string;
  heartbeat: HeartbeatConfig;
  rules: Omit<AutoReplyRule, "id">[];
}

/**
 * Ready-made settings for the protocols that need them. Each was chosen because its
 * keep-alive is mandatory and undiscoverable from the wire without reading a spec.
 */
export const WS_PRESETS: WsPreset[] = [
  {
    id: "socketio",
    name: "Socket.IO (Engine.IO v4)",
    description: "Server sends 2 (ping); the client must answer 3 (pong) or be disconnected.",
    heartbeat: { ...DEFAULT_HEARTBEAT, enabled: false },
    rules: [{ enabled: true, label: "Socket.IO pong", kind: "equals", value: "2", reply: "3" }],
  },
  {
    id: "graphql-ws",
    name: "graphql-ws",
    description: 'Answers {"type":"ping"} with {"type":"pong"}.',
    heartbeat: { ...DEFAULT_HEARTBEAT, enabled: false },
    rules: [
      {
        enabled: true,
        label: "graphql-ws pong",
        kind: "jsonField",
        field: "type",
        value: "ping",
        reply: '{"type":"pong"}',
      },
    ],
  },
  {
    id: "signalr",
    name: "SignalR (JSON protocol)",
    description: "Mirrors the type 6 keep-alive, including the record separator.",
    heartbeat: { ...DEFAULT_HEARTBEAT, enabled: true, useProtocolPing: false, message: '{"type":6}\u001e', intervalMs: 15_000 },
    rules: [{ enabled: true, label: "SignalR keep-alive", kind: "jsonField", field: "type", value: "6", reply: '{"type":6}\u001e' }],
  },
  {
    id: "stomp",
    name: "STOMP",
    description: "Sends a newline on a timer, which is what STOMP counts as a heartbeat.",
    heartbeat: { ...DEFAULT_HEARTBEAT, enabled: true, useProtocolPing: false, message: "\n", intervalMs: 10_000 },
    rules: [],
  },
  {
    id: "plain",
    name: "Plain ping/pong",
    description: 'Replies "pong" to any frame containing "ping".',
    heartbeat: { ...DEFAULT_HEARTBEAT, enabled: false },
    rules: [{ enabled: true, label: "pong", kind: "contains", value: "ping", reply: "pong" }],
  },
];

export function presetById(id: string): WsPreset | undefined {
  return WS_PRESETS.find((p) => p.id === id);
}
