import { useMemo, useState } from "react";
import { CheckCircle2, XCircle, TriangleAlert } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { CopyButton } from "@/components/CopyButton";
import { cn } from "@/lib/utils";
import {
  ABNORMAL_FLAGS,
  ACTION_CODES,
  PRIORITY_CODES,
  RESULT_STATUS_CODES,
  TERMINATION_CODES,
  astmTimestampToIso,
  astmToJson,
  describeCode,
  flattenAstm,
  formatAstm,
  parseAstm,
  validateAstm,
} from "@/tools/lib/astm";
import {
  astmToHl7,
  buildSession,
  checkFrameSequence,
  describeControlChars,
  diffAstm,
  frameMessage,
  parseFrames,
  unframe,
} from "@/tools/lib/astmAdvanced";

const SAMPLE = [
  "H|\\^&|||Sysmex^XN-1000|||||LIS||P|1|20240101120000",
  "P|1||PID123||DOE^JOHN||19800101|M",
  "O|1|SPEC001||^^^WBC^White Blood Cell|R||20240101090000",
  "R|1|^^^WBC^White Blood Cell|7.2|10*3/uL|4.0-11.0|N||F||OP1|20240101093000",
  "R|2|^^^HGB^Haemoglobin|9.1|g/dL|13.0-17.0|L||F||OP1|20240101093000",
  "C|1|I|Sample slightly haemolysed|G",
  "L|1|N",
].join("\n");

type View = "records" | "paths" | "validate" | "frames" | "session" | "hl7" | "diff" | "json";

/**
 * Which coded field gets spelled out, per record type and 1-based field index.
 * Only fields whose code sets are standardized are decoded — manufacturer-defined
 * fields are shown verbatim rather than guessed at.
 */
const CODE_TABLES: Record<string, Record<number, Record<string, string>>> = {
  O: { 6: PRIORITY_CODES, 12: ACTION_CODES },
  R: { 7: ABNORMAL_FLAGS, 9: RESULT_STATUS_CODES },
  L: { 3: TERMINATION_CODES },
};

const TIMESTAMP_FIELDS: Record<string, number[]> = {
  H: [14], P: [8], O: [7, 8, 15, 23], R: [12, 13],
};

