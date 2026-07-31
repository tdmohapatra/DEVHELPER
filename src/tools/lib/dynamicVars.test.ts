import { describe, it, expect } from "vitest";
import { resolveDynamic, isDynamicVar, DYNAMIC_VARS, type DynamicContext } from "./dynamicVars";

/** Deterministic context: fixed clock, a repeating random sequence. */
const ctx = (values: number[] = [0.5]): DynamicContext => {
  let i = 0;
  return { now: () => 1_735_689_600_000, random: () => values[i++ % values.length] };
};

describe("resolveDynamic", () => {
  it("generates a UUID v4 in the right shape", () => {
    const out = resolveDynamic("{{$guid}}", ctx([0.1, 0.9, 0.3, 0.7]));
    expect(out).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("treats $uuid as an alias of $guid", () => {
    expect(resolveDynamic("{{$uuid}}", ctx()).length).toBe(36);
  });

  it("generates a fresh value per occurrence", () => {
    const out = resolveDynamic("{{$guid}} {{$guid}}", ctx([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]));
    const [a, b] = out.split(" ");
    expect(a).not.toBe(b);
  });

  it("writes timestamps in seconds and milliseconds", () => {
    expect(resolveDynamic("{{$timestamp}}", ctx())).toBe("1735689600");
    expect(resolveDynamic("{{$epoch}}", ctx())).toBe("1735689600000");
  });

  it("writes an ISO timestamp", () => {
    expect(resolveDynamic("{{$isoTimestamp}}", ctx())).toBe("2025-01-01T00:00:00.000Z");
  });

  it("generates an integer in the default range", () => {
    const n = Number(resolveDynamic("{{$randomInt}}", ctx([0.5])));
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThanOrEqual(1000);
  });

  it("honours an explicit range", () => {
    expect(resolveDynamic("{{$randomInt:10-10}}", ctx([0.99]))).toBe("10");
    const n = Number(resolveDynamic("{{$randomInt:1-100}}", ctx([0.0])));
    expect(n).toBe(1);
  });

  it("tolerates a reversed range", () => {
    expect(resolveDynamic("{{$randomInt:5-1}}", ctx([0]))).toBe("1");
  });

  it("generates letters of the requested length", () => {
    expect(resolveDynamic("{{$randomAlpha}}", ctx([0.5]))).toHaveLength(8);
    expect(resolveDynamic("{{$randomAlpha:16}}", ctx([0.5]))).toHaveLength(16);
  });

  it("generates an example.com address", () => {
    expect(resolveDynamic("{{$randomEmail}}", ctx([0.5]))).toMatch(/^[a-z]{8}@example\.com$/);
  });

  it("generates a boolean", () => {
    expect(resolveDynamic("{{$randomBoolean}}", ctx([0.1]))).toBe("false");
    expect(resolveDynamic("{{$randomBoolean}}", ctx([0.9]))).toBe("true");
  });

  it("substitutes inside a larger payload", () => {
    const out = resolveDynamic('{"id":"{{$guid}}","at":{{$timestamp}}}', ctx([0.4]));
    expect(out).toMatch(/"at":1735689600}/);
    expect(out).not.toContain("$guid");
  });

  it("leaves environment variables and unknown generators alone", () => {
    expect(resolveDynamic("{{token}} {{$nope}}", ctx())).toBe("{{token}} {{$nope}}");
  });

  it("tolerates whitespace inside the braces", () => {
    expect(resolveDynamic("{{ $timestamp }}", ctx())).toBe("1735689600");
  });
});

describe("isDynamicVar", () => {
  it("recognises generators, with or without an argument", () => {
    expect(isDynamicVar("$guid")).toBe(true);
    expect(isDynamicVar("$randomInt:1-5")).toBe(true);
  });
  it("rejects environment variables and unknown names", () => {
    expect(isDynamicVar("token")).toBe(false);
    expect(isDynamicVar("$nope")).toBe(false);
  });
});

describe("DYNAMIC_VARS", () => {
  it("documents every generator it advertises", () => {
    for (const v of DYNAMIC_VARS) {
      expect(isDynamicVar(v.name), v.name).toBe(true);
      expect(v.description.length).toBeGreaterThan(5);
    }
  });
});
