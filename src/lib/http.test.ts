import { describe, it, expect } from "vitest";
import { describeFetchError } from "./http";

const URL = "http://localhost:8222/varz";

describe("describeFetchError", () => {
  it("keeps an Error's own message", () => {
    expect(describeFetchError(new Error("Connection refused"), URL)).toBe(`Connection refused — requesting ${URL}`);
  });

  it("uses a plain string, which is how the Tauri plugin rejects", () => {
    // This is the case that used to print "undefined": reading .message off a string.
    expect(describeFetchError("error sending request for url (http://localhost:8222/varz)", URL)).toContain(
      "error sending request",
    );
  });

  it("reads message or error off an object", () => {
    expect(describeFetchError({ message: "tcp connect error" }, URL)).toBe(`tcp connect error — requesting ${URL}`);
    expect(describeFetchError({ error: "forbidden" }, URL)).toBe(`forbidden — requesting ${URL}`);
  });

  it("falls back to JSON for an object with neither", () => {
    expect(describeFetchError({ code: 111 }, URL)).toBe(`{"code":111} — requesting ${URL}`);
  });

  it("says so when there is no reason at all, rather than printing undefined", () => {
    for (const value of [undefined, null, "", "   ", new Error("")]) {
      const text = describeFetchError(value, URL);
      expect(text, String(value)).toMatch(/without reporting a reason/);
      expect(text).not.toContain("undefined —");
    }
  });

  it("always names the URL, since 'Failed to fetch' does not", () => {
    expect(describeFetchError(new TypeError("Failed to fetch"), URL)).toBe(`Failed to fetch — requesting ${URL}`);
  });

  it("survives an object that cannot be serialised", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(describeFetchError(circular, URL)).toContain("requesting");
  });
});
