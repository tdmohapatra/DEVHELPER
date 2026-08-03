import { describe, it, expect } from "vitest";
import {
  ACK,
  CR,
  ENQ,
  EOT,
  ETB,
  ETX,
  LF,
  STX,
  astmChecksum,
  astmToHl7,
  buildSession,
  checkFrameSequence,
  describeControlChars,
  diffAstm,
  frameMessage,
  frameRecords,
  parseFrames,
  unframe,
} from "./astmAdvanced";

const SAMPLE = [
  "H|\\^&|||Sysmex^XN-1000|||||LIS||P|1|20240101120000",
  "P|1||PID123||DOE^JOHN||19800101|M",
  "O|1|SPEC001||^^^WBC^White Blood Cell|R||20240101090000",
  "R|1|^^^WBC^White Blood Cell|7.2|10*3/uL|4.0-11.0|N||F||OP1|20240101093000",
  "C|1|I|Sample slightly haemolysed|G",
  "L|1|N",
].join("\r\n");

describe("astmChecksum", () => {
  it("sums the payload bytes as two upper-case hex digits", () => {
    // "1" (0x31) + "A" (0x41) + ETX (0x03) = 0x75
    expect(astmChecksum(`1A${ETX}`)).toBe("75");
    // "0" (0x30) + ETB (0x17) = 0x47
    expect(astmChecksum(`0${ETB}`)).toBe("47");
  });
  it("wraps at 8 bits", () => {
    // 0xff + STX (0x02) = 0x101, keeping the low byte
    expect(astmChecksum("\u00ff" + STX)).toBe("01");
  });
  it("pads a single hex digit and reports an empty payload as zero", () => {
    expect(astmChecksum("\u0001")).toBe("01");
    expect(astmChecksum("")).toBe("00");
  });
});

describe("describeControlChars", () => {
  it("names the ASTM control characters", () => {
    expect(describeControlChars(`${STX}1H${ETX}A5${CR}${LF}`)).toBe("<STX>1H<ETX>A5<CR><LF>");
    expect(describeControlChars(`${ENQ}${ACK}${EOT}`)).toBe("<ENQ><ACK><EOT>");
  });
  it("falls back to hex for other control bytes", () => {
    expect(describeControlChars("\u0000\u001b")).toBe("<0x00><0x1B>");
  });
  it("leaves printable text untouched", () => {
    expect(describeControlChars("H|\\^&")).toBe("H|\\^&");
  });
});

describe("frameRecords", () => {
  it("frames one record per frame, numbered from 1", () => {
    const frames = frameRecords(["H|\\^&", "L|1|N"]);
    expect(frames.map((f) => f.frameNumber)).toEqual([1, 2]);
    expect(frames.every((f) => f.final)).toBe(true);
    expect(frames[0].raw.startsWith(STX)).toBe(true);
    expect(frames[0].raw.endsWith(`${CR}${LF}`)).toBe(true);
  });
  it("puts a CR after the record inside the frame text", () => {
    expect(frameRecords(["L|1|N"])[0].text).toBe(`L|1|N${CR}`);
  });
  it("writes a checksum that matches the framed payload", () => {
    const [frame] = frameRecords(["L|1|N"]);
    expect(frame.checksum).toBe(astmChecksum(`${frame.frameNumber}${frame.text}${ETX}`));
  });
  it("splits a long record into ETB-terminated intermediate frames", () => {
    const frames = frameRecords(["X".repeat(500)]);
    expect(frames).toHaveLength(3); // 500 chars + CR over 240-char frames
    expect(frames.map((f) => f.final)).toEqual([false, false, true]);
    expect(frames[0].raw).toContain(ETB);
    expect(frames[2].raw).toContain(ETX);
  });
  it("cycles frame numbers 1-7 then 0", () => {
    const frames = frameRecords(Array.from({ length: 10 }, (_, i) => `C|${i + 1}`));
    expect(frames.map((f) => f.frameNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 0, 1, 2]);
  });
  it("honours a custom frame size and start number", () => {
    const frames = frameRecords(["ABCDEF"], { maxTextLength: 3, startFrame: 6 });
    expect(frames.map((f) => f.frameNumber)).toEqual([6, 7, 0]);
    expect(frames.map((f) => f.text)).toEqual(["ABC", "DEF", CR]);
  });
});

