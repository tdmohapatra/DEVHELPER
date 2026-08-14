/**
 * Live device links: the part of a medical interface that only shows up on the wire.
 *
 * `hl7Advanced.ts` can frame a message and `astmAdvanced.ts` can build and check
 * frames, but both work on a string you already have in full. A real link does
 * not hand you that. It hands you bytes, in arbitrary chunks, over time, and
 * expects a reply within a timeout — which is where the bugs actually are:
 *
 * - MLLP: two messages arriving in one TCP read, or one message split across
 *   three. A reader that assumes "one read = one message" works on the bench
 *   and drops results in production.
 * - ASTM E1381: the ENQ/ACK handshake, frame numbers cycling 1–7,0, a NAK that
 *   means "send that frame again", contention when both ends talk at once, and
 *   inactivity timeouts.
 *
 * Both are modelled here as pure state machines: bytes in, new state and the
 * bytes to send back out. No sockets, no clock, no I/O — the transport lives in
 * Rust (`commands/mllp.rs`, `commands/serial.rs`) and calls into this. That is
 * what makes a protocol this fiddly testable at all.
 *
 * Developer/integration utility only, NOT clinical software.
 */

import { MLLP_START, MLLP_END, describeFraming } from "./hl7Advanced";
import {
  ACK, CR, ENQ, EOT, ETB, ETX, LF, NAK, STX,
  astmChecksum, describeControlChars, frameRecords, type AstmFrame,
} from "./astmAdvanced";

/* ====================================================================== MLLP */

/** How many bytes may pile up without a complete message before we call it lost. */
export const MLLP_MAX_BUFFER = 8 * 1024 * 1024;

export interface MllpReader {
  /** Bytes seen since the last complete message. */
  buffer: string;
  /** Complete messages read so far, for the UI's counter. */
  count: number;
}

export const mllpReader = (): MllpReader => ({ buffer: "", count: 0 });

export interface MllpFeedResult {
  reader: MllpReader;
  /** Complete messages, MLLP framing already stripped. */
  messages: string[];
  /** Anything worth telling the user about the stream itself. */
  notes: string[];
}

/**
 * Feed a chunk of received bytes and take out whatever whole messages it completed.
 *
 * Everything before the first `<VT>` is discarded and reported: on a real link
 * that is either a previous message's tail after a reconnect, or a peer that is
 * not speaking MLLP at all, and silently eating it hides both.
 *
 * A message ends at `<FS><CR>`. A bare `<FS>` is accepted with a note, because
 * several analysers and older engines send it — refusing would mean refusing
 * results that are otherwise fine.
 */
export function mllpFeed(reader: MllpReader, chunk: string, maxBuffer = MLLP_MAX_BUFFER): MllpFeedResult {
  const messages: string[] = [];
  const notes: string[] = [];
  let buffer = reader.buffer + chunk;
  let count = reader.count;

  for (;;) {
    const start = buffer.indexOf(MLLP_START);
    if (start === -1) {
      // No start byte at all: hold only what could still be the beginning of one.
      if (buffer.length) notes.push(`Discarded ${buffer.length} byte(s) with no <VT> start block.`);
      buffer = "";
      break;
    }
    if (start > 0) {
      notes.push(`Discarded ${start} byte(s) before the <VT> start block.`);
      buffer = buffer.slice(start);
    }

    const end = buffer.indexOf(MLLP_END);
    if (end !== -1) {
      messages.push(buffer.slice(1, end));
      count++;
      buffer = buffer.slice(end + MLLP_END.length);
      continue;
    }

    // <FS> without the <CR> that should follow it, and nothing more coming in
    // this chunk: accept it rather than stall the link.
    const fs = buffer.indexOf("\x1c");
    if (fs !== -1 && fs === buffer.length - 1) {
      notes.push("Message ended with <FS> but no <CR>; accepted anyway.");
      messages.push(buffer.slice(1, fs));
      count++;
      buffer = "";
      continue;
    }

    break; // incomplete — wait for more bytes
  }

  if (buffer.length > maxBuffer) {
    notes.push(`No complete message in ${buffer.length} bytes; buffer dropped. Is the peer speaking MLLP?`);
    buffer = "";
  }

  return { reader: { buffer, count }, messages, notes };
}

/** Frame a message and show it as it will go on the wire. */
export const mllpPreview = (raw: string): string => describeFraming(`${MLLP_START}${raw}${MLLP_END}`);

/* ================================================================== encoding */

