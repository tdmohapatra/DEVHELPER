import { describe, it, expect } from "vitest";
import {
  ABNORMAL_FLAGS,
  RESULT_STATUS_CODES,
  TERMINATION_CODES,
  astmField,
  astmFieldName,
  astmTimestampToIso,
  astmToJson,
  describeCode,
  flattenAstm,
  formatAstm,
  parseAstm,
  parseDelimiters,
  parseTestId,
  recordDescription,
  splitRecords,
  validateAstm,
} from "./astm";

const SAMPLE = [
  "H|\\^&|||Sysmex^XN-1000|||||LIS||P|1|20240101120000",
  "P|1||PID123||DOE^JOHN||19800101|M",
  "O|1|SPEC001||^^^WBC^White Blood Cell|R||20240101090000",
  "R|1|^^^WBC^White Blood Cell|7.2|10*3/uL|4.0-11.0|N||F||OP1|20240101093000",
  "L|1|N",
].join("\r\n");

describe("splitRecords", () => {
  it("handles CR, LF and CRLF separators", () => {
    expect(splitRecords("H|\\^&\rP|1\nO|1\r\nL|1").map((r) => r.text)).toEqual(["H|\\^&", "P|1", "O|1", "L|1"]);
  });
  it("drops blank lines but keeps original line numbers", () => {
    const records = splitRecords("H|\\^&\n\n\nL|1|N");
    expect(records.map((r) => r.line)).toEqual([1, 4]);
  });
});

describe("parseDelimiters", () => {
  it("reads the delimiter set declared by the header", () => {
    expect(parseDelimiters("H|\\^&|||x")).toEqual({ field: "|", repeat: "\\", component: "^", escape: "&" });
  });
  it("honours a non-standard delimiter set", () => {
    expect(parseDelimiters("H*~/#*")).toEqual({ field: "*", repeat: "~", component: "/", escape: "#" });
  });
  it("falls back to the classic set when the header is truncated", () => {
    expect(parseDelimiters("H")).toEqual({ field: "|", repeat: "\\", component: "^", escape: "&" });
  });
});

describe("parseAstm", () => {
  it("parses records, types and descriptions", () => {
    const message = parseAstm(SAMPLE);
    expect(message.records.map((r) => r.type)).toEqual(["H", "P", "O", "R", "L"]);
    expect(message.records[1].description).toBe("Patient Information");
  });
  it("pulls sender, receiver and version out of the header", () => {
    const message = parseAstm(SAMPLE);
    expect(message.sender).toBe("Sysmex");
    expect(message.receiver).toBe("LIS");
    expect(message.version).toBe("1");
  });
  it("does not read the header's delimiter definition as a sequence number", () => {
    const message = parseAstm(SAMPLE);
    expect(message.records[0].sequence).toBeNull();
    expect(message.records[1].sequence).toBe(1);
  });
  it("splits components and repeats using the declared delimiters", () => {
    const patient = parseAstm(SAMPLE).records[1];
    expect(astmField(patient, 6)).toBe("DOE^JOHN");
    expect(patient.fields.find((f) => f.index === 6)!.components).toEqual(["DOE", "JOHN"]);
  });
  it("names fields per record type", () => {
    expect(astmFieldName("R", 4)).toBe("Measurement Value");
    expect(astmFieldName("O", 3)).toBe("Specimen ID");
    expect(astmFieldName("R", 99)).toBe("Field 99");
  });
  it("works with a non-standard delimiter set end to end", () => {
    const message = parseAstm("H*~/#*||*ANALYZER*|||||LIS||P|1\rL*1*N");
    expect(message.records.map((r) => r.type)).toEqual(["H", "L"]);
    expect(message.delimiters.component).toBe("/");
  });
  it("rejects a message with no header", () => {
    expect(() => parseAstm("P|1||X\nL|1|N")).toThrow(/H \(header\) record/);
    expect(() => parseAstm("   ")).toThrow(/Empty message/);
  });
});

describe("recordDescription / describeCode", () => {
  it("describes known record types and flags unknown ones", () => {
    expect(recordDescription("q")).toBe("Request Information (Query)");
    expect(recordDescription("Z")).toBe("Unknown record type");
  });
  it("decodes coded values and reports unrecognized ones", () => {
    expect(describeCode(RESULT_STATUS_CODES, "F")).toBe("Final");
    expect(describeCode(ABNORMAL_FLAGS, "HH")).toBe("Above panic high");
    expect(describeCode(TERMINATION_CODES, "N")).toBe("Normal termination");
    expect(describeCode(RESULT_STATUS_CODES, "Z")).toBe('Unrecognized code "Z"');
    expect(describeCode(RESULT_STATUS_CODES, "")).toBe("");
  });
});

describe("astmTimestampToIso", () => {
  it("converts date-only and full timestamps", () => {
    expect(astmTimestampToIso("20240101")).toBe("2024-01-01");
    expect(astmTimestampToIso("20240101093000")).toBe("2024-01-01T09:30:00");
    expect(astmTimestampToIso("202401010930")).toBe("2024-01-01T09:30:00");
  });
  it("rejects values that are not timestamps", () => {
    expect(astmTimestampToIso("2024")).toBeNull();
    expect(astmTimestampToIso("20241301")).toBeNull();
    expect(astmTimestampToIso("20240132")).toBeNull();
    expect(astmTimestampToIso("not a date")).toBeNull();
  });
});

