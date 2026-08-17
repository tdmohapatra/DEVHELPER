import { describe, expect, it } from "vitest";
import {
  applyPolicy,
  detectFormat,
  detectInDicom,
  detectInHl7,
  detectInJson,
  detectInText,
  detectPhi,
  groupFindings,
  isLocalDestination,
  KIND_LABEL,
  looksLikeFhir,
  looksLikeHl7,
  redact,
  reidentify,
  summarise,
} from "./phi";

const HL7 = [
  "MSH|^~\\&|LIS|LAB|EMR|HOSP|20260817103000||ORU^R01|MSG00001|P|2.5",
  "PID|1||100234^^^HOSP^MR||SHARMA^PRIYA^K||19750214|F|||12 MG Road^^Bengaluru^KA^560001||9845012345||||||123-45-6789",
  "OBX|1|NM|718-7^Haemoglobin||9.1|g/dL|13.0-17.0|L|||F",
].join("\r");

const FHIR = JSON.stringify({
  resourceType: "Patient",
  id: "abc",
  identifier: [{ system: "urn:oid:2.16.840.1", value: "100234" }],
  name: [{ family: "Sharma", given: ["Priya"] }],
  birthDate: "1975-02-14",
  telecom: [{ system: "phone", value: "+91 98450 12345" }],
  address: [{ line: ["12 MG Road"], city: "Bengaluru", postalCode: "560001" }],
});

const DICOM = [
  "(0008,0050) SH [ACC12345]                               #  AccessionNumber",
  "(0010,0010) PN [SHARMA^PRIYA]                           #  PatientName",
  "(0010,0020) LO [100234]                                 #  PatientID",
  "(0010,0030) DA [19750214]                               #  PatientBirthDate",
  "(0018,0015) CS [CHEST]                                  #  BodyPartExamined",
].join("\n");

describe("format detection", () => {
  it("recognises each payload by what makes it that payload", () => {
    expect(looksLikeHl7(HL7)).toBe(true);
    expect(looksLikeFhir(FHIR)).toBe(true);
    expect(detectFormat(HL7)).toBe("hl7");
    expect(detectFormat(FHIR)).toBe("fhir");
    expect(detectFormat(DICOM)).toBe("dicom");
    expect(detectFormat("the ORU never arrived")).toBe("text");
  });

  it("does not call a stack trace mentioning MSH an HL7 message", () => {
    expect(looksLikeHl7("at Hl7Parser.MSH|parse(line)")).toBe(false);
    expect(looksLikeFhir('{"resource":"patient"}')).toBe(false);
  });

  it("recognises a bare segment, which is what a log line actually contains", () => {
    // The commonest paste of all: the one segment that failed, with no MSH.
    expect(looksLikeHl7("PID|1||100234^^^HOSP^MR||SHARMA^PRIYA^K")).toBe(true);
    expect(detectInHl7("PID|1||100234^^^HOSP^MR||SHARMA^PRIYA^K").some((f) => f.kind === "name")).toBe(true);
  });
});

describe("detectInHl7", () => {
  const findings = detectInHl7(HL7);
  const of = (kind: string) => findings.filter((f) => f.kind === kind).map((f) => f.value);

  it("finds the surname no regex could, because the standard names the field", () => {
    expect(of("name")).toContain("SHARMA^PRIYA^K");
    expect(findings.find((f) => f.kind === "name")?.certain).toBe(true);
    expect(findings.find((f) => f.kind === "name")?.reason).toMatch(/PID-5/);
  });

  it("finds the MRN in PID-3 where a real message keeps it, with no MRN: prefix in sight", () => {
    expect(of("mrn")).toContain("100234^^^HOSP^MR");
  });

  it("reads the birth date, address, phone and SSN by position", () => {
    expect(of("birthDate")).toEqual(["19750214"]);
    expect(of("address")).toEqual(["12 MG Road^^Bengaluru^KA^560001"]);
    expect(of("phone")).toEqual(["9845012345"]);
    expect(of("ssn")).toEqual(["123-45-6789"]);
  });

  it("leaves the clinical result alone — the haemoglobin is the point of the message", () => {
    expect(findings.some((f) => f.value === "9.1")).toBe(false);
    expect(findings.some((f) => f.value.includes("Haemoglobin"))).toBe(false);
  });

  it("counts MSH fields from MSH-2, since the separator is MSH-1", () => {
    // MSH-9 is the message type. If the offset were wrong this would land elsewhere.
    const msh = detectInHl7("MSH|^~\\&|LIS|LAB|EMR|HOSP|20260817103000||ORU^R01|1|P|2.5\rPID|1||X||A^B");
    expect(msh.every((f) => f.value !== "ORU^R01")).toBe(true);
  });

  it("offsets point at the real text", () => {
    for (const f of findings) expect(HL7.slice(f.start, f.end)).toBe(f.value);
  });

  it("ignores empty fields and unknown segments", () => {
    expect(detectInHl7("PID|1||||||||\rZZZ|secret^value")).toEqual([]);
  });
});