/**
 * Text → the byte string the transport carries.
 *
 * A device link moves bytes; the Rust side represents them as Latin-1, one char
 * per byte. A message typed in the UI is a JavaScript string, so anything above
 * U+00FF has to become bytes explicitly. Which encoding is not ours to guess —
 * HL7 declares it in MSH-18 and analysers vary — so the caller chooses, and the
 * default is UTF-8 because that is what MSH-18 usually says now.
 */
export function textToWire(text: string, encoding: "utf-8" | "latin-1" = "utf-8"): string {
  if (encoding === "latin-1") {
    let out = "";
    for (const ch of text) {
      const code = ch.codePointAt(0) ?? 0;
      // No silent substitution: a character with no Latin-1 byte becomes "?",
      // and the caller can see that in the preview before sending.
      out += code > 0xff ? "?" : ch;
    }
    return out;
  }
  const bytes = new TextEncoder().encode(text);
  let out = "";
  for (const b of bytes) out += String.fromCharCode(b);
  return out;
}

/** The wire's byte string → text. The inverse of `textToWire`. */
export function wireToText(wire: string, encoding: "utf-8" | "latin-1" = "utf-8"): string {
  if (encoding === "latin-1") return wire;
  const bytes = new Uint8Array(wire.length);
  for (let i = 0; i < wire.length; i++) bytes[i] = wire.charCodeAt(i) & 0xff;
  return new TextDecoder("utf-8").decode(bytes);
}

/* ================================================================ ASTM E1381 */

export type AstmPhase =
  | "idle"
  /** We sent ENQ and are waiting to be granted the line. */
  | "awaitingLine"
  /** We are transmitting frames and waiting for each ACK. */
  | "sending"
  /** The peer holds the line and is sending us frames. */
  | "receiving"
  | "complete"
  | "aborted";

export interface WireEvent {
  /** Milliseconds since the session started. Supplied by the caller — no clock in here. */
  at: number;
  direction: "tx" | "rx";
  /** Readable rendering, control characters named. */
  bytes: string;
  note?: string;
}

export interface AstmLink {
  phase: AstmPhase;
  /** Frames waiting to go out, built up front so a NAK can resend one verbatim. */
  frames: AstmFrame[];
  /** Index of the frame currently in flight. */
  index: number;
  /** Retries spent on the current step. E1381 allows six. */
  retries: number;
  /** Frame number we expect next while receiving; null until the line is granted. */
  expected: number | null;
  /** Bytes received that have not yet completed a frame. */
  pending: string;
  /** Text of ETB frames waiting for the ETX frame that completes the record. */
  partial: string;
  /** Records recovered from the peer, in order. */
  records: string[];
  transcript: WireEvent[];
  error?: string;
}

/** E1381 gives up after six retries on the same step. */
export const ASTM_MAX_RETRIES = 6;

export const astmLink = (): AstmLink => ({
  phase: "idle",
  frames: [],
  index: 0,
  retries: 0,
  expected: null,
  pending: "",
  partial: "",
  records: [],
  transcript: [],
});

export interface AstmStep {
  link: AstmLink;
  /** Exactly the bytes to put on the wire, or "" for nothing. */
  send: string;
}

/**
 * Ask for the line so we can transmit `records`.
 *
 * Frames are built now rather than as each one goes out, because a NAK means
 * "send that frame again" — byte for byte, checksum included. Rebuilding it
 * later is how an off-by-one in the frame number gets in.
 */
export function astmSend(link: AstmLink, records: string[], at = 0, maxTextLength?: number): AstmStep {
  if (link.phase === "sending" || link.phase === "awaitingLine") {
    return { link, send: "" };
  }
  const frames = frameRecords(records, maxTextLength ? { maxTextLength } : {});
  const next: AstmLink = {
    ...link,
    phase: "awaitingLine",
    frames,
    index: 0,
    retries: 0,
    error: undefined,
    transcript: [...link.transcript, tx(at, ENQ, "Requesting the line")],
  };
  return { link: next, send: ENQ };
}

/**
 * Feed received bytes and get back the reply.
 *
 * One call may both finish a frame and start the next exchange, so the reply is
 * whatever accumulated across the whole chunk rather than a single control byte.
 */
export function astmFeed(link: AstmLink, chunk: string, at = 0): AstmStep {
  let state: AstmLink = { ...link, transcript: [...link.transcript] };
  let send = "";

  if (chunk) state.transcript.push(rx(at, chunk));

  for (const byte of chunk) {
    const out = handleByte(state, byte, at);
    state = out.link;
    send += out.send;
  }

  if (send) state.transcript.push(tx(at, send));
  return { link: state, send };
}

