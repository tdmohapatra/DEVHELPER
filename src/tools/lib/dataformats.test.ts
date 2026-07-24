import { describe, it, expect } from "vitest";
import { validateXml, formatXml, xmlToJson, jsonToXml, minifyXml } from "./xml";
import { validateYaml, yamlToJson, jsonToYaml, formatYaml } from "./yaml";
import { formatSql, isDestructiveSql } from "./sql";

describe("xml", () => {
  it("validates good and bad xml", () => {
    expect(validateXml("<a><b>1</b></a>").valid).toBe(true);
    expect(validateXml("<a><b>1</a>").valid).toBe(false);
  });
  it("formats and minifies round-trip", () => {
    const formatted = formatXml("<a><b>1</b></a>");
    expect(formatted).toContain("\n");
    expect(minifyXml(formatted)).toBe("<a><b>1</b></a>");
  });
  it("converts xml to json and back", () => {
    const json = xmlToJson("<root><n>5</n></root>");
    expect(JSON.parse(json).root.n).toBe(5);
    expect(jsonToXml(json)).toContain("<n>5</n>");
  });
});

describe("yaml", () => {
  it("validates", () => {
    expect(validateYaml("a: 1").valid).toBe(true);
    expect(validateYaml("a: : :").valid).toBe(false);
  });
  it("converts yaml <-> json", () => {
    expect(JSON.parse(yamlToJson("a: 1\nb: two")).b).toBe("two");
    expect(jsonToYaml('{"a":1}')).toContain("a: 1");
  });
  it("formats", () => {
    expect(formatYaml("a:    1")).toBe("a: 1");
  });
});

describe("sql", () => {
  it("formats and uppercases keywords", () => {
    const out = formatSql("select a from t", { language: "sql", uppercase: true, tabWidth: 2 });
    expect(out).toContain("SELECT");
    expect(out).toContain("FROM");
  });
  it("flags destructive statements", () => {
    expect(isDestructiveSql("DROP TABLE users")).toBe(true);
    expect(isDestructiveSql("SELECT * FROM users")).toBe(false);
  });
});
