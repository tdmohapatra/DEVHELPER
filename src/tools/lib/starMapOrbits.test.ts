import { describe, expect, it } from "vitest";

// Same arrangement as starMapMath.test.ts: a classic browser script whose UMD
// wrapper puts the API on window when imported under jsdom.
import "../../../public/gadgets/star-map.x-orbits.js";

const O = (globalThis as unknown as { SMXOrbits: Record<string, any> }).SMXOrbits;

/**
 * Truth, not self-consistency.
 *
 * Every position below was pulled from JPL Horizons for one instant —
 * heliocentric ecliptic J2000, in AU — and pasted here. Testing the maths
 * against its own output would only prove it is repeatable; testing it against
 * the ephemeris the professionals use is what lets the tab claim a distance is
 * right. Re-fetch with EPHEM_TYPE='VECTORS', CENTER='500@10', REF_PLANE='ECLIPTIC'.
 */
const EPOCH = new Date("2026-08-13T00:00:00Z");

const HORIZONS = {
  mercury: { x: 0.11241787, y: 0.28657159, z: 0.01310916 },
  venus: { x: 0.07490340, y: -0.72329925, z: -0.01425917 },
  earth: { x: 0.77526892, y: -0.65240153, z: 0.00003428 },
  mars: { x: 0.75077396, y: 1.29295015, z: 0.00868626 },
  jupiter: { x: -3.19929795, y: 4.21353498, z: 0.05407687 },
  saturn: { x: 9.32163382, y: 1.49815856, z: -0.39714845 },
  uranus: { x: 9.10319851, y: 17.18825815, z: -0.05419874 },
  neptune: { x: 29.84556590, y: 1.22568249, z: -0.71301988 },
};

/**
 * How far each planet is allowed to be from Horizons, in AU.
 *
 * These are the errors actually measured, rounded up — not aspirations. They
 * come from the theory in use: Standish's approximate elements are a low-order
 * fit, and the outer planets drift most because their rates are slowest and
 * their mutual perturbations largest. Earth's floor is set by the elements
 * describing the Earth–Moon barycentre rather than Earth itself, which is 4700
 * km away at most — and 4092 km of the measured error is exactly that.
 *
 * If a change here makes one of these fail, the maths got worse. Do not raise
 * a tolerance to make it pass.
 */
const TOLERANCE_AU = {
  mercury: 0.00005, venus: 0.00005, earth: 0.00005, mars: 0.0005,
  jupiter: 0.004, saturn: 0.015, uranus: 0.008, neptune: 0.007,
};

const apart = (a: any, b: any) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe("planets, against JPL Horizons", () => {
  for (const key of Object.keys(HORIZONS)) {
    it(`puts ${key} where Horizons has it`, () => {
      const error = apart(O.planetPosition(key, EPOCH), (HORIZONS as any)[key]);
      expect(error).toBeLessThan((TOLERANCE_AU as any)[key]);
    });
  }

  it("holds the inner planets to a few thousand kilometres", () => {
    for (const key of ["mercury", "venus", "earth"]) {
      const km = apart(O.planetPosition(key, EPOCH), (HORIZONS as any)[key]) * O.AU_KM;
      expect(km).toBeLessThan(5000);
    }
  });

  it("has Earth near aphelion in August, not perihelion", () => {
    // The distance itself is the check: Earth is furthest from the Sun in early
    // July, so mid-August must still be above 1 AU and below the 1.0167 aphelion.
    const r = O.length(O.planetPosition("earth", EPOCH));
    expect(r).toBeGreaterThan(1.010);
    expect(r).toBeLessThan(1.0167);
  });

  it("returns every planet in one pass, with its distance from the Sun", () => {
    const all = O.planetStates(EPOCH);
    expect(all).toHaveLength(8);
    expect(all.map((p: any) => p.key)).toEqual(O.PLANET_ORDER);
    // Ordered outwards, as the table is.
    const radii = all.map((p: any) => p.sunAu);
    expect([...radii].sort((a: number, b: number) => a - b)).toEqual(radii);
    expect(all[2].name).toBe("Earth");
    expect(all[2].radiusKm).toBe(6371);
  });
});

