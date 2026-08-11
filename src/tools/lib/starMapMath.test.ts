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

describe("observer geometry", () => {
  const home = { lat: 12.9716, lng: 77.5946, altitude: 920 };

  it("puts something directly overhead at 90 degrees elevation", () => {
    const look = M.lookAngles(home, { lat: 12.9716, lng: 77.5946, altitude: 420920 });
    expect(look.elevation).toBeCloseTo(90, 4);
    expect(look.range).toBeCloseTo(420000, -1);
    expect(look.groundRange).toBeCloseTo(0, 3);
  });

  it("reads azimuth as a compass bearing", () => {
    expect(M.lookAngles(home, { lat: 13.5, lng: 77.5946, altitude: 920 }).azimuth).toBeCloseTo(0, 1);
    expect(M.lookAngles(home, { lat: 12.9716, lng: 78.2, altitude: 920 }).azimuth).toBeCloseTo(90, 0);
    expect(M.lookAngles(home, { lat: 12.4, lng: 77.5946, altitude: 920 }).azimuth).toBeCloseTo(180, 1);
    expect(M.compass(M.lookAngles(home, { lat: 12.9716, lng: 77.0, altitude: 920 }).azimuth)).toBe("W");
  });

  it("drops below the horizon for a distant object at the same height", () => {
    const look = M.lookAngles(home, { lat: 15.5, lng: 77.5946, altitude: 920 });
    expect(look.elevation).toBeLessThan(0);
    expect(M.nakedEye({ elevation: look.elevation, sunElevation: -20, sunlit: true }).reasons[0])
      .toBe("below the horizon");
  });

  it("still sees a high satellite hundreds of kilometres away", () => {
    // The ISS at 420 km, 800 km along the ground: above the horizon, but low.
    const away = M.destination(home, 45, 800000);
    const look = M.lookAngles(home, { ...away, altitude: 420000 });
    expect(look.elevation).toBeGreaterThan(0);
    expect(look.elevation).toBeLessThan(30);
    expect(look.range / 1000).toBeGreaterThan(800);
  });

  it("sizes the footprint an object can be seen from", () => {
    expect(M.horizonRadius(420000) / 1000).toBeCloseTo(2222, -2);   // ISS, ~2200 km
    expect(M.horizonRadius(11000) / 1000).toBeCloseTo(374, -1);     // airliner
    expect(M.horizonRadius(0)).toBe(0);
  });

  it("knows how far a standing observer can see", () => {
    expect(M.horizonDistance(1.7) / 1000).toBeCloseTo(4.7, 1);
    expect(M.horizonDistance(100) / 1000).toBeCloseTo(35.7, 1);
  });
});

describe("the sun", () => {
  it("puts the subsolar point on the tropic at the June solstice", () => {
    const sun = M.solarPosition(new Date("2026-06-21T12:00:00Z"));
    expect(sun.declination).toBeCloseTo(23.4, 0);
    expect(Math.abs(sun.subsolarLat)).toBeCloseTo(23.4, 0);
  });

  it("crosses the equator at the equinoxes", () => {
    expect(Math.abs(M.solarPosition(new Date("2026-03-20T12:00:00Z")).declination)).toBeLessThan(1);
    expect(Math.abs(M.solarPosition(new Date("2026-09-22T12:00:00Z")).declination)).toBeLessThan(1);
  });

  it("is high at local noon and below the horizon at local midnight", () => {
    // 77.6 E is UTC+5:10 of solar time, so local noon is about 06:50 UTC.
    expect(M.sunElevation(new Date("2026-06-21T06:50:00Z"), 12.9716, 77.5946)).toBeGreaterThan(75);
    expect(M.sunElevation(new Date("2026-06-21T18:50:00Z"), 12.9716, 77.5946)).toBeLessThan(-20);
  });

  it("agrees with the sunrise and sunset computed the other way", () => {
    const t = M.sunTimes(new Date("2026-08-11T00:00:00Z"), 12.9716, 77.5946);
    const el = (d: Date) => M.sunElevation(d, 12.9716, 77.5946);
    // sunTimes crosses at -0.833°, the standard allowance for refraction and the
    // sun's own radius — so at its sunrise the disc is just under the horizon.
    for (const moment of [t.sunrise, t.sunset]) {
      expect(el(moment)).toBeLessThan(0);
      expect(el(moment)).toBeGreaterThan(-2);
    }
    // And the two agree on the middle of the day to within a couple of minutes.
    let best = { el: -99, at: t.solarNoon };
    for (let m = -20; m <= 20; m++) {
      const d = new Date(t.solarNoon.valueOf() + m * 60000);
      if (el(d) > best.el) best = { el: el(d), at: d };
    }
    expect(Math.abs(best.at.valueOf() - t.solarNoon.valueOf())).toBeLessThan(3 * 60000);
    // Peak elevation is 90° minus how far the subsolar latitude sits from yours.
    const dec = M.solarPosition(best.at).declination;
    expect(best.el).toBeCloseTo(90 - Math.abs(12.9716 - dec), 1);
  });

  it("keeps the midnight sun above the horizon inside the Arctic circle", () => {
    const el = M.sunElevation(new Date("2026-06-21T00:00:00Z"), 78.2, 15.6);
    expect(el).toBeGreaterThan(0);
  });
});