describe("detectInJson", () => {
  const findings = detectInJson(FHIR);
  const of = (kind: string) => findings.filter((f) => f.kind === kind).map((f) => f.value);

  it("redacts a whole name array rather than picking at it", () => {
    expect(of("name")[0]).toContain("Sharma");
    expect(of("name")[0]).toContain("Priya");
    expect(of("name")).toHaveLength(1);
  });

  it("takes the identifier, birth date, telecom and address blocks", () => {
    expect(of("birthDate")).toEqual(['"1975-02-14"']);
    expect(of("otherId")[0]).toContain("100234");
    expect(of("phone")[0]).toContain("98450");
    expect(of("address")[0]).toContain("Bengaluru");
  });

  it("does not report keys nested inside a value it already claimed", () => {
    // `line`, `city` and `postalCode` live inside the claimed `address` array.
    expect(of("postcode")).toEqual([]);
  });

  it("offsets point at the real text", () => {
    for (const f of findings) expect(FHIR.slice(f.start, f.end)).toBe(f.value);
  });

  it("still works on JSON too broken to parse, which is the log line people paste", () => {
    const broken = '{"resourceType":"Patient","name":[{"family":"Sharma"}],"birthDate":"1975-02-14"';
    expect(() => JSON.parse(broken)).toThrow();
    expect(detectInJson(broken).map((f) => f.kind)).toContain("name");
  });

  it("skips nulls and empty values", () => {
    expect(detectInJson('{"birthDate":null,"name":""}')).toEqual([]);
  });
});

describe("detectInDicom", () => {
  const findings = detectInDicom(DICOM);

  it("takes the patient module and the accession, and leaves the body part", () => {
    const values = findings.map((f) => f.value);
    expect(values).toContain("SHARMA^PRIYA");
    expect(values).toContain("100234");
    expect(values).toContain("19750214");
    expect(values).toContain("ACC12345");
    expect(values).not.toContain("CHEST");
  });

  it("names the tag it acted on", () => {
    expect(findings.find((f) => f.value === "SHARMA^PRIYA")?.reason).toMatch(/\(0010,0010\)/);
  });

  it("offsets point at the real text", () => {
    for (const f of findings) expect(DICOM.slice(f.start, f.end)).toBe(f.value);
  });
});

