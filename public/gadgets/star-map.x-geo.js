/* ==========================================================================
   star-map.x-geo.js — terrain, geology and sky tabs.

   Everything here is free, key-less and attributed:
     · elevation & weather   Open-Meteo         (api.open-meteo.com)
     · air quality           Open-Meteo         (air-quality-api.open-meteo.com)
     · geological map        Macrostrat         (macrostrat.org, tiles.macrostrat.org)
     · earthquakes           USGS               (earthquake.usgs.gov)
     · hillshade / topo      Esri, USGS         (raster tiles)

   Sun, moon, slope, aspect and coordinate conversions are computed locally in
   star-map.x-math.js — no network, so they work with the tile cache offline.
   ========================================================================== */
'use strict';

(function () {
  const X = window.SMX, Mx = X.Mx;

  const ELEV_API = 'https://api.open-meteo.com/v1/elevation';
  const WX_API = 'https://api.open-meteo.com/v1/forecast';
  const AQ_API = 'https://air-quality-api.open-meteo.com/v1/air-quality';
  const MACRO_API = 'https://macrostrat.org/api/v2/geologic_units/map';
  const QUAKE_API = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary';

  // Gradient is a severity reading, so it uses the shared severity ramp — the
  // same scale the congestion bands use, and never an identity hue.
  const GRADE_COLORS = X.SEVERITY;
  const GRADE_LABELS = ['< 3%', '3–6%', '6–10%', '10–15%', '> 15%'];
  const gradeBand = (g) => {
    const a = Math.abs(g);
    return a < 3 ? 0 : a < 6 ? 1 : a < 10 ? 2 : a < 15 ? 3 : 4;
  };

  const WMO = {
    0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog',
    51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
    61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
    71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
    80: 'Light showers', 81: 'Showers', 82: 'Violent showers', 85: 'Snow showers', 86: 'Snow showers',
    95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Severe thunderstorm with hail',
  };

  /* ------------------------- shared point selection ------------------------- */

  const state = {
    point: null,                    // {lat,lng} — the "current point" for probes
    pointMarker: null,
    profile: null,                  // {samples, stats, source}
    profileCursor: null,
    gradeLayer: null,
    layers: {},                     // toggleable raster overlays
    quakes: { layer: null, feed: '2.5_week', minMag: 2.5, count: 0, loading: false },
  };

  function setPoint(latlng, opts) {
    state.point = { lat: latlng.lat, lng: latlng.lng };
    if (!state.pointMarker) {
      // Annotation family: this is the point *you* picked, not a measurement.
      state.pointMarker = L.circleMarker([latlng.lat, latlng.lng], {
        pane: 'smx-agent', radius: 7, color: X.ANNOTATION, weight: 2,
        fillColor: X.ANNOTATION, fillOpacity: 0.45,
      }).addTo(map);
    } else {
      state.pointMarker.setLatLng([latlng.lat, latlng.lng]);
    }
    if (!opts || opts.probe !== false) probePoint();
    renderCoords();
  }

  // Alt-clicking the map picks the point every tab reads from: terrain probe,
  // coordinates, sun/moon and weather. If the geology tab is the one on screen,
  // the rock unit is fetched too, since that is what you were looking at.
  // (Plain double-click belongs to the drag/mark switch — see star-map.x-core.js.)
  X.onPick((latlng) => {
    setPoint(latlng);
    if (geoRoot && geoRoot.style.display !== 'none') queryGeology(latlng);
    X.notify('Point picked.', 'ok', 1400);
  });

  /** The path the terrain/weather tabs work on, in priority order. */
  function sourcePath() {
    const simRoute = X.sim && X.sim.activeRoute && X.sim.activeRoute();
    if (simRoute) return { name: `Sim · ${simRoute.name}`, points: simRoute.points };
    const sel = S.routes && S.routes[S.selectedRoute];
    if (sel && sel.layer) {
      const pts = sel.layer.getLatLngs().map((p) => ({ lat: p.lat, lng: p.lng }));
      if (pts.length > 1) return { name: 'Selected route', points: pts };
    }
    const wp = X.waypoints();
    if (wp.length > 1) return { name: 'Waypoint line (straight)', points: wp };
    return null;
  }

  /* ------------------------------ elevation ------------------------------ */

  /** Open-Meteo takes up to 100 coordinates per call; batch and stitch. */
  async function elevations(points) {
    const out = [];
    for (let i = 0; i < points.length; i += 100) {
      const batch = points.slice(i, i + 100);
      const url = `${ELEV_API}?latitude=${batch.map((p) => p.lat.toFixed(5)).join(',')}` +
                  `&longitude=${batch.map((p) => p.lng.toFixed(5)).join(',')}`;
      const data = await X.json(url, { timeout: 15000 });
      const arr = data && data.elevation;
      if (!Array.isArray(arr)) throw new Error('elevation service returned no data');
      out.push(...arr);
      if (points.length > 100) await new Promise((r) => setTimeout(r, 120));
    }
    return out;
  }

  async function loadProfile() {
    const src = sourcePath();
    if (!src) { X.notify('Nothing to profile — add waypoints or route first.', 'warn'); return; }
    const host = terrainRoot.querySelector('#smxProfile');
    host.innerHTML = X.spinner('Sampling elevation…');
    try {
      const cum = Mx.cumulative(src.points);
      const wanted = Number(terrainRoot.querySelector('#smxSamples').value) || 120;
      const samples = Mx.resample(src.points, cum, wanted);
      const ele = await elevations(samples);
      samples.forEach((s, i) => { s.ele = Number.isFinite(ele[i]) ? ele[i] : null; });
      state.profile = { samples, stats: Mx.elevationStats(samples), source: src.name };
      renderProfile();
      if (terrainRoot.querySelector('#smxGradeOn').checked) drawGradeLine();
    } catch (err) {
      host.innerHTML = `<div class="smx-hint smx-warn">Elevation lookup failed: ${X.esc(err.message)}</div>`;
    }
  }

  function renderProfile() {
    const host = terrainRoot.querySelector('#smxProfile');
    if (!state.profile) { host.innerHTML = '<div class="smx-hint">No profile loaded.</div>'; return; }
    const { samples, stats, source } = state.profile;
    const valid = samples.filter((s) => Number.isFinite(s.ele));
    if (valid.length < 2) { host.innerHTML = '<div class="smx-hint smx-warn">No elevation data for this path.</div>'; return; }

    const W = 300, H = 110, pad = { l: 2, r: 2, t: 8, b: 14 };
    const total = samples[samples.length - 1].dist || 1;
    const lo = stats.min, hi = stats.max, span = Math.max(1, hi - lo);
    const px = (d) => pad.l + (d / total) * (W - pad.l - pad.r);
    const py = (e) => pad.t + (1 - (e - lo) / span) * (H - pad.t - pad.b);
    const line = valid.map((s, i) => `${i ? 'L' : 'M'}${px(s.dist).toFixed(1)},${py(s.ele).toFixed(1)}`).join('');
    const area = `${line}L${px(valid[valid.length - 1].dist).toFixed(1)},${H - pad.b}L${px(valid[0].dist).toFixed(1)},${H - pad.b}Z`;

    host.innerHTML = `
      <svg class="smx-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" id="smxChart" role="img"
           aria-label="Elevation profile">
        <line class="grid" x1="0" y1="${H - pad.b}" x2="${W}" y2="${H - pad.b}"></line>
        <line class="grid" x1="0" y1="${pad.t}" x2="${W}" y2="${pad.t}"></line>
        <path class="fill" d="${area}"></path>
        <path class="line" d="${line}"></path>
        <line class="cursor" id="smxChartCursor" x1="-9" y1="${pad.t}" x2="-9" y2="${H - pad.b}"></line>
      </svg>
      <div class="smx-row" style="justify-content:space-between;margin-top:-4px">
        <small class="smx-hint">${X.esc(source)}</small>
        <small class="smx-hint" id="smxChartRead">${X.ele(lo)} – ${X.ele(hi)}</small>
      </div>
      <div class="smx-stats">
        <div class="smx-stat"><b>${X.ele(stats.gain)}</b><small>Climb</small></div>
        <div class="smx-stat"><b>${X.ele(stats.loss)}</b><small>Descent</small></div>
        <div class="smx-stat"><b>${X.ele(stats.max)}</b><small>High</small></div>
        <div class="smx-stat"><b>${stats.maxGrade.toFixed(1)}%</b><small>Steepest</small></div>
      </div>
      ${stats.steepestAt ? `<div class="smx-hint">Steepest section ${X.dist(stats.steepestAt.dist)} in,
        at ${X.ele(stats.steepestAt.ele)} — <button class="smx-btn" id="smxGoSteep">show</button></div>` : ''}`;

    const svg = host.querySelector('#smxChart');
    const cursor = host.querySelector('#smxChartCursor');
    const read = host.querySelector('#smxChartRead');
    const move = (clientX) => {
      const box = svg.getBoundingClientRect();
      const f = Mx.clamp((clientX - box.left) / box.width, 0, 1);
      const d = f * total;
      const i = Mx.clamp(Math.round(f * (samples.length - 1)), 0, samples.length - 1);
      const s = samples[i];
      cursor.setAttribute('x1', String(px(d)));
      cursor.setAttribute('x2', String(px(d)));
      read.textContent = `${X.dist(s.dist)} · ${Number.isFinite(s.ele) ? X.ele(s.ele) : '—'}`;
      if (!state.profileCursor) {
        state.profileCursor = L.circleMarker([s.lat, s.lng], {
          pane: 'smx-agent', radius: 6, color: X.ANNOTATION, weight: 3, fillOpacity: 0.2,
        }).addTo(map);
      } else {
        state.profileCursor.setLatLng([s.lat, s.lng]);
      }
    };
    svg.addEventListener('pointermove', (e) => move(e.clientX));
    svg.addEventListener('pointerdown', (e) => { move(e.clientX); svg.setPointerCapture(e.pointerId); });
    svg.addEventListener('pointerleave', () => {
      if (state.profileCursor) { state.profileCursor.remove(); state.profileCursor = null; }
    });
    const steep = host.querySelector('#smxGoSteep');
    if (steep) steep.addEventListener('click', () => {
      map.flyTo([stats.steepestAt.lat, stats.steepestAt.lng], Math.max(map.getZoom(), 14));
    });
  }

  /** Re-draw the path coloured by gradient band instead of by route colour. */
  function drawGradeLine() {
    clearGradeLine();
    if (!state.profile) return;
    const s = state.profile.samples;
    const runs = [];
    for (let i = 1; i < s.length; i++) {
      if (!Number.isFinite(s[i].ele) || !Number.isFinite(s[i - 1].ele)) continue;
      const dx = s[i].dist - s[i - 1].dist;
      const grade = dx > 1 ? ((s[i].ele - s[i - 1].ele) / dx) * 100 : 0;
      runs.push({ from: s[i - 1], to: s[i], band: gradeBand(grade), grade });
    }
    state.gradeLayer = L.layerGroup(runs.map((r) => L.polyline(
      [[r.from.lat, r.from.lng], [r.to.lat, r.to.lng]],
      {
        renderer: X.renderers.line, pane: 'smx-line', color: GRADE_COLORS[r.band],
        weight: 6, opacity: 0.95, lineCap: 'butt', interactive: true,
      },
    ).bindTooltip(`${r.grade.toFixed(1)}% · ${X.ele(r.to.ele)}`, { sticky: true }))).addTo(map);
  }

  function clearGradeLine() {
    if (state.gradeLayer) { state.gradeLayer.remove(); state.gradeLayer = null; }
  }

  /** Elevation, slope and aspect at one point, from a 4-neighbour sample. */
  async function probePoint() {
    if (!state.point) return;
    const host = terrainRoot.querySelector('#smxProbe');
    if (!host) return;
    const p = state.point;
    const spacing = Number(terrainRoot.querySelector('#smxProbeSpacing').value) || 90;
    host.innerHTML = X.spinner('Sampling terrain…');
    try {
      const ring = [0, 90, 180, 270].map((b) => Mx.destination(p, b, spacing));
      const ele = await elevations([p, ...ring]);
      const sa = Mx.slopeAspect(ele.slice(1), spacing);
      host.innerHTML = `
        <div class="smx-stats">
          <div class="smx-stat"><b>${Number.isFinite(ele[0]) ? X.ele(ele[0]) : '—'}</b><small>Elevation</small></div>
          <div class="smx-stat"><b>${sa ? `${sa.slope.toFixed(1)}°` : '—'}</b><small>Slope</small></div>
          <div class="smx-stat"><b>${sa ? `${sa.gradePct.toFixed(0)}%` : '—'}</b><small>Grade</small></div>
          <div class="smx-stat"><b>${sa ? Mx.compass(sa.aspect) : '—'}</b><small>Faces</small></div>
        </div>
        <div class="smx-hint">${sa ? `Aspect ${sa.aspect.toFixed(0)}° · sampled ±${spacing} m N/E/S/W` : 'Slope needs four valid neighbour samples.'}</div>`;
    } catch (err) {
      host.innerHTML = `<div class="smx-hint smx-warn">Terrain probe failed: ${X.esc(err.message)}</div>`;
    }
  }

  function renderCoords() {
    const host = terrainRoot && terrainRoot.querySelector('#smxCoords');
    if (!host) return;
    if (!state.point) { host.innerHTML = '<div class="smx-hint">No point picked.</div>'; return; }
    const { lat, lng } = state.point;
    const u = Mx.toUTM(lat, lng);
    host.innerHTML = `
      <div class="smx-mono" style="line-height:1.7">
        ${lat.toFixed(6)}, ${lng.toFixed(6)}<br>
        ${X.esc(Mx.toDMS(lat, 'N', 'S'))} &nbsp; ${X.esc(Mx.toDMS(lng, 'E', 'W'))}<br>
        ${u ? `UTM ${u.zone}${u.band} ${Math.round(u.easting)} E ${Math.round(u.northing)} N` : 'UTM undefined at this latitude'}<br>
        geohash ${Mx.geohash(lat, lng, 9)}
      </div>
      <div class="smx-btns" style="margin-top:6px">
        <button class="smx-btn" id="smxCopyCoord">${X.icon('copy')} Copy</button>
        <button class="smx-btn" id="smxCoordWp">${X.icon('pin')} Waypoint</button>
      </div>`;
    host.querySelector('#smxCopyCoord').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(`${lat.toFixed(6)}, ${lng.toFixed(6)}`);
        X.notify('Coordinates copied.', 'ok', 1600);
      } catch (_) { X.notify('Clipboard blocked here.', 'warn'); }
    });
    host.querySelector('#smxCoordWp').addEventListener('click', () => {
      if (typeof addWaypoint === 'function') addWaypoint(lat, lng, `Point ${Mx.geohash(lat, lng, 5)}`);
    });
  }

  /* ------------------------------ raster layers ------------------------------ */

  const OVERLAYS = {
    geology: {
      label: 'Geological map',
      attribution: '&copy; <a href="https://macrostrat.org">Macrostrat</a>',
      url: 'https://tiles.macrostrat.org/carto/{z}/{x}/{y}.png',
      // maxNativeZoom keeps the layer visible past its deepest tiles by
      // upscaling them, instead of the overlay silently vanishing.
      opts: { maxZoom: 19, maxNativeZoom: 13, opacity: 0.7 },
      note: 'Macrostrat’s compiled bedrock geology. Raster coverage is regional — dense over North America, ' +
            'sparse elsewhere (over India nothing is rendered above zoom 5). "Rock unit at a point" below ' +
            'works worldwide regardless, so use that where the tiles are blank.',
    },
    hillshade: {
      label: 'Hillshade',
      attribution: 'Esri, USGS',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}',
      opts: { maxZoom: 19, maxNativeZoom: 16, opacity: 0.55 },
      note: 'Global relief shading — reads best under a light basemap, and needs no data coverage caveats.',
    },
    usgstopo: {
      label: 'USGS topo',
      attribution: 'USGS The National Map',
      url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}',
      opts: { maxZoom: 19, maxNativeZoom: 16, opacity: 0.85 },
      note: 'US only — contours, benchmarks and land cover.',
    },
  };

  function toggleOverlay(key, on, opacity) {
    const def = OVERLAYS[key];
    if (!def) return;
    if (!on) {
      if (state.layers[key]) { map.removeLayer(state.layers[key]); delete state.layers[key]; }
      return;
    }
    if (!state.layers[key]) {
      // Go through the app's tile factory so these layers are cached offline too.
      const make = typeof mkTileLayer === 'function' ? mkTileLayer : (u, o) => L.tileLayer(u, o);
      state.layers[key] = make(def.url, Object.assign({ attribution: def.attribution }, def.opts));
      state.layers[key].addTo(map);
    }
    if (opacity !== undefined) state.layers[key].setOpacity(opacity);
  }

  /* ------------------------------ geology query ------------------------------ */

  async function queryGeology(latlng) {
    const host = geoRoot.querySelector('#smxUnits');
    host.innerHTML = X.spinner('Asking Macrostrat…');
    try {
      const data = await X.json(`${MACRO_API}?lat=${latlng.lat.toFixed(5)}&lng=${latlng.lng.toFixed(5)}`, { timeout: 15000 });
      const units = (data && data.success && data.success.data) || [];
      if (!units.length) {
        host.innerHTML = '<div class="smx-hint">Macrostrat has no mapped unit at that point.</div>';
        return;
      }
      host.innerHTML = units.slice(0, 4).map((u) => {
        const age = u.b_age !== undefined && u.t_age !== undefined ? `${u.b_age}–${u.t_age} Ma` : (u.age || '');
        return `<div class="smx-card">
          <div><b>${X.esc(u.name || u.strat_name || 'Unnamed unit')}</b></div>
          <div class="smx-hint" style="margin:3px 0">
            ${[u.b_int_name, u.t_int_name].filter(Boolean).join(' → ')} ${age ? `· ${X.esc(age)}` : ''}
          </div>
          ${u.lith ? `<div>${X.esc(String(u.lith).slice(0, 220))}</div>` : ''}
          ${u.environ ? `<div class="smx-hint">Environment: ${X.esc(String(u.environ).slice(0, 160))}</div>` : ''}
          ${u.comments ? `<div class="smx-hint">${X.esc(String(u.comments).slice(0, 240))}</div>` : ''}
          ${u.ref && u.ref.authors ? `<div class="smx-hint">Source: ${X.esc(String(u.ref.authors).slice(0, 90))}
            ${u.ref.ref_year ? `(${X.esc(u.ref.ref_year)})` : ''}</div>` : ''}
        </div>`;
      }).join('');
    } catch (err) {
      host.innerHTML = `<div class="smx-hint smx-warn">Geology lookup failed: ${X.esc(err.message)}</div>`;
    }
  }

  /* ------------------------------ earthquakes ------------------------------ */

  const QUAKE_FEEDS = [
    ['all_day', 'All, past day'],
    ['2.5_week', 'M2.5+, past week'],
    ['4.5_month', 'M4.5+, past month'],
    ['significant_month', 'Significant, past month'],
  ];

  /**
   * Magnitude is a severity reading, so it takes the severity ramp — colour and
   * size together. Depth cannot also be a hue without colliding with the
   * identity family, so a deep focus is drawn as a dashed ring instead.
   */
  const magColor = (m) => X.SEVERITY[m < 3 ? 0 : m < 4 ? 1 : m < 5 ? 2 : m < 6 ? 3 : 4];
  const DEEP_KM = 70;

  async function loadQuakes() {
    if (state.quakes.loading) return;
    state.quakes.loading = true;
    const host = geoRoot.querySelector('#smxQuakeInfo');
    host.innerHTML = X.spinner('Loading USGS feed…');
    try {
      const data = await X.json(`${QUAKE_API}/${state.quakes.feed}.geojson`, { timeout: 25000 });
      if (state.quakes.layer) state.quakes.layer.remove();
      const features = (data.features || []).filter((f) => (f.properties.mag || 0) >= state.quakes.minMag);
      state.quakes.count = features.length;
      state.quakes.layer = L.layerGroup(features.map((f) => {
        const [lng, lat, depth] = f.geometry.coordinates;
        const mag = f.properties.mag || 0;
        return L.circleMarker([lat, lng], {
          radius: Math.max(3, 2.2 * mag),
          color: magColor(mag), weight: depth >= DEEP_KM ? 2 : 1.4,
          dashArray: depth >= DEEP_KM ? '3 3' : null,
          fillColor: magColor(mag), fillOpacity: 0.35,
        }).bindPopup(`<b>M ${mag.toFixed(1)}</b> · ${X.esc(f.properties.place || 'unknown')}<br>
          Depth ${Math.round(depth)} km<br>
          ${new Date(f.properties.time).toLocaleString()}<br>
          ${f.properties.tsunami ? '<b>Tsunami flag set</b><br>' : ''}
          <a href="${X.esc(f.properties.url)}" target="_blank" rel="noreferrer">USGS event page</a>`);
      })).addTo(map);
      host.innerHTML = `<div class="smx-hint">${features.length} events plotted, largest
        M${Math.max(0, ...features.map((f) => f.properties.mag || 0)).toFixed(1)}.</div>
        <div class="smx-legend">
          ${['&lt;3', '3–4', '4–5', '5–6', '6+'].map((label, i) =>
            `<span class="smx-chip"><span class="smx-sw" style="background:${X.SEVERITY[i]}"></span>M ${label}</span>`).join('')}
          <span class="smx-chip"><span class="smx-sw" style="border:2px dashed var(--text-dim);background:none"></span>deep (&gt;${DEEP_KM} km)</span>
        </div>
        <div class="smx-hint">Colour and size both read magnitude on the same severity ramp the congestion and
        gradient bands use; a dashed outline marks a deep focus. Exact depth is in each event's popup.</div>`;
    } catch (err) {
      host.innerHTML = `<div class="smx-hint smx-warn">USGS feed failed: ${X.esc(err.message)}</div>`;
    } finally {
      state.quakes.loading = false;
    }
  }

  function clearQuakes() {
    if (state.quakes.layer) { state.quakes.layer.remove(); state.quakes.layer = null; }
    const host = geoRoot && geoRoot.querySelector('#smxQuakeInfo');
    if (host) host.innerHTML = '';
  }

  /* ------------------------------ weather / sky ------------------------------ */

  async function loadSky() {
    const p = state.point || map.getCenter();
    const host = skyRoot.querySelector('#smxSky');
    const dateStr = skyRoot.querySelector('#smxSkyDate').value;
    const date = dateStr ? new Date(`${dateStr}T12:00:00`) : new Date();

    const sun = Mx.sunTimes(date, p.lat, p.lng);
    const moon = Mx.moonPhase(date);
    const hhmm = (d) => (d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');

    host.innerHTML = `
      <div class="smx-stats">
        <div class="smx-stat"><b>${hhmm(sun.sunrise)}</b><small>Sunrise</small></div>
        <div class="smx-stat"><b>${hhmm(sun.sunset)}</b><small>Sunset</small></div>
        <div class="smx-stat"><b>${sun.dayLength ? Mx.dur(sun.dayLength) : '—'}</b><small>Daylight</small></div>
        <div class="smx-stat"><b>${Math.round(moon.illumination * 100)}%</b><small>Moon</small></div>
      </div>
      <div class="smx-hint">
        ${sun.polar ? `<b>${sun.polar === 'midnight-sun' ? 'Midnight sun' : 'Polar night'}</b> at this latitude on this date. ` : ''}
        Golden hour ends ${hhmm(sun.goldenMorningEnd)}, resumes ${hhmm(sun.goldenEveningStart)}.
        Civil twilight ${hhmm(sun.civilDawn)} – ${hhmm(sun.civilDusk)}.
        Solar noon ${hhmm(sun.solarNoon)}, declination ${sun.declination.toFixed(1)}°.
        Moon is ${X.esc(moon.name.toLowerCase())} (${moon.age.toFixed(1)} days old).
        Times are local to this device, for ${p.lat.toFixed(3)}, ${p.lng.toFixed(3)}.
      </div>`;

    const wxHost = skyRoot.querySelector('#smxWx');
    wxHost.innerHTML = X.spinner('Fetching weather…');
    try {
      const [wx, aq] = await Promise.all([
        X.json(`${WX_API}?latitude=${p.lat.toFixed(4)}&longitude=${p.lng.toFixed(4)}` +
          '&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,' +
          'cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility' +
          '&hourly=temperature_2m,precipitation_probability&forecast_days=2&timezone=auto', { timeout: 15000 }),
        X.json(`${AQ_API}?latitude=${p.lat.toFixed(4)}&longitude=${p.lng.toFixed(4)}&current=pm2_5,pm10,us_aqi`, { timeout: 15000 })
          .catch(() => null),
      ]);
      const c = wx.current || {};
      const aqi = aq && aq.current ? aq.current : null;
      const hourly = wx.hourly || {};
      const nextHours = (hourly.time || []).map((t, i) => ({
        t, temp: hourly.temperature_2m && hourly.temperature_2m[i],
        pop: hourly.precipitation_probability && hourly.precipitation_probability[i],
      })).filter((h) => new Date(h.t) > new Date()).slice(0, 8);

      wxHost.innerHTML = `
        <div class="smx-stats">
          <div class="smx-stat"><b>${Math.round(c.temperature_2m)}°</b><small>Now</small></div>
          <div class="smx-stat"><b>${Math.round(c.apparent_temperature)}°</b><small>Feels</small></div>
          <div class="smx-stat"><b>${Math.round(c.wind_speed_10m)}</b><small>Wind km/h</small></div>
          <div class="smx-stat"><b>${aqi && aqi.us_aqi !== null ? Math.round(aqi.us_aqi) : '—'}</b><small>US AQI</small></div>
        </div>
        <div class="smx-hint">
          ${X.esc(WMO[c.weather_code] || 'Unknown')} · cloud ${Math.round(c.cloud_cover)}% ·
          humidity ${Math.round(c.relative_humidity_2m)}% · gusts ${Math.round(c.wind_gusts_10m)} km/h
          from ${Mx.compass(c.wind_direction_10m)} · ${Math.round(c.pressure_msl)} hPa ·
          visibility ${c.visibility ? X.dist(c.visibility) : '—'}
          ${aqi ? `· PM2.5 ${aqi.pm2_5} µg/m³` : ''}
        </div>
        ${nextHours.length ? `<table class="smx-t"><thead><tr><th>Hour</th>${nextHours.map((h) =>
          `<th>${new Date(h.t).getHours()}</th>`).join('')}</tr></thead><tbody>
          <tr><td>°C</td>${nextHours.map((h) => `<td>${Math.round(h.temp)}</td>`).join('')}</tr>
          <tr><td>rain%</td>${nextHours.map((h) => `<td>${h.pop === null ? '—' : h.pop}</td>`).join('')}</tr>
        </tbody></table>` : ''}
        <div class="smx-hint">Open-Meteo, ${X.esc(wx.timezone || 'local')} time.</div>`;
    } catch (err) {
      wxHost.innerHTML = `<div class="smx-hint smx-warn">Weather lookup failed: ${X.esc(err.message)}</div>`;
    }
  }

  /** Current conditions at a few points along the path — a route weather strip. */
  async function loadRouteWeather() {
    const src = sourcePath();
    const host = skyRoot.querySelector('#smxRouteWx');
    if (!src) { host.innerHTML = '<div class="smx-hint">No route to check.</div>'; return; }
    host.innerHTML = X.spinner('Checking along the route…');
    try {
      const cum = Mx.cumulative(src.points);
      const stops = Mx.resample(src.points, cum, 5);
      const lats = stops.map((s) => s.lat.toFixed(4)).join(',');
      const lngs = stops.map((s) => s.lng.toFixed(4)).join(',');
      const data = await X.json(`${WX_API}?latitude=${lats}&longitude=${lngs}` +
        '&current=temperature_2m,precipitation,weather_code,wind_speed_10m&timezone=auto', { timeout: 18000 });
      const list = Array.isArray(data) ? data : [data];
      host.innerHTML = `<table class="smx-t">
        <thead><tr><th>At</th><th>Temp</th><th>Wind</th><th>Sky</th></tr></thead>
        <tbody>${list.map((d, i) => {
          const c = d.current || {};
          return `<tr><td>${X.dist(stops[i] ? stops[i].dist : 0)}</td>
            <td>${Math.round(c.temperature_2m)}°</td>
            <td>${Math.round(c.wind_speed_10m)}</td>
            <td>${X.esc(WMO[c.weather_code] || '—')}${c.precipitation ? ` · ${c.precipitation} mm` : ''}</td></tr>`;
        }).join('')}</tbody></table>
        <div class="smx-hint">Conditions now at five points along ${X.esc(src.name)} — not a forecast for when
        you would actually arrive.</div>`;
    } catch (err) {
      host.innerHTML = `<div class="smx-hint smx-warn">Route weather failed: ${X.esc(err.message)}</div>`;
    }
  }

  /* -------------------------------- tabs -------------------------------- */

  let terrainRoot = null, geoRoot = null, skyRoot = null;

  X.registerTab({
    id: 'terrain',
    label: 'Terrain',
    icon: 'mountain',
    title: 'Elevation profile, gradient and point terrain',
    build(el) {
      terrainRoot = el;
      el.innerHTML = `
        <h4>Elevation profile</h4>
        <div class="smx-row">
          <label class="smx-lbl" for="smxSamples">Samples</label>
          <input type="number" id="smxSamples" value="120" min="10" max="400" step="10" class="grow" />
          <button class="smx-btn" id="smxProfileLoad">${X.icon('chart')} Load</button>
        </div>
        <div id="smxProfile"><div class="smx-hint">Route or waypoints first, then load a profile.</div></div>
        <div class="smx-row">
          <label class="smx-lbl grow" for="smxGradeOn">Colour path by gradient</label>
          <input type="checkbox" id="smxGradeOn" />
        </div>
        <div class="smx-legend">${GRADE_COLORS.map((c, i) =>
          `<span class="smx-chip"><span class="smx-sw" style="background:${c}"></span>${GRADE_LABELS[i]}</span>`).join('')}</div>

        <h4>Point terrain</h4>
        <div class="smx-row">
          <label class="smx-lbl" for="smxProbeSpacing">Sample ±m</label>
          <input type="number" id="smxProbeSpacing" value="90" min="20" max="2000" step="10" class="grow" />
          <button class="smx-btn" id="smxPick">${X.icon('pointer')} Pick point</button>
        </div>
        <div id="smxProbe"><div class="smx-hint"><b>Alt-click the map</b> to pick a point — elevation, slope,
          which way the ground faces, its coordinates, and the sun and weather there. The button does the same
          for a plain tap. (Plain double-click switches the map between dragging and marking points.)</div></div>

        <h4>Coordinates</h4>
        <div id="smxCoords"><div class="smx-hint">No point picked.</div></div>

        <h4>Colour key</h4>
        <div id="smxTerrainKey"></div>
      `;
      el.querySelector('#smxProfileLoad').addEventListener('click', loadProfile);
      el.querySelector('#smxGradeOn').addEventListener('change', (e) => {
        if (e.target.checked) {
          if (!state.profile) { X.notify('Load a profile first.', 'warn'); e.target.checked = false; return; }
          drawGradeLine();
        } else clearGradeLine();
      });
      el.querySelector('#smxPick').addEventListener('click', () => {
        X.setClickMode({ hint: 'Tap a point on the map.', handler: (latlng) => { setPoint(latlng); return false; } });
      });
      el.querySelector('#smxTerrainKey').innerHTML = X.colourKey();
      renderCoords();
    },
  });

  X.registerTab({
    id: 'geology',
    label: 'Geology',
    icon: 'gem',
    title: 'Bedrock geology, relief and seismicity',
    build(el) {
      geoRoot = el;
      el.innerHTML = `
        <h4>Overlays</h4>
        ${Object.entries(OVERLAYS).map(([key, def]) => `
          <div class="smx-row">
            <label class="smx-lbl grow" for="smxOv-${key}">${X.esc(def.label)}</label>
            <input type="checkbox" id="smxOv-${key}" data-ov="${key}" />
          </div>
          <input type="range" data-ovop="${key}" min="0.1" max="1" step="0.05" value="${def.opts.opacity}"
                 aria-label="${X.esc(def.label)} opacity" />
          <div class="smx-hint" style="margin-top:0">${X.esc(def.note)}</div>`).join('')}

        <h4>Rock unit at a point</h4>
        <div class="smx-btns">
          <button class="smx-btn" id="smxGeoPick">${X.icon('pointer')} Query a point</button>
        </div>
        <div id="smxUnits"><div class="smx-hint">Tap the map after pressing the button to get the mapped unit,
          its age range, lithology and source.</div></div>

        <h4>Earthquakes</h4>
        <div class="smx-row">
          <label class="smx-lbl" for="smxQuakeFeed">Feed</label>
          <select id="smxQuakeFeed" class="grow">
            ${QUAKE_FEEDS.map(([v, l]) =>
              `<option value="${v}" ${v === state.quakes.feed ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>
        <div class="smx-row">
          <label class="smx-lbl">Min M ${state.quakes.minMag.toFixed(1)}</label>
          <input type="range" id="smxQuakeMag" min="0" max="7" step="0.5" value="${state.quakes.minMag}" class="grow" />
        </div>
        <div class="smx-btns">
          <button class="smx-btn" id="smxQuakeLoad">${X.icon('quake')} Plot</button>
          <button class="smx-btn" id="smxQuakeClear" title="Clear plotted events">${X.icon('eraser')}</button>
        </div>
        <div id="smxQuakeInfo"></div>
      `;
      X.on(el, '[data-ov]', 'change', (e, box) => {
        const op = el.querySelector(`[data-ovop="${box.dataset.ov}"]`);
        toggleOverlay(box.dataset.ov, box.checked, op ? Number(op.value) : undefined);
      });
      X.on(el, '[data-ovop]', 'input', (e, slider) => {
        toggleOverlay(slider.dataset.ovop, !!state.layers[slider.dataset.ovop], Number(slider.value));
      });
      el.querySelector('#smxGeoPick').addEventListener('click', () => {
        X.setClickMode({
          hint: 'Tap the map to query the geology there.',
          handler: (latlng) => { setPoint(latlng, { probe: false }); queryGeology(latlng); return false; },
        });
      });
      el.querySelector('#smxQuakeFeed').addEventListener('change', (e) => { state.quakes.feed = e.target.value; });
      el.querySelector('#smxQuakeMag').addEventListener('input', (e) => {
        state.quakes.minMag = Number(e.target.value);
        e.target.previousElementSibling.textContent = `Min M ${state.quakes.minMag.toFixed(1)}`;
      });
      el.querySelector('#smxQuakeLoad').addEventListener('click', loadQuakes);
      el.querySelector('#smxQuakeClear').addEventListener('click', clearQuakes);
    },
  });

  X.registerTab({
    id: 'sky',
    label: 'Sky',
    icon: 'sky',
    title: 'Sun, moon, weather and air quality',
    build(el) {
      skyRoot = el;
      const today = new Date();
      const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      el.innerHTML = `
        <div class="smx-row">
          <label class="smx-lbl" for="smxSkyDate">Date</label>
          <input type="text" id="smxSkyDate" value="${iso}" class="grow" placeholder="YYYY-MM-DD" />
          <button class="smx-btn" id="smxSkyLoad" title="Recalculate">${X.icon('rotate')}</button>
        </div>
        <div class="smx-hint">Uses the point you alt-clicked on the map, or the map centre if none is picked.</div>
        <h4>Sun &amp; moon</h4>
        <div id="smxSky"></div>
        <h4>Weather now</h4>
        <div id="smxWx"></div>
        <h4>Along the route</h4>
        <div class="smx-btns">
          <button class="smx-btn" id="smxRouteWxLoad">${X.icon('road')} Check five points</button>
        </div>
        <div id="smxRouteWx"></div>
      `;
      el.querySelector('#smxSkyLoad').addEventListener('click', loadSky);
      el.querySelector('#smxRouteWxLoad').addEventListener('click', loadRouteWeather);
    },
    onShow() {
      // Sun and moon are local maths, so refresh them every time the tab opens;
      // the network parts only run when asked.
      if (skyRoot && !skyRoot.querySelector('#smxSky').innerHTML) loadSky();
    },
  });

  X.geo = { state, sourcePath, toggleOverlay, setPoint };
})();
