import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plug, PlugZap, Send, Trash2, Activity, ArrowDown, ArrowUp, Circle, HeartPulse, Plus } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/CopyButton";
import { KeyValueEditor } from "@/components/KeyValueEditor";
import { NativeNotice } from "@/components/NativeNotice";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { invokeNative, isTauri } from "@/lib/platform";
import { log } from "@/lib/logBus";
import { useApiStore } from "@/stores/useApiStore";
import { interpolate } from "@/tools/lib/interpolate";
import type { KeyValue } from "@/tools/lib/apiTypes";
import { WS_SAMPLES, WS_CATEGORIES, sampleSettings, type WsSample } from "@/tools/lib/wsSamples";
import {
  DEFAULT_HEARTBEAT,
  findAutoReply,
  normalizeInterval,
  presetById,
  WS_PRESETS,
  type AutoReplyRule,
  type HeartbeatConfig,
  type MatchKind,
} from "@/tools/lib/wsHeartbeat";
import {
  appendFrame,
  directionOf,
  exportFrames,
  receivedPayloads,
  filterFrames,
  formatFrame,
  framesToText,
  normalizeWsUrl,
  statsOf,
  statusAfter,
  type WsDirection,
  type WsEventPayload,
  type WsFrame,
  type WsFrameKind,
  type WsStatus,
} from "@/tools/lib/wsSession";

const KIND_STYLE: Record<WsFrameKind, string> = {
  message: "text-foreground",
  binary: "text-primary",
  sent: "text-success",
  open: "text-success",
  close: "text-muted-foreground",
  error: "text-destructive",
  ping: "text-muted-foreground",
  pong: "text-muted-foreground",
};

