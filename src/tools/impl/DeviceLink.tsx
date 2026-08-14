import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Plug, PlugZap, Radio, Send, Play, Square, RefreshCw, Trash2, Download, CircleDot,
} from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/CopyButton";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { invokeNative, isTauri } from "@/lib/platform";
import {
  mllpReader, mllpFeed, mllpPreview, textToWire, wireToText,
  astmLink, astmSend, astmFeed, astmTimeout, astmProgress,
  transcriptText,
  type MllpReader, type AstmLink,
} from "@/tools/lib/deviceLink";
import { MLLP_START, MLLP_END, buildAck, validateHl7Structure, ACK_CODES, type AckCode } from "@/tools/lib/hl7Advanced";
import { astmToHl7, describeControlChars } from "@/tools/lib/astmAdvanced";

/**
 * Device Link — the live end of a medical interface.
 *
 * The HL7, FHIR and ASTM toolkits work on a message you already have. This one
 * is for the message you do not have yet: connect to an interface engine, or be
 * the engine, or open the serial port the analyser is wired to, and watch the
 * bytes.
 *
 * The protocols are not implemented here. Rust owns the socket
 * (`commands/devicelink.rs`) and `tools/lib/deviceLink.ts` owns the
 * conversation as a pure state machine; this screen is the wiring between them
 * plus somewhere to look. That is why the fiddly parts — partial reads, NAK
 * retries, frame numbering — are covered by unit tests rather than by clicking.
 *
 * Developer/integration utility only, NOT clinical software.
 */

type Tab = "mllp" | "listen" | "serial";
type LinkMode = "mllp" | "astm";

interface OpenLink {
  id: string;
  kind: "tcp" | "listener" | "serial";
  mode: LinkMode;
  label: string;
  /** Listener that accepted this connection, when it was not opened by us. */
  parent?: string;
}

interface LinkEventPayload {
  id: string;
  kind: "open" | "accept" | "data" | "close" | "error";
  data: string;
  size: number;
  parent?: string | null;
  peer?: string | null;
}

interface Entry {
  key: number;
  at: number;
  linkId: string;
  direction: "tx" | "rx" | "info" | "error";
  text: string;
  /** Decoded message, when this entry completed one. */
  message?: string;
  note?: string;
}

interface SerialPort {
  name: string;
  kind: string;
  product?: string | null;
}

/** Older entries are dropped past this, so a chatty analyser cannot exhaust memory. */
const ENTRY_LIMIT = 800;

/** E1381 gives each side 15 seconds; past that the link is not coming back on its own. */
const ASTM_TIMEOUT_MS = 15_000;

const SAMPLE_HL7 = [
  "MSH|^~\\&|LIS|LAB|EMR|HOSP|20260814093000||ORU^R01|MSG0001|P|2.5",
  "PID|1||100234^^^HOSP^MR||PATEL^ANJALI||19880412|F",
  "OBR|1|ORD9001|ACC55012|CBC^Complete Blood Count^L|||20260814092000",
  "OBX|1|NM|HGB^Haemoglobin^L||13.2|g/dL|12.0-15.5|N|||F",
].join("\r");

const SAMPLE_ASTM = [
  "H|\\^&|||Analyser^1.0|||||LIS||P|1|20260814093000",
  "P|1||100234||PATEL^ANJALI||19880412|F",
  "O|1|ACC55012||^^^CBC|R||20260814092000",
  "R|1|^^^HGB|13.2|g/dL|12.0-15.5|N||F",
  "L|1|N",
].join("\n");

