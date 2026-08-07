import { describe, it, expect } from "vitest";
import type { Environment } from "./apiTypes";
import {
  ENV_FILE_KIND,
  exportEnvironments,
  mergeEnvironments,
  parseEnvironmentsFile,
  redactEnvironment,
  secretKeys,
  uniqueName,
} from "./envIo";

const kv = (key: string, value: string) => ({ id: key, key, value, enabled: true });

const dev: Environment = {
  id: "dev",
  name: "DEV",
  isProduction: false,
  variables: [kv("BASE_URL", "https://dev.api"), kv("API_KEY", "sk-secret-123")],
};

describe("secretKeys / redactEnvironment", () => {
  it("names the variables that would lose their value", () => {
    expect(secretKeys(dev)).toEqual(["API_KEY"]);
  });

  it("keeps the key and drops only the value", () => {
    const r = redactEnvironment(dev);
    expect(r.variables.map((v) => v.key)).toEqual(["BASE_URL", "API_KEY"]);
    expect(r.variables[1].value).toBe("");
    expect(r.variables[0].value).toBe("https://dev.api");
  });

  it("does not mutate the original", () => {
    redactEnvironment(dev);
    expect(dev.variables[1].value).toBe("sk-secret-123");
  });
});

describe("exportEnvironments", () => {
  it("redacts secrets by default", () => {
    const file = JSON.parse(exportEnvironments([dev]));
    expect(file.kind).toBe(ENV_FILE_KIND);
    expect(file.secretsRedacted).toBe(true);
    expect(file.environments[0].variables[1].value).toBe("");
  });

  it("includes them only when asked", () => {
    const file = JSON.parse(exportEnvironments([dev], { includeSecrets: true }));
    expect(file.secretsRedacted).toBe(false);
    expect(file.environments[0].variables[1].value).toBe("sk-secret-123");
  });

  it("round-trips through the parser", () => {
    const parsed = parseEnvironmentsFile(exportEnvironments([dev], { includeSecrets: true }));
    expect(parsed.problems).toEqual([]);
    expect(parsed.environments[0]).toMatchObject({ id: "dev", name: "DEV" });
  });
});

describe("parseEnvironmentsFile", () => {
  it("reports invalid JSON rather than throwing", () => {
    const r = parseEnvironmentsFile("{nope");
    expect(r.environments).toEqual([]);
    expect(r.problems[0]).toMatch(/Not valid JSON/);
  });

  it("accepts a bare array, which is what copying app storage gives you", () => {
    const r = parseEnvironmentsFile(JSON.stringify([{ name: "QA", variables: [{ key: "A", value: "1" }] }]));
    expect(r.environments).toHaveLength(1);
    expect(r.environments[0].variables[0]).toMatchObject({ key: "A", value: "1", enabled: true });
  });

  it("notes a foreign file kind but still reads what it can", () => {
    const r = parseEnvironmentsFile(JSON.stringify({ kind: "postman", environments: [{ name: "QA" }] }));
    expect(r.problems.join(" ")).toMatch(/Unexpected file kind/);
    expect(r.environments).toHaveLength(1);
  });

  it("warns when the file is from a newer version", () => {
    const r = parseEnvironmentsFile(JSON.stringify({ kind: ENV_FILE_KIND, version: 99, environments: [] }));
    expect(r.problems.join(" ")).toMatch(/newer than this build/);
  });

  it("describes an unreadable entry instead of dropping it silently", () => {
    const r = parseEnvironmentsFile(JSON.stringify([{ variables: [] }, "nope"]));
    expect(r.environments).toEqual([]);
    expect(r.problems).toHaveLength(2);
  });

  it("drops an inheritance link to an environment not in the file, and says so", () => {
    const r = parseEnvironmentsFile(JSON.stringify([{ id: "a", name: "A", extendsId: "elsewhere" }]));
    expect(r.environments[0].extendsId).toBeUndefined();
    expect(r.problems.join(" ")).toMatch(/inherits from an environment that is not in this file/);
  });

  it("keeps an inheritance link that resolves inside the file", () => {
    const r = parseEnvironmentsFile(
      JSON.stringify([{ id: "base", name: "Base" }, { id: "qa", name: "QA", extendsId: "base" }]),
    );
    expect(r.environments[1].extendsId).toBe("base");
    expect(r.problems).toEqual([]);
  });

  it("reads connections, coercing field values to strings", () => {
    const r = parseEnvironmentsFile(
      JSON.stringify([{ name: "QA", connections: [{ kind: "redis", name: "cache", fields: { host: "h", port: 6379 } }] }]),
    );
    expect(r.environments[0].connections?.[0].fields).toEqual({ host: "h", port: "6379" });
  });

  it("reports the file's redaction flag", () => {
    expect(parseEnvironmentsFile(exportEnvironments([dev])).secretsRedacted).toBe(true);
  });

  it("skips variables with no key", () => {
    const r = parseEnvironmentsFile(JSON.stringify([{ name: "QA", variables: [{ key: "", value: "x" }, { key: "A", value: "1" }] }]));
    expect(r.environments[0].variables).toHaveLength(1);
  });
});

