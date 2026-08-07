import { describe, it, expect } from "vitest";
import {
  STORES,
  WORKSPACE_KIND,
  clearWorkspace,
  exportWorkspace,
  formatBytes,
  parseWorkspace,
  presentStores,
  redactPath,
  restoreWorkspace,
  storageFootprint,
  storesWithSecrets,
  type StorageLike,
} from "./workspace";

/** In-memory stand-in for localStorage. */
function memStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = v; },
    removeItem: (k) => { delete data[k]; },
  };
}

const persisted = (state: unknown) => JSON.stringify({ state, version: 0 });

describe("STORES", () => {
  it("covers every store the app persists", () => {
    // Guards the thing that makes a backup silently incomplete: a new store
    // that nobody added here.
    expect(STORES.map((s) => s.key).sort()).toEqual([
      "devhelper-ai",
      "devhelper-api",
      "devhelper-app",
      "devhelper-db",
      "devhelper-debug",
      "devhelper-learn",
      "devhelper-projects",
      "devhelper-snippets",
      "devhelper-sound",
    ]);
  });

  it("has no duplicate keys", () => {
    expect(new Set(STORES.map((s) => s.key)).size).toBe(STORES.length);
  });

  it("knows the AI key is a secret", () => {
    expect(storesWithSecrets().map((s) => s.key)).toEqual(["devhelper-ai"]);
  });
});

describe("redactPath", () => {
  it("blanks a value inside the zustand state wrapper", () => {
    const out = redactPath({ state: { openaiKey: "sk-123", model: "x" }, version: 0 }, "openaiKey") as any;
    expect(out.state.openaiKey).toBe("");
    expect(out.state.model).toBe("x");
    expect(out.version).toBe(0);
  });

  it("works on an unwrapped object too", () => {
    expect((redactPath({ openaiKey: "sk-123" }, "openaiKey") as any).openaiKey).toBe("");
  });

  it("follows a nested path", () => {
    const out = redactPath({ state: { auth: { token: "t" } } }, "auth.token") as any;
    expect(out.state.auth.token).toBe("");
  });

  it("leaves the value alone when the path does not exist", () => {
    const input = { state: { a: 1 } };
    expect(redactPath(input, "b.c")).toEqual(input);
  });

  it("does not mutate the input", () => {
    const input = { state: { openaiKey: "sk-123" }, version: 0 };
    redactPath(input, "openaiKey");
    expect(input.state.openaiKey).toBe("sk-123");
  });

  it("passes non-objects through", () => {
    expect(redactPath("plain", "a")).toBe("plain");
    expect(redactPath(null, "a")).toBe(null);
  });
});

describe("presentStores", () => {
  it("lists only the stores that hold something", () => {
    const storage = memStorage({ "devhelper-api": persisted({}), "devhelper-app": persisted({}) });
    expect(presentStores(storage).map((s) => s.key)).toEqual(["devhelper-api", "devhelper-app"]);
  });

  it("treats an empty string as present, since that is what was written", () => {
    expect(presentStores(memStorage({ "devhelper-api": "" })).map((s) => s.key)).toEqual(["devhelper-api"]);
  });
});

describe("exportWorkspace", () => {
  const storage = () =>
    memStorage({
      "devhelper-api": persisted({ requests: { a: 1 } }),
      "devhelper-ai": persisted({ openaiKey: "sk-secret", ollamaModel: "llama" }),
    });

  it("collects every present store", () => {
    const file = JSON.parse(exportWorkspace(storage()));
    expect(file.kind).toBe(WORKSPACE_KIND);
    expect(Object.keys(file.stores).sort()).toEqual(["devhelper-ai", "devhelper-api"]);
  });

  it("redacts secrets by default and says so", () => {
    const file = JSON.parse(exportWorkspace(storage()));
    expect(file.secretsRedacted).toBe(true);
    expect(file.stores["devhelper-ai"].state.openaiKey).toBe("");
    expect(file.stores["devhelper-ai"].state.ollamaModel).toBe("llama");
  });

  it("includes them only when asked", () => {
    const file = JSON.parse(exportWorkspace(storage(), { includeSecrets: true }));
    expect(file.secretsRedacted).toBe(false);
    expect(file.stores["devhelper-ai"].state.openaiKey).toBe("sk-secret");
  });

  it("never mutates what is in storage", () => {
    const s = storage();
    exportWorkspace(s);
    expect(JSON.parse(s.data["devhelper-ai"]).state.openaiKey).toBe("sk-secret");
  });

  it("honours a subset", () => {
    const file = JSON.parse(exportWorkspace(storage(), { only: ["devhelper-api"] }));
    expect(Object.keys(file.stores)).toEqual(["devhelper-api"]);
  });

  it("carries an unparseable value through rather than dropping it", () => {
    const file = JSON.parse(exportWorkspace(memStorage({ "devhelper-api": "not json" })));
    expect(file.stores["devhelper-api"]).toBe("not json");
  });

  it("records the app version and timestamp it was given", () => {
    const file = JSON.parse(exportWorkspace(storage(), { appVersion: "0.2.0", exportedAt: "2026-08-07T00:00:00Z" }));
    expect(file.appVersion).toBe("0.2.0");
    expect(file.exportedAt).toBe("2026-08-07T00:00:00Z");
  });
});

