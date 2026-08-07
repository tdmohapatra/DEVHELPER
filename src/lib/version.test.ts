import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { APP_VERSION } from "./workspace";

/**
 * The app's version lives in two places and they have to agree.
 *
 * `tauri.conf.json` is what names the installers and the release;
 * `APP_VERSION` is what the UI shows and what a workspace backup is stamped
 * with. Drift means a backup claims to come from a build that never existed,
 * and Settings reports a version nobody shipped.
 *
 * Cheaper to catch here than to notice after a release.
 */
describe("version", () => {
  it("matches the version in tauri.conf.json", () => {
    const conf = JSON.parse(readFileSync(resolve(__dirname, "../../src-tauri/tauri.conf.json"), "utf8"));
    expect(APP_VERSION).toBe(conf.version);
  });

  it("is a plain three-part version", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
