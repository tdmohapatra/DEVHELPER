import { describe, it, expect } from "vitest";
import { API_SAMPLES, SAMPLE_CATEGORIES, sampleById, requestFromSample } from "./apiSamples";
import { resolveRequest } from "./apiRequest";

describe("sample catalogue", () => {
  it("has unique ids and names", () => {
    expect(new Set(API_SAMPLES.map((s) => s.id)).size).toBe(API_SAMPLES.length);
    expect(new Set(API_SAMPLES.map((s) => s.name)).size).toBe(API_SAMPLES.length);
  });

  it("uses https everywhere", () => {
    for (const s of API_SAMPLES) expect(s.url.startsWith("https://"), s.id).toBe(true);
  });

  it("describes every sample", () => {
    for (const s of API_SAMPLES) expect(s.description.length, s.id).toBeGreaterThan(25);
  });

  it("assigns every sample to a listed category", () => {
    for (const s of API_SAMPLES) expect(SAMPLE_CATEGORIES, s.id).toContain(s.category);
  });

  it("covers the categories it advertises", () => {
    for (const category of SAMPLE_CATEGORIES) {
      expect(API_SAMPLES.some((s) => s.category === category), category).toBe(true);
    }
  });

  it("carries no API keys beyond NASA's documented demo key", () => {
    for (const s of API_SAMPLES) {
      const hasKey = /api_key=|apikey=|token=/i.test(s.url);
      if (hasKey) expect(s.url, s.id).toContain("DEMO_KEY");
    }
  });
});

describe("requestFromSample", () => {
  it("splits the query string into editable rows", () => {
    const r = requestFromSample(sampleById("open-meteo")!, "r1");
    expect(r.url).toBe("https://api.open-meteo.com/v1/forecast");
    expect(r.query.map((q) => q.key)).toEqual(["latitude", "longitude", "current"]);
    expect(r.query.every((q) => q.enabled)).toBe(true);
  });

  it("rebuilds the original URL when resolved", () => {
    const sample = sampleById("frankfurter")!;
    const resolved = resolveRequest(requestFromSample(sample, "r1"));
    // Parameter values are percent-encoded on the way out — `a,b` becomes `a%2Cb`, which
    // both servers accept — so the round trip is compared after decoding.
    expect(decodeURIComponent(resolved.url)).toBe(sample.url);
  });

  it("keeps the supplied id so the open request is replaced, not orphaned", () => {
    expect(requestFromSample(sampleById("catfact")!, "keep-me").id).toBe("keep-me");
  });

  it("gives assertions stable ids", () => {
    const r = requestFromSample(sampleById("open-meteo")!, "r1");
    expect(r.assertions?.map((a) => a.id)).toEqual(["open-meteo-0", "open-meteo-1"]);
  });

  it("leaves samples without checks with an empty list", () => {
    expect(requestFromSample(sampleById("catfact")!, "r1").assertions).toEqual([]);
  });

  it("builds a JSON body with dynamic variables for the POST sample", () => {
    const r = requestFromSample(sampleById("postman-echo-post")!, "r1");
    expect(r.method).toBe("POST");
    expect(r.bodyType).toBe("json");
    expect(r.body).toContain("{{$guid}}");

    // The dynamic variables must actually resolve when the request is sent.
    const resolved = resolveRequest(r);
    expect(resolved.body).not.toContain("{{$guid}}");
    expect(JSON.parse(resolved.body!).tool).toBe("DevHelper");
  });

  it("leaves GET samples without a body", () => {
    const r = requestFromSample(sampleById("hn-top")!, "r1");
    expect(r.bodyType).toBe("none");
    expect(resolveRequest(r).body).toBeUndefined();
  });

  it("handles a URL with no query string", () => {
    expect(requestFromSample(sampleById("jsonplaceholder")!, "r1").query).toEqual([]);
  });
});

describe("assertions on samples", () => {
  it("checks something meaningful where present", () => {
    const withChecks = API_SAMPLES.filter((s) => s.assertions?.length);
    expect(withChecks.length).toBeGreaterThanOrEqual(4);
    for (const s of withChecks) {
      for (const a of s.assertions!) {
        expect(a.enabled, s.id).toBe(true);
        if (a.kind === "jsonPath") expect(a.target, s.id).toMatch(/^\$/);
      }
    }
  });
});
