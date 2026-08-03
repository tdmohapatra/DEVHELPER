/**
 * ASTM E1394 (record content) parsing helpers — the message format clinical lab
 * analyzers use to talk to a LIS. Developer/integration utility only, NOT
 * clinical software. All processing is local.
 *
 * Records are `|`-delimited lines identified by a single leading letter, and the
 * H record declares the delimiter set it used, so nothing here is hard-coded to
 * the common `H|\^&` case. See `astmAdvanced.ts` for the E1381 frame/checksum
 * layer that carries these records over a serial or TCP link.
 */

export interface AstmDelimiters {
  field: string;
  repeat: string;
  component: string;
  escape: string;
}

export const DEFAULT_DELIMITERS: AstmDelimiters = { field: "|", repeat: "\\", component: "^", escape: "&" };

export interface AstmField {
  /** 1-based position within the record; field 1 is the record type itself */
  index: number;
  name: string;
  value: string;
  /** value split on the component delimiter */
  components: string[];
  /** value split on the repeat delimiter */
  repeats: string[];
}

export interface AstmRecord {
  /** single-letter record type, upper-cased (H, P, O, R, C, Q, M, S, L) */
  type: string;
  description: string;
  /** sequence number as sent (field 2), or null for H and unparseable values */
  sequence: number | null;
  fields: AstmField[];
  raw: string;
  /** 1-based line number in the input, for error locations */
  line: number;
}

export interface AstmMessage {
  records: AstmRecord[];
  delimiters: AstmDelimiters;
  /** H.5 sender name/id, first component */
  sender: string;
  /** H.10 receiver id, first component */
  receiver: string;
  /** H.13 version number */
  version: string;
}

const RECORD_TYPES: Record<string, string> = {
  H: "Message Header",
  P: "Patient Information",
  O: "Test Order",
  R: "Result",
  C: "Comment",
  Q: "Request Information (Query)",
  M: "Manufacturer Information",
  S: "Scientific",
  L: "Message Terminator",
};

/** Field names per record type (1-based). Positions follow ASTM E1394. */
const FIELD_NAMES: Record<string, Record<number, string>> = {
  H: {
    1: "Record Type", 2: "Delimiter Definition", 3: "Message Control ID", 4: "Access Password",
    5: "Sender Name / ID", 6: "Sender Address", 7: "Reserved", 8: "Sender Telephone",
    9: "Sender Characteristics", 10: "Receiver ID", 11: "Comment", 12: "Processing ID",
    13: "Version Number", 14: "Date/Time of Message",
  },
  P: {
    1: "Record Type", 2: "Sequence Number", 3: "Practice Patient ID", 4: "Lab Patient ID",
    5: "Alternate Patient ID", 6: "Patient Name", 7: "Mother's Maiden Name", 8: "Birth Date",
    9: "Patient Sex", 10: "Patient Race", 11: "Patient Address", 12: "Reserved",
    13: "Patient Telephone", 14: "Attending Physician", 15: "Special Field 1", 16: "Special Field 2",
    17: "Patient Height", 18: "Patient Weight", 19: "Known Diagnosis", 20: "Active Medications",
    21: "Patient Diet", 22: "Practice Field 1", 23: "Practice Field 2", 24: "Admission/Discharge Dates",
    25: "Admission Status", 26: "Location", 27: "Alternative Diagnostic Code Nature",
    28: "Alternative Diagnostic Code", 29: "Religion", 30: "Marital Status", 31: "Isolation Status",
    32: "Language", 33: "Hospital Service", 34: "Hospital Institution", 35: "Dosage Category",
  },
  O: {
    1: "Record Type", 2: "Sequence Number", 3: "Specimen ID", 4: "Instrument Specimen ID",
    5: "Universal Test ID", 6: "Priority", 7: "Ordered Date/Time", 8: "Collection Date/Time",
    9: "Collection End Time", 10: "Collection Volume", 11: "Collector ID", 12: "Action Code",
    13: "Danger Code", 14: "Relevant Clinical Information", 15: "Specimen Received Date/Time",
    16: "Specimen Descriptor", 17: "Ordering Physician", 18: "Physician Telephone",
    19: "User Field 1", 20: "User Field 2", 21: "Laboratory Field 1", 22: "Laboratory Field 2",
    23: "Results Reported Date/Time", 24: "Instrument Charge", 25: "Instrument Section ID",
    26: "Report Types", 27: "Reserved", 28: "Specimen Collection Location",
    29: "Nosocomial Infection Flag", 30: "Specimen Service", 31: "Specimen Institution",
  },
  R: {
    1: "Record Type", 2: "Sequence Number", 3: "Universal Test ID", 4: "Measurement Value",
    5: "Units", 6: "Reference Ranges", 7: "Abnormal Flags", 8: "Nature of Abnormality Testing",
    9: "Result Status", 10: "Normative Values Changed", 11: "Operator ID", 12: "Test Started",
    13: "Test Completed", 14: "Instrument ID",
  },
  C: {
    1: "Record Type", 2: "Sequence Number", 3: "Comment Source", 4: "Comment Text", 5: "Comment Type",
  },
  Q: {
    1: "Record Type", 2: "Sequence Number", 3: "Starting Range ID", 4: "Ending Range ID",
    5: "Universal Test ID", 6: "Nature of Request Time Limits", 7: "Beginning Request Date/Time",
    8: "Ending Request Date/Time", 9: "Requesting Physician", 10: "Requesting Physician Telephone",
    11: "User Field 1", 12: "User Field 2", 13: "Request Information Status",
  },
  L: {
    1: "Record Type", 2: "Sequence Number", 3: "Termination Code",
  },
};

