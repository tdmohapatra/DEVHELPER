import { describe, it, expect } from "vitest";
import { interpolate, usedVariables, hasUnresolved } from "./interpolate";

describe("interpolate", () => {
  it("substitutes known vars", () => {
    expect(interpolate("{{BASE_URL}}/users", { BASE_URL: "https://api.dev" })).toBe("https://api.dev/users");
  });
  it("leaves unknown vars intact", () => {
    expect(interpolate("{{A}}-{{B}}", { A: "1" })).toBe("1-{{B}}");
  });
  it("tolerates whitespace inside braces", () => {
    expect(interpolate("{{ TOKEN }}", { TOKEN: "x" })).toBe("x");
  });
  it("lists used variables", () => {
    expect(usedVariables("{{A}}/{{B}}/{{A}}").sort()).toEqual(["A", "B"]);
  });
  it("detects unresolved", () => {
    expect(hasUnresolved("{{A}}", { B: "1" })).toBe(true);
    expect(hasUnresolved("{{A}}", { A: "1" })).toBe(false);
  });
});
