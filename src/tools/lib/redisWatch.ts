/**
 * Watching a Redis connection that stays open.
 *
 * `redis_exec` opens a connection per command, which is right for GET and INFO
 * and impossible for the two things people most want when a cache is
 * misbehaving. SUBSCRIBE puts a connection into a mode where it stops answering
 * ordinary commands and only receives pushes; MONITOR turns it into a stream of
 * every command the server runs. Neither survives a command-per-call client.
 *
 * The pure parts are here: what a streamed event looks like, how the feed is
 * capped, and how to read a MONITOR line, which is a format rather than a
 * structure.
 */

import { invokeNative, isTauri } from "@/lib/platform";

/** Event channel Rust emits on. */
export const REDIS_EVENT = "redis://stream";

export interface RedisStreamEvent {
  id: string;
  kind: "message" | "status" | "error" | "closed";
  channel: string;
  payload: string;
}

export interface WatchLine extends RedisStreamEvent {
  at: number;
  seq: number;
}

/** Newest first, capped — MONITOR on a busy server is thousands a second. */
export function appendLine(feed: WatchLine[], line: WatchLine, limit = 500): WatchLine[] {
  return [line, ...feed].slice(0, limit);
}

/** Feed entries matching a text filter over channel and payload. */
export function filterLines(feed: WatchLine[], query: string): WatchLine[] {
  const q = query.trim().toLowerCase();
  if (!q) return feed;
  return feed.filter(
    (l) => l.channel.toLowerCase().includes(q) || l.payload.toLowerCase().includes(q),
  );
}

export interface MonitorLine {
  /** Seconds since the epoch, as Redis reports it. */
  at: number;
  db: number;
  client: string;
  command: string;
  args: string[];
}

/**
 * Parse a MONITOR line.
 *
 * The format is `<unix.micros> [<db> <addr>] "CMD" "arg" "arg"`. Arguments are
 * quoted and may contain spaces, so they have to be read as quoted tokens
 * rather than split on whitespace — which is exactly the mistake that makes a
 * SET of a sentence look like twenty commands.
 */
export function parseMonitorLine(line: string): MonitorLine | null {
  const match = /^([\d.]+)\s+\[(\d+)\s+([^\]]+)\]\s+(.*)$/.exec(line.trim());
  if (!match) return null;
  const [, ts, db, client, rest] = match;
  const tokens = rest.match(/"(?:[^"\\]|\\.)*"|\S+/g) ?? [];
  const unquote = (t: string) => (t.startsWith('"') ? t.slice(1, -1).replace(/\\"/g, '"') : t);
  const parts = tokens.map(unquote);
  return {
    at: Number(ts),
    db: Number(db),
    client,
    command: (parts[0] ?? "").toUpperCase(),
    args: parts.slice(1),
  };
}

/** How often each command appears, busiest first — the point of running MONITOR. */
export function commandCounts(feed: WatchLine[]): { command: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const line of feed) {
    const parsed = parseMonitorLine(line.payload);
    if (!parsed?.command) continue;
    counts.set(parsed.command, (counts.get(parsed.command) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([command, count]) => ({ command, count }))
    .sort((a, b) => b.count - a.count || a.command.localeCompare(b.command));
}

/** Distinct channels seen, with counts. */
export function channelCounts(feed: WatchLine[]): { channel: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const line of feed) {
    if (!line.channel) continue;
    counts.set(line.channel, (counts.get(line.channel) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([channel, count]) => ({ channel, count }))
    .sort((a, b) => b.count - a.count || a.channel.localeCompare(b.channel));
}

/** The command that starts the requested watch. */
export function watchCommand(mode: "subscribe" | "psubscribe" | "monitor", target: string): string[] {
  if (mode === "monitor") return ["MONITOR"];
  return [mode.toUpperCase(), target.trim()];
}

/** Is this a usable target for the chosen mode? */
export function watchTargetProblem(mode: "subscribe" | "psubscribe" | "monitor", target: string): string | null {
  if (mode === "monitor") return null;
  if (!target.trim()) return "A channel is required.";
  if (/\s/.test(target.trim())) return "Channel names cannot contain whitespace.";
  if (mode === "subscribe" && /[*?[]/.test(target)) {
    return "SUBSCRIBE matches exact names; use pattern subscribe for globs.";
  }
  return null;
}

export interface WatchTarget {
  host: string;
  port: number;
  password?: string;
  db?: number;
}

export async function startWatch(target: WatchTarget, args: string[]): Promise<string> {
  if (!isTauri()) throw new Error("Watching a Redis connection needs the desktop app.");
  return invokeNative<string>("redis_watch", {
    host: target.host,
    port: target.port,
    password: target.password || null,
    db: target.db ?? 0,
    args,
  });
}

export async function stopWatch(id: string): Promise<void> {
  if (!isTauri()) return;
  await invokeNative<void>("redis_unwatch", { id });
}

export async function listWatches(): Promise<[string, string][]> {
  if (!isTauri()) return [];
  return invokeNative<[string, string][]>("redis_watches");
}