export function recordDescription(type: string): string {
  return RECORD_TYPES[type.toUpperCase()] ?? "Unknown record type";
}

export function astmFieldName(type: string, index: number): string {
  return FIELD_NAMES[type.toUpperCase()]?.[index] ?? `Field ${index}`;
}

/** Coded values worth spelling out in the UI. Unknown codes are reported as-is. */
export const PRIORITY_CODES: Record<string, string> = {
  S: "Stat", A: "As soon as possible", R: "Routine", C: "Callback", P: "Preoperative",
};
export const ACTION_CODES: Record<string, string> = {
  C: "Cancel", A: "Add to existing order", N: "New requests", P: "Pending",
  L: "Reserved", X: "Cancel request", Q: "Treat as QC specimen",
};
export const RESULT_STATUS_CODES: Record<string, string> = {
  C: "Correction of previously transmitted result", F: "Final", I: "Pending in instrument",
  M: "MIC level", P: "Preliminary", R: "Previously transmitted", S: "Partial",
  U: "Status changed to final", W: "Post original as wrong", X: "Cannot be done",
};
export const ABNORMAL_FLAGS: Record<string, string> = {
  L: "Below low normal", H: "Above high normal", LL: "Below panic low", HH: "Above panic high",
  "<": "Below absolute low (off scale)", ">": "Above absolute high (off scale)",
  N: "Normal", U: "Significant rise", D: "Significant fall", B: "Better", W: "Worse",
  A: "Abnormal", AA: "Very abnormal",
};
export const TERMINATION_CODES: Record<string, string> = {
  N: "Normal termination", T: "Sender aborted", R: "Receiver requested abort",
  E: "Unknown system error", Q: "Error in last request", I: "No information available",
  F: "Last request processed",
};

/** Describe a coded value, e.g. `describeCode(RESULT_STATUS_CODES, "F")`. */
export function describeCode(table: Record<string, string>, code: string): string {
  if (!code) return "";
  return table[code.toUpperCase()] ?? `Unrecognized code "${code}"`;
}

/** Split raw text into non-empty record lines, tolerating CR, LF or CRLF. */
export function splitRecords(raw: string): { text: string; line: number }[] {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((text, i) => ({ text: text.trim(), line: i + 1 }))
    .filter((r) => r.text !== "");
}

/**
 * Read the delimiter set the H record declares. Field 2 holds the repeat,
 * component and escape delimiters (classically `\^&`), and the character
 * immediately after `H` is the field delimiter.
 */
export function parseDelimiters(headerLine: string): AstmDelimiters {
  const field = headerLine[1] || DEFAULT_DELIMITERS.field;
  const definition = headerLine.slice(2).split(field)[0] ?? "";
  return {
    field,
    repeat: definition[0] || DEFAULT_DELIMITERS.repeat,
    component: definition[1] || DEFAULT_DELIMITERS.component,
    escape: definition[2] || DEFAULT_DELIMITERS.escape,
  };
}

function splitLiteral(value: string, delimiter: string): string[] {
  return delimiter ? value.split(delimiter) : [value];
}

