/* ==========================================================================
   star-map.x-cosmos.js — Map Lab's Space tab: the solar system explorer.

   The panel, the data, and the pixel view that star-map.x-space.js draws into.
   Positions come from star-map.x-orbits.js; nothing here recomputes a distance
   for itself, so the number in a tooltip and the dot on screen cannot disagree.

   Where the data comes from, and why each is fetched the way it is:

     · Planets and the Moon    computed on this machine, every frame. No network.
     · Close approaches        JPL SSD cad.api — passes near Earth in a window.
     · Impact risk             JPL Sentry — objects with a non-zero chance.
     · Any object by name      JPL SBDB — real elements for asteroids and comets.
     · Today's near-Earth list NASA NeoWs — the daily feed with size estimates.
     · Spacecraft              JPL Horizons — state vectors for the probes.

   Every JPL host answers 200 with no Access-Control-Allow-Origin header, so all
   of them are fetched with `host: true` and go out through the desktop app.
   NeoWs sends `*` and stays in the browser. That split is why a JPL list is
   empty in a plain browser tab and full in the app, and the panel says so.

   The event console is computed, not fetched: as the clock runs, the tab watches
   its own numbers for the moments that matter — a planet at its closest to
   Earth, a full moon, a listed asteroid making its pass — and logs them. That
   way an event can never contradict the view it is describing.
   ========================================================================== */