describe("Kepler's equation", () => {
  it("inverts itself across the range of shapes that orbit the Sun", () => {
    for (const e of [0, 0.0167, 0.2, 0.5, 0.8, 0.95, 0.99]) {
      for (const Mdeg of [0, 17, 90, 179, 181, 270, 359]) {
        const M = (Mdeg * Math.PI) / 180;
        const E = O.eccentricAnomaly(M, e);
        // The equation it claims to have solved, put back together.
        expect(E - e * Math.sin(E)).toBeCloseTo(O.normaliseRadians(M), 9);
      }
    }
  });

  it("is exact for a circle, where the anomalies are the same angle", () => {
    expect(O.eccentricAnomaly(Math.PI / 3, 0)).toBeCloseTo(Math.PI / 3, 12);
  });
});

describe("drawing an orbit", () => {
  const el = { a: 2.5, e: 0.4, i: 12, node: 80, peri: 30, M: 0 };

  it("closes on itself", () => {
    const path = O.orbitPath(el, 120);
    expect(path).toHaveLength(121);
    expect(apart(path[0], path[120])).toBeLessThan(1e-9);
  });

  it("reaches exactly perihelion and aphelion", () => {
    const path = O.orbitPath(el, 720);
    const radii = path.map((p: any) => O.length(p));
    expect(Math.min(...radii)).toBeCloseTo(el.a * (1 - el.e), 6);
    expect(Math.max(...radii)).toBeCloseTo(el.a * (1 + el.e), 6);
  });

  it("tilts the plane by the inclination and no more", () => {
    const path = O.orbitPath(el, 360);
    const highest = Math.max(...path.map((p: any) => Math.abs(p.z)));
    // The furthest out of plane a point can get is a(1+e)·sin i.
    expect(highest).toBeLessThanOrEqual(el.a * (1 + el.e) * Math.sin((el.i * Math.PI) / 180) + 1e-9);
    expect(highest).toBeGreaterThan(0);
  });

  it("gives a flat orbit no thickness", () => {
    const path = O.orbitPath({ ...el, i: 0 }, 90);
    expect(Math.max(...path.map((p: any) => Math.abs(p.z)))).toBeLessThan(1e-12);
  });
});

/**
 * 433 Eros, exactly as the JPL Small-Body Database returns it.
 *
 * Note where the physical data is: `phys_par`, NOT among the orbital elements,
 * and only present when the request asks for it with `phys-par=true`. An earlier
 * version of this fixture put H in `elements`, which is not a shape JPL has ever
 * returned — and the invention hid a real bug, because every object then came
 * back with no size at all.
 */
const EROS_SBDB = {
  object: { des: "433", fullname: "433 Eros (A898 PA)", shortname: "433 Eros", neo: true, pha: false },
  orbit: {
    epoch: "2461200.5",
    elements: [
      { name: "e", value: ".2228779627700761" },
      { name: "a", value: "1.458243716760167" },
      { name: "q", value: "1.133233327946397" },
      { name: "i", value: "10.82854410314273" },
      { name: "om", value: "304.2679713350896" },
      { name: "w", value: "178.9181319135911" },
      { name: "ma", value: "62.51145501986792" },
      { name: "n", value: ".5597046347038453" },
    ],
  },
  phys_par: [
    { name: "H", value: "10.31", title: "absolute magnitude" },
    { name: "diameter", value: "16.84", title: "diameter" },
    { name: "albedo", value: "0.25", title: "geometric albedo" },
    { name: "rot_per", value: "5.27", title: "rotation period" },
    { name: "spec_B", value: "S", title: "SMASSII spectral type" },
  ],
};

