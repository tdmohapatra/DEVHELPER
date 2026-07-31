/**
 * Advanced HL7 v2 handling: escapes, repetitions, addressing, acknowledgements,
 * structure validation, MLLP framing and a v2 → FHIR mapping.
 *
 * Developer/integration utility only — NOT clinical software. All processing is local.
 *
 * The basic parser in `hl7.ts` splits a message into segments and fields. Real interface
 * work needs more: a field can repeat, components nest into subcomponents, and text is
 * escape-encoded, so `PID-5.1` is not simply "the text between the pipes".
 */

import { parseHl7, type Hl7Message } from "./hl7";

// ---- Escape sequences ------------------------------------------------------

/**
 * Decode HL7 escape sequences to plain text.
 *
 * A field containing a literal `|` or `^` must be escaped on the wire, so `\F\` and `\S\`
 * appear in real messages and would otherwise be shown to the user verbatim.
 */
export function decodeHl7Escapes(value: string, encodingChars = "^~\\&"): string {
  const [comp = "^", rep = "~", esc = "\\", sub = "&"] = encodingChars.split("");
  return value.replace(/\\([^\\]*)\\/g, (match, code: string) => {
    switch (code.toUpperCase()) {
      case "F":
        return "|";
      case "S":
        return comp;
      case "T":
        return sub;
      case "R":
        return rep;
      case "E":
        return esc;
      case "": // `\\` is an escaped escape character
        return esc;
      default:
        // \Xdd..\ is hex-encoded data; \.br\ is a line break in formatted text.
        if (/^X[0-9A-F]+$/i.test(code)) {
          const bytes = code.slice(1).match(/../g) ?? [];
          return bytes.map((b) => String.fromCharCode(parseInt(b, 16))).join("");
        }
        if (code.toLowerCase() === ".br") return "\n";
        return match;
    }
  });
}

/** Escape plain text so it can be placed in a field without breaking the message. */
export function encodeHl7Escapes(value: string, encodingChars = "^~\\&"): string {
  const [comp = "^", rep = "~", esc = "\\", sub = "&"] = encodingChars.split("");
  let out = "";
  for (const ch of value) {
    if (ch === esc) out += `${esc}E${esc}`;
    else if (ch === "|") out += `${esc}F${esc}`;
    else if (ch === comp) out += `${esc}S${esc}`;
    else if (ch === rep) out += `${esc}R${esc}`;
    else if (ch === sub) out += `${esc}T${esc}`;
    else if (ch === "\n" || ch === "\r") out += `${esc}.br${esc}`;
    else out += ch;
  }
  return out;
}

// ---- Addressing ------------------------------------------------------------

export interface Hl7Path {
  segment: string;
  /** 1-based occurrence of a repeating segment, e.g. the second OBX. */
  segmentRepeat: number;
  field: number;
  /** 1-based repetition within the field (`~` separated). */
  fieldRepeat: number;
  component?: number;
  subcomponent?: number;
}

export class Hl7PathError extends Error {}

/**
 * Parse an addressing expression.
 *
 * Supported: `PID-5`, `PID-5.1`, `PID-5.1.2`, `OBX[2]-5` for the second OBX segment, and
 * `PID-3(2)` for the second repetition of a field.
 */
export function parseHl7Path(expr: string): Hl7Path {
  const m = /^([A-Z0-9]{3})(?:\[(\d+)\])?-(\d+)(?:\((\d+)\))?(?:\.(\d+))?(?:\.(\d+))?$/i.exec(expr.trim());
  if (!m) throw new Hl7PathError(`Not an HL7 path: ${expr} — expected something like PID-5.1 or OBX[2]-5`);
  return {
    segment: m[1].toUpperCase(),
    segmentRepeat: m[2] ? Number(m[2]) : 1,
    field: Number(m[3]),
    fieldRepeat: m[4] ? Number(m[4]) : 1,
    component: m[5] ? Number(m[5]) : undefined,
    subcomponent: m[6] ? Number(m[6]) : undefined,
  };
}

/**
 * Read a value by path. Returns `undefined` when the location is absent, which is
 * different from an empty field — integration bugs usually turn on that distinction.
 */
export function getHl7Value(message: Hl7Message, expr: string): string | undefined {
  const path = parseHl7Path(expr);
  const [comp = "^", rep = "~", , sub = "&"] = message.encodingChars.split("");

  const matching = message.segments.filter((s) => s.name === path.segment);
  const segment = matching[path.segmentRepeat - 1];
  if (!segment) return undefined;

  const field = segment.fields.find((f) => f.index === path.field);
  if (!field) return undefined;

  const repetition = field.value.split(rep)[path.fieldRepeat - 1];
  if (repetition === undefined) return undefined;
  if (path.component === undefined) return decodeHl7Escapes(repetition, message.encodingChars);

  const component = repetition.split(comp)[path.component - 1];
  if (component === undefined) return undefined;
  if (path.subcomponent === undefined) return decodeHl7Escapes(component, message.encodingChars);

  const subcomponent = component.split(sub)[path.subcomponent - 1];
  return subcomponent === undefined ? undefined : decodeHl7Escapes(subcomponent, message.encodingChars);
}

