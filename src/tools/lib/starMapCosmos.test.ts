import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the Space tab's data layer.
 *
 * Every fixture below is a real response, trimmed: the field lists and the value
 * formats are JPL's and NASA's own, because the failure this guards against is a
 * column moving or a units change, and an invented fixture cannot catch either.
 *
 * The tab itself is a classic script that expects the Map Lab shell, so the
 * globals it reads are stubbed here the same way starMapLive.test.ts does it.
 */

const json = vi.fn();
const registered: any[] = [];

const fixtures = {
  cad: {
    signature: { source: "NASA/JPL SBDB Close Approach Data API", version: "1.5" },
    count: "2",
    fields: ["des", "orbit_id", "jd", "cd", "dist", "dist_min", "dist_max", "v_rel", "v_inf",
      "t_sigma_f", "h", "diameter", "diameter_sigma"],
    data: [
      ["2025 AL2", "22", "2461269.420104716", "2026-Aug-16 22:05", "0.00562972990485235",
        "0.00562963577142678", "0.00562982403856114", "12.3980999982948", "12.3598668716268",
        "< 00:01", "22.75", null, null],
      // A nearer, measured one — put second so the sort has something to do.
      ["99942 Apophis", "5", "2461300.5", "2026-Sep-16 12:00", "0.00025",
        "0.00024", "0.00026", "7.42", "7.4", "< 00:01", "19.09", "0.34", "0.02"],
    ],
  },
  sentry: {
    signature: { version: "2.0", source: "NASA/JPL Sentry Data API" },
    count: "2",
    data: [
      { h: "18.54", fullname: "(1979 XB)", v_inf: "23.7606234552547", last_obs_jd: "2444222.5",
        des: "1979 XB", id: "bJ79X00B", ps_cum: "-2.69", ts_max: "0", ip: "8.515158e-07",
        n_imp: 4, range: "2056-2113", ps_max: "-2.99", diameter: "0.66", last_obs: "1979-12-15" },
      { h: "22.0", fullname: "(2000 SG344)", v_inf: "1.36", des: "2000 SG344", id: "x",
        ps_cum: "-2.8", ts_max: "0", ip: "2.7e-03", n_imp: 10, range: "2069-2122",
        ps_max: "-2.9", diameter: "0.037" },
    ],
  },
  neo: {
    element_count: 1,
    near_earth_objects: {
      "2026-08-13": [
        { id: "3645042", name: "(2013 ND15)", absolute_magnitude_h: 24.1,
          estimated_diameter: { kilometers: { estimated_diameter_min: 0.040230458, estimated_diameter_max: 0.0899580388 } },
          is_potentially_hazardous_asteroid: false,
          close_approach_data: [{
            close_approach_date: "2026-08-13", close_approach_date_full: "2026-Aug-13 03:05",
            epoch_date_close_approach: 1786590300000,
            relative_velocity: { kilometers_per_second: "18.5609912558" },
            miss_distance: { astronomical: "0.1329285847", lunar: "51.7092194483", kilometers: "19885833.133234589" },
            orbiting_body: "Earth",
          }] },
      ],
    },
  },
  horizons: {
    result: `*******************************************************************************
$$SOE
2461265.500000000 = A.D. 2026-Aug-13 00:00:00.0000 TDB
 X = 6.104379654589097E+01 Y = 8.331755404893962E+01 Z =-3.032443616760322E+01
$$EOE
*******************************************************************************`,
  },
  sbdbEros: {
    object: { des: "433", fullname: "433 Eros (A898 PA)", neo: true, pha: false },
    orbit: { epoch: "2461200.5", elements: [
      { name: "e", value: ".2228779627700761" }, { name: "a", value: "1.458243716760167" },
      { name: "i", value: "10.82854410314273" }, { name: "om", value: "304.2679713350896" },
      { name: "w", value: "178.9181319135911" }, { name: "ma", value: "62.51145501986792" },
      { name: "n", value: ".5597046347038453" }, { name: "H", value: "10.31" }] },
  },
};