describe("small bodies from the JPL database", () => {
  it("reads Eros out of a real SBDB record", () => {
    const el = O.elementsFromSbdb(EROS_SBDB);
    expect(el.a).toBeCloseTo(1.4582437, 6);
    expect(el.e).toBeCloseTo(0.2228780, 6);
    expect(el.name).toBe("433 Eros (A898 PA)");
    expect(el.neo).toBe(true);
    expect(el.pha).toBe(false);
    expect(el.absoluteMagnitude).toBe(10.31);
    // Eros goes round in a little under two years.
    expect(el.periodDays).toBeCloseTo(643.2, 1);
  });

  /**
   * The bug this pins down: H is in `phys_par`, not in `orbit.elements`, so a
   * parser that only reads the elements returns every object with no size at
   * all — which is what the app did until a live check on Apophis showed
   * "0 km across".
   */
  it("reads the physical data out of phys_par, where JPL actually puts it", () => {
    const el = O.elementsFromSbdb(EROS_SBDB);
    expect(el.absoluteMagnitude).toBe(10.31);
    expect(el.diameterKm).toBe(16.84);
    expect(el.diameterMeasured).toBe(true);
    expect(el.albedo).toBe(0.25);
    expect(el.rotationHours).toBe(5.27);
    expect(el.spectralType).toBe("S");
  });

  it("estimates a size from brightness when nothing has measured one", () => {
    const noSize = { ...EROS_SBDB, phys_par: [{ name: "H", value: "10.31" }, { name: "albedo", value: "0.25" }] };
    const el = O.elementsFromSbdb(noSize);
    expect(el.diameterMeasured).toBe(false);
    // The known albedo is used rather than the 0.14 default, which is most of
    // the difference between a guess and a useful number.
    expect(el.diameterKm).toBeCloseTo(23.0, 0);
  });

  it("says nothing about a body nothing is known about", () => {
    const bare = { ...EROS_SBDB, phys_par: undefined };
    const el = O.elementsFromSbdb(bare);
    expect(el.absoluteMagnitude).toBeNull();
    expect(el.diameterKm).toBeNull();
    expect(el.albedo).toBeNull();
    expect(el.spectralType).toBeNull();
    // …but its orbit still works, which is the point.
    expect(el.a).toBeCloseTo(1.4582437, 6);
  });

  it("still finds H in the elements, the way older records carried it", () => {
    const old = {
      ...EROS_SBDB,
      phys_par: undefined,
      orbit: { ...EROS_SBDB.orbit, elements: [...EROS_SBDB.orbit.elements, { name: "H", value: "10.31" }] },
    };
    expect(O.elementsFromSbdb(old).absoluteMagnitude).toBe(10.31);
  });

  it("propagates it to a date and lands within 2000 km of Horizons", () => {
    // Horizons, heliocentric ecliptic, same instant as the planets above.
    const truth = { x: -0.6304667711539695, y: -1.419702486115024, z: -0.2525636187566091 };
    const { position } = O.smallBodyAt(O.elementsFromSbdb(EROS_SBDB), EPOCH);
    const km = apart(position, truth) * O.AU_KM;
    expect(km).toBeLessThan(2000);
  });

  it("moves it with time rather than freezing it at its epoch", () => {
    const el = O.elementsFromSbdb(EROS_SBDB);
    const now = O.smallBodyAt(el, EPOCH).position;
    const later = O.smallBodyAt(el, new Date(+EPOCH + 90 * 86400000)).position;
    // A quarter of a year is a sixth of its orbit: far, but not all the way round.
    expect(apart(now, later)).toBeGreaterThan(0.3);
  });

  it("falls back to Kepler's third law when the record omits mean motion", () => {
    const withoutN = {
      ...EROS_SBDB,
      orbit: { ...EROS_SBDB.orbit, elements: EROS_SBDB.orbit.elements.filter((e) => e.name !== "n") },
    };
    expect(O.elementsFromSbdb(withoutN).meanMotion).toBeCloseTo(0.5597046, 5);
  });

  it("derives the semi-major axis from perihelion when only q is given", () => {
    const withoutA = {
      ...EROS_SBDB,
      orbit: { ...EROS_SBDB.orbit, elements: EROS_SBDB.orbit.elements.filter((e) => e.name !== "a") },
    };
    expect(O.elementsFromSbdb(withoutA).a).toBeCloseTo(1.4582437, 5);
  });

  /**
   * An interstellar object or a fresh comet is not on a closed ellipse, and the
   * maths above would draw a confident, wrong dot for it. Refusing is the honest
   * answer until hyperbolic orbits are actually implemented.
   */
  it("refuses an open orbit instead of drawing a wrong one", () => {
    const oumuamua = {
      object: { des: "1I", fullname: "1I/'Oumuamua" },
      orbit: { epoch: "2458080.5", elements: [
        { name: "e", value: "1.201133" }, { name: "q", value: "0.2559" },
        { name: "i", value: "122.7" }, { name: "om", value: "24.6" },
        { name: "w", value: "241.8" }, { name: "ma", value: "51.1" }] },
    };
    expect(() => O.elementsFromSbdb(oumuamua)).toThrow(/open orbit/);
  });

  it("says so when a record carries no orbit at all", () => {
    expect(() => O.elementsFromSbdb({ object: { des: "x" } })).toThrow(/no orbit/);
  });
});

