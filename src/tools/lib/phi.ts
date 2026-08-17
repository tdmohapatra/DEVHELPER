/**
 * Keeping PHI out of a prompt before it leaves the machine.
 *
 * DevHelper's AI tools are useful on the thing you are actually debugging, and
 * the thing you are actually debugging in this domain is a patient record. That
 * is the whole problem: pasting the HL7 message that failed into an error
 * explainer is the natural move, and it is also a disclosure. This module sits
 * between the two so the natural move stays available.
 *
 * Three ideas run through it.
 *
 * **Structure beats regex.** A regex guesses that `19750214` is a birth date. An
 * HL7 parser *knows* that PID-7 is one, because the standard says so. So a
 * payload that is recognisably HL7 v2, FHIR JSON or a DICOM tag dump is redacted
 * by field position first, and free-text regex only mops up what is left. The
 * field-based pass is the one that catches a surname, which no regex can.
 *
 * **Redaction must be reversible, locally.** An answer that says "the ADT for
 * [MRN_1] failed" is useless if you cannot get back to which patient that was.
 * Every replacement is a stable token with the original kept in a map that never
 * leaves this process, and the model's reply is re-identified on the way back.
 *
 * **The last check is on the redacted text, not the original.** Detection is
 * best-effort and always will be; what makes that safe to rely on is scanning
 * again *after* redacting and refusing to send if anything identifying is still
 * there. A miss becomes a blocked send rather than a disclosure.
 *
 * None of this is a compliance product. It is a seatbelt: it makes the common
 * accident survivable, and it is not a substitute for a BAA, a de-identification
 * review, or not pasting the record in the first place.
 */

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

/**
 * The Safe Harbor identifier categories that can appear in text a developer
 * pastes. The rule lists eighteen; the ones omitted here (full-face photos,
 * biometric templates) are not text, and their absence is not a claim that they
 * are safe.
 */
export type PhiKind =
  | "name"
  | "mrn"
  | "ssn"
  | "account"
  | "insurance"
  | "licence"
  | "device"
  | "vehicle"
  | "birthDate"
  | "date"
  | "age90"
  | "phone"
  | "fax"
  | "email"
  | "address"
  | "postcode"
  | "url"
  | "ip"
  | "aadhaar"
  | "pan"
  | "otherId";

export const KIND_LABEL: Record<PhiKind, string> = {
  name: "Name",
  mrn: "MRN",
  ssn: "SSN",
  account: "Account number",
  insurance: "Health plan id",
  licence: "Licence number",
  device: "Device identifier",
  vehicle: "Vehicle identifier",
  birthDate: "Date of birth",
  date: "Date",
  age90: "Age over 89",
  phone: "Phone",
  fax: "Fax",
  email: "Email",
  address: "Address",
  postcode: "Postcode",
  url: "URL",
  ip: "IP address",
  aadhaar: "Aadhaar",
  pan: "PAN",
  otherId: "Identifier",
};

export interface PhiFinding {
  kind: PhiKind;
  value: string;
  start: number;
  end: number;
  /** Why this span was flagged — the field that named it, or the pattern that matched. */
  reason: string;
  /** Field-derived findings are certain; pattern-derived ones are guesses. */
  certain: boolean;
}

// ---------------------------------------------------------------------------
// Free-text patterns
// ---------------------------------------------------------------------------

interface Pattern {
  kind: PhiKind;
  regex: RegExp;
  reason: string;
  /** Which capture group is the identifier, when the match includes a label. */
  group?: number;
}

/**
 * Order matters: the first pattern to claim a span keeps it, so the specific
 * ones come before the greedy ones. `phone` last, because a run of digits
 * matches it and almost everything else too.
 */
