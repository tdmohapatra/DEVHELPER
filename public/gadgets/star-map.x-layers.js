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
          id: name,                    // the element set's name; predictPass looks it up by this
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
    // A satellite is a mirror: it has to be up, the sky has to be dark, and it
    // has to still be in sunlight. All three, or there is nothing to see.
    visibility: { needsDarkness: true, needsSunlight: true, minElevation: 10 },

    /**
     * When does this satellite next clear the horizon here, how high does it
     * get, and will it be visible to the naked eye when it does?
     *
     * Coarse search then refine: step forward in minutes looking for the
     * elevation to go positive, then in ten-second steps around that crossing.
     * Propagation is local, so a day's search costs nothing but arithmetic.
     */
    predictPass(item, observer) {
      const sat = satlib();
      const entry = satCache.recs.find((r) => r.name === item.id || r.name === item.label);
      if (!sat || !entry) return null;
      const observerGd = {
        latitude: Mx.rad(observer.lat),
        longitude: Mx.rad(observer.lng),
        height: (observer.altitude || 0) / 1000,        // satellite.js works in km
      };
      const elevationAt = (date) => {
        const pv = sat.propagate(entry.rec, date);
        if (!pv || !pv.position) return null;
        const ecf = sat.eciToEcf(pv.position, sat.gstime(date));
        return Mx.deg(sat.ecfToLookAngles(observerGd, ecf).elevation);
      };

      const MINUTES = 24 * 60;
      const start = Date.now();
      let previous = elevationAt(new Date(start));
      if (previous === null) return null;
      const wasUp = previous > 10;

      for (let m = 1; m <= MINUTES; m++) {
        const when = new Date(start + m * 60000);
        const el = elevationAt(when);
        if (el === null) continue;
        const rising = previous <= 10 && el > 10;
        previous = el;
        if (!rising) continue;

        // Refine the crossing, then walk the pass to its highest point.
        let aos = when;
        for (let sec = -60; sec <= 0; sec += 10) {
          const t = new Date(when.valueOf() + sec * 1000);
          if ((elevationAt(t) || -90) > 10) { aos = t; break; }
        }
        let peak = { el: -90, at: aos };
        for (let sec = 0; sec <= 900; sec += 20) {
          const t = new Date(aos.valueOf() + sec * 1000);
          const e = elevationAt(t);
          if (e === null) break;
          if (e > peak.el) peak = { el: e, at: t };
          if (e < 5 && sec > 60) break;
        }
        const pv = sat.propagate(entry.rec, peak.at);
        const geo = pv && pv.position ? sat.eciToGeodetic(pv.position, sat.gstime(peak.at)) : null;
        const sunlit = geo ? Mx.isSunlit({
          lat: sat.degreesLat(geo.latitude), lng: sat.degreesLong(geo.longitude), altitude: geo.height * 1000,
        }, peak.at) : null;
        const darkHere = Mx.sunElevation(peak.at, observer.lat, observer.lng) < -6;
        return {
          aos: aos.toISOString(),
          peakAt: peak.at.toISOString(),
          maxElevation: peak.el,
          sunlit,
          dark: darkHere,
          visible: sunlit === null ? null : (sunlit && darkHere),
          wasUp,
        };
      }
      return { aos: null, note: 'no pass above 10 degrees in the next 24 hours' };
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

  // Deliberately not the severity green: this is an identity, and it has to be
  // impossible to mistake for a reading. Documented in the colour key.
  const MIL_COLOR = '#00e676';
  // A bus route is a line on the ground, not a reading: identity family, one hue.
  const BUS_COLOR = '#60a5fa';

  live.register({
    id: 'aircraft',
    label: 'Aircraft',
    emoji: '✈️',
    hint: 'airplanes.live ADS-B feed, around the middle of the view. Airliners, turboprops, '
      + 'helicopters, gliders, drones and ground traffic each have their own silhouette; '
      + 'military and Indian state aircraft are green, with a trail.',
    attribution: '<a href="https://airplanes.live">airplanes.live</a>',
    every: 20,
    needsBounds: true,
    // Aircraft carry their own lights, so darkness and sunlight do not matter —
    // but past about 30 km even a jet is a speck you will not pick out.
    visibility: { needsDarkness: false, needsSunlight: false, minElevation: 3, maxRange: 30000 },
    enrich: (item) => enrichAircraft(item),
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
      const FT = 0.3048;
      const previous = new Map((ctx.state.items || []).map((i) => [i.id, i]));
      // The feed stamps its own clock and how stale each position is. At 900 km/h
      // a second of age is 250 metres of error, so it is worth carrying rather
      // than pretending every fix is "now".
      const serverNow = Number.isFinite(data.now) ? data.now : Date.now();
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
          positionAge: Number.isFinite(a.seen_pos) ? a.seen_pos : null,
          signalAge: Number.isFinite(a.seen) ? a.seen : null,
          fixAt: Number.isFinite(a.seen_pos) ? serverNow - a.seen_pos * 1000 : serverNow,
          // How far it could have moved since that position was broadcast.
          staleBy: Number.isFinite(a.seen_pos) && Number.isFinite(a.gs) ? a.seen_pos * a.gs * KT : null,
          ...(() => {
            const mil = classifyAircraft(a);
            const kind = mil ? (classifyKind(a) === 'helicopter' ? 'helicopter' : 'heavy') : classifyKind(a);
            const def = AIRCRAFT_CLASSES[kind] || AIRCRAFT_CLASSES.unknown;
            const grounded = a.alt_baro === 'ground';
            return {
              military: mil || undefined,
              kind,
              kindLabel: def.label,
              registration: a.r || null,
              description: a.desc || null,
              // Shape carries the class; colour stays out of it, except for the
              // green that means military. Ground traffic is dimmed rather than
              // hidden, so a busy apron does not shout over the air picture.
              iconHtml: aircraftSvg(kind),
              iconClass: `smx-ac smx-ac-${kind}${mil ? ' smx-mil' : ''}${grounded ? ' smx-ac-parked' : ''}`,
              iconSize: def.size,
            };
          })(),
          // Route and airframe are already known for an aeroplane we have seen.
          ...(() => {
            const was = previous.get(a.hex);
            return was && was.enriched
              ? { enriched: true, route: was.route, routeLine: was.routeLine, routeGeometry: was.routeGeometry,
                  airframe: was.airframe, aircraftLine: was.aircraftLine, extra: was.extra }
              : {};
          })(),
          detail: (() => {
            const mil = classifyAircraft(a);
            return mil
              ? `<div class="smx-route"><span class="code" style="color:${MIL_COLOR}">${X.esc(mil.service)}</span></div>`
                + `<div class="smx-meta">${X.esc(mil.why)}${a.r ? ` · ${X.esc(a.r)}` : ''}</div>`
              : '';
          })() + X.kv([
            ['type', X.esc(a.t || '—')],
            ['altitude', onGround ? 'on the ground' : altM !== null ? `${Math.round(altM).toLocaleString()} m` : null],
            ['speed', speed !== null ? `${Math.round(speed * 3.6)} km/h` : null],
            ['track', Number.isFinite(a.track) ? `${Mx.compass(a.track)} ${Math.round(a.track)}°` : null],
            ['vertical', Number.isFinite(a.baro_rate) && Math.abs(a.baro_rate) > 100
              ? (a.baro_rate > 0 ? 'climbing' : 'descending') : null],
            ['squawk', a.squawk ? X.esc(a.squawk) : null],
            ['position', Number.isFinite(a.seen_pos)
              ? `${a.seen_pos < 10 ? a.seen_pos.toFixed(1) : Math.round(a.seen_pos)} s old` : null],
            ['class', X.esc((AIRCRAFT_CLASSES[classifyKind(a)] || AIRCRAFT_CLASSES.unknown).label)],
          ]) + (a.desc ? `<div class="smx-meta">${X.esc(a.desc)}</div>` : '')
            + (Number.isFinite(a.seen_pos) ? `<div class="smx-meta">`
            + `broadcast ${new Date(serverNow - a.seen_pos * 1000).toLocaleTimeString()}`
            + `${Number.isFinite(a.gs) ? ` · up to ${X.dist(a.seen_pos * a.gs * KT)} on from there` : ''}`
            + `</div>` : ''),
        };
      }).filter(Boolean);
      return { items, note: `${radiusNm} nm around the view centre` };
    },
    /**
     * A short trail behind every military or state aircraft, whether or not it is
     * being tracked: the point of highlighting one is to see where it has been
     * without having to click it first. Capped, and dropped as soon as the
     * aircraft leaves the feed.
     */
    afterDraw(items, ctx) {
      const st = ctx.state;
      st.milTrails = st.milTrails || new Map();
      if (!st.milGroup) st.milGroup = L.layerGroup([], { pane: live.rasterPane }).addTo(map);

      const seen = new Set();
      for (const item of items) {
        if (!item.military) continue;
        seen.add(item.id);
        const points = st.milTrails.get(item.id) || [];
        const last = points[points.length - 1];
        if (!last || Mx.haversine(last, item) > 200) points.push({ lat: item.lat, lng: item.lng });
        st.milTrails.set(item.id, points.slice(-80));
      }
      for (const id of [...st.milTrails.keys()]) if (!seen.has(id)) st.milTrails.delete(id);

      st.milGroup.clearLayers();
      for (const points of st.milTrails.values()) {
        if (points.length < 2) continue;
        const latlngs = points.map((p) => [p.lat, p.lng]);
        L.polyline(latlngs, {
          pane: live.rasterPane, className: 'smx-glow', color: MIL_COLOR,
          weight: 9, opacity: 0.3, interactive: false,
        }).addTo(st.milGroup);
        L.polyline(latlngs, {
          pane: live.rasterPane, color: MIL_COLOR, weight: 2, opacity: 0.9, interactive: false,
        }).addTo(st.milGroup);
        L.polyline(latlngs, {
          pane: live.rasterPane, className: 'smx-flow smx-flow-2', color: '#c8ffe0',
          weight: 1.5, opacity: 0.95, dashArray: '1 9', interactive: false,
        }).addTo(st.milGroup);
      }
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

  /* ---------------------------- what is it? ---------------------------- */

  /**
   * Aircraft are told apart by silhouette, not by colour.
   *
   * Colour in this map already means something — cool hues identify, the green to
   * red ramp measures — so painting a rainbow of aircraft types would break the
   * one rule that keeps it readable. Shape is free: a helicopter, a glider and an
   * airliner are unmistakable from their outlines at 20 pixels, and the only
   * colour exception is the green reserved for military and state aircraft.
   *
   * The class comes from the ADS-B emitter category where the aircraft sends one,
   * falling back to its ICAO type code, which is the more reliable of the two in
   * practice: plenty of airliners transmit A0, "no information".
   */
  const HELI_TYPE = /^(EC|AS|H\d|B06|B412|B429|R22|R44|R66|S76|S92|A109|A139|AW1|MI\d|H125|H145|H155|H160|H175|H500|EH10)/i;
  const TURBOPROP_TYPE = /^(AT[4-9]|DH8|D328|SF34|E120|B190|C208|C212|C295|DHC|F27|L410|PC12|SB20|SW4|TBM|Y12)/i;
  const BIZJET_TYPE = /^(C25|C55|C56|C68|C750|CL30|CL35|CL60|E50|E55|E35|F2TH|F900|FA[0-9]|G150|G280|GALX|GL5T|GL6T|GL7T|GLEX|H25|LJ3|LJ4|LJ6|LJ7|PRM1)/i;
  const LIGHT_TYPE = /^(C1[0-9]{2}|C2[0-9]{2}|P28|PA[0-9]{2}|SR2|DA[24]|BE[0-9]{2}|AA5|M20|RV[0-9])/i;

  /** One entry per class: what to call it, how to draw it, how big. */
  const AIRCRAFT_CLASSES = {
    heavy: {
      label: 'Heavy jet', size: 26,
      svg: '<path d="M12 1.6l1.9 7.2 8.1 3.4v2.1l-8.1-1.4v5.7l3.1 2.1v1.7L12 21.2l-5 1.2v-1.7l3.1-2.1v-5.7L2 14.3v-2.1l8.1-3.4z"/>'
        + '<path d="M6.6 10.6l1.2.5M17.4 10.6l-1.2.5" stroke="currentColor" stroke-width="1.4"/>',
    },
    airliner: {
      label: 'Airliner', size: 22,
      svg: '<path d="M12 2l1.8 6.9 7.7 3.2v2l-7.7-1.3v5.4l2.9 2v1.6L12 20.6l-4.7 1.2v-1.6l2.9-2v-5.4L2.5 14.1v-2l7.7-3.2z"/>',
    },
    turboprop: {
      label: 'Turboprop', size: 21,
      // Straight wings and a visible prop line: an ATR is not a jet.
      svg: '<path d="M11.1 2.6h1.8l.7 6.4h7.9v2.2h-7.9v6l2.7 1.9v1.6L12 19.6l-4.3 1.1v-1.6l2.7-1.9v-6H2.5V9h7.9z"/>'
        + '<path d="M8.4 3.4h7.2" stroke="currentColor" stroke-width="1.5"/>',
    },
    bizjet: {
      label: 'Business jet', size: 19,
      svg: '<path d="M12 3l1.4 6.3 6.6 2.9v1.7l-6.6-1.1v4.7l2.3 1.7v1.4L12 19.7l-3.7 1v-1.4l2.3-1.7v-4.7L4 13.9v-1.7l6.6-2.9z"/>',
    },
    light: {
      label: 'Light aircraft', size: 18,
      // High wing, fixed gear: the shape of a trainer.
      svg: '<path d="M11.2 3h1.6l.6 5H21v2h-7.6v5.4l2.2 1.6v1.4L12 17.6l-3.6 1.8v-1.4l2.2-1.6V10H3V8h7.6z"/>',
    },
    helicopter: {
      label: 'Helicopter', size: 22,
      // The rotor is a separate element so it can turn.
      svg: '<path d="M10.6 7.4h2.8v6.1l6.3 3.1v1.7l-6.3-1.3v2.6h2v1.4H9v-1.4h1.6v-2.6l-6.3 1.3v-1.7l6.3-3.1z"/>'
        + '<g class="rotor"><path d="M3.4 6.2h17.2" stroke="currentColor" stroke-width="1.6"/></g>'
        + '<circle cx="12" cy="6.2" r="1.1"/>',
    },
    glider: {
      label: 'Glider', size: 22,
      svg: '<path d="M11.4 3h1.2l.5 7H23v1.6h-9.9v5.9l2 1.5v1.3L12 19.4l-3.1.9v-1.3l2-1.5v-5.9H1V10h9.9z"/>',
    },
    balloon: {
      label: 'Balloon or airship', size: 20,
      svg: '<path d="M12 2a6.4 6.4 0 0 1 6.4 6.4c0 3.6-3.4 6.4-5.2 8.2h-2.4C9 14.8 5.6 12 5.6 8.4A6.4 6.4 0 0 1 12 2z"/>'
        + '<rect x="10.1" y="17.4" width="3.8" height="3.4" rx=".7"/>',
    },
    drone: {
      label: 'Drone', size: 18,
      svg: '<circle cx="12" cy="12" r="2.6"/><path d="M6.4 6.4l3.2 3.2M17.6 6.4l-3.2 3.2M6.4 17.6l3.2-3.2M17.6 17.6l-3.2-3.2"'
        + ' stroke="currentColor" stroke-width="1.6"/>'
        + '<circle cx="5.2" cy="5.2" r="2"/><circle cx="18.8" cy="5.2" r="2"/>'
        + '<circle cx="5.2" cy="18.8" r="2"/><circle cx="18.8" cy="18.8" r="2"/>',
    },
    ground: {
      label: 'Ground vehicle', size: 15,
      svg: '<rect x="4" y="9" width="16" height="7" rx="1.6"/><circle cx="8" cy="17.6" r="1.6"/><circle cx="16" cy="17.6" r="1.6"/>',
    },
    unknown: {
      label: 'Unidentified', size: 16,
      svg: '<circle cx="12" cy="12" r="5"/>',
    },
  };

  /** ADS-B emitter category, then the type code, then give up honestly. */
  function classifyKind(a) {
    const cat = String(a.category || '').toUpperCase();
    const type = String(a.t || '').toUpperCase();

    if (cat === 'A7' || HELI_TYPE.test(type)) return 'helicopter';
    if (cat === 'B1') return 'glider';
    if (cat === 'B2') return 'balloon';
    if (cat === 'B6') return 'drone';
    if (cat === 'B4' || cat === 'B3') return 'light';
    if (cat.startsWith('C')) return 'ground';

    if (TURBOPROP_TYPE.test(type)) return 'turboprop';
    if (BIZJET_TYPE.test(type)) return 'bizjet';
    if (LIGHT_TYPE.test(type)) return 'light';
    if (cat === 'A5' || cat === 'A4') return 'heavy';
    if (cat === 'A3') return 'airliner';
    if (cat === 'A2') return 'airliner';
    if (cat === 'A1') return 'light';
    return type ? 'airliner' : 'unknown';       // a type code but no category: almost always an airliner
  }

  /* ------------------- military and state aircraft over India ------------------- */

  /**
   * Is this a military or state aircraft, and whose?
   *
   * Three independent signals, because none is sufficient alone:
   *
   *   · the feed's own military flag (dbFlags bit 1), which comes from a curated
   *     database and is the strongest evidence there is;
   *   · India's ICAO address block, 0x800000–0x83FFFF, which says the airframe is
   *     Indian but nothing about who operates it;
   *   · the registration, where Indian state aircraft follow patterns civil ones
   *     do not — K and KW series for the Air Force, IN for the Navy, CG for the
   *     Coast Guard.
   *
   * The verdict is a judgement from public patterns, not an official list, so the
   * reason it matched travels with it and is shown in the popup.
   */
  const IAF_REG = /^(K|KW[- ]?)\d{3,4}$/i;          // K3010, KW-3456
  const NAVY_REG = /^IN[- ]?\d{3,4}$/i;             // IN-201
  const COASTGUARD_REG = /^CG[- ]?\d{3,4}$/i;       // CG-791
  const STATE_CALLSIGN = /^(IAF|VYU|AVENGER|RAJDOOT|VUAV)/i;

  function classifyAircraft(a) {
    const flagged = ((a.dbFlags || 0) & 1) === 1;
    const hex = String(a.hex || '').toLowerCase();
    const indianHex = /^8[0-3][0-9a-f]{4}$/.test(hex);
    const reg = String(a.r || '').trim();
    const callsign = String(a.flight || '').trim();

    let service = null;
    if (IAF_REG.test(reg)) service = 'Indian Air Force';
    else if (NAVY_REG.test(reg)) service = 'Indian Navy';
    else if (COASTGUARD_REG.test(reg)) service = 'Indian Coast Guard';

    const why = [];
    if (flagged) why.push('listed as military');
    if (service) why.push(`${service} registration ${reg}`);
    else if (STATE_CALLSIGN.test(callsign)) why.push(`state callsign ${callsign}`);
    if (indianHex) why.push('Indian ICAO address');

    // Flagged military, or an unmistakable Indian state registration, or a state
    // callsign on an Indian airframe. An Indian address alone proves nothing.
    const military = flagged || !!service || (STATE_CALLSIGN.test(callsign) && indianHex);
    if (!military) return null;
    return {
      service: service || (indianHex ? 'Indian military or state' : 'Military or state'),
      indian: indianHex || !!service,
      why: why.join(' · '),
    };
  }

  /** The silhouette for a class, at its own size. */
  const aircraftSvg = (kind) => {
    const def = AIRCRAFT_CLASSES[kind] || AIRCRAFT_CLASSES.unknown;
    return `<svg viewBox="0 0 24 24" width="${def.size}" height="${def.size}" fill="currentColor"`
      + ` stroke="none" aria-hidden="true">${def.svg}</svg>`;
  };

  /* --------------------- aircraft route and airframe --------------------- */

  /**
   * ADS-B carries no route: a transponder broadcasts a callsign, not "Bengaluru
   * to Goa". The route and the airframe come from adsbdb, a free, key-less
   * database keyed by callsign and by Mode S address.
   *
   * Cached hard, because these barely change: a route for half a day, an
   * airframe for a week, and a miss for an hour so an unlisted callsign is not
   * asked about on every popup.
   */
  const adsbCache = new Map();
  const ROUTE_TTL = 12 * 3600 * 1000;
  const AIRFRAME_TTL = 7 * 24 * 3600 * 1000;
  const MISS_TTL = 3600 * 1000;

  async function adsbdb(kind, value, ttl) {
    const key = `${kind}:${value}`;
    const hit = adsbCache.get(key);
    if (hit && Date.now() - hit.at < (hit.data ? ttl : MISS_TTL)) return hit.data;
    let data = null;
    try {
      const res = await fetch(`https://api.adsbdb.com/v0/${kind}/${encodeURIComponent(value)}`);
      if (res.ok) {
        const body = await res.json();
        data = (body && body.response) || null;
        if (data === 'unknown callsign' || data === 'unknown aircraft') data = null;
      }
    } catch (_) {
      data = null;
    }
    adsbCache.set(key, { at: Date.now(), data });
    return data;
  }

  /**
   * The route, laid out rather than written out: airport codes either side of an
   * arrow, then the numbers that follow from them in one row of labelled values,
   * and a hairline bar for how much of the leg is behind it.
   */
  function routeBlock(fr, item) {
    const g = item.routeGeometry;
    const end = (a) => `<span><span class="code">${X.esc((a && (a.iata_code || a.icao_code)) || '???')}</span>`
      + `<span class="place"> ${X.esc((a && (a.municipality || a.name)) || '')}</span></span>`;
    return `<div class="smx-route">${end(fr.origin)}<span class="arrow">→</span>${end(fr.destination)}</div>`
      + `${fr.airline && fr.airline.name ? `<div class="smx-meta">${X.esc(fr.airline.name)}</div>` : ''}`
      + (g ? `<div class="smx-progress"><span style="width:${Math.round(Mx.clamp(g.progress || 0, 0, 1) * 100)}%"></span></div>`
        + X.kv([
          ['to run', X.dist(g.left)],
          ['flown', g.progress !== null ? `${Math.round(g.progress * 100)}%` : null],
          ['heading', `${Mx.compass(g.bearingTo)} ${Math.round(g.bearingTo)}°`],
          ['eta', g.eta ? Mx.dur(g.eta) : null],
        ]) : '');
  }

  /**
   * Second opinion on an airframe, when adsbdb has never heard of it.
   *
   * hexdb sends its CORS header on a hit but not on a miss, so an unknown hex
   * logs a CORS complaint in the console that cannot be suppressed from here.
   * It is caught and cached as a miss, so it happens once per airframe — the
   * coverage it adds (Indian registrations especially) is worth the noise.
   */
  async function hexdbAircraft(hex) {
    const key = `hexdb:${hex}`;
    const hit = adsbCache.get(key);
    if (hit && Date.now() - hit.at < (hit.data ? AIRFRAME_TTL : MISS_TTL)) return hit.data;
    let data = null;
    try {
      const res = await fetch(`https://hexdb.io/api/v1/aircraft/${encodeURIComponent(hex)}`);
      if (res.ok) {
        const body = await res.json();
        if (body && body.Registration) data = body;
      }
    } catch (_) {
      data = null;
    }
    adsbCache.set(key, { at: Date.now(), data });
    return data;
  }

  const KT = 0.514444;                      // knots to metres per second

  const airportLabel = (a) => (a
    ? `${X.esc(a.iata_code || a.icao_code || '?')} ${X.esc(a.municipality || a.name || '')}`.trim()
    : 'unknown');

  /**
   * Fill in an aircraft's route, its airframe, and what the route implies: how
   * far it still has to fly, which way, and when it arrives at its present
   * ground speed. The distances come from our own geodesy rather than the feed,
   * so they are consistent with every other distance in the tool.
   */
  async function enrichAircraft(item) {
    if (item.enriched) return false;
    item.enriched = true;                     // one attempt per fix, cache does the rest

    const [route, frame] = await Promise.all([
      item.label && /^[A-Z0-9]{3,8}$/i.test(item.label) ? adsbdb('callsign', item.label, ROUTE_TTL) : null,
      item.id ? adsbdb('aircraft', item.id, AIRFRAME_TTL) : null,
    ]);

    const fr = route && route.flightroute;
    if (fr) {
      item.route = fr;
      const from = fr.origin, to = fr.destination;
      if (from && to) {
        const total = Mx.haversine(
          { lat: from.latitude, lng: from.longitude }, { lat: to.latitude, lng: to.longitude },
        );
        const left = Mx.haversine({ lat: item.lat, lng: item.lng }, { lat: to.latitude, lng: to.longitude });
        const flown = Math.max(0, total - left);
        const bearingTo = Mx.bearing({ lat: item.lat, lng: item.lng }, { lat: to.latitude, lng: to.longitude });
        const eta = item.speed > 20 ? left / item.speed : null;
        item.routeGeometry = { from, to, total, left, flown, bearingTo, eta,
          progress: total > 0 ? flown / total : null };
      }
      item.routeLine = routeBlock(fr, item);
    } else if (item.label) {
      item.routeLine = '<div class="smx-meta">No route listed for this callsign.</div>';
    }

    // adsbdb does not know every airframe — Indian registrations are patchy —
    // so fall back to hexdb, which is also free and CORS-open.
    let ac = frame && frame.aircraft;
    if (!ac && item.id) {
      const spare = await hexdbAircraft(item.id);
      if (spare) {
        ac = {
          registration: spare.Registration,
          type: spare.Type,
          icao_type: spare.ICAOTypeCode,
          manufacturer: spare.Manufacturer,
          registered_owner: spare.RegisteredOwners,
        };
      }
    }
    if (ac) {
      item.airframe = ac;
      item.aircraftLine = `<div class="smx-meta">`
        + [ac.registration, ac.type || ac.icao_type, ac.registered_owner, ac.manufacturer]
          .filter(Boolean).map((part) => X.esc(part)).join(' · ')
        + `</div>`;
    }

    item.extra = [item.routeLine, item.aircraftLine].filter(Boolean).join('');
    return !!(item.routeLine || item.aircraftLine);
  }

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
  // Tried in order. The first two are the ones observed to send an
  // Access-Control-Allow-Origin header on a POST, which a browser requires; the
  // third is a further fallback for when both are saturated, as they often are.
  const OVERPASS_ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.osm.ch/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
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

  /* ================================= BMTC ================================= */

  /**
   * Bengaluru's buses: routes, their shape on the ground, and their stops in
   * order.
   *
   * The source is OpenStreetMap, where 859 BMTC routes are mapped as relations —
   * reachable from a page, unlike BMTC's own API, which refuses connections from
   * here and sends no CORS header, so live vehicle positions are not available to
   * a browser at all. The layer says that rather than implying the buses will
   * appear.
   *
   * What OSM does carry: the route number, its two ends, the path it takes, and
   * every stop along it in sequence. What it does not: a timetable. Nothing here
   * invents one.
   */
  /**
   * Stops near a point, with the routes that serve each one.
   *
   * `rel(bn)` walks from the stop nodes back up to the route relations that
   * contain them, which is how a stop learns its own route list — the
   * relationship exists in OSM, it just has to be asked for in that direction.
   */
  const bmtcStopsQuery = (lat, lng, radiusM) => `[out:json][timeout:25];
    node(around:${Math.round(radiusM)},${lat.toFixed(5)},${lng.toFixed(5)})["highway"="bus_stop"];
    out meta 150;`;

  /**
   * Which routes serve one stop.
   *
   * Asked per stop, not for all of them at once: walking from every stop in a
   * city back up to its route relations is the query that gets Overpass to say
   * "busy", and it is wasted work for stops nobody opens.
   */
  const bmtcRoutesAtStop = (nodeId) => `[out:json][timeout:20];
    rel(bn:${nodeId})["route"="bus"];
    out tags 60;`;

  const bmtcQuery = (ref, box) => {
    const filter = ref
      ? `["ref"~"^${ref.replace(/[^\w-]/g, '')}",i]`
      : '';
    // Geometry is expensive on a shared service, so it is only asked for when a
    // route number narrows the answer. Without one, list what is here by name.
    return ref
      ? `[out:json][timeout:60];
         relation["route"="bus"]["operator"~"BMTC",i]${filter}(${box});
         out meta geom 6;`
      : `[out:json][timeout:30];
         relation["route"="bus"]["operator"~"BMTC",i](${box});
         out tags 40;`;
  };

  /** A relation's member ways, joined into the lines the bus actually drives. */
  function routeShape(rel) {
    const lines = [];
    for (const member of rel.members || []) {
      if (member.type !== 'way' || !Array.isArray(member.geometry)) continue;
      const points = member.geometry.filter(Boolean).map((g) => [g.lat, g.lon]);
      if (points.length > 1) lines.push(points);
    }
    return lines;
  }

  /** Stops in the order the relation lists them, which is the order they are served. */
  function routeStops(rel) {
    return (rel.members || [])
      .filter((m) => m.type === 'node' && Number.isFinite(m.lat) && Number.isFinite(m.lon)
        && /stop|platform/i.test(m.role || ''))
      .map((m, i) => ({ seq: i + 1, lat: m.lat, lng: m.lon, ref: m.ref }));
  }

  /**
   * Travel time from your location to a point, by each way of getting there.
   *
   * The same router the simulation uses, so a walk here and a walk there agree.
   * Asked for only when wanted — three routing calls per stop is not something to
   * do for every stop on screen.
   */
  const etaCache = new Map();
  async function travelTimes(from, to) {
    const key = `${from.lat.toFixed(4)},${from.lng.toFixed(4)}>${to.lat.toFixed(4)},${to.lng.toFixed(4)}`;
    if (etaCache.has(key)) return etaCache.get(key);
    const modes = [['foot', 'walk'], ['cycling', 'cycle'], ['driving', 'drive']];
    const out = {};
    for (const [profile, label] of modes) {
      try {
        const r = await X.route([from, to], profile, 15000);
        // The public router only hosts the car profile, so cap the pace the way
        // the simulation does rather than reporting a 60 km/h walk.
        const cap = profile === 'foot' ? 1.4 : profile === 'cycling' ? 5.5 : Infinity;
        const seconds = Math.max(r.duration, r.distance / cap);
        out[label] = { seconds, metres: r.distance };
      } catch (_) {
        out[label] = null;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    etaCache.set(key, out);
    return out;
  }

  live.register({
    id: 'bmtc',
    label: 'BMTC buses',
    emoji: '🚌',
    hint: 'Bengaluru bus stops and routes from OpenStreetMap. Type a route number to draw it; '
      + 'stops near you are listed with walking, cycling and driving time.',
    attribution: '&copy; OpenStreetMap contributors',
    needsBounds: true,
    every: 900,
    query: { label: 'BMTC route number', placeholder: 'route number, e.g. 500 — or leave empty for stops near you' },

    async load(ctx) {
      return ctx.query ? loadRoutes(ctx) : loadStops(ctx);
    },
    enrich: (item) => enrichStop(item),

    draw(items, ctx) {
      for (const item of items) {
        if (item.kind === 'route') drawRoute(item, ctx);
        else drawStop(item, ctx);
      }
    },

    alert: {
      label: 'I am near a bus stop',
      defaults: { maxKm: 0.4 },
      fields: [{ key: 'maxKm', label: 'within km', min: 0.1, max: 3, step: 0.1 }],
      test: (item, ctx) => {
        if (item.kind !== 'stop') return null;
        const d = kmToHome(item);
        return d !== null && d <= ctx.settings.maxKm
          ? `${Math.round(d * 1000)} m away${item.routes.length ? `, routes ${item.routes.slice(0, 4).join(', ')}` : ''}`
          : null;
      },
    },
  });

  /* ------------------------------ stops near me ------------------------------ */

  /** Stops around your location, each knowing which routes serve it. */
  async function loadStops(ctx) {
    const at = ctx.home || map.getCenter();
    const radius = Math.min(4000, Math.max(400, ctx.radiusKm * 1000));
    const els = await overpass(bmtcStopsQuery(at.lat, at.lng, radius));

    const items = els.filter((e) => e.type === 'node' && Number.isFinite(e.lat)).map((n) => {
      const t = n.tags || {};
      const routes = [];
      const distance = ctx.home ? Mx.haversine(ctx.home, { lat: n.lat, lng: n.lon }) : null;
      return {
        id: `stop${n.id}`, kind: 'stop',
        label: t.name || 'Bus stop',
        lat: n.lat, lng: n.lon, glyph: '🚏',
        routes,
        nodeId: n.id,
        distance,
        mappedAt: n.timestamp || null,
        detail: X.kv([
          ['from you', distance === null ? null : X.dist(distance)],
        ]) + (routes.length ? `<div class="smx-meta">${X.esc(routes.slice(0, 12).join(' · '))}`
          + `${routes.length > 12 ? ` +${routes.length - 12}` : ''}</div>` : '')
          + (n.timestamp ? `<div class="smx-meta">mapped ${new Date(n.timestamp).toLocaleDateString()}</div>` : '')
          + '<div class="smx-meta">Tap “times” for walking, cycling and driving time from you.</div>',
      };
    }).sort((a, b) => (a.distance === null ? 1 : a.distance) - (b.distance === null ? 1 : b.distance));

    return {
      items,
      note: `${items.length} stops within ${X.dist(radius)} · open one for its routes`,
    };
  }

  /** The routes at a stop, fetched the moment someone looks at it. */
  async function enrichStop(item) {
    if (item.kind !== 'stop' || item.enriched) return false;
    item.enriched = true;
    try {
      const els = await overpass(bmtcRoutesAtStop(item.nodeId));
      item.routes = [...new Set(els.map((r) => (r.tags || {}).ref).filter(Boolean))].sort();
    } catch (_) {
      item.routes = [];
      item.enriched = false;                   // let a later look try again
      return false;
    }
    item.extra = item.routes.length
      ? `<div class="smx-meta">routes ${X.esc(item.routes.slice(0, 14).join(' · '))}`
        + `${item.routes.length > 14 ? ` +${item.routes.length - 14}` : ''}</div>`
      : '<div class="smx-meta">no bus route in OSM lists this stop</div>';
    return true;
  }

  function drawStop(item, ctx) {
    L.circleMarker([item.lat, item.lng], {
      pane: live.pane, radius: 4, color: BUS_COLOR, weight: 1.6,
      fillColor: '#0b0f14', fillOpacity: 0.85,
    })
      .bindPopup(() => `<b>🚏 ${X.esc(item.label)}</b><div>${item.detail}</div>`
        + `<div style="margin-top:6px"><button class="btn" data-bmtc-eta="${X.esc(item.id)}">times from me</button>`
        + ` <button class="btn" data-smx-track="bmtc|${X.esc(item.id)}">Track</button></div>`)
      .bindTooltip(`${X.esc(item.label)}${item.distance !== null ? ` · ${X.dist(item.distance)}` : ''}`,
        { direction: 'top' })
      .addTo(ctx.group);
  }

  /* ------------------------------ a whole route ------------------------------ */

  async function loadRoutes(ctx) {
    const box = bbox(ctx.bounds);
    const els = await overpass(bmtcQuery(ctx.query, box));
    const routes = els.filter((e) => e.type === 'relation');
    if (!routes.length) {
      return { items: [], note: `no BMTC route matching "${X.esc(ctx.query)}" mapped in this view` };
    }

    const items = routes.map((rel) => {
      const t = rel.tags || {};
      const shape = routeShape(rel);
      const stops = routeStops(rel);
      const metres = shape.reduce((sum, line) => sum
        + (Mx.cumulative(line.map(([lat, lng]) => ({ lat, lng }))).pop() || 0), 0);
      const first = (shape[0] && shape[0][0]) || (stops[0] && [stops[0].lat, stops[0].lng]);
      return {
        id: `bmtc${rel.id}`, kind: 'route',
        label: `${t.ref || 'route'} · ${t.from || '?'} → ${t.to || '?'}`,
        lat: first ? first[0] : null,
        lng: first ? first[1] : null,
        glyph: '🚌',
        ref: t.ref || null,
        shape, stops,
        mappedAt: rel.timestamp || null,
        detail: X.kv([
          ['route', X.esc(t.ref || '—')],
          ['stops', stops.length || null],
          ['length', metres > 0 ? X.dist(metres) : null],
        ])
          + (t.from || t.to ? `<div class="smx-route"><span class="code">${X.esc(t.from || '?')}</span>`
            + `<span class="arrow">→</span><span class="code">${X.esc(t.to || '?')}</span></div>` : '')
          + `<div class="smx-meta">${X.esc(t.name || '')}</div>`
          + `<div class="smx-meta">OSM relation ${rel.id}`
          + `${rel.timestamp ? ` · mapped ${new Date(rel.timestamp).toLocaleDateString()}` : ''}`
          + ' · this source carries no timetable</div>',
      };
    });

    return {
      items,
      note: `${items.length} route${items.length > 1 ? 's' : ''}, `
        + `${items.reduce((n, i) => n + i.stops.length, 0)} stops`,
    };
  }

  function drawRoute(item, ctx) {
    for (const line of item.shape) {
      L.polyline(line, {
        pane: live.rasterPane, color: BUS_COLOR, weight: 4, opacity: 0.85, interactive: true,
      }).bindTooltip(`🚌 ${X.esc(item.label)}`, { sticky: true }).addTo(ctx.group);
    }
    for (const stop of item.stops) {
      L.circleMarker([stop.lat, stop.lng], {
        pane: live.pane, radius: 3.2, color: BUS_COLOR, weight: 1.2,
        fillColor: '#0b0f14', fillOpacity: 0.9,
      }).bindTooltip(`${stop.seq}. stop — ${X.esc(item.ref || '')}`, { direction: 'top' }).addTo(ctx.group);
    }
    if (Number.isFinite(item.lat)) {
      L.marker([item.lat, item.lng], {
        pane: live.pane,
        icon: L.divIcon({ className: 'smx-live-dot smx-bus', iconSize: [22, 22], iconAnchor: [11, 11],
          html: '<span class="glyph">🚌</span>' }),
      }).bindPopup(`<b>🚌 ${X.esc(item.label)}</b><div>${item.detail}</div>`).addTo(ctx.group);
    }
  }

  /* --------------------------- times from your place --------------------------- */

  /**
   * "How long to reach it" answered per mode, in the popup that asked.
   *
   * Delegated so the popup stays cheap to open: nothing is routed until the
   * button is pressed, and the answer is cached per stop.
   */
  document.addEventListener('click', async (e) => {
    const btn = e.target && e.target.closest && e.target.closest('[data-bmtc-eta]');
    if (!btn) return;
    const st = live.layerState('bmtc');
    const item = st && st.items.find((i) => i.id === btn.dataset.bmtcEta);
    const from = live.observerPoint();
    if (!item) return;
    if (!from) { btn.outerHTML = '<div class="smx-meta">Set your location first.</div>'; return; }

    btn.disabled = true;
    btn.textContent = 'routing…';
    const times = await travelTimes(from, { lat: item.lat, lng: item.lng });
    const cells = [
      ['walk', times.walk], ['cycle', times.cycle], ['drive', times.drive],
    ].map(([label, t]) => [label, t ? `${Mx.dur(t.seconds)}` : '—']);
    item.travel = times;
    btn.outerHTML = X.kv(cells)
      + `<div class="smx-meta">${times.walk ? X.dist(times.walk.metres) : ''} by road`
      + ` · straight line ${X.dist(Mx.haversine(from, item))}</div>`;
  });

  /* ------------------------------ live positions ------------------------------ */

  /**
   * Where live buses would come from, if there were anywhere to get them.
   *
   * BMTC's own endpoints refuse browser requests and send no CORS header, and
   * there is no open GTFS-Realtime feed for the city, so this is a socket with
   * nothing plugged into it: paste a URL returning
   * `[{ id, lat, lng, route, at }]` and the layer will draw and track them. Until
   * then it says so, which is better than an empty map that looks broken.
   */
  live.register({
    id: 'bmtc-live',
    label: 'BMTC live buses',
    emoji: '🛰️',
    hint: 'No open live feed exists for BMTC — their API blocks browsers. Paste a URL that '
      + 'returns [{id, lat, lng, route, at}] and this will draw and track them.',
    attribution: 'operator feed',
    every: 15,
    query: { label: 'live feed URL', placeholder: 'https://…/buses.json' },
    async load(ctx) {
      if (!ctx.query) {
        return { items: [], note: 'no feed configured — BMTC publishes none a browser may read' };
      }
      const data = await ctx.json(ctx.query, { timeout: 15000 });
      const rows = Array.isArray(data) ? data : (data.buses || data.vehicles || data.data || []);
      const items = rows.map((b, i) => {
        // coord(), not Number(): Number(null) is 0, which would put a bus with no
        // position off the coast of Africa. Same trap as the CPCB feed.
        const lat = coord(b.lat !== undefined ? b.lat : b.latitude, 90);
        const lng = coord(b.lng !== undefined ? b.lng : (b.lon !== undefined ? b.lon : b.longitude), 180);
        if (lat === null || lng === null) return null;
        const at = b.at || b.timestamp || b.time || null;
        return {
          id: String(b.id || b.vehicleId || b.vehicle_no || i), kind: 'bus',
          label: `${b.route || b.routeNo || 'bus'} ${b.id || ''}`.trim(),
          lat, lng, glyph: '🚌',
          heading: Number.isFinite(Number(b.heading)) ? Number(b.heading) : null,
          speed: Number.isFinite(Number(b.speed)) ? Number(b.speed) : null,
          fixAt: at ? new Date(at).valueOf() : Date.now(),
          detail: X.kv([
            ['route', X.esc(String(b.route || b.routeNo || '—'))],
            ['speed', Number.isFinite(Number(b.speed)) ? `${Math.round(Number(b.speed) * 3.6)} km/h` : null],
            ['fix', at ? new Date(at).toLocaleTimeString() : null],
          ]),
        };
      }).filter(Boolean);
      return { items, note: `${items.length} buses from your feed` };
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
    visibility: { needsDarkness: false, needsSunlight: false, minElevation: 0, maxRange: 60000 },
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

  /* ============================= active fires ============================= */

  live.register({
    id: 'fires',
    label: 'Active fires',
    emoji: '🔥',
    hint: 'NASA GIBS VIIRS thermal anomalies — today, about three hours behind the satellite',
    attribution: '<a href="https://earthdata.nasa.gov">NASA GIBS</a> / VIIRS',
    every: 1800,
    raster: () => tiles(
      'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_Thermal_Anomalies_375m_All/default/'
      + `${isoDay(0)}/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`,
      {
        // Level8 is the deepest matrix this layer publishes; beyond it the tiles
        // are upscaled rather than requested and refused.
        pane: live.rasterPane, maxZoom: 19, maxNativeZoom: 8, opacity: 0.9,
        attribution: '<a href="https://earthdata.nasa.gov">NASA GIBS</a>',
      },
    ),
    async load() {
      return {
        items: [],
        note: `${isoDay(0)} · detections, not points — per-fire detail needs a free FIRMS key`,
      };
    },
  });

  /* ========================== air quality (India) ========================== */

  // CPCB publishes one row per pollutant per station, so a station's full
  // picture has to be assembled from several rows.
  const CPCB_RESOURCE = '3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69';

  /**
   * PM2.5 bands from CPCB's own national AQI breakpoints, in µg/m³:
   * good, satisfactory, moderate, poor, very poor and severe. Five colours from
   * the severity ramp cover six bands, so the last two share the darkest.
   */
  const PM25_BANDS = [30, 60, 90, 120, 250];
  const pm25Band = (v) => {
    for (let i = 0; i < PM25_BANDS.length; i++) if (v <= PM25_BANDS[i]) return i;
    return PM25_BANDS.length - 1;
  };
  const PM25_WORDS = ['good', 'satisfactory', 'moderate', 'poor', 'very poor'];

  /** A coordinate, or null for the blanks and rubbish the feed contains. */
  function coord(value, limit) {
    const text = String(value === undefined || value === null ? '' : value).trim();
    if (!text) return null;
    const n = Number(text);
    return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
  }

  /** "12-08-2026 14:00:00" — CPCB's own order, day first. */
  function cpcbTime(text) {
    const m = /^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})/.exec(String(text || ''));
    if (!m) return null;
    return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4]), Number(m[5]));
  }

  live.register({
    id: 'cpcb-aqi',
    label: 'Air quality (India)',
    emoji: '💨',
    hint: 'CPCB continuous monitoring stations, through data.gov.in',
    attribution: 'CPCB via <a href="https://data.gov.in">data.gov.in</a>',
    every: 900,                       // the stations themselves report hourly
    needsKey: {
      id: 'datagovin',
      label: 'data.gov.in API key',
      hint: 'Register free at data.gov.in and paste the key here. The shared sample key '
        + 'everyone uses is permanently rate-limited, so it cannot be the default.',
    },
    async load(ctx) {
      const PAGE = 1000;
      const rows = [];
      // Roughly 3,600 rows nationally; four pages covers it with room to spare.
      for (let page = 0; page < 4; page++) {
        const url = `https://api.data.gov.in/resource/${CPCB_RESOURCE}`
          + `?api-key=${encodeURIComponent(ctx.key)}&format=json&limit=${PAGE}&offset=${page * PAGE}`;
        const data = await ctx.json(url, { timeout: 25000 });
        if (data && data.error) throw new Error(String(data.error));
        const batch = (data && data.records) || [];
        rows.push(...batch);
        if (batch.length < PAGE) break;
      }
      if (!rows.length) throw new Error('no records returned');

      // One item per station, carrying every pollutant that station reported.
      const stations = new Map();
      for (const r of rows) {
        const lat = coord(r.latitude, 90), lng = coord(r.longitude, 180);
        // Not Number() alone: the feed ships stations with blank coordinates, and
        // Number('') is 0 — which would plot them in the Gulf of Guinea.
        if (lat === null || lng === null || (lat === 0 && lng === 0)) continue;
        const id = `${r.station}|${lat.toFixed(4)},${lng.toFixed(4)}`;
        let station = stations.get(id);
        if (!station) {
          station = {
            id,
            label: r.station || r.city || 'Station',
            lat, lng, glyph: '💨',
            city: r.city, state: r.state,
            at: cpcbTime(r.last_update),
            pollutants: {},
          };
          stations.set(id, station);
        }
        const value = Number(r.avg_value);
        if (r.pollutant_id && Number.isFinite(value)) station.pollutants[String(r.pollutant_id).toUpperCase()] = value;
      }

      const items = [...stations.values()].map((st) => {
        const pm25 = st.pollutants.PM2_5 !== undefined ? st.pollutants.PM2_5 : st.pollutants['PM2.5'];
        const worst = Number.isFinite(pm25) ? pm25 : st.pollutants.PM10;
        const band = Number.isFinite(worst) ? pm25Band(worst) : null;
        const listed = Object.entries(st.pollutants)
          .map(([k, v]) => `${X.esc(k.replace('PM2_5', 'PM2.5'))} ${v}`).join(' · ');
        return Object.assign(st, {
          pm25: Number.isFinite(pm25) ? pm25 : null,
          worst: Number.isFinite(worst) ? worst : null,
          band,
          detail: `${X.esc([st.city, st.state].filter(Boolean).join(', '))}`
            + `${band !== null ? `<br><b>${PM25_WORDS[band]}</b> — ${Number.isFinite(pm25) ? 'PM2.5' : 'PM10'} ${Math.round(worst)} µg/m³` : ''}`
            + `${listed ? `<br>${listed} µg/m³` : ''}`
            + `${st.at ? `<br>reported ${st.at.toLocaleTimeString()}` : ''}`,
        });
      });

      const withPm = items.filter((i) => i.worst !== null);
      const dirtiest = withPm.sort((a, b) => b.worst - a.worst)[0];
      return {
        items,
        note: `${items.length} stations${dirtiest ? ` · worst ${dirtiest.city || dirtiest.label} ${Math.round(dirtiest.worst)} µg/m³` : ''}`,
      };
    },
    draw(items, ctx) {
      // Air quality is a severity reading, so it takes the shared severity ramp.
      for (const item of items) {
        L.circleMarker([item.lat, item.lng], {
          pane: live.pane,
          radius: item.band === null ? 4 : 5 + item.band * 1.6,
          color: item.band === null ? 'var(--text-dim)' : X.SEVERITY[item.band],
          weight: 1.4,
          fillColor: item.band === null ? '#64748b' : X.SEVERITY[item.band],
          fillOpacity: 0.4,
        })
          .bindPopup(`<b>💨 ${X.esc(item.label)}</b><div>${item.detail}</div>`)
          .addTo(ctx.group);
      }
    },
    alert: {
      label: 'unhealthy air near me',
      defaults: { minPm25: 90, maxKm: 30 },
      fields: [
        { key: 'minPm25', label: 'PM2.5 ≥ µg/m³', min: 30, max: 300, step: 10 },
        { key: 'maxKm', label: 'within km', min: 2, max: 200, step: 2 },
      ],
      test: (item, ctx) => {
        if (!Number.isFinite(item.worst)) return null;
        const d = kmToHome(item);
        if (d === null || d > ctx.settings.maxKm || item.worst < ctx.settings.minPm25) return null;
        return `${PM25_WORDS[item.band]} air, ${Math.round(item.worst)} µg/m³, ${d.toFixed(0)} km away`;
      },
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