/** A bulk query answer, exactly as sbdb_query.api returns it. */
const QUERY_FIELDS = ["full_name", "e", "a", "i", "om", "w", "ma", "epoch", "H", "diameter",
  "albedo", "class", "pha", "neo"];
const QUERY_ROWS = [
  ["   433 Eros (A898 PA)", "0.2229", "1.458", "10.83", "304.27", "178.92", "62.51", "2461200.5",
    "10.40", "16.84", "0.25", "AMO", "N", "Y"],
  // Most rows have no measured size or albedo at all.
  ["   719 Albert (A911 TB)", "0.5466", "2.637", "11.57", "183.86", "156.18", "286.68", "2461200.5",
    "15.59", null, null, "AMO", "N", "Y"],
];

describe("thousands of asteroids at once", () => {
  it("reads a bulk query row by field name", () => {
    const el = O.elementsFromQueryRow(QUERY_FIELDS, QUERY_ROWS[0]);
    expect(el.name).toBe("433 Eros (A898 PA)");
    expect(el.a).toBeCloseTo(1.458, 6);
    expect(el.e).toBeCloseTo(0.2229, 6);
    expect(el.i).toBeCloseTo(10.83, 6);
    expect(el.diameterKm).toBe(16.84);
    expect(el.diameterMeasured).toBe(true);
    expect(el.neo).toBe(true);
    expect(el.pha).toBe(false);
    expect(el.orbitClass).toBe("AMO");
  });

  it("estimates a size when the row has none, and says so", () => {
    const el = O.elementsFromQueryRow(QUERY_FIELDS, QUERY_ROWS[1]);
    expect(el.diameterMeasured).toBe(false);
    // H = 15.59 at the default albedo: about three kilometres.
    expect(el.diameterKm).toBeCloseTo(2.8, 0);
  });

  it("computes mean motion from the semi-major axis, since the query omits it", () => {
    const el = O.elementsFromQueryRow(QUERY_FIELDS, QUERY_ROWS[0]);
    expect(el.meanMotion).toBeCloseTo(0.5599, 3);
    expect(el.periodDays).toBeCloseTo(643, 0);
  });

  it("puts a bulk-loaded body in the same place as the detailed record does", () => {
    // The two routes into the same asteroid must agree, or the population and
    // the object you clicked would be drawn in different places.
    const bulk = O.smallBodyAt(O.elementsFromQueryRow(QUERY_FIELDS, QUERY_ROWS[0]), EPOCH).position;
    const detailed = O.smallBodyAt(O.elementsFromSbdb(EROS_SBDB), EPOCH).position;
    // The bulk row is rounded to four figures, so they agree to about that.
    expect(apart(bulk, detailed) * O.AU_KM).toBeLessThan(400000);
  });

  it("drops a row it cannot propagate rather than drawing it wrong", () => {
    const openOrbit = [...QUERY_ROWS[0]];
    openOrbit[1] = "1.2";                                  // hyperbolic
    expect(O.elementsFromQueryRow(QUERY_FIELDS, openOrbit)).toBeNull();

    const missing = [...QUERY_ROWS[0]];
    missing[6] = null;                                     // no mean anomaly
    expect(O.elementsFromQueryRow(QUERY_FIELDS, missing)).toBeNull();
  });
});