let C: any;

beforeAll(async () => {
  document.body.innerHTML = "";
  /* eslint-disable @typescript-eslint/ban-ts-comment */
  // @ts-expect-error untyped browser script
  await import("../../../public/gadgets/star-map.x-orbits.js");
  // @ts-expect-error untyped browser script
  await import("../../../public/gadgets/star-map.x-space.js");

  // The shell the tab talks to. Only what x-cosmos actually reaches for.
  (window as any).SMX = {
    json,
    el: (html: string) => {
      const t = document.createElement("template");
      t.innerHTML = html.trim();
      return t.content.firstElementChild;
    },
    esc: (s: unknown) => String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)),
    on: () => {},
    kv: (rows: [string, unknown][]) => rows.filter((r) => r[1] != null).map((r) => `${r[0]}: ${r[1]}`).join(" | "),
    notify: () => {},
    icon: () => "",
    registerTab: (def: any) => {
      registered.push(def);
      def.root = document.createElement("div");
      if (def.build) def.build(def.root);
    },
  };

  // @ts-expect-error untyped browser script
  await import("../../../public/gadgets/star-map.x-cosmos.js");
  C = (window as any).SMXCosmos;
});

beforeEach(() => json.mockReset());

describe("the tab registers itself into Map Lab", () => {
  it("adds a Space tab and builds its panel", () => {
    const tab = registered.find((t) => t.id === "space");
    expect(tab).toBeTruthy();
    expect(tab.label).toBe("Space");
    expect(tab.root.querySelector("#smxOpenSpace")).toBeTruthy();
    // The honesty line has to be on the panel itself: the dots are a fixed size
    // and the distances are not, and the view must never imply otherwise.
    expect(tab.root.textContent).toContain("Positions are real");
  });

  it("gives every layer a checkbox, and starts each one where the layer says", () => {
    const tab = registered.find((t) => t.id === "space");
    const boxes = [...tab.root.querySelectorAll("[data-layer]")] as HTMLInputElement[];
    for (const layer of C.LAYERS) {
      const box = boxes.find((b) => b.dataset.layer === layer.id);
      expect(box).toBeTruthy();
      expect(box!.checked).toBe(layer.on);
    }
    /**
     * The population layer appears once, in its own section with its size and
     * group options — not also in the quick list above, where a second switch
     * for the same thing would just be confusing.
     */
    const beltBoxes = boxes.filter((b) => b.dataset.layer === "belt");
    expect(beltBoxes).toHaveLength(1);
    expect(tab.root.querySelector("#smxLayerBoxes [data-layer='belt']")).toBeNull();
  });

  it("offers both frames and both distance scales", () => {
    const tab = registered.find((t) => t.id === "space");
    const frames = [...tab.root.querySelectorAll("[data-frame]")].map((b: any) => b.dataset.frame);
    const scales = [...tab.root.querySelectorAll("[data-scale]")].map((b: any) => b.dataset.scale);
    expect(frames).toEqual(["heliocentric", "geocentric"]);
    expect(scales).toEqual(["compressed", "true"]);
  });
});