function handleByte(link: AstmLink, byte: string, at: number): AstmStep {
  switch (link.phase) {
    case "awaitingLine":
      if (byte === ACK) return startSending(link);
      if (byte === NAK) return retryEnq(link, at);
      // Contention: both ends asked at once. Yield — the analyser is the one
      // with results to deliver, and a link where neither side yields deadlocks.
      if (byte === ENQ) {
        return {
          link: { ...link, phase: "receiving", expected: 1, retries: 0, pending: "", partial: "", records: [] },
          send: ACK,
        };
      }
      if (byte === EOT) return { link: abort(link, "The peer released the line without granting it.", at), send: "" };
      return { link, send: "" };

    case "sending":
      if (byte === ACK) return advanceFrame(link);
      if (byte === NAK) return retryFrame(link, at);
      if (byte === EOT) return { link: abort(link, "The peer ended the session mid-transfer.", at), send: "" };
      return { link, send: "" };

    case "idle":
    case "complete":
    case "aborted":
      if (byte === ENQ) {
        return {
          link: { ...link, phase: "receiving", expected: 1, retries: 0, pending: "", partial: "", records: [], error: undefined },
          send: ACK,
        };
      }
      return { link, send: "" };

    case "receiving":
      if (byte === EOT) {
        return { link: { ...link, phase: "complete", expected: null, pending: "", partial: "" }, send: "" };
      }
      return receiveByte(link, byte, at);
  }
}

/* ---- transmitting ---- */

function startSending(link: AstmLink): AstmStep {
  if (!link.frames.length) {
    return { link: { ...link, phase: "complete", retries: 0 }, send: EOT };
  }
  return { link: { ...link, phase: "sending", index: 0, retries: 0 }, send: link.frames[0].raw };
}

function advanceFrame(link: AstmLink): AstmStep {
  const index = link.index + 1;
  if (index >= link.frames.length) {
    return { link: { ...link, phase: "complete", index, retries: 0 }, send: EOT };
  }
  return { link: { ...link, index, retries: 0 }, send: link.frames[index].raw };
}

function retryFrame(link: AstmLink, at: number): AstmStep {
  const retries = link.retries + 1;
  if (retries > ASTM_MAX_RETRIES) {
    return {
      link: abort(link, `Frame ${link.frames[link.index]?.frameNumber ?? "?"} was rejected ${ASTM_MAX_RETRIES} times.`, at),
      send: EOT,
    };
  }
  return { link: { ...link, retries }, send: link.frames[link.index].raw };
}

function retryEnq(link: AstmLink, at: number): AstmStep {
  const retries = link.retries + 1;
  if (retries > ASTM_MAX_RETRIES) {
    return { link: abort(link, `The line was refused ${ASTM_MAX_RETRIES} times.`, at), send: EOT };
  }
  return { link: { ...link, retries }, send: ENQ };
}

/* ---- receiving ---- */

const FRAME_END = new RegExp(`[${ETX}${ETB}][0-9A-Fa-f]{2}${CR}${LF}$`);

function receiveByte(link: AstmLink, byte: string, at: number): AstmStep {
  // Ignore anything before a frame starts — handshake leftovers, line noise.
  if (!link.pending && byte !== STX) return { link, send: "" };

  const pending = link.pending + byte;
  if (!FRAME_END.test(pending)) {
    // A frame that never terminates would grow without bound; cap it at a size
    // no legal frame can reach (240 text + control + checksum, doubled).
    if (pending.length > 600) {
      return { link: { ...link, pending: "", retries: link.retries + 1 }, send: NAK };
    }
    return { link: { ...link, pending }, send: "" };
  }

  return acceptFrame({ ...link, pending: "" }, pending, at);
}

