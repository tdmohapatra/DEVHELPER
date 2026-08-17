import { describe, expect, it } from "vitest";
import {
  applyMapping,
  applyTransform,
  coverage,
  csvLine,
  describeTransforms,
  exportMapping,
  hl7DateToIso,
  importMapping,
  isoToHl7Date,
  jsonPath,
  jsonPaths,
  readSource,
  setPath,
  SourceError,
  toCSharp,
  TransformError,
  type Mapping,
} from "./fieldMap";

const HL7 = [
  "MSH|^~\\&|LIS|LAB|EMR|HOSP|20260817103000||ORU^R01|MSG00001|P|2.5",
  "PID|1||100234^^^HOSP^MR||sharma^priya^k||19750214|F|||12 MG Road^^Bengaluru^KA^560001||9845012345",
  "OBX|1|NM|718-7^Haemoglobin||9.1|g/dL|13.0-17.0|L|||F",
].join("\r");

const mapping = (over: Partial<Mapping> = {}): Mapping => ({
  name: "ORU to EMR",
  sourceKind: "hl7",
  rules: [
    { id: "r1", target: "patient.mrn", source: "PID-3.1", required: true },
    { id: "r2", target: "patient.family", source: "PID-5.1", transforms: [{ kind: "titlecase" }] },
    { id: "r3", target: "patient.birthDate", source: "PID-7", transforms: [{ kind: "hl7DateToIso" }] },
    { id: "r4", target: "meta.source", constant: "LIS" },
  ],
  ...over,
});

describe("readSource — HL7", () => {
  const source = readSource("hl7", HL7);

  it("reads a field and a component", () => {
    expect(source.get("PID-3.1")).toBe("100234");
    expect(source.get("PID-7")).toBe("19750214");
    expect(source.get("OBX-5")).toBe("9.1");
  });

  it("treats an empty field as absent, so a fallback can fire", () => {
    expect(source.get("PID-4")).toBeUndefined();
    expect(source.get("PID-99")).toBeUndefined();
  });

  it("lists the paths that are actually populated, components included", () => {
    expect(source.paths).toContain("PID-3");
    expect(source.paths).toContain("PID-5.2");
    expect(source.paths).not.toContain("PID-4");
  });

  it("says what to paste when given a fragment instead of a message", () => {
    expect(() => readSource("hl7", "PID|1||100234")).toThrow(SourceError);
    expect(() => readSource("hl7", "PID|1||100234")).toThrow(/from the MSH line down/);
  });
});

describe("readSource — JSON and CSV", () => {
  const json = '{"name":[{"family":"Sharma","given":["Priya"]}],"birthDate":"1975-02-14","active":true}';

  it("reads dotted paths with array indexes", () => {
    const source = readSource("json", json);
    expect(source.get("name[0].family")).toBe("Sharma");
    expect(source.get("name[0].given[0]")).toBe("Priya");
    expect(source.get("active")).toBe("true");
    expect(source.get("missing")).toBeUndefined();
  });

  it("lists every leaf path", () => {
    expect(readSource("json", json).paths).toEqual(["name[0].family", "name[0].given[0]", "birthDate", "active"]);
  });

  it("explains malformed JSON rather than throwing a parser message alone", () => {
    expect(() => readSource("json", "{oops")).toThrow(/not valid JSON/);
  });

  it("reads a CSV column by name and by position", () => {
    const source = readSource("csv", 'mrn,name,dob\n100234,"Sharma, Priya",1975-02-14');
    expect(source.get("mrn")).toBe("100234");
    expect(source.get("name")).toBe("Sharma, Priya");
    expect(source.get("3")).toBe("1975-02-14");
    expect(source.paths).toEqual(["mrn", "name", "dob"]);
  });

  it("handles a header row with no data row yet", () => {
    const source = readSource("csv", "mrn,name");
    expect(source.paths).toEqual(["mrn", "name"]);
    expect(source.get("mrn")).toBeUndefined();
  });
});

describe("csvLine", () => {
  it("keeps a comma inside quotes in one cell", () => {
    expect(csvLine('a,"b,c",d')).toEqual(["a", "b,c", "d"]);
  });

  it("unescapes a doubled quote", () => {
    expect(csvLine('a,"say ""hi""",b')).toEqual(["a", 'say "hi"', "b"]);
  });

  it("keeps empty cells, so column positions do not shift", () => {
    expect(csvLine("a,,c")).toEqual(["a", "", "c"]);
  });
});

