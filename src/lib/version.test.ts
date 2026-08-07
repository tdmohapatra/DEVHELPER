import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { APP_VERSION } from "./workspace";

/**
 * The app's version lives in two places and they have to agree.
 *
 * `tauri.conf.json` is what the updater compares a release against;
 * `APP_VERSION` is what the UI shows and what a workspace backup is stamped
 * with. If they drift, the app either offers an update to the version it
 * already is, or reports itself as current when it is not — both of which look
 * like the updater being broken rather than like a forgotten edit.
 *
 * Cheaper to catch here than to notice after a release.
 */
describe("version", () => {
  it("matches the version in tauri.conf.json", () => {
    const conf = JSON.parse(readFileSync(resolve(__dirname, "../../src-tauri/tauri.conf.json"), "utf8"));
    expect(APP_VERSION).toBe(conf.version);
  });

  it("is a plain three-part version, which is what the updater compares", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

/**
 * The updater is only as trustworthy as its configuration, and every one of
 * these has a failure mode that looks like something else.
 */
describe("updater configuration", () => {
  const conf = JSON.parse(
    readFileSync(resolve(__dirname, "../../src-tauri/tauri.conf.json"), "utf8"),
  ) as {
    plugins?: { updater?: { pubkey?: string; endpoints?: string[] } };
    bundle?: { createUpdaterArtifacts?: boolean };
  };

  it("has a public key, without which every update is refused", () => {
    expect(conf.plugins?.updater?.pubkey).toBeTruthy();
  });

  it("has at least one endpoint, without which the check reports unconfigured", () => {
    expect(conf.plugins?.updater?.endpoints?.length).toBeGreaterThan(0);
  });

  it("points at a latest.json, which is the file the feed actually serves", () => {
    for (const endpoint of conf.plugins!.updater!.endpoints!) {
      expect(endpoint).toMatch(/latest\.json$/);
    }
  });

  it("emits updater artifacts, or the release has no latest.json to serve", () => {
    expect(conf.bundle?.createUpdaterArtifacts).toBe(true);
  });

  it("does not contain a private key — only the public half belongs in the repo", () => {
    // A minisign private key file starts with this comment. Committing one would
    // let anyone sign an update this app installs without complaint.
    const raw = readFileSync(resolve(__dirname, "../../src-tauri/tauri.conf.json"), "utf8");
    expect(raw).not.toMatch(/minisign encrypted secret key/i);
  });
});