export function AstmToolkit() {
  const [input, setInput] = useState(SAMPLE);
  const [view, setView] = useState<View>("records");
  const [capture, setCapture] = useState("");
  const [frameSize, setFrameSize] = useState(240);
  const [compareTo, setCompareTo] = useState("");

  const parsed = useMemo(() => {
    try {
      return { msg: parseAstm(input), error: "" };
    } catch (e) {
      return { msg: null, error: (e as Error).message };
    }
  }, [input]);

  const issues = useMemo(() => validateAstm(input), [input]);
  const errors = issues.filter((i) => i.severity === "error");

  const paths = useMemo(() => (parsed.msg ? flattenAstm(parsed.msg) : []), [parsed.msg]);

  const json = useMemo(() => {
    try {
      return astmToJson(input);
    } catch {
      return "";
    }
  }, [input]);

  const hl7 = useMemo(() => {
    try {
      return astmToHl7(input);
    } catch (e) {
      return `Cannot map to HL7: ${(e as Error).message}`;
    }
  }, [input]);

  const frames = useMemo(() => frameMessage(input, { maxTextLength: frameSize }), [input, frameSize]);
  const session = useMemo(() => buildSession(input, { maxTextLength: frameSize }), [input, frameSize]);

  const captured = useMemo(() => {
    if (!capture.trim()) return null;
    const parsedFrames = parseFrames(capture);
    return { frames: parsedFrames, sequence: checkFrameSequence(parsedFrames), records: unframe(capture) };
  }, [capture]);

  const differences = useMemo(() => {
    if (!compareTo.trim()) return [];
    try {
      return diffAstm(input, compareTo);
    } catch {
      return [];
    }
  }, [input, compareTo]);

  /** What the header Copy button offers, per tab. */
  const copyValue =
    view === "json" ? json
    : view === "hl7" ? hl7
    : view === "frames" ? frames.map((f) => describeControlChars(f.raw)).join("\n")
    : view === "session" ? session.map((s) => `${s.direction === "send" ? "→" : "←"} ${s.bytes}\t${s.label}`).join("\n")
    : view === "paths" ? paths.map((p) => `${p.path}\t${p.value}`).join("\n")
    : formatAstm(input);

  return (
    <ToolShell
      toolId="astm-toolkit"
      title="ASTM Toolkit"
      description="Parse ASTM E1394 lab messages and check E1381 framing. Local-only integration utility — not clinical software."
      actions={<CopyButton value={copyValue} label="Copy" />}
    >
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground">ASTM message</label>
            <Button size="sm" variant="ghost" className="ml-auto h-6" onClick={() => setInput(formatAstm(input))}>Format</Button>
            <Button size="sm" variant="ghost" className="h-6" onClick={() => setInput(SAMPLE)}>Sample</Button>
          </div>
          <Textarea mono className="h-[calc(100vh-360px)] min-h-64" value={input} onChange={(e) => setInput(e.target.value)} />
          {parsed.msg && (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
              <Badge>{parsed.msg.records.length} records</Badge>
              <span className="text-muted-foreground">
                {parsed.msg.sender || "?"} → {parsed.msg.receiver || "?"}
              </span>
              {issues.length === 0 ? (
                <Badge variant="success" className="ml-auto gap-1"><CheckCircle2 className="size-3" /> Valid</Badge>
              ) : (
                <Badge variant={errors.length ? "destructive" : "warning"} className="ml-auto gap-1">
                  {errors.length ? <XCircle className="size-3" /> : <TriangleAlert className="size-3" />}
                  {issues.length} issue{issues.length === 1 ? "" : "s"}
                </Badge>
              )}
            </div>
          )}
          {parsed.error && <p className="mt-1 text-xs text-destructive">{parsed.error}</p>}
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-1">
            <TabBtn active={view === "records"} onClick={() => setView("records")} label="Records" />
            <TabBtn active={view === "paths"} onClick={() => setView("paths")} label="Paths" />
            <TabBtn active={view === "validate"} onClick={() => setView("validate")} label={`Validate${issues.length ? ` (${issues.length})` : ""}`} />
            <TabBtn active={view === "frames"} onClick={() => setView("frames")} label="Frames" />
            <TabBtn active={view === "session"} onClick={() => setView("session")} label="Session" />
            <TabBtn active={view === "hl7"} onClick={() => setView("hl7")} label="HL7" />
            <TabBtn active={view === "diff"} onClick={() => setView("diff")} label="Diff" />
            <TabBtn active={view === "json"} onClick={() => setView("json")} label="JSON" />
          </div>
          <div className="h-[calc(100vh-360px)] min-h-64 overflow-auto rounded-md border border-border bg-muted/20 p-2">
            {view === "paths" ? (
              <div className="flex flex-col gap-2">
                <p className="text-[11px] text-muted-foreground">
                  Every populated field, addressed as RECORD[occurrence]-field.
                </p>
                <table className="w-full font-mono text-[12px]">
                  <tbody className="divide-y divide-border">
                    {paths.map((p) => (
                      <tr key={p.path}>
                        <td className="w-28 px-2 py-0.5 text-muted-foreground">{p.path}</td>
                        <td className="px-2 py-0.5 break-all">{p.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : view === "validate" ? (
              <div className="flex flex-col gap-1 p-1">
                {issues.length === 0 ? (
                  <p className="flex items-center gap-1.5 text-sm text-success">
                    <CheckCircle2 className="size-4" /> No structural problems found.
                  </p>
                ) : (
                  issues.map((issue, i) => (
                    <div key={i} className={cn("flex items-start gap-2 rounded border p-2 text-xs",
                      issue.severity === "error" ? "border-destructive/40 bg-destructive/10" : "border-warning/40 bg-warning/10")}>
                      <Badge variant={issue.severity === "error" ? "destructive" : "warning"} className="shrink-0 text-[10px]">
                        {issue.severity}
                      </Badge>
                      <span className="min-w-0 flex-1">{issue.message}</span>
                      {issue.location && <span className="shrink-0 font-mono text-muted-foreground">{issue.location}</span>}
                    </div>
                  ))
                )}
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Record ordering, hierarchy, sequence numbering, coded values and timestamps only. This is not a
                  conformance statement and says nothing about clinical correctness.
                </p>
              </div>
            ) : view === "frames" ? (
              <div className="flex flex-col gap-3">
                <div>
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-xs font-medium">Outbound</span>
                    <label className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      Max frame text
                      <Input
                        type="number"
                        className="h-7 w-20"
                        value={frameSize}
                        min={1}
                        max={240}
                        onChange={(e) => setFrameSize(Math.max(1, Math.min(240, Number(e.target.value) || 240)))}
                      />
                    </label>
                  </div>
                  <p className="mb-1 text-[11px] text-muted-foreground">
                    {"<STX>"} frame-number record {"<ETX>"} checksum {"<CR><LF>"}, one record per frame. Records over the
                    frame size are split and the earlier parts end with {"<ETB>"} instead. The checksum is the 8-bit sum
                    from the frame number through the terminator.
                  </p>
                  <table className="w-full font-mono text-[12px]">
                    <tbody className="divide-y divide-border">
                      {frames.map((f, i) => (
                        <tr key={i}>
                          <td className="w-8 px-2 py-0.5 text-muted-foreground">{f.frameNumber}</td>
                          <td className="w-10 px-2 py-0.5 text-muted-foreground">{f.checksum}</td>
                          <td className="px-2 py-0.5 break-all">{describeControlChars(f.raw)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div>
                  <span className="text-xs font-medium">Check a capture</span>
                  <p className="mb-1 text-[11px] text-muted-foreground">
                    Paste bytes captured from the link to verify each checksum and the frame numbering. Handshake bytes
                    and log noise around the frames are ignored.
                  </p>
                  <Textarea
                    mono
                    className="h-24 text-[12px]"
                    value={capture}
                    onChange={(e) => setCapture(e.target.value)}
                    placeholder="Paste raw framed bytes (control characters included)"
                  />
                  {captured && (
                    <div className="mt-2 flex flex-col gap-1">
                      {captured.frames.length === 0 && (
                        <p className="text-xs text-muted-foreground">No frames found — is STX present in the capture?</p>
                      )}
                      {captured.frames.map((f, i) => (
                        <div key={i} className="flex items-start gap-2 text-[12px]">
                          <Badge variant={f.valid ? "success" : "destructive"} className="shrink-0 text-[10px]">
                            {f.valid ? "ok" : "bad"}
                          </Badge>
                          <span className="shrink-0 font-mono text-muted-foreground">
                            #{f.frameNumber ?? "?"} {f.final ? "ETX" : "ETB"}
                          </span>
                          <span className="min-w-0 flex-1 break-all font-mono">
                            {f.problems.length > 0 ? f.problems.join(" ") : describeControlChars(f.text)}
                          </span>
                        </div>
                      ))}
                      {captured.sequence.map((p, i) => (
                        <p key={i} className="text-xs text-warning">• {p}</p>
                      ))}
                      {captured.records && (
                        <Button size="sm" variant="outline" className="mt-1 self-start" onClick={() => setInput(captured.records)}>
                          Load the {captured.records.split("\n").length} recovered record(s) into the editor
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : view === "session" ? (
              <div className="flex flex-col gap-2">
                <p className="text-[11px] text-muted-foreground">
                  The E1381 exchange a working link performs: {"<ENQ>"} to take the line, one {"<ACK>"} per accepted
                  frame, {"<EOT>"} to release it. A receiver that cannot use a frame answers {"<NAK>"} and the sender
                  retransmits it.
                </p>
                <table className="w-full font-mono text-[12px]">
                  <tbody className="divide-y divide-border">
                    {session.map((step, i) => (
                      <tr key={i}>
                        <td className={cn("w-6 px-2 py-0.5", step.direction === "send" ? "text-primary" : "text-success")}>
                          {step.direction === "send" ? "→" : "←"}
                        </td>
                        <td className="px-2 py-0.5 break-all">{step.bytes}</td>
                        <td className="w-56 px-2 py-0.5 text-muted-foreground">{step.label}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : view === "hl7" ? (
              <div className="flex flex-col gap-2">
                <p className="text-[11px] text-muted-foreground">
                  H → MSH, P → PID, O → OBR, R → OBX, C → NTE as an ORU^R01. Only fields with an unambiguous counterpart
                  are carried across; manufacturer-specific ones are left out rather than guessed at, so treat this as a
                  starting point for an interface.
                </p>
                <pre className="mono whitespace-pre-wrap break-all rounded border border-border bg-card p-2 text-[12px]">{hl7}</pre>
              </div>
            ) : view === "diff" ? (
              <div className="flex flex-col gap-2">
                <Textarea
                  mono
                  className="h-32 text-[12px]"
                  value={compareTo}
                  onChange={(e) => setCompareTo(e.target.value)}
                  placeholder="Paste a second message to compare against the one on the left"
                />
                {compareTo.trim() && (
                  <>
                    <p className="text-[11px] text-muted-foreground">{differences.length} difference(s)</p>
                    <table className="w-full font-mono text-[12px]">
                      <tbody className="divide-y divide-border">
                        {differences.map((d) => (
                          <tr key={d.path}>
                            <td className="w-28 px-2 py-0.5 text-muted-foreground">{d.path}</td>
                            <td className="w-16 px-2 py-0.5">
                              <span className={cn(
                                d.kind === "added" && "text-success",
                                d.kind === "removed" && "text-destructive",
                                d.kind === "changed" && "text-warning",
                              )}>{d.kind}</span>
                            </td>
                            <td className="px-2 py-0.5 break-all">
                              {d.kind === "changed" ? `${d.left} → ${d.right}` : (d.left ?? d.right)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </div>
            ) : view === "json" ? (
              <pre className="mono whitespace-pre-wrap text-[12px]">{json}</pre>
            ) : parsed.msg ? (
              <div className="space-y-2">
                {parsed.msg.records.map((record, ri) => (
                  <div key={ri} className="rounded-md border border-border bg-card">
                    <div className="flex items-center gap-2 border-b border-border px-2 py-1 text-sm">
                      <span className="font-bold text-primary">{record.type}</span>
                      <span className="text-xs text-muted-foreground">{record.description}</span>
                      {record.sequence !== null && (
                        <span className="ml-auto text-xs text-muted-foreground">seq {record.sequence}</span>
                      )}
                    </div>
                    <table className="w-full text-[12px]">
                      <tbody className="divide-y divide-border font-mono">
                        {record.fields.filter((f) => f.index !== 1 && f.value !== "").map((f) => {
                          const table = CODE_TABLES[record.type]?.[f.index];
                          const iso = TIMESTAMP_FIELDS[record.type]?.includes(f.index)
                            ? astmTimestampToIso(f.value)
                            : null;
                          const note = table ? describeCode(table, f.value) : iso;
                          return (
                            <tr key={f.index}>
                              <td className="w-12 px-2 py-0.5 text-muted-foreground">{record.type}-{f.index}</td>
                              <td className="w-44 px-2 py-0.5 text-muted-foreground">{f.name}</td>
                              <td className="px-2 py-0.5 break-all">
                                {f.components.length > 1 ? f.components.join(" · ") : f.value}
                                {note && <span className="ml-2 text-muted-foreground">({note})</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            ) : (
              <p className="p-2 text-sm text-muted-foreground">Enter a valid ASTM message to explore its records.</p>
            )}
          </div>
        </div>
      </div>
    </ToolShell>
  );
}

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className={active ? "border-b-2 border-primary px-3 py-1 text-sm" : "px-3 py-1 text-sm text-muted-foreground hover:text-foreground"}>
      {label}
    </button>
  );
}