const PATTERNS: Pattern[] = [
  { kind: "email", regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, reason: "email address" },
  { kind: "url", regex: /\bhttps?:\/\/[^\s"'<>)]+/g, reason: "URL — the path often carries the record id" },
  { kind: "ssn", regex: /\b\d{3}-\d{2}-\d{4}\b/g, reason: "US social security number" },
  { kind: "aadhaar", regex: /\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b/g, reason: "Aadhaar number (12 digits, never starts 0 or 1)" },
  { kind: "pan", regex: /\b[A-Z]{5}\d{4}[A-Z]\b/g, reason: "Indian PAN" },
  { kind: "mrn", regex: /\b(?:MRN|UHID|HospitalNo|PatientID|Patient\sId)[:\s#=-]*([A-Za-z0-9][A-Za-z0-9-]{3,})/gi, reason: "labelled medical record number", group: 1 },
  { kind: "account", regex: /\b(?:acct|account|invoice|bill)(?:\s?(?:no|number|#))?[:\s#=-]+([A-Za-z0-9-]{4,})/gi, reason: "labelled account number", group: 1 },
  { kind: "insurance", regex: /\b(?:policy|member|subscriber|insurance)(?:\s?(?:no|number|id|#))?[:\s#=-]+([A-Za-z0-9-]{4,})/gi, reason: "labelled health plan identifier", group: 1 },
  { kind: "licence", regex: /\b(?:licen[cs]e|npi|dea)(?:\s?(?:no|number|#))?[:\s#=-]+([A-Za-z0-9-]{4,})/gi, reason: "labelled licence number", group: 1 },
  { kind: "device", regex: /\b(?:serial|device\s?id|instrument)(?:\s?(?:no|number|#))?[:\s#=-]+([A-Za-z0-9-]{4,})/gi, reason: "labelled device identifier", group: 1 },
  { kind: "vehicle", regex: /\b[A-HJ-NPR-Z0-9]{17}\b/g, reason: "17-character vehicle identification number" },
  { kind: "age90", regex: /\b(9\d|1\d{2})\s?(?:years?\s?old|y\/o|yo|yrs)\b/gi, reason: "age over 89 — Safe Harbor requires these be aggregated" },
  { kind: "birthDate", regex: /\b(?:dob|date\sof\sbirth|birth\s?date)[:\s=]*([0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{2,4}|[0-9]{8})/gi, reason: "labelled date of birth", group: 1 },
  { kind: "date", regex: /\b(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/g, reason: "a date — Safe Harbor keeps only the year" },
  { kind: "postcode", regex: /\b(?:zip|postcode|pin\s?code)[:\s=]*([A-Za-z0-9][A-Za-z0-9\s-]{2,9})/gi, reason: "labelled postcode — Safe Harbor allows only the first three digits", group: 1 },
  { kind: "ip", regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, reason: "IP address" },
  { kind: "fax", regex: /\bfax[:\s=]*(\+?[\d\s().-]{7,})/gi, reason: "labelled fax number", group: 1 },
  // Indian mobiles are ten digits starting 6-9, usually written as 5 + 5. The
  // North-American 3-3-4 pattern below does not match them at all.
  { kind: "phone", regex: /(?<![\d-])(?:\+?91[-.\s]?)?[6-9]\d{4}[-.\s]?\d{5}(?![\d-])/g, reason: "Indian mobile number" },
  /*
   * Both ends are guarded against a longer run of digits. Without that, this
   * pattern happily takes thirteen digits out of the middle of an HL7 timestamp
   * — `20260817103000` becomes a phone number, and every offset after it moves.
   */
  { kind: "phone", regex: /(?<![\d-])(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}(?![\d-])/g, reason: "telephone number" },
];

/** Free-text detection. Every finding here is a guess, so none are `certain`. */
export function detectInText(text: string, offset = 0): PhiFinding[] {
  const found: PhiFinding[] = [];
  for (const p of PATTERNS) {
    p.regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = p.regex.exec(text)) !== null) {
      // A zero-length match would loop forever; the patterns cannot produce one,
      // but a future edit could.
      if (m[0].length === 0) {
        p.regex.lastIndex++;
        continue;
      }
      const value = p.group !== undefined ? m[p.group] : m[0];
      if (!value) continue;
      const start = m.index + m[0].indexOf(value);
      const end = start + value.length;
      if (found.some((f) => start + offset < f.end && end + offset > f.start)) continue;
      found.push({ kind: p.kind, value, start: start + offset, end: end + offset, reason: p.reason, certain: false });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------------------
// Structure: HL7 v2
// ---------------------------------------------------------------------------

/**
 * Does this look like HL7 v2?
 *
 * MSH is mandatory in a real message, but a real message is rarely what gets
 * pasted. What gets pasted is a log line carrying the one segment that failed —
 * and a logger puts its own timestamp and level in front of it, so the segment
 * is neither first in the text nor first on its line:
 *
 *     2026-08-17 10:30:00 ERROR parse failed: PID|1||100234^^^HOSP^MR||SHARMA…
 *
 * Requiring MSH, or requiring the line to start with the segment, drops that
 * case to the regex pass — where nothing recognises a surname. So a known
 * segment name preceded by whitespace or a line start counts, provided the line
 * has enough field separators to be a segment rather than prose.
 */
const SEGMENT_NAMES = "MSH|PID|PV1|PV2|OBR|OBX|ORC|NTE|NK1|IN1|IN2|GT1|DG1|AL1|SPM|EVN|MSA|ERR|QRD|ZDS";
const SEGMENT_AT = new RegExp(`(?:^|\\s)(${SEGMENT_NAMES})\\|`);
/** Below this many separators a line is prose that happens to contain a bar. */
const MIN_FIELDS = 3;

export function looksLikeHl7(text: string): boolean {
  return text.split(/\r\n|\r|\n/).some((line) => SEGMENT_AT.test(line) && (line.match(/\|/g)?.length ?? 0) >= MIN_FIELDS);
}

/**
 * The fields of each segment that carry an identifier, by 1-based position.
 *
 * Taken from the v2 standard rather than guessed: PID-5 is the patient name
 * whatever it contains, so a surname is redacted without any need to recognise
 * it as one. PID-3 is the identifier list, which is where the MRN actually
 * lives — the `MRN:` prefix a regex looks for does not appear in a real message.
 */
const HL7_FIELDS: Record<string, Partial<Record<number, PhiKind>>> = {
  PID: {
    // PID-12 is a county code, not a postcode — the postcode is a component of
    // the PID-11 address, which is redacted whole.
    2: "mrn", 3: "mrn", 4: "mrn", 5: "name", 6: "name", 7: "birthDate", 9: "name",
    11: "address", 13: "phone", 14: "phone", 19: "ssn", 20: "licence", 21: "otherId",
  },
  NK1: { 2: "name", 4: "address", 5: "phone", 6: "phone", 12: "otherId", 13: "otherId", 26: "name", 30: "name", 32: "address", 33: "phone", 37: "otherId" },
  GT1: { 2: "account", 3: "name", 5: "address", 6: "phone", 7: "phone", 8: "birthDate", 12: "ssn", 19: "account" },
  IN1: { 4: "name", 5: "address", 6: "name", 7: "phone", 8: "insurance", 16: "name", 18: "birthDate", 19: "address", 36: "insurance", 49: "otherId" },
  IN2: { 1: "insurance", 2: "ssn", 3: "name", 6: "otherId", 61: "phone", 63: "phone" },
  PV1: { 19: "account", 50: "otherId" },
  /*
   * OBX and DG1 are deliberately absent.
   *
   * OBX-5 is the observation value — the haemoglobin, the flag, the reason the
   * message exists and the reason anyone is asking an AI about it. Claiming the
   * field whole would redact the entire clinical payload and leave a prompt that
   * says nothing. OBX-5 can still contain a name in a narrative comment, and it
   * gets that protection from the free-text pass, which runs over everything the
   * field map did not claim.
   */
};

interface Segment {
  name: string;
  fields: { value: string; start: number; end: number; position: number }[];
}

/**
 * Split a message into segments and fields with their absolute offsets.
 *
 * MSH is the awkward one: its field separator is itself field 1, so what reads
 * as the second field is MSH-2. Everything else counts from the segment name.
 */
function parseHl7(text: string): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;
  for (const line of text.split(/(\r\n|\r|\n)/)) {
    if (/^(\r\n|\r|\n)$/.test(line)) {
      cursor += line.length;
      continue;
    }
    // The segment may sit behind a log prefix, so find where it actually starts.
    const at0 = SEGMENT_AT.exec(line);
    if (at0) {
      const nameStart = at0.index + at0[0].length - at0[1].length - 1;
      const name = at0[1];
      const fields: Segment["fields"] = [];
      let at = cursor + nameStart + 3;
      const parts = line.slice(nameStart + 3).split("|");
      // parts[0] is the empty string before the first separator.
      for (let i = 1; i < parts.length; i++) {
        const start = at + 1;
        const value = parts[i];
        fields.push({ value, start, end: start + value.length, position: name === "MSH" ? i + 1 : i });
        at = start + value.length;
      }
      segments.push({ name, fields });
    }
    cursor += line.length;
  }
  return segments;
}

/** Findings from HL7 field positions. These are `certain` — the standard named them. */
export function detectInHl7(text: string): PhiFinding[] {
  const found: PhiFinding[] = [];
  for (const segment of parseHl7(text)) {
    const map = HL7_FIELDS[segment.name];
    if (!map) continue;
    for (const field of segment.fields) {
      const kind = map[field.position];
      if (!kind || !field.value.trim()) continue;
      found.push({
        kind,
        value: field.value,
        start: field.start,
        end: field.end,
        reason: `${segment.name}-${field.position} is ${KIND_LABEL[kind].toLowerCase()} in the HL7 v2 standard`,
        certain: true,
      });
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Structure: FHIR / JSON
// ---------------------------------------------------------------------------

/** Property names that hold an identifier wherever they appear in a FHIR resource. */
const FHIR_KEYS: Record<string, PhiKind> = {
  name: "name",
  given: "name",
  family: "name",
  prefix: "name",
  suffix: "name",
  birthdate: "birthDate",
  deceaseddatetime: "date",
  telecom: "phone",
  address: "address",
  line: "address",
  city: "address",
  postalcode: "postcode",
  identifier: "otherId",
  mrn: "mrn",
  ssn: "ssn",
  patientid: "mrn",
  subscriberid: "insurance",
  photo: "otherId",
  contact: "name",
  accessionnumber: "otherId",
};

/** Does this look like a FHIR resource? `resourceType` is mandatory on every one. */
export function looksLikeFhir(text: string): boolean {
  return /"resourceType"\s*:\s*"[A-Z]/.test(text);
}

/**
 * Findings from JSON property names.
 *
 * Walks the raw text rather than the parsed object, because the offsets have to
 * point back into what the user pasted — and because a payload that fails to
 * parse (a truncated log line) is exactly the one someone wants explained.
 */
export function detectInJson(text: string): PhiFinding[] {
  const found: PhiFinding[] = [];
  const keyRe = /"([A-Za-z_][A-Za-z0-9_]*)"\s*:\s*/g;
  let m: RegExpExecArray | null;
  while ((m = keyRe.exec(text)) !== null) {
    const kind = FHIR_KEYS[m[1].toLowerCase()];
    if (!kind) continue;
    const valueStart = m.index + m[0].length;
    const span = jsonValueSpan(text, valueStart);
    if (!span) continue;
    const value = text.slice(span.start, span.end);
    // `""` and `[]` are values with length; what matters is whether anything is
    // inside them.
    const inner = value.replace(/^["[{]|["\]}]$/g, "").trim();
    if (!inner || value === "null") continue;
    found.push({
      kind,
      value,
      start: span.start,
      end: span.end,
      reason: `"${m[1]}" carries ${KIND_LABEL[kind].toLowerCase()} in FHIR`,
      certain: true,
    });
    // Skip the whole value, so nested keys inside a redacted object are not
    // reported twice.
    keyRe.lastIndex = span.end;
  }
  return found;
}

/** The extent of the JSON value starting at `from`, including nested structures. */
function jsonValueSpan(text: string, from: number): { start: number; end: number } | null {
  const first = text[from];
  if (first === undefined) return null;

  if (first === '"') {
    for (let i = from + 1; i < text.length; i++) {
      if (text[i] === "\\") i++;
      else if (text[i] === '"') return { start: from, end: i + 1 };
    }
    return null;
  }

  if (first === "{" || first === "[") {
    const close = first === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    for (let i = from; i < text.length; i++) {
      const c = text[i];
      if (inString) {
        if (c === "\\") i++;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') inString = true;
      else if (c === first) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) return { start: from, end: i + 1 };
      }
    }
    return null;
  }

  // A bare literal runs to the next delimiter.
  const rest = /[,}\]\r\n]/.exec(text.slice(from));
  return { start: from, end: rest ? from + rest.index : text.length };
}

// ---------------------------------------------------------------------------
// Structure: DICOM tag dumps
// ---------------------------------------------------------------------------

/** Group 0010 is the patient module; these are the tags within it that identify. */
const DICOM_TAGS: Record<string, PhiKind> = {
  "0010,0010": "name",
  "0010,0020": "mrn",
  "0010,0021": "otherId",
  "0010,0030": "birthDate",
  "0010,1000": "otherId",
  "0010,1001": "name",
  "0010,1040": "address",
  "0010,2154": "phone",
  "0010,2160": "otherId",
  "0008,0050": "otherId",
  "0008,0080": "name",
  "0008,0090": "name",
  "0008,1048": "name",
  "0008,1050": "name",
  "0008,1070": "name",
  "0018,1000": "device",
  "0020,000d": "otherId",
  "0020,0010": "otherId",
};

export function looksLikeDicom(text: string): boolean {
  return /\(0010,00[12]0\)/i.test(text);
}

/** Findings from a DICOM tag dump — `(0010,0010) PN [SMITH^JOHN]`. */
export function detectInDicom(text: string): PhiFinding[] {
  const found: PhiFinding[] = [];
  const re = /\((\d{4}),([0-9a-fA-F]{4})\)[^\[\r\n]*\[([^\]]*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const tag = `${m[1]},${m[2]}`.toLowerCase();
    const kind = DICOM_TAGS[tag];
    if (!kind || !m[3].trim()) continue;
    const start = m.index + m[0].lastIndexOf("[") + 1;
    found.push({
      kind,
      value: m[3],
      start,
      end: start + m[3].length,
      reason: `DICOM tag (${tag}) is ${KIND_LABEL[kind].toLowerCase()}`,
      certain: true,
    });
  }
  return found;
}

// ---------------------------------------------------------------------------
// Detection, combined
// ---------------------------------------------------------------------------

export type Format = "hl7" | "fhir" | "dicom" | "text";

/** Which parser to lead with. */
export function detectFormat(text: string): Format {
  if (looksLikeHl7(text)) return "hl7";
  if (looksLikeDicom(text)) return "dicom";
  if (looksLikeFhir(text)) return "fhir";
  return "text";
}

/**
 * Everything identifying in the text.
 *
 * Structure first, then regex over what the structure did not claim. A field
 * finding always wins an overlap, because it knows what it is looking at and the
 * regex is guessing.
 */
export function detectPhi(text: string, format: Format = detectFormat(text)): PhiFinding[] {
  const structural =
    format === "hl7" ? detectInHl7(text)
    : format === "dicom" ? detectInDicom(text)
    : format === "fhir" ? detectInJson(text)
    // JSON keys are worth checking even when nothing declared itself FHIR.
    : detectInJson(text);

  const claimed = (start: number, end: number) => structural.some((f) => start < f.end && end > f.start);
  const textual = detectInText(text).filter((f) => !claimed(f.start, f.end));

  return [...structural, ...textual].sort((a, b) => a.start - b.start || b.end - a.end);
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

export interface RedactionResult {
  /** The text as it would leave the machine. */
  text: string;
  /** Token → original value. Never leaves this process. */
  map: Record<string, string>;
  findings: PhiFinding[];
  /** What is still identifiable in `text`, scanned after redacting. */
  residual: PhiFinding[];
}

/**
 * Replace every finding with a stable token.
 *
 * The same value gets the same token throughout, which is what lets the model
 * reason about it — "[MRN_1] appears in both the ORM and the ORU" is a sentence
 * worth having, and it is only possible if the two occurrences match.
 *
 * The token format is deliberately plain ASCII in brackets. Anything more exotic
 * gets mangled, re-tokenised or "helpfully" rewritten by a model, and a token
 * that comes back changed cannot be mapped home.
 */
export function redact(text: string, findings: PhiFinding[] = detectPhi(text)): RedactionResult {
  const redactor = createRedactor();
  const result = redactor.redact(text, findings);
  return { ...result, map: redactor.map };
}

export interface Redactor {
  /** Token → original, shared across every call. */
  map: Record<string, string>;
  redact(text: string, findings?: PhiFinding[]): Omit<RedactionResult, "map">;
}

/**
 * A redactor whose tokens are stable across several texts.
 *
 * A prompt is a list of messages, and the same MRN in the system message and in
 * the user message has to become the same token or the model cannot tell they
 * are the same patient. One redactor, reused, is what makes that true.
 */
export function createRedactor(): Redactor {
  const map: Record<string, string> = {};
  const assigned = new Map<string, string>();
  const counters: Partial<Record<PhiKind, number>> = {};

  return {
    map,
    redact: (text, findings = detectPhi(text)) => redactWith(text, findings, map, assigned, counters),
  };
}

function redactWith(
  text: string,
  findings: PhiFinding[],
  map: Record<string, string>,
  assigned: Map<string, string>,
  counters: Partial<Record<PhiKind, number>>,
): Omit<RedactionResult, "map"> {
  // Longest-first at the same start, so a nested finding cannot split its parent.
  const ordered = [...findings].sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: PhiFinding[] = [];
  let lastEnd = -1;
  for (const f of ordered) {
    if (f.start < lastEnd) continue;
    kept.push(f);
    lastEnd = f.end;
  }

  let out = "";
  let cursor = 0;
  for (const f of kept) {
    const key = `${f.kind}:${f.value}`;
    let token = assigned.get(key);
    if (!token) {
      const n = (counters[f.kind] = (counters[f.kind] ?? 0) + 1);
      token = `[${f.kind.toUpperCase()}_${n}]`;
      assigned.set(key, token);
      map[token] = f.value;
    }
    out += text.slice(cursor, f.start) + token;
    cursor = f.end;
  }
  out += text.slice(cursor);

  // The check that matters: what is still identifiable in what would be sent.
  // Tokens themselves must not be re-flagged, so they are excluded by position.
  const residual = detectPhi(out).filter((f) => !/^\[[A-Z0-9]+_\d+\]$/.test(f.value));

  return { text: out, findings: kept, residual };
}

/**
 * Put the real values back into a model's reply.
 *
 * Longest token first: `[MRN_1]` is a prefix of `[MRN_10]`, and replacing the
 * short one first turns the long one into a real MRN followed by a stray `0`.
 */
export function reidentify(text: string, map: Record<string, string>): string {
  let out = text;
  for (const token of Object.keys(map).sort((a, b) => b.length - a.length)) {
    out = out.split(token).join(map[token]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

/**
 * What to do about PHI on its way out.
 *
 * `off` is offered because a local model is a genuinely different situation: an
 * Ollama on localhost is not a disclosure, and forcing redaction there makes the
 * answers worse for no benefit. The default is nonetheless to redact everywhere,
 * because "local" is a claim about a URL that is easy to get wrong.
 */
export type PhiPolicy = "off" | "warn" | "redact" | "block";

export interface PolicyDecision {
  /** May the request proceed? */
  allowed: boolean;
  /** The text to send — redacted, unless the policy is off. */
  text: string;
  map: Record<string, string>;
  findings: PhiFinding[];
  residual: PhiFinding[];
  /** One sentence for the user, always — including when nothing was found. */
  message: string;
}

/** Is this destination on this machine? */
export function isLocalDestination(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(url.trim());
}

/** Apply a policy to one outgoing text. */
export function applyPolicy(text: string, policy: PhiPolicy): PolicyDecision {
  if (policy === "off") {
    return { allowed: true, text, map: {}, findings: [], residual: [], message: "PHI redaction is off — the text is being sent exactly as written." };
  }

  const result = redact(text);
  const count = result.findings.length;

  if (policy === "warn") {
    return {
      ...result,
      allowed: true,
      // `warn` reports on the original and sends the original; redacting and then
      // sending the unredacted text would be the worst of both.
      text,
      map: {},
      message: count === 0 ? "Nothing identifying was found." : `${count} identifier(s) found and NOT removed — the policy is set to warn only.`,
    };
  }

  if (policy === "block" && result.residual.length > 0) {
    return {
      ...result,
      allowed: false,
      message:
        `Blocked: ${result.residual.length} identifier(s) are still present after redaction ` +
        `(${[...new Set(result.residual.map((f) => KIND_LABEL[f.kind]))].join(", ")}). ` +
        "Detection is best-effort, so anything it cannot remove it refuses to send.",
    };
  }

  return {
    ...result,
    allowed: true,
    message:
      count === 0
        ? "Nothing identifying was found; the text is unchanged."
        : `${count} identifier(s) replaced with tokens. The real values stay on this machine and are put back into the answer.`,
  };
}

export interface MessagesDecision extends Omit<PolicyDecision, "text"> {
  /** Each input text, in order, as it would leave the machine. */
  texts: string[];
}

/**
 * Apply a policy across every message of one prompt.
 *
 * Separate from `applyPolicy` because a prompt is not one string: the decision
 * has to be made over all of it at once (a block is a block for the whole
 * request) while the tokens stay consistent between the parts.
 */
export function applyPolicyToMessages(texts: string[], policy: PhiPolicy): MessagesDecision {
  if (policy === "off") {
    return { allowed: true, texts, map: {}, findings: [], residual: [], message: "PHI redaction is off — the prompt is being sent exactly as written." };
  }

  const redactor = createRedactor();
  const results = texts.map((t) => redactor.redact(t));
  const findings = results.flatMap((r) => r.findings);
  const residual = results.flatMap((r) => r.residual);

  if (policy === "warn") {
    return {
      allowed: true,
      texts,
      map: {},
      findings,
      residual,
      message: findings.length === 0 ? "Nothing identifying was found." : `${findings.length} identifier(s) found and NOT removed — the policy is set to warn only.`,
    };
  }

  if (policy === "block" && residual.length > 0) {
    return {
      allowed: false,
      texts,
      map: {},
      findings,
      residual,
      message:
        `Blocked: ${residual.length} identifier(s) are still present after redaction ` +
        `(${[...new Set(residual.map((f) => KIND_LABEL[f.kind]))].join(", ")}). ` +
        "Detection is best-effort, so anything it cannot remove it refuses to send.",
    };
  }

  return {
    allowed: true,
    texts: results.map((r) => r.text),
    map: redactor.map,
    findings,
    residual,
    message:
      findings.length === 0
        ? "Nothing identifying was found; the prompt is unchanged."
        : `${findings.length} identifier(s) replaced with tokens. The real values stay on this machine and are put back into the answer.`,
  };
}

/** A short summary of a decision, for a log line. */
export function summarise(findings: PhiFinding[]): string {
  if (findings.length === 0) return "nothing found";
  const counts: Partial<Record<PhiKind, number>> = {};
  for (const f of findings) counts[f.kind] = (counts[f.kind] ?? 0) + 1;
  return Object.entries(counts)
    .sort((a, b) => b[1]! - a[1]!)
    .map(([kind, n]) => `${n}× ${KIND_LABEL[kind as PhiKind]}`)
    .join(", ");
}

/** Findings grouped for display, worst (certain) first. */
export function groupFindings(findings: PhiFinding[]): { kind: PhiKind; label: string; values: string[]; certain: boolean; reason: string }[] {
  const groups = new Map<PhiKind, { kind: PhiKind; label: string; values: string[]; certain: boolean; reason: string }>();
  for (const f of findings) {
    const existing = groups.get(f.kind);
    if (existing) {
      if (!existing.values.includes(f.value)) existing.values.push(f.value);
      existing.certain = existing.certain || f.certain;
    } else {
      groups.set(f.kind, { kind: f.kind, label: KIND_LABEL[f.kind], values: [f.value], certain: f.certain, reason: f.reason });
    }
  }
  return [...groups.values()].sort((a, b) => Number(b.certain) - Number(a.certain) || b.values.length - a.values.length);
}
