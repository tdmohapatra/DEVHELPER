/**
 * Application-wide troubleshooting tips.
 *
 * Drivers and system APIs report failures in their own vocabulary — "db error",
 * "os error 10061", "ECONNREFUSED" — and the fix is almost always a setting the message
 * never mentions. A tip pairs the symptom with the cause and the exact command.
 *
 * This module is the engine: types, matching and command templating. The content lives
 * in `tipsData.ts`, so tips can be added without touching any logic.
 */

export type TipDomain =
  | "mssql"
  | "postgres"
  | "mysql"
  | "sqlite"
  | "oracle"
  | "redis"
  | "docker"
  | "http"
  | "app";

export interface Tip {
  id: string;
  domain: TipDomain;
  title: string;
  /** Why this happens, in one or two sentences. */
  cause: string;
  /** What to do, as ordered steps. */
  steps: string[];
  /** Optional command that performs the fix. Placeholders use `<angle brackets>`. */
  command?: string;
  /** Shown prominently when the command has consequences (elevation, restarts, data loss). */
  warning?: string;
  /** Lower-case substrings that make this tip relevant to an error message. */
  matches: string[];
}

/** What a tip's command needs before it can be pasted into a shell. */
export interface TipContext {
  /** SQL Server: registry name of the instance, e.g. `MSSQL17.MSSQLSERVER`. */
  internalName?: string | null;
  /** Windows service name, e.g. `MSSQLSERVER` or `MSSQL$SQLEXPRESS`. */
  serviceName?: string | null;
  /** Host used in reachability checks. */
  host?: string | null;
  /** Port used in reachability checks. */
  port?: number | null;
  /** Database or container name, depending on the domain. */
  target?: string | null;
}

/** Service name for a SQL Server instance: named instances use `MSSQL$NAME`. */
export function serviceNameFor(instance?: string | null): string {
  if (!instance || instance.toLowerCase() === "mssqlserver") return "MSSQLSERVER";
  return `MSSQL$${instance}`;
}

/**
 * Substitute the placeholders in a tip's command.
 *
 * A command that still contains `<...>` cannot be run, and pasting it produces a
 * confusing "path does not exist" — so unresolved placeholders are reported rather than
 * silently left in place.
 */
export function resolveCommand(command: string, ctx: TipContext = {}): { text: string; resolved: boolean } {
  let text = command;
  if (ctx.internalName) text = text.replaceAll("<MSSQLnn.INSTANCE>", ctx.internalName);
  if (ctx.serviceName) text = text.replaceAll("MSSQLSERVER -Force", `${ctx.serviceName} -Force`);
  if (ctx.host) text = text.replaceAll("<host>", ctx.host);
  if (ctx.port) text = text.replaceAll("<port>", String(ctx.port));
  if (ctx.target) text = text.replaceAll("<target>", ctx.target);
  return { text, resolved: !/<[^>]+>/.test(text) };
}

/**
 * Tips relevant to an error, best match first.
 *
 * Longer match terms win: `28p01` is a stronger signal than `failed`, so a tip keyed on
 * the SQLSTATE outranks one keyed on a generic word.
 */
export function matchTips(all: Tip[], message: string, domain?: TipDomain): Tip[] {
  const low = message.toLowerCase();
  const scored = all
    .filter((t) => !domain || t.domain === domain)
    .map((t) => {
      const hits = t.matches.filter((m) => low.includes(m));
      const score = hits.reduce((best, m) => Math.max(best, m.length), 0);
      return { tip: t, score };
    })
    .filter((s) => s.score > 0);

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.tip);
}

/** Map a log source (`native:db_query`, `native:redis_exec`) onto a domain, when it is unambiguous. */
export function domainForSource(source: string): TipDomain | undefined {
  if (source.includes("redis")) return "redis";
  if (source.includes("docker")) return "docker";
  if (source.includes("mssql")) return "mssql";
  if (source.includes("http") || source.includes("api")) return "http";
  return undefined;
}
