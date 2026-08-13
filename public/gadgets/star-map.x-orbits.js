/* ==========================================================================
   star-map.x-orbits.js — orbital mechanics for the Space tab.

   DevHelper add-on to the vendored Star Map. No DOM, no three.js, no network:
   every function here is a function of its arguments, so it is unit-tested from
   Node (src/tools/lib/starMapOrbits.test.ts) against state vectors pulled from
   JPL Horizons rather than eyeballed against a picture that looks about right.

   Everything is heliocentric ecliptic J2000 in astronomical units unless the
   name says otherwise. That frame is the one the whole tab agrees in: the Sun at
   the origin, x towards the March equinox, z towards ecliptic north. An
   Earth-centred view is the same numbers with Earth's vector subtracted, which
   is why both cameras can share one set of positions.

   Loaded as a classic script (window.SMXOrbits) and as CommonJS (tests).
   ========================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SMXOrbits = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const rad = (d) => (d * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;

  /** Astronomical unit, kilometres (IAU 2012 definition — exact). */
  const AU_KM = 149597870.7;
  /** Mean Earth–Moon distance, kilometres. The unit close approaches are read in. */
  const LUNAR_DISTANCE_KM = 384400;
  const C_KM_S = 299792.458;
  const DAY_MS = 86400000;
  /** Gaussian gravitational constant, degrees/day — sets how fast a body of given `a` moves. */
  const GAUSS_DEG_DAY = 0.9856076686;

  /* -------------------------------- time -------------------------------- */

  /**
   * Julian Day from a Date.
   *
   * Civil time here is UTC and the theories below want Terrestrial Time, which
   * is ahead of it by about 69 seconds. At the speeds involved that is under a
   * kilometre for the Moon and metres for a planet, so it is deliberately not
   * corrected — stating that is worth more than a correction nothing here can
   * measure.
   */
  function julianDay(date) {
    return date.getTime() / DAY_MS + 2440587.5;
  }

  /** Julian centuries since J2000.0 (2000-01-01T12:00Z). */
  function centuriesSinceJ2000(date) {
    return (julianDay(date) - 2451545.0) / 36525;
  }

  /** Days since J2000.0 — the step asteroid mean anomalies are propagated over. */
  function daysSinceJ2000(date) {
    return julianDay(date) - 2451545.0;
  }

  /* ------------------------------- Kepler ------------------------------- */

  /**
   * Solve Kepler's equation M = E - e·sin E for the eccentric anomaly.
   *
   * Newton–Raphson, which converges in a handful of passes for everything that
   * orbits the Sun on a closed path. Near-parabolic comets (e → 1) are the case
   * it struggles with, so the starting guess leans on e and the iteration is
   * capped rather than trusted to always land.
   *
   * @param M mean anomaly, radians
   * @param e eccentricity
   * @returns eccentric anomaly, radians
   */
  function eccentricAnomaly(M, e) {
    const m = normaliseRadians(M);
    let E = e < 0.8 ? m : Math.PI;
    for (let i = 0; i < 60; i++) {
      const dE = (E - e * Math.sin(E) - m) / (1 - e * Math.cos(E));
      E -= dE;
      if (Math.abs(dE) < 1e-12) break;
    }
    return E;
  }

  /** Wrap radians to [-π, π), so the Kepler solver starts near its answer. */
  function normaliseRadians(x) {
    const t = ((x + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    return t - Math.PI;
  }

  /** Wrap degrees to [0, 360). */
  function normaliseDegrees(x) {
    return ((x % 360) + 360) % 360;
  }

  /* ------------------------------ elements ------------------------------ */

  /**
   * Position from classical orbital elements, in the heliocentric ecliptic frame.
   *
   * The elements are the six that every source quotes: size (a), shape (e), the
   * three angles that tilt the ellipse into space (i, Ω, ω), and where the body
   * sits along it (M). Everything else in this file is a way of getting those
   * six for some object at some moment.
   *
   * @param el {a, e, i, node, peri, M} — AU and degrees
   * @returns {x, y, z} AU
   */
  function positionFromElements(el) {
    const e = el.e;
    const E = eccentricAnomaly(rad(el.M), e);

    // Position in the orbital plane, with the perihelion on the +x axis.
    const xv = el.a * (Math.cos(E) - e);
    const yv = el.a * Math.sqrt(Math.max(0, 1 - e * e)) * Math.sin(E);

    const w = rad(el.peri), n = rad(el.node), i = rad(el.i);
    const cw = Math.cos(w), sw = Math.sin(w);
    const cn = Math.cos(n), sn = Math.sin(n);
    const ci = Math.cos(i), si = Math.sin(i);

    // Rotate: argument of perihelion, then inclination, then ascending node.
    const x = (cw * cn - sw * sn * ci) * xv + (-sw * cn - cw * sn * ci) * yv;
    const y = (cw * sn + sw * cn * ci) * xv + (-sw * sn + cw * cn * ci) * yv;
    const z = (sw * si) * xv + (cw * si) * yv;
    return { x, y, z };
  }

  /**
   * The ellipse itself, as points — what the 3D view draws as an orbit line.
   *
   * Sampled in eccentric anomaly rather than in time, so a comet's slow far end
   * does not eat the whole budget of points and leave the perihelion a corner.
   */
  function orbitPath(el, samples) {
    const n = Math.max(16, samples || 240);
    const out = new Array(n + 1);
    for (let k = 0; k <= n; k++) {
      const E = (2 * Math.PI * k) / n;
      const xv = el.a * (Math.cos(E) - el.e);
      const yv = el.a * Math.sqrt(Math.max(0, 1 - el.e * el.e)) * Math.sin(E);
      out[k] = rotateIntoEcliptic(xv, yv, el);
    }
    return out;
  }

  function rotateIntoEcliptic(xv, yv, el) {
    const w = rad(el.peri), n = rad(el.node), i = rad(el.i);
    const cw = Math.cos(w), sw = Math.sin(w);
    const cn = Math.cos(n), sn = Math.sin(n);
    const ci = Math.cos(i), si = Math.sin(i);
    return {
      x: (cw * cn - sw * sn * ci) * xv + (-sw * cn - cw * sn * ci) * yv,
      y: (cw * sn + sw * cn * ci) * xv + (-sw * sn + cw * cn * ci) * yv,
      z: (sw * si) * xv + (cw * si) * yv,
    };
  }

  /* ------------------------------- planets ------------------------------ */

  /**
   * Standish's approximate elements for the major planets, and their rates of
   * change per Julian century (JPL, "Approximate Positions of the Planets").
   *
   * Valid 1800–2050, which is the only window this tab lets you scrub through.
   * Each row is [a, e, i, L, longPeri, node] then the same six as rates; L is
   * the mean longitude and longPeri the longitude of perihelion, so the mean
   * anomaly and argument of perihelion are differences of those.
   *
   * The third row is the Earth–Moon barycentre, not Earth's centre: the two are
   * up to ~4700 km apart, which is 3e-5 AU and below anything this view shows.
   */
  const PLANETS = {
    mercury: { name: 'Mercury', radiusKm: 2439.7, colour: '#a89b8c', dayHours: 1407.6,
      el: [0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593],
      rate: [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081] },
    venus: { name: 'Venus', radiusKm: 6051.8, colour: '#e6c88c', dayHours: -5832.5,
      el: [0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255],
      rate: [0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418] },
    earth: { name: 'Earth', radiusKm: 6371.0, colour: '#4d8fd6', dayHours: 23.93,
      el: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0],
      rate: [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0] },
    mars: { name: 'Mars', radiusKm: 3389.5, colour: '#c1440e', dayHours: 24.62,
      el: [1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
      rate: [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343] },
    jupiter: { name: 'Jupiter', radiusKm: 69911, colour: '#d8ca9d', dayHours: 9.93,
      el: [5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
      rate: [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106] },
    saturn: { name: 'Saturn', radiusKm: 58232, colour: '#e3d9b0', dayHours: 10.66, ring: [1.24, 2.27],
      el: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
      rate: [-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794] },
    uranus: { name: 'Uranus', radiusKm: 25362, colour: '#9fd8e0', dayHours: -17.24, ring: [1.64, 2.00],
      el: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503],
      rate: [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589] },
    neptune: { name: 'Neptune', radiusKm: 24622, colour: '#4b70dd', dayHours: 16.11,
      el: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
      rate: [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664] },
  };

  const PLANET_ORDER = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];

  /** The six elements of a planet at a moment, already reduced to a/e/i/node/peri/M. */
  function planetElements(key, date) {
    const p = PLANETS[key];
    if (!p) throw new Error(`unknown planet ${key}`);
    const T = centuriesSinceJ2000(date);
    const [a, e, i, L, peri, node] = p.el.map((v, k) => v + p.rate[k] * T);
    return {
      a, e, i, node,
      peri: peri - node,                       // argument of perihelion
      M: normaliseDegrees(L - peri),           // mean anomaly
      key, name: p.name, radiusKm: p.radiusKm, colour: p.colour, ring: p.ring,
    };
  }

  /** Heliocentric position of a planet, AU. */
  function planetPosition(key, date) {
    return positionFromElements(planetElements(key, date));
  }

  /** Every planet at once — one pass for the whole scene. */
  function planetStates(date) {
    return PLANET_ORDER.map((key) => {
      const el = planetElements(key, date);
      const pos = positionFromElements(el);
      return Object.assign({}, el, { position: pos, sunAu: length(pos) });
    });
  }

  /* -------------------------------- moon -------------------------------- */

  /**
   * The Moon, geocentric ecliptic, from the four largest periodic terms.
   *
   * Truncated hard: the full theory runs to hundreds of terms for arcsecond
   * work, and this view is drawing a dot at a distance of a few hundred thousand
   * kilometres. What is kept is good to roughly a hundredth of a degree in
   * longitude and a few hundred kilometres in range, which is well inside the
   * width of the dot.
   */
  function moonGeocentric(date) {
    const T = centuriesSinceJ2000(date);
    const Lp = 218.316 + 481267.8813 * T;      // mean longitude
    const M = 134.963 + 477198.8676 * T;       // Moon's mean anomaly
    const Ms = 357.529 + 35999.0503 * T;       // Sun's mean anomaly
    const D = 297.850 + 445267.1115 * T;       // mean elongation
    const F = 93.272 + 483202.0175 * T;        // argument of latitude

    const lon = Lp + 6.289 * Math.sin(rad(M)) - 1.274 * Math.sin(rad(2 * D - M))
      + 0.658 * Math.sin(rad(2 * D)) - 0.186 * Math.sin(rad(Ms));
    const lat = 5.128 * Math.sin(rad(F)) + 0.281 * Math.sin(rad(M + F))
      - 0.278 * Math.sin(rad(F - M));
    const km = 385001 - 20905 * Math.cos(rad(M)) - 3699 * Math.cos(rad(2 * D - M))
      - 2956 * Math.cos(rad(2 * D));

    const au = km / AU_KM;
    const rl = rad(normaliseDegrees(lon)), rb = rad(lat);
    return {
      km,
      position: { x: au * Math.cos(rb) * Math.cos(rl), y: au * Math.cos(rb) * Math.sin(rl), z: au * Math.sin(rb) },
      longitude: normaliseDegrees(lon),
      latitude: lat,
      // Elongation from the Sun is what the phase is: 0° new, 180° full.
      phase: moonPhase(date, normaliseDegrees(lon)),
    };
  }

  /** Illuminated fraction and a name for it, from the Moon's elongation. */
  function moonPhase(date, moonLongitude) {
    const T = centuriesSinceJ2000(date);
    const sunLon = normaliseDegrees(280.459 + 36000.769 * T + 1.915 * Math.sin(rad(357.529 + 35999.0503 * T)));
    const elong = normaliseDegrees(moonLongitude - sunLon);
    const illuminated = (1 - Math.cos(rad(elong))) / 2;
    const names = ['new', 'waxing crescent', 'first quarter', 'waxing gibbous',
      'full', 'waning gibbous', 'last quarter', 'waning crescent'];
    return { elongation: elong, illuminated, name: names[Math.round(elong / 45) % 8] };
  }

  /* ------------------------------ distances ----------------------------- */

  const length = (v) => Math.hypot(v.x, v.y, v.z);
  const subtract = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });

  /**
   * How far apart two heliocentric positions are, in every unit the tab quotes.
   *
   * Lunar distances are included because that is the unit close approaches are
   * actually reported in — "0.031 AU" means nothing to most people, "12 times as
   * far as the Moon" means something immediately.
   */
  function separation(a, b) {
    const au = length(subtract(a, b));
    const km = au * AU_KM;
    return {
      au,
      km,
      lunarDistances: km / LUNAR_DISTANCE_KM,
      lightSeconds: km / C_KM_S,
    };
  }

  /**
   * Distance now, and whether it is opening or closing.
   *
   * The rate is a symmetric difference over a small step rather than a velocity
   * from the elements: it costs two more position evaluations, works for
   * anything that can report a position, and cannot disagree with the distance
   * it is quoted beside.
   */
  function rangeRate(positionAt, otherAt, date, stepMinutes) {
    const step = (stepMinutes || 30) * 60000;
    const before = separation(positionAt(new Date(+date - step)), otherAt(new Date(+date - step)));
    const after = separation(positionAt(new Date(+date + step)), otherAt(new Date(+date + step)));
    const seconds = (2 * step) / 1000;
    return {
      kmPerSecond: (after.km - before.km) / seconds,
      closing: after.km < before.km,
    };
  }

  /* --------------------------- small bodies ----------------------------- */

  /**
   * Turn a JPL Small-Body Database record into elements this file can propagate.
   *
   * SBDB quotes elements at an epoch with the mean anomaly frozen there, so the
   * body has to be moved forward to now: mean motion times elapsed days. It
   * gives mean motion directly when it has one, and where it does not — some
   * comet records — Kepler's third law supplies it from the semi-major axis.
   *
   * Hyperbolic and parabolic orbits (e >= 1) are rejected rather than drawn
   * wrong: their "semi-major axis" is negative or absent and the closed-ellipse
   * maths above would produce a confident, meaningless dot.
   */
  function elementsFromSbdb(sbdb) {
    const orbit = sbdb && sbdb.orbit;
    if (!orbit || !Array.isArray(orbit.elements)) throw new Error('no orbit in this record');
    const byName = {};
    for (const item of orbit.elements) byName[item.name] = Number(item.value);

    const e = byName.e;
    if (!Number.isFinite(e)) throw new Error('no eccentricity in this record');
    if (e >= 1) throw new Error('open orbit: this body is not on a closed ellipse');

    const a = Number.isFinite(byName.a) ? byName.a
      : Number.isFinite(byName.q) ? byName.q / (1 - e) : NaN;
    if (!Number.isFinite(a) || a <= 0) throw new Error('no usable semi-major axis');

    const epoch = Number(orbit.epoch);                        // Julian Day, TDB
    const n = Number.isFinite(byName.n) ? byName.n : GAUSS_DEG_DAY / Math.sqrt(a * a * a);
    const object = sbdb.object || {};

    // What is known about the body itself lives in a separate block, and only
    // when the request asked for it. Everything here is optional: a rock
    // discovered last week has an orbit and nothing else.
    const phys = {};
    for (const item of (sbdb.phys_par || [])) phys[item.name] = item.value;
    const number = (v) => {
      const x = Number(v);
      return v !== null && v !== undefined && v !== '' && Number.isFinite(x) ? x : null;
    };
    // Older records put H among the orbital elements; current ones do not.
    const magnitude = number(phys.H) !== null ? number(phys.H) : number(byName.H);
    const measured = number(phys.diameter);
    const albedo = number(phys.albedo);

    return {
      a, e,
      i: byName.i,
      node: byName.om,
      peri: byName.w,
      M0: byName.ma,
      epoch,
      meanMotion: n,
      name: object.fullname || object.shortname || object.des || 'unnamed body',
      designation: object.des || null,
      neo: !!object.neo,
      pha: !!object.pha,
      absoluteMagnitude: magnitude,
      // A measured diameter when JPL has one, and otherwise the estimate from
      // brightness — using the real albedo if it is known, since assuming 0.14
      // for a body measured at 0.35 is most of the error in that estimate.
      diameterKm: measured !== null ? measured : diameterFromMagnitude(magnitude, albedo),
      diameterMeasured: measured !== null,
      albedo,
      rotationHours: number(phys.rot_per),
      spectralType: phys.spec_B || phys.spec_T || null,
      periodDays: 360 / n,
    };
  }

  /**
   * Move a small body from its epoch to a moment, and report where it is.
   *
   * `elementsFromSbdb` gives the mean anomaly at an epoch; only the mean anomaly
   * changes with time in this model, which is what makes a whole list of
   * asteroids cheap to redraw every frame.
   */
  function smallBodyAt(el, date) {
    const days = julianDay(date) - el.epoch;
    const M = normaliseDegrees(el.M0 + el.meanMotion * days);
    const moved = Object.assign({}, el, { M });
    return { elements: moved, position: positionFromElements(moved) };
  }

  /**
   * One row of a bulk SBDB query into elements.
   *
   * The query API answers with a `fields` list and rows of bare strings — the
   * same shape as the close-approach table, and read the same way: by field
   * name, never by column position. This is how thousands of asteroids arrive in
   * one request instead of one request each.
   *
   * Returns null for a row that cannot be propagated (an open orbit, a missing
   * element) rather than a body that would be drawn in the wrong place.
   */
  function elementsFromQueryRow(fields, row) {
    const at = {};
    fields.forEach((name, i) => { at[name] = i; });
    const number = (key) => {
      const raw = row[at[key]];
      if (raw === null || raw === undefined || raw === '') return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    };

    const e = number('e'), a = number('a');
    const i = number('i'), node = number('om'), peri = number('w'), M0 = number('ma');
    const epoch = number('epoch');
    if (e === null || a === null || i === null || node === null || peri === null
      || M0 === null || epoch === null) return null;
    if (e >= 1 || a <= 0) return null;                  // not on a closed ellipse

    const n = GAUSS_DEG_DAY / Math.sqrt(a * a * a);
    const magnitude = number('H');
    const measured = number('diameter');
    const albedo = number('albedo');
    const name = String(row[at.full_name] || '').trim();

    return {
      a, e, i, node, peri, M0, epoch,
      meanMotion: n,
      periodDays: 360 / n,
      name,
      designation: name,
      absoluteMagnitude: magnitude,
      diameterKm: measured !== null ? measured : diameterFromMagnitude(magnitude, albedo),
      diameterMeasured: measured !== null,
      albedo,
      orbitClass: row[at.class] || null,
      pha: row[at.pha] === 'Y',
      neo: row[at.neo] === 'Y',
    };
  }

  /**
   * The shape of an orbit, in the terms people actually ask about.
   *
   * Perihelion and aphelion are the two numbers that say where a body spends its
   * time; the tilt is the one that says whether it can ever be near us at all.
   * All derived from the elements, so this is naming what is already there
   * rather than computing anything new.
   */
  function orbitGeometry(el) {
    const q = el.a * (1 - el.e);
    const Q = el.a * (1 + el.e);
    return {
      semiMajorAu: el.a,
      perihelionAu: q,
      aphelionAu: Q,
      eccentricity: el.e,
      tiltDegrees: el.i,
      nodeDegrees: el.node,
      perihelionArgumentDegrees: el.peri,
      periodDays: el.periodDays || (360 / (el.meanMotion || (GAUSS_DEG_DAY / Math.sqrt(el.a ** 3)))),
      // How far out of the ecliptic it can get, which is what the tilt means in
      // distance rather than in degrees.
      highestAu: Q * Math.sin(rad(el.i)),
      // A circle has e = 0; anything past about 0.3 is visibly a long ellipse.
      shape: el.e < 0.05 ? 'nearly circular' : el.e < 0.3 ? 'slightly elliptical'
        : el.e < 0.6 ? 'elliptical' : 'a long, stretched ellipse',
    };
  }

  /** Where perihelion and the ascending node sit in space, for drawing them. */
  function orbitMarkers(el) {
    return {
      perihelion: positionFromElements(Object.assign({}, el, { M: 0 })),
      aphelion: positionFromElements(Object.assign({}, el, { M: 180 })),
      // The node line is where the orbit crosses the ecliptic: the two points at
      // true anomaly -ω and 180°-ω.
      ascending: rotateIntoEcliptic(el.a * (1 - el.e * el.e) / (1 + el.e * Math.cos(rad(-el.peri))), 0,
        Object.assign({}, el, { peri: 0, node: el.node, i: el.i })),
    };
  }

  /**
   * When this body next passes perihelion.
   *
   * The mean anomaly is an angle that grows at a constant rate, so the time to
   * the next zero crossing is simply how far it has left to go divided by that
   * rate. Nothing iterative is needed, which matters when it is asked for a
   * thousand asteroids at once.
   */
  function nextPerihelion(el, from) {
    const days = julianDay(from) - el.epoch;
    const M = normaliseDegrees(el.M0 + el.meanMotion * days);
    const toGo = (360 - M) % 360;
    return new Date(+from + (toGo / el.meanMotion) * DAY_MS);
  }

  /**
   * Diameter in kilometres implied by an absolute magnitude, for a given albedo.
   *
   * The standard relation. Albedo is rarely measured, so 0.14 is assumed — a
   * middling stony value — and the answer is a factor-of-two estimate, not a
   * measurement. Anything shown from this should say "about".
   */
  function diameterFromMagnitude(H, albedo) {
    if (!Number.isFinite(H)) return null;
    const p = albedo || 0.14;
    return (1329 / Math.sqrt(p)) * Math.pow(10, -0.2 * H);
  }

  /* ---------------------------- trajectories ---------------------------- */

  /**
   * Where a spacecraft is, from a table of positions rather than an orbit.
   *
   * A probe under thrust, or one that has been flung past four planets, is not on
   * a Kepler ellipse at all — its path is only known as a list of positions
   * someone integrated. So it is fetched as a table and read back by
   * interpolating between the two samples either side of the moment wanted.
   *
   * Straight-line interpolation is enough here and deliberately so: over a day,
   * a probe's path curves by far less than the dot drawn for it, and pretending
   * to a smoother curve would be inventing precision the table does not carry.
   *
   * Outside the span the table covers it returns the nearest end and says so,
   * rather than extrapolating a spacecraft into somewhere it has never been.
   */
  function trajectoryAt(samples, date) {
    if (!samples || !samples.length) return null;
    const jd = julianDay(date);

    if (jd <= samples[0].jd) {
      return { position: samples[0].position, outsideSpan: jd < samples[0].jd, at: 'start' };
    }
    const last = samples[samples.length - 1];
    if (jd >= last.jd) {
      return { position: last.position, outsideSpan: jd > last.jd, at: 'end' };
    }

    // Binary search: these tables can be hundreds of rows and this is called for
    // every probe on every frame.
    let lo = 0, hi = samples.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (samples[mid].jd <= jd) lo = mid; else hi = mid;
    }
    const a = samples[lo], b = samples[hi];
    const span = b.jd - a.jd;
    const f = span === 0 ? 0 : (jd - a.jd) / span;
    return {
      position: {
        x: a.position.x + (b.position.x - a.position.x) * f,
        y: a.position.y + (b.position.y - a.position.y) * f,
        z: a.position.z + (b.position.z - a.position.z) * f,
      },
      outsideSpan: false,
      at: 'between',
    };
  }

  /** The span a trajectory table covers, for saying what it can and cannot answer. */
  function trajectorySpan(samples) {
    if (!samples || !samples.length) return null;
    const toDate = (jd) => new Date((jd - 2440587.5) * DAY_MS);
    return { from: toDate(samples[0].jd), to: toDate(samples[samples.length - 1].jd), samples: samples.length };
  }

  /* ------------------------------ forecast ------------------------------ */

  /**
   * What is coming for Earth, found by running the model forward.
   *
   * Every one of these is a turning point or a crossing — the instant a distance
   * stops shrinking, the moment the Moon's elongation passes 180° — so they are
   * found by stepping rather than looked up in a table. That means the same code
   * answers for any date, including ones no almanac on this machine covers, and
   * that an event can never disagree with the position the view is drawing.
   *
   * Stepped at six hours, which finds every event below to within a few hours —
   * enough for "the 14th of March", which is what the list says.
   */
  function forecast(from, days, options) {
    const opts = options || {};
    const stepHours = opts.stepHours || 6;
    // `days || 365` would turn a deliberate zero into a whole year, which is the
    // same falsy trap that makes `Number(null)` a measurement of nothing.
    const span = days === undefined || days === null ? 365 : days;
    const steps = Math.ceil(span * (24 / stepHours));
    const events = [];

    let previous = null, wasClosing = {}, wasPhase = null, wasSunDistance = null, sunWasFalling = null;

    for (let k = 0; k <= steps; k++) {
      const at = new Date(+from + k * stepHours * 3600000);
      const earth = planetPosition('earth', at);

      // Each planet's closest approach to Earth: where closing turns to opening.
      for (const key of PLANET_ORDER) {
        if (key === 'earth') continue;
        const d = separation(planetPosition(key, at), earth).km;
        if (previous) {
          const closing = d < previous[key];
          if (wasClosing[key] !== undefined && wasClosing[key] && !closing) {
            events.push({
              kind: 'closest', body: key, when: at,
              text: `${PLANETS[key].name} at its closest to Earth — ${describeDistance(d)}`,
            });
          }
          wasClosing[key] = closing;
        }
        (previous = previous || {})[key] = d;
      }

      // New and full moon, from the elongation passing 0° or 180°.
      const moon = moonGeocentric(at);
      if (wasPhase !== null) {
        const crossedFull = wasPhase < 180 && moon.phase.elongation >= 180;
        const crossedNew = wasPhase > 180 && moon.phase.elongation < wasPhase && moon.phase.elongation < 90;
        if (crossedFull) events.push({ kind: 'moon', when: at, text: `Full moon — ${Math.round(moon.km).toLocaleString()} km away` });
        else if (crossedNew) events.push({ kind: 'moon', when: at, text: `New moon — ${Math.round(moon.km).toLocaleString()} km away` });
      }
      wasPhase = moon.phase.elongation;

      // Earth's own perihelion and aphelion: the turning points of its distance
      // from the Sun, which is why January is not the cold part of the orbit.
      const sunDistance = length(earth);
      if (wasSunDistance !== null) {
        const falling = sunDistance < wasSunDistance;
        if (sunWasFalling !== null && sunWasFalling !== falling) {
          events.push({
            kind: 'earth', when: at,
            text: falling
              ? `Earth at its furthest from the Sun — ${sunDistance.toFixed(4)} AU`
              : `Earth at its closest to the Sun — ${sunDistance.toFixed(4)} AU`,
          });
        }
        sunWasFalling = falling;
      }
      wasSunDistance = sunDistance;
    }

    return events.sort((a, b) => a.when - b.when);
  }

  /* ------------------------------ formatting ---------------------------- */

  /** A distance said the way a person would say it, given how far it is. */
  function describeDistance(km) {
    if (!Number.isFinite(km)) return '—';
    const ld = km / LUNAR_DISTANCE_KM;
    if (km < 1e6) return `${Math.round(km).toLocaleString()} km · ${ld.toFixed(2)} lunar distances`;
    const au = km / AU_KM;
    if (au < 0.1) return `${(km / 1e6).toFixed(2)} million km · ${ld.toFixed(1)} lunar distances`;
    return `${au.toFixed(3)} AU · ${(km / 1e6).toFixed(1)} million km`;
  }

  /** Light travel time, said in whatever unit keeps it readable. */
  function describeLightTime(seconds) {
    if (!Number.isFinite(seconds)) return '—';
    if (seconds < 90) return `${seconds.toFixed(1)} light-seconds`;
    if (seconds < 5400) return `${(seconds / 60).toFixed(1)} light-minutes`;
    return `${(seconds / 3600).toFixed(2)} light-hours`;
  }

  return {
    AU_KM, LUNAR_DISTANCE_KM, C_KM_S, PLANETS, PLANET_ORDER,
    julianDay, centuriesSinceJ2000, daysSinceJ2000,
    eccentricAnomaly, normaliseDegrees, normaliseRadians,
    positionFromElements, orbitPath,
    planetElements, planetPosition, planetStates,
    moonGeocentric, moonPhase,
    length, subtract, separation, rangeRate,
    elementsFromSbdb, elementsFromQueryRow, smallBodyAt, diameterFromMagnitude,
    orbitGeometry, orbitMarkers, nextPerihelion, forecast,
    trajectoryAt, trajectorySpan,
    describeDistance, describeLightTime,
  };
});
