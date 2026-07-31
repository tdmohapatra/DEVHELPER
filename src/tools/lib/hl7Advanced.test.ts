import { describe, it, expect } from "vitest";
import { parseHl7 } from "./hl7";
import {
  decodeHl7Escapes,
  encodeHl7Escapes,
  parseHl7Path,
  getHl7Value,
  flattenHl7,
  hl7TimestampToIso,
  buildAck,
  validateHl7Structure,
  mllpWrap,
  mllpUnwrap,
  describeFraming,
  hl7ToFhirBundle,
  fhirSystemFor,
  diffHl7,
  Hl7PathError,
  MLLP_START,
} from "./hl7Advanced";

const ADT = [
  "MSH|^~\\&|EPIC|HOSP|LAB|LAB|20260731090000||ADT^A01|MSG00001|P|2.5",
  "EVN|A01|20260731090000",
  "PID|1||MRN123^^^HOSP^MR~SSN999^^^USA^SS||Doe^John^Q||19850215|M|||1 Main St^^Bhubaneswar^OD^751024",
  "PV1|1|I|ICU^101^A|||||DOC1^Smith^Alan|||||||||||V123|||||||||||||||||||||||20260731090500",
].join("\r");

const ORU = [
  "MSH|^~\\&|LIS|LAB|EPIC|HOSP|20260731100000||ORU^R01|MSG00002|P|2.5",
  "PID|1||MRN123||Doe^John",
  "OBR|1||ACC1|CBC^Complete Blood Count^LN",
  "OBX|1|NM|718-7^Hemoglobin^LN||13.5|g/dL|12.0-16.0|N|||F",
  "OBX|2|ST|NOTE^Comment^LN||Sample slightly haemolysed|||||F",
].join("\r");

describe("escape sequences", () => {
  it("decodes the separators that must be escaped on the wire", () => {
    expect(decodeHl7Escapes("Smith\\F\\Jones")).toBe("Smith|Jones");
    expect(decodeHl7Escapes("A\\S\\B")).toBe("A^B");
    expect(decodeHl7Escapes("A\\T\\B")).toBe("A&B");
    expect(decodeHl7Escapes("A\\R\\B")).toBe("A~B");
    expect(decodeHl7Escapes("A\\E\\B")).toBe("A\\B");
  });

  it("decodes hex data and line breaks", () => {
    expect(decodeHl7Escapes("line\\X0A\\next")).toBe("line\nnext");
    expect(decodeHl7Escapes("one\\.br\\two")).toBe("one\ntwo");
  });

  it("leaves unknown sequences alone rather than dropping them", () => {
    expect(decodeHl7Escapes("value\\Z9\\end")).toBe("value\\Z9\\end");
  });

  it("round-trips text containing every delimiter", () => {
    const raw = "a|b^c~d&e\\f";
    expect(decodeHl7Escapes(encodeHl7Escapes(raw))).toBe(raw);
  });
});

describe("parseHl7Path", () => {
  it("reads segment, field, component and subcomponent", () => {
    expect(parseHl7Path("PID-5.1.2")).toMatchObject({ segment: "PID", field: 5, component: 1, subcomponent: 2 });
  });
  it("reads a segment occurrence and a field repetition", () => {
    expect(parseHl7Path("OBX[2]-5")).toMatchObject({ segment: "OBX", segmentRepeat: 2, field: 5 });
    expect(parseHl7Path("PID-3(2)")).toMatchObject({ field: 3, fieldRepeat: 2 });
  });
  it("defaults the occurrence and repetition to the first", () => {
    expect(parseHl7Path("PID-5")).toMatchObject({ segmentRepeat: 1, fieldRepeat: 1 });
  });
  it("rejects nonsense", () => {
    expect(() => parseHl7Path("not a path")).toThrow(Hl7PathError);
  });
});

describe("getHl7Value", () => {
  const msg = parseHl7(ADT);

  it("reads a whole field", () => {
    expect(getHl7Value(msg, "MSH-9")).toBe("ADT^A01");
  });
  it("reads a component and a subcomponent", () => {
    expect(getHl7Value(msg, "PID-5.1")).toBe("Doe");
    expect(getHl7Value(msg, "PID-5.2")).toBe("John");
    expect(getHl7Value(msg, "PID-3.1")).toBe("MRN123");
    expect(getHl7Value(msg, "PID-3.4")).toBe("HOSP");
  });
  it("reads a specific repetition", () => {
    expect(getHl7Value(msg, "PID-3(2).1")).toBe("SSN999");
  });
  it("reads a specific segment occurrence", () => {
    const oru = parseHl7(ORU);
    expect(getHl7Value(oru, "OBX[1]-5")).toBe("13.5");
    expect(getHl7Value(oru, "OBX[2]-5")).toBe("Sample slightly haemolysed");
  });
  it("returns undefined for an absent location, not an empty string", () => {
    expect(getHl7Value(msg, "ZZZ-1")).toBeUndefined();
    expect(getHl7Value(msg, "PID-99")).toBeUndefined();
    expect(getHl7Value(msg, "OBX[5]-1")).toBeUndefined();
  });
});

