import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { DeviceLink } from "./DeviceLink";
import { MLLP_START, MLLP_END } from "@/tools/lib/hl7Advanced";
import { ENQ, ACK, STX, ETX, CR, LF, astmChecksum } from "@/tools/lib/astmAdvanced";

/**
 * The screen with the socket taken out.
 *
 * `deviceLink.ts` proves the protocols and `devicelink.rs` moves the bytes;
 * what neither can prove is that this screen joins them up — that an inbound
 * event reaches the right state machine, that its reply goes back out on the
 * right link, and that an ACK is not itself acknowledged. So the native layer
 * is replaced by a fake that records what was sent, and the conversation is
 * driven event by event.
 */

const sent: { id: string; data: string }[] = [];
let listener: ((event: { payload: unknown }) => void) | null = null;
const invoked: { command: string; args?: Record<string, unknown> }[] = [];

vi.mock("@/lib/platform", () => ({
  isTauri: () => true,
  NativeUnavailableError: class extends Error {},
  invokeNative: vi.fn(async (command: string, args?: Record<string, unknown>) => {
    invoked.push({ command, args });
    switch (command) {
      case "link_tcp_connect": return "conn-1";
      case "link_tcp_listen": return "listener-1";
      case "link_serial_open": return "serial-1";
      case "link_serial_ports": return [{ name: "COM3", kind: "usb", product: "USB Serial" }];
      case "link_send":
        sent.push({ id: String(args?.id), data: String(args?.data) });
        return String(args?.data).length;
      case "link_close": return true;
      default: return null;
    }
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name: string, handler: (event: { payload: unknown }) => void) => {
    listener = handler;
    return () => { listener = null; };
  }),
}));

/** Push one native event and let React settle. */
async function emit(payload: Record<string, unknown>) {
  await act(async () => {
    listener?.({ payload });
    await Promise.resolve();
  });
}

const framed = (message: string) => `${MLLP_START}${message}${MLLP_END}`;

const ORU = [
  "MSH|^~\\&|ANALYSER|LAB|LIS|HOSP|20260814093000||ORU^R01|MSG77|P|2.5",
  "PID|1||100234^^^HOSP^MR||PATEL^ANJALI||19880412|F",
  "OBR|1|ORD1|ACC1|CBC^Complete Blood Count^L",
  "OBX|1|NM|HGB^Haemoglobin^L||13.2|g/dL|12.0-15.5|N|||F",
].join("\r");

