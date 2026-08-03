/**
 * ASTM E1381 low-level transport (frames, checksums, the ENQ/ACK handshake) plus
 * conversions out of ASTM. Developer/integration utility only, NOT clinical
 * software.
 *
 * The record content layer lives in `astm.ts`. Analyzers that "send ASTM" are
 * really sending E1381 frames whose payload is one E1394 record, which is why
 * checksum and frame-number bugs are the most common thing to have to debug on
 * these links.
 */

import {
  astmField,
  astmTimestampToIso,
  flattenAstm,
  parseAstm,
  parseTestId,
  splitRecords,
  type AstmMessage,
} from "./astm";

export const STX = "\x02";
export const ETX = "\x03";
export const EOT = "\x04";
export const ENQ = "\x05";
export const ACK = "\x06";
export const NAK = "\x15";
export const ETB = "\x17";
export const CR = "\x0d";
export const LF = "\x0a";

/** E1381 caps a frame's text at 240 characters; longer records are split. */
export const MAX_FRAME_TEXT = 240;

const CONTROL_NAMES: Record<string, string> = {
  [STX]: "<STX>", [ETX]: "<ETX>", [EOT]: "<EOT>", [ENQ]: "<ENQ>",
  [ACK]: "<ACK>", [NAK]: "<NAK>", [ETB]: "<ETB>", [CR]: "<CR>", [LF]: "<LF>",
};

/** Render control characters as readable tokens (`<STX>`, `<CR>` …). */
export function describeControlChars(value: string): string {
  return value.replace(/[\x00-\x1f]/g, (c) => CONTROL_NAMES[c] ?? `<0x${c.charCodeAt(0).toString(16).padStart(2, "0").toUpperCase()}>`);
}

/**
 * E1381 checksum: the 8-bit sum of every character from the frame number through
 * the terminating ETX/ETB, as two upper-case hex digits. `payload` is exactly
 * that span — what sits between STX and the checksum itself.
 */
export function astmChecksum(payload: string): string {
  let sum = 0;
  for (let i = 0; i < payload.length; i++) sum = (sum + payload.charCodeAt(i)) & 0xff;
  return sum.toString(16).toUpperCase().padStart(2, "0");
}

export interface AstmFrame {
  /** 0–7, cycling */
  frameNumber: number;
  text: string;
  /** false when this is an intermediate frame of a split record (ETB) */
  final: boolean;
  checksum: string;
  /** the bytes actually put on the wire, control characters included */
  raw: string;
}

function buildFrame(frameNumber: number, text: string, final: boolean): AstmFrame {
  const payload = `${frameNumber}${text}${final ? ETX : ETB}`;
  const checksum = astmChecksum(payload);
  return { frameNumber, text, final, checksum, raw: `${STX}${payload}${checksum}${CR}${LF}` };
}

/**
 * Frame each record for transmission, splitting any record longer than
 * `maxTextLength` into ETB-terminated intermediate frames. Frame numbers start at
 * 1 and cycle 1–7,0 across the whole session, not per record.
 */
export function frameRecords(
  records: string[],
  opts: { maxTextLength?: number; startFrame?: number } = {},
): AstmFrame[] {
  const maxTextLength = Math.max(1, opts.maxTextLength ?? MAX_FRAME_TEXT);
  let frameNumber = opts.startFrame ?? 1;
  const frames: AstmFrame[] = [];
  for (const record of records) {
    // Records carry their own CR terminator inside the frame text.
    const text = `${record}${CR}`;
    for (let offset = 0; offset < text.length; offset += maxTextLength) {
      const chunk = text.slice(offset, offset + maxTextLength);
      const final = offset + maxTextLength >= text.length;
      frames.push(buildFrame(frameNumber, chunk, final));
      frameNumber = frameNumber === 7 ? 0 : frameNumber + 1;
    }
  }
  return frames;
}

/** Frame each record of a raw ASTM message. */
export function frameMessage(raw: string, opts?: { maxTextLength?: number; startFrame?: number }): AstmFrame[] {
  return frameRecords(splitRecords(raw).map((r) => r.text), opts);
}