describe("the shape of an orbit", () => {
  const eros = () => O.elementsFromSbdb(EROS_SBDB);

  it("names the two ends of the ellipse and how tilted it is", () => {
    const g = O.orbitGeometry(eros());
    expect(g.perihelionAu).toBeCloseTo(1.1332, 3);        // matches JPL's own q
    expect(g.aphelionAu).toBeCloseTo(1.7833, 3);          // and its ad
    expect(g.tiltDegrees).toBeCloseTo(10.83, 2);
    expect(g.shape).toBe("slightly elliptical");
  });

  it("says what a tilt means in distance, not just in degrees", () => {
    const g = O.orbitGeometry(eros());
    // 10.8° at 1.78 AU is a third of an AU out of the plane.
    expect(g.highestAu).toBeCloseTo(1.7833 * Math.sin((10.83 * Math.PI) / 180), 3);
    expect(O.orbitGeometry({ ...eros(), i: 0 }).highestAu).toBe(0);
  });

  it("describes a circle, an ellipse and a comet differently", () => {
    expect(O.orbitGeometry({ a: 1, e: 0.01, i: 0 }).shape).toBe("nearly circular");
    expect(O.orbitGeometry({ a: 2, e: 0.45, i: 0 }).shape).toBe("elliptical");
    expect(O.orbitGeometry({ a: 17, e: 0.967, i: 162 }).shape).toBe("a long, stretched ellipse");
  });

  it("marks perihelion and aphelion at the right distances", () => {
    const el = eros();
    const marks = O.orbitMarkers(el);
    expect(O.length(marks.perihelion)).toBeCloseTo(el.a * (1 - el.e), 6);
    expect(O.length(marks.aphelion)).toBeCloseTo(el.a * (1 + el.e), 6);
    // Opposite ends of the same line through the Sun.
    const dot = marks.perihelion.x * marks.aphelion.x + marks.perihelion.y * marks.aphelion.y
      + marks.perihelion.z * marks.aphelion.z;
    expect(dot).toBeLessThan(0);
  });

  it("works out when a body next reaches its closest to the Sun", () => {
    const el = eros();
    const when = O.nextPerihelion(el, EPOCH);
    expect(when.getTime()).toBeGreaterThan(+EPOCH);
    // Never more than one orbit away.
    expect(when.getTime() - +EPOCH).toBeLessThanOrEqual(el.periodDays * 86400000 + 1000);
    // And at that moment it really is at perihelion.
    const there = O.length(O.smallBodyAt(el, when).position);
    expect(there).toBeCloseTo(el.a * (1 - el.e), 3);
  });
});

