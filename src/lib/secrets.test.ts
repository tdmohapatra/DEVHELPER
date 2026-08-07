import { describe, it, expect, beforeEach } from "vitest";
import {
  aiAccount,
  dbAccount,
  deleteSecret,
  getSecret,
  resetSecretsProbe,
  secretsAvailable,
  setSecret,
  storedAccounts,
} from "./secrets";

// jsdom has no Tauri bridge, so every call here takes the browser path. That is
// the path that must not throw or pretend a secret was stored.
beforeEach(resetSecretsProbe);

describe("account naming", () => {
  it("namespaces database and AI accounts so they cannot collide", () => {
    expect(dbAccount("postgres://u@h:5432")).toBe("db:postgres://u@h:5432");
    expect(aiAccount("openai")).toBe("ai:openai");
    expect(dbAccount("openai")).not.toBe(aiAccount("openai"));
  });
});

describe("without a native bridge", () => {
  it("reports no credential store rather than failing", async () => {
    expect(await secretsAvailable()).toBe(false);
  });

  it("reads nothing", async () => {
    expect(await getSecret("db:anything")).toBeNull();
  });

  it("refuses to save, so nobody is told a password was kept when it was not", async () => {
    await expect(setSecret("db:x", "pw")).rejects.toThrow(/desktop app/i);
  });

  it("treats deletion as a no-op", async () => {
    await expect(deleteSecret("db:x")).resolves.toBeUndefined();
  });

  it("finds no stored accounts", async () => {
    expect(await storedAccounts(["db:a", "db:b"])).toEqual([]);
  });
});
