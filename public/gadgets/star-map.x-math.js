/* ==========================================================================
   star-map.x-math.js — pure geodesy / simulation / astronomy maths.

   DevHelper add-on to the vendored Star Map. No DOM, no Leaflet, no network:
   everything here is a function of its arguments, so it is unit-tested from
   Node (src/tools/impl/starMapMath.test.ts) rather than eyeballed in the app.

   Loaded as a classic script (window.SMXMath) and as CommonJS (tests).
   ========================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SMXMath = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const R = 6371008.8;                       // IUGG mean Earth radius, metres
  const rad = (d) => (d * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const lerp = (a, b, f) => a + (b - a) * f;

  const lat = (p) => (Array.isArray(p) ? p[0] : p.lat);
  const lng = (p) => (Array.isArray(p) ? p[1] : (p.lng !== undefined ? p.lng : p.lon));

  /* ------------------------------ distance ------------------------------ */

  /** Great-circle distance in metres between two {lat,lng} (or [lat,lng]) points. */
  function haversine(a, b) {
    const dLat = rad(lat(b) - lat(a));
    const dLng = rad(lng(b) - lng(a));
    const la1 = rad(lat(a)), la2 = rad(lat(b));
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /** Initial great-circle bearing a→b, degrees clockwise from north (0..360). */
  function bearing(a, b) {
    const la1 = rad(lat(a)), la2 = rad(lat(b));
    const dLng = rad(lng(b) - lng(a));
    const y = Math.sin(dLng) * Math.cos(la2);
    const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLng);
    return (deg(Math.atan2(y, x)) + 360) % 360;
  }

  /** Point `metres` away from `p` along `bearingDeg`. */
  function destination(p, bearingDeg, metres) {
    const d = metres / R, br = rad(bearingDeg);
    const la1 = rad(lat(p)), ln1 = rad(lng(p));
    const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(br));
    const ln2 = ln1 + Math.atan2(
      Math.sin(br) * Math.sin(d) * Math.cos(la1),
      Math.cos(d) - Math.sin(la1) * Math.sin(la2),
    );
    return { lat: deg(la2), lng: ((deg(ln2) + 540) % 360) - 180 };
  }

  /** Cumulative along-path distance. cum[0] === 0, cum[n-1] === total. */
  function cumulative(pts) {
    const cum = new Array(pts.length);
    cum[0] = 0;
    for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + haversine(pts[i - 1], pts[i]);
    return cum;
  }

  /** Position at `dist` metres along the path, clamped to both ends. */
  function pointAt(pts, cum, dist) {
    const total = cum[cum.length - 1];
    if (!(pts.length > 1) || total <= 0) {
      const p = pts[0] || { lat: 0, lng: 0 };
      return { lat: lat(p), lng: lng(p), bearing: 0, index: 0, frac: 0 };
    }
    const d = clamp(dist, 0, total);
    let i = upperBound(cum, d) - 1;
    i = clamp(i, 0, pts.length - 2);
    const seg = cum[i + 1] - cum[i];
    const f = seg > 0 ? (d - cum[i]) / seg : 0;
    const a = pts[i], b = pts[i + 1];
    return {
      lat: lerp(lat(a), lat(b), f),
      lng: lerp(lng(a), lng(b), f),
      bearing: bearing(a, b),
      index: i,
      frac: f,
    };
  }

  /** Index of the first element strictly greater than v (binary search). */
  function upperBound(arr, v) {
    let lo = 0, hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] <= v) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  /** The sub-path from 0..dist, as points (for drawing the travelled part). */
  function sliceTo(pts, cum, dist) {
    const out = [];
    const head = pointAt(pts, cum, dist);
    for (let i = 0; i <= head.index; i++) out.push({ lat: lat(pts[i]), lng: lng(pts[i]) });
    out.push({ lat: head.lat, lng: head.lng });
    return out;
  }

  /**
   * Evenly spaced samples along a path — used for elevation lookups, where the
   * provider caps how many coordinates one request may carry.
   */
  function resample(pts, cum, count) {
    const total = cum[cum.length - 1];
    const n = Math.max(2, Math.min(count, 4000));
    const out = [];
    for (let k = 0; k < n; k++) {
      const d = (total * k) / (n - 1);
      const p = pointAt(pts, cum, d);
      out.push({ lat: p.lat, lng: p.lng, dist: d });
    }
    return out;
  }

  /* ------------------------------ traffic ------------------------------ */

  /** Deterministic 32-bit hash — same seed always yields the same congestion. */
  function hash32(n) {
    let x = (n | 0) ^ 0x9e3779b9;
    x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
    x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
    x ^= x >>> 15;
    return (x >>> 0) / 4294967295;
  }

  /**
   * Rush-hour intensity 0..1 for a fractional local hour.
   *
   * Two Gaussian peaks (08:30, 18:00) over a small daytime floor. This is a
   * model, not measured data — see trafficFactor.
   */
  function rushFactor(hour) {
    const h = ((hour % 24) + 24) % 24;
    const peak = (c, w) => Math.exp(-((h - c) ** 2) / (2 * w * w));
    const day = h >= 7 && h <= 21 ? 0.18 : 0.03;
    return clamp(day + 0.82 * peak(8.5, 1.15) + 0.9 * peak(18, 1.4), 0, 1);
  }

  /**
   * Speed multiplier (0.18..1.05) for one path segment.
   *
   * Synthetic: rush-hour curve × a deterministic per-segment roughness ×
   * user-drawn congestion zones. Free live congestion data does not exist;
   * the UI labels this "simulated" and the app's own TomTom layer is the real
   * option when the user supplies a key.
   */
  function trafficFactor(opts) {
    const o = opts || {};
    if (!o.enabled) return 1;
    const intensity = rushFactor(o.hour === undefined ? 12 : o.hour) * (o.severity === undefined ? 1 : o.severity);
    const rough = hash32((o.seed || 0) * 2654435761 + (o.segment || 0) * 40503);
    // Long-wavelength jams: neighbouring segments should behave alike.
    const wave = 0.5 + 0.5 * Math.sin((o.segment || 0) / 9 + (o.seed || 0));
    let slow = intensity * (0.35 + 0.65 * rough) * (0.4 + 0.6 * wave);

    if (o.zones && o.zones.length && o.point) {
      for (const z of o.zones) {
        const d = haversine(o.point, z);
        if (d <= z.radius) {
          const near = 1 - d / z.radius;             // full effect at the centre
          slow = Math.max(slow, clamp((z.severity === undefined ? 0.7 : z.severity) * near, 0, 1));
        }
      }
    }
    // Motorway-ish (fast) segments degrade less than urban ones.
    const resilience = o.baseSpeed && o.baseSpeed > 22 ? 0.75 : 1;
    return clamp(1 - slow * 0.82 * resilience, 0.18, 1.05);
  }

  /** Congestion band for colouring: 0 free → 3 jam. */
  function congestionBand(factor) {
    if (factor >= 0.85) return 0;
    if (factor >= 0.65) return 1;
    if (factor >= 0.42) return 2;
    return 3;
  }

  /* ---------------------------- simulation ---------------------------- */

  /**
   * Turn a geometry into a time table: cumulative seconds at every vertex.
   *
   * `speeds` is OSRM's per-vertex speed annotation when available (m/s);
   * otherwise `baseSpeed` is used. Each segment's speed is scaled by the
   * traffic factor and by the agent's own `speedScale`, so a slow walker and a
   * fast driver on the same road diverge the way they should.
   *
   * `maxSpeed` caps every segment. It matters because the public OSRM demo
   * server only hosts the driving profile: ask it for cycling or walking and it
   * still answers with car speeds. Without the cap a pedestrian would "walk" a
   * ring road at 80 km/h and beat the car.
   */
  function buildSchedule(opts) {
    const pts = opts.points, cum = opts.cum || cumulative(pts);
    const cap = opts.maxSpeed || Infinity;
    const base = Math.min(opts.baseSpeed || 13.9, cap);
    const scale = opts.speedScale === undefined ? 1 : opts.speedScale;
    const departAt = opts.departAt || 0;
    const times = new Array(pts.length);
    const factors = new Array(Math.max(0, pts.length - 1));
    times[0] = 0;
    for (let i = 1; i < pts.length; i++) {
      const segLen = cum[i] - cum[i - 1];
      const raw = Math.min(cap, opts.speeds && opts.speeds[i - 1] > 0.5 ? opts.speeds[i - 1] : base);
      const hour = (opts.startHour === undefined ? 12 : opts.startHour) + (departAt + times[i - 1]) / 3600;
      const f = trafficFactor({
        enabled: opts.traffic && opts.traffic.enabled,
        hour,
        seed: opts.traffic ? opts.traffic.seed : 0,
        severity: opts.traffic ? opts.traffic.severity : 1,
        zones: opts.traffic ? opts.traffic.zones : null,
        segment: i - 1,
        point: pts[i - 1],
        baseSpeed: raw,
      });
      factors[i - 1] = f;
      const v = Math.max(0.4, raw * scale * f);
      times[i] = times[i - 1] + segLen / v;
    }
    return {
      times,
      factors,
      cum,
      departAt,
      duration: times[times.length - 1] || 0,
      distance: cum[cum.length - 1] || 0,
      freeFlowDuration: freeFlow(cum, opts.speeds, base, scale, cap),
    };
  }

  function freeFlow(cum, speeds, base, scale, cap) {
    let t = 0;
    for (let i = 1; i < cum.length; i++) {
      const raw = Math.min(cap || Infinity, speeds && speeds[i - 1] > 0.5 ? speeds[i - 1] : base);
      t += (cum[i] - cum[i - 1]) / Math.max(0.4, raw * (scale === undefined ? 1 : scale));
    }
    return t;
  }

  /** Metres covered at simulation time `t` (seconds), honouring departAt. */
  function distanceAtTime(sched, t) {
    const local = t - sched.departAt;
    if (local <= 0) return 0;
    const { times, cum } = sched;
    if (local >= times[times.length - 1]) return cum[cum.length - 1];
    let i = upperBound(times, local) - 1;
    i = clamp(i, 0, times.length - 2);
    const dt = times[i + 1] - times[i];
    const f = dt > 0 ? (local - times[i]) / dt : 0;
    return lerp(cum[i], cum[i + 1], f);
  }

  /** Instantaneous speed (m/s) at simulation time `t`. */
  function speedAtTime(sched, t) {
    const local = t - sched.departAt;
    const { times, cum } = sched;
    if (local <= 0 || local >= times[times.length - 1]) return 0;
    let i = upperBound(times, local) - 1;
    i = clamp(i, 0, times.length - 2);
    const dt = times[i + 1] - times[i];
    return dt > 0 ? (cum[i + 1] - cum[i]) / dt : 0;
  }

  /** Simulation state of one agent at time `t`. */
  function stateAt(agent, t) {
    const sched = agent.schedule;
    const dist = distanceAtTime(sched, t);
    const p = pointAt(agent.points, sched.cum, dist);
    const finishedAt = sched.departAt + sched.duration;
    return {
      lat: p.lat, lng: p.lng, bearing: p.bearing,
      dist,
      remaining: Math.max(0, sched.distance - dist),
      speed: speedAtTime(sched, t),
      phase: t < sched.departAt ? 'waiting' : t >= finishedAt ? 'arrived' : 'moving',
      eta: finishedAt,
      progress: sched.distance > 0 ? dist / sched.distance : 0,
    };
  }

  /**
   * Times and places where two agents are within `threshold` metres of each
   * other — the point of running several departures at once. One event per
   * encounter (the closest approach), not one per sample.
   */
  function encounters(agents, opts) {
    const o = opts || {};
    const threshold = o.threshold || 120;
    const step = o.step || 5;
    const end = o.end || agents.reduce((m, a) => Math.max(m, a.schedule.departAt + a.schedule.duration), 0);
    const out = [];
    for (let i = 0; i < agents.length; i++) {
      for (let j = i + 1; j < agents.length; j++) {
        const A = agents[i], B = agents[j];
        const from = Math.max(A.schedule.departAt, B.schedule.departAt);
        const to = Math.min(A.schedule.departAt + A.schedule.duration, B.schedule.departAt + B.schedule.duration);
        let open = null;
        for (let t = from; t <= Math.min(to, end); t += step) {
          const a = stateAt(A, t), b = stateAt(B, t);
          const d = haversine(a, b);
          if (d <= threshold) {
            if (!open || d < open.distance) open = { t, distance: d, lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
            open.lastT = t;
          } else if (open) {
            out.push(closeEncounter(A, B, open));
            open = null;
          }
        }
        if (open) out.push(closeEncounter(A, B, open));
      }
    }
    return out.sort((x, y) => x.t - y.t);
  }

  function closeEncounter(A, B, open) {
    return {
      a: A.id, b: B.id, aName: A.name, bName: B.name,
      t: open.t, distance: open.distance, lat: open.lat, lng: open.lng,
      duration: Math.max(0, (open.lastT || open.t) - open.t),
    };
  }

  /** Arrival order with gaps, for the "who gets there first" table. */
  function arrivals(agents) {
    return agents
      .map((a) => ({ id: a.id, name: a.name, at: a.schedule.departAt + a.schedule.duration, depart: a.schedule.departAt, duration: a.schedule.duration, distance: a.schedule.distance }))
      .sort((x, y) => x.at - y.at)
      .map((a, i, all) => Object.assign(a, { rank: i + 1, behind: a.at - all[0].at }));
  }

  /* ------------------------- observer geometry ------------------------- */

  const WGS84_A = 6378137, WGS84_F = 1 / 298.257223563;
  const WGS84_E2 = WGS84_F * (2 - WGS84_F);

  /** Geodetic {lat,lng,altitude m} to earth-centred, earth-fixed metres. */
  function toEcef(p) {
    const phi = rad(lat(p)), lam = rad(lng(p));
    const h = p.altitude || 0;
    const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * Math.sin(phi) ** 2);
    return {
      x: (N + h) * Math.cos(phi) * Math.cos(lam),
      y: (N + h) * Math.cos(phi) * Math.sin(lam),
      z: (N * (1 - WGS84_E2) + h) * Math.sin(phi),
    };
  }

  /**
   * Where to look, from an observer to a target: compass azimuth, elevation
   * above the horizon, and slant range (line of sight, not ground distance).
   *
   * Negative elevation means the target is below the horizon: the Earth is in
   * the way, and no amount of looking will find it.
   */
  function lookAngles(observer, target) {
    const o = toEcef(observer), t = toEcef(target);
    const dx = t.x - o.x, dy = t.y - o.y, dz = t.z - o.z;
    const phi = rad(lat(observer)), lam = rad(lng(observer));
    const sinP = Math.sin(phi), cosP = Math.cos(phi), sinL = Math.sin(lam), cosL = Math.cos(lam);
    const east = -sinL * dx + cosL * dy;
    const north = -sinP * cosL * dx - sinP * sinL * dy + cosP * dz;
    const up = cosP * cosL * dx + cosP * sinL * dy + sinP * dz;
    const range = Math.hypot(dx, dy, dz);
    return {
      azimuth: (deg(Math.atan2(east, north)) + 360) % 360,
      elevation: range > 0 ? deg(Math.asin(up / range)) : 0,
      range,
      groundRange: Math.hypot(east, north),
    };
  }

  /**
   * Radius of the ground circle inside which an object at `altitude` metres is
   * above the horizon: its footprint. Anyone outside it cannot see it at all,
   * whatever the weather.
   */
  function horizonRadius(altitude) {
    if (!(altitude > 0)) return 0;
    return R * Math.acos(R / (R + altitude));
  }

  /** How far away the horizon is for an eye `height` metres above the ground. */
  const horizonDistance = (height) => Math.sqrt(Math.max(0, 2 * R * (height || 1.7)));

  /* ------------------------------ the sun ------------------------------ */

  /**
   * Low-precision solar position (Astronomical Almanac form, about 0.01 degrees):
   * the point on Earth the sun stands over, plus the sidereal angle needed to
   * turn that into a look angle anywhere else.
   */
  function solarPosition(date) {
    const n = date.valueOf() / 86400000 - 10957.5;            // days since J2000.0
    const meanLon = 280.460 + 0.9856474 * n;
    const meanAnom = rad(357.528 + 0.9856003 * n);
    const eclipticLon = rad(meanLon + 1.915 * Math.sin(meanAnom) + 0.020 * Math.sin(2 * meanAnom));
    const obliquity = rad(23.439 - 0.0000004 * n);
    const ra = Math.atan2(Math.cos(obliquity) * Math.sin(eclipticLon), Math.cos(eclipticLon));
    const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLon));
    const gmst = ((280.46061837 + 360.98564736629 * n) % 360 + 360) % 360;
    return {
      declination: deg(declination),
      rightAscension: (deg(ra) + 360) % 360,
      gmst,
      subsolarLat: deg(declination),
      subsolarLng: ((deg(ra) - gmst + 540) % 360) - 180,
    };
  }

  /** Sun elevation in degrees at a place and time. Negative is below the horizon. */
  function sunElevation(date, latitude, longitude) {
    const sun = solarPosition(date);
    const hourAngle = rad(((sun.gmst + longitude - sun.rightAscension + 540) % 360) - 180);
    const phi = rad(latitude), dec = rad(sun.declination);
    return deg(Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(hourAngle)));
  }

  /**
   * Is an object in sunlight, or inside the Earth's shadow?
   *
   * Cylindrical shadow model: on the sunward side it is always lit; on the night
   * side it is lit only if it stands further from the Earth-sun axis than the
   * Earth's radius. Enough to know whether a satellite can be seen at all; it
   * ignores the penumbra, worth a few seconds at the shadow edge.
   */
  function isSunlit(target, date) {
    const sun = solarPosition(date);
    const s = toEcef({ lat: sun.subsolarLat, lng: sun.subsolarLng, altitude: 0 });
    const len = Math.hypot(s.x, s.y, s.z);
    const hat = { x: s.x / len, y: s.y / len, z: s.z / len };
    const p = toEcef(target);
    const along = p.x * hat.x + p.y * hat.y + p.z * hat.z;
    if (along >= 0) return true;                              // sunward hemisphere
    const perp = Math.hypot(p.x - along * hat.x, p.y - along * hat.y, p.z - along * hat.z);
    return perp > R;
  }

  /**
   * Can this be seen with the naked eye right now, and if not, why not?
   *
   * For a satellite three things must hold at once: it is high enough above the
   * horizon to clear buildings and haze, the observer's sky is dark, and the
   * object itself is still in sunlight. Aircraft need none of that, only to be
   * above the horizon and close enough, so the two sunlight conditions can be
   * switched off.
   */
  function nakedEye(opts) {
    const o = opts || {};
    const minElevation = o.minElevation === undefined ? 10 : o.minElevation;
    const reasons = [];
    if (!(o.elevation > minElevation)) {
      reasons.push(o.elevation > 0 ? `only ${o.elevation.toFixed(0)}\u00b0 above the horizon` : 'below the horizon');
    }
    if (o.needsDarkness !== false && !(o.sunElevation < -6)) {
      reasons.push(o.sunElevation > 0 ? 'broad daylight' : 'sky not dark yet');
    }
    if (o.needsSunlight !== false && o.sunlit === false) reasons.push('in the Earth\u2019s shadow');
    if (o.range !== undefined && o.maxRange !== undefined && o.range > o.maxRange) {
      reasons.push(`too far off, ${(o.range / 1000).toFixed(1)} km`);
    }
    return { visible: reasons.length === 0, reasons };
  }

  /* --------------------------- closest approach --------------------------- */

  /**
   * If this object holds its present course and speed, when does it come
   * closest to the observer, and how close?
   *
   * Straight-line extrapolation on the local tangent plane: exact enough over
   * the minutes that matter when you are waiting to see something, and honest
   * about it, since `seconds` goes negative once the closest point has passed.
   */
  function closestApproach(observer, target) {
    if (!(target.speed > 0) || !Number.isFinite(target.heading)) return null;
    const look = lookAngles(observer, target);
    const toObserver = bearing(target, observer);
    const rx = look.groundRange * Math.sin(rad(toObserver));
    const ry = look.groundRange * Math.cos(rad(toObserver));
    const vx = target.speed * Math.sin(rad(target.heading));
    const vy = target.speed * Math.cos(rad(target.heading));
    const seconds = (rx * vx + ry * vy) / (vx * vx + vy * vy);
    return {
      seconds,
      distance: Math.hypot(rx - vx * seconds, ry - vy * seconds),
      approaching: seconds > 0,
      currentDistance: look.groundRange,
    };
  }

  /* --------------------------- recorded tracks --------------------------- */

  /**
   * Where a recorded object was at time `t` (epoch ms).
   *
   * Fixes arrive at whatever rate the source publishes, so a replay has to
   * interpolate between them rather than snap to the nearest one — otherwise a
   * satellite crawls in five-second jumps. Values that were measured (altitude,
   * speed) and values that were computed at the time (azimuth, elevation,
   * range) are all carried through, so a replay shows the same numbers the live
   * readout showed at that moment.
   *
   * Outside the recorded window it clamps to the first or last fix and says so
   * with `before` / `after`, so a caller never has to guess whether a position
   * is real or an extrapolation.
   */
  function sampleTrack(points, t) {
    if (!points || !points.length) return null;
    const first = points[0], last = points[points.length - 1];
    if (t <= first.t) return Object.assign({}, first, { at: first.t, before: t < first.t, after: false, gap: 0 });
    if (t >= last.t) return Object.assign({}, last, { at: last.t, before: false, after: t > last.t, gap: 0 });

    let lo = 0, hi = points.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (points[mid].t <= t) lo = mid; else hi = mid;
    }
    const a = points[lo], b = points[hi];
    const span = b.t - a.t;
    const f = span > 0 ? (t - a.t) / span : 0;
    const between = (key) => (Number.isFinite(a[key]) && Number.isFinite(b[key]) ? lerp(a[key], b[key], f) : (a[key] ?? null));
    return {
      t,
      at: t,
      lat: lerp(a.lat, b.lat, f),
      lng: lerpLongitude(a.lng, b.lng, f),
      alt: between('alt'),
      spd: between('spd'),
      az: between('az'),
      el: between('el'),
      rng: between('rng'),
      before: false,
      after: false,
      gap: span,                       // how far apart the two fixes were, in ms
    };
  }

  /** Interpolate longitude the short way round, so a track can cross the date line. */
  function lerpLongitude(a, b, f) {
    let delta = b - a;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    return ((a + delta * f + 540) % 360) - 180;
  }

  /** Everything up to time `t`, for drawing the part of a trail already flown. */
  function trackUpTo(points, t) {
    if (!points || !points.length) return [];
    const out = [];
    for (const p of points) {
      if (p.t > t) break;
      out.push({ lat: p.lat, lng: p.lng, t: p.t });
    }
    const head = sampleTrack(points, t);
    if (head && (!out.length || out[out.length - 1].t < head.at)) out.push({ lat: head.lat, lng: head.lng, t: head.at });
    return out;
  }

  /**
   * Evenly spaced time marks inside a recorded window — the labels that turn a
   * line on the map back into a timetable. The step is chosen so a window of any
   * length ends up with a readable handful rather than hundreds.
   */
  function timeMarks(points, opts) {
    if (!points || points.length < 2) return [];
    const o = opts || {};
    const from = points[0].t, to = points[points.length - 1].t;
    const wanted = o.count || 6;
    const STEPS = [10, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600, 43200, 86400];
    const rough = (to - from) / 1000 / wanted;
    const step = (STEPS.find((sec) => sec >= rough) || STEPS[STEPS.length - 1]) * 1000;
    const marks = [];
    // Start on a round multiple of the step so the labels land on tidy times.
    for (let t = Math.ceil(from / step) * step; t <= to; t += step) {
      const at = sampleTrack(points, t);
      if (at) marks.push({ t, lat: at.lat, lng: at.lng });
    }
    return marks;
  }

  /* ------------------------------- an area ------------------------------- */

  /**
   * Convex hull of a set of points (Andrew's monotone chain), in lon/lat.
   *
   * Used to draw the ground the tracked set covers: your own position plus
   * everything being followed. Planar rather than spherical, which is fine for
   * a span that fits on one screen and wrong near a pole or across the date
   * line — the caller gets what it asked for, and `spans` says how wide it is.
   */
  function convexHull(points) {
    const pts = points
      .filter((p) => Number.isFinite(lat(p)) && Number.isFinite(lng(p)))
      .map((p) => ({ lat: lat(p), lng: lng(p) }))
      .sort((a, b) => (a.lng - b.lng) || (a.lat - b.lat));
    if (pts.length < 3) return pts;
    const cross = (o, a, b) => (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);
    const half = (list) => {
      const out = [];
      for (const p of list) {
        while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
        out.push(p);
      }
      return out;
    };
    const lower = half(pts), upper = half([...pts].reverse());
    return lower.slice(0, -1).concat(upper.slice(0, -1));
  }

  /**
   * Area of a polygon on the sphere, in square metres.
   *
   * The spherical excess of the shoelace sum on the unit sphere, so it stays
   * right for a shape a thousand kilometres across, where a flat approximation
   * would not.
   */
  function polygonArea(ring) {
    if (!ring || ring.length < 3) return 0;
    let total = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      total += (rad(lng(b)) - rad(lng(a))) * (2 + Math.sin(rad(lat(a))) + Math.sin(rad(lat(b))));
    }
    return Math.abs((total * R * R) / 2);
  }

  /** Centre of a set of points, averaged as vectors so it behaves at the seam. */
  function centroid(points) {
    let x = 0, y = 0, z = 0, n = 0;
    for (const p of points) {
      if (!Number.isFinite(lat(p)) || !Number.isFinite(lng(p))) continue;
      const la = rad(lat(p)), lo = rad(lng(p));
      x += Math.cos(la) * Math.cos(lo);
      y += Math.cos(la) * Math.sin(lo);
      z += Math.sin(la);
      n++;
    }
    if (!n) return null;
    return { lat: deg(Math.atan2(z / n, Math.hypot(x / n, y / n))), lng: deg(Math.atan2(y / n, x / n)) };
  }

  /* ---------------------------- elevation ---------------------------- */

  /** Climb/descent/grade statistics from sampled elevations along a path. */
  function elevationStats(samples) {
    let gain = 0, loss = 0, maxGrade = 0, minEle = Infinity, maxEle = -Infinity, worst = null;
    for (const s of samples) {
      if (!Number.isFinite(s.ele)) continue;
      minEle = Math.min(minEle, s.ele);
      maxEle = Math.max(maxEle, s.ele);
    }
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1], b = samples[i];
      if (!Number.isFinite(a.ele) || !Number.isFinite(b.ele)) continue;
      const dz = b.ele - a.ele;
      const dx = b.dist - a.dist;
      if (dz > 0) gain += dz; else loss -= dz;
      if (dx > 5) {
        const grade = (dz / dx) * 100;
        if (Math.abs(grade) > Math.abs(maxGrade)) { maxGrade = grade; worst = b; }
      }
    }
    return {
      gain, loss,
      min: minEle === Infinity ? null : minEle,
      max: maxEle === -Infinity ? null : maxEle,
      maxGrade, steepestAt: worst,
    };
  }

  /**
   * Slope and aspect at a point from four neighbour elevations
   * (order: north, east, south, west), by central difference.
   */
  function slopeAspect(ele, spacing) {
    const [n, e, s, w] = ele;
    if (![n, e, s, w].every(Number.isFinite) || !(spacing > 0)) return null;
    const dzdx = (e - w) / (2 * spacing);
    const dzdy = (n - s) / (2 * spacing);
    const slope = deg(Math.atan(Math.hypot(dzdx, dzdy)));
    let aspect = deg(Math.atan2(dzdx, dzdy));       // downhill direction faces -gradient
    aspect = (180 + aspect + 360) % 360;
    return { slope, aspect, gradePct: Math.hypot(dzdx, dzdy) * 100 };
  }

  const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const compass = (d) => COMPASS[Math.round((((d % 360) + 360) % 360) / 22.5) % 16];

  /* ---------------------------- astronomy ---------------------------- */

  /**
   * Sunrise / sunset / golden hour / solar noon (NOAA low-precision equations,
   * good to ~1 minute) and the moon phase. Local, no network.
   */
  function sunTimes(date, latitude, longitude) {
    const J1970 = 2440588, J2000 = 2451545, day = 86400000;
    const toJulian = (d) => d.valueOf() / day - 0.5 + J1970;
    const fromJulian = (j) => new Date((j + 0.5 - J1970) * day);
    const d = toJulian(date) - J2000;

    const n = Math.round(d - 0.0009 - -longitude / 360);
    const ds = 0.0009 + -longitude / 360 + n;                       // approx solar noon cycle
    const M = rad((357.5291 + 0.98560028 * ds) % 360);              // mean anomaly
    const C = 1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M);
    const L = rad((deg(M) + C + 180 + 102.9372) % 360);             // ecliptic longitude
    const Jtransit = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
    const declination = Math.asin(Math.sin(L) * Math.sin(rad(23.4397)));

    const hourAngle = (angleDeg) => {
      const cosw = (Math.sin(rad(angleDeg)) - Math.sin(rad(latitude)) * Math.sin(declination)) /
                   (Math.cos(rad(latitude)) * Math.cos(declination));
      return Math.abs(cosw) > 1 ? null : deg(Math.acos(cosw)) / 360;
    };
    const pair = (angleDeg) => {
      const w = hourAngle(angleDeg);
      if (w === null) return [null, null];
      return [fromJulian(Jtransit - w), fromJulian(Jtransit + w)];
    };

    const [sunrise, sunset] = pair(-0.833);
    const [goldenEnd, goldenStart] = pair(6);
    const [dawn, dusk] = pair(-6);
    return {
      solarNoon: fromJulian(Jtransit),
      sunrise, sunset,
      goldenMorningEnd: goldenEnd, goldenEveningStart: goldenStart,
      civilDawn: dawn, civilDusk: dusk,
      dayLength: sunrise && sunset ? (sunset - sunrise) / 1000 : null,
      polar: !sunrise ? (latitude >= 0) === (declination >= 0) ? 'midnight-sun' : 'polar-night' : null,
      declination: deg(declination),
    };
  }

  /** Moon illumination fraction and phase name. */
  function moonPhase(date) {
    const synodic = 29.530588853;
    const known = Date.UTC(2000, 0, 6, 18, 14);            // a known new moon
    const days = (date.valueOf() - known) / 86400000;
    const age = ((days % synodic) + synodic) % synodic;
    const frac = (1 - Math.cos((2 * Math.PI * age) / synodic)) / 2;
    const names = ['New', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
    const idx = Math.floor((age / synodic) * 8 + 0.5) % 8;
    return { age, illumination: frac, name: names[idx] };
  }

  /* ---------------------------- coordinates ---------------------------- */

  function toDMS(value, positive, negative) {
    const abs = Math.abs(value);
    const d = Math.floor(abs);
    const m = Math.floor((abs - d) * 60);
    const s = ((abs - d) * 60 - m) * 60;
    return `${d}° ${String(m).padStart(2, '0')}′ ${s.toFixed(1).padStart(4, '0')}″ ${value >= 0 ? positive : negative}`;
  }

  /** WGS84 → UTM (metres, zone, hemisphere). Standard Karney/USGS series. */
  function toUTM(latitude, longitude) {
    if (Math.abs(latitude) > 84) return null;              // UTM is undefined near the poles
    const a = 6378137, f = 1 / 298.257223563;
    const k0 = 0.9996;
    const zone = Math.floor((longitude + 180) / 6) + 1;
    const lon0 = rad((zone - 1) * 6 - 180 + 3);
    const e2 = f * (2 - f), ep2 = e2 / (1 - e2);
    const phi = rad(latitude), lam = rad(longitude);
    const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
    const T = Math.tan(phi) ** 2;
    const C = ep2 * Math.cos(phi) ** 2;
    const A = Math.cos(phi) * (lam - lon0);
    const M = a * ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * phi
      - ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi)
      + ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi)
      - ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi));
    const easting = k0 * N * (A + ((1 - T + C) * A ** 3) / 6
      + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120) + 500000;
    let northing = k0 * (M + N * Math.tan(phi) * ((A * A) / 2 + ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24
      + ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720));
    if (latitude < 0) northing += 10000000;
    const bands = 'CDEFGHJKLMNPQRSTUVWX';
    const band = bands[Math.floor((latitude + 80) / 8)] || (latitude > 0 ? 'X' : 'C');
    return { zone, band, easting, northing, hemisphere: latitude >= 0 ? 'N' : 'S' };
  }

  const GEOHASH32 = '0123456789bcdefghjkmnpqrstuvwxyz';

  /** Geohash of a coordinate — handy as a short shareable place token. */
  function geohash(latitude, longitude, precision) {
    const p = precision || 9;
    let latRange = [-90, 90], lonRange = [-180, 180];
    let hash = '', bits = 0, bit = 0, even = true;
    while (hash.length < p) {
      if (even) {
        const mid = (lonRange[0] + lonRange[1]) / 2;
        if (longitude > mid) { bits = (bits << 1) + 1; lonRange[0] = mid; }
        else { bits <<= 1; lonRange[1] = mid; }
      } else {
        const mid = (latRange[0] + latRange[1]) / 2;
        if (latitude > mid) { bits = (bits << 1) + 1; latRange[0] = mid; }
        else { bits <<= 1; latRange[1] = mid; }
      }
      even = !even;
      if (++bit === 5) { hash += GEOHASH32[bits]; bits = 0; bit = 0; }
    }
    return hash;
  }

  /* ------------------------------ formatting ------------------------------ */

  /** Seconds-of-day → HH:MM(:SS), wrapping past midnight. */
  function clock(seconds, withSeconds) {
    const s = ((Math.round(seconds) % 86400) + 86400) % 86400;
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    const base = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    return withSeconds ? `${base}:${String(s % 60).padStart(2, '0')}` : base;
  }

  /** "1h 04m" / "48s" — compact durations for tables. */
  function dur(seconds) {
    const s = Math.max(0, Math.round(seconds));
    if (s < 60) return `${s}s`;
    const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
    return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
  }

  /** "HH:MM" or "H:MM am/pm" → seconds of day, or null. */
  function parseClock(text) {
    const m = /^\s*(\d{1,2})[:.h]?(\d{2})?\s*(am|pm)?\s*$/i.exec(String(text || ''));
    if (!m) return null;
    let h = Number(m[1]);
    const mins = Number(m[2] || 0);
    const ap = (m[3] || '').toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (h > 23 || mins > 59) return null;
    return h * 3600 + mins * 60;
  }

  return {
    R, rad, deg, clamp, lerp,
    haversine, bearing, destination, cumulative, pointAt, sliceTo, resample, upperBound,
    hash32, rushFactor, trafficFactor, congestionBand,
    buildSchedule, distanceAtTime, speedAtTime, stateAt, encounters, arrivals,
    elevationStats, slopeAspect, compass,
    toEcef, lookAngles, horizonRadius, horizonDistance,
    sampleTrack, trackUpTo, timeMarks, lerpLongitude,
    convexHull, polygonArea, centroid,
    solarPosition, sunElevation, isSunlit, nakedEye, closestApproach,
    sunTimes, moonPhase,
    toDMS, toUTM, geohash,
    clock, dur, parseClock,
  };
});
