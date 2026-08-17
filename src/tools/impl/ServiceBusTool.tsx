import { useCallback, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Eye, Inbox, Plug, RefreshCw, Send, Skull } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/CopyButton";
import { AddToDebug } from "@/components/AddToDebug";
import { executeRequest, corsLimited } from "@/lib/http";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  deadLetterExplanation,
  displayName,
  endpointWarning,
  entityFindings,
  formatBytes,
  isUnlimitedDuration,
  namespaceSummary,
  parseConnectionString,
  parseFeed,
  parsePeekResponse,
  peekLockUrl,
  peekPlan,
  PEEK_WARNING,
  queuesUrl,
  requestAdvice,
  runtimePath,
  sasToken,
  sendUrl,
  sortByAttention,
  subscriptionsUrl,
  topicsUrl,
  totalMessages,
  type EntityDescription,
  type PeekedMessage,
  type ServiceBusConnection,
  type Severity,
} from "@/tools/lib/serviceBus";
import {
  brokerUnreachableEvent,
  serviceBusMessageEvent,
  serviceBusNamespaceEvent,
  serviceBusSendEvent,
} from "@/tools/lib/mqCapture";

type Tab = "entities" | "messages" | "send";

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: "entities", label: "Entities", icon: <Inbox className="size-3.5" /> },
  { id: "messages", label: "Peek", icon: <Eye className="size-3.5" /> },
  { id: "send", label: "Send", icon: <Send className="size-3.5" /> },
];

const SEVERITY_CLASS: Record<Severity, string> = {
  ok: "text-success",
  warn: "text-warning",
  bad: "text-destructive",
  unknown: "text-muted-foreground",
};

