import type { EnvConnection } from "./apiTypes";

/** Database engines supported by the Database Toolkit. */
export type DbEngine = "postgres" | "sqlite" | "mssql" | "mysql" | "oracle";

export const DB_ENGINES: { id: DbEngine; label: string; kind: "server" | "file"; ready: boolean; note?: string }[] = [
  { id: "postgres", label: "PostgreSQL", kind: "server", ready: true },
  { id: "mysql", label: "MySQL / MariaDB", kind: "server", ready: true },
  { id: "mssql", label: "SQL Server", kind: "server", ready: true },
  { id: "sqlite", label: "SQLite", kind: "file", ready: true },
  { id: "oracle", label: "Oracle", kind: "server", ready: false, note: "Requires a build with --features oracle and Oracle Instant Client installed." },
];

/** A saved connection. Passwords are NEVER persisted here — they live in a session-only map. */
export interface DbConnection {
  id: string;
  name: string;
  engine: DbEngine;
  /** server engines */
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  /** sqlite */
  filePath?: string;
  /** SQL Server: use Windows/integrated auth instead of a SQL login */
  integratedSecurity?: boolean;
  /** SQL Server: trust a self-signed server certificate (default true for local dev) */
  trustServerCertificate?: boolean;
  /**
   * SQL Server: request an encrypted connection. Left undefined the driver decides,
   * which is what most local servers want; SSMS strings usually spell it out.
   */
  encrypt?: boolean;
  /** Bypass the individual fields and use a raw, engine-native connection string. */
  usesRawConnString?: boolean;
  /** The raw connection string — session-only, never persisted (may contain a password). */
  rawConnString?: string;
  /** optional environment tag (LOCAL/DEV/QA/UAT/PROD) for grouping + prod warnings */
  environment?: string;
  isProduction?: boolean;
  /** disable execution of destructive statements for this connection */
  safeMode?: boolean;
}

/** Result of running a query. All cell values arrive as strings (or null) — this is a viewer. */
export interface QueryResult {
  columns: string[];
  rows: (string | null)[][];
  rowCount: number;
  elapsedMs: number;
  truncated: boolean;
}

export interface DbObject {
  name: string;
  kind: "table" | "view" | "procedure" | "function";
  schema: string | null;
}

export const DEFAULT_PORTS: Partial<Record<DbEngine, number>> = {
  postgres: 5432,
  mysql: 3306,
  mssql: 1433,
  oracle: 1521,
};

/** Build the engine-specific connection string passed to the native layer. */
export function buildConnString(conn: DbConnection, password: string): string {
  // Raw mode: pass the user's connection string straight through.
  if (conn.usesRawConnString && conn.rawConnString && conn.rawConnString.trim()) return conn.rawConnString.trim();
  if (conn.engine === "sqlite") return conn.filePath ?? "";
  const host = conn.host || "localhost";
  const port = conn.port || DEFAULT_PORTS[conn.engine] || 0;
  const db = conn.database || "";
  const user = encodeURIComponent(conn.user || "");
  const pass = encodeURIComponent(password || "");
  const auth = user ? `${user}${pass ? `:${pass}` : ""}@` : "";
  if (conn.engine === "postgres") {
    return `postgresql://${auth}${host}:${port}/${db}`;
  }
  if (conn.engine === "mysql") {
    return `mysql://${auth}${host}:${port}/${db}`;
  }
  if (conn.engine === "oracle") {
    // user/password@//host:port/service — parsed by the native layer.
    return `${conn.user || ""}/${password || ""}@//${host}:${port}/${db}`;
  }
  // mssql — tiberius ADO connection string. A host written as `HOST\INSTANCE` is passed
  // through with its backslash intact: the native layer resolves the instance's dynamic
  // TCP port via the SQL Browser. An explicit port always wins.
  const server = host.includes("\\")
    ? `Server=${host}${conn.port ? `,${conn.port}` : ""}`
    : `Server=tcp:${host},${port}`;
  const parts = [server, `Database=${db}`];
  if (conn.integratedSecurity) {
    parts.push("IntegratedSecurity=SSPI");
  } else {
    parts.push(`User Id=${conn.user || ""}`, `Password=${password || ""}`);
  }
  parts.push(`TrustServerCertificate=${conn.trustServerCertificate === false ? "false" : "true"}`);
  // Only stated when the user stated it: a server with no certificate configured
  // refuses `Encrypt=true`, so defaulting it either way breaks somebody.
  if (conn.encrypt !== undefined) parts.push(`Encrypt=${conn.encrypt}`);
  return parts.join(";") + ";";
}

