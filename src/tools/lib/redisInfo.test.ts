import { describe, it, expect } from "vitest";
import {
  parseInfo,
  infoValue,
  parseKeyspace,
  totalKeys,
  hitRatio,
  memoryPressure,
  healthMetrics,
  orderedSections,
  parseCommandStats,
  formatBytes,
  formatUptime,
} from "./redisInfo";

const INFO = `# Server
redis_version:7.2.4
uptime_in_seconds:93784
# Clients
connected_clients:42
blocked_clients:2
maxclients:10000
# Memory
used_memory:1048576
used_memory_rss:2097152
maxmemory:2097152
maxmemory_policy:allkeys-lru
mem_fragmentation_ratio:2.00
# Persistence
rdb_changes_since_last_save:17
rdb_last_bgsave_status:ok
aof_enabled:0
# Stats
instantaneous_ops_per_sec:120
keyspace_hits:900
keyspace_misses:100
evicted_keys:5
# Replication
role:master
connected_slaves:1
# Keyspace
db0:keys=120,expires=15,avg_ttl=3600
db1:keys=30,expires=0,avg_ttl=0
`;

describe("parseInfo", () => {
  it("groups fields under their section", () => {
    const s = parseInfo(INFO);
    expect(s.Server.redis_version).toBe("7.2.4");
    expect(s.Clients.connected_clients).toBe("42");
    expect(s.Memory.maxmemory_policy).toBe("allkeys-lru");
  });

  it("puts fields before any heading in Server", () => {
    expect(parseInfo("redis_version:7.0.0").Server.redis_version).toBe("7.0.0");
  });

  it("keeps colons that appear in a value", () => {
    const s = parseInfo("# Server\nconfig_file:/etc/redis:custom.conf");
    expect(s.Server.config_file).toBe("/etc/redis:custom.conf");
  });

  it("survives CRLF line endings, which is what the wire actually sends", () => {
    expect(parseInfo("# Server\r\nredis_version:7.2.4\r\n").Server.redis_version).toBe("7.2.4");
  });

  it("ignores blank and malformed lines", () => {
    const s = parseInfo("# Server\n\nnot-a-field\nredis_version:7\n");
    expect(s.Server).toEqual({ redis_version: "7" });
  });
});

describe("infoValue", () => {
  it("finds a field regardless of section", () => {
    expect(infoValue(parseInfo(INFO), "maxmemory_policy")).toBe("allkeys-lru");
  });

  it("returns undefined for an absent field", () => {
    expect(infoValue(parseInfo(INFO), "nope")).toBeUndefined();
  });
});

describe("parseKeyspace", () => {
  it("reads keys, expires and average TTL per database", () => {
    expect(parseKeyspace(parseInfo(INFO))).toEqual([
      { db: "db0", keys: 120, expires: 15, avgTtlMs: 3600 },
      { db: "db1", keys: 30, expires: 0, avgTtlMs: 0 },
    ]);
  });

  it("totals keys across databases", () => {
    expect(totalKeys(parseKeyspace(parseInfo(INFO)))).toBe(150);
  });

  it("returns nothing when the server has no keys", () => {
    expect(parseKeyspace(parseInfo("# Keyspace"))).toEqual([]);
  });
});

describe("hitRatio", () => {
  it("is the share of lookups that hit", () => {
    expect(hitRatio(parseInfo(INFO))).toBeCloseTo(90);
  });

  it("is undefined with no traffic, rather than reporting 0%", () => {
    expect(hitRatio(parseInfo("# Stats\nkeyspace_hits:0\nkeyspace_misses:0"))).toBeUndefined();
  });
});

describe("memoryPressure", () => {
  it("is used over maxmemory", () => {
    expect(memoryPressure(parseInfo(INFO))).toBeCloseTo(50);
  });

  it("is undefined when maxmemory is unlimited", () => {
    expect(memoryPressure(parseInfo("# Memory\nused_memory:100\nmaxmemory:0"))).toBeUndefined();
  });
});

