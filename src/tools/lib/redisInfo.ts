/**
 * Reading a Redis server's own account of itself.
 *
 * `INFO` returns a few hundred fields in `key:value` lines under `# Section`
 * headings. Most are noise on any given day; a dozen or so answer the questions
 * that actually get asked — is it about to hit maxmemory, is it evicting, is the
 * cache being used, is a replica behind, is persistence working.
 *
 * Everything here is parsing and arithmetic over that text, so it is testable
 * without a server.
 */

export type InfoSections = Record<string, Record<string, string>>;

/**
 * Parse `INFO` into sections.
 *
 * Lines before any heading land in `Server`, which is where Redis puts them
 * anyway when a specific section is requested.
 */
export function parseInfo(text: string): InfoSections {
  const sections: InfoSections = {};
  let current = "Server";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      current = line.replace(/^#\s*/, "").trim() || "Server";
      sections[current] ??= {};
      continue;
    }
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    sections[current] ??= {};
    sections[current][line.slice(0, colon)] = line.slice(colon + 1);
  }
  return sections;
}

/** A field from anywhere in the INFO output, first match wins. */
export function infoValue(sections: InfoSections, field: string): string | undefined {
  for (const values of Object.values(sections)) {
    if (field in values) return values[field];
  }
  return undefined;
}

