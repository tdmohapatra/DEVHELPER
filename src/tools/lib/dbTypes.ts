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
  // mssql — tiberius ADO connection string. Always host,port (named instances must supply
  // the instance's actual TCP port; SQL Browser auto-resolution is not wired).
  const parts = [`Server=tcp:${host},${port}`, `Database=${db}`];
  if (conn.integratedSecurity) {
    parts.push("IntegratedSecurity=SSPI");
  } else {
    parts.push(`User Id=${conn.user || ""}`, `Password=${password || ""}`);
  }
  parts.push(`TrustServerCertificate=${conn.trustServerCertificate === false ? "false" : "true"}`);
  return parts.join(";") + ";";
}

/** Short human label for a connection's target, safe to show in UI (no secrets). */
export function connTarget(conn: DbConnection): string {
  if (conn.engine === "sqlite") return conn.filePath || "(no file)";
  return `${conn.host || "localhost"}:${conn.port || DEFAULT_PORTS[conn.engine] || "?"}/${conn.database || ""}`;
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