/** Every populated location in the message, as `path → value` pairs. */
export function flattenHl7(message: Hl7Message): { path: string; value: string }[] {
  const [comp = "^", rep = "~"] = message.encodingChars.split("");
  const out: { path: string; value: string }[] = [];
  const seen: Record<string, number> = {};

  for (const segment of message.segments) {
    seen[segment.name] = (seen[segment.name] ?? 0) + 1;
    const occurrence = seen[segment.name];
    const prefix = `${segment.name}${occurrence > 1 ? `[${occurrence}]` : ""}`;

    for (const field of segment.fields) {
      if (!field.value) continue;
      const repetitions = field.value.split(rep);
      repetitions.forEach((repetition, ri) => {
        if (!repetition) return;
        const fieldPath = `${prefix}-${field.index}${repetitions.length > 1 ? `(${ri + 1})` : ""}`;
        const components = repetition.split(comp);
        if (components.length === 1) {
          out.push({ path: fieldPath, value: decodeHl7Escapes(repetition, message.encodingChars) });
          return;
        }
        components.forEach((component, ci) => {
          if (component) out.push({ path: `${fieldPath}.${ci + 1}`, value: decodeHl7Escapes(component, message.encodingChars) });
        });
      });
    }
  }
  return out;
}

// ---- Timestamps ------------------------------------------------------------

/**
 * Convert an HL7 DTM (`YYYYMMDDHHMMSS[.S+][+/-ZZZZ]`) to ISO 8601.
 * Returns null when the value is not a timestamp.
 */
export function hl7TimestampToIso(value: string): string | null {
  const m = /^(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:\.\d+)?([+-]\d{4})?$/.exec(value.trim());
  if (!m) return null;
  const [, year, month = "01", day = "01", hour, minute = "00", second = "00", offset] = m;
  if (!hour) return `${year}-${month}-${day}`;
  const zone = offset ? `${offset.slice(0, 3)}:${offset.slice(3)}` : "Z";
  return `${year}-${month}-${day}T${hour}:${minute}:${second}${zone}`;
}

// ---- Acknowledgements ------------------------------------------------------

export type AckCode = "AA" | "AE" | "AR";

export const ACK_CODES: { code: AckCode; label: string }[] = [
  { code: "AA", label: "Application Accept" },
  { code: "AE", label: "Application Error" },
  { code: "AR", label: "Application Reject" },
];

/**
 * Build the ACK an interface engine would return for a message.
 *
 * Sender and receiver are swapped, the control id is echoed in MSA-2, and the timestamp
 * is supplied by the caller so the result is reproducible in tests.
 */
export function buildAck(raw: string, code: AckCode = "AA", text = "", now = new Date()): string {
  const message = parseHl7(raw);
  const msh = message.segments[0];
  const sep = message.fieldSep;
  const field = (n: number) => msh.fields.find((f) => f.index === n)?.value ?? "";

  const pad = (v: number, w = 2) => String(v).padStart(w, "0");
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

  const controlId = field(10);
  const version = field(12) || "2.5";
  const trigger = field(9).split(/[\^~]/)[1] ?? "";

  const ackMsh = [
    "MSH",
    message.encodingChars,
    field(5) || "RECEIVER", // sending application  = original receiving application
    field(6) || "RECEIVER",
    field(3) || "SENDER",
    field(4) || "SENDER",
    stamp,
    "",
    trigger ? `ACK${message.encodingChars[0]}${trigger}` : "ACK",
    `ACK${controlId}`,
    field(11) || "P",
    version,
  ].join(sep);

  const msa = ["MSA", code, controlId, encodeHl7Escapes(text, message.encodingChars)].join(sep);
  return `${ackMsh}\r${msa}`;
}

// ---- Structure validation --------------------------------------------------

/** Segments each message type must carry. Kept deliberately small and well known. */
const REQUIRED_SEGMENTS: Record<string, string[]> = {
  ADT: ["MSH", "EVN", "PID"],
  ORU: ["MSH", "PID", "OBR", "OBX"],
  ORM: ["MSH", "PID", "ORC"],
  SIU: ["MSH", "SCH"],
  ACK: ["MSH", "MSA"],
  MDM: ["MSH", "EVN", "PID", "TXA"],
  DFT: ["MSH", "EVN", "PID", "FT1"],
};