export function parseAstm(raw: string): AstmMessage {
  const lines = splitRecords(raw);
  if (lines.length === 0) throw new Error("Empty message");
  const header = lines.find((l) => l.text[0]?.toUpperCase() === "H");
  if (!header) throw new Error("ASTM message must contain an H (header) record");

  const delimiters = parseDelimiters(header.text);

  const records: AstmRecord[] = lines.map(({ text, line }) => {
    const rawFields = splitLiteral(text, delimiters.field);
    const type = (rawFields[0] || "").trim().toUpperCase();
    const fields: AstmField[] = rawFields.map((value, i) => ({
      index: i + 1,
      name: astmFieldName(type, i + 1),
      value,
      components: splitLiteral(value, delimiters.component),
      repeats: splitLiteral(value, delimiters.repeat),
    }));
    // The header's field 2 is the delimiter definition, not a sequence number.
    const rawSequence = type === "H" ? "" : rawFields[1] ?? "";
    const sequence = /^\d+$/.test(rawSequence.trim()) ? Number(rawSequence.trim()) : null;
    return { type, description: recordDescription(type), sequence, fields, raw: text, line };
  });

  const head = records.find((r) => r.type === "H");
  const headField = (index: number) => head?.fields.find((f) => f.index === index)?.components[0] ?? "";

  return {
    records,
    delimiters,
    sender: headField(5),
    receiver: headField(10),
    version: headField(13),
  };
}

/** Value of a single field, or "" when the record or field is absent. */
export function astmField(record: AstmRecord, index: number): string {
  return record.fields.find((f) => f.index === index)?.value ?? "";
}

/**
 * ASTM `YYYYMMDDHHMMSS` (any trailing part optional) to ISO 8601. Returns null
 * when the value is not a timestamp — no timezone is implied because the standard
 * does not carry one, so the result is deliberately unzoned.
 */
export function astmTimestampToIso(value: string): string | null {
  const digits = value.trim();
  if (!/^\d{8}(\d{2}(\d{2}(\d{2})?)?)?$/.test(digits)) return null;
  const [y, mo, d] = [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8)];
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const time = digits.length > 8
    ? `T${digits.slice(8, 10)}:${digits.slice(10, 12) || "00"}:${digits.slice(12, 14) || "00"}`
    : "";
  return `${y}-${mo}-${d}${time}`;
}

/**
 * The Universal Test ID field (O.5 / R.3), classically `^^^code^name`. Parts
 * beyond the code and name are manufacturer-defined, so they are kept verbatim.
 */
export interface UniversalTestId {
  code: string;
  name: string;
  raw: string;
}

export function parseTestId(value: string, delimiters: AstmDelimiters = DEFAULT_DELIMITERS): UniversalTestId {
  const parts = splitLiteral(value, delimiters.component);
  // Leading components are reserved and usually empty; the code is the first
  // populated one, which puts it at index 3 in the common `^^^code^name` layout.
  const firstPopulated = parts.findIndex((p) => p.trim() !== "");
  const code = firstPopulated === -1 ? "" : parts[firstPopulated].trim();
  const name = firstPopulated === -1 ? "" : (parts[firstPopulated + 1] ?? "").trim();
  return { code, name, raw: value };
}

/** Flatten to `RECORD[n]-field` paths for every populated field. */
export function flattenAstm(message: AstmMessage): { path: string; value: string }[] {
  const seen: Record<string, number> = {};
  const out: { path: string; value: string }[] = [];
  for (const record of message.records) {
    seen[record.type] = (seen[record.type] ?? 0) + 1;
    const occurrence = seen[record.type];
    for (const field of record.fields) {
      if (field.index === 1 || field.value === "") continue;
      out.push({ path: `${record.type}[${occurrence}]-${field.index}`, value: field.value });
    }
  }
  return out;
}

/** Normalize record separators for display (one record per line). */
export function formatAstm(raw: string): string {
  return splitRecords(raw).map((r) => r.text).join("\n");
}

/** Readable JSON view: populated fields only, with names and decoded codes. */
export function astmToJson(raw: string, indent = 2): string {
  const message = parseAstm(raw);
  const records = message.records.map((record) => ({
    record: record.type,
    description: record.description,
    sequence: record.sequence,
    fields: record.fields
      .filter((f) => f.index !== 1 && f.value !== "")
      .map((f) => ({ index: f.index, name: f.name, value: f.value })),
  }));
  return JSON.stringify({
    sender: message.sender,
    receiver: message.receiver,
    version: message.version,
    delimiters: message.delimiters,
    records,
  }, null, indent);
}

export interface AstmIssue {
  severity: "error" | "warning";
  message: string;
  /** record path such as `R[2]` or a line reference */
  location: string;
}

