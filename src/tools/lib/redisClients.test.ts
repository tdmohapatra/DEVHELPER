import { describe, it, expect } from "vitest";
import {
  parseClientList,
  describeClientFlags,
  clientConcerns,
  parseSlowlog,
  parsePubSubNumSub,
  asStringList,
  globMatches,
} from "./redisClients";

const CLIENT_LIST = [
  "id=7 addr=127.0.0.1:53210 laddr=127.0.0.1:6379 fd=9 name=worker-1 age=3600 idle=0 flags=N db=0 sub=0 psub=0 ssub=0 multi=-1 watch=0 qbuf=26 qbuf-free=20448 argv-mem=10 tot-mem=61466 events=r cmd=client|list user=default redir=-1 resp=2",
  "id=8 addr=10.0.0.5:41122 fd=10 name= age=120 idle=119 flags=b db=0 sub=0 psub=0 multi=-1 omem=2097152 tot-mem=2158618 events=r cmd=blpop user=default",
].join("\n");

describe("parseClientList", () => {
  it("parses one client per line", () => {
    const clients = parseClientList(CLIENT_LIST);
    expect(clients).toHaveLength(2);
    expect(clients[0]).toMatchObject({ id: "7", addr: "127.0.0.1:53210", name: "worker-1", age: 3600, idle: 0, lastCmd: "client|list" });
  });

  it("reads numeric fields as numbers", () => {
    const c = parseClientList(CLIENT_LIST)[1];
    expect(c.omem).toBe(2097152);
    expect(c.totMem).toBe(2158618);
    expect(c.idle).toBe(119);
  });

  it("keeps every field in raw for the ones not promoted", () => {
    expect(parseClientList(CLIENT_LIST)[0].raw.resp).toBe("2");
    expect(parseClientList(CLIENT_LIST)[0].raw["qbuf-free"]).toBe("20448");
  });

  it("handles an empty client name", () => {
    expect(parseClientList(CLIENT_LIST)[1].name).toBe("");
  });

  it("keeps a value containing an equals sign whole", () => {
    const c = parseClientList("id=1 addr=1.1.1.1:1 name=a=b=c flags=N")[0];
    expect(c.name).toBe("a=b=c");
  });

  it("ignores blank lines and lines with no recognisable fields", () => {
    expect(parseClientList("\n\nnonsense\n")).toEqual([]);
  });

  it("defaults multi to -1, which is what Redis means by no transaction", () => {
    expect(parseClientList("id=1 addr=x:1")[0].multi).toBe(-1);
  });
});

describe("describeClientFlags", () => {
  it("expands each letter", () => {
    expect(describeClientFlags("b")).toEqual(["blocked on a blocking call"]);
    expect(describeClientFlags("Sx")).toEqual(["replica connection", "in a MULTI/EXEC transaction"]);
  });

  it("keeps the lone N, which means nothing special", () => {
    expect(describeClientFlags("N")).toEqual(["no special flag"]);
  });

  it("drops N when other flags are present", () => {
    expect(describeClientFlags("Nb")).toEqual(["blocked on a blocking call"]);
  });

  it("names an unknown flag rather than hiding it", () => {
    expect(describeClientFlags("Z")).toEqual(["unknown flag Z"]);
  });
});

describe("clientConcerns", () => {
  it("flags a large output buffer first, since that ends in a disconnect", () => {
    const concerns = clientConcerns(parseClientList(CLIENT_LIST));
    expect(concerns).toHaveLength(1);
    expect(concerns[0].client.id).toBe("8");
    expect(concerns[0].reason).toMatch(/Output buffer is 2048 KB/);
  });

  it("flags a long-idle connection", () => {
    const concerns = clientConcerns(parseClientList("id=1 addr=x:1 idle=7200 flags=N omem=0"));
    expect(concerns[0].reason).toMatch(/Idle for 2h/);
  });

  it("flags an open MULTI", () => {
    const concerns = clientConcerns(parseClientList("id=1 addr=x:1 idle=0 flags=x multi=4 omem=0"));
    expect(concerns[0].reason).toMatch(/4 commands queued/);
  });

  it("says nothing about a healthy client", () => {
    expect(clientConcerns(parseClientList("id=1 addr=x:1 idle=1 flags=N omem=0 multi=-1"))).toEqual([]);
  });
});

