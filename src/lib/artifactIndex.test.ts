import { describe, it, expect } from "vitest";
import { buildArtifactIndex, countByKind, searchArtifacts, KIND_LABEL } from "./artifactIndex";

const sources = {
  requests: [{ id: "r1", name: "Create order", method: "POST", url: "https://api.dev/orders" }],
  environments: [{ id: "e1", name: "PROD", isProduction: true, variables: [1, 2, 3] }],
  connections: [{ id: "c1", name: "prod-readonly", engine: "postgres", host: "db01", database: "sales" }],
  snippets: [{ id: "s1", title: "Kill port", language: "PowerShell", tags: ["windows", "net"] }],
  sessions: [{ id: "d1", name: "Checkout failure", events: [1, 2] }],
  projects: [{ id: "p1", name: "Billing", technologies: ["C#", "Postgres"] }],
};

describe("buildArtifactIndex", () => {
  it("covers every kind of saved artefact", () => {
    const kinds = buildArtifactIndex(sources).map((e) => e.kind);
    expect(new Set(kinds)).toEqual(new Set(Object.keys(KIND_LABEL)));
  });

  it("gives each entry a globally unique id, so two kinds can share a ref id", () => {
    const entries = buildArtifactIndex({ requests: [{ id: "x", name: "A" }], snippets: [{ id: "x", title: "B" }] });
    expect(new Set(entries.map((e) => e.id)).size).toBe(2);
    expect(entries.map((e) => e.refId)).toEqual(["x", "x"]);
  });

  it("routes each artefact to the tool that owns it", () => {
    const byKind = Object.fromEntries(buildArtifactIndex(sources).map((e) => [e.kind, e.toolId]));
    expect(byKind).toEqual({
      request: "api-tester",
      environment: "environments",
      connection: "database-toolkit",
      snippet: "snippet-library",
      session: "debug-session",
      project: "project-profiles",
    });
  });

  it("describes a request by method and URL", () => {
    expect(buildArtifactIndex(sources).find((e) => e.kind === "request")!.detail).toBe("POST https://api.dev/orders");
  });

  it("says so when a request has no URL yet", () => {
    expect(buildArtifactIndex({ requests: [{ id: "r", name: "Draft" }] })[0].detail).toBe("no URL");
  });

  it("flags a production environment", () => {
    expect(buildArtifactIndex(sources).find((e) => e.kind === "environment")!.detail).toMatch(/PRODUCTION/);
  });

  it("describes a server connection as engine and target", () => {
    expect(buildArtifactIndex(sources).find((e) => e.kind === "connection")!.detail).toBe("postgres · db01/sales");
  });

  it("uses the file path for a SQLite connection", () => {
    const e = buildArtifactIndex({ connections: [{ id: "c", name: "local", engine: "sqlite", filePath: "C:/db.sqlite" }] })[0];
    expect(e.detail).toBe("sqlite · C:/db.sqlite");
  });

  it("counts events on a debug session", () => {
    expect(buildArtifactIndex(sources).find((e) => e.kind === "session")!.detail).toBe("2 event(s)");
  });

  it("says so when a project has no stack", () => {
    expect(buildArtifactIndex({ projects: [{ id: "p", name: "X" }] })[0].detail).toBe("no stack recorded");
  });

  it("is empty for no sources", () => {
    expect(buildArtifactIndex({})).toEqual([]);
  });
});

describe("searchArtifacts", () => {
  const entries = buildArtifactIndex(sources);

  it("returns nothing for an empty query", () => {
    expect(searchArtifacts(entries, "  ")).toEqual([]);
  });

  it("finds an artefact by name", () => {
    expect(searchArtifacts(entries, "checkout")[0].name).toBe("Checkout failure");
  });

  it("ranks a name match above a match in the detail line", () => {
    const index = buildArtifactIndex({
      requests: [
        { id: "a", name: "orders", method: "GET", url: "https://api/x" },
        { id: "b", name: "Something else", method: "GET", url: "https://api/orders" },
      ],
    });
    expect(searchArtifacts(index, "orders")[0].name).toBe("orders");
  });

  it("ranks a keyword match above a detail match", () => {
    const index = buildArtifactIndex({
      snippets: [{ id: "s", title: "Cleanup", tags: ["docker"] }],
      projects: [{ id: "p", name: "Thing", technologies: [] }],
      connections: [{ id: "c", name: "Other", engine: "mysql", host: "docker-host" }],
    });
    const results = searchArtifacts(index, "docker");
    expect(results[0].name).toBe("Cleanup");
  });

  it("finds a connection by its engine", () => {
    expect(searchArtifacts(entries, "postgres").some((r) => r.name === "prod-readonly")).toBe(true);
  });

  it("finds a snippet by tag", () => {
    expect(searchArtifacts(entries, "windows")[0].name).toBe("Kill port");
  });

  it("reports match positions for a name hit so it can be highlighted", () => {
    expect(searchArtifacts(entries, "PROD")[0].positions.length).toBeGreaterThan(0);
  });

  it("respects the limit", () => {
    expect(searchArtifacts(entries, "o", 2)).toHaveLength(2);
  });

  it("returns nothing when nothing matches", () => {
    expect(searchArtifacts(entries, "zzzzqqq")).toEqual([]);
  });

  it("does not list one artefact twice when several fields match", () => {
    const index = buildArtifactIndex({ connections: [{ id: "c", name: "postgres", engine: "postgres", host: "postgres" }] });
    expect(searchArtifacts(index, "postgres")).toHaveLength(1);
  });
});

describe("countByKind", () => {
  it("counts every kind, including the empty ones", () => {
    expect(countByKind(buildArtifactIndex(sources))).toEqual({
      request: 1,
      environment: 1,
      connection: 1,
      snippet: 1,
      session: 1,
      project: 1,
    });
  });

  it("is all zeroes for an empty index", () => {
    expect(countByKind([])).toEqual({ request: 0, environment: 0, connection: 0, snippet: 0, session: 0, project: 0 });
  });
});