export interface ParsedFrame {
  frameNumber: number | null;
  text: string;
  final: boolean;
  /** checksum as received */
  checksum: string;
  /** checksum recomputed from the payload */
  expectedChecksum: string;
  valid: boolean;
  problems: string[];
}

const FRAME_PATTERN = new RegExp(`${STX}([\\s\\S]*?)([${ETX}${ETB}])([0-9A-Fa-f]{0,2})`, "g");

/**
 * Pull frames out of a captured byte stream and verify each checksum. Anything
 * outside a STX…checksum span (handshake bytes, log noise) is ignored, so a
 * pasted terminal capture can be checked as-is.
 */
export function parseFrames(input: string): ParsedFrame[] {
  const frames: ParsedFrame[] = [];
  for (const match of input.matchAll(FRAME_PATTERN)) {
    const [, body, terminator, checksum] = match;
    const problems: string[] = [];
    const digit = body[0] ?? "";
    const frameNumber = /^[0-7]$/.test(digit) ? Number(digit) : null;
    if (frameNumber === null) problems.push(`Frame number "${digit || "(missing)"}" is not a digit 0–7.`);
    const text = frameNumber === null ? body : body.slice(1);
    const expectedChecksum = astmChecksum(`${body}${terminator}`);
    if (checksum.length < 2) {
      problems.push("Checksum is missing or truncated.");
    } else if (checksum.toUpperCase() !== expectedChecksum) {
      problems.push(`Checksum mismatch: frame says ${checksum.toUpperCase()}, payload computes to ${expectedChecksum}.`);
    }
    frames.push({
      frameNumber,
      text,
      final: terminator === ETX,
      checksum: checksum.toUpperCase(),
      expectedChecksum,
      valid: problems.length === 0,
      problems,
    });
  }
  return frames;
}

/**
 * Records recovered from a framed capture: intermediate (ETB) frames are joined
 * onto the frame that completes them, and record terminators are dropped.
 */
export function unframe(input: string): string {
  const records: string[] = [];
  let pending = "";
  for (const frame of parseFrames(input)) {
    pending += frame.text;
    if (frame.final) {
      records.push(...pending.split(CR).map((r) => r.trim()).filter(Boolean));
      pending = "";
    }
  }
  if (pending.trim()) records.push(...pending.split(CR).map((r) => r.trim()).filter(Boolean));
  return records.join("\n");
}

/** Frame numbers must advance by one, cycling 7→0. Reports the first break. */
export function checkFrameSequence(frames: ParsedFrame[]): string[] {
  const problems: string[] = [];
  let expected: number | null = null;
  for (const [i, frame] of frames.entries()) {
    if (frame.frameNumber === null) continue;
    if (expected !== null && frame.frameNumber !== expected) {
      problems.push(`Frame ${i + 1}: expected frame number ${expected}, got ${frame.frameNumber}.`);
    }
    expected = frame.frameNumber === 7 ? 0 : frame.frameNumber + 1;
  }
  return problems;
}

export interface SessionStep {
  /** sender→receiver ("analyzer" side) or the reply direction */
  direction: "send" | "reply";
  label: string;
  /** readable rendering of the bytes for this step */
  bytes: string;
}

/**
 * The E1381 exchange for a message, as a transcript: establishment (ENQ/ACK),
 * one ACK per frame, then termination (EOT). This is what a working link looks
 * like — useful for comparing against a real capture.
 */
export function buildSession(raw: string, opts?: { maxTextLength?: number }): SessionStep[] {
  const steps: SessionStep[] = [
    { direction: "send", label: "Establishment — request the line", bytes: describeControlChars(ENQ) },
    { direction: "reply", label: "Receiver is ready", bytes: describeControlChars(ACK) },
  ];
  for (const frame of frameMessage(raw, opts)) {
    steps.push({
      direction: "send",
      label: `Frame ${frame.frameNumber}${frame.final ? "" : " (continues)"} — checksum ${frame.checksum}`,
      bytes: describeControlChars(frame.raw),
    });
    steps.push({ direction: "reply", label: "Frame accepted", bytes: describeControlChars(ACK) });
  }
  steps.push({ direction: "send", label: "Termination — release the line", bytes: describeControlChars(EOT) });
  return steps;
}

