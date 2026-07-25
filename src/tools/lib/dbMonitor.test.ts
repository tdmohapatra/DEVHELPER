import { describe, it, expect } from "vitest";
import { sessionsQuery, locksQuery, lastModifiedQuery, dbSizeQuery, killQuery } from "./dbMonitor";

describe("sessionsQuery", () => {
  it("uses the right source per engine, null for sqlite", () => {
    expect(sessionsQuery("mssql")).toContain("sys.dm_exec_sessions");
    expect(sessionsQuery("postgres")).toContain("pg_stat_activity");
    expect(sessionsQuery("mysql")).toContain("PROCESSLIST");
    expect(sessionsQuery("sqlite")).toBeNull();
  });
});

describe("locksQuery", () => {
  it("targets blocking sources per engine", () => {
    expect(locksQuery("mssql")).toContain("blocking_session_id <> 0");
    expect(locksQuery("postgres")).toContain("pg_blocking_pids");
    expect(locksQuery("mysql")).toContain("data_lock_waits");
    expect(locksQuery("sqlite")).toBeNull();
  });
});

describe("lastModifiedQuery", () => {
  it("orders by modification time per engine", () => {
    expect(lastModifiedQuery("mssql")).toContain("ORDER BY modify_date DESC");
    expect(lastModifiedQuery("mysql")).toContain("update_time");
    expect(lastModifiedQuery("postgres")).toContain("pg_stat_user_tables");
    expect(lastModifiedQuery("sqlite")).toBeNull();
  });
});

describe("dbSizeQuery", () => {
  it("computes size per engine", () => {
    expect(dbSizeQuery("mssql")).toContain("sys.database_files");
    expect(dbSizeQuery("postgres")).toContain("pg_database_size");
    expect(dbSizeQuery("mysql")).toContain("data_length");
    expect(dbSizeQuery("sqlite")).toBeNull();
  });
});

describe("killQuery", () => {
  it("builds a terminate statement and sanitizes the id", () => {
    expect(killQuery("mssql", "55")).toBe("KILL 55");
    expect(killQuery("postgres", "1234")).toBe("SELECT pg_terminate_backend(1234)");
    expect(killQuery("mysql", "  9x9 ")).toBe("KILL 99"); // strips non-digits
    expect(killQuery("mssql", "abc")).toBeNull();
    expect(killQuery("sqlite", "5")).toBeNull();
  });
});