/** Check one complete frame's checksum and frame number, then ACK or NAK it. */
function acceptFrame(link: AstmLink, raw: string, at: number): AstmStep {
  // raw is STX + body + <ETX|ETB> + two checksum digits + CR + LF.
  const body = raw.slice(1, -5);
  const terminator = raw.slice(-5, -4);
  const checksum = raw.slice(-4, -2).toUpperCase();
  const expectedChecksum = astmChecksum(`${body}${terminator}`);
  const digit = body[0] ?? "";
  const frameNumber = /^[0-7]$/.test(digit) ? Number(digit) : null;
  const text = frameNumber === null ? body : body.slice(1);

  const problems: string[] = [];
  if (frameNumber === null) problems.push(`frame number "${digit || "(missing)"}" is not 0–7`);
  if (checksum !== expectedChecksum) problems.push(`checksum ${checksum} should be ${expectedChecksum}`);
  if (frameNumber !== null && link.expected !== null && frameNumber !== link.expected) {
    problems.push(`expected frame ${link.expected}, got ${frameNumber}`);
  }

  if (problems.length) {
    const retries = link.retries + 1;
    const note = `Frame rejected: ${problems.join("; ")}.`;
    if (retries > ASTM_MAX_RETRIES) {
      return { link: abort({ ...link, retries }, note, at), send: EOT };
    }
    return { link: { ...link, retries, transcript: [...link.transcript, mark(at, note)] }, send: NAK };
  }

  const partial = link.partial + text;
  const final = terminator === ETX;
  const records = final
    ? [...link.records, ...partial.split(CR).map((r) => r.trim()).filter(Boolean)]
    : link.records;

  return {
    link: {
      ...link,
      retries: 0,
      expected: frameNumber === 7 ? 0 : (frameNumber ?? 0) + 1,
      partial: final ? "" : partial,
      records,
    },
    send: ACK,
  };
}

/* ---- timeouts ---- */

/**
 * The inactivity timer fired.
 *
 * E1381 gives the receiver 15 seconds between frames and the transmitter 15
 * seconds to be answered. A timeout is not a protocol error to reply to — it is
 * the point at which you stop waiting, so the link ends rather than hangs.
 */
export function astmTimeout(link: AstmLink, at = 0): AstmStep {
  switch (link.phase) {
    case "awaitingLine":
      return retryEnq(link, at);
    case "sending":
      return { link: abort(link, "No answer to the frame in flight.", at), send: EOT };
    case "receiving":
      return { link: abort(link, "The peer stopped sending mid-transfer.", at), send: EOT };
    default:
      return { link, send: "" };
  }
}

function abort(link: AstmLink, reason: string, at: number): AstmLink {
  return { ...link, phase: "aborted", error: reason, pending: "", transcript: [...link.transcript, mark(at, reason)] };
}

const tx = (at: number, bytes: string, note?: string): WireEvent => ({ at, direction: "tx", bytes: describeControlChars(bytes), note });
const rx = (at: number, bytes: string, note?: string): WireEvent => ({ at, direction: "rx", bytes: describeControlChars(bytes), note });
const mark = (at: number, note: string): WireEvent => ({ at, direction: "rx", bytes: "", note });

/** Progress through the outgoing frames, for a progress bar that means something. */
export function astmProgress(link: AstmLink): { sent: number; total: number; percent: number } {
  const total = link.frames.length;
  const sent = link.phase === "complete" ? total : Math.min(link.index, total);
  return { sent, total, percent: total ? Math.round((sent / total) * 100) : 0 };
}

/* ==================================================================== replay */

export interface ReplayStep {
  /** Milliseconds to wait before this event, after scaling. */
  delayMs: number;
  event: WireEvent;
}

/**
 * Turn a captured transcript into a replay schedule.
 *
 * Real captures have long idle gaps — an analyser that ran a rack at 09:00 and
 * the next at 11:00 is one file with a two-hour hole in it. Replaying that
 * faithfully means a test that takes two hours, so gaps are capped. Speed
 * scales what is left.
 */
export function replayPlan(
  events: WireEvent[],
  opts: { speed?: number; maxGapMs?: number } = {},
): ReplayStep[] {
  const speed = opts.speed && opts.speed > 0 ? opts.speed : 1;
  const maxGap = opts.maxGapMs ?? 2000;
  const ordered = [...events].sort((a, b) => a.at - b.at);
  let previous: number | null = null;
  return ordered.map((event) => {
    const gap = previous === null ? 0 : Math.max(0, event.at - previous);
    previous = event.at;
    return { delayMs: Math.round(Math.min(gap, maxGap) / speed), event };
  });
}

/** How long a replay will take, so the UI can say so before starting. */
export const replayDuration = (plan: ReplayStep[]): number => plan.reduce((total, s) => total + s.delayMs, 0);

/** Render a transcript as a paste-able log. */
export function transcriptText(events: WireEvent[]): string {
  return events
    .map((e) => {
      const arrow = e.direction === "tx" ? "→" : "←";
      const stamp = `${(e.at / 1000).toFixed(3)}s`;
      const note = e.note ? `  (${e.note})` : "";
      return `${stamp.padStart(9)} ${e.bytes ? arrow : " "} ${e.bytes}${note}`;
    })
    .join("\n");
}
