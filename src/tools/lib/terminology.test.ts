import { describe, expect, it } from "vitest";
import {
  applyCrosswalk,
  detectSystem,
  icd10Chapter,
  ICD10_CHAPTERS,
  loincCheckDigit,
  normalizeNdc,
  parseCrosswalk,
  splitCodes,
  SYSTEMS,
  toFhirCoding,
  validateCode,
  verhoeffDigit,
  verhoeffValid,
} from "./terminology";

describe("check digits", () => {
  it("accepts real SNOMED identifiers", () => {
    // 271649006 systolic blood pressure, 73211009 diabetes mellitus.
    expect(verhoeffValid("271649006")).toBe(true);
    expect(verhoeffValid("73211009")).toBe(true);
    expect(verhoeffValid("22298006")).toBe(true);
  });

  it("catches the two errors a human retyping an id actually makes", () => {
    // One wrong digit.
    expect(verhoeffValid("271649007")).toBe(false);
    expect(verhoeffValid("271648006")).toBe(false);
    // Two adjacent digits swapped.
    expect(verhoeffValid("276149006")).toBe(false);
  });

  it("computes the digit that should have been there", () => {
    expect(verhoeffDigit("27164900")).toBe(6);
    expect(verhoeffDigit("7321100")).toBe(9);
    expect(verhoeffValid("")).toBe(false);
    expect(verhoeffValid("12a")).toBe(false);
  });

  it("computes real LOINC check digits", () => {
    expect(loincCheckDigit("718")).toBe(7); // 718-7 haemoglobin
    expect(loincCheckDigit("2160")).toBe(0); // 2160-0 creatinine
    expect(loincCheckDigit("nope")).toBeNull();
  });
});

describe("validateCode — ICD-10-CM", () => {
  it("accepts a code with and without the dot, and normalises it", () => {
    expect(validateCode("icd10cm", "E119").normalized).toBe("E11.9");
    expect(validateCode("icd10cm", "e11.9").normalized).toBe("E11.9");
    expect(validateCode("icd10cm", "E11.9").valid).toBe(true);
  });

  it("explains the parts, including the 7th character", () => {
    const report = validateCode("icd10cm", "S72.001A");
    expect(report.valid).toBe(true);
    expect(report.parts[0]).toMatchObject({ label: "Category", value: "S72" });
    expect(report.parts[0].note).toMatch(/Injury/);
    expect(report.parts.at(-1)).toMatchObject({ label: "7th character", value: "A", note: "initial encounter" });
  });

  it("warns when an injury code has no 7th character, which is what gets it rejected", () => {
    const report = validateCode("icd10cm", "S72.001");
    expect(report.valid).toBe(true);
    expect(report.issues.some((i) => i.level === "warn" && /7th character/.test(i.message))).toBe(true);
  });

  it("rejects shapes that are not ICD-10 at all", () => {
    expect(validateCode("icd10cm", "99213").valid).toBe(false);
    expect(validateCode("icd10cm", "E1").valid).toBe(false);
    expect(validateCode("icd10cm", "U07.1").valid).toBe(true);
  });

  it("allows a letter in the third position, because real categories have one", () => {
    // C4A (Merkel cell carcinoma), O9A (maternal injury), D3A (benign
    // neuroendocrine tumours) — so the third character is not always a digit.
    for (const code of ["C4A.0", "O9A.211", "D3A.00"]) expect(validateCode("icd10cm", code).valid).toBe(true);
  });

  it("always says that structure is not existence", () => {
    expect(validateCode("icd10cm", "E11.9").issues.some((i) => /not bundled/.test(i.message))).toBe(true);
  });

  it("maps every chapter range, and the ranges cover the alphabet in order", () => {
    expect(icd10Chapter("E11")).toMatch(/Endocrine/);
    expect(icd10Chapter("U07.1")).toMatch(/special purposes/);
    expect(icd10Chapter("Z00")).toMatch(/Factors influencing/);
    expect(icd10Chapter("X")).toBeNull();
    for (const chapter of ICD10_CHAPTERS) expect(chapter.from <= chapter.to).toBe(true);
  });
});

