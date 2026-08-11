import { describe, expect, it } from "vitest";

// The Star Map add-on maths ships as a classic browser script (it is loaded by
// public/gadgets/star-map.html, which has no bundler). Importing it under jsdom
// runs its UMD wrapper, which puts the API on window.
import "../../../public/gadgets/star-map.x-math.js";

const M = (globalThis as unknown as { SMXMath: Record<string, any> }).SMXMath;

const BLR = { lat: 12.9716, lng: 77.5946 };
const MAA = { lat: 13.0827, lng: 80.2707 };

/** A straight west→east path of `n` points spaced ~`stepDeg` apart. */
function line(n: number, stepDeg = 0.01) {
  return Array.from({ length: n }, (_, i) => ({ lat: 12.9716, lng: 77.5946 + i * stepDeg }));
}

describe("geodesy", () => {
  it("measures the Bengaluru → Chennai great circle at 290.2 km", () => {
    expect(M.haversine(BLR, MAA) / 1000).toBeCloseTo(290.2, 1);
  });

  it("accepts both {lat,lng} and [lat,lng] points", () => {
    expect(M.haversine(BLR, MAA)).toBeCloseTo(M.haversine([BLR.lat, BLR.lng], [MAA.lat, MAA.lng]), 6);
  });

  it("bearings north, east, south and west", () => {
    expect(M.bearing(BLR, { lat: 13.5, lng: 77.5946 })).toBeCloseTo(0, 1);
    expect(M.bearing(BLR, { lat: 12.4, lng: 77.5946 })).toBeCloseTo(180, 1);
    // Due east along a parallel, the initial great-circle bearing is slightly
    // north of 90° in the northern hemisphere (and mirrored going west).
    expect(M.bearing(BLR, { lat: 12.9716, lng: 78.2 })).toBeCloseTo(89.93, 2);
    expect(M.bearing(BLR, { lat: 12.9716, lng: 77.0 })).toBeCloseTo(270.07, 2);
  });

  it("round-trips destination() against haversine and bearing", () => {
    const p = M.destination(BLR, 42, 5000);
    expect(M.haversine(BLR, p)).toBeCloseTo(5000, 0);
    expect(M.bearing(BLR, p)).toBeCloseTo(42, 1);
  });

  it("builds cumulative distances that start at zero and end at the total", () => {
    const pts = line(5);
    const cum = M.cumulative(pts);
    expect(cum[0]).toBe(0);
    expect(cum[4]).toBeCloseTo(M.haversine(pts[0], pts[1]) * 4, 0);
    for (let i = 1; i < cum.length; i++) expect(cum[i]).toBeGreaterThan(cum[i - 1]);
  });

  it("interpolates the midpoint of a path and clamps beyond both ends", () => {
    const pts = line(3);
    const cum = M.cumulative(pts);
    const mid = M.pointAt(pts, cum, cum[2] / 2);
    expect(mid.lng).toBeCloseTo(pts[1].lng, 5);
    expect(M.pointAt(pts, cum, -500).lng).toBeCloseTo(pts[0].lng, 6);
    expect(M.pointAt(pts, cum, cum[2] + 500).lng).toBeCloseTo(pts[2].lng, 6);
  });

  it("slices the travelled part up to the current head", () => {
    const pts = line(4);
    const cum = M.cumulative(pts);
    const part = M.sliceTo(pts, cum, cum[3] * 0.5);
    expect(part.length).toBe(3); // two whole vertices plus the interpolated head
    // Half of a three-segment path lands mid-way through the second segment.
    expect(part[2].lng).toBeCloseTo((pts[1].lng + pts[2].lng) / 2, 4);
  });

  it("resamples to an exact count spanning the whole path", () => {
    const pts = line(7);
    const cum = M.cumulative(pts);
    const s = M.resample(pts, cum, 50);
    expect(s).toHaveLength(50);
    expect(s[0].dist).toBe(0);
    expect(s[49].dist).toBeCloseTo(cum[6], 6);
  });
});