export function DeviceLink() {
  const [tab, setTab] = useState<Tab>("mllp");
  const [links, setLinks] = useState<OpenLink[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  // MLLP client
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState("2575");
  const [outbound, setOutbound] = useState(SAMPLE_HL7);
  const [encoding, setEncoding] = useState<"utf-8" | "latin-1">("utf-8");

  // Listener
  const [listenPort, setListenPort] = useState("2575");
  const [autoAck, setAutoAck] = useState(true);
  const [ackCode, setAckCode] = useState<AckCode>("AA");

  // Serial
  const [ports, setPorts] = useState<SerialPort[]>([]);
  const [serialPath, setSerialPath] = useState("");
  const [baud, setBaud] = useState("9600");
  const [dataBits, setDataBits] = useState("8");
  const [parity, setParity] = useState("none");
  const [stopBits, setStopBits] = useState("1");
  const [astmRecords, setAstmRecords] = useState(SAMPLE_ASTM);

  // Protocol state per link. Refs, not state: an event handler must see the
  // current buffer, and a re-render must not rewind a half-read message.
  const readers = useRef(new Map<string, MllpReader>());
  const astm = useRef(new Map<string, AstmLink>());
  const lastActivity = useRef(new Map<string, number>());
  const modes = useRef(new Map<string, LinkMode>());
  const started = useRef(Date.now());
  const counter = useRef(0);
  // Settings the event handler reads. It is registered once, so it would
  // otherwise close over whatever these were when the screen first mounted.
  const settings = useRef({ autoAck, ackCode, encoding });
  settings.current = { autoAck, ackCode, encoding };

  const native = isTauri();

  const push = useCallback((entry: Omit<Entry, "key" | "at">) => {
    setEntries((list) => {
      const next = [...list, { ...entry, key: counter.current++, at: Date.now() - started.current }];
      return next.length > ENTRY_LIMIT ? next.slice(next.length - ENTRY_LIMIT) : next;
    });
  }, []);

  const send = useCallback(async (id: string, wire: string, note?: string) => {
    await invokeNative<number>("link_send", { id, data: wire });
    push({ linkId: id, direction: "tx", text: describeControlChars(wire), note });
  }, [push]);

  /* ------------------------------------------------------- inbound bytes ---- */

  const handleData = useCallback(async (id: string, data: string) => {
    lastActivity.current.set(id, Date.now());
    const mode = modes.current.get(id) ?? "mllp";

    if (mode === "mllp") {
      const state = readers.current.get(id) ?? mllpReader();
      const result = mllpFeed(state, data);
      readers.current.set(id, result.reader);
      for (const note of result.notes) push({ linkId: id, direction: "error", text: note });

      for (const raw of result.messages) {
        const text = wireToText(raw, settings.current.encoding);
        const issues = validateHl7Structure(text).filter((i) => i.severity === "error");
        push({
          linkId: id,
          direction: "rx",
          text: `Message (${raw.length} bytes)`,
          message: text,
          note: issues.length ? issues[0].message : undefined,
        });

        // An ACK is a reply to us, not something to acknowledge again.
        const isAck = /\|ACK[\^|]/.test(text) || /\rMSA\|/.test(text);
        if (settings.current.autoAck && !isAck) {
          const ack = buildAck(text, settings.current.ackCode);
          await send(id, `${MLLP_START}${textToWire(ack, settings.current.encoding)}${MLLP_END}`, `ACK ${settings.current.ackCode}`);
        }
      }
      return;
    }

    const link = astm.current.get(id) ?? astmLink();
    const before = link.records.length;
    const step = astmFeed(link, data, Date.now() - started.current);
    astm.current.set(id, step.link);
    push({ linkId: id, direction: "rx", text: describeControlChars(data) });
    if (step.send) await send(id, step.send);
    if (step.link.records.length > before) {
      push({
        linkId: id,
        direction: "info",
        text: `Records received: ${step.link.records.length}`,
        message: step.link.records.join("\n"),
      });
    }
    if (step.link.error) push({ linkId: id, direction: "error", text: step.link.error });
  }, [push, send]);

  /* ------------------------------------------------------------- events ---- */

  useEffect(() => {
    if (!native) return;
    let stop: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const unlisten = await listen<LinkEventPayload>("devicelink://event", (event) => {
        const p = event.payload;
        switch (p.kind) {
          case "accept": {
            // An accepted connection inherits the listener's protocol.
            const mode = modes.current.get(p.parent ?? "") ?? "mllp";
            modes.current.set(p.id, mode);
            lastActivity.current.set(p.id, Date.now());
            setLinks((list) => [...list, { id: p.id, kind: "tcp", mode, label: p.peer ?? "peer", parent: p.parent ?? undefined }]);
            setSelected((current) => current ?? p.id);
            push({ linkId: p.id, direction: "info", text: p.data });
            break;
          }
          case "data":
            void handleData(p.id, p.data);
            break;
          case "close":
            push({ linkId: p.id, direction: "info", text: p.data });
            setLinks((list) => list.filter((l) => l.id !== p.id));
            break;
          case "error":
            push({ linkId: p.id, direction: "error", text: p.data });
            break;
          case "open":
            push({ linkId: p.id, direction: "info", text: p.data });
            break;
        }
      });
      if (cancelled) unlisten();
      else stop = unlisten;
    })();

    return () => { cancelled = true; stop?.(); };
  }, [native, handleData, push]);

  /**
   * Adopt links that were already open.
   *
   * The sockets live in Rust, so they survive a reload of this screen — and an
   * open port you cannot see is one you cannot close. A serial port is assumed
   * to be speaking ASTM and a TCP link MLLP, which is what opened them here.
   */
  useEffect(() => {
    if (!native) return;
    (async () => {
      try {
        const existing = await invokeNative<{ id: string; kind: OpenLink["kind"]; label: string }[]>("link_list");
        if (!existing.length) return;
        const adopted = existing.map((l) => ({ ...l, mode: (l.kind === "serial" ? "astm" : "mllp") as LinkMode }));
        for (const l of adopted) {
          modes.current.set(l.id, l.mode);
          lastActivity.current.set(l.id, Date.now());
          if (l.mode === "astm") astm.current.set(l.id, astmLink());
        }
        setLinks(adopted);
        push({ linkId: adopted[0].id, direction: "info", text: `Adopted ${adopted.length} link(s) still open from before` });
      } catch {
        // Nothing open, or the command is unavailable — neither is worth a toast.
      }
    })();
  }, [native, push]);

  /** ASTM inactivity. A link that stops mid-transfer has to end, not hang. */
  useEffect(() => {
    const timer = setInterval(() => {
      for (const [id, link] of astm.current) {
        if (link.phase !== "sending" && link.phase !== "receiving" && link.phase !== "awaitingLine") continue;
        const idle = Date.now() - (lastActivity.current.get(id) ?? Date.now());
        if (idle < ASTM_TIMEOUT_MS) continue;
        const step = astmTimeout(link, Date.now() - started.current);
        astm.current.set(id, step.link);
        lastActivity.current.set(id, Date.now());
        push({ linkId: id, direction: "error", text: step.link.error ?? "Timed out" });
        if (step.send) void send(id, step.send);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [push, send]);

  /* ------------------------------------------------------------ actions ---- */

  const remember = (link: OpenLink) => {
    modes.current.set(link.id, link.mode);
    lastActivity.current.set(link.id, Date.now());
    setLinks((list) => [...list, link]);
    setSelected(link.id);
  };

  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));

  const connect = async () => {
    try {
      const id = await invokeNative<string>("link_tcp_connect", { host, port: Number(port) });
      remember({ id, kind: "tcp", mode: "mllp", label: `${host}:${port}` });
    } catch (e) { fail(e); }
  };

  const listenTcp = async () => {
    try {
      const id = await invokeNative<string>("link_tcp_listen", { port: Number(listenPort) });
      remember({ id, kind: "listener", mode: "mllp", label: `listening :${listenPort}` });
    } catch (e) { fail(e); }
  };

  const refreshPorts = async () => {
    try {
      const found = await invokeNative<SerialPort[]>("link_serial_ports");
      setPorts(found);
      if (!serialPath && found[0]) setSerialPath(found[0].name);
      if (!found.length) toast.error("No serial ports found");
    } catch (e) { fail(e); }
  };

  const openSerial = async () => {
    try {
      const id = await invokeNative<string>("link_serial_open", {
        settings: {
          path: serialPath,
          baud: Number(baud),
          dataBits: Number(dataBits),
          parity,
          stopBits: Number(stopBits),
        },
      });
      astm.current.set(id, astmLink());
      remember({ id, kind: "serial", mode: "astm", label: `${serialPath} @ ${baud}` });
    } catch (e) { fail(e); }
  };

  const close = async (id: string) => {
    try {
      await invokeNative<boolean>("link_close", { id });
      setLinks((list) => list.filter((l) => l.id !== id));
      readers.current.delete(id);
      astm.current.delete(id);
      modes.current.delete(id);
      setSelected((current) => (current === id ? null : current));
    } catch (e) { fail(e); }
  };

  const sendMessage = async () => {
    const target = links.find((l) => l.id === selected && l.kind !== "listener");
    if (!target) return toast.error("Select an open connection first");
    try {
      await send(target.id, `${MLLP_START}${textToWire(outbound, encoding)}${MLLP_END}`, "Message");
    } catch (e) { fail(e); }
  };

  const sendAstm = async () => {
    const target = links.find((l) => l.id === selected && l.mode === "astm");
    if (!target) return toast.error("Open a serial port first");
    const records = astmRecords.split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
    const step = astmSend(astm.current.get(target.id) ?? astmLink(), records, Date.now() - started.current);
    astm.current.set(target.id, step.link);
    lastActivity.current.set(target.id, Date.now());
    if (!step.send) return toast.error("A transfer is already running on that port");
    try { await send(target.id, step.send, "Requesting the line"); } catch (e) { fail(e); }
  };

  /* ------------------------------------------------------------- render ---- */

  const shown = useMemo(
    () => (selected ? entries.filter((e) => e.linkId === selected) : entries),
    [entries, selected],
  );
  const selectedLink = links.find((l) => l.id === selected) ?? null;
  const selectedAstm = selected ? astm.current.get(selected) : undefined;
  const progress = selectedAstm ? astmProgress(selectedAstm) : null;

  const exportTranscript = () => {
    const text = transcriptText(shown.map((e) => ({
      at: e.at,
      direction: e.direction === "tx" ? "tx" as const : "rx" as const,
      bytes: e.text,
      note: e.note,
    })));
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `device-link-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <ToolShell
      toolId="device-link"
      title="Device Link"
      description="Talk to an analyser or interface engine — MLLP over TCP, ASTM E1381 over serial. Developer utility, not clinical software"
      requiresNative
      actions={
        <>
          <Button variant="ghost" size="icon" title="Export the transcript" onClick={exportTranscript} disabled={!shown.length}>
            <Download />
          </Button>
          <Button variant="ghost" size="icon" title="Clear the transcript" onClick={() => setEntries([])} disabled={!entries.length}>
            <Trash2 />
          </Button>
        </>
      }
    >
      {!native && (
        <div className="mb-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          Device Link needs the desktop app — a browser cannot open a TCP connection or a serial port.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[320px_1fr]">
        {/* --------------------------------------------------------- left ---- */}
        <div className="flex flex-col gap-3">
          <div className="flex rounded-md border border-border p-0.5 text-xs">
            {([["mllp", "MLLP client", Plug], ["listen", "Listener", Radio], ["serial", "Serial ASTM", PlugZap]] as const).map(
              ([key, label, Icon]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  aria-pressed={tab === key}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1 rounded px-2 py-1.5 text-muted-foreground",
                    tab === key && "bg-secondary text-foreground",
                  )}
                >
                  <Icon className="size-3.5" /> {label}
                </button>
              ),
            )}
          </div>

          {tab === "mllp" && (
            <Panel title="Connect to an interface engine">
              <div className="flex gap-2">
                <Input className="h-8 flex-1 text-xs" value={host} onChange={(e) => setHost(e.target.value)} placeholder="host" />
                <Input className="h-8 w-20 text-xs" value={port} onChange={(e) => setPort(e.target.value)} placeholder="port" />
              </div>
              <Button size="sm" className="w-full" onClick={connect} disabled={!native}><Plug /> Connect</Button>
              <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                Encoding
                <select
                  aria-label="Encoding"
                  className="h-7 flex-1 rounded-md border border-input bg-transparent px-1 text-xs"
                  value={encoding}
                  onChange={(e) => setEncoding(e.target.value as "utf-8" | "latin-1")}
                >
                  <option value="utf-8">UTF-8 (MSH-18 UNICODE UTF-8)</option>
                  <option value="latin-1">Latin-1 / 8859-1</option>
                </select>
              </label>
            </Panel>
          )}

          {tab === "listen" && (
            <Panel title="Be the interface engine">
              <div className="flex gap-2">
                <Input className="h-8 flex-1 text-xs" value={listenPort} onChange={(e) => setListenPort(e.target.value)} placeholder="port" />
                <Button size="sm" onClick={listenTcp} disabled={!native}><Play /> Listen</Button>
              </div>
              <label className="flex items-center gap-2 text-[11px]">
                <input type="checkbox" checked={autoAck} onChange={(e) => setAutoAck(e.target.checked)} className="size-3.5 accent-primary" />
                Reply with an ACK automatically
              </label>
              <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                ACK code
                <select
                  aria-label="ACK code"
                  className="h-7 flex-1 rounded-md border border-input bg-transparent px-1 text-xs"
                  value={ackCode}
                  onChange={(e) => setAckCode(e.target.value as AckCode)}
                  disabled={!autoAck}
                >
                  {ACK_CODES.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}
                </select>
              </label>
              <p className="text-[11px] text-muted-foreground">
                Sending AE or AR is how you find out whether the other side actually handles a rejection.
              </p>
            </Panel>
          )}

          {tab === "serial" && (
            <Panel title="Open the analyser's port">
              <div className="flex gap-2">
                <select
                  aria-label="Serial port"
                  className="h-8 flex-1 rounded-md border border-input bg-transparent px-1 text-xs"
                  value={serialPath}
                  onChange={(e) => setSerialPath(e.target.value)}
                >
                  {!ports.length && <option value="">No ports listed</option>}
                  {ports.map((p) => (
                    <option key={p.name} value={p.name}>{p.name}{p.product ? ` — ${p.product}` : ""}</option>
                  ))}
                </select>
                <Button size="sm" variant="ghost" title="List serial ports" onClick={refreshPorts} disabled={!native}>
                  <RefreshCw />
                </Button>
              </div>
              <div className="grid grid-cols-4 gap-1">
                <Field label="Baud"><Input className="h-7 text-xs" value={baud} onChange={(e) => setBaud(e.target.value)} /></Field>
                <Field label="Data">
                  <select className="h-7 w-full rounded-md border border-input bg-transparent text-xs" value={dataBits} onChange={(e) => setDataBits(e.target.value)}>
                    {["8", "7", "6", "5"].map((v) => <option key={v}>{v}</option>)}
                  </select>
                </Field>
                <Field label="Parity">
                  <select className="h-7 w-full rounded-md border border-input bg-transparent text-xs" value={parity} onChange={(e) => setParity(e.target.value)}>
                    {["none", "even", "odd"].map((v) => <option key={v}>{v}</option>)}
                  </select>
                </Field>
                <Field label="Stop">
                  <select className="h-7 w-full rounded-md border border-input bg-transparent text-xs" value={stopBits} onChange={(e) => setStopBits(e.target.value)}>
                    {["1", "2"].map((v) => <option key={v}>{v}</option>)}
                  </select>
                </Field>
              </div>
              <Button size="sm" className="w-full" onClick={openSerial} disabled={!native || !serialPath}><PlugZap /> Open port</Button>
              <p className="text-[11px] text-muted-foreground">
                7 data bits with even parity is still common on lab analysers; 8-N-1 is the usual default everywhere else.
              </p>
            </Panel>
          )}

          <Panel title={`Open links (${links.length})`}>
            {!links.length && <p className="text-xs text-muted-foreground">Nothing open.</p>}
            {links.map((l) => (
              <div
                key={l.id}
                className={cn(
                  "flex items-center gap-2 rounded border border-border px-2 py-1",
                  selected === l.id && "border-primary/50 bg-primary/10",
                )}
              >
                <CircleDot className={cn("size-3 shrink-0", l.kind === "listener" ? "text-warning" : "text-success")} />
                <button className="min-w-0 flex-1 text-left" onClick={() => setSelected(l.id)}>
                  <div className="truncate text-xs">{l.label}</div>
                  <div className="text-[10px] text-muted-foreground">{l.kind} · {l.mode.toUpperCase()}{l.parent ? " · accepted" : ""}</div>
                </button>
                <button title="Close" onClick={() => close(l.id)}><Square className="size-3 text-muted-foreground hover:text-destructive" /></button>
              </div>
            ))}
          </Panel>
        </div>

        {/* -------------------------------------------------------- right ---- */}
        <div className="flex flex-col gap-3">
          {tab !== "serial" ? (
            <Panel
              title="Message to send"
              action={<span className="text-[10px] text-muted-foreground">{outbound.length} chars · {textToWire(outbound, encoding).length} bytes</span>}
            >
              <Textarea
                mono
                className="h-40 text-xs"
                value={outbound}
                onChange={(e) => setOutbound(e.target.value.replace(/\n/g, "\r"))}
                placeholder="MSH|^~\&|…"
              />
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={sendMessage} disabled={!native || !selectedLink || selectedLink.kind === "listener"}>
                  <Send /> Send framed
                </Button>
                <CopyButton value={outbound} />
                <span className="mono truncate text-[10px] text-muted-foreground">{mllpPreview(outbound.slice(0, 40))}…</span>
              </div>
            </Panel>
          ) : (
            <Panel
              title="Records to send"
              action={progress?.total ? <span className="text-[10px] text-muted-foreground">{progress.sent}/{progress.total} frames</span> : undefined}
            >
              <Textarea mono className="h-40 text-xs" value={astmRecords} onChange={(e) => setAstmRecords(e.target.value)} placeholder="H|\^&|…" />
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={sendAstm} disabled={!native || selectedLink?.mode !== "astm"}><Send /> Send (ENQ first)</Button>
                <CopyButton value={astmRecords} />
                {selectedAstm && <Badge variant="secondary" className="text-[10px]">{selectedAstm.phase}</Badge>}
              </div>
            </Panel>
          )}

          <Panel
            title={`Transcript (${shown.length})`}
            action={selected && <button className="text-[10px] text-muted-foreground hover:text-foreground" onClick={() => setSelected(null)}>show all links</button>}
          >
            <div className="h-[calc(100vh-520px)] min-h-56 overflow-auto rounded border border-border">
              {!shown.length && <p className="p-3 text-xs text-muted-foreground">Nothing yet. Connect, listen, or open a port.</p>}
              {shown.map((e) => (
                <div key={e.key} className="border-b border-border/50 px-2 py-1 last:border-0">
                  <div className="flex items-start gap-2">
                    <span className="mono w-14 shrink-0 text-[10px] text-muted-foreground">{(e.at / 1000).toFixed(3)}s</span>
                    <span className={cn("w-4 shrink-0 text-xs", arrowClass(e.direction))}>{arrow(e.direction)}</span>
                    <span className={cn("mono min-w-0 flex-1 break-all text-[11px]", e.direction === "error" && "text-destructive")}>
                      {e.text}
                    </span>
                  </div>
                  {e.note && <div className="pl-20 text-[10px] text-warning">{e.note}</div>}
                  {e.message && (
                    <div className="group relative mt-1 pl-20">
                      <pre className="mono max-h-40 overflow-auto whitespace-pre-wrap rounded bg-secondary/40 p-2 text-[11px]">
                        {/* HL7 separates segments with CR, which renders as nothing at all. */}
                        {e.message.replace(/\r\n?/g, "\n")}
                      </pre>
                      <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <CopyButton value={e.message} />
                        {e.message.startsWith("H|") && (
                          <Button size="sm" variant="ghost" className="h-6 px-1 text-[10px]" onClick={() => setOutbound(astmToHl7(e.message!))}>
                            as HL7
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </ToolShell>
  );
}

const arrow = (d: Entry["direction"]) => (d === "tx" ? "→" : d === "rx" ? "←" : d === "error" ? "!" : "·");
const arrowClass = (d: Entry["direction"]) =>
  d === "tx" ? "text-primary" : d === "rx" ? "text-success" : d === "error" ? "text-destructive" : "text-muted-foreground";

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border p-2">
      <div className="mb-1.5 flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{title}</div>
        {action}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block">
    <span className="mb-0.5 block text-[10px] text-muted-foreground">{label}</span>
    {children}
  </label>
);