/** Numeric-looking result values map to HL7 NM, everything else to ST. */
function hl7ValueType(value: string): "NM" | "ST" {
  return /^[+-]?\d+(\.\d+)?$/.test(value.trim()) ? "NM" : "ST";
}

function hl7Timestamp(value: string): string {
  // HL7 v2 uses the same YYYYMMDDHHMMSS shape, so a valid ASTM stamp passes through.
  return astmTimestampToIso(value) === null ? "" : value.trim();
}

/**
 * Map an ASTM result message to an HL7 v2.5 ORU^R01.
 *
 * H → MSH, P → PID, O → OBR, R → OBX, C → NTE. Only fields with an unambiguous
 * counterpart are carried across; anything manufacturer-specific is left out
 * rather than guessed at, so this is a starting point for an interface, not a
 * certified translation.
 */
export function astmToHl7(raw: string): string {
  const message = parseAstm(raw);
  const header = message.records.find((r) => r.type === "H");
  const controlId = header ? astmField(header, 3) || "1" : "1";
  const stamp = header ? hl7Timestamp(astmField(header, 14)) : "";

  const segments: string[] = [
    ["MSH", "^~\\&", message.sender, "", message.receiver, "", stamp, "", "ORU^R01", controlId, "P", "2.5"].join("|"),
  ];

  let patientCount = 0;
  let orderCount = 0;
  let obxCount = 0;
  let noteCount = 0;

  for (const record of message.records) {
    switch (record.type) {
      case "P": {
        patientCount++;
        orderCount = 0;
        const identifier = astmField(record, 4) || astmField(record, 3);
        segments.push([
          "PID", String(patientCount), "", identifier, "", astmField(record, 6), "",
          hl7Timestamp(astmField(record, 8)), astmField(record, 9),
        ].join("|"));
        break;
      }
      case "O": {
        orderCount++;
        obxCount = 0;
        const test = parseTestId(astmField(record, 5), message.delimiters);
        segments.push([
          "OBR", String(orderCount), astmField(record, 3), astmField(record, 4),
          [test.code, test.name].filter(Boolean).join("^"), astmField(record, 6),
          hl7Timestamp(astmField(record, 7)), hl7Timestamp(astmField(record, 8)),
        ].join("|"));
        break;
      }
      case "R": {
        obxCount++;
        const test = parseTestId(astmField(record, 3), message.delimiters);
        const value = astmField(record, 4);
        segments.push([
          "OBX", String(obxCount), hl7ValueType(value),
          [test.code, test.name].filter(Boolean).join("^"), "", value,
          astmField(record, 5), astmField(record, 6), astmField(record, 7), "", "",
          astmField(record, 9),
        ].join("|"));
        break;
      }
      case "C": {
        noteCount++;
        segments.push(["NTE", String(noteCount), astmField(record, 3), astmField(record, 4)].join("|"));
        break;
      }
    }
  }

  return segments.join("\n");
}

export interface AstmDifference {
  path: string;
  kind: "added" | "removed" | "changed";
  left?: string;
  right?: string;
}

/** Field-level differences between two messages, keyed by flattened path. */
export function diffAstm(leftRaw: string, rightRaw: string): AstmDifference[] {
  const index = (message: AstmMessage) => new Map(flattenAstm(message).map((p) => [p.path, p.value]));
  const left = index(parseAstm(leftRaw));
  const right = index(parseAstm(rightRaw));
  const differences: AstmDifference[] = [];

  for (const [path, value] of left) {
    if (!right.has(path)) differences.push({ path, kind: "removed", left: value });
    else if (right.get(path) !== value) differences.push({ path, kind: "changed", left: value, right: right.get(path) });
  }
  for (const [path, value] of right) {
    if (!left.has(path)) differences.push({ path, kind: "added", right: value });
  }
  return differences;
}
