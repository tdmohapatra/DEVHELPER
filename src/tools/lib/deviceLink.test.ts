import { describe, it, expect } from "vitest";
import {
  mllpReader, mllpFeed, mllpPreview,
  astmLink, astmSend, astmFeed, astmTimeout, astmProgress, ASTM_MAX_RETRIES,
  replayPlan, replayDuration, transcriptText,
  type AstmLink, type WireEvent,
} from "./deviceLink";
import { ACK, CR, ENQ, EOT, ETB, ETX, LF, NAK, STX, astmChecksum, frameRecords } from "./astmAdvanced";
import { MLLP_START, MLLP_END } from "./hl7Advanced";

const framed = (msg: string) => `${MLLP_START}${msg}${MLLP_END}`;

describe("MLLP stream reader", () => {
  it("reads one whole message", () => {
    const r = mllpFeed(mllpReader(), framed("MSH|^~\\&|A"));
    expect(r.messages).toEqual(["MSH|^~\\&|A"]);
    expect(r.reader.buffer).toBe("");
    expect(r.reader.count).toBe(1);
  });

  it("reads two messages that arrived in one read", () => {
    const r = mllpFeed(mllpReader(), framed("one") + framed("two"));
    expect(r.messages).toEqual(["one", "two"]);
  });

  it("reassembles a message split across three reads", () => {
    let reader = mllpReader();
    const whole = framed("MSH|split");
    const a = mllpFeed(reader, whole.slice(0, 4));
    expect(a.messages).toEqual([]);
    reader = a.reader;
    const b = mllpFeed(reader, whole.slice(4, 8));
    expect(b.messages).toEqual([]);
    reader = b.reader;
    const c = mllpFeed(reader, whole.slice(8));
    expect(c.messages).toEqual(["MSH|split"]);
    expect(c.reader.buffer).toBe("");
  });

  it("holds a partial second message while returning the first", () => {
    const r = mllpFeed(mllpReader(), framed("first") + MLLP_START + "seco");
    expect(r.messages).toEqual(["first"]);
    expect(r.reader.buffer).toBe(MLLP_START + "seco");
  });

  it("counts messages across reads", () => {
    const a = mllpFeed(mllpReader(), framed("one"));
    const b = mllpFeed(a.reader, framed("two"));
    expect(b.reader.count).toBe(2);
  });

  it("reports and drops junk before the start block", () => {
    const r = mllpFeed(mllpReader(), "noise" + framed("real"));
    expect(r.messages).toEqual(["real"]);
    expect(r.notes[0]).toMatch(/Discarded 5 byte\(s\) before/);
  });

  it("reports a chunk with no start block at all", () => {
    const r = mllpFeed(mllpReader(), "not mllp at all");
    expect(r.messages).toEqual([]);
    expect(r.reader.buffer).toBe("");
    expect(r.notes[0]).toMatch(/no <VT>/);
  });

  it("accepts a message ended with a bare FS, and says so", () => {
    const r = mllpFeed(mllpReader(), `${MLLP_START}loose\x1c`);
    expect(r.messages).toEqual(["loose"]);
    expect(r.notes[0]).toMatch(/no <CR>/);
  });

  it("does not treat an FS mid-buffer as the end of the message", () => {
    // A real <FS><CR> follows later; the earlier FS is inside the payload.
    const r = mllpFeed(mllpReader(), `${MLLP_START}a\x1cb${MLLP_END}`);
    expect(r.messages).toEqual(["a\x1cb"]);
  });

  it("drops a buffer that never completes rather than growing without bound", () => {
    const r = mllpFeed(mllpReader(), MLLP_START + "x".repeat(50), 20);
    expect(r.reader.buffer).toBe("");
    expect(r.notes.some((n) => /buffer dropped/.test(n))).toBe(true);
  });

  it("shows the framing bytes by name", () => {
    expect(mllpPreview("MSH|x")).toBe("<VT>MSH|x<FS><CR>\n");
  });
});

/* ------------------------------------------------------------------- ASTM ---- */

const frameOf = (n: number, text: string, final = true) => {
  const payload = `${n}${text}${final ? ETX : ETB}`;
  return `${STX}${payload}${astmChecksum(payload)}${CR}${LF}`;
};