function num(sections: InfoSections, field: string): number | undefined {
  const raw = infoValue(sections, field);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** Bytes as a human string. Redis reports raw bytes; humans do not read them. */
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

/** Seconds as `3d 4h 12m`, dropping the units that are zero. */
export function formatUptime(seconds: number | undefined): string {
  if (seconds === undefined) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [d && `${d}d`, h && `${h}h`, m && `${m}m`].filter(Boolean);
  return parts.length ? parts.join(" ") : `${seconds}s`;
}

export type Severity = "ok" | "warn" | "bad" | "unknown";

export interface HealthMetric {
  id: string;
  label: string;
  /** Ready to display. */
  value: string;
  severity: Severity;
  /** Why it matters, and what to do when it is not ok. */
  detail: string;
}

export interface KeyspaceDb {
  db: string;
  keys: number;
  expires: number;
  avgTtlMs: number;
}

/** `db0:keys=12,expires=3,avg_ttl=0` per line under `# Keyspace`. */
export function parseKeyspace(sections: InfoSections): KeyspaceDb[] {
  const out: KeyspaceDb[] = [];
  for (const [name, value] of Object.entries(sections.Keyspace ?? {})) {
    const fields: Record<string, number> = {};
    for (const pair of value.split(",")) {
      const [k, v] = pair.split("=");
      if (k) fields[k.trim()] = Number(v ?? 0) || 0;
    }
    out.push({ db: name, keys: fields.keys ?? 0, expires: fields.expires ?? 0, avgTtlMs: fields.avg_ttl ?? 0 });
  }
  return out;
}

/** Total keys across every database. */
export function totalKeys(dbs: KeyspaceDb[]): number {
  return dbs.reduce((sum, d) => sum + d.keys, 0);
}

/**
 * Keyspace hit ratio.
 *
 * Undefined until there has been traffic — a fresh server reports 0/0, and
 * calling that "0% hit rate" would be a false alarm.
 */
export function hitRatio(sections: InfoSections): number | undefined {
  const hits = num(sections, "keyspace_hits");
  const misses = num(sections, "keyspace_misses");
  if (hits === undefined || misses === undefined) return undefined;
  const total = hits + misses;
  return total === 0 ? undefined : (100 * hits) / total;
}

/** Used memory as a percentage of maxmemory, or undefined when maxmemory is 0 (unlimited). */
export function memoryPressure(sections: InfoSections): number | undefined {
  const used = num(sections, "used_memory");
  const max = num(sections, "maxmemory");
  if (used === undefined || !max) return undefined;
  return (100 * used) / max;
}

/**
 * The metrics worth putting on a dashboard, with a severity each.
 *
 * Thresholds are deliberately conservative and explained in `detail`: this
 * reports what the numbers are and what they usually mean, and stops short of
 * claiming a server is broken.
 */
export function healthMetrics(sections: InfoSections): HealthMetric[] {
  const metrics: HealthMetric[] = [];
  const push = (m: HealthMetric) => metrics.push(m);

  const used = num(sections, "used_memory");
  const maxmemory = num(sections, "maxmemory");
  const pressure = memoryPressure(sections);
  push({
    id: "memory",
    label: "Memory used",
    value: maxmemory
      ? `${formatBytes(used)} of ${formatBytes(maxmemory)}${pressure !== undefined ? ` (${pressure.toFixed(0)}%)` : ""}`
      : formatBytes(used),
    severity: pressure === undefined ? "unknown" : pressure >= 90 ? "bad" : pressure >= 75 ? "warn" : "ok",
    detail: maxmemory
      ? "Once used_memory reaches maxmemory, the eviction policy decides what happens next — and with noeviction, writes start failing."
      : "maxmemory is 0, so Redis will use as much as the machine allows and the OOM killer decides the limit. Set maxmemory and a policy.",
  });

  const rss = num(sections, "used_memory_rss");
  const frag = num(sections, "mem_fragmentation_ratio");
  push({
    id: "fragmentation",
    label: "Fragmentation",
    value: frag === undefined ? "—" : `${frag.toFixed(2)}× (RSS ${formatBytes(rss)})`,
    // Below 1 means Redis is swapping, which is worse than any fragmentation.
    severity: frag === undefined ? "unknown" : frag < 1 ? "bad" : frag > 1.5 ? "warn" : "ok",
    detail:
      "Ratio of RSS to logical memory. Above ~1.5 the allocator is holding memory Redis is not using; below 1.0 part of the dataset has been swapped to disk, which destroys latency.",
  });

  const policy = infoValue(sections, "maxmemory_policy");
  push({
    id: "policy",
    label: "Eviction policy",
    value: policy ?? "—",
    severity: policy === undefined ? "unknown" : policy === "noeviction" && maxmemory ? "warn" : "ok",
    detail:
      "With noeviction and a maxmemory set, writes fail with OOM once full rather than dropping keys. Correct for a datastore, usually wrong for a cache.",
  });

  const evicted = num(sections, "evicted_keys");
  push({
    id: "evicted",
    label: "Evicted keys",
    value: evicted === undefined ? "—" : evicted.toLocaleString(),
    severity: evicted === undefined ? "unknown" : evicted > 0 ? "warn" : "ok",
    detail: "Keys dropped because memory was full. Any non-zero value on a datastore is data loss; on a cache it means the working set no longer fits.",
  });

  const ratio = hitRatio(sections);
  push({
    id: "hit-ratio",
    label: "Hit ratio",
    value: ratio === undefined ? "no traffic yet" : `${ratio.toFixed(1)}%`,
    severity: ratio === undefined ? "unknown" : ratio < 50 ? "warn" : "ok",
    detail:
      "Share of key lookups that found something. A low ratio on a cache means keys expire before they are reused, or the keys being read were never written.",
  });

  const clients = num(sections, "connected_clients");
  const maxclients = num(sections, "maxclients");
  push({
    id: "clients",
    label: "Clients",
    value: maxclients ? `${clients ?? 0} of ${maxclients}` : String(clients ?? "—"),
    severity:
      clients === undefined || !maxclients ? "unknown" : clients / maxclients >= 0.9 ? "bad" : clients / maxclients >= 0.7 ? "warn" : "ok",
    detail: "Connections open now against the server limit. Hitting it rejects new clients outright, which usually looks like an application outage.",
  });

  const blocked = num(sections, "blocked_clients");
  push({
    id: "blocked",
    label: "Blocked clients",
    value: blocked === undefined ? "—" : String(blocked),
    severity: blocked === undefined ? "unknown" : blocked > 0 ? "warn" : "ok",
    detail: "Clients parked in BLPOP, BRPOP, XREAD or WAIT. Expected for queue workers; a surprise anywhere else.",
  });

  const ops = num(sections, "instantaneous_ops_per_sec");
  push({
    id: "ops",
    label: "Ops/sec",
    value: ops === undefined ? "—" : ops.toLocaleString(),
    severity: "ok",
    detail: "Commands per second at this instant, not an average.",
  });

  const rdbChanges = num(sections, "rdb_changes_since_last_save");
  const rdbLastStatus = infoValue(sections, "rdb_last_bgsave_status");
  const aofEnabled = infoValue(sections, "aof_enabled") === "1";
  const aofLastStatus = infoValue(sections, "aof_last_write_status");
  const persistenceBad = rdbLastStatus === "err" || (aofEnabled && aofLastStatus === "err");
  push({
    id: "persistence",
    label: "Persistence",
    value: `${aofEnabled ? "AOF on" : "AOF off"}${rdbChanges !== undefined ? `, ${rdbChanges.toLocaleString()} changes unsaved` : ""}`,
    severity: persistenceBad ? "bad" : rdbLastStatus === undefined ? "unknown" : "ok",
    detail: persistenceBad
      ? "The last save or AOF write failed. Until it succeeds the data on disk is stale, and a restart loses everything since."
      : "A failed bgsave or AOF write means a restart silently loses recent writes. Watch the *_last_*_status fields, not just whether persistence is enabled.",
  });

  const role = infoValue(sections, "role");
  const linkStatus = infoValue(sections, "master_link_status");
  const lagBytes = num(sections, "master_repl_offset");
  const slaveOffset = num(sections, "slave_repl_offset");
  if (role === "slave") {
    const behind = lagBytes !== undefined && slaveOffset !== undefined ? lagBytes - slaveOffset : undefined;
    push({
      id: "replication",
      label: "Replica link",
      value: `${linkStatus ?? "?"}${behind !== undefined ? ` · ${formatBytes(Math.max(0, behind))} behind` : ""}`,
      severity: linkStatus === "up" ? "ok" : "bad",
      detail: "A replica with the link down is serving data that is getting staler by the second, and no error is raised to readers.",
    });
  } else if (role === "master") {
    const replicas = num(sections, "connected_slaves");
    push({
      id: "replication",
      label: "Replicas",
      value: replicas === undefined ? "—" : String(replicas),
      severity: "ok",
      detail: "Replicas currently attached to this primary.",
    });
  }

  return metrics;
}

/** The INFO sections worth showing in full, in a sensible reading order. */
export const INFO_SECTION_ORDER = [
  "Server",
  "Clients",
  "Memory",
  "Persistence",
  "Stats",
  "Replication",
  "CPU",
  "Commandstats",
  "Latencystats",
  "Cluster",
  "Keyspace",
];

/** Sections present in this output, ordered, with unknown sections last. */
export function orderedSections(sections: InfoSections): string[] {
  const present = Object.keys(sections);
  const known = INFO_SECTION_ORDER.filter((s) => present.includes(s));
  const extra = present.filter((s) => !INFO_SECTION_ORDER.includes(s)).sort();
  return [...known, ...extra];
}

export interface CommandStat {
  command: string;
  calls: number;
  usec: number;
  usecPerCall: number;
  rejected: number;
  failed: number;
}

/**
 * `cmdstat_get:calls=12,usec=99,usec_per_call=8.25,rejected_calls=0,failed_calls=0`
 *
 * Sorted by total time, which is the number that finds the expensive command —
 * a cheap command called a million times outranks a slow one called twice.
 */
export function parseCommandStats(sections: InfoSections): CommandStat[] {
  const out: CommandStat[] = [];
  for (const [key, value] of Object.entries(sections.Commandstats ?? {})) {
    if (!key.startsWith("cmdstat_")) continue;
    const fields: Record<string, number> = {};
    for (const pair of value.split(",")) {
      const [k, v] = pair.split("=");
      if (k) fields[k.trim()] = Number(v ?? 0) || 0;
    }
    out.push({
      command: key.slice("cmdstat_".length),
      calls: fields.calls ?? 0,
      usec: fields.usec ?? 0,
      usecPerCall: fields.usec_per_call ?? 0,
      rejected: fields.rejected_calls ?? 0,
      failed: fields.failed_calls ?? 0,
    });
  }
  return out.sort((a, b) => b.usec - a.usec);
}