describe("jsonPath and setPath", () => {
  it("returns undefined rather than throwing part-way down a missing branch", () => {
    expect(jsonPath({ a: { b: 1 } }, "a.c.d")).toBeUndefined();
    expect(jsonPath({ a: [] }, "a[3].b")).toBeUndefined();
    expect(jsonPath(null, "a")).toBeUndefined();
  });

  it("builds the objects on the way down", () => {
    const out: Record<string, unknown> = {};
    setPath(out, "patient.name.family", "Sharma");
    expect(out).toEqual({ patient: { name: { family: "Sharma" } } });
  });

  it("replaces a non-object standing where an object is needed", () => {
    const out: Record<string, unknown> = { patient: "x" };
    setPath(out, "patient.mrn", "1");
    expect(out).toEqual({ patient: { mrn: "1" } });
  });

  it("lists paths through arrays in the notation it can read back", () => {
    const doc = { a: [{ b: 1 }, { b: 2 }] };
    const paths = jsonPaths(doc);
    expect(paths).toEqual(["a[0].b", "a[1].b"]);
    expect(jsonPath(doc, paths[1])).toBe(2);
  });
});

describe("transforms", () => {
  it("does the string operations", () => {
    expect(applyTransform("  x  ", { kind: "trim" })).toBe("x");
    expect(applyTransform("ab", { kind: "upper" })).toBe("AB");
    expect(applyTransform("SHARMA^PRIYA", { kind: "titlecase" })).toBe("Sharma^Priya");
    expect(applyTransform("+91 98450-12345", { kind: "digitsOnly" })).toBe("919845012345");
    expect(applyTransform("abcdef", { kind: "substring", a: "1", b: "3" })).toBe("bc");
    expect(applyTransform("abcdef", { kind: "substring", a: "2" })).toBe("cdef");
    expect(applyTransform("7", { kind: "pad", a: "3" })).toBe("007");
    expect(applyTransform("x", { kind: "prefix", a: "MR-" })).toBe("MR-x");
    expect(applyTransform("x", { kind: "suffix", a: "!" })).toBe("x!");
  });

  it("replaces literally, not by regex", () => {
    expect(applyTransform("a.b.c", { kind: "replace", a: ".", b: "-" })).toBe("a-b-c");
    expect(applyTransform("a1b", { kind: "replace", a: "\\d", b: "X" })).toBe("a1b");
  });

  it("splits on a separator and takes one part", () => {
    expect(applyTransform("SHARMA^PRIYA^K", { kind: "split", a: "^", b: "1" })).toBe("PRIYA");
    expect(applyTransform("a^b", { kind: "split", a: "^", b: "9" })).toBe("");
  });

  it("converts HL7 timestamps at whatever precision they carry", () => {
    expect(hl7DateToIso("19750214")).toBe("1975-02-14");
    expect(hl7DateToIso("197502")).toBe("1975-02");
    expect(hl7DateToIso("1975")).toBe("1975");
    expect(hl7DateToIso("20260817103000")).toBe("2026-08-17T10:30:00");
    expect(hl7DateToIso("20260817103000+0530")).toBe("2026-08-17T10:30:00");
    expect(hl7DateToIso("nope")).toBeNull();
  });

  it("converts back, dropping the offset HL7 carries separately", () => {
    expect(isoToHl7Date("1975-02-14")).toBe("19750214");
    expect(isoToHl7Date("2026-08-17T10:30:00Z")).toBe("20260817103000");
    expect(isoToHl7Date("1975")).toBe("1975");
    expect(isoToHl7Date("not a date")).toBeNull();
  });

  it("throws with the offending value rather than passing bad data on", () => {
    expect(() => applyTransform("nope", { kind: "hl7DateToIso" })).toThrow(TransformError);
    expect(() => applyTransform("nope", { kind: "hl7DateToIso" })).toThrow(/"nope"/);
  });

  it("looks a code up, and only complains when told to be strict", () => {
    const table = { M: "male", F: "female" };
    expect(applyTransform("F", { kind: "lookup", table })).toBe("female");
    expect(applyTransform("U", { kind: "lookup", table })).toBe("U");
    expect(() => applyTransform("U", { kind: "lookup", table, strict: true })).toThrow(/not in the lookup table/);
  });

  it("describes a chain in words", () => {
    expect(describeTransforms(undefined)).toBe("as-is");
    expect(describeTransforms([{ kind: "trim" }, { kind: "split", a: "^", b: "0" }])).toBe('trim → split on "^" take 0');
  });
});

