import { describe, it, expect } from "vitest";
import { analyzeSql, isWriteSql, stripSqlNoise, splitStatements, highestRisk } from "./sqlSafety";

describe("stripSqlNoise", () => {
  it("removes line and block comments", () => {
    expect(stripSqlNoise("SELECT 1 -- DROP TABLE x").includes("DROP")).toBe(false);
    expect(stripSqlNoise("SELECT 1 /* DELETE FROM y */").includes("DELETE")).toBe(false);
  });
  it("neutralizes keywords inside string literals", () => {
    expect(stripSqlNoise("SELECT 'DROP TABLE users'").includes("DROP")).toBe(false);
  });
});

describe("splitStatements", () => {
  it("splits on semicolons and trims empties", () => {
    expect(splitStatements("SELECT 1; SELECT 2 ;;")).toEqual(["SELECT 1", "SELECT 2"]);
  });
  it("does not split on semicolons inside strings", () => {
    expect(splitStatements("SELECT 'a;b'")).toEqual(["SELECT ''"]);
  });
});

describe("analyzeSql", () => {
  it("flags DROP as destructive", () => {
    const f = analyzeSql("DROP TABLE users");
    expect(f[0].risk).toBe("destructive");
  });
  it("flags TRUNCATE as destructive", () => {
    expect(analyzeSql("TRUNCATE TABLE logs")[0].risk).toBe("destructive");
  });
  it("flags UPDATE without WHERE", () => {
    expect(analyzeSql("UPDATE users SET active = 1")[0].risk).toBe("unfiltered-write");
  });
  it("flags DELETE without WHERE", () => {
    expect(analyzeSql("DELETE FROM users")[0].risk).toBe("unfiltered-write");
  });
  it("allows UPDATE/DELETE with WHERE", () => {
    expect(analyzeSql("UPDATE users SET active = 1 WHERE id = 5")).toHaveLength(0);
    expect(analyzeSql("DELETE FROM users WHERE id = 5")).toHaveLength(0);
  });
  it("flags ALTER/CREATE TABLE as schema change", () => {
    expect(analyzeSql("ALTER TABLE users ADD COLUMN x int")[0].risk).toBe("schema-change");
    expect(analyzeSql("CREATE TABLE t (id int)")[0].risk).toBe("schema-change");
  });
  it("treats plain SELECT as safe", () => {
    expect(analyzeSql("SELECT * FROM users WHERE id = 1")).toHaveLength(0);
  });
  it("is not fooled by a WHERE mentioned in a comment", () => {
    expect(analyzeSql("DELETE FROM users -- WHERE id = 1")[0].risk).toBe("unfiltered-write");
  });
  it("analyzes each statement in a multi-statement script", () => {
    const f = analyzeSql("SELECT 1; DROP TABLE x; DELETE FROM y");
    expect(f).toHaveLength(2);
    expect(highestRisk(f)).toBe("destructive");
  });
});

describe("isWriteSql", () => {
  it("detects writes and structure changes", () => {
    expect(isWriteSql("INSERT INTO t VALUES (1)")).toBe(true);
    expect(isWriteSql("update t set a=1")).toBe(true);
    expect(isWriteSql("GRANT SELECT ON t TO u")).toBe(true);
  });
  it("treats reads as non-writes", () => {
    expect(isWriteSql("SELECT * FROM t")).toBe(false);
    expect(isWriteSql("WITH c AS (SELECT 1) SELECT * FROM c")).toBe(false);
  });
  it("ignores keywords inside strings", () => {
    expect(isWriteSql("SELECT 'INSERT' AS label")).toBe(false);
  });
});
