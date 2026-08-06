/**
 * Parsing the Redis replies that are not INFO: CLIENT LIST, SLOWLOG, PUBSUB.
 *
 * Each has its own shape, none of them JSON, and all three answer questions that
 * come up during an incident — who is connected, what was slow, who is listening.
 */

/** One row of `CLIENT LIST`. Fields Redis omits are left undefined rather than zeroed. */
export interface RedisClient {
  id: string;
  addr: string;
  laddr?: string;
  name: string;
  /** Seconds the connection has been open. */
  age: number;
  /** Seconds since the last command. */
  idle: number;
  flags: string;
  db: string;
  sub: number;
  psub: number;
  /** Commands in a pipeline waiting to be processed. */
  multi: number;
  /** Output buffer length in bytes; a large value means a client is not reading. */
  omem: number;
  /** Total memory this connection is holding. */
  totMem: number;
  events: string;
  lastCmd: string;
  user?: string;
  /** Every field as parsed, for the ones not promoted above. */
  raw: Record<string, string>;
}

/**
 * `CLIENT LIST` returns one space-separated `key=value` line per connection.
 *
 * Values can contain `=` (a client name is arbitrary), so each token is split on
 * its first `=` only.
 */
export function parseClientList(text: string): RedisClient[] {
  const clients: RedisClient[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const raw: Record<string, string> = {};
    for (const token of trimmed.split(" ")) {
      const eq = token.indexOf("=");
      if (eq <= 0) continue;
      raw[token.slice(0, eq)] = token.slice(eq + 1);
    }
    if (!raw.addr && !raw.id) continue;
    const n = (key: string) => Number(raw[key] ?? 0) || 0;
    clients.push({
      id: raw.id ?? "",
      addr: raw.addr ?? "",
      laddr: raw.laddr,
      name: raw.name ?? "",
      age: n("age"),
      idle: n("idle"),
      flags: raw.flags ?? "",
      db: raw.db ?? "",
      sub: n("sub"),
      psub: n("psub"),
      multi: Number(raw.multi ?? -1),
      omem: n("omem"),
      totMem: n("tot-mem"),
      events: raw.events ?? "",
      lastCmd: raw.cmd ?? "",
      user: raw.user,
      raw,
    });
  }
  return clients;
}

/** What a client's flag letters mean. Redis documents them only in the CLIENT LIST reference. */
export const CLIENT_FLAGS: Record<string, string> = {
  N: "no special flag",
  S: "replica connection",
  M: "this client is a primary",
  O: "monitoring (MONITOR)",
  x: "in a MULTI/EXEC transaction",
  b: "blocked on a blocking call",
  t: "tracking keys (client-side caching)",
  R: "tracking target client is invalid",
  B: "broadcast tracking mode",
  d: "watched keys already dirty — EXEC will fail",
  c: "closing after replying",
  u: "unblocked",
  A: "closing as soon as possible",
  U: "connected over a unix socket",
  r: "in a cluster read-only command",
  e: "protected from eviction",
  T: "no touch — does not update key LRU",
};

/** Expand a flags string such as `Nbx` into readable descriptions. */
export function describeClientFlags(flags: string): string[] {
  return [...flags].filter((f) => f !== "N" || flags.length === 1).map((f) => CLIENT_FLAGS[f] ?? `unknown flag ${f}`);
}

/** Clients worth a second look, and why. */
export function clientConcerns(clients: RedisClient[]): { client: RedisClient; reason: string }[] {
  const out: { client: RedisClient; reason: string }[] = [];
  for (const c of clients) {
    // 1 MB of unread output means the server is buffering for a client that is
    // not consuming — the classic path to an output-buffer-limit disconnect.
    if (c.omem > 1024 * 1024) out.push({ client: c, reason: `Output buffer is ${Math.round(c.omem / 1024)} KB — this client is not reading fast enough` });
    else if (c.flags.includes("b")) out.push({ client: c, reason: `Blocked on ${c.lastCmd || "a blocking command"}` });
    else if (c.idle > 3600) out.push({ client: c, reason: `Idle for ${Math.round(c.idle / 3600)}h — a leaked connection or a pool that never recycles` });
    else if (c.multi > 0) out.push({ client: c, reason: `${c.multi} commands queued in an open MULTI` });
  }
  return out;
}

