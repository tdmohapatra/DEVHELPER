import { describe, it, expect } from "vitest";
import {
  validateFhirResource,
  analyzeBundle,
  collectReferences,
  extractTable,
  resourcesOf,
  toCsv,
  buildSearchUrl,
  DEFAULT_COLUMNS,
  FHIR_SERVERS,
  COMMON_SEARCH_PARAMS,
  FhirParseError,
} from "./fhirAdvanced";

const patient = {
  resourceType: "Patient",
  id: "p1",
  name: [{ family: "Doe", given: ["John"] }],
  gender: "male",
  birthDate: "1985-02-15",
};

const observation = {
  resourceType: "Observation",
  id: "o1",
  status: "final",
  code: { coding: [{ system: "http://loinc.org", code: "718-7", display: "Hemoglobin" }] },
  subject: { reference: "Patient/p1" },
  valueQuantity: { value: 13.5, unit: "g/dL" },
};

const bundle = {
  resourceType: "Bundle",
  type: "transaction",
  entry: [
    { fullUrl: "urn:uuid:1", resource: patient, request: { method: "PUT", url: "Patient/p1" } },
    { fullUrl: "urn:uuid:2", resource: observation, request: { method: "POST", url: "Observation" } },
  ],
};

describe("validateFhirResource", () => {
  it("accepts valid resources", () => {
    expect(validateFhirResource(patient)).toEqual([]);
    expect(validateFhirResource(observation)).toEqual([]);
  });

  it("reports missing required elements", () => {
    const issues = validateFhirResource({ resourceType: "Observation", id: "x" });
    expect(issues.map((i) => i.message).join(" ")).toMatch(/requires 'status'/);
    expect(issues.map((i) => i.message).join(" ")).toMatch(/requires 'code'/);
    expect(issues[0].location).toBe("$.status");
  });

  it("rejects an invalid status value", () => {
    const issues = validateFhirResource({ ...observation, status: "done" });
    expect(issues[0].message).toMatch(/not a valid Observation.status/);
  });

  it("rejects an invalid Bundle type", () => {
    expect(validateFhirResource({ resourceType: "Bundle", type: "batchy" })[0].message).toMatch(/not a valid Bundle.type/);
  });

  it("rejects a malformed birthDate", () => {
    expect(validateFhirResource({ ...patient, birthDate: "15/02/1985" })[0].message).toMatch(/birthDate must be/);
  });

  it("requires a timezone on dateTime elements", () => {
    const issues = validateFhirResource({ ...observation, effectiveDateTime: "2026-07-31" });
    expect(issues[0].message).toMatch(/full dateTime with a timezone/);
    expect(validateFhirResource({ ...observation, effectiveDateTime: "2026-07-31T09:00:00Z" })).toEqual([]);
  });

  it("warns about a coding with no system", () => {
    const issues = validateFhirResource({ ...observation, code: { coding: [{ code: "718-7" }] } });
    expect(issues[0]).toMatchObject({ severity: "warning" });
    expect(issues[0].message).toMatch(/no 'system'/);
  });

  it("reports a missing resourceType", () => {
    expect(validateFhirResource({ id: "x" })[0].message).toMatch(/Missing 'resourceType'/);
  });

  it("warns for a resource it has no rules for", () => {
    expect(validateFhirResource({ resourceType: "Goal", id: "g" })[0].severity).toBe("warning");
  });

  it("rejects a non-object", () => {
    expect(validateFhirResource("nope")[0].message).toMatch(/Not a JSON object/);
  });
});

describe("analyzeBundle", () => {
  const analysis = analyzeBundle(JSON.stringify(bundle));

  it("summarises type and entry counts", () => {
    expect(analysis.type).toBe("transaction");
    expect(analysis.entryCount).toBe(2);
    expect(analysis.counts).toEqual([
      { resourceType: "Patient", count: 1 },
      { resourceType: "Observation", count: 1 },
    ]);
  });

  it("describes each entry, including its request", () => {
    expect(analysis.entries[0]).toMatchObject({ resourceType: "Patient", id: "p1", request: "PUT Patient/p1" });
  });

  it("resolves references satisfied inside the bundle", () => {
    expect(analysis.unresolved).toEqual([]);
  });

  it("reports a reference the bundle cannot satisfy", () => {
    const broken = JSON.parse(JSON.stringify(bundle));
    broken.entry[1].resource.subject.reference = "Patient/missing";
    const out = analyzeBundle(JSON.stringify(broken));
    expect(out.unresolved).toEqual([{ from: "$.entry[1].resource", reference: "Patient/missing" }]);
  });

  it("ignores absolute references to other servers", () => {
    const external = JSON.parse(JSON.stringify(bundle));
    external.entry[1].resource.subject.reference = "https://other.example/fhir/Patient/9";
    expect(analyzeBundle(JSON.stringify(external)).unresolved).toEqual([]);
  });

  it("flags duplicate fullUrl values", () => {
    const dup = JSON.parse(JSON.stringify(bundle));
    dup.entry[1].fullUrl = "urn:uuid:1";
    expect(analyzeBundle(JSON.stringify(dup)).duplicateUrls).toEqual(["urn:uuid:1"]);
  });

  it("requires a request on every entry of a transaction", () => {
    const noRequest = JSON.parse(JSON.stringify(bundle));
    delete noRequest.entry[0].request;
    expect(analyzeBundle(JSON.stringify(noRequest)).issues.map((i) => i.message).join(" ")).toMatch(/requires 'request'/);
  });

  it("surfaces per-entry validation issues", () => {
    const invalid = JSON.parse(JSON.stringify(bundle));
    delete invalid.entry[1].resource.status;
    expect(analyzeBundle(JSON.stringify(invalid)).entries[1].issues[0].message).toMatch(/requires 'status'/);
  });

  it("handles an empty bundle", () => {
    const empty = analyzeBundle(JSON.stringify({ resourceType: "Bundle", type: "searchset", entry: [] }));
    expect(empty.entryCount).toBe(0);
    expect(empty.counts).toEqual([]);
  });

  it("rejects input that is not a bundle", () => {
    expect(() => analyzeBundle(JSON.stringify(patient))).toThrow(FhirParseError);
    expect(() => analyzeBundle("{oops")).toThrow(/valid JSON/);
  });
});

