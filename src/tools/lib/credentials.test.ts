import { describe, it, expect } from "vitest";
import {
  credentialKey,
  credentialLabel,
  credentialsFor,
  findCredential,
  forgetCredential,
  rememberCredential,
  type CredentialVault,
} from "./credentials";
import type { DbConnection } from "./dbTypes";

const conn = (over: Partial<DbConnection> = {}): DbConnection =>
  ({ id: "c1", name: "n", engine: "postgres", host: "db01", port: 5432, user: "postgres", database: "app", ...over }) as DbConnection;

describe("credentialKey", () => {
  it("identifies a server account, not a connection", () => {
    expect(credentialKey(conn())).toBe("postgres://postgres@db01:5432");
  });

  it("is the same key for two databases on one server", () => {
    expect(credentialKey(conn({ database: "app" }))).toBe(credentialKey(conn({ id: "c2", database: "reporting" })));
  });

  it("differs by user, host and port", () => {
    expect(credentialKey(conn({ user: "readonly" }))).not.toBe(credentialKey(conn()));
    expect(credentialKey(conn({ host: "db02" }))).not.toBe(credentialKey(conn()));
    expect(credentialKey(conn({ port: 5433 }))).not.toBe(credentialKey(conn()));
  });

  it("fills in the engine's default port so an implicit port matches an explicit one", () => {
    expect(credentialKey(conn({ port: undefined }))).toBe(credentialKey(conn({ port: 5432 })));
  });

  it("treats the host case-insensitively", () => {
    expect(credentialKey(conn({ host: "DB01" }))).toBe(credentialKey(conn({ host: "db01" })));
  });

  it("returns null where no password applies", () => {
    expect(credentialKey(conn({ engine: "sqlite", filePath: "a.db" }))).toBeNull();
    expect(credentialKey(conn({ engine: "mssql", integratedSecurity: true }))).toBeNull();
    expect(credentialKey(conn({ usesRawConnString: true }))).toBeNull();
    expect(credentialKey(conn({ user: "" }))).toBeNull();
    expect(credentialKey(conn({ host: "" }))).toBeNull();
  });
});

describe("rememberCredential", () => {
  it("stores a verified password under its account key", () => {
    const vault = rememberCredential({}, conn(), "s3cret", 1000);
    expect(vault["postgres://postgres@db01:5432"]).toMatchObject({ password: "s3cret", user: "postgres", verifiedAt: 1000 });
  });

  it("makes the password available to another database on the same server", () => {
    const vault = rememberCredential({}, conn(), "s3cret", 1000);
    const other = conn({ id: "c2", database: "reporting" });
    expect(findCredential(vault, other)?.password).toBe("s3cret");
  });

  it("does not leak across servers", () => {
    const vault = rememberCredential({}, conn(), "s3cret", 1000);
    expect(findCredential(vault, conn({ host: "db02" }))).toBeUndefined();
  });

  it("overwrites an earlier password for the same account", () => {
    let vault = rememberCredential({}, conn(), "old", 1000);
    vault = rememberCredential(vault, conn(), "new", 2000);
    expect(Object.keys(vault)).toHaveLength(1);
    expect(findCredential(vault, conn())).toMatchObject({ password: "new", verifiedAt: 2000 });
  });

  it("ignores an empty password and connections that have no account", () => {
    expect(rememberCredential({}, conn(), "", 1000)).toEqual({});
    expect(rememberCredential({}, conn({ engine: "sqlite" }), "x", 1000)).toEqual({});
  });
});

describe("forgetCredential", () => {
  it("removes one account and leaves the others", () => {
    let vault: CredentialVault = rememberCredential({}, conn(), "a", 1);
    vault = rememberCredential(vault, conn({ host: "db02" }), "b", 2);
    const after = forgetCredential(vault, "postgres://postgres@db01:5432");
    expect(findCredential(after, conn())).toBeUndefined();
    expect(findCredential(after, conn({ host: "db02" }))?.password).toBe("b");
  });
});

describe("credentialLabel", () => {
  it("shows the account without the password", () => {
    const vault = rememberCredential({}, conn(), "s3cret", 1);
    const label = credentialLabel(findCredential(vault, conn())!);
    expect(label).toBe("postgres@db01:5432");
    expect(label).not.toContain("s3cret");
  });
});

describe("credentialsFor", () => {
  it("lists an engine's accounts, most recently verified first", () => {
    let vault = rememberCredential({}, conn(), "a", 1);
    vault = rememberCredential(vault, conn({ host: "db02" }), "b", 5);
    vault = rememberCredential(vault, conn({ engine: "mysql", port: 3306, user: "root" }), "c", 3);

    expect(credentialsFor(vault, "postgres").map((c) => c.host)).toEqual(["db02", "db01"]);
    expect(credentialsFor(vault, "mysql")).toHaveLength(1);
    expect(credentialsFor(vault)).toHaveLength(3);
  });
});
