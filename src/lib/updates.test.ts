import { describe, it, expect } from "vitest";
import { checkForUpdate, isUnconfigured } from "./updates";

describe("isUnconfigured", () => {
  it("recognises the plugin's way of saying no feed is set", () => {
    expect(isUnconfigured("Updater is not configured")).toBe(true);
    expect(isUnconfigured("updater: no endpoint provided")).toBe(true);
    expect(isUnconfigured("the endpoints list is empty")).toBe(true);
  });

  it("does not swallow a genuine failure", () => {
    // These mean the check ran and went wrong, which is worth reporting as an
    // error rather than as a setup step nobody has done.
    expect(isUnconfigured("network error: connection refused")).toBe(false);
    expect(isUnconfigured("signature verification failed")).toBe(false);
    expect(isUnconfigured("404 Not Found")).toBe(false);
  });
});

describe("checkForUpdate", () => {
  it("says so outside the desktop app rather than erroring", async () => {
    // jsdom has no Tauri bridge, so this is the browser-dev path.
    const state = await checkForUpdate("0.1.0");
    expect(state.kind).toBe("unsupported");
  });
});