describe("flattenHl7", () => {
  const flat = flattenHl7(parseHl7(ADT));
  const byPath = Object.fromEntries(flat.map((e) => [e.path, e.value]));

  it("lists populated locations with addressable paths", () => {
    expect(byPath["PID-5.1"]).toBe("Doe");
    expect(byPath["MSH-10"]).toBe("MSG00001");
  });
  it("numbers repetitions and later segment occurrences", () => {
    expect(byPath["PID-3(1).1"]).toBe("MRN123");
    expect(byPath["PID-3(2).1"]).toBe("SSN999");
    expect(Object.keys(flattenHl7(parseHl7(ORU)).reduce((a, e) => ({ ...a, [e.path]: e.value }), {}))).toContain("OBX[2]-5");
  });
  it("skips empty fields", () => {
    expect(flat.every((e) => e.value !== "")).toBe(true);
  });
});

describe("hl7TimestampToIso", () => {
  it("converts a full timestamp", () => {
    expect(hl7TimestampToIso("20260731090000")).toBe("2026-07-31T09:00:00Z");
  });
  it("converts a date-only value", () => {
    expect(hl7TimestampToIso("19850215")).toBe("1985-02-15");
  });
  it("keeps an explicit offset", () => {
    expect(hl7TimestampToIso("20260731090000+0530")).toBe("2026-07-31T09:00:00+05:30");
  });
  it("rejects a non-timestamp", () => {
    expect(hl7TimestampToIso("not-a-date")).toBeNull();
  });
});

describe("buildAck", () => {
  const ack = buildAck(ADT, "AA", "", new Date(2026, 6, 31, 9, 1, 0));

  it("echoes the control id into MSA-2", () => {
    expect(ack).toContain("MSA|AA|MSG00001");
  });
  it("swaps sender and receiver", () => {
    const msh = ack.split("\r")[0].split("|");
    expect(msh[2]).toBe("LAB");
    expect(msh[4]).toBe("EPIC");
  });
  it("keeps the trigger event and version", () => {
    expect(ack).toContain("ACK^A01");
    expect(ack.split("\r")[0].endsWith("2.5")).toBe(true);
  });
  it("carries an error code and text", () => {
    const err = buildAck(ADT, "AE", "PID-5 is required", new Date(2026, 6, 31));
    expect(err).toContain("MSA|AE|MSG00001|PID-5 is required");
  });
  it("escapes delimiters in the error text", () => {
    expect(buildAck(ADT, "AR", "bad|value", new Date(2026, 6, 31))).toContain("bad\\F\\value");
  });
  it("produces something the parser accepts", () => {
    expect(parseHl7(ack).segments.map((s) => s.name)).toEqual(["MSH", "MSA"]);
  });
});

describe("validateHl7Structure", () => {
  it("accepts a well-formed ADT", () => {
    expect(validateHl7Structure(ADT).filter((i) => i.severity === "error")).toEqual([]);
  });

  it("reports a missing mandatory segment", () => {
    const withoutPid = ADT.split("\r").filter((l) => !l.startsWith("PID")).join("\r");
    expect(validateHl7Structure(withoutPid).map((i) => i.message).join(" ")).toMatch(/requires a PID/);
  });

  it("reports an empty control id", () => {
    const noId = ADT.replace("MSG00001", "");
    expect(validateHl7Structure(noId).map((i) => i.message).join(" ")).toMatch(/control id/);
  });

  it("reports an invalid timestamp", () => {
    const bad = ADT.replace("20260731090000||ADT", "2026-07-31||ADT");
    expect(validateHl7Structure(bad).map((i) => i.message).join(" ")).toMatch(/MSH-7/);
  });

  it("catches a numeric OBX carrying text", () => {
    const bad = ORU.replace("|13.5|", "|thirteen|");
    const errors = validateHl7Structure(bad).filter((i) => i.severity === "error");
    expect(errors.map((e) => e.message).join(" ")).toMatch(/OBX-2 declares a numeric value/);
    expect(errors[0].location).toBe("OBX[1]-5");
  });

  it("warns rather than fails on an unknown message type", () => {
    const zzz = ADT.replace("ADT^A01", "ZZZ^Z01");
    const issues = validateHl7Structure(zzz);
    expect(issues.some((i) => i.severity === "warning" && /No structure rules/.test(i.message))).toBe(true);
  });

  it("reports a message that does not parse", () => {
    expect(validateHl7Structure("PID|1")[0].severity).toBe("error");
  });
});

