import { describe, expect, it } from "vitest";
import { holes, parseExpression, runTransform, SAMPLES, TemplateError, templateExpressions } from "./transform";

const run = (template: unknown, input: unknown) => runTransform(JSON.stringify(template), JSON.stringify(input));

describe("parseExpression", () => {
  it("reads a bare JSONPath", () => {
    expect(parseExpression("$.name[0].family")).toEqual({ path: "$.name[0].family", variable: undefined, steps: [] });
  });

  it("reads a bound variable and rewrites the path to be relative to it", () => {
    expect(parseExpression("row.mrn")).toMatchObject({ variable: "row", path: "$.mrn" });
    expect(parseExpression("row")).toMatchObject({ variable: "row", path: "$" });
    expect(parseExpression("row[0].x")).toMatchObject({ variable: "row", path: "$[0].x" });
  });

  it("reads a pipeline of transforms with arguments", () => {
    const expression = parseExpression("$.dob | hl7DateToIso | prefix(DOB )");
    expect(expression.steps).toEqual([{ kind: "hl7DateToIso", a: undefined, b: undefined }, { kind: "prefix", a: "DOB", b: undefined }]);
  });

  it("builds a lookup table from argument pairs", () => {
    expect(parseExpression("$.sex | lookup(F, female, M, male)").steps).toEqual([
      { kind: "lookup", table: { F: "female", M: "male" } },
    ]);
    expect(() => parseExpression("$.sex | lookup(F)")).toThrow(/takes pairs/);
  });

  it("names an unknown transform rather than failing silently", () => {
    expect(() => parseExpression("$.x | shout")).toThrow(TemplateError);
    expect(() => parseExpression("$.x | shout")).toThrow(/not a known transform/);
  });

  it("rejects an empty expression", () => {
    expect(() => parseExpression("  ")).toThrow(/Empty expression/);
  });
});

describe("holes", () => {
  it("finds every placeholder with its position", () => {
    expect(holes("a {{ x }} b {{ y }}")).toEqual([
      { raw: "x", start: 2, end: 9 },
      { raw: "y", start: 12, end: 19 },
    ]);
    expect(holes("no holes")).toEqual([]);
  });
});

describe("runTransform", () => {
  it("fills a hole from the input", () => {
    const { output } = run({ mrn: "{{ $.id }}" }, { id: "100234" });
    expect(output).toEqual({ mrn: "100234" });
  });

  it("keeps the type when the value is exactly one expression", () => {
    const { output } = run({ count: "{{ $.n }}", flag: "{{ $.b }}", nested: "{{ $.o }}" }, { n: 5, b: true, o: { a: 1 } });
    expect(output).toEqual({ count: 5, flag: true, nested: { a: 1 } });
  });

  it("stringifies when the expression is embedded in text", () => {
    const { output } = run({ label: "MRN {{ $.id }} ({{ $.n }})" }, { id: "100234", n: 5 });
    expect(output).toEqual({ label: "MRN 100234 (5)" });
  });

  it("omits a key whose expression finds nothing, rather than nulling it", () => {
    const { output } = run({ mrn: "{{ $.id }}", phone: "{{ $.telecom[0].value }}" }, { id: "1" });
    expect(output).toEqual({ mrn: "1" });
    expect(Object.keys(output as object)).not.toContain("phone");
  });

  it("renders a missing value as empty inside a longer string", () => {
    const { output } = run({ label: "[{{ $.missing }}]" }, {});
    expect(output).toEqual({ label: "[]" });
  });

  it("applies the transform pipeline", () => {
    const { output } = run({ name: "{{ $.family | titlecase }}", dob: "{{ $.dob | hl7DateToIso }}" }, { family: "sharma", dob: "19750214" });
    expect(output).toEqual({ name: "Sharma", dob: "1975-02-14" });
  });

  it("passes literals through untouched", () => {
    const { output } = run({ resourceType: "Patient", active: true, n: 3 }, {});
    expect(output).toEqual({ resourceType: "Patient", active: true, n: 3 });
  });
});