describe("ASTM transmitting", () => {
  const records = ["H|\\^&|||analyser", "L|1|N"];
  const start = (): AstmLink => astmSend(astmLink(), records).link;

  it("asks for the line with ENQ", () => {
    const step = astmSend(astmLink(), records);
    expect(step.send).toBe(ENQ);
    expect(step.link.phase).toBe("awaitingLine");
    expect(step.link.frames.length).toBe(2);
  });

  it("sends the first frame once the line is granted", () => {
    const step = astmFeed(start(), ACK);
    expect(step.link.phase).toBe("sending");
    expect(step.send).toBe(frameRecords(records)[0].raw);
  });

  it("walks every frame and finishes with EOT", () => {
    let link = astmFeed(start(), ACK).link;
    const second = astmFeed(link, ACK);
    expect(second.send).toBe(frameRecords(records)[1].raw);
    link = second.link;
    const done = astmFeed(link, ACK);
    expect(done.send).toBe(EOT);
    expect(done.link.phase).toBe("complete");
  });

  it("resends the same bytes on NAK, checksum included", () => {
    const link = astmFeed(start(), ACK).link;
    const again = astmFeed(link, NAK);
    expect(again.send).toBe(frameRecords(records)[0].raw);
    expect(again.link.retries).toBe(1);
  });

  it("gives up after six retries and releases the line", () => {
    let link = astmFeed(start(), ACK).link;
    let send = "";
    for (let i = 0; i <= ASTM_MAX_RETRIES; i++) {
      const step = astmFeed(link, NAK);
      link = step.link;
      send = step.send;
    }
    expect(send).toBe(EOT);
    expect(link.phase).toBe("aborted");
    expect(link.error).toMatch(/rejected 6 times/);
  });

  it("retries the ENQ when the line is refused, then gives up", () => {
    let link = start();
    for (let i = 0; i <= ASTM_MAX_RETRIES; i++) link = astmFeed(link, NAK).link;
    expect(link.phase).toBe("aborted");
    expect(link.error).toMatch(/refused 6 times/);
  });

  it("yields the line when both ends ask at once", () => {
    const step = astmFeed(start(), ENQ);
    expect(step.send).toBe(ACK);
    expect(step.link.phase).toBe("receiving");
  });

  it("stops waiting when the frame in flight is never answered", () => {
    const link = astmFeed(start(), ACK).link;
    const step = astmTimeout(link);
    expect(step.link.phase).toBe("aborted");
    expect(step.send).toBe(EOT);
  });

  it("reports progress through the frames", () => {
    let link = astmFeed(start(), ACK).link;
    expect(astmProgress(link)).toEqual({ sent: 0, total: 2, percent: 0 });
    link = astmFeed(link, ACK).link;
    expect(astmProgress(link)).toEqual({ sent: 1, total: 2, percent: 50 });
    link = astmFeed(link, ACK).link;
    expect(astmProgress(link)).toEqual({ sent: 2, total: 2, percent: 100 });
  });

  it("refuses to start a second transfer while one is running", () => {
    const link = start();
    expect(astmSend(link, ["H|"]).send).toBe("");
  });
});

