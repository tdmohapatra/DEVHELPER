import { describe, it, expect } from "vitest";
import { inferColumns, toCsharpClass, toCsharpRecord, toEfEntity, toTsInterface, toJsonExample } from "./dbCodegen";
import type { QueryResult } from "./dbTypes";

const result: QueryResult = {
  columns: ["id", "full_name", "balance", "is_active", "created_at", "note"],
  rows: [
    ["1", "Ada", "10.50", "true", "2024-01-02 10:00:00", "hi"],
    ["2", "Grace", "0.00", "false", "2024-03-04", null],
  ],
  rowCount: 2,
  elapsedMs: 1,
  truncated: false,
};

describe("inferColumns", () => {
  const cols = inferColumns(result);
  it("infers int / decimal / bool / datetime / string", () => {
    expect(cols.find((c) => c.name === "id")!.type).toBe("int");
    expect(cols.find((c) => c.name === "balance")!.type).toBe("decimal");
    expect(cols.find((c) => c.name === "is_active")!.type).toBe("bool");
    expect(cols.find((c) => c.name === "created_at")!.type).toBe("datetime");
    expect(cols.find((c) => c.name === "full_name")!.type).toBe("string");
  });
  it("marks a column nullable when a null is sampled", () => {
    expect(cols.find((c) => c.name === "note")!.nullable).toBe(true);
    expect(cols.find((c) => c.name === "id")!.nullable).toBe(false);
  });
});

describe("code generators", () => {
  const cols = inferColumns(result);
  it("C# class uses PascalCase and nullable markers", () => {
    const out = toCsharpClass(cols, "User");
    expect(out).toContain("public class User");
    expect(out).toContain("public int Id { get; set; }");
    expect(out).toContain("public decimal Balance { get; set; }");
    expect(out).toContain("public string? Note { get; set; }");
  });
  it("C# record is positional", () => {
    const out = toCsharpRecord(cols, "User");
    expect(out.startsWith("public record User(")).toBe(true);
    expect(out).toContain("int Id");
  });
  it("EF entity adds Table + Column attributes for renamed columns", () => {
    const out = toEfEntity(cols, "users");
    expect(out).toContain('[Table("users")]');
    expect(out).toContain('[Column("full_name")]');
    expect(out).toContain("public string FullName { get; set; }");
  });
  it("TS interface uses camelCase and optional markers", () => {
    const out = toTsInterface(cols, "User");
    expect(out).toContain("export interface User");
    expect(out).toContain("id: number;");
    expect(out).toContain("note?: string;");
  });
  it("JSON example coerces types from the first row", () => {
    const obj = JSON.parse(toJsonExample(result, cols));
    expect(obj.id).toBe(1);
    expect(obj.balance).toBe(10.5);
    expect(obj.is_active).toBe(true);
    expect(obj.full_name).toBe("Ada");
  });
});
