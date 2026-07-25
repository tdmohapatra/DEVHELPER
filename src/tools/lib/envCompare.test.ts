import { describe, it, expect } from "vitest";
import { diffVariables, diffConnections, countStates, isSecretKey, maskValue } from "./envCompare";
import type { Environment } from "./apiTypes";

const kv = (key: string, value: string) => ({ id: key, key, value, enabled: true });

const dev: Environment = {
  id: "dev",
  name: "DEV",
  isProduction: false,
  variables: [kv("BASE_URL", "https://dev.api"), kv("TIMEOUT", "30"), kv("DB_PASSWORD", "devpass")],
  connections: [
    { id: "1", kind: "database", name: "orders", fields: { host: "dev-db", port: "5432" } },
    { id: "2", kind: "redis", name: "cache", fields: { host: "dev-redis" } },
  ],
};

const qa: Environment = {
  id: "qa",
  name: "QA",
  isProduction: false,
  variables: [kv("BASE_URL", "https://qa.api"), kv("TIMEOUT", "30"), kv("FEATURE_X", "true")],
  connections: [
    { id: "3", kind: "database", name: "orders", fields: { host: "qa-db", port: "5432" } },
  ],
};

describe("isSecretKey / maskValue", () => {
  it("flags sensitive keys", () => {
    expect(isSecretKey("DB_PASSWORD")).toBe(true);
    expect(isSecretKey("ApiKey")).toBe(true);
    expect(isSecretKey("ConnectionString")).toBe(true);
    expect(isSecretKey("BASE_URL")).toBe(false);
  });
  it("masks values but keeps ends", () => {
    expect(maskValue("supersecret")).toBe("su••••et");
    expect(maskValue("abc")).toBe("••••");
  });
});

describe("diffVariables", () => {
  const rows = diffVariables(dev, qa);
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  it("detects changed / same / removed / added", () => {
    expect(byKey.BASE_URL.state).toBe("changed");
    expect(byKey.TIMEOUT.state).toBe("same");
    expect(byKey.DB_PASSWORD.state).toBe("removed"); // in dev, not qa
    expect(byKey.FEATURE_X.state).toBe("added"); // in qa, not dev
  });
  it("marks secret keys", () => {
    expect(byKey.DB_PASSWORD.secret).toBe(true);
    expect(byKey.BASE_URL.secret).toBe(false);
  });
  it("counts states", () => {
    const c = countStates(rows);
    expect(c.changed).toBe(1);
    expect(c.removed).toBe(1);
    expect(c.added).toBe(1);
    expect(c.same).toBe(1);
  });
});

describe("diffConnections", () => {
  const rows = diffConnections(dev, qa);
  const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
  it("changed when fields differ, removed when only in A", () => {
    expect(byName.orders.state).toBe("changed"); // host dev-db vs qa-db
    expect(byName.cache.state).toBe("removed"); // only in dev
  });
});