describe("MLLP framing", () => {
  it("wraps with the vertical tab and file separator", () => {
    const framed = mllpWrap("MSH|^~\\&|A|B");
    expect(framed.startsWith(MLLP_START)).toBe(true);
    expect(framed.endsWith("\x1c\r")).toBe(true);
  });
  it("normalises line endings to carriage returns", () => {
    expect(mllpWrap("MSH|a\nPID|b")).toContain("MSH|a\rPID|b");
  });
  it("round-trips", () => {
    const msg = "MSH|^~\\&|A|B\rPID|1";
    expect(mllpUnwrap(mllpWrap(msg))).toBe(msg);
  });
  it("leaves an unframed message alone", () => {
    expect(mllpUnwrap("MSH|a")).toBe("MSH|a");
  });
  it("makes the invisible framing bytes visible", () => {
    expect(describeFraming(mllpWrap("MSH|a"))).toContain("<VT>");
    expect(describeFraming(mllpWrap("MSH|a"))).toContain("<FS>");
  });
});

describe("hl7ToFhirBundle", () => {
  const bundle = JSON.parse(hl7ToFhirBundle(ORU));
  const resources = bundle.entry.map((e: { resource: Record<string, unknown> }) => e.resource);

  it("produces a transaction bundle", () => {
    expect(bundle).toMatchObject({ resourceType: "Bundle", type: "transaction" });
    expect(bundle.entry.every((e: { request?: unknown }) => e.request)).toBe(true);
  });

  it("maps PID onto a Patient", () => {
    const patient = resources.find((r: { resourceType: string }) => r.resourceType === "Patient");
    expect(patient).toMatchObject({ id: "MRN123" });
    expect(patient.name[0]).toMatchObject({ family: "Doe", given: ["John"] });
  });

  it("maps each OBX onto an Observation referencing the patient", () => {
    const observations = resources.filter((r: { resourceType: string }) => r.resourceType === "Observation");
    expect(observations).toHaveLength(2);
    expect(observations[0].subject.reference).toBe("Patient/MRN123");
  });

  it("uses valueQuantity for numeric results and valueString otherwise", () => {
    const observations = resources.filter((r: { resourceType: string }) => r.resourceType === "Observation");
    expect(observations[0].valueQuantity).toMatchObject({ value: 13.5, unit: "g/dL" });
    expect(observations[1].valueString).toBe("Sample slightly haemolysed");
  });

  it("expands the coding system abbreviation", () => {
    const observation = resources.find((r: { resourceType: string }) => r.resourceType === "Observation");
    expect(observation.code.coding[0].system).toBe("http://loinc.org");
  });

  it("maps PV1 onto an Encounter and PID-7 onto birthDate", () => {
    const adtBundle = JSON.parse(hl7ToFhirBundle(ADT));
    const types = adtBundle.entry.map((e: { resource: { resourceType: string } }) => e.resource.resourceType);
    expect(types).toContain("Encounter");
    const patient = adtBundle.entry[0].resource;
    expect(patient.birthDate).toBe("1985-02-15");
    expect(patient.gender).toBe("male");
  });
});

describe("fhirSystemFor", () => {
  it("expands known abbreviations", () => {
    expect(fhirSystemFor("LN")).toBe("http://loinc.org");
    expect(fhirSystemFor("SCT")).toBe("http://snomed.info/sct");
  });
  it("passes an unknown system through unchanged", () => {
    expect(fhirSystemFor("LOCAL")).toBe("LOCAL");
  });
});

describe("diffHl7", () => {
  it("reports changed, added and removed values by path", () => {
    const changed = ADT.replace("Doe^John^Q", "Doe^Jane^Q").replace("|M|||1 Main St", "||||1 Main St");
    const diff = diffHl7(ADT, changed);
    const byPath = Object.fromEntries(diff.map((d) => [d.path, d]));
    expect(byPath["PID-5.2"]).toMatchObject({ kind: "changed", left: "John", right: "Jane" });
    expect(byPath["PID-8"]).toMatchObject({ kind: "removed", left: "M" });
  });

  it("finds nothing between identical messages", () => {
    expect(diffHl7(ADT, ADT)).toEqual([]);
  });
});
