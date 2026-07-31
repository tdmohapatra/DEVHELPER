/**
 * Session credential vault.
 *
 * A password belongs to a *server account*, not to a saved connection: the same
 * `postgres@db01:5432` login opens every database on that server. Keying credentials by
 * account means entering the password once covers all of them, including connections
 * created later.
 *
 * Memory only — nothing here is ever written to disk. Entries are recorded only after a
 * connection actually succeeded, so a wrong password is never remembered.
 */

import type { DbConnection, DbEngine } from "./dbTypes";
import { DEFAULT_PORTS } from "./dbTypes";

export interface Credential {
  key: string;
  engine: DbEngine;
  host: string;
  port: number;
  user: string;
  password: string;
  /** When this password last proved itself against a live server. */
  verifiedAt: number;
}

export type CredentialVault = Record<string, Credential>;

/**
 * Identity of the account a password belongs to, or `null` when no password applies —
 * SQLite is a file, Windows authentication carries no password, and a raw connection
 * string already embeds its own credentials.
 */
export function credentialKey(conn: Pick<DbConnection,
  "engine" | "host" | "port" | "user" | "integratedSecurity" | "usesRawConnString">): string | null {
  if (conn.engine === "sqlite" || conn.usesRawConnString) return null;
  if (conn.engine === "mssql" && conn.integratedSecurity) return null;
  const user = conn.user?.trim();
  const host = conn.host?.trim();
  if (!user || !host) return null;
  const port = conn.port || DEFAULT_PORTS[conn.engine] || 0;
  return `${conn.engine}://${user}@${host.toLowerCase()}:${port}`;
}

/** Credential for this connection's account, if one has been verified this session. */
export function findCredential(vault: CredentialVault, conn: DbConnection): Credential | undefined {
  const key = credentialKey(conn);
  return key ? vault[key] : undefined;
}

/** Record a password that just worked. Returns the vault unchanged when none applies. */
export function rememberCredential(
  vault: CredentialVault,
  conn: DbConnection,
  password: string,
  now: number,
): CredentialVault {
  const key = credentialKey(conn);
  if (!key || !password) return vault;
  return {
    ...vault,
    [key]: {
      key,
      engine: conn.engine,
      host: (conn.host ?? "").trim(),
      port: conn.port || DEFAULT_PORTS[conn.engine] || 0,
      user: (conn.user ?? "").trim(),
      password,
      verifiedAt: now,
    },
  };
}

export function forgetCredential(vault: CredentialVault, key: string): CredentialVault {
  const { [key]: _drop, ...rest } = vault;
  return rest;
}

/** `postgres@db01:5432` — safe to show; never includes the password. */
export function credentialLabel(cred: Credential): string {
  return `${cred.user}@${cred.host}:${cred.port}`;
}

/** Vault entries for one engine, most recently verified first. */
export function credentialsFor(vault: CredentialVault, engine?: DbEngine): Credential[] {
  return Object.values(vault)
    .filter((c) => !engine || c.engine === engine)
    .sort((a, b) => b.verifiedAt - a.verifiedAt);
}