describe("detectInText", () => {
  const kinds = (text: string) => detectInText(text).map((f) => f.kind);

  it("finds the ordinary contact details", () => {
    expect(kinds("write to priya@hospital.in or call 98450 12345")).toEqual(expect.arrayContaining(["email", "phone"]));
  });

  it("finds Indian identifiers, which a US-only detector misses entirely", () => {
    expect(kinds("Aadhaar 4321 8765 2109")).toContain("aadhaar");
    expect(kinds("PAN ABCDE1234F")).toContain("pan");
    // Aadhaar never starts with 0 or 1, so a plain 12-digit id is not one.
    expect(kinds("order 1234 5678 9012")).not.toContain("aadhaar");
  });

  it("reads a labelled identifier without swallowing the label", () => {
    const [mrn] = detectInText("MRN: HOSP-100234 admitted");
    expect(mrn.value).toBe("HOSP-100234");
    expect(mrn.kind).toBe("mrn");
  });

  it("flags an age over 89, which Safe Harbor treats differently from any other age", () => {
    expect(kinds("patient is 94 years old")).toContain("age90");
    expect(kinds("patient is 42 years old")).not.toContain("age90");
  });

  it("treats a URL as identifying, because the path carries the record", () => {
    expect(kinds("see https://emr.hospital.in/patients/100234")).toContain("url");
  });

  it("marks everything it finds as a guess", () => {
    expect(detectInText("call 555-123-4567").every((f) => f.certain === false)).toBe(true);
  });

  it("returns nothing for text with nothing in it", () => {
    expect(detectInText("the ORU never arrived and the queue is empty")).toEqual([]);
  });
});

describe("detectPhi", () => {
  it("lets a field finding win an overlap against a regex guess", () => {
    const findings = detectPhi(HL7);
    const dob = findings.filter((f) => f.value === "19750214");
    expect(dob).toHaveLength(1);
    expect(dob[0].certain).toBe(true);
  });

  it("still runs the regex over what the structure did not claim", () => {
    const text = `${HL7}\rNTE|1||contact priya@hospital.in about this`;
    expect(detectPhi(text).some((f) => f.kind === "email")).toBe(true);
  });

  it("checks JSON keys even when nothing announced itself as FHIR", () => {
    expect(detectPhi('{"birthDate":"1975-02-14"}').some((f) => f.certain)).toBe(true);
  });
});

describe("redact", () => {
  it("replaces each finding with a token and keeps the original in the map", () => {
    const result = redact("MRN: 100234 and MRN: 100234 again");
    expect(result.text).toBe("MRN: [MRN_1] and MRN: [MRN_1] again");
    expect(result.map["[MRN_1]"]).toBe("100234");
  });

  it("gives the same value the same token so the model can reason across it", () => {
    const result = redact("ORM for MRN: 100234, ORU for MRN: 100234, other MRN: 999999");
    expect(Object.keys(result.map)).toHaveLength(2);
    expect(result.text.match(/\[MRN_1\]/g)).toHaveLength(2);
  });

  it("keeps the text around the redactions exactly as it was", () => {
    const result = redact(HL7);
    expect(result.text).toContain("718-7^Haemoglobin");
    expect(result.text).toContain("9.1|g/dL");
    expect(result.text).not.toContain("SHARMA");
    expect(result.text).not.toContain("123-45-6789");
  });

  it("does not let a nested finding split the one containing it", () => {
    const result = redact(FHIR);
    // The address block is one token, not an address with a postcode carved out.
    expect(result.text).not.toContain("Bengaluru");
    expect(result.text).not.toContain("560001");
    expect(JSON.parse(JSON.stringify(result.map))).toBeTruthy();
  });

  it("reports nothing residual when it removed everything", () => {
    expect(redact("MRN: 100234").residual).toEqual([]);
  });

  it("does not mistake its own tokens for identifiers", () => {
    const result = redact("MRN: 100234, DOB: 1975-02-14");
    expect(result.residual).toEqual([]);
    expect(result.text).toMatch(/\[MRN_1\].*\[BIRTHDATE_1\]/);
  });

  it("leaves text with nothing in it completely untouched", () => {
    const clean = "the ORU never arrived and the queue is empty";
    const result = redact(clean);
    expect(result.text).toBe(clean);
    expect(result.map).toEqual({});
  });
});