describe("traffic model", () => {
  it("is deterministic for the same seed and segment", () => {
    const opts = { enabled: true, hour: 18, seed: 7, segment: 12, point: BLR };
    expect(M.trafficFactor(opts)).toBe(M.trafficFactor({ ...opts }));
  });

  it("does nothing when disabled", () => {
    expect(M.trafficFactor({ enabled: false, hour: 18, seed: 1, segment: 1 })).toBe(1);
  });

  it("slows rush hour more than the small hours", () => {
    const at = (hour: number) =>
      Array.from({ length: 40 }, (_, i) => M.trafficFactor({ enabled: true, hour, seed: 3, segment: i, point: BLR }))
        .reduce((a, b) => a + b, 0) / 40;
    expect(at(18)).toBeLessThan(at(3));
    expect(M.rushFactor(8.5)).toBeGreaterThan(M.rushFactor(13));
    expect(M.rushFactor(3)).toBeLessThan(0.1);
  });

  it("lets a congestion zone override an otherwise clear road", () => {
    const clear = M.trafficFactor({ enabled: true, hour: 3, seed: 1, segment: 4, point: BLR });
    const jammed = M.trafficFactor({
      enabled: true, hour: 3, seed: 1, segment: 4, point: BLR,
      zones: [{ lat: BLR.lat, lng: BLR.lng, radius: 800, severity: 0.95 }],
    });
    expect(jammed).toBeLessThan(clear);
    expect(jammed).toBeLessThan(0.4);
  });

  it("ignores a zone the point is outside of", () => {
    const far = { lat: BLR.lat + 1, lng: BLR.lng + 1, radius: 500, severity: 1 };
    expect(M.trafficFactor({ enabled: true, hour: 3, seed: 1, segment: 4, point: BLR, zones: [far] }))
      .toBe(M.trafficFactor({ enabled: true, hour: 3, seed: 1, segment: 4, point: BLR }));
  });

  it("bands factors from free-flowing to jammed", () => {
    expect(M.congestionBand(1)).toBe(0);
    expect(M.congestionBand(0.7)).toBe(1);
    expect(M.congestionBand(0.5)).toBe(2);
    expect(M.congestionBand(0.2)).toBe(3);
  });
});

describe("simulation schedule", () => {
  const pts = line(11, 0.005);
  const cum = M.cumulative(pts);

  it("takes distance / speed when traffic is off", () => {
    const s = M.buildSchedule({ points: pts, cum, baseSpeed: 10 });
    expect(s.duration).toBeCloseTo(s.distance / 10, 3);
    expect(s.freeFlowDuration).toBeCloseTo(s.duration, 3);
  });

  it("scales with the agent's own speed factor", () => {
    const fast = M.buildSchedule({ points: pts, cum, baseSpeed: 10, speedScale: 2 });
    const slow = M.buildSchedule({ points: pts, cum, baseSpeed: 10, speedScale: 0.5 });
    expect(fast.duration).toBeCloseTo(slow.duration / 4, 2);
  });

  it("prefers per-segment router speeds over the fallback", () => {
    const speeds = new Array(pts.length - 1).fill(20);
    const s = M.buildSchedule({ points: pts, cum, baseSpeed: 5, speeds });
    expect(s.duration).toBeCloseTo(s.distance / 20, 2);
  });

  it("caps segment speed, so a car-profile route walked stays a walking pace", () => {
    const speeds = new Array(pts.length - 1).fill(22);      // motorway speeds
    const car = M.buildSchedule({ points: pts, cum, speeds });
    const walk = M.buildSchedule({ points: pts, cum, speeds, baseSpeed: 1.35, maxSpeed: 1.6 });
    expect(walk.duration).toBeCloseTo(walk.distance / 1.6, 2);
    expect(walk.duration).toBeGreaterThan(car.duration * 10);
    expect(walk.freeFlowDuration).toBeCloseTo(walk.duration, 3);
  });

  it("caps the fallback speed too when no router speeds came back", () => {
    const s = M.buildSchedule({ points: pts, cum, baseSpeed: 13.9, maxSpeed: 1.6 });
    expect(s.duration).toBeCloseTo(s.distance / 1.6, 2);
  });

  it("takes longer with traffic on, and records a factor per segment", () => {
    const free = M.buildSchedule({ points: pts, cum, baseSpeed: 14, startHour: 18 });
    const jam = M.buildSchedule({
      points: pts, cum, baseSpeed: 14, startHour: 18,
      traffic: { enabled: true, seed: 5, severity: 1 },
    });
    expect(jam.duration).toBeGreaterThan(free.duration);
    expect(jam.freeFlowDuration).toBeCloseTo(free.duration, 3);
    expect(jam.factors).toHaveLength(pts.length - 1);
    expect(Math.min(...jam.factors)).toBeGreaterThan(0.17);
  });

  it("maps time to distance monotonically, honouring the departure offset", () => {
    const s = M.buildSchedule({ points: pts, cum, baseSpeed: 10, departAt: 600 });
    expect(M.distanceAtTime(s, 0)).toBe(0);
    expect(M.distanceAtTime(s, 600)).toBe(0);
    expect(M.distanceAtTime(s, 600 + s.duration / 2)).toBeCloseTo(s.distance / 2, 0);
    expect(M.distanceAtTime(s, 600 + s.duration + 999)).toBeCloseTo(s.distance, 6);
    let prev = -1;
    for (let t = 0; t < 600 + s.duration; t += 7) {
      const d = M.distanceAtTime(s, t);
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
  });

  it("reports zero speed before departure and after arrival", () => {
    const s = M.buildSchedule({ points: pts, cum, baseSpeed: 10, departAt: 100 });
    expect(M.speedAtTime(s, 50)).toBe(0);
    expect(M.speedAtTime(s, 100 + s.duration + 1)).toBe(0);
    expect(M.speedAtTime(s, 100 + s.duration / 2)).toBeCloseTo(10, 1);
  });
});

describe("agents, encounters and arrivals", () => {
  const pts = line(21, 0.004);
  const cum = M.cumulative(pts);
  const agent = (id: string, departAt: number, speedScale = 1, points = pts, c = cum) => ({
    id, name: id, points,
    schedule: M.buildSchedule({ points, cum: c, baseSpeed: 12, speedScale, departAt }),
  });

  it("describes an agent's state through waiting → moving → arrived", () => {
    const a = agent("A", 300);
    expect(M.stateAt(a, 0).phase).toBe("waiting");
    const mid = M.stateAt(a, 300 + a.schedule.duration / 2);
    expect(mid.phase).toBe("moving");
    expect(mid.progress).toBeCloseTo(0.5, 1);
    expect(mid.bearing).toBeCloseTo(90, 0);
    expect(mid.remaining).toBeCloseTo(a.schedule.distance / 2, 0);
    expect(M.stateAt(a, 300 + a.schedule.duration + 5).phase).toBe("arrived");
  });

  it("finds an encounter when two agents share a road at the same time", () => {
    const found = M.encounters([agent("A", 0), agent("B", 0)], { threshold: 100, step: 5 });
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].distance).toBeLessThanOrEqual(100);
    expect(found[0].aName).toBe("A");
  });

  it("finds none when the same route is walked hours apart", () => {
    expect(M.encounters([agent("A", 0), agent("B", 36000)], { threshold: 100, step: 5 })).toHaveLength(0);
  });

  it("finds the overtake point when a fast agent starts behind a slow one", () => {
    const found = M.encounters([agent("slow", 0, 0.5), agent("fast", 600, 2)], { threshold: 150, step: 2 });
    expect(found.length).toBeGreaterThan(0);
    // The pass happens after the fast agent departs and before it arrives.
    expect(found[0].t).toBeGreaterThan(600);
  });

  it("ranks arrivals and reports how far behind the leader each one is", () => {
    const order = M.arrivals([agent("late", 1800), agent("early", 0), agent("mid", 600)]);
    expect(order.map((a: any) => a.name)).toEqual(["early", "mid", "late"]);
    expect(order[0].behind).toBe(0);
    expect(order[2].behind).toBeCloseTo(1800, 0);
    expect(order[1].rank).toBe(2);
  });
});