(function () {
  'use strict';

  const X = window.SMX, O = window.SMXOrbits, Sp = window.SMXSpace;

  const JPL_SSD = 'https://ssd-api.jpl.nasa.gov';
  const HORIZONS = 'https://ssd.jpl.nasa.gov/api/horizons.api';
  const NEOWS = 'https://api.nasa.gov/neo/rest/v1/feed';
  // NASA's own published demo key: rate limited and shared, which is fine for a
  // once-a-session list and means there is nothing to sign up for.
  const NASA_KEY = 'DEMO_KEY';

  /* ============================== parsing ============================== */

  /**
   * A number, or null — never zero for something that was absent.
   *
   * JPL leaves unmeasured columns as null and NASA sends numbers as strings, and
   * `Number(null)` is 0, which reads as a real measurement of zero. Every field
   * that can be missing goes through here.
   */
  function num(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * JPL's close-approach table into rows.
   *
   * The column order is read from the response's own `fields` array rather than
   * assumed — it has changed before, and an off-by-one column here would quietly
   * report the wrong miss distance.
   */
  function parseCloseApproaches(json) {
    if (!json || !Array.isArray(json.fields) || !Array.isArray(json.data)) return [];
    const at = {};
    json.fields.forEach((name, i) => { at[name] = i; });
    return json.data.map((row) => {
      const au = num(row[at.dist]);
      const km = au * O.AU_KM;
      const magnitude = num(row[at.h]);
      // A measured diameter when JPL has one — most rows do not, and then the
      // brightness estimate stands in, which is a factor-of-two answer.
      const measured = num(row[at.diameter]);
      return {
        id: `cad:${row[at.des]}:${row[at.cd]}`,
        designation: String(row[at.des] || '').trim(),
        when: parseJplDate(row[at.cd]),
        whenText: String(row[at.cd] || ''),
        au,
        km,
        lunarDistances: km / O.LUNAR_DISTANCE_KM,
        kmPerSecond: num(row[at.v_rel]),
        absoluteMagnitude: magnitude,
        diameterKm: measured !== null ? measured : O.diameterFromMagnitude(magnitude),
        diameterMeasured: measured !== null,
        // JPL's own uncertainty, kept because "inside the Moon" means less when
        // the error bar is wider than the gap.
        minimumAu: num(row[at.dist_min]),
        maximumAu: num(row[at.dist_max]),
      };
    }).filter((r) => Number.isFinite(r.au)).sort((a, b) => a.au - b.au);
  }

  /** "2026-Aug-13 04:35" — JPL publishes UTC, and Date would read it as local. */
  function parseJplDate(text) {
    const m = String(text || '').match(/^(\d{4})-([A-Za-z]{3})-(\d{2})\s*(\d{2})?:?(\d{2})?/);
    if (!m) return null;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months.indexOf(m[2]);
    if (month < 0) return null;
    return new Date(Date.UTC(+m[1], month, +m[3], +(m[4] || 0), +(m[5] || 0)));
  }

  /**
   * The Sentry risk table.
   *
   * Every probability here is tiny, and the honest presentation says so: sorted
   * by probability but printed as "1 in N", because 2.7e-3 reads as frightening
   * and "1 in 370" reads as what it is.
   */
  function parseSentry(json) {
    const rows = (json && json.data) || [];
    return rows.map((r) => {
      const probability = num(r.ip);
      return {
        id: `sentry:${r.des}`,
        designation: String(r.des || '').trim(),
        fullname: String(r.fullname || r.des || '').trim(),
        probability,
        oneIn: probability > 0 ? Math.round(1 / probability) : null,
        torino: num(r.ts_max) || 0,
        palermo: num(r.ps_max),
        diameterKm: num(r.diameter),
        velocityKmS: num(r.v_inf),
        // "2056-2113": the first year anything could happen, and the span.
        firstYear: Number(String(r.range || '').split('-')[0]) || null,
        yearRange: String(r.range || ''),
        impacts: num(r.n_imp) || 0,
      };
    }).filter((r) => Number.isFinite(r.probability)).sort((a, b) => b.probability - a.probability);
  }

  /** NASA's daily near-Earth feed, flattened out of its per-date buckets. */
  function parseNeoFeed(json) {
    const byDate = (json && json.near_earth_objects) || {};
    const out = [];
    for (const date of Object.keys(byDate)) {
      for (const neo of byDate[date]) {
        const approach = (neo.close_approach_data || [])[0] || {};
        const size = (neo.estimated_diameter || {}).kilometers || {};
        out.push({
          id: `neows:${neo.id}`,
          designation: String(neo.name || '').replace(/[()]/g, '').trim(),
          when: approach.epoch_date_close_approach ? new Date(Number(approach.epoch_date_close_approach)) : null,
          km: num((approach.miss_distance || {}).kilometers),
          lunarDistances: num((approach.miss_distance || {}).lunar),
          kmPerSecond: num((approach.relative_velocity || {}).kilometers_per_second),
          // NASA gives a range rather than a figure, because size is inferred.
          diameterMinKm: num(size.estimated_diameter_min),
          diameterMaxKm: num(size.estimated_diameter_max),
          hazardous: !!neo.is_potentially_hazardous_asteroid,
          absoluteMagnitude: num(neo.absolute_magnitude_h),
        });
      }
    }
    return out.filter((r) => Number.isFinite(r.km)).sort((a, b) => a.km - b.km);
  }

  /**
   * A state vector out of a Horizons ephemeris.
   *
   * Horizons answers with a plain-text report wrapped in JSON. Returns null
   * rather than throwing when the report is an error or a list of candidates,
   * which is what comes back for an ambiguous name.
   */
  function parseHorizonsVector(result) {
    const text = String(result || '');
    const start = text.indexOf('$$SOE');
    const end = text.indexOf('$$EOE');
    if (start < 0 || end < 0) return null;
    const m = text.slice(start, end)
      .match(/X\s*=\s*(-?[\d.E+-]+)\s*Y\s*=\s*(-?[\d.E+-]+)\s*Z\s*=\s*(-?[\d.E+-]+)/);
    if (!m) return null;
    const v = { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) };
    return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z) ? v : null;
  }

  /* ============================== fetching ============================= */

  /** JPL hosts send no CORS header, so every one of these goes through the app. */
  const jpl = (url, timeout) => X.json(url, { host: true, timeout: timeout || 25000 });

  async function fetchCloseApproaches(days, maxLunarDistances) {
    const from = new Date();
    const to = new Date(+from + (days || 60) * 86400000);
    const au = ((maxLunarDistances || 20) * O.LUNAR_DISTANCE_KM) / O.AU_KM;
    return parseCloseApproaches(await jpl(`${JPL_SSD}/cad.api?dist-max=${au.toFixed(6)}`
      + `&date-min=${from.toISOString().slice(0, 10)}&date-max=${to.toISOString().slice(0, 10)}`
      + '&sort=dist&diameter=true'));
  }

  const fetchSentry = async () => parseSentry(await jpl(`${JPL_SSD}/sentry.api`));

  async function fetchSmallBody(query) {
    // phys-par is opt-in, and it is where the size, albedo, spin and spectral
    // type live — without it every object comes back as an orbit and a name.
    const data = await jpl(`${JPL_SSD}/sbdb.api?sstr=${encodeURIComponent(query)}&full-prec=true&phys-par=true`);
    if (data && data.message) throw new Error(data.message);
    // An ambiguous name comes back as a list of candidates rather than an object.
    if (data && data.list) throw new Error(`${data.list.length} objects match "${query}" — be more specific`);
    return O.elementsFromSbdb(data);
  }

  async function fetchNeoFeed() {
    const today = new Date().toISOString().slice(0, 10);
    // NeoWs sends Access-Control-Allow-Origin: *, so this one stays in the browser.
    return parseNeoFeed(await X.json(`${NEOWS}?start_date=${today}&end_date=${today}&api_key=${NASA_KEY}`,
      { timeout: 20000 }));
  }

  /** Heliocentric position of one spacecraft, AU, at a moment. */
  async function fetchSpacecraft(command, date) {
    const day = (date || new Date()).toISOString().slice(0, 10);
    const next = new Date(+(date || new Date()) + 86400000).toISOString().slice(0, 10);
    const data = await jpl(`${HORIZONS}?format=json&COMMAND=${encodeURIComponent(`'${command}'`)}`
      + `&OBJ_DATA='NO'&MAKE_EPHEM='YES'&EPHEM_TYPE='VECTORS'&CENTER='500@10'&START_TIME='${day}'`
      + `&STOP_TIME='${next}'&STEP_SIZE='1d'&VEC_TABLE='1'&REF_PLANE='ECLIPTIC'&OUT_UNITS='AU-D'`, 30000);
    const vector = parseHorizonsVector(data && data.result);
    if (!vector) throw new Error('Horizons returned no vector for this object');
    return vector;
  }

  /**
   * Thousands of asteroids in one request.
   *
   * The bulk query returns elements, not positions, which is the whole trick:
   * 42,127 near-Earth asteroids are about a megabyte of elements, and every one
   * of their positions for every moment afterwards is computed here for nothing.
   * Fetching positions instead would be a request per body per frame.
   *
   * Sorted by brightness so a capped list is the biggest objects rather than an
   * arbitrary slice, and the panel says both numbers.
   */
  async function fetchAsteroids(group, limit) {
    const fields = 'full_name,e,a,i,om,w,ma,epoch,H,diameter,albedo,class,pha,neo';
    const which = group === 'pha' ? 'sb-group=pha' : 'sb-group=neo&sb-kind=a';
    const data = await jpl(`${JPL_SSD}/sbdb_query.api?fields=${fields}&${which}`
      + `&sort=H&limit=${Math.max(1, limit || 400)}`, 60000);
    if (!data || !Array.isArray(data.fields) || !Array.isArray(data.data)) {
      throw new Error('the query returned no rows');
    }
    const out = [];
    for (const row of data.data) {
      const el = O.elementsFromQueryRow(data.fields, row);
      // A row that cannot be propagated is dropped rather than drawn wrong.
      if (el) out.push(el);
    }
    return { asteroids: out, total: Number(data.count) || out.length, returned: data.data.length };
  }

  /** The probes worth plotting, with the ids Horizons answers to. */
  const SPACECRAFT = [
    { id: 'voyager1', command: '-31', name: 'Voyager 1' },
    { id: 'voyager2', command: '-32', name: 'Voyager 2' },
    { id: 'newhorizons', command: '-98', name: 'New Horizons' },
    { id: 'jwst', command: '-170', name: 'James Webb' },
    { id: 'parker', command: '-96', name: 'Parker Solar Probe' },
  ];

  /* ============================== speeds =============================== */

  /**
   * How fast something is moving, from the positions themselves.
   *
   * A symmetric difference over a short step rather than a velocity from the
   * elements: it works for anything that can report a position — planet,
   * asteroid, or a spacecraft whose only data is one vector — and it cannot
   * disagree with the distance quoted beside it.
   */
  function speedKmS(positionAt, date, stepMinutes) {
    const step = (stepMinutes || 30) * 60000;
    const before = positionAt(new Date(+date - step));
    const after = positionAt(new Date(+date + step));
    if (!before || !after) return null;
    const km = Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z) * O.AU_KM;
    return km / ((2 * step) / 1000);
  }

  /* =============================== state =============================== */

  const LAYERS = [
    { id: 'planets', label: 'Planets', on: true },
    { id: 'moon', label: 'The Moon', on: true },
    { id: 'orbits', label: 'Orbit lines', on: true },
    { id: 'labels', label: 'Names', on: true },
    // Ticking this fetches the whole population the first time, then draws every
    // one of them moving on its own orbit. It is off to start with because it is
    // the one switch here that costs a megabyte and a second.
    { id: 'belt', label: 'All near-Earth asteroids', on: false, loads: true },
    { id: 'asteroids', label: 'Asteroids followed', on: true },
    { id: 'approaches', label: 'Close approaches', on: true },
    { id: 'spacecraft', label: 'Spacecraft', on: true },
  ];

  const state = {
    date: new Date(),
    playing: false,
    speed: 1,                      // simulated days per real second
    frame: 'heliocentric',
    scaleMode: 'compressed',
    view: null,
    selected: null,
    hovered: null,
    tracked: new Map(),            // id -> { kind, name, elements | vector, layer }
    lists: { close: [], sentry: [], neo: [], spacecraft: [] },
    belt: { loaded: false, loading: false, asteroids: [], total: 0, limit: 400, group: 'neo' },
    upcoming: [],
    events: [],
    watch: {},                     // what the event watcher saw last tick
    positions: {},
    moon: null,
    raf: null,
  };

  /* ============================== events =============================== */

  /**
   * The console of things happening.
   *
   * Everything in it is derived from the same positions the view is drawing, so
   * it cannot describe a moment the view is not showing. Events are found by
   * watching for turning points — the instant a distance stops shrinking is a
   * closest approach, and it is the only way to name one without a table.
   */
  function logEvent(kind, text, when) {
    const event = { kind, text, when: when || new Date(state.date), at: Date.now() };
    state.events.unshift(event);
    state.events = state.events.slice(0, 60);
    drawEvents();
    return event;
  }

  /**
   * Watch the numbers for the moments worth naming.
   *
   * Called on every tick with the fresh positions. Each watcher keeps one value
   * from last time; a sign change between them is the event. Nothing is fetched
   * and nothing is hard-coded, so this works at any date the clock is scrubbed to.
   */
  function watchForEvents() {
    const earth = state.positions.earth;
    if (!earth) return;

    for (const key of O.PLANET_ORDER) {
      if (key === 'earth') continue;
      const d = O.separation(state.positions[key], earth).km;
      const previous = state.watch[key];
      state.watch[key] = d;
      if (previous === undefined) continue;
      const closing = d < previous;
      const wasClosing = state.watch[`${key}:closing`];
      state.watch[`${key}:closing`] = closing;
      if (wasClosing === undefined || wasClosing === closing) continue;
      // The turn itself: closing → opening is the closest it gets.
      logEvent(closing ? 'far' : 'near',
        `${O.PLANETS[key].name} ${closing ? 'is now moving closer to' : 'has just passed closest to'} Earth`
        + ` — ${O.describeDistance(d)}`);
    }

    if (state.moon) {
      const phase = state.moon.phase.name;
      if (state.watch.moonPhase && state.watch.moonPhase !== phase && (phase === 'full' || phase === 'new')) {
        logEvent('moon', `${phase === 'full' ? 'Full' : 'New'} moon — ${Math.round(state.moon.km).toLocaleString()} km away`);
      }
      state.watch.moonPhase = phase;
    }

    // A listed pass, announced as the clock reaches it.
    for (const row of state.lists.close) {
      if (!row.when || state.watch[`cad:${row.id}`]) continue;
      if (Math.abs(+row.when - +state.date) < 12 * 3600000) {
        state.watch[`cad:${row.id}`] = true;
        logEvent('approach', `${row.designation} passes Earth at ${row.lunarDistances.toFixed(1)} lunar distances`
          + `${row.kmPerSecond ? `, ${row.kmPerSecond.toFixed(1)} km/s` : ''}`, row.when);
      }
    }
  }

  /* ============================== the view ============================= */

  let overlay = null, root = null, tooltip = null, eventBox = null;

  /** The explorer, opened over the map rather than squeezed into the panel. */
  function openView() {
    if (overlay) { overlay.style.display = ''; state.view.redraw(); return; }
    overlay = X.el(`
      <div class="smx-space" id="smxSpace">
        <div class="smx-space-canvas"></div>
        <div class="smx-space-hud">
          <div><b id="smxSpaceTitle">Solar system</b></div>
          <div class="smx-hint" id="smxSpaceSub"></div>
          <div class="smx-hint" id="smxSpaceClock2"></div>
          <div class="smx-space-geometry" id="smxGeometry" hidden></div>
        </div>
        <div class="smx-space-layers" id="smxSpaceLayers"></div>
        <div class="smx-space-console">
          <div class="smx-space-console-head">Events <span class="smx-hint" id="smxEventCount"></span></div>
          <div id="smxEvents"></div>
        </div>
        <div class="smx-space-tip" id="smxTip" hidden></div>
        <button class="smx-space-close" title="Close the explorer" aria-label="Close the explorer">✕</button>
      </div>`);
    document.body.appendChild(overlay);
    tooltip = overlay.querySelector('#smxTip');
    eventBox = overlay.querySelector('#smxEvents');
    overlay.querySelector('.smx-space-close').addEventListener('click', () => { overlay.style.display = 'none'; });

    // The checkboxes, right on the view.
    overlay.querySelector('#smxSpaceLayers').innerHTML = LAYERS.map((l) =>
      `<label class="smx-space-layer"><input type="checkbox" data-layer="${l.id}"${l.on ? ' checked' : ''}> ${X.esc(l.label)}</label>`).join('');
    X.on(overlay, '[data-layer]', 'change', (_e, box) => toggleLayer(box.dataset.layer, box.checked, box));

    try {
      state.view = Sp.createView(overlay.querySelector('.smx-space-canvas'), {
        frame: state.frame,
        scaleMode: state.scaleMode,
        onHover: (id, at) => showTooltip(id, at),
        onSelect: (id) => { state.selected = id; drawTitle(); },
      });
    } catch (e) {
      overlay.querySelector('.smx-space-canvas').innerHTML = `<div class="smx-space-fail">${X.esc(e.message)}</div>`;
      return;
    }
    for (const l of LAYERS) state.view.setVisible(l.id, l.on);

    buildBodies();
    tick(true);
    drawEvents();
    if (!state.raf) state.raf = requestAnimationFrame(loop);
  }

  /** The permanent contents: planets, their orbits, and the Moon. */
  function buildBodies() {
    const SIZES = { mercury: 5, venus: 7, earth: 7, mars: 6, jupiter: 12, saturn: 11, uranus: 9, neptune: 9 };
    for (const key of O.PLANET_ORDER) {
      const p = O.PLANETS[key];
      state.view.setBody({
        id: key, layer: 'planets', label: p.name, colour: p.colour,
        size: SIZES[key], ring: !!p.ring,
        orbit: O.orbitPath(O.planetElements(key, state.date), 180),
        orbitColour: p.colour,
      });
    }
    state.view.setBody({ id: 'moon', layer: 'moon', label: 'Moon', colour: '#cfd4da', size: 4 });
    for (const [id, entry] of state.tracked) addTracked(id, entry);
  }

  /**
   * Load the asteroid population and put every one of them in the view.
   *
   * Each gets its own orbit path, computed once here rather than per frame — the
   * ellipse does not change, only where the body sits on it. Orbits are sampled
   * at 64 points instead of the 180 a planet gets: at this size on screen the
   * difference is invisible and the saving is thousands of points a frame.
   */
  async function loadBelt() {
    if (state.belt.loading) return;
    state.belt.loading = true;
    drawBeltStatus('Asking JPL for the asteroid population…');
    try {
      const { asteroids, total } = await fetchAsteroids(state.belt.group, state.belt.limit);
      state.belt.asteroids = asteroids;
      state.belt.total = total;
      state.belt.loaded = true;
      if (state.view) {
        for (const el of asteroids) {
          state.view.setBody({
            id: `belt:${el.name}`,
            layer: 'belt',
            label: el.name,
            alwaysLabel: false,               // named only under the pointer
            size: el.pha ? 3 : 2,
            colour: el.pha ? Sp.PALETTE.approach : Sp.PALETTE.asteroid,
            orbit: O.orbitPath(el, 64),
            orbitColour: el.pha ? Sp.PALETTE.approach : Sp.PALETTE.orbit,
            orbitOpacity: el.pha ? 0.35 : 0.16,
            markers: O.orbitMarkers(el),
            elements: el,
          });
        }
      }
      tick();
      const hazardous = asteroids.filter((a) => a.pha).length;
      logEvent('data', `${asteroids.length} asteroids drawn of ${total.toLocaleString()} known`
        + ` — ${hazardous} flagged potentially hazardous`);
      drawBeltStatus();
    } catch (e) {
      drawBeltStatus(`Could not load them: ${(e && e.message) || e}`);
    } finally {
      state.belt.loading = false;
    }
  }

  function drawBeltStatus(message) {
    const box = root && root.querySelector('#smxBeltStatus');
    if (!box) return;
    if (message) { box.innerHTML = `<div class="smx-hint">${X.esc(message)}</div>`; return; }
    if (!state.belt.loaded) {
      box.innerHTML = '<div class="smx-hint">Not loaded yet. Tick the box above to fetch them.</div>';
      return;
    }
    const skipped = state.view ? state.view.orbitsSkipped() : 0;
    box.innerHTML = `<div class="smx-hint">${state.belt.asteroids.length} of `
      + `${state.belt.total.toLocaleString()} known near-Earth asteroids, brightest first, each on its own orbit.`
      + `${skipped ? ` Orbit lines are drawn for ${state.belt.asteroids.length - skipped} of them and the rest`
        + ' show as moving dots — every position is computed, only the lines are budgeted.' : ''}</div>`;
  }

  function addTracked(id, entry) {
    if (!state.view) return;
    if (entry.kind === 'body') {
      state.view.setBody({
        // Four pixels for anything on a small-body orbit: the real sizes span
        // metres to hundreds of kilometres and none of them is a pixel, so the
        // dot says "rock", not "this big".
        id, layer: entry.layer || 'asteroids', label: entry.name, size: 4,
        colour: entry.layer === 'approaches' ? Sp.PALETTE.approach : Sp.PALETTE.asteroid,
        orbit: O.orbitPath(entry.elements, 180),
        orbitColour: entry.layer === 'approaches' ? Sp.PALETTE.approach : Sp.PALETTE.asteroid,
      });
    } else {
      state.view.setBody({ id, layer: 'spacecraft', label: entry.name, size: 3, colour: Sp.PALETTE.spacecraft });
    }
  }

  /* ---------------------------- the tooltip --------------------------- */

  /**
   * What hovering something says: what it is, how far, how fast.
   *
   * Both speeds are given because they answer different questions — how fast it
   * is going round the Sun, and whether it is coming towards us. For anything
   * near Earth the second is the one that matters.
   */
  function showTooltip(id, at) {
    if (!tooltip) return;
    if (!id || !state.positions[id] && id !== 'sun') { tooltip.hidden = true; return; }
    const earth = state.positions.earth;
    const here = id === 'sun' ? { x: 0, y: 0, z: 0 } : state.positions[id];
    const fromEarth = O.separation(here, earth);
    const fromSun = O.separation(here, { x: 0, y: 0, z: 0 });
    const orbital = speedKmS(positionGetter(id), state.date);
    const rate = rangeRateFor(id);

    tooltip.innerHTML = `<b>${X.esc(nameOf(id))}</b>`
      + `<div>${X.esc(id === 'earth' ? 'you are here' : `${O.describeDistance(fromEarth.km)} from Earth`)}</div>`
      + `<div class="smx-hint">${X.esc(id === 'sun' ? '' : `${O.describeDistance(fromSun.km)} from the Sun`)}</div>`
      + (orbital ? `<div class="smx-hint">moving ${orbital.toFixed(1)} km/s</div>` : '')
      + (rate ? `<div class="smx-hint">${rate.closing ? 'closing on' : 'moving away from'} Earth`
        + ` at ${Math.abs(rate.kmPerSecond).toFixed(2)} km/s</div>` : '')
      + (id !== 'earth' && id !== 'sun'
        ? `<div class="smx-hint">light takes ${X.esc(O.describeLightTime(fromEarth.lightSeconds))}</div>` : '');
    tooltip.hidden = false;
    // Kept inside the canvas: a tooltip clipped at the edge is worse than one
    // that jumps to the other side of the pointer.
    const w = tooltip.offsetWidth, h = tooltip.offsetHeight;
    const box = overlay.getBoundingClientRect();
    tooltip.style.left = `${Math.min(at.x + 16, box.width - w - 8)}px`;
    tooltip.style.top = `${Math.min(Math.max(8, at.y - h / 2), box.height - h - 8)}px`;
  }

  /** A function that gives a body's position at any moment — whatever kind it is. */
  function positionGetter(id) {
    if (id === 'sun') return () => ({ x: 0, y: 0, z: 0 });
    if (O.PLANETS[id]) return (t) => O.planetPosition(id, t);
    if (id === 'moon') {
      return (t) => {
        const earth = O.planetPosition('earth', t);
        const moon = O.moonGeocentric(t);
        return { x: earth.x + moon.position.x, y: earth.y + moon.position.y, z: earth.z + moon.position.z };
      };
    }
    const tracked = state.tracked.get(id);
    if (tracked && tracked.kind === 'body') return (t) => O.smallBodyAt(tracked.elements, t).position;
    const belt = elementsFor(id);
    if (belt) return (t) => O.smallBodyAt(belt, t).position;
    // A spacecraft is one fetched vector, so it has no speed to measure.
    return null;
  }

  function rangeRateFor(id) {
    if (!id || id === 'earth') return null;
    const getter = positionGetter(id);
    if (!getter) return null;
    return O.rangeRate(getter, (t) => O.planetPosition('earth', t), state.date);
  }

  function nameOf(id) {
    if (id === 'sun') return 'The Sun';
    if (id === 'moon') return 'The Moon';
    if (O.PLANETS[id]) return O.PLANETS[id].name;
    const tracked = state.tracked.get(id);
    if (tracked) return tracked.name;
    if (String(id).startsWith('belt:')) return String(id).slice(5);
    return id;
  }

  /* ------------------------------ the clock --------------------------- */

  function loop(now) {
    state.raf = requestAnimationFrame(loop);
    if (!overlay || overlay.style.display === 'none' || !state.playing) { state.lastFrame = now; return; }
    const elapsed = state.lastFrame ? (now - state.lastFrame) / 1000 : 0;
    state.lastFrame = now;
    state.date = new Date(+state.date + elapsed * state.speed * 86400000);
    tick();
  }

  /**
   * One set of positions for this instant, handed to the view.
   *
   * Everything visible is placed from the same `state.date`, which is what stops
   * a tracked asteroid being drawn at a different moment than the planet it is
   * passing.
   */
  function tick(rebuild) {
    if (!state.view) return;
    const positions = {};
    for (const key of O.PLANET_ORDER) positions[key] = O.planetPosition(key, state.date);

    // The Moon is computed geocentrically and drawn heliocentrically, so it is
    // the one body that has to be added to Earth before it goes in.
    const moon = O.moonGeocentric(state.date);
    positions.moon = {
      x: positions.earth.x + moon.position.x,
      y: positions.earth.y + moon.position.y,
      z: positions.earth.z + moon.position.z,
    };
    state.moon = moon;

    for (const [id, entry] of state.tracked) {
      if (entry.kind === 'body') positions[id] = O.smallBodyAt(entry.elements, state.date).position;
      else if (entry.vector) positions[id] = entry.vector;
    }

    // The whole population, moved to this instant. One Kepler solve each, which
    // is what makes thousands of them affordable every frame.
    for (const el of state.belt.asteroids) {
      positions[`belt:${el.name}`] = O.smallBodyAt(el, state.date).position;
    }

    state.positions = positions;
    state.view.setPositions(positions);
    if (rebuild) buildBodies();
    watchForEvents();
    drawTitle();
    drawClock();
  }

  /**
   * The full readout for whatever is selected: what its orbit is shaped like,
   * how it is tilted, how fast it is going, and how far away it is from both
   * the Sun and us.
   *
   * The tilt is given in degrees and again in distance, because "10.8°" means
   * little on its own and "up to 0.33 AU out of the ecliptic" means something.
   */
  function drawGeometry() {
    const box = overlay && overlay.querySelector('#smxGeometry');
    if (!box) return;
    const id = state.selected;
    if (!id) { box.innerHTML = ''; box.hidden = true; return; }
    box.hidden = false;

    const elements = elementsFor(id);
    const here = id === 'sun' ? { x: 0, y: 0, z: 0 } : state.positions[id];
    const rows = [];

    if (here && state.positions.earth) {
      const fromSun = O.separation(here, { x: 0, y: 0, z: 0 });
      const fromEarth = O.separation(here, state.positions.earth);
      const speed = speedKmS(positionGetter(id), state.date);
      const rate = rangeRateFor(id);
      rows.push(['from the Sun', id === 'sun' ? '—' : O.describeDistance(fromSun.km)]);
      rows.push(['from Earth', id === 'earth' ? '—' : O.describeDistance(fromEarth.km)]);
      rows.push(['speed', speed ? `${speed.toFixed(1)} km/s around the Sun` : null]);
      rows.push(['towards us', rate
        ? `${rate.closing ? 'closing' : 'opening'} at ${Math.abs(rate.kmPerSecond).toFixed(2)} km/s` : null]);
      rows.push(['light time', id === 'earth' || id === 'sun' ? null : O.describeLightTime(fromEarth.lightSeconds)]);
    }

    if (elements) {
      const g = O.orbitGeometry(elements);
      rows.push(['orbit', `${g.shape} — ${g.perihelionAu.toFixed(3)} AU at its closest to the Sun,`
        + ` ${g.aphelionAu.toFixed(3)} AU at its furthest`]);
      rows.push(['tilt', `${g.tiltDegrees.toFixed(2)}° to the ecliptic`
        + ` — up to ${g.highestAu.toFixed(3)} AU above or below it`]);
      rows.push(['eccentricity', g.eccentricity.toFixed(4)]);
      rows.push(['year', g.periodDays > 700
        ? `${(g.periodDays / 365.25).toFixed(2)} Earth years` : `${Math.round(g.periodDays)} days`]);
      if (elements.meanMotion) {
        rows.push(['next perihelion', O.nextPerihelion(elements, state.date).toISOString().slice(0, 10)]);
      }
      if (elements.diameterKm) {
        rows.push(['size', `${elements.diameterKm < 1
          ? `${Math.round(elements.diameterKm * 1000)} m` : `${elements.diameterKm.toFixed(1)} km`} across`
          + ` (${elements.diameterMeasured ? 'measured' : 'estimated from brightness'})`]);
      }
      if (elements.rotationHours) rows.push(['spin', `one turn every ${elements.rotationHours.toFixed(1)} hours`]);
      if (elements.orbitClass) rows.push(['class', String(elements.orbitClass) + (elements.pha ? ' · potentially hazardous' : '')]);
    } else if (O.PLANETS[id]) {
      const g = O.orbitGeometry(O.planetElements(id, state.date));
      rows.push(['orbit', `${g.perihelionAu.toFixed(3)}–${g.aphelionAu.toFixed(3)} AU from the Sun`]);
      rows.push(['tilt', `${g.tiltDegrees.toFixed(2)}° to the ecliptic`]);
      rows.push(['year', `${(g.periodDays / 365.25).toFixed(2)} Earth years`]);
      rows.push(['size', `${(O.PLANETS[id].radiusKm * 2).toLocaleString()} km across`]);
      rows.push(['day', `${Math.abs(O.PLANETS[id].dayHours).toFixed(1)} hours`
        + `${O.PLANETS[id].dayHours < 0 ? ', turning backwards' : ''}`]);
    } else if (id === 'moon' && state.moon) {
      rows.push(['phase', `${state.moon.phase.name}, ${Math.round(state.moon.phase.illuminated * 100)}% lit`]);
      rows.push(['size', '3,475 km across']);
    }

    // Not X.kv: its two fixed columns truncate a sentence like "22.14° to the
    // ecliptic — up to 0.949 AU above or below it", and that sentence is the
    // whole point of showing a tilt. A label and a value that wraps instead.
    box.innerHTML = rows.filter((r) => r[1] !== null && r[1] !== undefined)
      .map((r) => `<div class="smx-geo-row"><span>${X.esc(r[0])}</span><b>${X.esc(r[1])}</b></div>`)
      .join('');
  }

  /** The elements behind an id, whether it was followed or came with the population. */
  function elementsFor(id) {
    const tracked = state.tracked.get(id);
    if (tracked && tracked.elements) return tracked.elements;
    if (String(id).startsWith('belt:')) {
      const name = String(id).slice(5);
      return state.belt.asteroids.find((a) => a.name === name) || null;
    }
    return null;
  }

  function drawTitle() {
    if (!overlay) return;
    const id = state.selected;
    overlay.querySelector('#smxSpaceTitle').textContent = id ? nameOf(id) : 'Solar system';
    drawGeometry();
    overlay.querySelector('#smxSpaceSub').textContent =
      `${state.frame === 'geocentric' ? 'Earth at the centre' : 'Sun at the centre'} · `
      + `${state.scaleMode === 'true' ? 'true distances' : 'distances compressed to fit'} · `
      + 'bodies drawn as fixed-size pixels, not to scale';
    const clock = overlay.querySelector('#smxSpaceClock2');
    if (clock) clock.textContent = fmtDate(state.date) + (state.playing ? ` · ${state.speed} d/s` : '');
  }

  function drawEvents() {
    if (!eventBox) return;
    const count = overlay && overlay.querySelector('#smxEventCount');
    if (count) count.textContent = state.events.length ? `${state.events.length}` : '';
    if (!state.events.length) {
      eventBox.innerHTML = '<div class="smx-hint">Nothing yet. Press play, or load a list — '
        + 'closest approaches, full moons and listed passes are announced as the clock reaches them.</div>';
      return;
    }
    eventBox.innerHTML = state.events.slice(0, 24).map((e) =>
      `<div class="smx-space-event smx-ev-${X.esc(e.kind)}">`
      + `<span class="smx-hint">${X.esc(fmtDate(e.when).slice(0, 10))}</span> ${X.esc(e.text)}</div>`).join('');
  }

  /* ============================ tracked bodies ======================== */

  function track(id, entry) {
    state.tracked.set(id, entry);
    addTracked(id, entry);
    tick();
    state.selected = id;
    drawTitle();
    drawTracked();
    logEvent('follow', `Now following ${entry.name}`);
  }

  function untrack(id) {
    state.tracked.delete(id);
    if (state.view) state.view.removeBody(id);
    if (state.selected === id) state.selected = null;
    tick();
    drawTracked();
  }

  /* ============================== the panel =========================== */

  const fmtDate = (d) => d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

  function drawClock() {
    const out = root && root.querySelector('#smxSpaceClock');
    if (out) out.textContent = fmtDate(state.date);
  }

  /**
   * One switch, wherever it was flicked.
   *
   * The population layer is the only one that has to fetch anything, so ticking
   * it loads once and every tick after that just shows or hides what is already
   * in the view.
   */
  function toggleLayer(id, on, source) {
    const layer = LAYERS.find((l) => l.id === id);
    if (layer) layer.on = on;
    if (state.view) state.view.setVisible(id, on);
    for (const box of document.querySelectorAll(`[data-layer="${id}"]`)) {
      if (box !== source) box.checked = on;
    }
    if (root) {
      for (const box of root.querySelectorAll(`[data-layer="${id}"]`)) if (box !== source) box.checked = on;
    }
    if (overlay) {
      for (const box of overlay.querySelectorAll(`[data-layer="${id}"]`)) if (box !== source) box.checked = on;
    }
    if (id === 'belt' && on && !state.belt.loaded && !state.belt.loading) {
      openView();
      loadBelt();
    }
  }

  /** Drop what is loaded and fetch the population again, for a new size or group. */
  function reloadBelt() {
    if (state.view) {
      for (const el of state.belt.asteroids) state.view.removeBody(`belt:${el.name}`);
    }
    state.belt.asteroids = [];
    state.belt.loaded = false;
    loadBelt();
  }

  /** The listed passes still ahead of the clock, as forecast entries. */
  function upcomingApproaches(from) {
    return state.lists.close
      .filter((row) => row.when && +row.when >= +from)
      .map((row) => ({
        kind: 'approach', when: row.when,
        text: `${row.designation} passes Earth at ${row.lunarDistances.toFixed(1)} lunar distances`
          + `${row.kmPerSecond ? `, ${row.kmPerSecond.toFixed(1)} km/s` : ''}`,
      }));
  }

  function drawUpcoming() {
    const box = root && root.querySelector('#smxUpcoming');
    if (!box) return;
    if (!state.upcoming.length) { box.innerHTML = '<div class="smx-hint">Nothing found.</div>'; return; }
    box.innerHTML = `<div class="smx-hint">${state.upcoming.length} events in the next year, `
      + 'each one worked out by running the model forward rather than looked up.</div>'
      + state.upcoming.slice(0, 40).map((e) => `<div class="smx-space-event smx-ev-${X.esc(e.kind)}">`
        + `<span class="smx-hint">${X.esc(e.when.toISOString().slice(0, 10))}</span> ${X.esc(e.text)}`
        + `${e.body ? ` <button class="smx-btn" data-goto="${X.esc(e.body)}" data-at="${+e.when}">Go</button>` : ''}`
        + '</div>').join('');
  }

  function drawTracked() {
    const box = root && root.querySelector('#smxTracked');
    if (!box) return;
    if (!state.tracked.size) {
      box.innerHTML = '<div class="smx-hint">Nothing followed yet. Search for an object, or pick one from a list.</div>';
      return;
    }
    box.innerHTML = [...state.tracked.entries()].map(([id, entry]) => {
      const p = state.positions[id];
      const away = p && state.positions.earth ? O.describeDistance(O.separation(p, state.positions.earth).km) : '—';
      return `<div class="smx-card">
        <div class="smx-row" style="justify-content:space-between">
          <b>${X.esc(entry.name)}</b>
          <button class="smx-x" data-untrack="${X.esc(id)}" title="Stop following">✕</button>
        </div>
        <div class="smx-hint">${X.esc(away)} from Earth${entry.kind === 'spacecraft' ? ' · spacecraft' : ''}</div>
      </div>`;
    }).join('');
  }

  /** One row rendering for every source, so the lists read the same everywhere. */
  function rowsHtml(rows, kind) {
    if (!rows.length) return '<div class="smx-hint">Nothing to show.</div>';
    return rows.slice(0, 40).map((r) => {
      const size = r.diameterKm
        ? `about ${r.diameterKm < 1 ? `${Math.round(r.diameterKm * 1000)} m` : `${r.diameterKm.toFixed(1)} km`} across`
        : r.diameterMinKm ? `${Math.round(r.diameterMinKm * 1000)}–${Math.round(r.diameterMaxKm * 1000)} m across` : '';
      const detail = kind === 'sentry'
        ? `1 in ${r.oneIn ? r.oneIn.toLocaleString() : '—'} · Torino ${r.torino} · ${X.esc(r.yearRange)}`
        : `${r.lunarDistances.toFixed(1)} lunar distances · ${Math.round(r.km).toLocaleString()} km`
          + (Number.isFinite(r.kmPerSecond) ? ` · ${r.kmPerSecond.toFixed(1)} km/s` : '');
      const when = r.when ? fmtDate(r.when) : (r.whenText || '');
      return `<div class="smx-card">
        <div class="smx-row" style="justify-content:space-between">
          <b>${X.esc(r.designation)}</b>
          <button class="smx-btn" data-follow="${X.esc(r.designation)}" data-layer-for="${kind === 'sentry' ? 'asteroids' : 'approaches'}">Show</button>
        </div>
        <div class="smx-hint">${X.esc(when)}</div>
        <div class="smx-hint">${detail}${size ? ` · ${size}` : ''}${r.hazardous ? ' · flagged hazardous' : ''}</div>
      </div>`;
    }).join('');
  }

  async function loadInto(id, label, run, render) {
    const box = root.querySelector(id);
    box.innerHTML = `<div class="smx-hint">Asking ${X.esc(label)}…</div>`;
    try {
      box.innerHTML = render(await run());
    } catch (e) {
      const message = (e && e.message) || String(e);
      box.innerHTML = `<div class="smx-hint">${X.esc(label)} did not answer: ${X.esc(message)}`
        + `${/Failed to fetch/.test(message) ? ' — JPL sends no CORS header, so this list needs the desktop app.' : ''}</div>`;
    }
  }

  X.registerTab({
    id: 'space',
    label: 'Space',
    icon: 'satellite',
    title: 'The solar system: planets, asteroids, close approaches, impact risk and events',
    build(el) {
      root = el;
      el.innerHTML = `
        <div class="smx-row">
          <button class="smx-btn smx-primary" id="smxOpenSpace">Open the explorer</button>
          <span class="smx-hint" id="smxSpaceClock"></span>
        </div>

        <h4>Show</h4>
        <div id="smxLayerBoxes">${LAYERS.filter((l) => !l.loads).map((l) =>
    `<label class="smx-check"><input type="checkbox" data-layer="${l.id}"${l.on ? ' checked' : ''}> ${X.esc(l.label)}</label>`).join('')}</div>

        <h4>The view</h4>
        <div class="smx-row">
          <button class="smx-btn on" data-frame="heliocentric">Sun-centred</button>
          <button class="smx-btn" data-frame="geocentric">Earth-centred</button>
        </div>
        <div class="smx-row">
          <button class="smx-btn on" data-scale="compressed">Fit on screen</button>
          <button class="smx-btn" data-scale="true">True distances</button>
        </div>
        <div class="smx-hint">Drag to turn the ecliptic, wheel to zoom, hover anything for its
          distance and speed. Positions are real; the dots are a fixed size and are not.</div>

        <h4>Time</h4>
        <div class="smx-row">
          <button class="smx-btn" data-step="-30">−30 d</button>
          <button class="smx-btn" data-step="-1">−1 d</button>
          <button class="smx-btn" id="smxPlay">Play</button>
          <button class="smx-btn" data-step="1">+1 d</button>
          <button class="smx-btn" data-step="30">+30 d</button>
          <button class="smx-btn" id="smxNow">Now</button>
        </div>
        <label class="smx-hint">Speed <b id="smxSpeedLabel">1</b> days per second
          <input type="range" id="smxSpeed" min="0.1" max="120" step="0.1" value="1" style="width:100%"></label>

        <h4>Coming up for Earth <span class="smx-hint">computed here, next 12 months</span></h4>
        <div class="smx-row"><button class="smx-btn" id="smxForecast">Work out what is coming</button></div>
        <div id="smxUpcoming"></div>

        <h4>All near-Earth asteroids</h4>
        <label class="smx-check"><input type="checkbox" data-layer="belt"> Show them all, moving on their orbits</label>
        <div class="smx-row">
          <button class="smx-btn on" data-group="neo">Near-Earth</button>
          <button class="smx-btn" data-group="pha">Hazardous only</button>
        </div>
        <label class="smx-hint">How many: <b id="smxBeltLimitLabel">400</b>, brightest first
          <input type="range" id="smxBeltLimit" min="50" max="3000" step="50" value="400" style="width:100%"></label>
        <div id="smxBeltStatus"></div>

        <h4>Following</h4>
        <div id="smxTracked"></div>

        <h4>Find an object</h4>
        <div class="smx-row">
          <input type="text" id="smxFind" placeholder="433 Eros, Apophis, 1P/Halley…" style="flex:1">
          <button class="smx-btn" id="smxFindGo">Find</button>
        </div>
        <div id="smxFindOut"></div>

        <h4>Close approaches <span class="smx-hint">next 60 days, within 20 lunar distances</span></h4>
        <div class="smx-row"><button class="smx-btn" id="smxLoadCad">Load from JPL</button></div>
        <div id="smxCad"></div>

        <h4>Impact risk <span class="smx-hint">JPL Sentry</span></h4>
        <div class="smx-row"><button class="smx-btn" id="smxLoadSentry">Load the risk list</button></div>
        <div id="smxSentry"></div>

        <h4>Near-Earth today <span class="smx-hint">NASA NeoWs</span></h4>
        <div class="smx-row"><button class="smx-btn" id="smxLoadNeo">Load today's list</button></div>
        <div id="smxNeo"></div>

        <h4>Spacecraft</h4>
        <div class="smx-row"><button class="smx-btn" id="smxLoadCraft">Load positions from Horizons</button></div>
        <div id="smxCraft"></div>

        <div class="smx-hint" style="margin-top:8px">
          Planets and the Moon are computed here and need no network. Asteroid data is JPL's,
          the daily near-Earth list is NASA's. Positions are good to a few thousand kilometres
          for the inner planets and about a tenth of a percent for the outer ones.
        </div>`;

      drawClock();
      drawTracked();

      el.querySelector('#smxOpenSpace').addEventListener('click', openView);
      el.querySelector('#smxNow').addEventListener('click', () => { state.date = new Date(); tick(true); drawClock(); });
      el.querySelector('#smxPlay').addEventListener('click', (e) => {
        state.playing = !state.playing;
        state.lastFrame = 0;
        e.target.textContent = state.playing ? 'Pause' : 'Play';
        e.target.classList.toggle('on', state.playing);
        if (state.playing) openView();
      });

      X.on(el, '[data-step]', 'click', (_e, btn) => {
        state.date = new Date(+state.date + Number(btn.dataset.step) * 86400000);
        tick(true); drawClock(); drawTracked();
      });
      X.on(el, '[data-frame]', 'click', (_e, btn) => {
        state.frame = btn.dataset.frame;
        el.querySelectorAll('[data-frame]').forEach((b) => b.classList.toggle('on', b === btn));
        if (state.view) state.view.setFrame(state.frame);
        drawTitle();
      });
      X.on(el, '[data-scale]', 'click', (_e, btn) => {
        state.scaleMode = btn.dataset.scale;
        el.querySelectorAll('[data-scale]').forEach((b) => b.classList.toggle('on', b === btn));
        if (state.view) state.view.setScaleMode(state.scaleMode);
        drawTitle();
      });
      X.on(el, '[data-untrack]', 'click', (_e, btn) => untrack(btn.dataset.untrack));
      // The panel's checkboxes and the ones on the view are the same switches.
      X.on(el, '[data-layer]', 'change', (_e, box) => toggleLayer(box.dataset.layer, box.checked, box));

      X.on(el, '[data-group]', 'click', (_e, btn) => {
        state.belt.group = btn.dataset.group;
        el.querySelectorAll('[data-group]').forEach((b) => b.classList.toggle('on', b === btn));
        if (state.belt.loaded) reloadBelt();
      });
      el.querySelector('#smxBeltLimit').addEventListener('change', (e) => {
        state.belt.limit = Number(e.target.value);
        if (state.belt.loaded) reloadBelt();
      });
      el.querySelector('#smxBeltLimit').addEventListener('input', (e) => {
        el.querySelector('#smxBeltLimitLabel').textContent = e.target.value;
      });
      drawBeltStatus();

      el.querySelector('#smxForecast').addEventListener('click', () => {
        const box = el.querySelector('#smxUpcoming');
        box.innerHTML = '<div class="smx-hint">Running the solar system forward a year…</div>';
        // Next frame, so the message paints before the maths blocks.
        requestAnimationFrame(() => {
          const from = new Date(state.date);
          state.upcoming = O.forecast(from, 365).concat(upcomingApproaches(from));
          state.upcoming.sort((a, b) => a.when - b.when);
          drawUpcoming();
        });
      });

      el.querySelector('#smxSpeed').addEventListener('input', (e) => {
        state.speed = Number(e.target.value);
        el.querySelector('#smxSpeedLabel').textContent = state.speed;
        drawTitle();
      });

      const findGo = async () => {
        const query = el.querySelector('#smxFind').value.trim();
        if (!query) return;
        await loadInto('#smxFindOut', 'JPL', () => fetchSmallBody(query), (elements) => {
          state.pendingFind = { id: `sbdb:${elements.designation || elements.name}`, elements };
          const size = elements.diameterKm;
          return `<div class="smx-card"><b>${X.esc(elements.name)}</b>${X.kv([
    ['orbit', `${elements.a.toFixed(3)} AU, e = ${elements.e.toFixed(3)}, tilted ${elements.i.toFixed(1)}°`],
    ['year', `${(elements.periodDays / 365.25).toFixed(2)} Earth years`],
    ['size', size
      ? `${elements.diameterMeasured ? '' : 'about '}${size < 1 ? `${Math.round(size * 1000)} m` : `${size.toFixed(1)} km`} across`
        + `${elements.diameterMeasured ? ' (measured)' : ' (estimated from brightness)'}`
      : 'not known'],
    ['spin', elements.rotationHours ? `one turn every ${elements.rotationHours.toFixed(1)} hours` : null],
    ['surface', elements.albedo
      ? `reflects ${Math.round(elements.albedo * 100)}% of the light${elements.spectralType ? `, type ${elements.spectralType}` : ''}`
      : (elements.spectralType ? `type ${elements.spectralType}` : null)],
    ['class', `${elements.neo ? 'near-Earth' : 'not near-Earth'}${elements.pha ? ' · potentially hazardous' : ''}`],
  ])}<button class="smx-btn smx-primary" data-follow-found="1">Follow this one</button></div>`;
        });
      };
      el.querySelector('#smxFindGo').addEventListener('click', findGo);
      el.querySelector('#smxFind').addEventListener('keydown', (e) => { if (e.key === 'Enter') findGo(); });

      X.on(el, '[data-follow-found]', 'click', () => {
        const found = state.pendingFind;
        if (!found) return;
        openView();
        track(found.id, { kind: 'body', name: found.elements.name, elements: found.elements, layer: 'asteroids' });
      });

      // Every list uses the same designation → SBDB → follow path, so one handler
      // covers close approaches, the risk list and the daily feed alike.
      X.on(el, '[data-follow]', 'click', async (_e, btn) => {
        const designation = btn.dataset.follow;
        btn.disabled = true; btn.textContent = 'Finding…';
        try {
          const elements = await fetchSmallBody(designation);
          openView();
          track(`sbdb:${designation}`, {
            kind: 'body', name: elements.name, elements, layer: btn.dataset.layerFor || 'asteroids',
          });
          btn.textContent = 'Showing';
        } catch (e) {
          btn.disabled = false;
          btn.textContent = 'Show';
          X.notify(`Could not load ${designation}: ${(e && e.message) || e}`, 'warn', 5000);
        }
      });

      el.querySelector('#smxLoadCad').addEventListener('click', () => loadInto('#smxCad', 'JPL',
        () => fetchCloseApproaches(60, 20), (rows) => {
          state.lists.close = rows;
          logEvent('data', `${rows.length} close approaches loaded from JPL`);
          return `<div class="smx-hint">${rows.length} passes.</div>` + rowsHtml(rows, 'cad');
        }));

      el.querySelector('#smxLoadSentry').addEventListener('click', () => loadInto('#smxSentry', 'JPL Sentry',
        () => fetchSentry(), (rows) => {
          state.lists.sentry = rows;
          const worst = rows[0];
          logEvent('data', `${rows.length} objects on the Sentry risk list`);
          return `<div class="smx-hint">${rows.length} objects with any chance at all. The highest is `
            + `${X.esc(worst ? worst.designation : '—')}, at 1 in `
            + `${worst && worst.oneIn ? worst.oneIn.toLocaleString() : '—'}.</div>` + rowsHtml(rows, 'sentry');
        }));

      el.querySelector('#smxLoadNeo').addEventListener('click', () => loadInto('#smxNeo', 'NASA',
        () => fetchNeoFeed(), (rows) => {
          state.lists.neo = rows;
          logEvent('data', `${rows.length} near-Earth objects passing today`);
          return `<div class="smx-hint">${rows.length} passing today.</div>` + rowsHtml(rows, 'neo');
        }));

      el.querySelector('#smxLoadCraft').addEventListener('click', () => loadInto('#smxCraft', 'Horizons',
        async () => {
          const out = [];
          for (const craft of SPACECRAFT) {
            try {
              out.push(Object.assign({}, craft, { vector: await fetchSpacecraft(craft.command, state.date) }));
            } catch (e) {
              out.push(Object.assign({}, craft, { error: (e && e.message) || String(e) }));
            }
          }
          return out;
        },
        (craft) => {
          state.lists.spacecraft = craft;
          return craft.map((c) => {
            if (c.error) return `<div class="smx-card"><b>${X.esc(c.name)}</b><div class="smx-hint">${X.esc(c.error)}</div></div>`;
            const sun = O.separation(c.vector, { x: 0, y: 0, z: 0 });
            return `<div class="smx-card">
              <div class="smx-row" style="justify-content:space-between">
                <b>${X.esc(c.name)}</b>
                <button class="smx-btn" data-craft="${X.esc(c.id)}">Show</button>
              </div>
              <div class="smx-hint">${X.esc(O.describeDistance(sun.km))} from the Sun ·
                ${X.esc(O.describeLightTime(sun.lightSeconds))} out</div></div>`;
          }).join('');
        }));

      // Jump the clock to a forecast event and look at what it is about.
      X.on(el, '[data-goto]', 'click', (_e, btn) => {
        openView();
        state.date = new Date(Number(btn.dataset.at));
        state.selected = btn.dataset.goto;
        tick(true);
        drawClock();
        if (state.view) state.view.select(state.selected);
      });

      X.on(el, '[data-craft]', 'click', (_e, btn) => {
        const craft = state.lists.spacecraft.find((c) => c.id === btn.dataset.craft);
        if (!craft || !craft.vector) return;
        openView();
        track(craft.id, { kind: 'spacecraft', name: craft.name, vector: craft.vector });
      });
    },
  });

  // Exposed for the tests and for driving the tab from the console.
  window.SMXCosmos = {
    state, LAYERS, SPACECRAFT,
    parseCloseApproaches, parseSentry, parseNeoFeed, parseHorizonsVector, parseJplDate,
    fetchCloseApproaches, fetchSentry, fetchSmallBody, fetchNeoFeed, fetchSpacecraft, fetchAsteroids,
    speedKmS, watchForEvents, logEvent, openView, track, untrack, tick, positionGetter,
    loadBelt, reloadBelt, toggleLayer, elementsFor, upcomingApproaches,
  };
})();