describe("healthMetrics", () => {
  const byId = (text: string) => Object.fromEntries(healthMetrics(parseInfo(text)).map((m) => [m.id, m]));

  it("reports memory against the limit", () => {
    expect(byId(INFO).memory.value).toBe("1.00 MB of 2.00 MB (50%)");
    expect(byId(INFO).memory.severity).toBe("ok");
  });

  it("escalates as memory fills", () => {
    const near = "# Memory\nused_memory:1900000\nmaxmemory:2000000";
    expect(byId(near).memory.severity).toBe("bad");
  });

  it("warns when no maxmemory is set at all", () => {
    const m = byId("# Memory\nused_memory:100\nmaxmemory:0").memory;
    expect(m.severity).toBe("unknown");
    expect(m.detail).toMatch(/maxmemory is 0/);
  });

  it("treats fragmentation below 1 as worse than high fragmentation", () => {
    expect(byId("# Memory\nmem_fragmentation_ratio:0.60").fragmentation.severity).toBe("bad");
    expect(byId("# Memory\nmem_fragmentation_ratio:1.80").fragmentation.severity).toBe("warn");
    expect(byId("# Memory\nmem_fragmentation_ratio:1.10").fragmentation.severity).toBe("ok");
  });

  it("warns about noeviction only when a limit exists", () => {
    expect(byId("# Memory\nmaxmemory:100\nmaxmemory_policy:noeviction").policy.severity).toBe("warn");
    expect(byId("# Memory\nmaxmemory:0\nmaxmemory_policy:noeviction").policy.severity).toBe("ok");
  });

  it("flags any eviction at all", () => {
    expect(byId(INFO).evicted.severity).toBe("warn");
    expect(byId("# Stats\nevicted_keys:0").evicted.severity).toBe("ok");
  });

  it("flags a failed save as bad", () => {
    const m = byId("# Persistence\nrdb_last_bgsave_status:err\naof_enabled:0").persistence;
    expect(m.severity).toBe("bad");
    expect(m.detail).toMatch(/stale/);
  });

  it("flags a failed AOF write only when AOF is on", () => {
    expect(byId("# Persistence\nrdb_last_bgsave_status:ok\naof_enabled:1\naof_last_write_status:err").persistence.severity).toBe("bad");
    expect(byId("# Persistence\nrdb_last_bgsave_status:ok\naof_enabled:0\naof_last_write_status:err").persistence.severity).toBe("ok");
  });

  it("reports replica link state on a replica", () => {
    const m = byId("# Replication\nrole:slave\nmaster_link_status:down");
    expect(m.replication.severity).toBe("bad");
  });

  it("reports replica count on a primary", () => {
    expect(byId(INFO).replication.value).toBe("1");
  });

  it("escalates client count towards maxclients", () => {
    expect(byId("# Clients\nconnected_clients:9500\nmaxclients:10000").clients.severity).toBe("bad");
    expect(byId("# Clients\nconnected_clients:7500\nmaxclients:10000").clients.severity).toBe("warn");
    expect(byId(INFO).clients.severity).toBe("ok");
  });

  it("never throws on an empty INFO", () => {
    expect(() => healthMetrics({})).not.toThrow();
    expect(healthMetrics({}).every((m) => m.value !== undefined)).toBe(true);
  });
});

describe("orderedSections", () => {
  it("uses the reading order and puts unknown sections last", () => {
    const s = parseInfo("# Keyspace\ndb0:keys=1,expires=0,avg_ttl=0\n# Weird\na:1\n# Memory\nused_memory:1");
    expect(orderedSections(s)).toEqual(["Memory", "Keyspace", "Weird"]);
  });
});

describe("parseCommandStats", () => {
  it("parses and sorts by total time, not call count", () => {
    const s = parseInfo(
      "# Commandstats\ncmdstat_get:calls=1000,usec=2000,usec_per_call=2.00,rejected_calls=0,failed_calls=0\n" +
        "cmdstat_keys:calls=2,usec=900000,usec_per_call=450000.00,rejected_calls=0,failed_calls=1",
    );
    const stats = parseCommandStats(s);
    expect(stats[0].command).toBe("keys");
    expect(stats[0].usec).toBe(900000);
    expect(stats[0].failed).toBe(1);
    expect(stats[1].command).toBe("get");
  });

  it("returns nothing when the section is absent", () => {
    expect(parseCommandStats({})).toEqual([]);
  });
});

describe("formatting", () => {
  it("scales bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.00 KB");
    expect(formatBytes(1048576)).toBe("1.00 MB");
    expect(formatBytes(undefined)).toBe("—");
  });

  it("drops zero units from an uptime", () => {
    expect(formatUptime(93784)).toBe("1d 2h 3m");
    expect(formatUptime(45)).toBe("45s");
    expect(formatUptime(undefined)).toBe("—");
  });
});