describe("parseTestId", () => {
  it("reads code and name from the classic ^^^code^name layout", () => {
    expect(parseTestId("^^^WBC^White Blood Cell")).toEqual({
      code: "WBC",
      name: "White Blood Cell",
      raw: "^^^WBC^White Blood Cell",
    });
  });
  it("handles a bare code and an empty field", () => {
    expect(parseTestId("GLU").code).toBe("GLU");
    expect(parseTestId("").code).toBe("");
  });
});

describe("flattenAstm", () => {
  it("produces occurrence-numbered paths for populated fields only", () => {
    const paths = flattenAstm(parseAstm(SAMPLE)).map((p) => p.path);
    expect(paths).toContain("P[1]-6");
    expect(paths).toContain("R[1]-4");
    expect(paths).not.toContain("P[1]-1"); // record type itself
    expect(paths).not.toContain("P[1]-5"); // empty
  });
  it("numbers repeated record types separately", () => {
    const raw = "H|\\^&\rP|1\rO|1|S1\rR|1|^^^A|1\rR|2|^^^B|2\rL|1|N";
    const paths = flattenAstm(parseAstm(raw)).map((p) => p.path);
    expect(paths).toContain("R[1]-4");
    expect(paths).toContain("R[2]-4");
  });
});

describe("formatAstm / astmToJson", () => {
  it("normalizes separators to one record per line", () => {
    expect(formatAstm("H|\\^&\r\nL|1|N").split("\n")).toHaveLength(2);
  });
  it("emits named, populated fields as JSON", () => {
    const json = JSON.parse(astmToJson(SAMPLE));
    expect(json.sender).toBe("Sysmex");
    expect(json.records).toHaveLength(5);
    const result = json.records.find((r: { record: string }) => r.record === "R");
    expect(result.fields.find((f: { index: number }) => f.index === 4)).toEqual({
      index: 4, name: "Measurement Value", value: "7.2",
    });
  });
});

describe("validateAstm", () => {
  it("accepts a well-formed message", () => {
    expect(validateAstm(SAMPLE)).toEqual([]);
  });
  it("requires H first and L last", () => {
    const issues = validateAstm("P|1||X\nL|1|N");
    expect(issues.some((i) => i.severity === "error")).toBe(true);
  });
  it("flags a missing terminator", () => {
    const issues = validateAstm("H|\\^&\rP|1\rO|1|S1");
    expect(issues.some((i) => i.message.includes("must be L"))).toBe(true);
  });
  it("flags more than one header", () => {
    const issues = validateAstm("H|\\^&\rH|\\^&\rL|1|N");
    expect(issues.some((i) => i.message.includes("More than one H"))).toBe(true);
  });
  it("rejects unknown record types", () => {
    const issues = validateAstm("H|\\^&\rZ|1\rL|1|N");
    expect(issues.some((i) => i.message.includes('Unknown record type "Z"'))).toBe(true);
  });
  it("requires orders under a patient and results under an order", () => {
    const orphanOrder = validateAstm("H|\\^&\rO|1|S1\rL|1|N");
    expect(orphanOrder.some((i) => i.message.includes("O (order) record must follow"))).toBe(true);
    const orphanResult = validateAstm("H|\\^&\rP|1\rR|1|^^^A|1\rL|1|N");
    expect(orphanResult.some((i) => i.message.includes("R (result) record must follow"))).toBe(true);
  });
  it("checks sequence numbering and restarts it per parent", () => {
    const wrong = validateAstm("H|\\^&\rP|1\rO|1|S1\rR|1|^^^A|1\rR|3|^^^B|2\rL|1|N");
    expect(wrong.some((i) => i.message.includes("R-2 is 3"))).toBe(true);

    const restart = validateAstm([
      "H|\\^&", "P|1", "O|1|S1", "R|1|^^^A|1",
      "P|2", "O|1|S2", "R|1|^^^A|2", "L|1|N",
    ].join("\r"));
    expect(restart).toEqual([]);
  });
  it("requires a numeric sequence number", () => {
    const issues = validateAstm("H|\\^&\rP|x\rL|1|N");
    expect(issues.some((i) => i.message.includes("P-2 must be a numeric"))).toBe(true);
  });
  it("warns on unrecognized result status, abnormal flag and termination code", () => {
    const issues = validateAstm("H|\\^&\rP|1\rO|1|S1\rR|1|^^^A|1|||||Z\rL|1|Z");
    expect(issues.some((i) => i.message.includes('result status "Z"'))).toBe(true);
    expect(issues.some((i) => i.message.includes('termination code "Z"'))).toBe(true);
    const flagged = validateAstm("H|\\^&\rP|1\rO|1|S1\rR|1|^^^A|1|||QQ||F\rL|1|N");
    expect(flagged.some((i) => i.message.includes('abnormal flag "QQ"'))).toBe(true);
  });
  it("warns on an empty measurement value and an empty specimen id", () => {
    const issues = validateAstm("H|\\^&\rP|1\rO|1\rR|1|^^^A||\rL|1|N");
    expect(issues.some((i) => i.message.includes("R-4"))).toBe(true);
    expect(issues.some((i) => i.message.includes("O-3"))).toBe(true);
  });
  it("warns on malformed timestamps where the standard expects them", () => {
    const issues = validateAstm("H|\\^&|||S|||||LIS||P|1|01-01-2024\rP|1|||||||\rL|1|N");
    expect(issues.some((i) => i.message.includes("H-14 is not a valid ASTM timestamp"))).toBe(true);
  });
  it("reports an empty message as an error rather than throwing", () => {
    expect(validateAstm("")).toEqual([{ severity: "error", message: "The message is empty.", location: "" }]);
  });
});
