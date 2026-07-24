import { describe, it, expect } from "vitest";
import { generateRecords, exportRecords } from "./testdata";

describe("generateRecords", () => {
  it("generates the requested count", () => {
    expect(generateRecords("user", 5)).toHaveLength(5);
  });
  it("clamps count to >=1", () => {
    expect(generateRecords("user", 0).length).toBeGreaterThanOrEqual(1);
  });
  it("patient data is synthetic (no real PHI markers)", () => {
    const [p] = generateRecords("patient", 1);
    expect(String(p.patientId)).toMatch(/^TEST_PATIENT_/);
    expect(String(p.mrn)).toMatch(/^TEST-MRN-/);
    expect(p.phone).toBe("+1-555-XXX-XXXX");
  });
});

describe("exportRecords", () => {
  const recs = [{ id: 1, name: "A, B", active: true }, { id: 2, name: "C", active: false }];
  it("json", () => {
    expect(JSON.parse(exportRecords(recs, "json", "t"))).toHaveLength(2);
  });
  it("csv escapes commas", () => {
    const csv = exportRecords(recs, "csv", "t");
    expect(csv.split("\n")[0]).toBe("id,name,active");
    expect(csv).toContain('"A, B"');
  });
  it("sql produces INSERT with quoted strings and numeric ids", () => {
    const sql = exportRecords(recs, "sql", "users");
    expect(sql).toContain("INSERT INTO users (id, name, active) VALUES (1, 'A, B', 1);");
  });
  it("xml wraps records", () => {
    expect(exportRecords(recs, "xml", "t")).toContain("<records>");
  });
});