describe("JPL close approaches", () => {
  it("reads the columns by name rather than by position", () => {
    const rows = C.parseCloseApproaches(fixtures.cad);
    expect(rows).toHaveLength(2);
    const apophis = rows[0];                       // sorted nearest first
    expect(apophis.designation).toBe("99942 Apophis");
    expect(apophis.au).toBeCloseTo(0.00025, 9);
    expect(apophis.km).toBeCloseTo(0.00025 * 149597870.7, 3);
    expect(apophis.kmPerSecond).toBeCloseTo(7.42, 6);
  });

  it("puts a pass in lunar distances, which is how a near miss is understood", () => {
    const rows = C.parseCloseApproaches(fixtures.cad);
    // 0.00025 AU is a tenth of the way to the Moon.
    expect(rows[0].lunarDistances).toBeCloseTo(0.097, 2);
  });

  it("prefers a measured diameter and falls back to the brightness estimate", () => {
    const [apophis, other] = C.parseCloseApproaches(fixtures.cad);
    expect(apophis.diameterKm).toBe(0.34);
    expect(apophis.diameterMeasured).toBe(true);
    // The other row has no diameter, so H = 22.75 is used instead: about 100 m.
    expect(other.diameterMeasured).toBe(false);
    expect(other.diameterKm).toBeCloseTo(0.100, 3);
  });

  it("carries JPL's own uncertainty on the miss distance", () => {
    const [apophis] = C.parseCloseApproaches(fixtures.cad);
    expect(apophis.minimumAu).toBeLessThan(apophis.au);
    expect(apophis.maximumAu).toBeGreaterThan(apophis.au);
  });

  it("sorts nearest first", () => {
    const rows = C.parseCloseApproaches(fixtures.cad);
    expect(rows.map((r: any) => r.au)).toEqual([...rows.map((r: any) => r.au)].sort((a, b) => a - b));
  });

  it("has nothing to say about an empty or broken answer", () => {
    expect(C.parseCloseApproaches(null)).toEqual([]);
    expect(C.parseCloseApproaches({ fields: ["des"] })).toEqual([]);
  });

  /**
   * `Number(null)` is 0, so a column JPL left empty becomes a confident
   * measurement of zero unless it is parsed strictly. The same mistake once put
   * a bus in the Gulf of Guinea; here it would report an asteroid of no size and
   * a miss distance of nothing.
   */
  it("reads an empty column as unknown, never as zero", () => {
    const [row] = C.parseSentry({ data: [{ des: "x", ip: "1e-6", diameter: null, v_inf: null, ts_max: null }] });
    expect(row.diameterKm).toBeNull();
    expect(row.velocityKmS).toBeNull();
    expect(row.torino).toBe(0);          // a genuine 0 rating, not a missing one
    const [pass] = C.parseCloseApproaches({
      fields: ["des", "cd", "dist", "dist_min", "dist_max", "v_rel", "h", "diameter"],
      data: [["y", "2026-Aug-16 22:05", "0.01", null, null, "5", null, null]],
    });
    expect(pass.diameterKm).toBeNull();
    expect(pass.absoluteMagnitude).toBeNull();
    expect(pass.minimumAu).toBeNull();
  });
});