export interface SlowlogEntry {
  id: string;
  /** Unix seconds. */
  at: number;
  /** Execution time in microseconds, excluding network time. */
  usec: number;
  command: string[];
  clientAddr?: string;
  clientName?: string;
}

/**
 * `SLOWLOG GET` returns nested arrays, which the RESP client hands over as JSON.
 *
 * Entries are `[id, timestamp, microseconds, [args...], addr?, name?]` — the last
 * two only exist from Redis 4.0 on.
 */
export function parseSlowlog(reply: unknown): SlowlogEntry[] {
  if (!Array.isArray(reply)) return [];
  const out: SlowlogEntry[] = [];
  for (const row of reply) {
    if (!Array.isArray(row) || row.length < 4) continue;
    const args = Array.isArray(row[3]) ? row[3].map((a) => String(a)) : [];
    out.push({
      id: String(row[0] ?? ""),
      at: Number(row[1] ?? 0) || 0,
      usec: Number(row[2] ?? 0) || 0,
      command: args,
      clientAddr: row[4] === undefined || row[4] === null ? undefined : String(row[4]),
      clientName: row[5] === undefined || row[5] === null || row[5] === "" ? undefined : String(row[5]),
    });
  }
  return out;
}

export interface PubSubChannel {
  channel: string;
  subscribers: number;
}

/**
 * Pair `PUBSUB CHANNELS` with `PUBSUB NUMSUB`.
 *
 * NUMSUB replies as a flat array — `[channel, count, channel, count, …]` — so it
 * is walked two at a time.
 */
export function parsePubSubNumSub(reply: unknown): PubSubChannel[] {
  if (!Array.isArray(reply)) return [];
  const out: PubSubChannel[] = [];
  for (let i = 0; i + 1 < reply.length; i += 2) {
    const channel = String(reply[i] ?? "");
    if (!channel) continue;
    out.push({ channel, subscribers: Number(reply[i + 1] ?? 0) || 0 });
  }
  return out.sort((a, b) => b.subscribers - a.subscribers || a.channel.localeCompare(b.channel));
}

/** A RESP array reply as a list of strings, ignoring anything that is not one. */
export function asStringList(reply: unknown): string[] {
  if (!Array.isArray(reply)) return [];
  return reply.filter((v) => v !== null && v !== undefined).map((v) => String(v));
}

/**
 * Redis glob-style pattern matching, as `PUBSUB` channels and `KEYS` use it.
 *
 * Supports `*`, `?`, `[abc]`, `[a-c]`, `[^a]` and `\` escapes. Implemented by
 * translating to a regular expression rather than by hand, because the character
 * class rules are where a hand-rolled matcher gets it wrong.
 */
export function globToRegExp(pattern: string): RegExp {
  let out = "^";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "\\" && i + 1 < pattern.length) {
      out += escapeLiteral(pattern[i + 1]);
      i += 2;
      continue;
    }
    if (c === "*") out += ".*";
    else if (c === "?") out += ".";
    else if (c === "[") {
      const close = pattern.indexOf("]", i + 1);
      if (close < 0) {
        out += "\\[";
        i++;
        continue;
      }
      let body = pattern.slice(i + 1, close);
      // Redis uses ^ for negation, same as a regex class.
      body = body.replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
      out += `[${body}]`;
      i = close + 1;
      continue;
    } else out += escapeLiteral(c);
    i++;
  }
  return new RegExp(out + "$");
}

function escapeLiteral(ch: string): string {
  return /[.*+?^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
}

export function globMatches(pattern: string, value: string): boolean {
  return globToRegExp(pattern).test(value);
}