describe("parseSlowlog", () => {
  it("parses entries including the client fields added in Redis 4", () => {
    const reply = [
      [14, 1767225600, 15000, ["KEYS", "*"], "10.0.0.5:41122", "reporting"],
      [13, 1767225000, 900, ["GET", "a"], "", ""],
    ];
    const entries = parseSlowlog(reply);
    expect(entries[0]).toMatchObject({ id: "14", usec: 15000, clientAddr: "10.0.0.5:41122", clientName: "reporting" });
    expect(entries[0].command).toEqual(["KEYS", "*"]);
    // An empty name is absent, not a client called "".
    expect(entries[1].clientName).toBeUndefined();
  });

  it("returns nothing for a non-array reply", () => {
    expect(parseSlowlog(null)).toEqual([]);
    expect(parseSlowlog("OK")).toEqual([]);
  });

  it("skips malformed rows instead of throwing", () => {
    expect(parseSlowlog([[1, 2]])).toEqual([]);
  });
});

describe("parsePubSubNumSub", () => {
  it("walks the flat channel/count reply in pairs", () => {
    expect(parsePubSubNumSub(["orders", 3, "events", 7])).toEqual([
      { channel: "events", subscribers: 7 },
      { channel: "orders", subscribers: 3 },
    ]);
  });

  it("sorts by subscriber count, then by name", () => {
    const out = parsePubSubNumSub(["b", 1, "a", 1, "c", 9]);
    expect(out.map((c) => c.channel)).toEqual(["c", "a", "b"]);
  });

  it("ignores a trailing unpaired element", () => {
    expect(parsePubSubNumSub(["orders", 3, "dangling"])).toEqual([{ channel: "orders", subscribers: 3 }]);
  });

  it("returns nothing for a non-array reply", () => {
    expect(parsePubSubNumSub(undefined)).toEqual([]);
  });
});

describe("asStringList", () => {
  it("stringifies array elements and drops nulls", () => {
    expect(asStringList(["a", 1, null, "b"])).toEqual(["a", "1", "b"]);
  });

  it("returns nothing for a non-array", () => {
    expect(asStringList("a")).toEqual([]);
  });
});

describe("globMatches", () => {
  it("matches * across any characters", () => {
    expect(globMatches("user:*", "user:42")).toBe(true);
    expect(globMatches("user:*", "order:42")).toBe(false);
  });

  it("matches ? as exactly one character", () => {
    expect(globMatches("k?y", "key")).toBe(true);
    expect(globMatches("k?y", "kay")).toBe(true);
    expect(globMatches("k?y", "ky")).toBe(false);
  });

  it("supports character classes and ranges", () => {
    expect(globMatches("h[ae]llo", "hallo")).toBe(true);
    expect(globMatches("h[ae]llo", "hillo")).toBe(false);
    expect(globMatches("item:[0-9]", "item:7")).toBe(true);
  });

  it("supports a negated class", () => {
    expect(globMatches("h[^e]llo", "hallo")).toBe(true);
    expect(globMatches("h[^e]llo", "hello")).toBe(false);
  });

  it("treats an escaped wildcard as a literal", () => {
    expect(globMatches("a\\*b", "a*b")).toBe(true);
    expect(globMatches("a\\*b", "axb")).toBe(false);
  });

  it("does not let regex metacharacters in the pattern act as syntax", () => {
    expect(globMatches("a.b", "a.b")).toBe(true);
    expect(globMatches("a.b", "axb")).toBe(false);
    expect(globMatches("total(1)", "total(1)")).toBe(true);
  });

  it("anchors, so a pattern must cover the whole value", () => {
    expect(globMatches("user", "user:1")).toBe(false);
  });

  it("treats an unterminated class as a literal bracket", () => {
    expect(globMatches("a[bc", "a[bc")).toBe(true);
  });
});