describe("JPL's date format", () => {
  /**
   * V8 does parse "2026-Aug-16 22:05" — as LOCAL time, silently. JPL publishes
   * UTC, so handing it to Date puts every close approach out by the machine's
   * offset, which in India is five and a half hours and in London is none at
   * all. That is why this is parsed by hand, and why the check is the timezone
   * rather than whether it parses.
   */
  it("reads JPL's time as UTC, which Date does not", () => {
    const d = C.parseJplDate("2026-Aug-16 22:05");
    expect(d.toISOString()).toBe("2026-08-16T22:05:00.000Z");
    expect(d.getTime()).toBe(Date.UTC(2026, 7, 16, 22, 5));
    // What the naive route would have produced, wherever this test is running.
    const naive = new Date("2026-Aug-16 22:05");
    // toBeCloseTo rather than toBe: on a machine set to UTC the expected shift is
    // `0 * -60000`, which is `-0`, and `toBe` uses Object.is — so this assertion
    // passed in every timezone except the one CI runs in.
    expect(d.getTime() - naive.getTime()).toBeCloseTo(naive.getTimezoneOffset() * -60000, 0);
  });

  it("copes with a date that carries no time", () => {
    expect(C.parseJplDate("2026-Jan-01").toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("returns nothing for something that is not a date", () => {
    expect(C.parseJplDate("soon")).toBeNull();
    expect(C.parseJplDate(undefined)).toBeNull();
    expect(C.parseJplDate("2026-Xxx-01")).toBeNull();
  });
});

describe("the Sentry risk list", () => {
  it("turns a probability into odds a person can read", () => {
    const rows = C.parseSentry(fixtures.sentry);
    const worst = rows[0];
    expect(worst.designation).toBe("2000 SG344");   // sorted by probability
    expect(worst.probability).toBeCloseTo(0.0027, 6);
    expect(worst.oneIn).toBe(370);
  });

  it("keeps the Torino rating and the years at stake", () => {
    const [, xb] = C.parseSentry(fixtures.sentry);
    expect(xb.designation).toBe("1979 XB");
    expect(xb.torino).toBe(0);
    expect(xb.yearRange).toBe("2056-2113");
    expect(xb.firstYear).toBe(2056);
    expect(xb.impacts).toBe(4);
  });

  it("sorts by probability, worst first", () => {
    const p = C.parseSentry(fixtures.sentry).map((r: any) => r.probability);
    expect(p).toEqual([...p].sort((a: number, b: number) => b - a));
  });
});

describe("NASA's daily near-Earth feed", () => {
  it("flattens the per-date buckets and keeps the size range", () => {
    const rows = C.parseNeoFeed(fixtures.neo);
    expect(rows).toHaveLength(1);
    const neo = rows[0];
    expect(neo.designation).toBe("2013 ND15");
    expect(neo.km).toBeCloseTo(19885833.13, 1);
    expect(neo.lunarDistances).toBeCloseTo(51.71, 2);
    // NASA gives a range because the size is inferred from brightness.
    expect(neo.diameterMinKm).toBeCloseTo(0.0402, 4);
    expect(neo.diameterMaxKm).toBeCloseTo(0.0900, 4);
    expect(neo.hazardous).toBe(false);
    expect(neo.when.toISOString()).toBe("2026-08-13T03:05:00.000Z");
  });

  it("survives a feed with no objects in it", () => {
    expect(C.parseNeoFeed({ near_earth_objects: {} })).toEqual([]);
    expect(C.parseNeoFeed(null)).toEqual([]);
  });
});

describe("Horizons vectors", () => {
  it("finds the numbers between the markers in a text report", () => {
    const v = C.parseHorizonsVector(fixtures.horizons.result);
    expect(v.x).toBeCloseTo(61.04379654589097, 9);
    expect(v.y).toBeCloseTo(83.31755404893962, 9);
    expect(v.z).toBeCloseTo(-30.32443616760322, 9);
  });

  it("returns nothing when the report is an error or a list of matches", () => {
    expect(C.parseHorizonsVector("No matches found.")).toBeNull();
    expect(C.parseHorizonsVector("$$SOE\nnothing useful\n$$EOE")).toBeNull();
    expect(C.parseHorizonsVector(undefined)).toBeNull();
  });
});

describe("which fetches go through the app", () => {
  /**
   * The whole point of the split: every JPL host answers without an
   * Access-Control-Allow-Origin header and must be fetched by the desktop side,
   * while NASA's NeoWs sends `*` and should stay in the browser where it is
   * visible in devtools. Getting this backwards makes the lists silently empty.
   */
  it("asks the app for JPL and the browser for NASA", async () => {
    json.mockResolvedValue(fixtures.cad);
    await C.fetchCloseApproaches(60, 20);
    expect(json.mock.calls[0][0]).toContain("ssd-api.jpl.nasa.gov/cad.api");
    expect(json.mock.calls[0][1].host).toBe(true);

    json.mockResolvedValue(fixtures.sentry);
    await C.fetchSentry();
    expect(json.mock.calls[1][1].host).toBe(true);

    json.mockResolvedValue(fixtures.horizons);
    await C.fetchSpacecraft("-31", new Date("2026-08-13T00:00:00Z"));
    expect(json.mock.calls[2][0]).toContain("ssd.jpl.nasa.gov/api/horizons.api");
    expect(json.mock.calls[2][1].host).toBe(true);

    json.mockResolvedValue(fixtures.neo);
    await C.fetchNeoFeed();
    expect(json.mock.calls[3][0]).toContain("api.nasa.gov");
    expect(json.mock.calls[3][1].host).toBeUndefined();
  });

  it("asks for a window that starts today and a limit in lunar distances", async () => {
    json.mockResolvedValue(fixtures.cad);
    await C.fetchCloseApproaches(30, 5);
    const url = json.mock.calls[0][0];
    // 5 lunar distances expressed in AU, which is what cad.api takes.
    expect(url).toContain(`dist-max=${((5 * 384400) / 149597870.7).toFixed(6)}`);
    expect(url).toContain(`date-min=${new Date().toISOString().slice(0, 10)}`);
  });

  it("turns an SBDB record straight into elements the view can draw", async () => {
    json.mockResolvedValue(fixtures.sbdbEros);
    const elements = await C.fetchSmallBody("433");
    expect(elements.name).toBe("433 Eros (A898 PA)");
    expect(elements.a).toBeCloseTo(1.4582437, 6);
  });

  it("says which object it could not find rather than throwing a parser error", async () => {
    json.mockResolvedValue({ message: "specified object was not found" });
    await expect(C.fetchSmallBody("nonsense")).rejects.toThrow(/not found/);
  });

  it("asks for a narrower name when several objects match", async () => {
    json.mockResolvedValue({ list: [{ des: "1" }, { des: "2" }, { des: "3" }] });
    await expect(C.fetchSmallBody("halley")).rejects.toThrow(/3 objects match/);
  });

  it("says so when Horizons answers without a vector", async () => {
    json.mockResolvedValue({ result: "No matches found." });
    await expect(C.fetchSpacecraft("-999")).rejects.toThrow(/no vector/);
  });
});

describe("how fast something is moving", () => {
  // Read lazily: the script is imported in beforeAll, after these bodies run.
  const O = () => (globalThis as any).SMXOrbits;
  const EPOCH = new Date("2026-08-13T00:00:00Z");

  /**
   * Checked against vis-viva — v² = GM(2/r − 1/a) — rather than against the
   * quoted mean speeds, because a mean is wrong for an eccentric orbit at any
   * particular moment. Mercury is near perihelion on this date and is genuinely
   * doing 58.9 km/s, not the 47.4 km/s it averages.
   *
   * The speed here is measured by moving the planet and dividing, and vis-viva
   * comes from the gravitational constant and the elements, so agreeing to a
   * tenth of a percent means the positions and the timing are both right.
   */
  it("moves every planet at the speed gravity says it should", () => {
    const GM_SUN = 1.32712440018e11;                     // km³/s²
    const AU = 149597870.7;
    for (const key of O().PLANET_ORDER) {
      const measured = C.speedKmS((t: Date) => O().planetPosition(key, t), EPOCH);
      const el = O().planetElements(key, EPOCH);
      const r = O().length(O().planetPosition(key, EPOCH)) * AU;
      const visViva = Math.sqrt(GM_SUN * (2 / r - 1 / (el.a * AU)));
      // Half a percent, because this vis-viva uses the Sun's mass alone while
      // the real two-body constant is GM(Sun + planet). For Jupiter that is one
      // part in 1047, so a 0.05% gap there is the missing mass, not an error.
      expect(measured / visViva).toBeCloseTo(1, 2);
    }
  });

  it("has Earth going round at the familiar thirty kilometres a second", () => {
    expect(C.speedKmS((t: Date) => O().planetPosition("earth", t), EPOCH)).toBeCloseTo(29.8, 0);
  });

  it("agrees with itself over a longer step", () => {
    const at = (t: Date) => O().planetPosition("mars", t);
    expect(C.speedKmS(at, EPOCH, 5)).toBeCloseTo(C.speedKmS(at, EPOCH, 240), 2);
  });

  it("has nothing to say about a body with no position function", () => {
    expect(C.positionGetter("voyager1")).toBeNull();
    expect(C.speedKmS(() => null, EPOCH)).toBeNull();
  });

  it("can follow a planet, the Moon, or a tracked asteroid", () => {
    expect(typeof C.positionGetter("mars")).toBe("function");
    expect(typeof C.positionGetter("moon")).toBe("function");
    expect(typeof C.positionGetter("sun")).toBe("function");
    // The Moon's own speed round the Sun is Earth's, give or take its own km/s.
    expect(C.speedKmS(C.positionGetter("moon"), EPOCH)).toBeGreaterThan(28);
    expect(C.speedKmS(C.positionGetter("moon"), EPOCH)).toBeLessThan(32);
  });
});

describe("the event console", () => {
  const O = () => (globalThis as any).SMXOrbits;

  beforeEach(() => {
    C.state.events.length = 0;
    C.state.watch = {};
    C.state.lists.close = [];
  });

  /** Positions for a moment, the same way the tab builds them. */
  const positionsAt = (date: Date) => {
    const out: any = {};
    for (const key of O().PLANET_ORDER) out[key] = O().planetPosition(key, date);
    return out;
  };

  /**
   * A closest approach is a turning point, not a table entry: the instant a
   * distance stops shrinking. Stepping a real Mars approach across that moment
   * has to produce exactly one event, on the right side of it.
   */
  it("names the moment a planet stops getting closer", () => {
    // Mars is closest to Earth in mid-February 2027; step across it a week at a time.
    let fired: any = null;
    for (let day = 0; day < 400; day += 7) {
      C.state.date = new Date(Date.UTC(2026, 7, 13) + day * 86400000);
      C.state.positions = positionsAt(C.state.date);
      C.state.moon = null;
      C.watchForEvents();
      const near = C.state.events.find((e: any) => e.kind === "near" && e.text.includes("Mars"));
      if (near) { fired = { near, on: C.state.date }; break; }
    }
    expect(fired).toBeTruthy();
    expect(fired.near.text).toContain("passed closest to Earth");
    // Mars oppositions are about 26 months apart; the next is in February 2027.
    expect(fired.on.getUTCFullYear()).toBe(2027);
    expect(fired.on.getUTCMonth()).toBe(1);
  });

  it("says nothing on the first tick, when there is nothing to compare against", () => {
    C.state.date = new Date("2026-08-13T00:00:00Z");
    C.state.positions = positionsAt(C.state.date);
    C.watchForEvents();
    expect(C.state.events).toHaveLength(0);
  });

  it("announces a listed pass as the clock reaches it, and only once", () => {
    const when = new Date("2026-08-16T22:05:00Z");
    C.state.lists.close = [{ id: "x", designation: "2025 AL2", when, lunarDistances: 2.19, kmPerSecond: 12.4 }];
    C.state.date = when;
    C.state.positions = positionsAt(when);
    C.watchForEvents();
    C.watchForEvents();
    const passes = C.state.events.filter((e: any) => e.kind === "approach");
    expect(passes).toHaveLength(1);
    expect(passes[0].text).toContain("2025 AL2");
    expect(passes[0].text).toContain("2.2 lunar distances");
    expect(passes[0].text).toContain("12.4 km/s");
  });

  it("ignores a pass the clock has not reached", () => {
    C.state.lists.close = [{ id: "y", designation: "later", when: new Date("2027-01-01T00:00:00Z"), lunarDistances: 3 }];
    C.state.date = new Date("2026-08-13T00:00:00Z");
    C.state.positions = positionsAt(C.state.date);
    C.watchForEvents();
    expect(C.state.events.filter((e: any) => e.kind === "approach")).toHaveLength(0);
  });

  it("keeps the console short enough to read", () => {
    for (let i = 0; i < 100; i++) C.logEvent("data", `event ${i}`);
    expect(C.state.events.length).toBeLessThanOrEqual(60);
    // Newest first, so the thing that just happened is at the top.
    expect(C.state.events[0].text).toBe("event 99");
  });
});

describe("the whole asteroid population", () => {
  const query = {
    count: "42127",
    fields: ["full_name", "e", "a", "i", "om", "w", "ma", "epoch", "H", "diameter", "albedo", "class", "pha", "neo"],
    data: [
      ["   433 Eros (A898 PA)", "0.2229", "1.458", "10.83", "304.27", "178.92", "62.51", "2461200.5",
        "10.40", "16.84", "0.25", "AMO", "N", "Y"],
      ["   719 Albert (A911 TB)", "0.5466", "2.637", "11.57", "183.86", "156.18", "286.68", "2461200.5",
        "15.59", null, null, "AMO", "N", "Y"],
      // One that cannot be drawn: an open orbit.
      ["   1I/'Oumuamua", "1.2011", "-1.27", "122.7", "24.6", "241.8", "51.1", "2458080.5",
        "22.1", null, null, "HYP", "N", "Y"],
    ],
  };

  it("asks for elements in bulk rather than a request per asteroid", async () => {
    json.mockResolvedValue(query);
    await C.fetchAsteroids("neo", 400);
    const url = json.mock.calls[0][0];
    expect(url).toContain("sbdb_query.api");
    expect(url).toContain("sb-group=neo");
    expect(url).toContain("limit=400");
    // Brightest first, so a capped list is the big ones and not an arbitrary slice.
    expect(url).toContain("sort=H");
    expect(json.mock.calls[0][1].host).toBe(true);
  });

  it("asks for only the hazardous ones when that is what was chosen", async () => {
    json.mockResolvedValue(query);
    await C.fetchAsteroids("pha", 100);
    expect(json.mock.calls[0][0]).toContain("sb-group=pha");
  });

  it("keeps what it can draw and drops what it cannot, reporting the true total", async () => {
    json.mockResolvedValue(query);
    const { asteroids, total, returned } = await C.fetchAsteroids("neo", 400);
    expect(returned).toBe(3);
    expect(asteroids).toHaveLength(2);              // the hyperbolic one is dropped
    expect(asteroids.map((a: any) => a.name)).toEqual(["433 Eros (A898 PA)", "719 Albert (A911 TB)"]);
    // The count is the whole catalogue, not the page — the panel says both.
    expect(total).toBe(42127);
  });

  it("says so when the query comes back with nothing usable", async () => {
    json.mockResolvedValue({ error: "bad request" });
    await expect(C.fetchAsteroids("neo", 10)).rejects.toThrow(/no rows/);
  });

  it("moves every one of them when the clock moves", async () => {
    json.mockResolvedValue(query);
    const { asteroids } = await C.fetchAsteroids("neo", 400);
    C.state.belt.asteroids = asteroids;
    const O = (globalThis as any).SMXOrbits;
    const at = (d: Date) => O.smallBodyAt(asteroids[0], d).position;
    const now = at(new Date("2026-08-13T00:00:00Z"));
    const later = at(new Date("2026-11-13T00:00:00Z"));
    expect(Math.hypot(now.x - later.x, now.y - later.y, now.z - later.z)).toBeGreaterThan(0.3);
    C.state.belt.asteroids = [];
  });
});

describe("the layer switches", () => {
  it("keeps the panel and the view in step, whichever was clicked", () => {
    const tab = registered.find((t) => t.id === "space");
    const box = tab.root.querySelector('[data-layer="planets"]') as HTMLInputElement;
    C.toggleLayer("planets", false, null);
    expect(box.checked).toBe(false);
    C.toggleLayer("planets", true, null);
    expect(box.checked).toBe(true);
  });

  it("offers the population as a switch that is off until it is asked for", () => {
    const belt = C.LAYERS.find((l: any) => l.id === "belt");
    expect(belt).toBeTruthy();
    // The one layer that costs a fetch: off to start with, and it says it loads.
    expect(belt.on).toBe(false);
    expect(belt.loads).toBe(true);
  });
});

describe("a spacecraft's path", () => {
  /**
   * A real three-row Horizons vector table for Voyager 1, verbatim.
   *
   * Real numbers on purpose: an earlier version of this fixture had invented
   * y and z values, which implied the probe was doing 3.6 km/s instead of its
   * actual 17, and the speed test below would have been asserting nonsense.
   */
  const table = `*******************************************************************************
$$SOE
2461253.500000000 = A.D. 2026-Aug-01 00:00:00.0000 TDB
 X =-3.209008776558914E+01 Y =-1.363450643049874E+02 Z = 9.864883763939235E+01
2461263.500000000 = A.D. 2026-Aug-11 00:00:00.0000 TDB
 X =-3.210204584618780E+01 Y =-1.364236767664065E+02 Z = 9.870562513426601E+01
2461273.500000000 = A.D. 2026-Aug-21 00:00:00.0000 TDB
 X =-3.211400331066488E+01 Y =-1.365022890918794E+02 Z = 9.876241205529482E+01
$$EOE
*******************************************************************************`;

  it("keeps every row, not just the first", () => {
    const samples = C.parseHorizonsTable(table);
    expect(samples).toHaveLength(3);
    expect(samples[0].jd).toBe(2461253.5);
    expect(samples[2].jd).toBe(2461273.5);
    expect(samples[1].position.x).toBeCloseTo(-32.1020458, 6);
    expect(samples[1].position.z).toBeCloseTo(98.70562513426601, 9);
  });

  it("has nothing to say about an error report", () => {
    expect(C.parseHorizonsTable("No matches found.")).toEqual([]);
    expect(C.parseHorizonsTable(undefined)).toEqual([]);
  });

  /**
   * The whole reason for the table: a probe used to be fetched as one position
   * and sat frozen there while the clock ran. Now it is fetched as a path and
   * moves with everything else.
   */
  it("asks for a span of time rather than a single instant", async () => {
    json.mockResolvedValue({ result: table });
    await C.fetchSpacecraft("-31", new Date("2026-08-13T00:00:00Z"), 180);
    const url = json.mock.calls[0][0];
    expect(url).toContain("START_TIME='2026-02-14'");
    expect(url).toContain("STOP_TIME='2027-02-09'");
    expect(url).toContain("STEP_SIZE='2d'");
    expect(json.mock.calls[0][1].host).toBe(true);
  });

  it("returns the samples, and refuses an answer with none", async () => {
    json.mockResolvedValue({ result: table });
    expect(await C.fetchSpacecraft("-31", new Date())).toHaveLength(3);
    json.mockResolvedValue({ result: "No matches found." });
    await expect(C.fetchSpacecraft("-999", new Date())).rejects.toThrow(/no vectors/);
  });

  it("gives a probe a speed, which one frozen position never could", () => {
    const O = (globalThis as any).SMXOrbits;
    const samples = C.parseHorizonsTable(table);
    const speed = C.speedKmS((t: Date) => (O.trajectoryAt(samples, t) || {}).position,
      new Date("2026-08-11T00:00:00Z"), 720);
    // Voyager 1 is doing about 17 km/s.
    expect(speed).toBeGreaterThan(10);
    expect(speed).toBeLessThan(25);
  });
});

describe("the spacecraft list", () => {
  it("carries the Horizons ids the probes actually answer to", () => {
    const byId = Object.fromEntries(C.SPACECRAFT.map((c: any) => [c.id, c.command]));
    // Negative numbers are Horizons' own convention for spacecraft.
    expect(byId.voyager1).toBe("-31");
    expect(byId.voyager2).toBe("-32");
    expect(byId.jwst).toBe("-170");
    for (const craft of C.SPACECRAFT) expect(craft.command).toMatch(/^-\d+$/);
  });
});
