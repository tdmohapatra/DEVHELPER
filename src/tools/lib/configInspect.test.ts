import { describe, it, expect } from "vitest";
import { flatten, parseConfig, diffConfigs, countConfigStates } from "./configInspect";

describe("flatten", () => {
  it("flattens nested objects with the .NET ':' separator", () => {
    const f = flatten({ ConnectionStrings: { Default: "Server=x" }, Logging: { LogLevel: { Default: "Information" } } });
    expect(f["ConnectionStrings:Default"]).toBe("Server=x");
    expect(f["Logging:LogLevel:Default"]).toBe("Information");
  });
  it("indexes arrays and preserves empty containers", () => {
    const f = flatten({ Hosts: ["a", "b"], Empty: {}, None: [] });
    expect(f["Hosts:0"]).toBe("a");
    expect(f["Hosts:1"]).toBe("b");
    expect(f.Empty).toBe("{}");
    expect(f.None).toBe("[]");
  });
  it("stringifies primitives", () => {
    const f = flatten({ Port: 8080, Enabled: true, Nothing: null });
    expect(f.Port).toBe("8080");
    expect(f.Enabled).toBe("true");
    expect(f.Nothing).toBe("null");
  });
});

describe("parseConfig", () => {
  it("reports errors instead of throwing", () => {
    expect(parseConfig("{ bad json").ok).toBe(false);
    expect(parseConfig("").ok).toBe(false);
    expect(parseConfig('{"A":1}').ok).toBe(true);
  });
});

describe("diffConfigs", () => {
  const dev = flatten({ BaseUrl: "https://dev", Timeout: 30, Db: { Password: "devpw" } });
  const prod = flatten({ BaseUrl: "https://prod", Timeout: 30, FeatureX: true });
  const rows = diffConfigs([dev, prod]);
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));

  it("marks changed / same / partial", () => {
    expect(byKey.BaseUrl.state).toBe("changed");
    expect(byKey.Timeout.state).toBe("same");
    expect(byKey["Db:Password"].state).toBe("partial"); // only in dev
    expect(byKey.FeatureX.state).toBe("partial"); // only in prod
  });
  it("flags secret keys", () => {
    expect(byKey["Db:Password"].secret).toBe(true);
    expect(byKey.BaseUrl.secret).toBe(false);
  });
  it("counts states", () => {
    const c = countConfigStates(rows);
    expect(c.changed).toBe(1);
    expect(c.same).toBe(1);
    expect(c.partial).toBe(2);
  });
  it("treats a single config as all-same", () => {
    expect(diffConfigs([dev]).every((r) => r.state === "same")).toBe(true);
  });
});
