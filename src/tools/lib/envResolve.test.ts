import { describe, it, expect } from "vitest";
import type { Environment } from "./apiTypes";
import {
  danglingReferences,
  eligibleParents,
  inheritanceChain,
  missingVariables,
  ownVariables,
  resolveVariables,
  resolvedVariables,
  toKeyValues,
  unusedVariables,
  wouldCycle,
} from "./envResolve";

const kv = (key: string, value: string, enabled = true) => ({ id: key, key, value, enabled });

const env = (id: string, name: string, vars: [string, string][], extendsId?: string): Environment => ({
  id,
  name,
  isProduction: false,
  variables: vars.map(([k, v]) => kv(k, v)),
  extendsId,
});

const base = env("base", "Base", [["HOST", "api.internal"], ["TIMEOUT", "30"]]);
const qa = env("qa", "QA", [["HOST", "qa.internal"]], "base");
const uat = env("uat", "UAT", [["LOG", "debug"]], "qa");

describe("inheritanceChain", () => {
  it("runs base first and self last", () => {
    expect(inheritanceChain(uat, [base, qa, uat]).map((e) => e.id)).toEqual(["base", "qa", "uat"]);
  });

  it("is just the environment when it inherits from nothing", () => {
    expect(inheritanceChain(base, [base]).map((e) => e.id)).toEqual(["base"]);
  });

  it("stops rather than hanging on a cycle", () => {
    const a = env("a", "A", [], "b");
    const b = env("b", "B", [], "a");
    expect(inheritanceChain(a, [a, b]).map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("ignores a parent that does not exist", () => {
    const orphan = env("o", "Orphan", [["X", "1"]], "missing");
    expect(inheritanceChain(orphan, [orphan]).map((e) => e.id)).toEqual(["o"]);
  });
});

describe("ownVariables", () => {
  it("keeps enabled, named variables only", () => {
    const e: Environment = {
      id: "e",
      name: "E",
      isProduction: false,
      variables: [kv("A", "1"), kv("B", "2", false), kv("", "3")],
    };
    expect(ownVariables(e)).toEqual({ A: "1" });
  });
});

describe("resolveVariables", () => {
  it("lets a child override its parent", () => {
    expect(resolveVariables(qa, [base, qa])).toEqual({ HOST: "qa.internal", TIMEOUT: "30" });
  });

  it("resolves through a whole chain", () => {
    expect(resolveVariables(uat, [base, qa, uat])).toEqual({
      HOST: "qa.internal",
      TIMEOUT: "30",
      LOG: "debug",
    });
  });

  it("treats an empty child value as a deliberate override, not an absence", () => {
    const child = env("c", "C", [["TIMEOUT", ""]], "base");
    expect(resolveVariables(child, [base, child]).TIMEOUT).toBe("");
  });
});

describe("resolvedVariables", () => {
  it("labels where each winning value came from", () => {
    const rows = resolvedVariables(qa, [base, qa]);
    const host = rows.find((r) => r.key === "HOST")!;
    const timeout = rows.find((r) => r.key === "TIMEOUT")!;
    expect(host).toMatchObject({ origin: "override", source: "QA", shadows: "api.internal" });
    expect(timeout).toMatchObject({ origin: "inherited", source: "Base" });
  });

  it("calls a variable the parent never had 'own'", () => {
    const rows = resolvedVariables(uat, [base, qa, uat]);
    expect(rows.find((r) => r.key === "LOG")).toMatchObject({ origin: "own", shadows: undefined });
  });

  it("is sorted by key", () => {
    expect(resolvedVariables(uat, [base, qa, uat]).map((r) => r.key)).toEqual(["HOST", "LOG", "TIMEOUT"]);
  });
});

describe("wouldCycle", () => {
  it("rejects inheriting from yourself", () => {
    expect(wouldCycle("qa", "qa", [base, qa])).toBe(true);
  });

  it("rejects inheriting from your own descendant", () => {
    expect(wouldCycle("base", "uat", [base, qa, uat])).toBe(true);
  });

  it("allows an unrelated parent", () => {
    const other = env("other", "Other", []);
    expect(wouldCycle("other", "base", [base, qa, uat, other])).toBe(false);
  });
});

describe("eligibleParents", () => {
  it("excludes self and descendants", () => {
    expect(eligibleParents(qa, [base, qa, uat]).map((e) => e.id)).toEqual(["base"]);
  });
});

describe("missingVariables", () => {
  it("names the variables nothing defines", () => {
    expect(missingVariables(["{{HOST}}/x", "Bearer {{TOKEN}}"], { HOST: "h" })).toEqual(["TOKEN"]);
  });

  it("is empty when everything resolves", () => {
    expect(missingVariables(["{{HOST}}"], { HOST: "h" })).toEqual([]);
  });

  it("tolerates undefined strings", () => {
    expect(missingVariables([undefined as unknown as string], {})).toEqual([]);
  });
});

describe("unusedVariables", () => {
  it("names variables nothing references", () => {
    expect(unusedVariables(["{{HOST}}"], { HOST: "h", LEGACY: "x" })).toEqual(["LEGACY"]);
  });
});

describe("danglingReferences", () => {
  it("finds a variable whose value references a missing one", () => {
    expect(danglingReferences({ BASE_URL: "{{HOST}}/api" })).toEqual([{ key: "BASE_URL", missing: ["HOST"] }]);
  });

  it("is quiet when the reference resolves", () => {
    expect(danglingReferences({ HOST: "h", BASE_URL: "{{HOST}}/api" })).toEqual([]);
  });
});

describe("toKeyValues", () => {
  it("produces sorted, enabled, stably-identified rows", () => {
    expect(toKeyValues({ B: "2", A: "1" })).toEqual([
      { id: "A", key: "A", value: "1", enabled: true },
      { id: "B", key: "B", value: "2", enabled: true },
    ]);
  });

  it("accepts a custom id factory", () => {
    expect(toKeyValues({ A: "1" }, (k) => `x-${k}`)[0].id).toBe("x-A");
  });
});