describe("terrain", () => {
  it("sums climb and descent and finds the steepest section", () => {
    const s = M.elevationStats([
      { dist: 0, ele: 100 }, { dist: 100, ele: 120 }, { dist: 200, ele: 110 },
      { dist: 300, ele: 190 }, { dist: 400, ele: 190 },
    ]);
    expect(s.gain).toBeCloseTo(100, 6);
    expect(s.loss).toBeCloseTo(10, 6);
    expect(s.min).toBe(100);
    expect(s.max).toBe(190);
    expect(s.maxGrade).toBeCloseTo(80, 6);
    expect(s.steepestAt.dist).toBe(300);
  });

  it("skips gaps where the provider returned no elevation", () => {
    const s = M.elevationStats([{ dist: 0, ele: 10 }, { dist: 100, ele: null }, { dist: 200, ele: 30 }]);
    expect(s.gain).toBe(0);
    expect(s.max).toBe(30);
  });

  it("faces a slope downhill: higher ground north means the slope faces south", () => {
    const sa = M.slopeAspect([200, 100, 100, 100], 100);
    expect(sa.aspect).toBeCloseTo(180, 6);
    expect(sa.slope).toBeCloseTo(26.57, 1);
    expect(M.slopeAspect([100, 200, 100, 100], 100).aspect).toBeCloseTo(270, 6);
    expect(M.slopeAspect([100, 100, 100, 100], 100).slope).toBe(0);
  });

  it("returns null rather than NaN when a neighbour sample is missing", () => {
    expect(M.slopeAspect([100, null, 100, 100], 100)).toBeNull();
  });

  it("names compass sectors", () => {
    expect(M.compass(0)).toBe("N");
    expect(M.compass(95)).toBe("E");
    expect(M.compass(226)).toBe("SW");
    expect(M.compass(359)).toBe("N");
  });
});

