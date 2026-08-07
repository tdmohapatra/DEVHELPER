import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { DbConnection } from "@/tools/lib/dbTypes";
import {
  credentialKey,
  findCredential,
  forgetCredential,
  rememberCredential,
  type Credential,
  type CredentialVault,
} from "@/tools/lib/credentials";
import { dbAccount, deleteSecret, getSecret, setSecret } from "@/lib/secrets";

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.floor(performance.now())));

export interface DbHistoryEntry {
  id: string;
  connId: string;
  sql: string;
  at: number;
  ok: boolean;
  rowCount?: number;
}

const HISTORY_LIMIT = 50;

interface DbState {
  connections: DbConnection[];
  activeId: string | null;
  history: DbHistoryEntry[];
  /**
   * Session-only passwords, keyed by connection id. NEVER persisted — cleared when the
   * app closes. Secure OS credential storage (DPAPI / Credential Manager) is a later step.
   */
  passwords: Record<string, string>;
  /**
   * Verified passwords keyed by server account (`engine://user@host:port`), so one entry
   * unlocks every connection to that server. Memory only, exactly like `passwords`.
   */
  credentials: CredentialVault;

  upsert: (c: Omit<DbConnection, "id"> & { id?: string }) => string;
  remove: (id: string) => void;
  duplicate: (id: string) => string | null;
  setActive: (id: string | null) => void;
  setPassword: (id: string, password: string) => void;
  getPassword: (id: string) => string;
  clearPasswords: () => void;
  /** Record a password that just opened a connection, and keep it on that connection. */
  rememberCredential: (conn: DbConnection, password: string) => void;
  /** Password already verified for this connection's server account, if any. */
  credentialFor: (conn: DbConnection) => Credential | undefined;
  /** Apply a stored credential to a connection. Returns true when one was found. */
  applyCredential: (conn: DbConnection) => boolean;
  forgetCredential: (key: string) => void;
  clearCredentials: () => void;
  /** Look this connection's password up in the OS credential store, if one was saved there. */
  loadStoredCredential: (conn: DbConnection) => Promise<boolean>;
  pushHistory: (e: Omit<DbHistoryEntry, "id" | "at">) => void;
  clearHistory: (connId: string) => void;
  importConnections: (items: DbConnection[]) => number;
}

export const useDbStore = create<DbState>()(
  persist(
    (set, get) => ({
      connections: [],
      activeId: null,
      history: [],
      passwords: {},
      credentials: {},

      upsert: (c) => {
        const id = c.id ?? uid();
        const record: DbConnection = { ...c, id };
        set((s) => {
          const exists = s.connections.some((x) => x.id === id);
          return {
            connections: exists ? s.connections.map((x) => (x.id === id ? record : x)) : [...s.connections, record],
            activeId: s.activeId ?? id,
          };
        });
        return id;
      },
      remove: (id) =>
        set((s) => {
          const { [id]: _drop, ...restPw } = s.passwords;
          return {
            connections: s.connections.filter((c) => c.id !== id),
            activeId: s.activeId === id ? null : s.activeId,
            passwords: restPw,
          };
        }),
      duplicate: (id) => {
        const src = get().connections.find((c) => c.id === id);
        if (!src) return null;
        const newId = uid();
        set((s) => ({ connections: [...s.connections, { ...src, id: newId, name: `${src.name} (copy)` }] }));
        return newId;
      },
      setActive: (id) => set({ activeId: id }),
      setPassword: (id, password) => set((s) => ({ passwords: { ...s.passwords, [id]: password } })),
      getPassword: (id) => get().passwords[id] ?? "",
      clearPasswords: () => set({ passwords: {}, credentials: {} }),

      rememberCredential: (conn, password) =>
        set((s) => ({
          passwords: { ...s.passwords, [conn.id]: password },
          credentials: rememberCredential(s.credentials, conn, password, Date.now()),
        })),
      credentialFor: (conn) => findCredential(get().credentials, conn),
      applyCredential: (conn) => {
        const cred = findCredential(get().credentials, conn);
        if (!cred) return false;
        set((s) => ({ passwords: { ...s.passwords, [conn.id]: cred.password } }));
        return true;
      },
      forgetCredential: (key) => set((s) => ({ credentials: forgetCredential(s.credentials, key) })),
      /**
       * Pull a password out of the OS credential store into the session vault.
       *
       * Returns true when one was found and applied. Nothing is stored by
       * DevHelper as a result — the session vault is memory only, exactly as
       * before; the OS store is simply another place to be asked.
       */
      loadStoredCredential: async (conn) => {
        const key = credentialKey(conn);
        if (!key) return false;
        const password = await getSecret(dbAccount(key));
        if (password === null) return false;
        set((s) => ({
          passwords: { ...s.passwords, [conn.id]: password },
          credentials: rememberCredential(s.credentials, conn, password, Date.now()),
        }));
        return true;
      },
      clearCredentials: () => set({ credentials: {} }),
      pushHistory: (e) =>
        set((s) => ({
          history: [{ ...e, id: uid(), at: Date.now() }, ...s.history].slice(0, HISTORY_LIMIT),
        })),
      clearHistory: (connId) => set((s) => ({ history: s.history.filter((h) => h.connId !== connId) })),
      importConnections: (items) => {
        const withIds = items.map((c) => ({ ...c, id: uid(), rawConnString: undefined }));
        set((s) => ({ connections: [...s.connections, ...withIds] }));
        return withIds.length;
      },
    }),
    {
      name: "devhelper-db",
      // Persist connection metadata + query history. Passwords, the credential vault, the
      // raw connection string (may contain a password), and the active selection stay in
      // memory only.
      partialize: (s) => ({
        connections: s.connections.map(({ rawConnString: _raw, ...c }) => c),
        history: s.history,
      }),
    },
  ),
);

/**
 * Opt-in persistence of a database password, in the OS credential store.
 *
 * Keyed by server account rather than by connection, matching the session
 * vault: the same login opens every database on that server, so remembering it
 * once covers connections created later. DevHelper still writes nothing itself.
 */
export async function rememberDbPasswordOnMachine(conn: DbConnection, password: string): Promise<void> {
  const key = credentialKey(conn);
  if (!key) throw new Error("This connection has no password to remember.");
  await setSecret(dbAccount(key), password);
}

/** Remove a remembered database password. The session vault is untouched. */
export async function forgetDbPasswordOnMachine(conn: DbConnection): Promise<void> {
  const key = credentialKey(conn);
  if (key) await deleteSecret(dbAccount(key));
}

/** Is this connection's server account remembered on this machine? */
export async function dbPasswordRemembered(conn: DbConnection): Promise<boolean> {
  const key = credentialKey(conn);
  if (!key) return false;
  return (await getSecret(dbAccount(key))) !== null;
}
