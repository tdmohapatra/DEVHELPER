import { describe, it, expect } from "vitest";
import { parseHl7, hl7ToJson, validateHl7, describeMessageType } from "./hl7";
import { detectPii, deidentify, summarize } from "./deidentify";
import { findAbbreviations, expandInline, lookup } from "./medterms";
import { validateFhir, summarizeFhir } from "./fhir";

const HL7 = [
  "MSH|^~\\&|EPIC|HOSP|LAB|DH|20240101120000||ADT^A01|MSG1|P|2.5",
  "PID|1||12345^^^HOSP^MR||DOE^JOHN||19800101|M",
].join("\n");

describe("hl7", () => {
  it("parses MSH encoding + message type", () => {
    const m = parseHl7(HL7);
    expect(m.fieldSep).toBe("|");
    expect(m.encodingChars).toBe("^~\\&");
    expect(m.messageType).toBe("ADT^A01");
  });
  it("parses PID patient name components", () => {
    const m = parseHl7(HL7);
    const pid = m.segments.find((s) => s.name === "PID")!;
    const name = pid.fields.find((f) => f.index === 5)!;
    expect(name.components[0]).toBe("DOE");
    expect(name.components[1]).toBe("JOHN");
  });
  it("converts to json and describes type", () => {
    expect(JSON.parse(hl7ToJson(HL7)).messageType).toBe("ADT^A01");
    expect(describeMessageType("ADT^A01")).toContain("Admit");
  });
  it("validation rejects non-MSH start", () => {
    expect(validateHl7("PID|1").valid).toBe(false);
    expect(validateHl7(HL7).valid).toBe(true);
  });
});

describe("deidentify", () => {
  const text = "Email a@b.com phone 555-123-4567 ssn 123-45-6789 mrn MRN: 998877 ip 10.0.0.1";
  it("detects multiple pii types", () => {
    const s = summarize(detectPii(text));
    expect(s.byType["Email"]).toBe(1);
    expect(s.byType["SSN"]).toBe(1);
    expect(s.byType["Phone"]).toBe(1);
    expect(s.byType["MRN"]).toBe(1);
    expect(s.byType["IPv4"]).toBe(1);
  });
  it("label mode replaces with tags", () => {
    const out = deidentify("email a@b.com", "label");
    expect(out).toBe("email [EMAIL]");
  });
  it("mask mode preserves shape", () => {
    expect(deidentify("ssn 123-45-6789", "mask")).toBe("ssn XXX-XX-XXXX");
  });
  it("pseudo mode swaps in synthetic values", () => {
    expect(deidentify("a@b.com", "pseudo")).toBe("user001@example.com");
  });
});

describe("medterms", () => {
  it("looks up and expands", () => {
    expect(lookup("HTN")).toBe("Hypertension");
    expect(findAbbreviations("Hx of HTN").length).toBe(2);
    expect(expandInline("HTN")).toBe("HTN (Hypertension)");
  });
});

describe("fhir", () => {
  it("validates resourceType presence", () => {
    expect(validateFhir('{"resourceType":"Patient"}').valid).toBe(true);
    expect(validateFhir("{}").valid).toBe(false);
  });
  it("summarizes a Patient", () => {
    const s = summarizeFhir('{"resourceType":"Patient","name":[{"given":["John"],"family":"Doe"}],"gender":"male"}');
    expect(s?.resourceType).toBe("Patient");
    expect(s?.fields.find((f) => f.label === "Name")?.value).toContain("Doe");
  });
});