export interface StructureIssue {
  severity: "error" | "warning";
  message: string;
  /** Path or segment the issue concerns, when known. */
  location?: string;
}

/**
 * Check a message against the rules that catch real integration mistakes: missing
 * mandatory segments, empty control id, unparsable timestamps, unknown version.
 */
export function validateHl7Structure(raw: string): StructureIssue[] {
  const issues: StructureIssue[] = [];
  let message: Hl7Message;
  try {
    message = parseHl7(raw);
  } catch (e) {
    return [{ severity: "error", message: (e as Error).message }];
  }

  const root = message.messageType.split(/[\^~]/)[0];
  const required = REQUIRED_SEGMENTS[root];
  const present = new Set(message.segments.map((s) => s.name));

  if (!root) {
    issues.push({ severity: "error", message: "MSH-9 (message type) is empty", location: "MSH-9" });
  } else if (!required) {
    issues.push({ severity: "warning", message: `No structure rules known for message type ${root}`, location: "MSH-9" });
  } else {
    for (const segment of required) {
      if (!present.has(segment)) {
        issues.push({ severity: "error", message: `Message type ${root} requires a ${segment} segment`, location: segment });
      }
    }
  }

  if (!getHl7Value(message, "MSH-10")) {
    issues.push({ severity: "error", message: "MSH-10 (message control id) is empty — acknowledgements cannot be correlated", location: "MSH-10" });
  }

  const version = getHl7Value(message, "MSH-12");
  if (!version) {
    issues.push({ severity: "warning", message: "MSH-12 (version id) is empty", location: "MSH-12" });
  } else if (!/^2\.[1-8]/.test(version)) {
    issues.push({ severity: "warning", message: `Unusual HL7 version "${version}"`, location: "MSH-12" });
  }

  const sent = getHl7Value(message, "MSH-7");
  if (sent && !hl7TimestampToIso(sent)) {
    issues.push({ severity: "error", message: `MSH-7 is not a valid timestamp: "${sent}"`, location: "MSH-7" });
  }

  const birth = getHl7Value(message, "PID-7");
  if (birth && !hl7TimestampToIso(birth)) {
    issues.push({ severity: "error", message: `PID-7 (date of birth) is not a valid timestamp: "${birth}"`, location: "PID-7" });
  }

  // An OBX carrying a numeric value should say so in OBX-2.
  message.segments
    .filter((s) => s.name === "OBX")
    .forEach((segment, i) => {
      const type = segment.fields.find((f) => f.index === 2)?.value;
      const value = segment.fields.find((f) => f.index === 5)?.value;
      if (type === "NM" && value && Number.isNaN(Number(value.split("^")[0]))) {
        issues.push({
          severity: "error",
          message: `OBX-5 is "${value}" but OBX-2 declares a numeric value`,
          location: `OBX[${i + 1}]-5`,
        });
      }
    });

  return issues;
}

// ---- MLLP framing ----------------------------------------------------------

/** Minimal Lower Layer Protocol wrapper bytes. */
export const MLLP_START = "\x0b";
export const MLLP_END = "\x1c\r";

/** Frame a message for transmission over MLLP, as interface engines expect. */
export function mllpWrap(raw: string): string {
  const normalized = raw.replace(/\r\n|\n/g, "\r").replace(/\r+$/, "");
  return `${MLLP_START}${normalized}${MLLP_END}`;
}

/** Strip MLLP framing. Returns the message unchanged when it is not framed. */
export function mllpUnwrap(framed: string): string {
  let out = framed;
  if (out.startsWith(MLLP_START)) out = out.slice(1);
  if (out.endsWith(MLLP_END)) out = out.slice(0, -MLLP_END.length);
  else if (out.endsWith("\x1c")) out = out.slice(0, -1);
  return out;
}

/** Show framing characters so an invisible byte problem becomes visible. */
export function describeFraming(framed: string): string {
  return framed.replace(/\x0b/g, "<VT>").replace(/\x1c/g, "<FS>").replace(/\r/g, "<CR>\n");
}

// ---- HL7 v2 → FHIR ---------------------------------------------------------

/**
 * Map a v2 message onto a FHIR R4 transaction Bundle.
 *
 * Covers the fields that carry across cleanly: PID → Patient, PV1 → Encounter,
 * OBX → Observation. Anything else is left out rather than guessed at — a wrong mapping
 * is worse than an absent one.
 */