describe("ASTM receiving", () => {
  const listening = () => astmFeed(astmLink(), ENQ);

  it("grants the line on ENQ", () => {
    const step = listening();
    expect(step.send).toBe(ACK);
    expect(step.link.phase).toBe("receiving");
    expect(step.link.expected).toBe(1);
  });

  it("acknowledges a good frame and recovers the record", () => {
    const step = astmFeed(listening().link, frameOf(1, "R|1|Na|140|mmol/L\r"));
    expect(step.send).toBe(ACK);
    expect(step.link.records).toEqual(["R|1|Na|140|mmol/L"]);
    expect(step.link.expected).toBe(2);
  });

  it("reassembles a record split across ETB frames", () => {
    let link = listening().link;
    link = astmFeed(link, frameOf(1, "R|1|Na|1", false)).link;
    expect(link.records).toEqual([]);
    const step = astmFeed(link, frameOf(2, "40|mmol/L\r"));
    expect(step.link.records).toEqual(["R|1|Na|140|mmol/L"]);
  });

  it("reassembles a frame that arrived one byte at a time", () => {
    let link = listening().link;
    const raw = frameOf(1, "R|1|x\r");
    let send = "";
    for (const byte of raw) {
      const step = astmFeed(link, byte);
      link = step.link;
      send = step.send || send;
    }
    expect(send).toBe(ACK);
    expect(link.records).toEqual(["R|1|x"]);
  });

  it("NAKs a frame whose checksum is wrong", () => {
    const bad = frameOf(1, "R|1|x\r").replace(/[0-9A-F]{2}(?=\r\n$)/, "00");
    const step = astmFeed(listening().link, bad);
    expect(step.send).toBe(NAK);
    expect(step.link.records).toEqual([]);
    expect(step.link.transcript.some((e) => /checksum/.test(e.note ?? ""))).toBe(true);
  });

  it("NAKs a frame that arrived out of order", () => {
    const step = astmFeed(listening().link, frameOf(3, "R|1|x\r"));
    expect(step.send).toBe(NAK);
    expect(step.link.transcript.some((e) => /expected frame 1, got 3/.test(e.note ?? ""))).toBe(true);
  });

  it("wraps the expected frame number from 7 to 0", () => {
    let link: AstmLink = { ...listening().link, expected: 7 };
    link = astmFeed(link, frameOf(7, "R|1|x\r")).link;
    expect(link.expected).toBe(0);
  });

  it("ends the session on EOT", () => {
    const step = astmFeed(listening().link, EOT);
    expect(step.link.phase).toBe("complete");
    expect(step.send).toBe("");
  });

  it("ignores noise before a frame starts", () => {
    const step = astmFeed(listening().link, "garbage");
    expect(step.send).toBe("");
    expect(step.link.pending).toBe("");
  });

  it("NAKs a frame that never terminates rather than buffering for ever", () => {
    const step = astmFeed(listening().link, STX + "1" + "x".repeat(700));
    expect(step.send).toBe(NAK);
    expect(step.link.pending).toBe("");
  });

  it("stops waiting when the peer goes quiet mid-transfer", () => {
    const step = astmTimeout(listening().link);
    expect(step.link.phase).toBe("aborted");
    expect(step.send).toBe(EOT);
  });

  it("does nothing on a timeout when there is no session", () => {
    expect(astmTimeout(astmLink()).send).toBe("");
  });

  it("keeps a transcript of both directions", () => {
    const step = astmFeed(listening().link, frameOf(1, "R|1|x\r"));
    const directions = step.link.transcript.map((e) => e.direction);
    expect(directions).toContain("rx");
    expect(directions).toContain("tx");
    expect(step.link.transcript.some((e) => e.bytes.includes("<STX>"))).toBe(true);
  });
});

/* ----------------------------------------------------------------- replay ---- */

describe("replay", () => {
  const events: WireEvent[] = [
    { at: 0, direction: "rx", bytes: "<ENQ>" },
    { at: 500, direction: "tx", bytes: "<ACK>" },
    { at: 600_000, direction: "rx", bytes: "<STX>" },
  ];

  it("waits the real gap between events", () => {
    expect(replayPlan(events).map((s) => s.delayMs)).toEqual([0, 500, 2000]);
  });

  it("caps an idle gap so a capture with a two-hour hole is still replayable", () => {
    expect(replayPlan(events, { maxGapMs: 100 }).map((s) => s.delayMs)).toEqual([0, 100, 100]);
  });

  it("scales by speed", () => {
    expect(replayPlan(events, { speed: 2 }).map((s) => s.delayMs)).toEqual([0, 250, 1000]);
  });

  it("ignores a speed of zero rather than dividing by it", () => {
    expect(replayPlan(events, { speed: 0 })[1].delayMs).toBe(500);
  });

  it("sorts events that arrived out of order", () => {
    const plan = replayPlan([events[2], events[0], events[1]]);
    expect(plan.map((s) => s.event.at)).toEqual([0, 500, 600_000]);
  });

  it("totals how long a replay will take", () => {
    expect(replayDuration(replayPlan(events))).toBe(2500);
  });

  it("renders a transcript with direction and time", () => {
    const text = transcriptText([{ at: 1500, direction: "tx", bytes: "<ENQ>", note: "asking" }]);
    expect(text).toContain("1.500s");
    expect(text).toContain("→ <ENQ>");
    expect(text).toContain("(asking)");
  });
});
