/**
 * HL7 v2.x parsing helpers. Developer/integration utility only — NOT clinical software.
 * All processing is local.
 */

export interface Hl7Field {
  index: number; // 1-based within the segment
  name: string;
  value: string;
  components: string[];
}

export interface Hl7Segment {
  name: string;
  description: string;
  fields: Hl7Field[];
  raw: string;
}

export interface Hl7Message {
  segments: Hl7Segment[];
  messageType: string;
  fieldSep: string;
  encodingChars: string;
}

// Common segment descriptions.
const SEGMENTS: Record<string, string> = {
  MSH: "Message Header",
  PID: "Patient Identification",
  PV1: "Patient Visit",
  EVN: "Event Type",
  NK1: "Next of Kin",
  OBR: "Observation Request",
  OBX: "Observation/Result",
  ORC: "Common Order",
  AL1: "Allergy Information",
  DG1: "Diagnosis",
  MSA: "Message Acknowledgment",
  ERR: "Error",
  IN1: "Insurance",
  GT1: "Guarantor",
  SCH: "Schedule Activity",
};

// Field names for the most common segments (1-based index → label).
const FIELD_NAMES: Record<string, Record<number, string>> = {
  MSH: { 1: "Field Separator", 2: "Encoding Characters", 3: "Sending Application", 4: "Sending Facility", 5: "Receiving Application", 6: "Receiving Facility", 7: "Date/Time", 9: "Message Type", 10: "Message Control ID", 11: "Processing ID", 12: "Version ID" },
  PID: { 1: "Set ID", 2: "Patient ID", 3: "Patient Identifier List", 5: "Patient Name", 7: "Date/Time of Birth", 8: "Sex", 11: "Patient Address", 13: "Phone (Home)", 18: "Account Number", 19: "SSN" },
  PV1: { 2: "Patient Class", 3: "Assigned Location", 7: "Attending Doctor", 44: "Admit Date/Time" },
  OBX: { 2: "Value Type", 3: "Observation Identifier", 5: "Observation Value", 6: "Units", 8: "Abnormal Flags", 11: "Result Status" },
  MSA: { 1: "Acknowledgment Code", 2: "Message Control ID", 3: "Text Message" },
};

export function fieldName(segment: string, index: number): string {
  return FIELD_NAMES[segment]?.[index] ?? `Field ${index}`;
}

/** Split a raw HL7 message into normalized segment lines. */
function splitSegments(raw: string): string[] {
  return raw
    .replace(/\r\n/g, "\r")
    .replace(/\n/g, "\r")
    .split("\r")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseHl7(raw: string): Hl7Message {
  const lines = splitSegments(raw);
  if (lines.length === 0) throw new Error("Empty message");
  const first = lines[0];
  if (!first.startsWith("MSH")) throw new Error("HL7 message must start with an MSH segment");

  const fieldSep = first[3] || "|";
  const encodingChars = first.slice(4, 8); // ^~\&
  const compSep = encodingChars[0] || "^";

  const segments: Hl7Segment[] = lines.map((line) => {
    const name = line.slice(0, 3);
    let rawFields: string[];
    if (name === "MSH") {
      // MSH-1 is the field separator, MSH-2 the encoding chars; the rest split normally.
      const rest = line.slice(4).split(fieldSep);
      rawFields = [fieldSep, encodingChars, ...rest.slice(1)];
    } else {
      rawFields = line.split(fieldSep).slice(1);
    }
    const fields: Hl7Field[] = rawFields.map((value, i) => ({
      index: i + 1,
      name: fieldName(name, i + 1),
      value,
      components: value.split(compSep),
    }));
    return { name, description: SEGMENTS[name] ?? "Segment", fields, raw: line };
  });

  // MSH-9 holds the message type (e.g. ADT^A01).
  const msh = segments[0];
  const messageType = msh.fields.find((f) => f.index === 9)?.value ?? "";

  return { segments, messageType, fieldSep, encodingChars };
}

/** Normalize line endings and trim (segments joined by \n for display). */
export function formatHl7(raw: string): string {
  return splitSegments(raw).join("\n");
}

/** Convert HL7 to a readable JSON structure. */
export function hl7ToJson(raw: string, indent = 2): string {
  const msg = parseHl7(raw);
  const out = msg.segments.map((seg) => ({
    segment: seg.name,
    description: seg.description,
    fields: seg.fields
      .filter((f) => f.value !== "")
      .map((f) => ({ index: f.index, name: f.name, value: f.value })),
  }));
  return JSON.stringify({ messageType: msg.messageType, segments: out }, null, indent);
}

export interface Hl7Validation {
  valid: boolean;
  errors: string[];
}

export function validateHl7(raw: string): Hl7Validation {
  const errors: string[] = [];
  try {
    const lines = splitSegments(raw);
    if (lines.length === 0) return { valid: false, errors: ["Empty message"] };
    if (!lines[0].startsWith("MSH")) errors.push("First segment must be MSH");
    if (lines[0].length < 8) errors.push("MSH segment is too short (missing encoding characters)");
    lines.forEach((l, i) => {
      if (!/^[A-Z0-9]{3}/.test(l)) errors.push(`Segment ${i + 1} has an invalid 3-character name`);
    });
  } catch (e) {
    errors.push((e as Error).message);
  }
  return { valid: errors.length === 0, errors };
}

/** Human-readable message type such as "ADT^A01 (Admit/Visit Notification)". */
const MSG_TYPES: Record<string, string> = {
  ADT: "Admit, Discharge, Transfer",
  ORU: "Observation Result",
  ORM: "Order Message",
  ACK: "Acknowledgment",
  SIU: "Scheduling",
  MDM: "Medical Document",
  DFT: "Detailed Financial Transaction",
};
export function describeMessageType(messageType: string): string {
  const root = messageType.split(/[\^~]/)[0];
  return MSG_TYPES[root] ?? "Unknown";
}