describe("astronomy", () => {
  it("puts sunrise before noon before sunset, with a plausible June day length in Bengaluru", () => {
    const t = M.sunTimes(new Date("2026-06-21T00:00:00Z"), BLR.lat, BLR.lng);
    expect(t.sunrise.valueOf()).toBeLessThan(t.solarNoon.valueOf());
    expect(t.solarNoon.valueOf()).toBeLessThan(t.sunset.valueOf());
    expect(t.dayLength / 3600).toBeGreaterThan(12);
    expect(t.dayLength / 3600).toBeLessThan(13.2);
    // Solar noon at 77.6°E lands near 12:20 IST, i.e. ~06:50 UTC.
    expect(t.solarNoon.getUTCHours()).toBe(6);
  });

  it("gives a shorter December day than June at the same place", () => {
    const june = M.sunTimes(new Date("2026-06-21T00:00:00Z"), 48.85, 2.35);
    const dec = M.sunTimes(new Date("2026-12-21T00:00:00Z"), 48.85, 2.35);
    expect(june.dayLength).toBeGreaterThan(dec.dayLength * 1.8);
  });

  it("reports midnight sun instead of a bogus sunrise inside the Arctic circle", () => {
    const t = M.sunTimes(new Date("2026-06-21T00:00:00Z"), 78.2, 15.6);
    expect(t.sunrise).toBeNull();
    expect(t.polar).toBe("midnight-sun");
  });

  it("brackets golden hour inside the daylight window", () => {
    const t = M.sunTimes(new Date("2026-03-21T00:00:00Z"), BLR.lat, BLR.lng);
    expect(t.goldenMorningEnd.valueOf()).toBeGreaterThan(t.sunrise.valueOf());
    expect(t.goldenEveningStart.valueOf()).toBeLessThan(t.sunset.valueOf());
    expect(t.civilDawn.valueOf()).toBeLessThan(t.sunrise.valueOf());
  });

  it("tracks the moon from new to full", () => {
    const newMoon = M.moonPhase(new Date(Date.UTC(2000, 0, 6, 18, 14)));
    expect(newMoon.illumination).toBeLessThan(0.02);
    expect(newMoon.name).toBe("New");
    const full = M.moonPhase(new Date(Date.UTC(2000, 0, 21, 12, 0)));
    expect(full.illumination).toBeGreaterThan(0.95);
    expect(full.name).toBe("Full");
  });
});

describe("coordinates", () => {
  it("formats degrees, minutes and seconds with a hemisphere", () => {
    expect(M.toDMS(12.9716, "N", "S")).toBe("12° 58′ 17.8″ N");
    expect(M.toDMS(-33.8688, "N", "S").endsWith("S")).toBe(true);
  });

  it("puts Bengaluru in UTM zone 43N", () => {
    const u = M.toUTM(BLR.lat, BLR.lng);
    expect(u.zone).toBe(43);
    expect(u.hemisphere).toBe("N");
    expect(u.band).toBe("P");
    expect(u.easting).toBeGreaterThan(100000);
    expect(u.easting).toBeLessThan(900000);
    expect(u.northing).toBeCloseTo(1435000, -4);
  });

  it("grows easting by about a kilometre when the point moves a kilometre east", () => {
    const a = M.toUTM(BLR.lat, BLR.lng);
    const east = M.destination(BLR, 90, 1000);
    const b = M.toUTM(east.lat, east.lng);
    expect(b.easting - a.easting).toBeCloseTo(1000, -1);
  });

  it("offsets southern-hemisphere northings by 10,000 km and refuses the poles", () => {
    expect(M.toUTM(-33.8688, 151.2093).northing).toBeGreaterThan(6000000);
    expect(M.toUTM(88, 10)).toBeNull();
  });

  it("geohashes to the requested precision, sharing a prefix with nearby points", () => {
    const h = M.geohash(BLR.lat, BLR.lng, 9);
    expect(h).toHaveLength(9);
    expect(h.startsWith("tdr")).toBe(true);
    const near = M.geohash(BLR.lat + 0.0002, BLR.lng, 9);
    expect(near.slice(0, 5)).toBe(h.slice(0, 5));
  });
});

describe("clock formatting", () => {
  it("formats seconds of day, wrapping past midnight", () => {
    expect(M.clock(0)).toBe("00:00");
    expect(M.clock(9 * 3600 + 5 * 60)).toBe("09:05");
    expect(M.clock(25 * 3600)).toBe("01:00");
    expect(M.clock(3661, true)).toBe("01:01:01");
  });

  it("formats durations compactly", () => {
    expect(M.dur(45)).toBe("45s");
    expect(M.dur(600)).toBe("10m");
    expect(M.dur(3600 + 240)).toBe("1h 04m");
  });

  it("parses the departure-time field, including am/pm", () => {
    expect(M.parseClock("07:30")).toBe(7 * 3600 + 1800);
    expect(M.parseClock("7.30")).toBe(7 * 3600 + 1800);
    expect(M.parseClock("6 pm")).toBe(18 * 3600);
    expect(M.parseClock("12 am")).toBe(0);
    expect(M.parseClock("nonsense")).toBeNull();
    expect(M.parseClock("25:00")).toBeNull();
  });
});