/**
 * Structural checks: record types, ordering, hierarchy and sequence numbering.
 * Nothing here is a conformance statement, and it says nothing about whether the
 * results themselves are clinically sensible.
 */
export function validateAstm(raw: string): AstmIssue[] {
  const issues: AstmIssue[] = [];
  const lines = splitRecords(raw);
  if (lines.length === 0) return [{ severity: "error", message: "The message is empty.", location: "" }];

  let message: AstmMessage;
  try {
    message = parseAstm(raw);
  } catch (e) {
    return [{ severity: "error", message: (e as Error).message, location: `line 1` }];
  }

  const { records } = message;
  const first = records[0];
  const last = records[records.length - 1];

  if (first.type !== "H") {
    issues.push({ severity: "error", message: "The first record must be H (header).", location: `line ${first.line}` });
  }
  if (last.type !== "L") {
    issues.push({ severity: "error", message: "The last record must be L (terminator).", location: `line ${last.line}` });
  }
  if (records.filter((r) => r.type === "H").length > 1) {
    issues.push({ severity: "error", message: "More than one H record — a message carries exactly one header.", location: "" });
  }

  // Sequence numbers restart at 1 for each parent, per record type.
  const counters: Record<string, number> = {};
  const occurrences: Record<string, number> = {};
  let sawPatient = false;
  let sawOrder = false;

  for (const record of records) {
    occurrences[record.type] = (occurrences[record.type] ?? 0) + 1;
    const at = `${record.type}[${occurrences[record.type]}]`;

    if (!RECORD_TYPES[record.type]) {
      issues.push({ severity: "error", message: `Unknown record type "${record.type || "?"}".`, location: `line ${record.line}` });
      continue;
    }

    switch (record.type) {
      case "P":
        sawPatient = true;
        sawOrder = false;
        counters.O = 0;
        counters.R = 0;
        break;
      case "O":
        if (!sawPatient) {
          issues.push({ severity: "error", message: "An O (order) record must follow a P (patient) record.", location: at });
        }
        sawOrder = true;
        counters.R = 0;
        break;
      case "R":
        if (!sawOrder) {
          issues.push({ severity: "error", message: "An R (result) record must follow an O (order) record.", location: at });
        }
        break;
      case "L": {
        const code = astmField(record, 3).trim();
        if (code && !TERMINATION_CODES[code.toUpperCase()]) {
          issues.push({ severity: "warning", message: `Unrecognized termination code "${code}" in L-3.`, location: at });
        }
        break;
      }
    }

    if (record.type !== "H" && record.type !== "L") {
      counters[record.type] = (counters[record.type] ?? 0) + 1;
      if (record.sequence === null) {
        issues.push({ severity: "error", message: `${record.type}-2 must be a numeric sequence number.`, location: at });
      } else if (record.sequence !== counters[record.type]) {
        issues.push({
          severity: "warning",
          message: `${record.type}-2 is ${record.sequence} but this is ${record.type} number ${counters[record.type]} under its parent — receivers may reject the frame.`,
          location: at,
        });
      }
    }

    if (record.type === "R") {
      const status = astmField(record, 9).trim();
      if (status && !RESULT_STATUS_CODES[status.toUpperCase()]) {
        issues.push({ severity: "warning", message: `Unrecognized result status "${status}" in R-9.`, location: at });
      }
      const flag = astmField(record, 7).trim();
      if (flag && !ABNORMAL_FLAGS[flag.toUpperCase()]) {
        issues.push({ severity: "warning", message: `Unrecognized abnormal flag "${flag}" in R-7.`, location: at });
      }
      if (astmField(record, 4).trim() === "") {
        issues.push({ severity: "warning", message: "R-4 (measurement value) is empty.", location: at });
      }
    }

    if (record.type === "O" && astmField(record, 3).trim() === "") {
      issues.push({ severity: "warning", message: "O-3 (specimen ID) is empty — most LIS systems key on it.", location: at });
    }
  }

  // Timestamps that are present but unparseable are a common integration bug.
  const timestampFields: Record<string, number[]> = { H: [14], P: [8], O: [7, 8, 15, 23], R: [12, 13] };
  for (const record of records) {
    for (const index of timestampFields[record.type] ?? []) {
      const value = astmField(record, index).trim();
      if (value && astmTimestampToIso(value) === null) {
        issues.push({
          severity: "warning",
          message: `${record.type}-${index} is not a valid ASTM timestamp (expected YYYYMMDD[HHMMSS]): "${value}".`,
          location: `line ${record.line}`,
        });
      }
    }
  }

  return issues;
}