describe("reidentify", () => {
  it("puts the real values back", () => {
    const { text, map } = redact("MRN: 100234 failed");
    expect(reidentify(text, map)).toBe("MRN: 100234 failed");
  });

  it("survives a round trip through an answer that quotes the token", () => {
    const { map } = redact("MRN: 100234 and MRN: 999999");
    const answer = "The ORM for [MRN_1] failed; [MRN_2] was fine.";
    expect(reidentify(answer, map)).toBe("The ORM for 100234 failed; 999999 was fine.");
  });

  it("replaces the longer token first, so [MRN_1] does not eat [MRN_10]", () => {
    const map = { "[MRN_1]": "AAA", "[MRN_10]": "BBB" };
    expect(reidentify("[MRN_10] then [MRN_1]", map)).toBe("BBB then AAA");
  });

  it("leaves an answer with no tokens in it alone", () => {
    expect(reidentify("nothing to do here", { "[MRN_1]": "x" })).toBe("nothing to do here");
  });
});

describe("applyPolicy", () => {
  it("off sends exactly what was written, and says so", () => {
    const decision = applyPolicy(HL7, "off");
    expect(decision.allowed).toBe(true);
    expect(decision.text).toBe(HL7);
    expect(decision.message).toMatch(/redaction is off/);
  });

  it("warn reports without removing anything — it must not redact and then send the original", () => {
    const decision = applyPolicy("MRN: 100234", "warn");
    expect(decision.allowed).toBe(true);
    expect(decision.text).toBe("MRN: 100234");
    expect(decision.map).toEqual({});
    expect(decision.findings.length).toBeGreaterThan(0);
    expect(decision.message).toMatch(/NOT removed/);
  });

  it("redact sends tokens and keeps the map", () => {
    const decision = applyPolicy("MRN: 100234", "redact");
    expect(decision.allowed).toBe(true);
    expect(decision.text).toBe("MRN: [MRN_1]");
    expect(decision.map["[MRN_1]"]).toBe("100234");
    expect(decision.message).toMatch(/stay on this machine/);
  });

  it("block allows a send once nothing identifying is left", () => {
    const decision = applyPolicy(HL7, "block");
    expect(decision.allowed).toBe(true);
    expect(decision.residual).toEqual([]);
  });

  /*
   * The block branch is a backstop, and today it never fires: redaction is
   * idempotent over every detector in this file, so `residual` comes back empty
   * whenever `redact` did the work. That is the good outcome, not a missing
   * feature — the point of scanning the redacted text is to catch the day a
   * detector changes and stops being idempotent. So what is asserted here is
   * that `residual` genuinely reports what survives, using a redaction that was
   * told to remove nothing.
   */
  it("reports as residual whatever is still identifiable in the text that would be sent", () => {
    const nothingRemoved = redact("MRN: 100234", []);
    expect(nothingRemoved.text).toBe("MRN: 100234");
    expect(nothingRemoved.residual.map((f) => f.kind)).toContain("mrn");
    expect(KIND_LABEL[nothingRemoved.residual[0].kind]).toBe("MRN");
  });

  it("says something reassuring rather than nothing when the text is clean", () => {
    expect(applyPolicy("queue is empty", "redact").message).toMatch(/Nothing identifying/);
    expect(applyPolicy("queue is empty", "warn").message).toMatch(/Nothing identifying/);
  });
});

describe("isLocalDestination", () => {
  it("knows the machine's own addresses", () => {
    expect(isLocalDestination("http://localhost:11434")).toBe(true);
    expect(isLocalDestination("http://127.0.0.1:11434/")).toBe(true);
    expect(isLocalDestination("http://[::1]:11434")).toBe(true);
  });

  it("is not fooled by a hostname that merely contains localhost", () => {
    expect(isLocalDestination("https://localhost.evil.com")).toBe(false);
    expect(isLocalDestination("https://api.openai.com/v1")).toBe(false);
    expect(isLocalDestination("http://192.168.1.10:11434")).toBe(false);
  });
});

describe("summarise and groupFindings", () => {
  it("counts by kind, most common first", () => {
    expect(summarise([])).toBe("nothing found");
    expect(summarise(detectInHl7(HL7))).toMatch(/Name|MRN/);
  });

  it("groups duplicates and puts the certain findings first", () => {
    const groups = groupFindings(detectPhi(HL7));
    expect(groups[0].certain).toBe(true);
    expect(groups.every((g) => g.values.length === new Set(g.values).size)).toBe(true);
  });
});