describe("collectReferences", () => {
  it("finds references at any depth", () => {
    expect(collectReferences({ a: { b: [{ reference: "Patient/1" }] }, c: { reference: "Encounter/2" } }).sort()).toEqual([
      "Encounter/2",
      "Patient/1",
    ]);
  });
  it("returns nothing for a resource with no references", () => {
    expect(collectReferences(patient)).toEqual([]);
  });
});

describe("extractTable", () => {
  it("flattens resources into rows using the default columns", () => {
    const rows = extractTable([patient], DEFAULT_COLUMNS.Patient);
    expect(rows[0]).toEqual(["p1", "Doe", "John", "male", "1985-02-15"]);
  });

  it("leaves a cell empty when the path matches nothing", () => {
    const rows = extractTable([{ resourceType: "Patient", id: "p2" }], DEFAULT_COLUMNS.Patient);
    expect(rows[0]).toEqual(["p2", "", "", "", ""]);
  });

  it("stringifies non-string values", () => {
    const rows = extractTable([observation], DEFAULT_COLUMNS.Observation);
    expect(rows[0][4]).toBe("13.5");
  });

  it("survives an invalid path expression", () => {
    expect(extractTable([patient], [{ header: "bad", path: "$.[" }])[0]).toEqual([""]);
  });
});

describe("resourcesOf", () => {
  it("unwraps a bundle", () => {
    expect(resourcesOf(JSON.stringify(bundle)).map((r) => r.resourceType)).toEqual(["Patient", "Observation"]);
  });
  it("wraps a single resource", () => {
    expect(resourcesOf(JSON.stringify(patient))).toHaveLength(1);
  });
  it("returns nothing for a non-resource", () => {
    expect(resourcesOf(JSON.stringify({ foo: 1 }))).toEqual([]);
  });
});

describe("toCsv", () => {
  it("quotes values containing commas or quotes", () => {
    const csv = toCsv(["a", "b"], [["plain", 'has,comma and "quote"']]);
    expect(csv.split("\n")[1]).toBe('plain,"has,comma and ""quote"""');
  });
});

describe("buildSearchUrl", () => {
  it("builds a search from enabled parameters", () => {
    const url = buildSearchUrl("https://hapi.fhir.org/baseR4", "Patient", [
      { name: "family", value: "Doe", enabled: true },
      { name: "_count", value: "10", enabled: true },
      { name: "gender", value: "male", enabled: false },
    ]);
    expect(url).toBe("https://hapi.fhir.org/baseR4/Patient?family=Doe&_count=10");
  });

  it("omits the query when nothing is set", () => {
    expect(buildSearchUrl("https://hapi.fhir.org/baseR4/", "Observation", [])).toBe("https://hapi.fhir.org/baseR4/Observation");
  });

  it("encodes values", () => {
    const url = buildSearchUrl("https://x/fhir", "Patient", [{ name: "name", value: "John Doe", enabled: true }]);
    expect(url).toContain("name=John%20Doe");
  });

  it("skips parameters with an empty name or value", () => {
    const url = buildSearchUrl("https://x/fhir", "Patient", [
      { name: "", value: "x", enabled: true },
      { name: "family", value: "  ", enabled: true },
    ]);
    expect(url).toBe("https://x/fhir/Patient");
  });
});

describe("server and parameter catalogues", () => {
  it("lists only https R4 endpoints with descriptions", () => {
    for (const s of FHIR_SERVERS) {
      expect(s.baseUrl.startsWith("https://"), s.id).toBe(true);
      expect(s.description.length, s.id).toBeGreaterThan(15);
    }
    expect(new Set(FHIR_SERVERS.map((s) => s.id)).size).toBe(FHIR_SERVERS.length);
  });

  it("offers search parameters for the resources it knows", () => {
    for (const [resource, params] of Object.entries(COMMON_SEARCH_PARAMS)) {
      expect(params.length, resource).toBeGreaterThan(2);
      expect(params, resource).toContain("_count");
    }
  });
});