describe("DeviceLink", () => {
  beforeEach(async () => {
    sent.length = 0;
    invoked.length = 0;
    listener = null;
    render(<DeviceLink />);
    await waitFor(() => expect(listener).not.toBeNull());
  });

  const connect = async () => {
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(invoked.some((i) => i.command === "link_tcp_connect")).toBe(true));
  };

  it("frames an outbound message with <VT> and <FS><CR>", async () => {
    await connect();
    fireEvent.click(screen.getByRole("button", { name: /Send framed/ }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].id).toBe("conn-1");
    expect(sent[0].data.startsWith(MLLP_START)).toBe(true);
    expect(sent[0].data.endsWith(MLLP_END)).toBe(true);
  });

  it("reassembles a message split across two reads before showing it", async () => {
    await connect();
    const whole = framed(ORU);
    await emit({ id: "conn-1", kind: "data", data: whole.slice(0, 30), size: 30 });
    expect(screen.queryByText(/Message \(/)).toBeNull();
    await emit({ id: "conn-1", kind: "data", data: whole.slice(30), size: whole.length - 30 });
    expect(await screen.findByText(/Message \(/)).toBeInTheDocument();
  });

  it("answers an inbound message with an ACK that echoes its control id", async () => {
    await connect();
    await emit({ id: "conn-1", kind: "data", data: framed(ORU), size: 1 });
    await waitFor(() => expect(sent.length).toBeGreaterThan(0));
    const ack = sent.at(-1)!.data;
    expect(ack.startsWith(MLLP_START)).toBe(true);
    expect(ack).toContain("MSA|AA|MSG77");
  });

  it("does not acknowledge an ACK, which would loop for ever", async () => {
    await connect();
    const incoming = "MSH|^~\\&|LIS|HOSP|ANALYSER|LAB|20260814093100||ACK^R01|A1|P|2.5\rMSA|AA|MSG77";
    await emit({ id: "conn-1", kind: "data", data: framed(incoming), size: 1 });
    await act(async () => { await Promise.resolve(); });
    expect(sent).toHaveLength(0);
  });

  it("sends the ACK code that was chosen, so a rejection can be tested", async () => {
    fireEvent.click(screen.getByRole("button", { name: "Listener" }));
    fireEvent.change(screen.getByRole("combobox", { name: "ACK code" }), { target: { value: "AR" } });
    fireEvent.click(screen.getByRole("button", { name: "Listen" }));
    await waitFor(() => expect(invoked.some((i) => i.command === "link_tcp_listen")).toBe(true));

    await emit({ id: "peer-1", kind: "accept", data: "Connection from 10.0.0.9:5100", size: 0, parent: "listener-1", peer: "10.0.0.9:5100" });
    await emit({ id: "peer-1", kind: "data", data: framed(ORU), size: 1 });
    await waitFor(() => expect(sent.length).toBeGreaterThan(0));
    expect(sent.at(-1)!.id).toBe("peer-1");
    expect(sent.at(-1)!.data).toContain("MSA|AR|MSG77");
  });

  it("replies on the accepted connection, never on the listener", async () => {
    fireEvent.click(screen.getByRole("button", { name: "Listener" }));
    fireEvent.click(screen.getByRole("button", { name: "Listen" }));
    await waitFor(() => expect(invoked.some((i) => i.command === "link_tcp_listen")).toBe(true));
    await emit({ id: "peer-2", kind: "accept", data: "Connection", size: 0, parent: "listener-1", peer: "10.0.0.9:5100" });
    await emit({ id: "peer-2", kind: "data", data: framed(ORU), size: 1 });
    await waitFor(() => expect(sent.length).toBeGreaterThan(0));
    expect(sent.every((s) => s.id !== "listener-1")).toBe(true);
  });

  it("reports a stream that is not MLLP instead of waiting for ever", async () => {
    await connect();
    await emit({ id: "conn-1", kind: "data", data: "GET / HTTP/1.1\r\n", size: 16 });
    expect(await screen.findByText(/no <VT> start block/)).toBeInTheDocument();
  });

  it("drops a link from the list when the peer closes it", async () => {
    await connect();
    expect(screen.getByText("127.0.0.1:2575")).toBeInTheDocument();
    await emit({ id: "conn-1", kind: "close", data: "The peer closed the connection", size: 0 });
    await waitFor(() => expect(screen.queryByText("127.0.0.1:2575")).toBeNull());
  });

  it("starts an ASTM transfer with ENQ and answers the analyser's frames", async () => {
    fireEvent.click(screen.getByRole("button", { name: "Serial ASTM" }));
    fireEvent.click(screen.getByRole("button", { name: /List serial ports/ }));
    await waitFor(() => expect(screen.getByRole("option", { name: /COM3/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Open port/ }));
    await waitFor(() => expect(invoked.some((i) => i.command === "link_serial_open")).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: /Send \(ENQ first\)/ }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].data).toBe(ENQ);

    // The analyser grants the line: the first frame must follow.
    await emit({ id: "serial-1", kind: "data", data: ACK, size: 1 });
    await waitFor(() => expect(sent.length).toBe(2));
    expect(sent[1].data.startsWith(STX)).toBe(true);
  });

  it("acknowledges a good frame from the analyser and recovers the record", async () => {
    fireEvent.click(screen.getByRole("button", { name: "Serial ASTM" }));
    fireEvent.click(screen.getByRole("button", { name: /List serial ports/ }));
    await waitFor(() => expect(screen.getByRole("option", { name: /COM3/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Open port/ }));
    await waitFor(() => expect(invoked.some((i) => i.command === "link_serial_open")).toBe(true));

    await emit({ id: "serial-1", kind: "data", data: ENQ, size: 1 });
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].data).toBe(ACK);

    const payload = `1R|1|^^^HGB|13.2|g/dL||N||F${CR}${ETX}`;
    const frame = `${STX}${payload}${astmChecksum(payload)}${CR}${LF}`;
    await emit({ id: "serial-1", kind: "data", data: frame, size: frame.length });
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1].data).toBe(ACK);
    expect(await screen.findByText(/Records received: 1/)).toBeInTheDocument();
  });
});