describe("validateCode — the other systems", () => {
  it("splits ICD-10-PCS into its seven axes", () => {
    const report = validateCode("icd10pcs", "0DTJ0ZZ");
    expect(report.valid).toBe(true);
    expect(report.parts).toHaveLength(7);
    expect(report.parts[2].label).toBe("3. Root operation");
  });

  it("rejects the letters PCS never uses", () => {
    expect(validateCode("icd10pcs", "0DTJ0ZI").valid).toBe(false);
    expect(validateCode("icd10pcs", "0DTJ0Z").valid).toBe(false);
  });

  it("tells Category I, II and III CPT apart, and says why a Category III was denied", () => {
    expect(validateCode("cpt", "99213").parts[0].label).toBe("Category I");
    expect(validateCode("cpt", "0001F").parts[0].label).toBe("Category II");
    const three = validateCode("cpt", "0042T");
    expect(three.parts[0].label).toBe("Category III");
    expect(three.parts[0].note).toMatch(/deny these/);
  });

  it("says outright that CPT cannot be verified here", () => {
    expect(validateCode("cpt", "99213").issues.some((i) => /copyrighted by the AMA/.test(i.message))).toBe(true);
    expect(validateCode("cpt", "9921").valid).toBe(false);
  });

  it("reads the HCPCS section letter", () => {
    const report = validateCode("hcpcs", "J1885");
    expect(report.valid).toBe(true);
    expect(report.parts[0].note).toMatch(/drugs administered/);
    expect(validateCode("hcpcs", "Z1885").valid).toBe(false);
  });

  it("checks a LOINC check digit and says what it should have been", () => {
    expect(validateCode("loinc", "718-7").valid).toBe(true);
    const wrong = validateCode("loinc", "718-8");
    expect(wrong.valid).toBe(false);
    expect(wrong.issues[0].message).toMatch(/should end in -7/);
    expect(validateCode("loinc", "7187").valid).toBe(false);
  });

  it("validates a SNOMED id and reads its partition", () => {
    const report = validateCode("snomed", "271649006");
    expect(report.valid).toBe(true);
    expect(report.parts[1]).toMatchObject({ label: "Partition", value: "00" });
    expect(report.parts[1].note).toMatch(/concept id/);
  });

  it("warns when a description id is used where a concept id belongs", () => {
    // A valid Verhoeff id whose partition digits are 01.
    const body = "12345601";
    const id = `${body}${verhoeffDigit(body)}`;
    const report = validateCode("snomed", id);
    expect(report.valid).toBe(true);
    expect(report.issues.some((i) => /description id, not a concept id/.test(i.message))).toBe(true);
  });

  it("rejects a corrupted SNOMED id and names the digit it should end in", () => {
    const report = validateCode("snomed", "271649007");
    expect(report.valid).toBe(false);
    expect(report.issues[0].message).toMatch(/should end in 6/);
    expect(validateCode("snomed", "012345").valid).toBe(false);
  });

  it("normalises an NDC by segment, not by string length", () => {
    expect(normalizeNdc("0002-8215-01")).toBe("00002821501");
    expect(normalizeNdc("00002-8215-1")).toBe("00002821501");
    expect(normalizeNdc("12345-678-90")).toBe("12345067890");
    // Ten digits with no segments is ambiguous and must not be guessed.
    expect(normalizeNdc("0002821501")).toBeNull();
    expect(normalizeNdc("00002821501")).toBe("00002821501");
  });

  it("labels the three NDC segments and says when it converted", () => {
    const report = validateCode("ndc", "0002-8215-01");
    expect(report.valid).toBe(true);
    expect(report.parts.map((p) => p.value)).toEqual(["00002", "8215", "01"]);
    expect(report.issues.some((i) => /Normalised from the 10-digit form/.test(i.message))).toBe(true);
    expect(validateCode("ndc", "0002821501").valid).toBe(false);
  });

  it("warns that a mistyped RXCUI is another valid drug", () => {
    const report = validateCode("rxnorm", "1049502");
    expect(report.valid).toBe(true);
    expect(report.issues[0].message).toMatch(/no check digit/);
  });
});