/**
 * Fields a connection is missing before it can even be attempted.
 *
 * Drivers report these as opaque failures — tokio-postgres answers a userless URL with
 * "invalid configuration" — so they are caught here and named instead.
 */
export function connectionProblems(conn: DbConnection): string[] {
  const problems: string[] = [];
  if (conn.usesRawConnString) {
    if (!conn.rawConnString?.trim()) problems.push("Connection string is empty.");
    return problems;
  }
  if (conn.engine === "sqlite") {
    if (!conn.filePath?.trim()) problems.push("Database file path is required.");
    return problems;
  }
  if (!conn.host?.trim()) problems.push("Host is required.");
  if (conn.engine !== "mssql" && !conn.user?.trim()) {
    problems.push(`User is required for ${conn.engine === "postgres" ? "PostgreSQL" : conn.engine}.`);
  }
  if (conn.engine === "mssql" && !conn.integratedSecurity && !conn.user?.trim()) {
    problems.push("User is required unless Windows authentication is used.");
  }
  if ((conn.engine === "postgres" || conn.engine === "mysql") && !conn.database?.trim()) {
    problems.push("Database is required.");
  }
  return problems;
}

const ENV_WORDS = /^(local|localhost|dev|development|qa|test|testing|uat|stage|staging|prod|production|sandbox|demo)\b/i;

/**
 * Does this value look like a password typed into a field that gets persisted?
 *
 * Environment, Name and Database are all written to disk. A password landing in one of
 * them is stored in clear text, so it is worth flagging even at the cost of a false
 * positive on an unusual tag.
 */
export function looksLikeSecret(value?: string): boolean {
  const v = (value ?? "").trim();
  if (v.length < 8 || ENV_WORDS.test(v)) return false;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(v)).length;
  return classes >= 3;
}

/** Short human label for a connection's target, safe to show in UI (no secrets). */
export function connTarget(conn: DbConnection): string {
  if (conn.engine === "sqlite") return conn.filePath || "(no file)";
  const host = conn.host || "localhost";
  // A named instance without an explicit port resolves at connect time — showing the
  // default 1433 there would be a lie.
  if (host.includes("\\") && !conn.port) return `${host}/${conn.database || ""}`;
  return `${host}:${conn.port || DEFAULT_PORTS[conn.engine] || "?"}/${conn.database || ""}`;
}

/** Serialize connections for export — strips the session-only raw string (and never had passwords). */
export function serializeConnections(conns: DbConnection[]): string {
  const clean = conns.map(({ rawConnString: _raw, ...c }) => c);
  return JSON.stringify({ version: 1, kind: "devhelper-connections", connections: clean }, null, 2);
}

/** Parse an exported connections file (accepts {connections:[...]} or a bare array). Throws on bad input. */
export function parseConnectionsFile(text: string): DbConnection[] {
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : data?.connections;
  if (!Array.isArray(list)) throw new Error("No 'connections' array found in file");
  const valid = list.filter(
    (c: unknown): c is DbConnection =>
      !!c && typeof (c as DbConnection).name === "string" && typeof (c as DbConnection).engine === "string",
  );
  if (valid.length === 0) throw new Error("File contains no valid connections");
  return valid.map((c) => ({ ...c, rawConnString: undefined }));
}

/** Map a loose engine string (from an env ref) onto a supported DbEngine. */
export function normalizeEngine(v?: string): DbEngine {
  const s = (v || "").toLowerCase();
  if (s.includes("postgre") || s === "pg") return "postgres";
  if (s.includes("mysql") || s.includes("maria")) return "mysql";
  if (s.includes("mssql") || s.includes("sqlserver") || s.includes("sql server") || s === "tds") return "mssql";
  if (s.includes("sqlite")) return "sqlite";
  if (s.includes("oracle")) return "oracle";
  return "postgres";
}

/** Build a DbConnection (minus id) from an environment's typed `database` connection ref. */
export function dbConnectionFromEnvRef(ref: EnvConnection, envName: string): Omit<DbConnection, "id"> {
  const f = ref.fields;
  const engine = normalizeEngine(f.engine);
  return {
    name: `${envName} · ${ref.name}`,
    engine,
    host: f.host || "localhost",
    port: f.port ? Number(f.port) : DEFAULT_PORTS[engine],
    database: f.database || "",
    user: f.user || "",
    filePath: engine === "sqlite" ? f.database || f.filePath || "" : undefined,
    environment: envName,
    isProduction: /prod/i.test(envName),
    safeMode: true,
    trustServerCertificate: true,
  };
}