describe("uniqueName", () => {
  it("returns the name when it is free", () => {
    expect(uniqueName("QA", new Set())).toBe("QA");
  });

  it("counts up past every taken variant", () => {
    expect(uniqueName("QA", new Set(["QA", "QA (2)"]))).toBe("QA (3)");
  });
});

describe("mergeEnvironments", () => {
  const local: Environment[] = [{ id: "l1", name: "DEV", isProduction: false, variables: [kv("A", "local")] }];
  const incoming: Environment[] = [
    { id: "i1", name: "DEV", isProduction: false, variables: [kv("A", "imported")] },
    { id: "i2", name: "QA", isProduction: false, variables: [] },
  ];

  it("adds what does not clash regardless of mode", () => {
    for (const mode of ["skip", "replace", "rename"] as const) {
      expect(mergeEnvironments(local, incoming, mode).added).toEqual(["QA"]);
    }
  });

  it("skip keeps the local value", () => {
    const r = mergeEnvironments(local, incoming, "skip");
    expect(r.skipped).toEqual(["DEV"]);
    expect(r.environments.find((e) => e.name === "DEV")!.variables[0].value).toBe("local");
  });

  it("replace prefers the file but keeps the local id", () => {
    const r = mergeEnvironments(local, incoming, "replace");
    expect(r.replaced).toEqual(["DEV"]);
    const dev2 = r.environments.find((e) => e.name === "DEV")!;
    expect(dev2.variables[0].value).toBe("imported");
    expect(dev2.id).toBe("l1");
  });

  it("rename keeps both", () => {
    const r = mergeEnvironments(local, incoming, "rename");
    expect(r.renamed).toEqual(["DEV (2)"]);
    expect(r.environments.filter((e) => e.name.startsWith("DEV"))).toHaveLength(2);
  });

  it("matches on name, so the same environment from two machines is one environment", () => {
    const r = mergeEnvironments(local, incoming, "replace");
    expect(r.environments).toHaveLength(2);
  });

  it("gives an imported environment a free id when its own collides", () => {
    const clash: Environment[] = [{ id: "l1", name: "OTHER", isProduction: false, variables: [] }];
    const r = mergeEnvironments(local, clash, "skip");
    expect(r.environments.map((e) => e.id)).toEqual(["l1", "l1-2"]);
  });

  it("rewrites an inheritance link onto the id the parent ended up with", () => {
    const withParent: Environment[] = [
      { id: "i1", name: "Base", isProduction: false, variables: [] },
      { id: "i2", name: "QA", isProduction: false, variables: [], extendsId: "i1" },
    ];
    const collide: Environment[] = [{ id: "i1", name: "Existing", isProduction: false, variables: [] }];
    const r = mergeEnvironments(collide, withParent, "skip");
    const base = r.environments.find((e) => e.name === "Base")!;
    const qa = r.environments.find((e) => e.name === "QA")!;
    expect(base.id).toBe("i1-2");
    expect(qa.extendsId).toBe("i1-2");
  });

  it("points a skipped parent's children at the local environment that stood in for it", () => {
    const withParent: Environment[] = [
      { id: "i1", name: "DEV", isProduction: false, variables: [] },
      { id: "i2", name: "QA", isProduction: false, variables: [], extendsId: "i1" },
    ];
    const r = mergeEnvironments(local, withParent, "skip");
    expect(r.environments.find((e) => e.name === "QA")!.extendsId).toBe("l1");
  });

  it("does not mutate the existing array", () => {
    const before = [...local];
    mergeEnvironments(local, incoming, "rename");
    expect(local).toEqual(before);
  });
});