export function WebSocketTester() {
  const vars = useApiStore((s) => s.activeVars)();

  const [url, setUrl] = useState("wss://echo.websocket.org");
  const [headers, setHeaders] = useState<KeyValue[]>([]);
  const [subprotocols, setSubprotocols] = useState("");
  const [showHeaders, setShowHeaders] = useState(false);

  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [status, setStatus] = useState<WsStatus>("idle");
  const [frames, setFrames] = useState<WsFrame[]>([]);
  const [message, setMessage] = useState('{"type":"ping"}');
  const [filter, setFilter] = useState("");
  const [hideControl, setHideControl] = useState(true);
  const [direction, setDirection] = useState<WsDirection | "all">("all");
  const [selected, setSelected] = useState<WsFrame | null>(null);

  const [heartbeat, setHeartbeat] = useState<HeartbeatConfig>(DEFAULT_HEARTBEAT);
  const [rules, setRules] = useState<AutoReplyRule[]>([]);
  const [showKeepAlive, setShowKeepAlive] = useState(false);
  const [lastBeatAt, setLastBeatAt] = useState<number | null>(null);
  /** Read by the event listener without making it depend on rule edits. */
  const rulesRef = useRef<AutoReplyRule[]>([]);
  rulesRef.current = rules;

  const nextId = useRef(1);
  const bottom = useRef<HTMLDivElement>(null);
  // Read inside the event listener without resubscribing on every connect.
  const connectionRef = useRef<string | null>(null);
  connectionRef.current = connectionId;

  const push = useCallback((frame: Omit<WsFrame, "id">) => {
    setFrames((cur) => appendFrame(cur, frame, nextId.current++));
  }, []);

  // One subscription for the lifetime of the screen; frames are matched by id.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const stop = await listen<WsEventPayload>("ws://event", (event) => {
        const payload = event.payload;
        if (connectionRef.current && payload.id !== connectionRef.current) return;
        const kind = payload.kind as WsFrameKind;
        push({
          connectionId: payload.id,
          kind,
          direction: directionOf(kind),
          data: payload.data,
          size: payload.size,
          at: Date.now(),
        });
        // Automatic acknowledgement: a keep-alive answered late is a dropped connection.
        if (kind === "message" && payload.data) {
          const rule = findAutoReply(rulesRef.current, payload.data);
          if (rule) {
            invokeNative<number>("ws_send", { id: payload.id, message: rule.reply })
              .then((size) =>
                push({
                  connectionId: payload.id,
                  kind: "sent",
                  direction: "out",
                  data: `${rule.reply}   ⟵ auto: ${rule.label}`,
                  size,
                  at: Date.now(),
                }),
              )
              .catch((e) => log.warn("ws", `Auto-reply failed: ${e instanceof Error ? e.message : String(e)}`));
          }
        }

        const next = statusAfter(payload.kind);
        if (next) {
          setStatus(next);
          if (next !== "open") setConnectionId(null);
        }
        if (payload.kind === "error") log.error("ws", payload.data);
      });
      if (cancelled) stop();
      else unlisten = stop;
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [push]);

  // Heartbeat timer: only runs while a connection is open, and restarts when retuned.
  useEffect(() => {
    if (!connectionId || status !== "open" || !heartbeat.enabled) return;
    const interval = normalizeInterval(heartbeat.intervalMs);
    const timer = setInterval(async () => {
      try {
        if (heartbeat.useProtocolPing) {
          await invokeNative("ws_ping", { id: connectionId });
          push({ connectionId, kind: "sent", direction: "out", data: "(heartbeat ping)", size: 0, at: Date.now() });
        } else {
          const size = await invokeNative<number>("ws_send", { id: connectionId, message: heartbeat.message });
          push({ connectionId, kind: "sent", direction: "out", data: `${heartbeat.message}   ⟵ heartbeat`, size, at: Date.now() });
        }
        setLastBeatAt(Date.now());
      } catch (e) {
        log.warn("ws", `Heartbeat failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }, interval);
    return () => clearInterval(timer);
  }, [connectionId, status, heartbeat, push]);

  const applyPreset = (id: string) => {
    const preset = presetById(id);
    if (!preset) return;
    setHeartbeat(preset.heartbeat);
    setRules(preset.rules.map((r, i) => ({ ...r, id: `${id}-${i}` })));
    setShowKeepAlive(true);
    toast.success(`${preset.name} applied`);
  };

  const saveLog = (format: "json" | "ndjson" | "text") => {
    if (frames.length === 0) return toast.error("Nothing to save yet");
    const out = exportFrames(frames, format, String(Date.now()));
    const blob = new Blob([out.content], { type: out.mime });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = out.filename;
    a.click();
    URL.revokeObjectURL(href);
    toast.success(`Saved ${out.filename}`);
  };

  const activeSample = useMemo(() => WS_SAMPLES.find((s) => s.url === url), [url]);

  const shown = useMemo(
    () => filterFrames(frames, { text: filter, hideControl, direction }),
    [frames, filter, hideControl, direction],
  );
  const stats = useMemo(() => statsOf(frames), [frames]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [shown.length]);

  /**
   * Dial an endpoint. The URL is passed in rather than read from state so a sample can
   * connect in the same click that sets it, without waiting for a re-render.
   */
  const connectTo = async (rawUrl: string, subscribe?: string) => {
    let target: string;
    try {
      const normalized = normalizeWsUrl(interpolate(rawUrl, vars));
      target = normalized.url;
      if (normalized.note) toast.success(normalized.note);
    } catch (e) {
      return toast.error((e as Error).message);
    }

    setStatus("connecting");
    try {
      const id = await invokeNative<string>("ws_connect", {
        url: target,
        headers: headers
          .filter((h) => h.enabled && h.key.trim())
          .map((h) => ({ name: interpolate(h.key, vars), value: interpolate(h.value, vars) })),
        subprotocols: subprotocols.split(",").map((s) => s.trim()).filter(Boolean),
      });
      setConnectionId(id);
      setStatus("open");

      if (subscribe) {
        const size = await invokeNative<number>("ws_send", { id, message: subscribe });
        push({ connectionId: id, kind: "sent", direction: "out", data: `${subscribe}   ⟵ subscribe`, size, at: Date.now() });
      }
    } catch (e) {
      setStatus("error");
      const msg = e instanceof Error ? e.message : String(e);
      push({ connectionId: "-", kind: "error", direction: "system", data: msg, size: 0, at: Date.now() });
      toast.error("Connection failed");
    }
  };

  const connect = () => connectTo(url);

  /** One click: load the sample's settings, then connect and subscribe. */
  const runSample = async (sample: WsSample) => {
    if (connectionId) await disconnect();
    const settings = sampleSettings(sample);
    setUrl(sample.url);
    setHeartbeat(settings.heartbeat);
    setRules(settings.rules);
    setFrames([]);
    setSelected(null);
    if (sample.quiet) toast.success(`${sample.name} — connects immediately, but only speaks when an event occurs`);
    await connectTo(sample.url, sample.subscribe);
  };

  const disconnect = async () => {
    if (!connectionId) return;
    try {
      await invokeNative("ws_close", { id: connectionId });
    } catch {
      // Already gone on the native side; the close frame will report it.
    }
    setConnectionId(null);
    setStatus("closed");
  };

  const send = async () => {
    if (!connectionId) return toast.error("Not connected");
    if (!message) return;
    const text = interpolate(message, vars);
    try {
      const size = await invokeNative<number>("ws_send", { id: connectionId, message: text });
      push({ connectionId, kind: "sent", direction: "out", data: text, size, at: Date.now() });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const ping = async () => {
    if (!connectionId) return;
    try {
      await invokeNative("ws_ping", { id: connectionId });
      push({ connectionId, kind: "sent", direction: "out", data: "(ping)", size: 0, at: Date.now() });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const connected = status === "open" && !!connectionId;

  return (
    <ToolShell
      toolId="websocket-tester"
      title="WebSocket Tester"
      description="Connect with custom handshake headers, stream frames, send messages. Native — not the browser's WebSocket."
      requiresNative
      actions={<CopyButton value={framesToText(shown)} label="Copy log" />}
    >
      {!isTauri() && <NativeNotice what="WebSocket connections" />}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusDot status={status} />
          <Input
            className="min-w-72 flex-1 font-mono text-sm"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="wss://api.example.com/socket  (supports {{VAR}})"
            onKeyDown={(e) => e.key === "Enter" && !connected && connect()}
            disabled={connected}
          />
          {connected ? (
            <Button variant="destructive" onClick={disconnect}><PlugZap /> Disconnect</Button>
          ) : (
            <Button onClick={connect} disabled={!isTauri() || status === "connecting"}>
              <Plug /> {status === "connecting" ? "Connecting…" : "Connect"}
            </Button>
          )}
          <Button variant="outline" onClick={() => setShowHeaders((v) => !v)}>
            Headers{headers.filter((h) => h.enabled && h.key).length ? ` (${headers.filter((h) => h.enabled && h.key).length})` : ""}
          </Button>
          <Button variant="outline" onClick={() => setShowKeepAlive((v) => !v)} title="Heartbeat and automatic replies">
            <HeartPulse />
            Keep-alive{heartbeat.enabled || rules.some((r) => r.enabled) ? " •" : ""}
          </Button>
        </div>

        {/* One-click live endpoints, so the tool can be tried without hunting for a server. */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium text-muted-foreground">Try a live feed</span>
          <select
            className="h-8 max-w-xs rounded-md border border-input bg-transparent px-2 text-xs"
            value={WS_SAMPLES.find((s) => s.url === url)?.id ?? ""}
            disabled={!isTauri() || status === "connecting"}
            onChange={(e) => {
              const sample = WS_SAMPLES.find((s) => s.id === e.target.value);
              if (sample) runSample(sample);
            }}
          >
            <option value="">Choose an endpoint…</option>
            {WS_CATEGORIES.map((category) => (
              <optgroup key={category} label={category}>
                {WS_SAMPLES.filter((s) => s.category === category).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.quiet ? " (quiet)" : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {activeSample && (
            <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground" title={activeSample.description}>
              {activeSample.description}
            </span>
          )}
        </div>

        {showKeepAlive && (
          <div className="flex flex-col gap-3 rounded-md border border-border bg-muted/20 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium">Protocol preset</span>
              <select
                className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
                defaultValue=""
                onChange={(e) => e.target.value && applyPreset(e.target.value)}
              >
                <option value="">Choose…</option>
                {WS_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <span className="text-[11px] text-muted-foreground">
                Fills in the heartbeat and reply rules that protocol requires.
              </span>
            </div>

            {/* Heartbeat */}
            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={heartbeat.enabled} onChange={(e) => setHeartbeat({ ...heartbeat, enabled: e.target.checked })} />
                Send a heartbeat every
              </label>
              <Input
                type="number"
                className="h-8 w-24"
                value={Math.round(heartbeat.intervalMs / 1000)}
                onChange={(e) => setHeartbeat({ ...heartbeat, intervalMs: Math.max(1, Number(e.target.value)) * 1000 })}
              />
              <span className="text-xs text-muted-foreground">seconds</span>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={heartbeat.useProtocolPing}
                  onChange={(e) => setHeartbeat({ ...heartbeat, useProtocolPing: e.target.checked })}
                />
                Use a protocol ping frame
              </label>
              {!heartbeat.useProtocolPing && (
                <Input
                  className="h-8 w-56 font-mono text-xs"
                  value={heartbeat.message}
                  onChange={(e) => setHeartbeat({ ...heartbeat, message: e.target.value })}
                  placeholder="Heartbeat payload"
                />
              )}
              {heartbeat.enabled && connected && (
                <span className="text-[11px] text-success">
                  {lastBeatAt ? `last beat ${new Date(lastBeatAt).toLocaleTimeString()}` : "armed"}
                </span>
              )}
            </div>

            {/* Auto-reply rules */}
            <div className="flex flex-col gap-2 border-t border-border pt-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium">Automatic replies</span>
                <span className="text-[11px] text-muted-foreground">
                  Checked against every inbound message; the first match answers. Replies are marked in the log.
                </span>
              </div>
              {rules.map((rule) => (
                <div key={rule.id} className="flex flex-wrap items-center gap-2">
                  <input type="checkbox" checked={rule.enabled} onChange={(e) => setRules(rules.map((r) => (r.id === rule.id ? { ...r, enabled: e.target.checked } : r)))} />
                  <Input
                    className="h-8 w-28 text-xs"
                    value={rule.label}
                    onChange={(e) => setRules(rules.map((r) => (r.id === rule.id ? { ...r, label: e.target.value } : r)))}
                    placeholder="Label"
                  />
                  <select
                    className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
                    value={rule.kind}
                    onChange={(e) => setRules(rules.map((r) => (r.id === rule.id ? { ...r, kind: e.target.value as MatchKind } : r)))}
                  >
                    <option value="contains">contains</option>
                    <option value="equals">equals</option>
                    <option value="regex">regex</option>
                    <option value="jsonField">JSON field</option>
                  </select>
                  {rule.kind === "jsonField" && (
                    <Input
                      className="h-8 w-24 font-mono text-xs"
                      value={rule.field ?? ""}
                      onChange={(e) => setRules(rules.map((r) => (r.id === rule.id ? { ...r, field: e.target.value } : r)))}
                      placeholder="field"
                    />
                  )}
                  <Input
                    className="h-8 w-36 font-mono text-xs"
                    value={rule.value}
                    onChange={(e) => setRules(rules.map((r) => (r.id === rule.id ? { ...r, value: e.target.value } : r)))}
                    placeholder="match"
                  />
                  <span className="text-xs text-muted-foreground">→</span>
                  <Input
                    className="h-8 w-44 font-mono text-xs"
                    value={rule.reply}
                    onChange={(e) => setRules(rules.map((r) => (r.id === rule.id ? { ...r, reply: e.target.value } : r)))}
                    placeholder="reply"
                  />
                  <button
                    className="ml-auto text-muted-foreground hover:text-destructive"
                    title="Remove this rule"
                    aria-label="Remove this rule"
                    onClick={() => setRules(rules.filter((r) => r.id !== rule.id))}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
              <div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setRules([
                      ...rules,
                      { id: String(Date.now()), enabled: true, label: "pong", kind: "contains", value: "ping", reply: "pong" },
                    ])
                  }
                >
                  <Plus /> Add rule
                </Button>
              </div>
            </div>
          </div>
        )}

        {showHeaders && (
          <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-3">
            <p className="text-[11px] text-muted-foreground">
              Sent on the HTTP upgrade request. A browser cannot do this — it is why this client runs natively.
              Values support <span className="mono">{"{{VAR}}"}</span> from the active environment.
            </p>
            <KeyValueEditor rows={headers} onChange={setHeaders} keyPlaceholder="Authorization" />
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Subprotocols</span>
              <Input
                className="h-8 max-w-sm font-mono text-xs"
                value={subprotocols}
                onChange={(e) => setSubprotocols(e.target.value)}
                placeholder="graphql-ws, json (comma separated)"
              />
            </div>
          </div>
        )}

        {/* Composer */}
        <div className="flex flex-col gap-2">
          <Textarea
            mono
            className="h-24"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Message to send (Ctrl+Enter)"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                send();
              }
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={send} disabled={!connected}><Send /> Send</Button>
            <Button size="sm" variant="outline" onClick={() => setMessage(formatFrame(message))}>Format JSON</Button>
            <Button size="sm" variant="outline" onClick={ping} disabled={!connected}><Activity /> Ping</Button>
            <span className="ml-auto flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1"><ArrowUp className="size-3 text-success" /> {stats.sent} ({formatBytes(stats.bytesSent)})</span>
              <span className="flex items-center gap-1"><ArrowDown className="size-3 text-primary" /> {stats.received} ({formatBytes(stats.bytesReceived)})</span>
            </span>
          </div>
        </div>

        {/* Frame log */}
        <div className="flex flex-wrap items-center gap-2">
          <Input className="h-8 w-56 text-xs" placeholder="Filter frames…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <select
            className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
            value={direction}
            onChange={(e) => setDirection(e.target.value as WsDirection | "all")}
          >
            <option value="all">All frames</option>
            <option value="in">Received</option>
            <option value="out">Sent</option>
            <option value="system">System</option>
          </select>
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
            <input type="checkbox" checked={hideControl} onChange={(e) => setHideControl(e.target.checked)} />
            Hide ping/pong
          </label>
          <span className="text-[11px] text-muted-foreground">{shown.length}/{frames.length} frames</span>

          <div className="ml-auto flex items-center gap-1">
            <CopyButton value={receivedPayloads(frames)} label="Copy received" className="h-7 px-2 text-[11px]" />
            <select
              className="h-7 rounded-md border border-input bg-transparent px-2 text-[11px]"
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) saveLog(e.target.value as "json" | "ndjson" | "text");
                e.target.value = "";
              }}
              title="Save the frame log to a file"
            >
              <option value="">Save as…</option>
              <option value="json">JSON</option>
              <option value="ndjson">NDJSON</option>
              <option value="text">Text log</option>
            </select>
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => { setFrames([]); setSelected(null); }} title="Clear the log">
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_360px]">
          <div className="h-[calc(100vh-520px)] min-h-56 overflow-auto rounded-md border border-border bg-muted/20 font-mono text-[12px]">
            {shown.length === 0 ? (
              <p className="p-3 text-muted-foreground">
                {frames.length === 0 ? "No frames yet. Connect and send a message." : "No frames match the filter."}
              </p>
            ) : (
              shown.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setSelected(f)}
                  className={cn(
                    "flex w-full items-start gap-2 border-b border-border/40 px-2 py-1 text-left hover:bg-muted/50",
                    selected?.id === f.id && "bg-muted/60",
                  )}
                >
                  <span className="shrink-0 text-muted-foreground">{new Date(f.at).toLocaleTimeString()}</span>
                  <span className={cn("w-4 shrink-0", KIND_STYLE[f.kind])}>
                    {f.direction === "out" ? "→" : f.direction === "in" ? "←" : "•"}
                  </span>
                  <span className={cn("w-14 shrink-0", KIND_STYLE[f.kind])}>{f.kind}</span>
                  <span className="min-w-0 flex-1 truncate">{f.data}</span>
                  {f.size > 0 && <span className="shrink-0 text-muted-foreground">{formatBytes(f.size)}</span>}
                </button>
              ))
            )}
            <div ref={bottom} />
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Frame detail</span>
              {selected && <CopyButton value={selected.data} className="ml-auto h-6 px-2 text-[10px]" />}
            </div>
            <Textarea
              mono
              readOnly
              className="h-[calc(100vh-520px)] min-h-56 bg-muted/30 text-[12px]"
              value={selected ? formatFrame(selected.data) : ""}
              placeholder="Select a frame to inspect it. JSON is formatted automatically."
            />
          </div>
        </div>
      </div>
    </ToolShell>
  );
}

function StatusDot({ status }: { status: WsStatus }) {
  const map: Record<WsStatus, { label: string; className: string }> = {
    idle: { label: "Not connected", className: "text-muted-foreground" },
    connecting: { label: "Connecting", className: "text-warning animate-pulse" },
    open: { label: "Connected", className: "text-success" },
    closed: { label: "Closed", className: "text-muted-foreground" },
    error: { label: "Error", className: "text-destructive" },
  };
  const s = map[status];
  return (
    <Badge variant="outline" className="gap-1">
      <Circle className={cn("size-2 fill-current", s.className)} />
      {s.label}
    </Badge>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
