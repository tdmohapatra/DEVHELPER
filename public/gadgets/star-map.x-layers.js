/* ==========================================================================
   star-map.x-layers.js — the live layers, one object each.

   Every source here is free and key-less. Where a source is regional (NOAA
   alerts are the United States, RIPE probes are wherever volunteers host them)
   the layer says so in its own hint rather than looking broken.

     🛰️  Satellites        CelesTrak TLEs, propagated locally with satellite.js
     ✈️  Aircraft          OpenSky Network
     🌋  Earthquakes       USGS
     🌦️  Weather radar     RainViewer
     🌧️  Weather alerts    NOAA / National Weather Service (US)
     🚆  Public transport  OpenStreetMap via Overpass (infrastructure)
     🏙️  Places            OpenStreetMap via Overpass
     🌊  Ocean             Open-Meteo Marine + OpenSeaMap seamarks
     ☄️  Asteroids         NASA JPL close-approach data
     🚀  Space launches    Launch Library 2
     🌐  Internet network  RIPE Atlas probes
     🌍  NASA imagery      NASA GIBS (MODIS true colour)
   ========================================================================== */
'use strict';

(function () {
  const X = window.SMX, Mx = X.Mx, live = X.live;
  const tiles = (url, opts) => (typeof mkTileLayer === 'function' ? mkTileLayer : L.tileLayer)(url, opts);

  /** Distance in kilometres between an item and the user's location. */
  const kmToHome = (item) => {
    const d = live.distanceToHome(item);
    return d === null ? null : d / 1000;
  };
  const withinRadius = (item, ctx) => {
    const d = kmToHome(item);
    return d !== null && d <= ctx.radiusKm;
  };
  const isoDay = (offsetDays) => {
    const d = new Date(Date.now() + (offsetDays || 0) * 86400000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  };

  /* ============================== satellites ============================== */

  const SAT_GROUPS = {
    stations: 'Space stations',
    weather: 'Weather satellites',
    'gps-ops': 'GPS constellation',
    starlink: 'Starlink (first 60)',
  };
  const satCache = { group: null, at: 0, recs: [] };

  /** CelesTrak's TLE text: name line, then the two element lines, repeating. */
  function parseTle(text) {
    const lines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.length);
    const out = [];
    for (let i = 0; i + 2 < lines.length + 1; i += 3) {
      const [name, l1, l2] = [lines[i], lines[i + 1], lines[i + 2]];
      if (!l1 || !l2 || l1[0] !== '1' || l2[0] !== '2') continue;
      out.push({ name: name.trim(), l1, l2 });
    }
    return out;
  }

  /**
   * The vendored satellite.js UMD attaches itself to the global object. Which
   * object that is depends on the host — in a browser `window`, under a test
   * runner `globalThis` — so resolve it rather than assuming.
   */
  const satlib = () => window.satellite || (typeof globalThis !== 'undefined' ? globalThis.satellite : null);

  live.register({
    id: 'satellites',
    label: 'Satellites',
    emoji: '🛰️',
    hint: 'CelesTrak elements, propagated on this device with satellite.js',
    attribution: '<a href="https://celestrak.org">CelesTrak</a>',
    every: 5,
    group_: 'stations',
    async load(ctx) {
      const sat = satlib();
      if (!sat) throw new Error('satellite.js did not load');
      const group = this.group_ || 'stations';
      const TWO_HOURS = 7200000;
      if (satCache.group !== group || Date.now() - satCache.at > TWO_HOURS) {
        const res = await fetch(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=tle`);
        if (!res.ok) throw new Error(`CelesTrak HTTP ${res.status}`);
        let sets = parseTle(await res.text());
        if (group === 'starlink') sets = sets.slice(0, 60);      // 8000 markers is not a map
        satCache.group = group;
        satCache.at = Date.now();
        satCache.recs = sets.map((s) => {
          try {
            return { name: s.name, rec: sat.twoline2satrec(s.l1, s.l2) };
          } catch (_) {
            return null;
          }
        }).filter((r) => r && !r.rec.error);
      }

      // Propagation is local, so this runs every refresh without a request.
      const now = new Date();
      const gmst = sat.gstime(now);
      const items = [];
      for (const { name, rec } of satCache.recs) {
        let pv;
        try { pv = sat.propagate(rec, now); } catch (_) { continue; }
        if (!pv || !pv.position) continue;
        const geo = sat.eciToGeodetic(pv.position, gmst);
        const speed = pv.velocity
          ? Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z) * 1000 : null;   // km/s → m/s
        items.push({
          id: name,
          label: name,
          lat: sat.degreesLat(geo.latitude),
          lng: sat.degreesLong(geo.longitude),
          altitude: geo.height * 1000,
          speed,
          glyph: '🛰️',
          detail: `${Math.round(geo.height)} km up${speed ? ` · ${Math.round(speed * 3.6)} km/h` : ''}`,
        });
      }
      return { items, note: `${SAT_GROUPS[group] || group}, ${satCache.recs.length} tracked` };
    },
    alert: {
      label: 'a satellite passes overhead',
      defaults: { maxKm: 400 },
      fields: [{ key: 'maxKm', label: 'within km', min: 50, max: 2000, step: 50 }],
      test: (item, ctx) => {
        const d = kmToHome(item);
        return d !== null && d <= ctx.settings.maxKm ? `overhead, ${Math.round(d)} km away` : null;
      },
    },
  });

  /* =============================== aircraft =============================== */

  live.register({
    id: 'aircraft',
    label: 'Aircraft',
    emoji: '✈️',
    hint: 'airplanes.live ADS-B feed, around the middle of the view',
    attribution: '<a href="https://airplanes.live">airplanes.live</a>',
    every: 20,
    needsBounds: true,
    async load(ctx) {
      // Not OpenSky: it answers with its own origin in Access-Control-Allow-Origin,
      // so a browser blocks the response. airplanes.live sends `*` and takes a
      // centre-and-radius query, capped at 250 nautical miles.
      const c = map.getCenter();
      const b = map.getBounds();
      const spanNm = Mx.haversine(c, { lat: b.getNorth(), lng: c.lng }) / 1852;
      const radiusNm = Math.max(10, Math.min(250, Math.round(spanNm)));
      const data = await ctx.json(`https://api.airplanes.live/v2/point/${c.lat.toFixed(3)}/${c.lng.toFixed(3)}/${radiusNm}`,
        { timeout: 25000 });
      const FT = 0.3048, KT = 0.514444;
      const items = (data.ac || []).map((a) => {
        if (!Number.isFinite(a.lat) || !Number.isFinite(a.lon)) return null;
        const onGround = a.alt_baro === 'ground';
        const altM = onGround ? 0 : Number.isFinite(a.alt_baro) ? a.alt_baro * FT : null;
        const speed = Number.isFinite(a.gs) ? a.gs * KT : null;
        return {
          id: a.hex,
          label: (a.flight || '').trim() || a.r || a.hex,
          lat: a.lat, lng: a.lon,
          altitude: altM,
          speed,
          heading: Number.isFinite(a.track) ? a.track : null,
          glyph: '✈️',
          detail: `${X.esc(a.t || 'unknown type')}`
            + `${onGround ? ' · on the ground' : altM !== null ? ` · ${Math.round(altM)} m` : ''}`
            + `${speed !== null ? ` · ${Math.round(speed * 3.6)} km/h` : ''}`
            + `${Number.isFinite(a.baro_rate) && Math.abs(a.baro_rate) > 100 ? ` · ${a.baro_rate > 0 ? 'climbing' : 'descending'}` : ''}`
            + `${a.squawk ? ` · squawk ${X.esc(a.squawk)}` : ''}`,
        };
      }).filter(Boolean);
      return { items, note: `${radiusNm} nm around the view centre` };
    },
    alert: {
      label: 'aircraft flies low near me',
      defaults: { maxKm: 25, maxAltM: 3000 },
      fields: [
        { key: 'maxKm', label: 'within km', min: 2, max: 200, step: 1 },
        { key: 'maxAltM', label: 'below m', min: 300, max: 12000, step: 100 },
      ],
      test: (item, ctx) => {
        const d = kmToHome(item);
        if (d === null || d > ctx.settings.maxKm) return null;
        if (!Number.isFinite(item.altitude) || item.altitude > ctx.settings.maxAltM) return null;
        return `${Math.round(item.altitude)} m over, ${d.toFixed(1)} km away`;
      },
    },
  });

  /* ============================= earthquakes ============================= */

  live.register({
    id: 'earthquakes',
    label: 'Earthquakes',
    emoji: '🌋',
    hint: 'USGS, magnitude 2.5+ in the past day',
    attribution: '<a href="https://earthquake.usgs.gov">USGS</a>',
    every: 300,
    async load(ctx) {
      const data = await ctx.json('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson', { timeout: 25000 });
      const items = (data.features || []).map((f) => {
        const [lng, lat, depth] = f.geometry.coordinates;
        const mag = f.properties.mag || 0;
        return {
          id: f.id, label: `M ${mag.toFixed(1)} ${f.properties.place || ''}`.trim(),
          lat, lng, magnitude: mag, depth, glyph: '🌋',
          detail: `depth ${Math.round(depth)} km · ${new Date(f.properties.time).toLocaleString()}`
            + `${f.properties.tsunami ? ' · <b>tsunami flag</b>' : ''}`,
        };
      });
      return { items, note: `largest M${Math.max(0, ...items.map((i) => i.magnitude)).toFixed(1)}` };
    },
    draw(items, ctx) {
      // Magnitude is a severity reading: same ramp as congestion and gradient.
      for (const item of items) {
        L.circleMarker([item.lat, item.lng], {
          pane: live.pane, radius: Math.max(4, 2.4 * item.magnitude),
          color: X.SEVERITY[item.magnitude < 3 ? 0 : item.magnitude < 4 ? 1 : item.magnitude < 5 ? 2 : item.magnitude < 6 ? 3 : 4],
          weight: item.depth >= 70 ? 2 : 1.4,
          dashArray: item.depth >= 70 ? '3 3' : null,
          fillOpacity: 0.35,
        }).bindPopup(`<b>${X.esc(item.label)}</b><div>${item.detail}</div>`).addTo(ctx.group);
      }
    },
    alert: {
      label: 'a quake near me',
      defaults: { minMag: 4, maxKm: 500 },
      fields: [
        { key: 'minMag', label: 'magnitude ≥', min: 1, max: 8, step: 0.5 },
        { key: 'maxKm', label: 'within km', min: 50, max: 3000, step: 50 },
      ],
      test: (item, ctx) => {
        const d = kmToHome(item);
        if (d === null || d > ctx.settings.maxKm || item.magnitude < ctx.settings.minMag) return null;
        return `M${item.magnitude.toFixed(1)}, ${Math.round(d)} km away`;
      },
    },
  });

  /* ============================ weather radar ============================ */

  live.register({
    id: 'radar',
    label: 'Weather radar',
    emoji: '🌦️',
    hint: 'RainViewer precipitation, latest frame',
    attribution: '<a href="https://rainviewer.com">RainViewer</a>',
    every: 300,
    async load(ctx) {
      const meta = await ctx.json('https://api.rainviewer.com/public/weather-maps.json', { timeout: 15000 });
      const frames = ((meta.radar && meta.radar.past) || []).concat((meta.radar && meta.radar.nowcast) || []);
      if (!frames.length) throw new Error('no radar frames published');
      const latest = frames[frames.length - 1];
      if (ctx.state.raster) ctx.state.raster.remove();
      ctx.state.raster = tiles(`${meta.host}${latest.path}/256/{z}/{x}/{y}/4/1_1.png`, {
        pane: live.rasterPane, opacity: 0.75, maxZoom: 12,
        attribution: '<a href="https://rainviewer.com">RainViewer</a>',
      }).addTo(map);
      return { items: [], note: `frame ${new Date(latest.time * 1000).toLocaleTimeString()}` };
    },
  });

  /* ============================ weather alerts ============================ */

  const NWS_SEVERITY = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1, Unknown: 0 };

  live.register({
    id: 'weather-alerts',
    label: 'Weather alerts',
    emoji: '🌧️',
    hint: 'NOAA / National Weather Service — United States only',
    attribution: '<a href="https://www.weather.gov">NWS</a>',
    every: 300,
    needsHome: true,
    async load(ctx) {
      const url = `https://api.weather.gov/alerts/active?point=${ctx.home.lat.toFixed(4)},${ctx.home.lng.toFixed(4)}`;
      let data;
      try {
        data = await ctx.json(url, { timeout: 20000 });
      } catch (err) {
        // The service answers 400 for coordinates it does not cover, which is
        // most of the planet. That is a coverage fact, not a failure.
        if (String(err.message).includes('400')) return { items: [], note: 'no NOAA coverage at your location (United States only)' };
        throw err;
      }
      const items = (data.features || []).map((f) => {
        const p = f.properties || {};
        return {
          id: p.id, label: p.event || 'Alert',
          lat: ctx.home.lat, lng: ctx.home.lng,      // point queries carry no geometry of their own
          severity: p.severity, urgency: p.urgency, glyph: '🌧️',
          detail: `${X.esc(p.severity || '')} · ${X.esc(p.urgency || '')}<br>${X.esc((p.headline || '').slice(0, 200))}`,
        };
      });
      return {
        items,
        note: items.length ? `${items.length} active where you are` : 'nothing active here (US coverage only)',
      };
    },
    alert: {
      label: 'a warning where I am',
      defaults: { minSeverity: 2 },
      fields: [{ key: 'minSeverity', label: 'severity ≥', min: 0, max: 4, step: 1 }],
      test: (item, ctx) => ((NWS_SEVERITY[item.severity] || 0) >= ctx.settings.minSeverity
        ? `${item.severity || 'alert'}: ${item.label}` : null),
    },
  });

  /* =========================== Overpass layers =========================== */

  /** Overpass is a shared free service; keep queries small and timeouts short. */
  const OVERPASS_ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',   // mirror, for when the main one is saturated
  ];

  async function overpass(query) {
    let last = null;
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(query)}`,
        });
        if (res.status === 429 || res.status === 504) { last = new Error('busy'); continue; }
        if (!res.ok) { last = new Error(`HTTP ${res.status}`); continue; }
        const data = await res.json();
        return data.elements || [];
      } catch (err) {
        last = err;
      }
    }
    throw new Error(`Overpass unavailable (${last ? last.message : 'no endpoint answered'}) — it is a shared free service, try again shortly`);
  }

  const bbox = (b) => `${b.south.toFixed(4)},${b.west.toFixed(4)},${b.north.toFixed(4)},${b.east.toFixed(4)}`;
  const osmPoint = (e) => ({ lat: e.lat !== undefined ? e.lat : e.center && e.center.lat, lng: e.lon !== undefined ? e.lon : e.center && e.center.lon });

  live.register({
    id: 'transport',
    label: 'Public transport',
    emoji: '🚆',
    hint: 'OpenStreetMap stations and stops in view, from zoom 13 — infrastructure, not live vehicles',
    attribution: '&copy; OpenStreetMap contributors',
    needsBounds: true,
    minZoom: 13,
    async load(ctx) {
      const box = bbox(ctx.bounds);
      const q = `[out:json][timeout:20];(
        node["railway"~"^(station|halt|tram_stop)$"](${box});
        node["highway"="bus_stop"](${box});
        node["amenity"="bus_station"](${box});
      );out center 60;`;
      const els = await overpass(q);
      const items = els.map((e) => {
        const p = osmPoint(e);
        const t = e.tags || {};
        const rail = t.railway && t.railway !== 'tram_stop';
        return {
          id: `osm${e.id}`, label: t.name || (rail ? 'Station' : 'Stop'),
          lat: p.lat, lng: p.lng,
          glyph: rail ? '🚆' : t.railway === 'tram_stop' ? '🚊' : '🚌',
          detail: `${X.esc(t.railway || t.highway || t.amenity || '')}${t.operator ? ` · ${X.esc(t.operator)}` : ''}`,
        };
      }).filter((i) => Number.isFinite(i.lat));
      return {
        items,
        note: 'live vehicle positions need a GTFS-RT feed from the operator',
      };
    },
  });

  live.register({
    id: 'places',
    label: 'Places',
    emoji: '🏙️',
    hint: 'OpenStreetMap essentials in view from zoom 12: hospitals, pharmacies, fuel, water',
    attribution: '&copy; OpenStreetMap contributors',
    needsBounds: true,
    minZoom: 12,
    async load(ctx) {
      const box = bbox(ctx.bounds);
      const q = `[out:json][timeout:20];(
        node["amenity"~"^(hospital|clinic|pharmacy|fuel|drinking_water|police)$"](${box});
      );out center 60;`;
      const els = await overpass(q);
      const GLYPH = {
        hospital: '🏥', clinic: '🏥', pharmacy: '💊', fuel: '⛽', drinking_water: '🚰', police: '🚓',
      };
      const items = els.map((e) => {
        const p = osmPoint(e);
        const t = e.tags || {};
        return {
          id: `osm${e.id}`, label: t.name || t.amenity, lat: p.lat, lng: p.lng,
          glyph: GLYPH[t.amenity] || '🏙️',
          detail: `${X.esc(t.amenity || '')}${t.opening_hours ? ` · ${X.esc(t.opening_hours)}` : ''}`
            + `${t.phone ? `<br>${X.esc(t.phone)}` : ''}`,
        };
      }).filter((i) => Number.isFinite(i.lat));
      return { items, note: 'the kind of place worth knowing before you need it' };
    },
  });

  /* ================================ ocean ================================ */

  live.register({
    id: 'ocean',
    label: 'Ocean',
    emoji: '🌊',
    hint: 'OpenSeaMap seamarks, plus Open-Meteo Marine at your location',
    attribution: '<a href="https://www.openseamap.org">OpenSeaMap</a>, Open-Meteo',
    every: 900,
    async load(ctx) {
      if (!ctx.state.raster) {
        ctx.state.raster = tiles('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', {
          pane: live.rasterPane, maxZoom: 18, opacity: 0.9,
          attribution: '<a href="https://www.openseamap.org">OpenSeaMap</a>',
        }).addTo(map);
      }
      const at = ctx.home || map.getCenter();
      const data = await ctx.json('https://marine-api.open-meteo.com/v1/marine'
        + `?latitude=${at.lat.toFixed(3)}&longitude=${at.lng.toFixed(3)}`
        + '&current=wave_height,wave_period,wave_direction,sea_surface_temperature', { timeout: 15000 });
      const c = (data && data.current) || {};
      const height = c.wave_height;
      const items = Number.isFinite(height) ? [{
        id: 'marine', label: 'Sea state', lat: at.lat, lng: at.lng, glyph: '🌊',
        waveHeight: height,
        detail: `waves ${height} m${Number.isFinite(c.wave_period) ? ` · period ${c.wave_period} s` : ''}`
          + `${Number.isFinite(c.wave_direction) ? ` · from ${Mx.compass(c.wave_direction)}` : ''}`
          + `${Number.isFinite(c.sea_surface_temperature) ? ` · ${c.sea_surface_temperature}°C` : ''}`,
      }] : [];
      return {
        items,
        note: Number.isFinite(height) ? `waves ${height} m` : 'no marine data at this point (inland)',
      };
    },
    alert: {
      label: 'a rough sea state',
      defaults: { minWaveM: 2.5 },
      fields: [{ key: 'minWaveM', label: 'waves ≥ m', min: 0.5, max: 10, step: 0.5 }],
      test: (item, ctx) => (Number.isFinite(item.waveHeight) && item.waveHeight >= ctx.settings.minWaveM
        ? `waves ${item.waveHeight} m` : null),
    },
  });

  /* ============================== asteroids ============================== */

  const LD_KM = 384400;   // one lunar distance

  live.register({
    id: 'asteroids',
    label: 'Asteroids',
    emoji: '☄️',
    hint: 'NASA NeoWs close approaches, next 7 days — a list, not map positions',
    attribution: '<a href="https://api.nasa.gov">NASA NeoWs</a>',
    every: 3600,
    async load(ctx) {
      // Not JPL's cad.api: it sends no Access-Control-Allow-Origin at all, so a
      // browser cannot read the response. NeoWs sends `*`. DEMO_KEY is rate
      // limited to about 30 requests an hour per address, which is plenty here.
      const data = await ctx.json('https://api.nasa.gov/neo/rest/v1/feed'
        + `?start_date=${isoDay(0)}&end_date=${isoDay(7)}&api_key=DEMO_KEY`, { timeout: 25000 });
      const byDay = data.near_earth_objects || {};
      const items = [];
      for (const day of Object.keys(byDay).sort()) {
        for (const neo of byDay[day]) {
          const ca = (neo.close_approach_data || [])[0];
          if (!ca) continue;
          const ld = Number(ca.miss_distance && ca.miss_distance.lunar);
          const kph = Number(ca.relative_velocity && ca.relative_velocity.kilometers_per_hour);
          const dia = neo.estimated_diameter && neo.estimated_diameter.meters;
          items.push({
            id: `${neo.id}-${day}`,
            label: neo.name,
            ld,
            when: ca.close_approach_date_full || day,
            hazardous: !!neo.is_potentially_hazardous_asteroid,
            glyph: neo.is_potentially_hazardous_asteroid ? '⚠️' : '☄️',
            detail: `${X.esc(ca.close_approach_date_full || day)} · ${ld.toFixed(1)} lunar distances`
              + `${Number.isFinite(kph) ? ` · ${Math.round(kph).toLocaleString()} km/h` : ''}`
              + `${dia ? `<br>${Math.round(dia.estimated_diameter_min)}–${Math.round(dia.estimated_diameter_max)} m across` : ''}`
              + `${neo.is_potentially_hazardous_asteroid ? ' · <b>flagged potentially hazardous</b>' : ''}`,
          });
        }
      }
      items.sort((a, b) => a.ld - b.ld);
      return {
        items,
        note: items.length ? `${items.length} approaches, closest ${items[0].ld.toFixed(1)} LD` : 'none listed this week',
      };
    },
    // Close approaches have no ground position worth drawing; the panel lists them.
    draw() {},
    alert: {
      label: 'a close approach',
      defaults: { maxLD: 5 },
      fields: [{ key: 'maxLD', label: 'within LD', min: 1, max: 20, step: 1 }],
      test: (item, ctx) => (item.ld <= ctx.settings.maxLD
        ? `${item.ld.toFixed(1)} lunar distances on ${item.when}` : null),
    },
  });

  /* ============================ space launches ============================ */

  live.register({
    id: 'launches',
    label: 'Space launches',
    emoji: '🚀',
    hint: 'Launch Library 2, next 20 launches worldwide',
    attribution: '<a href="https://thespacedevs.com">The Space Devs</a>',
    every: 1800,
    async load(ctx) {
      const data = await ctx.json('https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=20&mode=list', { timeout: 25000 });
      const items = (data.results || []).map((r) => {
        const pad = r.pad || {};
        const t = r.net ? new Date(r.net) : null;
        const hours = t ? (t.valueOf() - Date.now()) / 3600000 : null;
        return {
          id: r.id,
          label: r.name || 'Launch',
          lat: Number(pad.latitude), lng: Number(pad.longitude),
          hours, glyph: '🚀',
          detail: `${t ? t.toLocaleString() : 'date to be confirmed'}`
            + `${hours !== null && hours > 0 ? ` · in ${hours < 24 ? `${Math.round(hours)} h` : `${Math.round(hours / 24)} days`}` : ''}`
            + `${pad.name ? `<br>${X.esc(pad.name)}` : ''}`
            + `${r.status && r.status.name ? ` · ${X.esc(r.status.name)}` : ''}`,
        };
      });
      const next = items.find((i) => i.hours !== null && i.hours > 0);
      return { items, note: next ? `next in ${Math.round(next.hours)} h` : `${items.length} scheduled` };
    },
    alert: {
      label: 'a launch is imminent',
      defaults: { withinHours: 12 },
      fields: [{ key: 'withinHours', label: 'within hours', min: 1, max: 72, step: 1 }],
      test: (item, ctx) => (item.hours !== null && item.hours > 0 && item.hours <= ctx.settings.withinHours
        ? `lifts off in ${Math.round(item.hours)} h` : null),
    },
  });

  /* =========================== internet network =========================== */

  live.register({
    id: 'internet',
    label: 'Internet network',
    emoji: '🌐',
    hint: 'RIPE Atlas measurement probes around your location',
    attribution: '<a href="https://atlas.ripe.net">RIPE Atlas</a>',
    every: 900,
    needsHome: true,
    async load(ctx) {
      const url = 'https://atlas.ripe.net/api/v2/probes/'
        + `?radius=${ctx.home.lat.toFixed(3)},${ctx.home.lng.toFixed(3)}:${Math.min(1000, Math.round(ctx.radiusKm))}`
        + '&page_size=100&fields=id,geometry,status,asn_v4,asn_v6,country_code,is_anchor';
      const data = await ctx.json(url, { timeout: 25000 });
      const items = (data.results || []).map((p) => {
        const c = p.geometry && p.geometry.coordinates;
        if (!c) return null;
        return {
          id: `probe${p.id}`,
          label: `${p.is_anchor ? 'Anchor' : 'Probe'} #${p.id}`,
          lat: c[1], lng: c[0],
          glyph: p.is_anchor ? '🛜' : '🌐',
          status: (p.status && p.status.name) || p.status_name || String(p.status || ''),
          detail: `${X.esc((p.status && p.status.name) || p.status_name || '')}${p.asn_v4 ? ` · AS${p.asn_v4}` : ''}`
            + `${p.country_code ? ` · ${X.esc(p.country_code)}` : ''}`,
        };
      }).filter(Boolean);
      const connected = items.filter((i) => String(i.status).toLowerCase().startsWith('connect')).length;
      return { items, note: `${connected}/${items.length} connected` };
    },
  });

  /* ============================= NASA imagery ============================= */

  live.register({
    id: 'gibs',
    label: 'NASA imagery',
    emoji: '🌍',
    hint: 'NASA GIBS MODIS true colour, yesterday’s pass — whole-earth detail, upscaled past zoom 8',
    attribution: '<a href="https://earthdata.nasa.gov">NASA GIBS</a>',
    raster: () => tiles(
      'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/'
      + `${isoDay(-1)}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
      {
        // The Level9 matrix stops at zoom 8; ask for more and GIBS returns a
        // "Zoom Level Not Supported" placeholder image rather than an error.
        pane: live.rasterPane, maxZoom: 19, maxNativeZoom: 8, opacity: 0.6,
        attribution: '<a href="https://earthdata.nasa.gov">NASA GIBS</a>',
      },
    ),
    async load() {
      return { items: [], note: `${isoDay(-1)} · detail to zoom 9` };
    },
  });

  /* ---------------------- satellite group chooser ---------------------- */

  // The satellites layer is the one with a meaningful choice of dataset, so it
  // gets a control of its own rather than four separate layers.
  X.live.satelliteGroups = SAT_GROUPS;
  X.live.setSatelliteGroup = (group) => {
    const layer = live.layers.find((l) => l.id === 'satellites');
    if (!layer || !SAT_GROUPS[group]) return;
    layer.group_ = group;
    satCache.group = null;                     // force a re-fetch of the elements
    if (live.layerState('satellites').on) live.refresh('satellites');
  };
})();
