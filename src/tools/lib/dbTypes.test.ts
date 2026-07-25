import { describe, it, expect } from "vitest";
import { normalizeEngine, dbConnectionFromEnvRef, buildConnString, type DbConnection } from "./dbTypes";
import type { EnvConnection } from "./apiTypes";

describe("normalizeEngine", () => {
  it("maps loose engine strings", () => {
    expect(normalizeEngine("PostgreSQL")).toBe("postgres");
    expect(normalizeEngine("SQL Server")).toBe("mssql");
    expect(normalizeEngine("MariaDB")).toBe("mysql");
    expect(normalizeEngine("sqlite")).toBe("sqlite");
    expect(normalizeEngine("Oracle")).toBe("oracle");
    expect(normalizeEngine("")).toBe("postgres");
  });
});

describe("dbConnectionFromEnvRef", () => {
  it("builds a DB connection from an env database ref", () => {
    const ref: EnvConnection = { id: "1", kind: "database", name: "orders", fields: { engine: "SQL Server", host: "qa-db", port: "1433", database: "Orders", user: "sa" } };
    const c = dbConnectionFromEnvRef(ref, "QA");
    expect(c.engine).toBe("mssql");
    expect(c.name).toBe("QA · orders");
    expect(c.host).toBe("qa-db");
    expect(c.port).toBe(1433);
    expect(c.database).toBe("Orders");
    expect(c.safeMode).toBe(true);
  });
  it("defaults the port from the engine when absent, flags prod by name", () => {
    const ref: EnvConnection = { id: "2", kind: "database", name: "main", fields: { engine: "postgres", host: "h", database: "d" } };
    const c = dbConnectionFromEnvRef(ref, "PROD");
    expect(c.port).toBe(5432);
    expect(c.isProduction).toBe(true);
  });
});

describe("buildConnString round-trip via env ref", () => {
  it("produces a postgres URL", () => {
    const ref: EnvConnection = { id: "3", kind: "database", name: "m", fields: { engine: "postgres", host: "h", port: "5432", database: "d", user: "u" } };
    const c = { ...dbConnectionFromEnvRef(ref, "DEV"), id: "x" } as DbConnection;
    expect(buildConnString(c, "pw")).toBe("postgresql://u:pw@h:5432/d");
  });
});