describe("applyMapping", () => {
  const source = readSource("hl7", HL7);

  it("produces the nested output the target expects", () => {
    const { output } = applyMapping(mapping(), source);
    expect(output).toEqual({
      patient: { mrn: "100234", family: "Sharma", birthDate: "1975-02-14" },
      meta: { source: "LIS" },
    });
  });

  it("traces each field back to where its value came from", () => {
    const { traces } = applyMapping(mapping(), source);
    const family = traces.find((t) => t.ruleId === "r2")!;
    expect(family.source).toBe("PID-5.1");
    expect(family.raw).toBe("sharma");
    expect(family.steps).toEqual([{ kind: "titlecase", from: "sharma", to: "Sharma" }]);
    expect(family.value).toBe("Sharma");
  });

  it("reports a required field the message did not carry, and names the path", () => {
    const { issues, output } = applyMapping(
      mapping({ rules: [{ id: "r1", target: "patient.ssn", source: "PID-19", required: true }] }),
      source,
    );
    expect(issues[0].level).toBe("error");
    expect(issues[0].message).toMatch(/PID-19 is empty/);
    expect(output).toEqual({});
  });

  it("uses a fallback and says it did", () => {
    const { output, traces } = applyMapping(
      mapping({ rules: [{ id: "r1", target: "patient.ssn", source: "PID-19", fallback: "UNKNOWN", required: true }] }),
      source,
    );
    expect(output).toEqual({ patient: { ssn: "UNKNOWN" } });
    expect(traces[0].usedFallback).toBe(true);
  });

  it("keeps going after a failed transform, reporting it as one issue", () => {
    const { output, issues } = applyMapping(
      mapping({
        rules: [
          { id: "bad", target: "patient.birthDate", source: "PID-5.1", transforms: [{ kind: "hl7DateToIso" }] },
          { id: "good", target: "patient.mrn", source: "PID-3.1" },
        ],
      }),
      source,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].ruleId).toBe("bad");
    expect(output).toEqual({ patient: { mrn: "100234" } });
  });

  it("warns when two rules write the same target, since the earlier one is dead", () => {
    const { issues } = applyMapping(
      mapping({
        rules: [
          { id: "a", target: "patient.mrn", source: "PID-3.1" },
          { id: "b", target: "patient.mrn", constant: "X" },
        ],
      }),
      source,
    );
    expect(issues.some((i) => i.level === "warn" && /later one wins/.test(i.message))).toBe(true);
  });

  it("reports a rule with no target rather than writing to an empty key", () => {
    const { output, issues } = applyMapping(mapping({ rules: [{ id: "x", target: "", constant: "v" }] }), source);
    expect(output).toEqual({});
    expect(issues[0].message).toMatch(/nowhere to go/);
  });
});

describe("coverage", () => {
  const source = readSource("hl7", HL7);

  it("reports source fields nobody reads", () => {
    const { unmappedSource } = coverage(mapping(), source);
    expect(unmappedSource).toContain("OBX-5");
    expect(unmappedSource).not.toContain("PID-3.1");
  });

  it("reports target fields the receiver expects and nobody fills", () => {
    const { unmappedTarget } = coverage(mapping(), source, ["patient.mrn", "patient.gender", "patient.phone"]);
    expect(unmappedTarget).toEqual(["patient.gender", "patient.phone"]);
  });

  it("reports rules pointing at a path this message does not have", () => {
    const { missingSource } = coverage(mapping({ rules: [{ id: "x", target: "t", source: "PID-19" }] }), source);
    expect(missingSource).toEqual(["PID-19"]);
  });

  it("counts distinct targets, not rules", () => {
    expect(coverage(mapping(), source).mappedCount).toBe(4);
  });
});

describe("export and import", () => {
  it("round-trips a mapping", () => {
    const original = mapping();
    const restored = importMapping(exportMapping(original));
    expect(restored.name).toBe(original.name);
    expect(restored.sourceKind).toBe("hl7");
    expect(restored.rules).toHaveLength(4);
    expect(restored.rules[1].transforms).toEqual([{ kind: "titlecase" }]);
  });

  it("gives a rule an id when the file has none, since issues refer to it", () => {
    const restored = importMapping(JSON.stringify({ rules: [{ target: "a", source: "b" }] }));
    expect(restored.rules[0].id).toBe("rule-1");
  });

  it("refuses a file that is not a mapping", () => {
    expect(() => importMapping("{}")).toThrow(/rules/);
    expect(() => importMapping("nonsense")).toThrow(SourceError);
  });

  it("falls back to hl7 for an unknown source kind rather than producing an invalid mapping", () => {
    expect(importMapping(JSON.stringify({ rules: [], sourceKind: "xml" })).sourceKind).toBe("hl7");
  });
});

describe("toCSharp", () => {
  const code = toCSharp(mapping(), "OruToEmr");

  it("generates a class that names the mapping it came from", () => {
    expect(code).toContain("public static class OruToEmr");
    expect(code).toContain("Mapping: ORU to EMR");
    expect(code).toContain("Regenerate rather than edit");
  });

  it("reads each source path and writes each target", () => {
    expect(code).toContain('value = get("PID-3.1");');
    expect(code).toContain('result["patient.mrn"] = value;');
    expect(code).toContain('value = "LIS";');
  });

  it("collects a required miss as an error instead of throwing", () => {
    expect(code).toContain("errors.Add(\"patient.mrn is required and was empty\")");
  });

  it("escapes a quote in a constant so the output still compiles", () => {
    const code2 = toCSharp(mapping({ rules: [{ id: "q", target: "t", constant: 'say "hi"' }] }));
    expect(code2).toContain('value = "say \\"hi\\"";');
  });

  it("emits a lookup as a dictionary", () => {
    const code3 = toCSharp(
      mapping({ rules: [{ id: "s", target: "sex", source: "PID-8", transforms: [{ kind: "lookup", table: { F: "female" } }] }] }),
    );
    expect(code3).toContain('new Dictionary<string, string> { { "F", "female" } }');
  });
});