describe("what is coming for Earth", () => {
  const FROM = new Date("2026-08-13T00:00:00Z");

  it("finds the full and new moons, about a fortnight apart", () => {
    const moons = O.forecast(FROM, 90).filter((e: any) => e.kind === "moon");
    // Three months is about six of them.
    expect(moons.length).toBeGreaterThanOrEqual(5);
    expect(moons.length).toBeLessThanOrEqual(7);
    for (let i = 1; i < moons.length; i++) {
      const days = (moons[i].when - moons[i - 1].when) / 86400000;
      expect(days).toBeGreaterThan(12);
      expect(days).toBeLessThan(17);
    }
  });

  it("finds Earth's own perihelion in January, not in July", () => {
    const [closest] = O.forecast(FROM, 365).filter((e: any) => e.text.includes("closest to the Sun"));
    expect(closest).toBeTruthy();
    expect(closest.when.getUTCMonth()).toBe(0);
    // 0.983 AU, which is the number that surprises people about winter.
    expect(closest.text).toMatch(/0\.98\d\d AU/);
  });

  it("finds the planets at their closest, and puts them in order of time", () => {
    const events = O.forecast(FROM, 500);
    const closest = events.filter((e: any) => e.kind === "closest");
    expect(closest.length).toBeGreaterThan(3);
    expect(closest.map((e: any) => +e.when)).toEqual([...closest.map((e: any) => +e.when)].sort((a, b) => a - b));
    // Mars comes closest roughly every 26 months, so one in a 500-day window.
    expect(closest.filter((e: any) => e.body === "mars").length).toBeLessThanOrEqual(1);
    // Mercury laps us every four months, so several.
    expect(closest.filter((e: any) => e.body === "mercury").length).toBeGreaterThanOrEqual(3);
  });

  it("returns everything in time order, whatever kind it is", () => {
    const events = O.forecast(FROM, 200);
    expect(events.map((e: any) => +e.when)).toEqual([...events.map((e: any) => +e.when)].sort((a, b) => a - b));
    for (const e of events) expect(e.when.getTime()).toBeGreaterThanOrEqual(+FROM);
  });

  it("has nothing to say about no time at all", () => {
    expect(O.forecast(FROM, 0)).toEqual([]);
  });
});

describe("the Moon", () => {
  it("puts it within a few hundred kilometres of Horizons", () => {
    // Horizons had it at 367 851 km from Earth's centre at this instant.
    expect(O.moonGeocentric(EPOCH).km).toBeCloseTo(367851, -3);
  });

  it("stays inside the real range of the orbit across a month", () => {
    for (let d = 0; d < 30; d++) {
      const { km } = O.moonGeocentric(new Date(+EPOCH + d * 86400000));
      expect(km).toBeGreaterThan(356000);
      expect(km).toBeLessThan(407000);
    }
  });

  it("names the phase from the elongation, and comes full circle in a month", () => {
    const seen = new Set<string>();
    for (let d = 0; d < 30; d++) seen.add(O.moonGeocentric(new Date(+EPOCH + d * 86400000)).phase.name);
    expect(seen.size).toBeGreaterThanOrEqual(6);
    // Illumination is a fraction, always, whatever the phase.
    for (let d = 0; d < 30; d++) {
      const { illuminated } = O.moonGeocentric(new Date(+EPOCH + d * 86400000)).phase;
      expect(illuminated).toBeGreaterThanOrEqual(0);
      expect(illuminated).toBeLessThanOrEqual(1);
    }
  });
});