describe("detectSystem", () => {
  it("recognises the unambiguous shapes", () => {
    expect(detectSystem("718-7")).toBe("loinc");
    expect(detectSystem("E11.9")).toBe("icd10cm");
    expect(detectSystem("J1885")).toBe("hcpcs");
    expect(detectSystem("0042T")).toBe("cpt");
    expect(detectSystem("0002-8215-01")).toBe("ndc");
    expect(detectSystem("271649006")).toBe("snomed");
    expect(detectSystem("0DTJ0ZZ")).toBe("icd10pcs");
  });

  it("falls back to CPT for five bare digits, which is a genuine ambiguity", () => {
    expect(detectSystem("99213")).toBe("cpt");
  });

  it("returns null rather than guessing wildly", () => {
    expect(detectSystem("hello")).toBeNull();
    expect(detectSystem("")).toBeNull();
  });
});

describe("crosswalk", () => {
  const table = [
    "# local, standard, system, description",
    "LOCAL-HB, 718-7, loinc, Haemoglobin",
    "LOCAL-CR, 2160-0, loinc, Creatinine",
    "LOCAL-DM, E11.9, icd10cm, Type 2 diabetes without complications",
    "LOCAL-BAD, ZZ999, icd10cm, a target that is not a code",
  ].join("\n");

  it("parses the simple table an analyst can produce from a spreadsheet", () => {
    const entries = parseCrosswalk(table);
    expect(entries).toHaveLength(4);
    expect(entries[0]).toMatchObject({ local: "LOCAL-HB", standard: "718-7", system: "loinc", description: "Haemoglobin" });
  });

  it("skips comments and a header row instead of mapping them", () => {
    const entries = parseCrosswalk("local,standard\nA,718-7");
    expect(entries).toHaveLength(1);
    expect(entries[0].local).toBe("A");
  });

  it("guesses the system when the column is missing", () => {
    expect(parseCrosswalk("A, 718-7")[0].system).toBe("loinc");
  });

  it("reports the codes with no row, which is the deliverable", () => {
    const report = applyCrosswalk(["LOCAL-HB", "LOCAL-XX", "LOCAL-YY", "LOCAL-XX"], parseCrosswalk(table));
    expect(report.mapped).toHaveLength(1);
    expect(report.unmapped).toEqual(["LOCAL-XX", "LOCAL-YY"]);
  });

  it("matches case-insensitively, because feeds are inconsistent about it", () => {
    expect(applyCrosswalk(["local-hb"], parseCrosswalk(table)).mapped).toHaveLength(1);
  });

  it("flags table rows whose own target fails its structure check", () => {
    const report = applyCrosswalk([], parseCrosswalk(table));
    expect(report.invalidTargets).toHaveLength(1);
    expect(report.invalidTargets[0].entry.local).toBe("LOCAL-BAD");
  });

  it("reports table rows nothing in the feed used", () => {
    const report = applyCrosswalk(["LOCAL-HB"], parseCrosswalk(table));
    expect(report.unused.map((e) => e.local)).toEqual(["LOCAL-CR", "LOCAL-DM", "LOCAL-BAD"]);
  });

  it("validates each mapped target as it goes", () => {
    const report = applyCrosswalk(["LOCAL-HB"], parseCrosswalk(table));
    expect(report.mapped[0].report?.valid).toBe(true);
  });
});

describe("splitCodes and toFhirCoding", () => {
  it("splits a pasted feed however it was pasted", () => {
    expect(splitCodes("A, B\nC;D\tE")).toEqual(["A", "B", "C", "D", "E"]);
    expect(splitCodes("  ")).toEqual([]);
  });

  it("emits a Coding with the right system URI", () => {
    const coding = JSON.parse(toFhirCoding(validateCode("loinc", "718-7"), "Haemoglobin"));
    expect(coding).toEqual({ system: "http://loinc.org", code: "718-7", display: "Haemoglobin" });
  });

  it("gives every system a URI and a licence note", () => {
    for (const system of SYSTEMS) {
      expect(system.uri).toMatch(/^https?:\/\/|^urn:/);
      expect(system.licence.length).toBeGreaterThan(20);
    }
  });
});