describe("parseWorkspace", () => {
  it("reports invalid JSON rather than throwing", () => {
    expect(parseWorkspace("{oops").problems[0]).toMatch(/Not valid JSON/);
  });

  it("rejects a document that is not a workspace", () => {
    expect(parseWorkspace("[1,2]").problems[0]).toMatch(/not a workspace/);
  });

  it("notes a foreign kind but still reads the stores", () => {
    const r = parseWorkspace(JSON.stringify({ kind: "other", stores: { "devhelper-api": {} } }));
    expect(r.problems.join(" ")).toMatch(/Unexpected file kind/);
    expect(r.known.map((s) => s.key)).toEqual(["devhelper-api"]);
  });

  it("warns about a newer file version", () => {
    const r = parseWorkspace(JSON.stringify({ kind: WORKSPACE_KIND, version: 99, stores: {} }));
    expect(r.problems.join(" ")).toMatch(/newer than this build/);
  });

  it("names store keys this build does not have", () => {
    const r = parseWorkspace(JSON.stringify({ kind: WORKSPACE_KIND, stores: { "devhelper-future": {} } }));
    expect(r.unknownKeys).toEqual(["devhelper-future"]);
    expect(r.known).toEqual([]);
    expect(r.problems.join(" ")).toMatch(/not part of this build/);
  });

  it("reports the redaction flag so a restore can warn", () => {
    expect(parseWorkspace(exportWorkspace(memStorage({ "devhelper-ai": persisted({ openaiKey: "k" }) }))).secretsRedacted).toBe(true);
  });

  it("round-trips an export", () => {
    const source = memStorage({ "devhelper-api": persisted({ requests: { a: 1 } }) });
    const r = parseWorkspace(exportWorkspace(source, { includeSecrets: true }));
    expect(r.problems).toEqual([]);
    expect(r.known.map((s) => s.key)).toEqual(["devhelper-api"]);
  });
});

describe("restoreWorkspace", () => {
  const file = exportWorkspace(
    memStorage({ "devhelper-api": persisted({ requests: { a: 1 } }), "devhelper-app": persisted({ theme: "light" }) }),
    { includeSecrets: true },
  );

  it("writes every known store back", () => {
    const target = memStorage();
    const r = restoreWorkspace(target, parseWorkspace(file));
    expect(r.restored.sort()).toEqual(["devhelper-api", "devhelper-app"]);
    expect(JSON.parse(target.data["devhelper-app"]).state.theme).toBe("light");
  });

  it("replaces wholesale rather than merging", () => {
    const target = memStorage({ "devhelper-api": persisted({ requests: { existing: 9 } }) });
    restoreWorkspace(target, parseWorkspace(file));
    expect(JSON.parse(target.data["devhelper-api"]).state.requests).toEqual({ a: 1 });
  });

  it("honours a subset and reports what it skipped", () => {
    const target = memStorage();
    const r = restoreWorkspace(target, parseWorkspace(file), ["devhelper-api"]);
    expect(r.restored).toEqual(["devhelper-api"]);
    expect(r.skipped).toEqual(["devhelper-app"]);
    expect(target.data["devhelper-app"]).toBeUndefined();
  });

  it("leaves stores the file does not mention alone", () => {
    const target = memStorage({ "devhelper-snippets": persisted({ snippets: [1] }) });
    restoreWorkspace(target, parseWorkspace(file));
    expect(target.data["devhelper-snippets"]).toBeDefined();
  });
});

describe("clearWorkspace", () => {
  it("removes every store, not just one", () => {
    const target = memStorage({
      "devhelper-app": "a",
      "devhelper-api": "b",
      "devhelper-snippets": "c",
      "unrelated": "keep",
    });
    const cleared = clearWorkspace(target);
    expect(cleared.sort()).toEqual(["devhelper-api", "devhelper-app", "devhelper-snippets"]);
    expect(target.data).toEqual({ unrelated: "keep" });
  });

  it("reports only the keys that existed", () => {
    expect(clearWorkspace(memStorage({ "devhelper-app": "a" }))).toEqual(["devhelper-app"]);
  });

  it("honours a subset", () => {
    const target = memStorage({ "devhelper-app": "a", "devhelper-api": "b" });
    clearWorkspace(target, ["devhelper-app"]);
    expect(Object.keys(target.data)).toEqual(["devhelper-api"]);
  });
});

describe("storageFootprint", () => {
  it("orders the biggest stores first and omits empty ones", () => {
    const target = memStorage({ "devhelper-api": "x".repeat(50), "devhelper-app": "y".repeat(10) });
    expect(storageFootprint(target)).toEqual([
      { key: "devhelper-api", bytes: 50 },
      { key: "devhelper-app", bytes: 10 },
    ]);
  });
});

describe("formatBytes", () => {
  it("scales through the units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