export function hl7ToFhirBundle(raw: string): string {
  const message = parseHl7(raw);
  const entries: Record<string, unknown>[] = [];

  const get = (path: string) => getHl7Value(message, path) ?? "";
  const patientId = get("PID-3.1") || get("PID-2.1") || "patient-1";

  const family = get("PID-5.1");
  const given = [get("PID-5.2"), get("PID-5.3")].filter(Boolean);
  const genderCode = get("PID-8").toUpperCase();
  const gender = { M: "male", F: "female", O: "other", U: "unknown" }[genderCode];

  const patient: Record<string, unknown> = {
    resourceType: "Patient",
    id: patientId,
    identifier: [{ value: patientId }],
    ...(family || given.length ? { name: [{ family: family || undefined, given: given.length ? given : undefined }] } : {}),
    ...(gender ? { gender } : {}),
    ...(hl7TimestampToIso(get("PID-7")) ? { birthDate: hl7TimestampToIso(get("PID-7")) } : {}),
  };
  entries.push({ fullUrl: `urn:uuid:patient-${patientId}`, resource: patient, request: { method: "PUT", url: `Patient/${patientId}` } });

  const visitClass = get("PV1-2");
  if (visitClass) {
    entries.push({
      fullUrl: `urn:uuid:encounter-${patientId}`,
      resource: {
        resourceType: "Encounter",
        status: "in-progress",
        class: { code: visitClass },
        subject: { reference: `Patient/${patientId}` },
        ...(hl7TimestampToIso(get("PV1-44")) ? { period: { start: hl7TimestampToIso(get("PV1-44")) } } : {}),
      },
      request: { method: "POST", url: "Encounter" },
    });
  }

  message.segments
    .filter((s) => s.name === "OBX")
    .forEach((_segment, i) => {
      const n = i + 1;
      const code = getHl7Value(message, `OBX[${n}]-3.1`) ?? "";
      const display = getHl7Value(message, `OBX[${n}]-3.2`) ?? "";
      const system = getHl7Value(message, `OBX[${n}]-3.3`) ?? "";
      const type = getHl7Value(message, `OBX[${n}]-2`) ?? "";
      const value = getHl7Value(message, `OBX[${n}]-5`) ?? "";
      const unit = getHl7Value(message, `OBX[${n}]-6.1`) ?? "";
      if (!code && !value) return;

      const observation: Record<string, unknown> = {
        resourceType: "Observation",
        status: (getHl7Value(message, `OBX[${n}]-11`) ?? "F") === "F" ? "final" : "preliminary",
        code: {
          coding: [{ code, ...(display ? { display } : {}), ...(system ? { system: fhirSystemFor(system) } : {}) }],
          ...(display ? { text: display } : {}),
        },
        subject: { reference: `Patient/${patientId}` },
        ...(type === "NM" && !Number.isNaN(Number(value))
          ? { valueQuantity: { value: Number(value), ...(unit ? { unit } : {}) } }
          : { valueString: value }),
      };
      entries.push({ fullUrl: `urn:uuid:observation-${n}`, resource: observation, request: { method: "POST", url: "Observation" } });
    });

  return JSON.stringify({ resourceType: "Bundle", type: "transaction", entry: entries }, null, 2);
}

/** Map an HL7 coding system abbreviation to its FHIR system URI. */
export function fhirSystemFor(code: string): string {
  const map: Record<string, string> = {
    LN: "http://loinc.org",
    LOINC: "http://loinc.org",
    SCT: "http://snomed.info/sct",
    SNM: "http://snomed.info/sct",
    "I10": "http://hl7.org/fhir/sid/icd-10",
    ICD10: "http://hl7.org/fhir/sid/icd-10",
    CPT: "http://www.ama-assn.org/go/cpt",
  };
  return map[code.toUpperCase()] ?? code;
}

// ---- Message comparison ----------------------------------------------------

export interface Hl7Difference {
  path: string;
  left?: string;
  right?: string;
  kind: "added" | "removed" | "changed";
}

/** Compare two messages field by field — what changed between two captures. */
export function diffHl7(leftRaw: string, rightRaw: string): Hl7Difference[] {
  const left = new Map(flattenHl7(parseHl7(leftRaw)).map((e) => [e.path, e.value]));
  const right = new Map(flattenHl7(parseHl7(rightRaw)).map((e) => [e.path, e.value]));
  const paths = [...new Set([...left.keys(), ...right.keys()])];

  const out: Hl7Difference[] = [];
  for (const path of paths) {
    const l = left.get(path);
    const r = right.get(path);
    if (l === r) continue;
    if (l === undefined) out.push({ path, right: r, kind: "added" });
    else if (r === undefined) out.push({ path, left: l, kind: "removed" });
    else out.push({ path, left: l, right: r, kind: "changed" });
  }
  return out;
}