describe("parseFrames", () => {
  it("reads back frames it produced and verifies the checksums", () => {
    const wire = frameMessage(SAMPLE).map((f) => f.raw).join("");
    const frames = parseFrames(wire);
    expect(frames).toHaveLength(6);
    expect(frames.every((f) => f.valid)).toBe(true);
    expect(frames.map((f) => f.frameNumber)).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it("reports a checksum mismatch with both values", () => {
    const [frame] = parseFrames(`${STX}1L|1|N${CR}${ETX}00${CR}${LF}`);
    expect(frame.valid).toBe(false);
    expect(frame.problems[0]).toMatch(/frame says 00, payload computes to [0-9A-F]{2}/);
  });
  it("reports a truncated checksum", () => {
    const [frame] = parseFrames(`${STX}1A${ETX}${CR}${LF}`);
    expect(frame.problems).toContain("Checksum is missing or truncated.");
  });
  it("reports a frame number that is not 0-7", () => {
    const [frame] = parseFrames(`${STX}9A${ETX}AB${CR}${LF}`);
    expect(frame.frameNumber).toBeNull();
    expect(frame.problems[0]).toContain("is not a digit 0–7");
  });
  it("ignores handshake bytes and surrounding noise", () => {
    const wire = `${ENQ}${ACK}${frameRecords(["L|1|N"])[0].raw}${EOT}\nlog line\n`;
    expect(parseFrames(wire)).toHaveLength(1);
  });
  it("marks ETB frames as non-final", () => {
    const frames = parseFrames(frameRecords(["Y".repeat(300)]).map((f) => f.raw).join(""));
    expect(frames.map((f) => f.final)).toEqual([false, true]);
  });
});

describe("unframe", () => {
  it("round-trips a message through framing", () => {
    expect(unframe(frameMessage(SAMPLE).map((f) => f.raw).join(""))).toBe(SAMPLE.replace(/\r\n/g, "\n"));
  });
  it("rejoins a record split across frames", () => {
    const record = `R|1|^^^A|${"9".repeat(300)}`;
    expect(unframe(frameRecords([record]).map((f) => f.raw).join(""))).toBe(record);
  });
  it("returns nothing for input with no frames", () => {
    expect(unframe("H|\\^&\nL|1|N")).toBe("");
  });
});

describe("checkFrameSequence", () => {
  it("accepts frames that advance by one and wrap 7 to 0", () => {
    const frames = parseFrames(frameRecords(Array.from({ length: 9 }, (_, i) => `C|${i + 1}`)).map((f) => f.raw).join(""));
    expect(checkFrameSequence(frames)).toEqual([]);
  });
  it("reports a skipped frame number", () => {
    const a = frameRecords(["C|1"])[0].raw;
    const c = frameRecords(["C|3"], { startFrame: 3 })[0].raw;
    const problems = checkFrameSequence(parseFrames(a + c));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("expected frame number 2, got 3");
  });
});

describe("buildSession", () => {
  it("brackets the frames with the establishment and termination handshake", () => {
    const steps = buildSession("H|\\^&\rL|1|N");
    expect(steps[0].bytes).toBe("<ENQ>");
    expect(steps[1].bytes).toBe("<ACK>");
    expect(steps[steps.length - 1].bytes).toBe("<EOT>");
    // ENQ, ACK, (frame, ACK) x 2, EOT
    expect(steps).toHaveLength(7);
  });
  it("labels each frame with its number and checksum, and acknowledges it", () => {
    const steps = buildSession("L|1|N");
    expect(steps[2].label).toMatch(/^Frame 1 — checksum [0-9A-F]{2}$/);
    expect(steps[3].direction).toBe("reply");
  });
  it("marks continuation frames", () => {
    const steps = buildSession(`R|1|^^^A|${"8".repeat(300)}`);
    expect(steps[2].label).toContain("(continues)");
  });
});

describe("astmToHl7", () => {
  it("maps H to MSH with sender, receiver and an ORU^R01 type", () => {
    const [msh] = astmToHl7(SAMPLE).split("\n");
    const fields = msh.split("|");
    expect(fields[0]).toBe("MSH");
    expect(fields[2]).toBe("Sysmex");
    expect(fields[4]).toBe("LIS");
    expect(fields[8]).toBe("ORU^R01");
    expect(fields[11]).toBe("2.5");
  });
  it("maps P to PID, O to OBR, R to OBX and C to NTE", () => {
    expect(astmToHl7(SAMPLE).split("\n").map((s) => s.slice(0, 3)))
      .toEqual(["MSH", "PID", "OBR", "OBX", "NTE"]);
  });
  it("carries the patient identifier, name, birth date and sex", () => {
    const pid = astmToHl7(SAMPLE).split("\n")[1].split("|");
    expect(pid[3]).toBe("PID123");
    expect(pid[5]).toBe("DOE^JOHN");
    expect(pid[7]).toBe("19800101");
    expect(pid[8]).toBe("M");
  });
  it("carries the test id, value, units, range, flag and status into OBX", () => {
    const obx = astmToHl7(SAMPLE).split("\n")[3].split("|");
    expect(obx[2]).toBe("NM");
    expect(obx[3]).toBe("WBC^White Blood Cell");
    expect(obx[5]).toBe("7.2");
    expect(obx[6]).toBe("10*3/uL");
    expect(obx[7]).toBe("4.0-11.0");
    expect(obx[8]).toBe("N");
    expect(obx[11]).toBe("F");
  });
  it("types non-numeric results as ST", () => {
    const raw = "H|\\^&\rP|1\rO|1|S1\rR|1|^^^CULT^Culture|No growth|||N||F\rL|1|N";
    expect(astmToHl7(raw).split("\n")[3].split("|")[2]).toBe("ST");
  });
  it("numbers PID, OBR and OBX and restarts OBX per order", () => {
    const raw = [
      "H|\\^&", "P|1", "O|1|S1", "R|1|^^^A|1", "R|2|^^^B|2",
      "O|2|S2", "R|1|^^^C|3", "L|1|N",
    ].join("\r");
    const lines = astmToHl7(raw).split("\n");
    expect(lines.map((l) => l.split("|").slice(0, 2).join("|"))).toEqual([
      "MSH|^~\\&", "PID|1", "OBR|1", "OBX|1", "OBX|2", "OBR|2", "OBX|1",
    ]);
  });
  it("drops timestamps it cannot vouch for rather than passing junk through", () => {
    const raw = "H|\\^&|||S|||||LIS||P|1|01-01-2024\rP|1\rL|1|N";
    expect(astmToHl7(raw).split("\n")[0].split("|")[6]).toBe("");
  });
});

describe("diffAstm", () => {
  it("reports changed, added and removed fields by path", () => {
    const left = "H|\\^&\rP|1\rO|1|S1\rR|1|^^^A|1|mmol\rL|1|N";
    const right = "H|\\^&\rP|1\rO|1|S1\rR|1|^^^A|2\rL|1|N";
    const diff = diffAstm(left, right);
    expect(diff).toEqual(expect.arrayContaining([
      { path: "R[1]-4", kind: "changed", left: "1", right: "2" },
      { path: "R[1]-5", kind: "removed", left: "mmol" },
    ]));
  });
  it("returns nothing for identical messages", () => {
    expect(diffAstm(SAMPLE, SAMPLE)).toEqual([]);
  });
  it("sees a record added on the right", () => {
    const left = "H|\\^&\rP|1\rO|1|S1\rR|1|^^^A|1\rL|1|N";
    const right = "H|\\^&\rP|1\rO|1|S1\rR|1|^^^A|1\rR|2|^^^B|2\rL|1|N";
    expect(diffAstm(left, right).some((d) => d.path === "R[2]-4" && d.kind === "added")).toBe(true);
  });
});