export function ServiceBusTool() {
  // Held in component state only. A connection string is a bearer credential for
  // the whole namespace, so it is never written to a store or to disk.
  const [connectionString, setConnectionString] = useState("");
  const [conn, setConn] = useState<ServiceBusConnection | null>(null);

  const [tab, setTab] = useState<Tab>("entities");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [entities, setEntities] = useState<EntityDescription[]>([]);

  const [selected, setSelected] = useState<EntityDescription | null>(null);
  const [fromDeadLetter, setFromDeadLetter] = useState(true);
  const [peekCount, setPeekCount] = useState(5);
  const [messages, setMessages] = useState<PeekedMessage[]>([]);
  const [peekNote, setPeekNote] = useState("");

  const [sendTo, setSendTo] = useState("");
  const [sendBody, setSendBody] = useState('{"hello":"world"}');
  const [sendLabel, setSendLabel] = useState("");
  const [sendCorrelation, setSendCorrelation] = useState("");
  const [sendResult, setSendResult] = useState<{ ok: boolean; text: string } | null>(null);

  const findings = useMemo(() => entityFindings(entities), [entities]);
  const sorted = useMemo(() => sortByAttention(entities), [entities]);
  const totals = useMemo(
    () => ({
      queues: entities.filter((e) => e.kind === "queue").length,
      topics: entities.filter((e) => e.kind === "topic").length,
      subscriptions: entities.filter((e) => e.kind === "subscription").length,
      active: entities.reduce((n, e) => n + e.counts.active, 0),
      dead: entities.reduce((n, e) => n + e.counts.deadLetter + e.counts.transferDeadLetter, 0),
      scheduled: entities.reduce((n, e) => n + e.counts.scheduled, 0),
    }),
    [entities],
  );

  /**
   * One authenticated request against the namespace.
   *
   * A fresh token per request rather than a cached one: signing is cheap, and a
   * token cached across a long session is the thing that expires halfway through
   * a peek loop and turns it into a 401 nobody can explain.
   */
  const request = useCallback(
    async (target: ServiceBusConnection, method: string, url: string, headers: Record<string, string> = {}, body?: string) => {
      const auth = await sasToken(target);
      return executeRequest({ method, url, headers: { Authorization: auth, ...headers }, body }, undefined, { timeoutMs: 20000 });
    },
    [],
  );

  const connect = async () => {
    setBusy(true);
    setError("");
    setMessages([]);
    try {
      const target = parseConnectionString(connectionString);
      const warning = endpointWarning(target.host);
      if (warning) toast.error(warning);

      const queueRes = await request(target, "GET", queuesUrl(target));
      if (!queueRes.ok) throw new Error(requestAdvice(queueRes.status));
      const queues = parseFeed(queueRes.body, "queue");

      // Topics are best-effort: a Listen-only policy can read its own queues and
      // be refused the topic list, and that is still a usable connection.
      const topicRes = await request(target, "GET", topicsUrl(target)).catch(() => null);
      const topics = topicRes?.ok ? parseFeed(topicRes.body, "topic") : [];

      // Subscriptions are where the dead letters actually sit — a topic never
      // holds a message itself — so every topic is expanded.
      const subs = (
        await Promise.all(
          topics.map(async (t) => {
            const res = await request(target, "GET", subscriptionsUrl(target, t.name)).catch(() => null);
            return res?.ok ? parseFeed(res.body, "subscription", t.name) : [];
          }),
        )
      ).flat();

      setConn(target);
      setEntities([...queues, ...topics, ...subs]);
      const first = [...queues, ...subs][0];
      setSelected(first ?? null);
      setSendTo(target.entityPath ?? queues[0]?.name ?? "");
    } catch (e) {
      const reason = e instanceof Error && e.message ? e.message : String(e);
      setError(reason);
      setConn(null);
      setEntities([]);
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    if (!conn) return;
    setBusy(true);
    try {
      const [queueRes, topicRes] = await Promise.all([
        request(conn, "GET", queuesUrl(conn)),
        request(conn, "GET", topicsUrl(conn)).catch(() => null),
      ]);
      const queues = queueRes.ok ? parseFeed(queueRes.body, "queue") : [];
      const topics = topicRes?.ok ? parseFeed(topicRes.body, "topic") : [];
      const subs = (
        await Promise.all(
          topics.map(async (t) => {
            const res = await request(conn, "GET", subscriptionsUrl(conn, t.name)).catch(() => null);
            return res?.ok ? parseFeed(res.body, "subscription", t.name) : [];
          }),
        )
      ).flat();
      setEntities([...queues, ...topics, ...subs]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Read messages without consuming them.
   *
   * Peek-lock is the only non-destructive read REST offers, and it advances only
   * because each message stays locked behind the one after it. Every lock is
   * released in a `finally` — a lock this tool takes and then abandons on an
   * error would hide a real message from a real consumer for its whole lock
   * duration, which for a default queue is a minute.
   *
   * `DELETE` on a lock URI would complete (destroy) the message. This tool never
   * issues one.
   */
  const peek = async () => {
    if (!conn || !selected) return;
    setBusy(true);
    setMessages([]);
    const plan = peekPlan(peekCount);
    setPeekNote(plan.note);
    const path = runtimePath(selected);
    const held: string[] = [];
    const read: PeekedMessage[] = [];
    try {
      for (let i = 0; i < plan.locks; i++) {
        const res = await request(conn, "POST", peekLockUrl(conn, path, fromDeadLetter));
        // 204 is the queue telling us it has nothing more at the head, not an error.
        if (res.status === 204) break;
        if (!res.ok) throw new Error(requestAdvice(res.status, path));
        const message = parsePeekResponse(res.headers, res.body);
        read.push(message);
        if (message.lockUri) held.push(message.lockUri);
      }
      setMessages(read);
      if (read.length === 0) {
        toast.success(fromDeadLetter ? "The dead-letter queue is empty." : "Nothing at the head of the queue.");
      }
    } catch (e) {
      setMessages(read);
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      // PUT on a lock URI unlocks; releasing runs whatever happened above.
      await Promise.all(held.map((uri) => request(conn, "PUT", uri).catch(() => null)));
      setBusy(false);
    }
  };

  const send = async () => {
    if (!conn) return;
    const entity = sendTo.trim();
    if (!entity) return toast.error("Name the queue or topic to send to.");
    setBusy(true);
    try {
      const properties: Record<string, string> = {};
      if (sendLabel.trim()) properties.Label = sendLabel.trim();
      if (sendCorrelation.trim()) properties.CorrelationId = sendCorrelation.trim();
      const res = await request(
        conn,
        "POST",
        sendUrl(conn, entity),
        {
          "Content-Type": "application/json",
          ...(Object.keys(properties).length > 0 ? { BrokerProperties: JSON.stringify(properties) } : {}),
        },
        sendBody,
      );
      if (!res.ok) throw new Error(requestAdvice(res.status, entity));
      setSendResult({ ok: true, text: `${res.status} — accepted by ${entity}.` });
      toast.success(`Sent to ${entity}`);
      refresh();
    } catch (e) {
      const reason = e instanceof Error && e.message ? e.message : String(e);
      setSendResult({ ok: false, text: reason });
      toast.error(reason);
    } finally {
      setBusy(false);
    }
  };

  const peekable = sorted.filter((e) => e.kind !== "topic");

  return (
    <ToolShell
      toolId="service-bus"
      title="Azure Service Bus"
      description="Queues, topics, subscriptions and dead letters over the REST API, signed with a SAS key."
    >
      {corsLimited() && (
        <div className="mb-3 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
          Browser dev mode: servicebus.windows.net sends no CORS headers, so every request is blocked before it leaves. Use the desktop app.
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
        <F label="Connection string">
          <Input
            type="password"
            className="h-8 w-[28rem]"
            value={connectionString}
            onChange={(e) => setConnectionString(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && connect()}
            placeholder="Endpoint=sb://ns.servicebus.windows.net/;SharedAccessKeyName=…;SharedAccessKey=…"
          />
        </F>
        <Button size="sm" onClick={connect} disabled={busy}>
          {busy ? <RefreshCw className="size-3.5 animate-spin" /> : <Plug className="size-3.5" />} Connect
        </Button>
        {conn && (
          <>
            <Badge variant="success">{conn.namespace}</Badge>
            {conn.entityPath && <Badge variant="outline">scoped to {conn.entityPath}</Badge>}
            <Badge variant="outline">{conn.keyName}</Badge>
          </>
        )}
        <p className="w-full text-[11px] text-muted-foreground">
          Kept in memory for this screen only — never saved, and the SAS token minted from it is signed here and sent
          straight to Azure. Listing entities needs a policy with Manage; peeking needs Listen; sending needs Send.
        </p>
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
          <p>{error}</p>
          <div className="mt-2">
            <AddToDebug
              variant="outline"
              label="Add to Debug"
              makeEvent={() => brokerUnreachableEvent("servicebus", "service bus", error)}
            />
          </div>
        </div>
      )}

      {conn && (
        <>
          <div className="mb-3 flex flex-wrap gap-1 border-b border-border">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-sm",
                  tab === t.id ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.icon} {t.label}
              </button>
            ))}
            <AddToDebug
              className="ml-auto"
              variant="ghost"
              label="Debug"
              makeEvent={() =>
                serviceBusNamespaceEvent({
                  target: conn.host,
                  queues: totals.queues,
                  topics: totals.topics,
                  subscriptions: totals.subscriptions,
                  active: totals.active,
                  deadLettered: totals.dead,
                  findings,
                })
              }
            />
            <Button size="sm" variant="ghost" onClick={refresh}>
              <RefreshCw className={cn("size-3.5", busy && "animate-spin")} /> Refresh
            </Button>
          </div>

          {findings.length > 0 && (
            <div className="mb-3 flex flex-col gap-1 rounded-md border border-warning/40 bg-warning/5 p-2">
              {findings.map((f, i) => (
                <p key={i} className="text-[11px]">
                  <AlertTriangle className={cn("mr-1 inline size-3", SEVERITY_CLASS[f.severity])} />
                  <b>{f.subject}:</b> {f.message}
                </p>
              ))}
            </div>
          )}

          {tab === "entities" && (
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
                <Tile label="Queues" value={String(totals.queues)} />
                <Tile label="Topics" value={String(totals.topics)} />
                <Tile label="Subscriptions" value={String(totals.subscriptions)} />
                <Tile label="Active" value={totals.active.toLocaleString()} />
                <Tile label="Dead-lettered" value={totals.dead.toLocaleString()} tone={totals.dead > 0 ? "bad" : "ok"} />
                <Tile label="Scheduled" value={totals.scheduled.toLocaleString()} />
              </div>
              <p className="text-[11px] text-muted-foreground">
                {namespaceSummary(entities)}. Ordered by what needs attention: dead letters first, then depth. A topic
                carries no messages of its own — its counts live on its subscriptions.
              </p>
              {sorted.length === 0 ? (
                <p className="text-sm text-muted-foreground">The namespace has no entities, or the policy cannot list them.</p>
              ) : (
                <div className="max-h-[45vh] overflow-auto rounded-md border border-border">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 border-b border-border bg-card text-left text-muted-foreground">
                      <tr>
                        {["Entity", "Kind", "Status", "Active", "Dead", "Scheduled", "Transfer DLQ", "Size", "Deliveries", ""].map((c) => (
                          <th key={c} className="whitespace-nowrap px-2 py-1 font-medium">{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {sorted.map((e) => (
                        <tr key={`${e.kind}:${displayName(e)}`} className="hover:bg-secondary/40">
                          <td className="mono max-w-[280px] truncate px-2 py-1" title={displayName(e)}>{displayName(e)}</td>
                          <td className="px-2 py-1 text-muted-foreground">{e.kind}</td>
                          <td className={cn("px-2 py-1", e.status && e.status !== "Active" && "text-destructive")}>{e.status ?? "—"}</td>
                          <td className="px-2 py-1">{e.counts.active.toLocaleString()}</td>
                          <td className={cn("px-2 py-1", e.counts.deadLetter > 0 && "text-destructive")}>{e.counts.deadLetter.toLocaleString()}</td>
                          <td className="px-2 py-1">{e.counts.scheduled.toLocaleString()}</td>
                          <td className={cn("px-2 py-1", e.counts.transferDeadLetter > 0 && "text-destructive")}>
                            {e.counts.transferDeadLetter.toLocaleString()}
                          </td>
                          <td className="px-2 py-1 text-muted-foreground">{formatBytes(e.sizeBytes)}</td>
                          <td className="px-2 py-1 text-muted-foreground">{e.maxDeliveryCount ?? "—"}</td>
                          <td className="px-2 py-1">
                            {e.kind !== "topic" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setSelected(e);
                                  setFromDeadLetter(e.counts.deadLetter > 0);
                                  setTab("messages");
                                }}
                              >
                                <Eye className="size-3.5" /> Peek
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {sorted.some((e) => e.requiresSession || e.forwardTo || isUnlimitedDuration(e.defaultTtlSeconds)) && (
                <p className="text-[11px] text-muted-foreground">
                  {totalMessages(sorted[0].counts).toLocaleString()} message(s) on the entity needing most attention.
                </p>
              )}
            </div>
          )}

          {tab === "messages" && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-2">
                <F label="Entity">
                  <select
                    className="h-8 rounded-md border border-border bg-background px-2 text-sm"
                    value={selected ? `${selected.kind}:${displayName(selected)}` : ""}
                    onChange={(e) => setSelected(peekable.find((x) => `${x.kind}:${displayName(x)}` === e.target.value) ?? null)}
                  >
                    {peekable.map((e) => (
                      <option key={`${e.kind}:${displayName(e)}`} value={`${e.kind}:${displayName(e)}`}>
                        {displayName(e)}
                      </option>
                    ))}
                  </select>
                </F>
                <F label="Sub-queue">
                  <select
                    className="h-8 rounded-md border border-border bg-background px-2 text-sm"
                    value={fromDeadLetter ? "dlq" : "main"}
                    onChange={(e) => setFromDeadLetter(e.target.value === "dlq")}
                  >
                    <option value="dlq">$deadletterqueue</option>
                    <option value="main">the entity itself</option>
                  </select>
                </F>
                <F label="Messages">
                  <Input
                    type="number"
                    className="h-8 w-20"
                    min={1}
                    max={50}
                    value={peekCount}
                    onChange={(e) => setPeekCount(Number(e.target.value) || 1)}
                  />
                </F>
                <Button size="sm" onClick={peek} disabled={busy || !selected}>
                  {fromDeadLetter ? <Skull className="size-3.5" /> : <Eye className="size-3.5" />} Read messages
                </Button>
              </div>

              <p className="rounded-md border border-warning/40 bg-warning/5 p-2 text-[11px]">{PEEK_WARNING}</p>
              {peekNote && <p className="text-[11px] text-muted-foreground">{peekNote}</p>}

              {messages.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing read yet.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {messages.map((m, i) => {
                    const why = deadLetterExplanation(m.properties);
                    return (
                      <div key={i} className="rounded-md border border-border">
                        <div className="flex flex-wrap items-center gap-2 border-b border-border px-2 py-1 text-[11px]">
                          <Badge variant="outline" className="text-[9px]">#{m.properties.SequenceNumber ?? i + 1}</Badge>
                          {m.properties.Label && <Badge variant="secondary" className="text-[9px]">{m.properties.Label}</Badge>}
                          {(m.properties.DeliveryCount ?? 0) > 1 && (
                            <Badge variant="warning" className="text-[9px]">delivered {m.properties.DeliveryCount}×</Badge>
                          )}
                          {m.properties.SessionId && <Badge variant="outline" className="text-[9px]">session {m.properties.SessionId}</Badge>}
                          {m.properties.CorrelationId && (
                            <span className="mono text-muted-foreground">corr={m.properties.CorrelationId}</span>
                          )}
                          {m.properties.EnqueuedTimeUtc && <span className="text-muted-foreground">{m.properties.EnqueuedTimeUtc}</span>}
                          <div className="ml-auto flex items-center gap-1">
                            <AddToDebug
                              variant="ghost"
                              label="Debug"
                              makeEvent={() =>
                                serviceBusMessageEvent(
                                  conn.host,
                                  selected ? displayName(selected) : "entity",
                                  { properties: m.properties as Record<string, unknown>, body: m.body },
                                  fromDeadLetter,
                                )
                              }
                            />
                            <CopyButton value={m.body} />
                          </div>
                        </div>
                        {why && <p className="border-b border-border bg-destructive/5 px-2 py-1 text-[11px] text-destructive">{why}</p>}
                        <pre className="mono max-h-48 overflow-auto whitespace-pre-wrap p-2 text-[11px]">{m.body}</pre>
                        {Object.keys(m.custom).length > 0 && (
                          <div className="border-t border-border px-2 py-1 text-[10px] text-muted-foreground">
                            {Object.entries(m.custom).map(([k, v]) => (
                              <span key={k} className="mr-2">{k}: {v}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {tab === "send" && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-2">
                <F label="Queue or topic">
                  <Input className="h-8 w-56" value={sendTo} onChange={(e) => setSendTo(e.target.value)} placeholder="orders" />
                </F>
                <F label="Label">
                  <Input className="h-8 w-40" value={sendLabel} onChange={(e) => setSendLabel(e.target.value)} placeholder="optional" />
                </F>
                <F label="Correlation id">
                  <Input
                    className="h-8 w-56"
                    value={sendCorrelation}
                    onChange={(e) => setSendCorrelation(e.target.value)}
                    placeholder="optional — ties this into a Debug Session"
                  />
                </F>
                <Button size="sm" onClick={send} disabled={busy}>
                  <Send className="size-3.5" /> Send
                </Button>
                {sendResult && (
                  <AddToDebug
                    variant="outline"
                    label="Add to Debug"
                    makeEvent={() => serviceBusSendEvent(conn.host, sendTo.trim(), sendResult.ok, sendResult.ok ? sendBody : sendResult.text)}
                  />
                )}
              </div>
              <textarea
                className="mono min-h-[10rem] rounded-md border border-border bg-background p-2 text-xs"
                value={sendBody}
                onChange={(e) => setSendBody(e.target.value)}
                spellCheck={false}
              />
              <p className="text-[11px] text-muted-foreground">
                Sent as the message body with Content-Type application/json. A topic accepts a send with no subscriptions
                and drops it; the Entities tab flags that. Sending to a session-enabled queue without a SessionId is
                rejected by the broker.
              </p>
              {sendResult && (
                <p className={cn("text-xs", sendResult.ok ? "text-success" : "text-destructive")}>{sendResult.text}</p>
              )}
            </div>
          )}
        </>
      )}
    </ToolShell>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "bad" }) {
  return (
    <div className="rounded-md border border-border p-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div
        className={cn(
          "truncate text-sm font-medium",
          tone === "bad" && "text-destructive",
          tone === "warn" && "text-warning",
          tone === "ok" && "text-success",
        )}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

function F({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
