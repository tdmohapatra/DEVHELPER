/**
 * Opening an environment's connection reference in the tool that speaks to it.
 *
 * An environment records where DEV's Redis, NATS and RabbitMQ are. Until now
 * that was metadata you read and retyped. The mapping is not quite mechanical,
 * because what gets recorded is the address applications connect to and what
 * these tools need is the address the *operator* connects to — 4222 versus
 * 8222 for NATS, 5672 versus 15672 for RabbitMQ. Handing over the client port
 * unchanged produces a connection failure that looks like the server is down.
 *
 * Credentials are never carried across: environments store no passwords, and
 * inventing one here would be worse than leaving the field empty.
 */

import type { EnvConnection } from "./apiTypes";
import { withMonitorPort } from "./natsMonitor";
import { withMgmtPort } from "./rabbitMonitor";

export interface HandoffTarget {
  toolId: string;
  fields: Record<string, string>;
  /** Button text, e.g. "Open in NATS". */
  label: string;
  /** Shown when the address had to be adjusted, so the change is not a surprise. */
  note?: string;
}

/**
 * Split a connection string into host and port.
 *
 * Accepts a bare host, `host:port`, or a full URL with any scheme and optional
 * credentials — all four turn up in the wild in a field labelled "url".
 */
export function hostPort(input: string): { host: string; port?: string } {
  let s = (input ?? "").trim();
  if (!s) return { host: "" };
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ""); // scheme
  s = s.replace(/^[^@/]*@/, ""); // credentials
  s = s.split("/")[0].split("?")[0]; // path and query
  const match = /^(.*):(\d+)$/.exec(s);
  if (match) return { host: match[1], port: match[2] };
  return { host: s };
}

/** Host and port rejoined, omitting an absent port. */
export function joinHostPort(host: string, port?: string): string {
  return port ? `${host}:${port}` : host;
}

/**
 * Where this connection reference can be opened, or null if nothing consumes it.
 *
 * Database references are absent on purpose: they have their own route through
 * the Database Toolkit's persisted connection list, which can carry more than a
 * prefill can.
 */
export function handoffTarget(conn: EnvConnection): HandoffTarget | null {
  const f = conn.fields ?? {};
  switch (conn.kind) {
    case "redis": {
      const host = (f.host ?? "").trim();
      if (!host) return null;
      const parsed = hostPort(host);
      return {
        toolId: "redis",
        label: "Open in Redis",
        fields: {
          host: parsed.host,
          port: (f.port ?? "").trim() || parsed.port || "6379",
          db: (f.db ?? "").trim() || "0",
        },
      };
    }
    case "nats": {
      const url = (f.url ?? f.host ?? "").trim();
      if (!url) return null;
      const parsed = hostPort(url);
      const address = joinHostPort(parsed.host, parsed.port);
      const monitor = withMonitorPort(address);
      return {
        toolId: "nats",
        label: "Open in NATS",
        fields: { server: monitor },
        note:
          monitor !== address
            ? `${address} is the client port; the tool reads the monitoring port, so ${monitor} was used.`
            : undefined,
      };
    }
    case "rabbitmq": {
      const url = (f.url ?? f.host ?? "").trim();
      if (!url) return null;
      const parsed = hostPort(url);
      const address = joinHostPort(parsed.host, parsed.port);
      const mgmt = withMgmtPort(address);
      return {
        toolId: "rabbitmq",
        label: "Open in RabbitMQ",
        fields: { server: mgmt },
        note:
          mgmt !== address
            ? `${address} is the AMQP port; the tool reads the management API, so ${mgmt} was used.`
            : undefined,
      };
    }
    default:
      return null;
  }
}