describe("$each", () => {
  const input = { rows: [{ mrn: "1", family: "a" }, { mrn: "2", family: "b" }] };

  it("repeats the template for each item", () => {
    const { output } = run(
      { entry: { $each: "$.rows[*]", $as: "row", $template: { id: "{{ row.mrn }}", name: "{{ row.family | upper }}" } } },
      input,
    );
    expect(output).toEqual({ entry: [{ id: "1", name: "A" }, { id: "2", name: "B" }] });
  });

  it("accepts the path naming the array as well as its elements", () => {
    const elements = run({ e: { $each: "$.rows[*]", $as: "r", $template: "{{ r.mrn }}" } }, input);
    const whole = run({ e: { $each: "$.rows", $as: "r", $template: "{{ r.mrn }}" } }, input);
    expect(elements.output).toEqual(whole.output);
    expect(elements.output).toEqual({ e: ["1", "2"] });
  });

  it("defaults the binding name when $as is omitted", () => {
    const { output } = run({ e: { $each: "$.rows[*]", $template: "{{ item.mrn }}" } }, input);
    expect(output).toEqual({ e: ["1", "2"] });
  });

  it("gives an empty list when the path matches nothing", () => {
    const { output } = run({ e: { $each: "$.nothing[*]", $as: "r", $template: "{{ r.x }}" } }, input);
    expect(output).toEqual({ e: [] });
  });

  it("says so when $template is missing", () => {
    const { issues } = run({ e: { $each: "$.rows[*]" } }, input);
    expect(issues[0].message).toMatch(/needs a \$template/);
  });

  it("nests, with the outer binding still visible inside", () => {
    const nested = { orders: [{ id: "o1", lines: [{ sku: "a" }, { sku: "b" }] }] };
    const { output } = run(
      {
        o: {
          $each: "$.orders[*]",
          $as: "order",
          $template: {
            id: "{{ order.id }}",
            lines: { $each: "$.orders[0].lines[*]", $as: "line", $template: "{{ order.id }}-{{ line.sku }}" },
          },
        },
      },
      nested,
    );
    expect(output).toEqual({ o: [{ id: "o1", lines: ["o1-a", "o1-b"] }] });
  });

  it("refuses a variable that is not bound here", () => {
    const { issues } = run({ x: "{{ row.mrn }}" }, input);
    expect(issues[0].message).toMatch(/is not bound here/);
  });
});

describe("errors", () => {
  it("collects a bad expression and still produces the rest", () => {
    const { output, issues } = run({ good: "{{ $.a }}", bad: "{{ $.b | shout }}" }, { a: "yes", b: "x" });
    expect(output).toEqual({ good: "yes" });
    expect(issues).toHaveLength(1);
    expect(issues[0].at).toBe("bad");
    expect(issues[0].message).toMatch(/not a known transform/);
  });

  it("says which key failed, using the output path", () => {
    const { issues } = run({ a: { b: { c: "{{ $.x | shout }}" } } }, {});
    expect(issues[0].at).toBe("a.b.c");
  });

  it("reports a transform that threw on the value it was given", () => {
    const { issues } = run({ dob: "{{ $.value | hl7DateToIso }}" }, { value: "not a date" });
    expect(issues[0].message).toMatch(/"not a date"/);
  });

  it("throws for a template or input that is not JSON at all", () => {
    expect(() => runTransform("{oops", "{}")).toThrow(/template is not valid JSON/);
    expect(() => runTransform("{}", "{oops")).toThrow(/input is not valid JSON/);
  });
});

describe("templateExpressions", () => {
  it("lists what the template reads, including the $each paths", () => {
    const expressions = templateExpressions(
      JSON.stringify({ a: "{{ $.x }}", e: { $each: "$.rows[*]", $as: "r", $template: { b: "{{ r.y }}" } } }),
    );
    expect(expressions).toContain("$.x");
    expect(expressions).toContain("$.rows[*]");
    expect(expressions).toContain("{{ r.y }}".slice(2, -2).trim());
  });

  it("returns nothing rather than throwing while a template is being typed", () => {
    expect(templateExpressions("{ not json")).toEqual([]);
  });
});

describe("samples", () => {
  it("every sample runs clean against its own input", () => {
    for (const sample of SAMPLES) {
      const { issues } = runTransform(sample.template, sample.input);
      expect({ name: sample.name, issues }).toEqual({ name: sample.name, issues: [] });
    }
  });

  it("the rows-to-Bundle sample produces a Bundle with one entry per row", () => {
    const bundle = runTransform(SAMPLES[0].template, SAMPLES[0].input).output as {
      resourceType: string;
      entry: { resource: { name: { family: string }[]; birthDate: string; gender: string } }[];
    };
    expect(bundle.resourceType).toBe("Bundle");
    expect(bundle.entry).toHaveLength(2);
    expect(bundle.entry[0].resource.name[0].family).toBe("Sharma");
    expect(bundle.entry[0].resource.birthDate).toBe("1975-02-14");
    expect(bundle.entry[0].resource.gender).toBe("female");
  });

  it("the FHIR-to-row sample omits the field its input does not have", () => {
    const row = runTransform(SAMPLES[1].template, SAMPLES[1].input).output as Record<string, string>;
    expect(row.mrn).toBe("100234");
    expect(row.surname).toBe("SHARMA");
    expect(row.dob).toBe("19750214");
    expect(row.label).toBe("Sharma, Priya (1975-02-14)");
    expect("phone" in row).toBe(false);
  });
});
