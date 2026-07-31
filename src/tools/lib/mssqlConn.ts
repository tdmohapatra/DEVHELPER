/**
 * SQL Server connection helpers.
 *
 * Developers rarely have a host and a port — they have whatever SSMS, a `web.config`
 * or a JDBC URL gave them. These helpers turn any of those into the toolkit's fields so
 * the connection can be saved, tested and edited like any other.
 */

import type { DbConnection } from "./dbTypes";

export interface MssqlInstance {
  server: string;
  instance: string;
  version?: string | null;
  tcpPort?: number | null;
  source: "browser" | "registry";
  /**
   * Local instances only: whether the TCP/IP protocol is enabled. `false` means the
   * engine is running but refuses every TCP driver, which no error message explains.
   */
  tcpEnabled?: boolean | null;
  /** Registry name of a local instance, e.g. `MSSQL17.MSSQLSERVER` — used in fix commands. */
  internalName?: string | null;
}

export interface ParsedConnString {
  /** Fields to merge into a connection. Never contains the password. */
  conn: Partial<DbConnection>;
  /** Password found in the string, kept separate so it stays session-only. */
  password?: string;
  /** Things the user should know — unsupported options, assumptions made. */
  notes: string[];
}

const TRUE_VALUES = new Set(["true", "yes", "sspi", "1"]);

/** `HOST\INSTANCE,1433` → its parts. Accepts a bare host, an instance, a port, or all three. */
export function splitServerAddress(raw: string): { host: string; instance?: string; port?: number } {
  let text = raw.trim().replace(/^tcp:/i, "").trim();
  // `(local)` and `.` are SSMS shorthands for this machine.
  let port: number | undefined;

  const comma = text.lastIndexOf(",");
  if (comma > -1) {
    const maybePort = Number(text.slice(comma + 1).trim());
    if (Number.isInteger(maybePort) && maybePort > 0 && maybePort <= 65535) {
      port = maybePort;
      text = text.slice(0, comma).trim();
    }
  }

  let instance: string | undefined;
  const slash = text.indexOf("\\");
  if (slash > -1) {
    instance = text.slice(slash + 1).trim() || undefined;
    text = text.slice(0, slash).trim();
  }

  const host = /^(\(local\)|\.)$/i.test(text) ? "localhost" : text;
  return { host, instance, port };
}

/** Rejoin a host and instance the way SQL Server names a server. */
export function formatServerAddress(host: string, instance?: string): string {
  return instance && !/^mssqlserver$/i.test(instance) ? `${host}\\${instance}` : host;
}

/** Split `key=value;key=value` respecting quoted values. */
function adoPairs(text: string): [string, string][] {
  const pairs: [string, string][] = [];
  for (const segment of text.split(";")) {
    const eq = segment.indexOf("=");
    if (eq < 0) continue;
    const key = segment.slice(0, eq).trim().toLowerCase();
    const value = segment.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key) pairs.push([key, value]);
  }
  return pairs;
}

/**
 * Parse an ADO.NET / SSMS / JDBC SQL Server connection string into connection fields.
 * Throws when no server can be identified.
 */
export function parseMssqlConnString(text: string): ParsedConnString {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Nothing to parse");

  const conn: Partial<DbConnection> = { engine: "mssql" };
  const notes: string[] = [];
  let password: string | undefined;
  let body = trimmed;
  let jdbcAddress = "";

  // jdbc:sqlserver://HOST\INSTANCE:1433;databaseName=X;user=Y;password=Z
  const jdbc = /^jdbc:sqlserver:\/\/([^;]*)(;.*)?$/i.exec(trimmed);
  if (jdbc) {
    jdbcAddress = jdbc[1].trim();
    body = jdbc[2] ?? "";
  }

  for (const [key, value] of adoPairs(body)) {
    switch (key) {
      case "server":
      case "data source":
      case "addr":
      case "address":
      case "network address":
      case "servername": {
        const { host, instance, port } = splitServerAddress(value);
        conn.host = instance ? formatServerAddress(host, instance) : host;
        if (port) conn.port = port;
        break;
      }
      case "database":
      case "initial catalog":
      case "databasename":
        conn.database = value;
        break;
      case "user id":
      case "userid":
      case "uid":
      case "user":
      case "username":
        conn.user = value;
        break;
      case "password":
      case "pwd":
        password = value;
        break;
      case "integrated security":
      case "trusted_connection":
        conn.integratedSecurity = TRUE_VALUES.has(value.toLowerCase());
        break;
      case "trustservercertificate":
        conn.trustServerCertificate = TRUE_VALUES.has(value.toLowerCase());
        break;
      case "port":
        if (Number(value)) conn.port = Number(value);
        break;
      case "multisubnetfailover":
      case "failover partner":
        notes.push(`"${key}" is not supported and was ignored.`);
        break;
      default:
        break;
    }
  }

  if (jdbcAddress) {
    // The JDBC address uses `host:port`, unlike the ADO `host,port`.
    const colon = jdbcAddress.lastIndexOf(":");
    let addr = jdbcAddress;
    if (colon > -1 && Number(jdbcAddress.slice(colon + 1))) {
      conn.port = Number(jdbcAddress.slice(colon + 1));
      addr = jdbcAddress.slice(0, colon);
    }
    const { host, instance } = splitServerAddress(addr);
    conn.host = instance ? formatServerAddress(host, instance) : host;
  }

  if (!conn.host) throw new Error("No server found — expected Server=, Data Source= or a jdbc:sqlserver:// URL");

  if (conn.integratedSecurity && conn.user) {
    notes.push("Both Windows authentication and a user were given; Windows authentication wins.");
  }
  if (!conn.database) {
    conn.database = "master";
    notes.push("No database in the string — defaulted to master.");
  }
  if (conn.host.includes("\\") && !conn.port) {
    notes.push("Named instance: its TCP port is looked up via the SQL Browser when you connect.");
  }
  if (!conn.host.includes("\\") && !conn.port) {
    conn.port = 1433;
  }
  if (password) {
    notes.push("The password was loaded for this session only and is never written to disk.");
  }

  return { conn, password, notes };
}

/** Explain a connection failure in terms of what to change. */
export function explainMssqlError(message: string): string | null {
  const low = message.toLowerCase();
  if (low.includes("sql browser")) {
    return "Start the 'SQL Server Browser' service (services.msc), or enter the instance's TCP port directly.";
  }
  if (low.includes("refused") || low.includes("10061") || low.includes("no connection could be made")) {
    return "Nothing is listening there. Check the SQL Server service is running and TCP/IP is enabled in SQL Server Configuration Manager, then restart the service.";
  }
  if (low.includes("timed out") || low.includes("10060")) {
    return "The server never answered — likely a firewall, or the wrong host name.";
  }
  if (low.includes("login failed")) {
    return "The server rejected the login. SQL logins need mixed-mode authentication; otherwise switch to Windows authentication.";
  }
  if (low.includes("certificate")) {
    return "Tick 'Trust server certificate' for a self-signed development certificate.";
  }
  if (low.includes("cannot open database")) {
    return "The login worked but the database does not exist or the user has no access to it. Try 'master' first.";
  }
  return null;
}