describe("distances", () => {
  it("quotes one separation in every unit the tab uses", () => {
    const earth = O.planetPosition("earth", EPOCH);
    const mars = O.planetPosition("mars", EPOCH);
    const d = O.separation(earth, mars);
    expect(d.km).toBeCloseTo(d.au * O.AU_KM, 3);
    expect(d.lunarDistances).toBeCloseTo(d.km / 384400, 6);
    expect(d.lightSeconds).toBeCloseTo(d.km / 299792.458, 6);
    // Mars is nearly at right angles from the Sun as seen from Earth at this
    // epoch, and 1.945 AU away — about 16 light-minutes.
    expect(d.au).toBeCloseTo(1.945, 2);
    expect(d.lightSeconds / 60).toBeCloseTo(16.2, 1);
  });

  it("measures the Moon in lunar distances as 1", () => {
    const moon = O.moonGeocentric(EPOCH);
    expect(O.separation(moon.position, { x: 0, y: 0, z: 0 }).lunarDistances).toBeCloseTo(0.956, 2);
  });

  it("says whether a distance is opening or closing, and how fast", () => {
    const earthAt = (t: Date) => O.planetPosition("earth", t);
    const marsAt = (t: Date) => O.planetPosition("mars", t);
    const rate = O.rangeRate(marsAt, earthAt, EPOCH);
    expect(Math.abs(rate.kmPerSecond)).toBeGreaterThan(1);
    expect(Math.abs(rate.kmPerSecond)).toBeLessThan(40);
    // Whichever way it is going, the flag and the sign must agree.
    expect(rate.closing).toBe(rate.kmPerSecond < 0);
  });

  it("agrees with itself over a longer step", () => {
    const earthAt = (t: Date) => O.planetPosition("earth", t);
    const marsAt = (t: Date) => O.planetPosition("mars", t);
    const fine = O.rangeRate(marsAt, earthAt, EPOCH, 5);
    const coarse = O.rangeRate(marsAt, earthAt, EPOCH, 120);
    expect(fine.kmPerSecond).toBeCloseTo(coarse.kmPerSecond, 1);
  });
});

describe("size from brightness", () => {
  it("uses the standard relation, with the albedo it was given", () => {
    // H = 10.31 at the assumed 0.14 albedo gives 30.8 km. Eros is really about
    // 17 km across its longest axis and much narrower the other way, so a single
    // number for a potato is the estimate it is — and its albedo is 0.25, not
    // the 0.14 assumed here, which is most of the gap.
    expect(O.diameterFromMagnitude(10.31)).toBeCloseTo(30.8, 1);
    expect(O.diameterFromMagnitude(10.31, 0.25)).toBeCloseTo(23.0, 0);
    // A darker body of the same brightness has to be bigger.
    expect(O.diameterFromMagnitude(10.31, 0.05)).toBeGreaterThan(O.diameterFromMagnitude(10.31, 0.25));
  });

  it("has nothing to say without a magnitude", () => {
    expect(O.diameterFromMagnitude(null)).toBeNull();
    expect(O.diameterFromMagnitude(undefined)).toBeNull();
  });
});

describe("saying a distance out loud", () => {
  it("switches units as things get further away", () => {
    expect(O.describeDistance(384400)).toContain("1.00 lunar distances");
    expect(O.describeDistance(384400)).toContain("384,400 km");
    expect(O.describeDistance(4.6e6)).toContain("million km");
    expect(O.describeDistance(2.2e8)).toContain("AU");
  });

  it("scales light time the same way", () => {
    expect(O.describeLightTime(1.28)).toBe("1.3 light-seconds");
    expect(O.describeLightTime(500)).toBe("8.3 light-minutes");
    expect(O.describeLightTime(14400)).toBe("4.00 light-hours");
  });

  it("says nothing rather than NaN when it has no number", () => {
    expect(O.describeDistance(NaN)).toBe("—");
    expect(O.describeLightTime(undefined)).toBe("—");
  });
});

describe("time", () => {
  it("puts J2000.0 at its Julian Day, by definition", () => {
    expect(O.julianDay(new Date("2000-01-01T12:00:00Z"))).toBeCloseTo(2451545.0, 9);
    expect(O.centuriesSinceJ2000(new Date("2000-01-01T12:00:00Z"))).toBeCloseTo(0, 12);
  });

  it("counts a Julian century as 36525 days", () => {
    const century = new Date("2000-01-01T12:00:00Z");
    century.setUTCDate(century.getUTCDate() + 36525);
    expect(O.centuriesSinceJ2000(century)).toBeCloseTo(1, 9);
  });
});