describe("sunlight and visibility", () => {
  const june = new Date("2026-06-21T06:50:00Z");      // noon over India

  it("calls the day side sunlit whatever the altitude", () => {
    expect(M.isSunlit({ lat: 12.97, lng: 77.59, altitude: 0 }, june)).toBe(true);
    expect(M.isSunlit({ lat: 12.97, lng: 77.59, altitude: 420000 }, june)).toBe(true);
  });

  it("puts the ground on the night side in shadow, but a high satellite in light", () => {
    const midnight = new Date("2026-06-21T18:50:00Z");
    expect(M.isSunlit({ lat: 12.97, lng: 77.59, altitude: 0 }, midnight)).toBe(false);
    // Deep in the night side even orbit is dark; near the terminator it is lit.
    const terminator = M.destination({ lat: 12.97, lng: 77.59 }, 270, 2000000);
    expect(M.isSunlit({ ...terminator, altitude: 1200000 }, new Date("2026-06-21T13:30:00Z"))).toBe(true);
  });

  it("needs height, darkness and sunlight together for a naked-eye pass", () => {
    const good = M.nakedEye({ elevation: 45, sunElevation: -12, sunlit: true });
    expect(good.visible).toBe(true);
    expect(good.reasons).toHaveLength(0);

    expect(M.nakedEye({ elevation: 45, sunElevation: 20, sunlit: true }).reasons).toContain("broad daylight");
    expect(M.nakedEye({ elevation: 45, sunElevation: -12, sunlit: false }).reasons[0]).toContain("shadow");
    expect(M.nakedEye({ elevation: 4, sunElevation: -12, sunlit: true }).reasons[0]).toContain("4° above");
  });

  it("ignores darkness and sunlight for things that carry their own lights", () => {
    const plane = M.nakedEye({
      elevation: 30, sunElevation: 40, sunlit: false,
      needsDarkness: false, needsSunlight: false, range: 8000, maxRange: 20000,
    });
    expect(plane.visible).toBe(true);
    expect(M.nakedEye({
      elevation: 30, sunElevation: 40, needsDarkness: false, needsSunlight: false,
      range: 60000, maxRange: 20000,
    }).reasons[0]).toContain("too far off");
  });
});

describe("closest approach", () => {
  const home = { lat: 12.9716, lng: 77.5946, altitude: 920 };

  it("finds when something heading straight at you arrives, and that it passes overhead", () => {
    const south = M.destination(home, 180, 10000);        // 10 km south of home
    const ca = M.closestApproach(home, { ...south, altitude: 3000, speed: 100, heading: 0 });
    expect(ca.seconds).toBeCloseTo(100, 0);               // 10 km at 100 m/s
    expect(ca.distance).toBeLessThan(50);                 // essentially straight over
    expect(ca.approaching).toBe(true);
  });

  it("reports the miss distance of something crossing to one side", () => {
    const west = M.destination(home, 270, 20000);
    const offset = M.destination(west, 0, 5000);          // 5 km north of the line
    const ca = M.closestApproach(home, { ...offset, altitude: 3000, speed: 200, heading: 90 });
    expect(ca.distance / 1000).toBeCloseTo(5, 0);
    expect(ca.seconds).toBeCloseTo(100, 0);
  });

  it("goes negative once the closest point is behind it", () => {
    const north = M.destination(home, 0, 10000);
    const ca = M.closestApproach(home, { ...north, altitude: 3000, speed: 100, heading: 0 });
    expect(ca.seconds).toBeLessThan(0);
    expect(ca.approaching).toBe(false);
  });

  it("returns nothing when there is no course to extrapolate", () => {
    expect(M.closestApproach(home, { lat: 13, lng: 77.6, speed: 0, heading: 90 })).toBeNull();
    expect(M.closestApproach(home, { lat: 13, lng: 77.6, speed: 100 })).toBeNull();
  });
});

describe("hulls and areas", () => {
  it("wraps a scatter of points in their convex hull, dropping the interior ones", () => {
    const square = [
      { lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 1, lng: 1 }, { lat: 1, lng: 0 },
      { lat: 0.5, lng: 0.5 },                                  // inside, must be dropped
    ];
    const hull = M.convexHull(square);
    expect(hull).toHaveLength(4);
    expect(hull.some((p: any) => p.lat === 0.5)).toBe(false);
  });

  it("hands back fewer than three points unchanged, since they have no area", () => {
    expect(M.convexHull([{ lat: 1, lng: 1 }])).toHaveLength(1);
    expect(M.convexHull([{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }])).toHaveLength(2);
    expect(M.polygonArea([{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }])).toBe(0);
  });

  it("ignores points with no position", () => {
    const hull = M.convexHull([
      { lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 1, lng: 1 },
      { lat: null, lng: 5 }, { lat: 2, lng: undefined },
    ]);
    expect(hull).toHaveLength(3);
  });

  it("measures a one-degree square at the equator at about 12,300 km²", () => {
    const area = M.polygonArea([
      { lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 1, lng: 1 }, { lat: 1, lng: 0 },
    ]);
    expect(area / 1e6).toBeCloseTo(12363, -2);
  });

  it("shrinks the same square towards the pole, as a sphere requires", () => {
    const box = (lat0: number) => M.polygonArea([
      { lat: lat0, lng: 0 }, { lat: lat0, lng: 1 }, { lat: lat0 + 1, lng: 1 }, { lat: lat0 + 1, lng: 0 },
    ]);
    expect(box(60)).toBeLessThan(box(0) * 0.6);
    expect(box(0)).toBeGreaterThan(box(30));
  });

  it("averages a centre as vectors, so it survives the date line", () => {
    const c = M.centroid([{ lat: 10, lng: 179 }, { lat: 10, lng: -179 }]);
    expect(Math.abs(c.lng)).toBeGreaterThan(179);        // near 180, not near 0
    // The vector mean of two points 2° apart sits a shade poleward of them both.
    expect(c.lat).toBeCloseTo(10, 2);
    expect(M.centroid([])).toBeNull();
  });
});
