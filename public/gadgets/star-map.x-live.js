/* ==========================================================================
   star-map.x-live.js — the Live tab: many data layers on one map, a location
   of your own, proximity alerts and object tracking.

   This file is the framework only; the layers themselves are declared in
   star-map.x-layers.js and register through SMX.live.register(). Splitting them
   keeps "how a layer works" in one place and "which layers exist" in another.

   A layer is a plain object:

     {
       id, label, emoji,           identity and the checkbox row
       hint,                       one line naming the source, shown under it
       attribution,                added to the map's attribution control
       every,                      auto-refresh seconds; 0 = load once
       needsBounds,                refetch when the map is panned
       minZoom,                    do not load below this zoom (declutter)
       needsHome,                  disabled until a location is set
       raster,                     () => L.tileLayer — for imagery layers
       load(ctx),                  async; returns { items, note }
       draw(items, ctx),           puts things on ctx.group
       alert                       { label, defaults, test(item, ctx) }
     }

   `items` are normalised to { id, lat, lng, label, detail, kind, extra } so the
   alert engine, the object list and tracking work the same for every layer
   without knowing what it is looking at.
   ========================================================================== */
'use strict';

(function () {
  const X = window.SMX, Mx = X.Mx;
  const STORE_KEY = 'smx.live';

  const live = {
    layers: [],                 // registered definitions, in display order
    state: {},                  // id -> { on, group, items, note, error, at, busy, timer, raster, alert }
    home: null,                 // { lat, lng, label }
    homeMarker: null,
    homeCircle: null,
    radiusKm: 250,
    autoRefresh: true,
    alerts: [],                 // newest first
    alerted: new Set(),         // dedupe key per fired alert
    tracks: new Map(),          // key -> track record; several at once
    followKey: null,            // camera follow is opt-in, per track, never automatic
    replay: {
      on: false, t: 0, from: 0, to: 0, playing: false, rate: 60, frame: null, last: 0,
    },
    eyeHeight: 1.7,             // observer height, for horizon and look angles
    gpsLines: true,             // draw a line from a live GPS fix to each tracked object
    gpsLayer: null,             // those lines, plus the area they span
    coverage: null,
    muted: false,
  };

  const TRACK_STORE = 'smx.tracks';
  const TRACK_COLORS = ['#ec4899', '#f472b6', '#c026d3', '#e879f9', '#db2777'];
  const MAX_POINTS = 1200;      // per track, about an hour of 3 s satellite fixes
  const MIN_POINT_GAP_MS = 2000;

  /* ------------------------------ panes ------------------------------ */

  const pane = map.createPane('smx-live');
  pane.style.zIndex = '608';
  const rasterPane = map.createPane('smx-live-raster');
  rasterPane.style.zIndex = '392';
  rasterPane.style.pointerEvents = 'none';

  /* ------------------------------ helpers ------------------------------ */

  const km = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 100000 ? 1 : 0)} km`);
  const ago = (ms) => {
    if (!ms) return 'never';
    const s = Math.round((Date.now() - ms) / 1000);
    return s < 5 ? 'just now' : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
  };

  /** Current map bounds, padded, as the [S,W,N,E] most APIs want. */
  const boundsBox = () => {
    const b = map.getBounds().pad(0.15);
    return { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() };
  };

  const distanceToHome = (item) => {
    const from = observerPoint();
    return from && Number.isFinite(item.lat) ? Mx.haversine(from, item) : null;
  };

  /**
   * Where "I" am. A live GPS fix wins over the saved location, because if the
   * app is tracking your position that is the truer answer — and it is what the
   * GPS lines and the covered area are drawn from.
   */
  function observerPoint() {
    if (gpsFix()) return gpsFix();
    return live.home;
  }

  /** The app's own GPS fix, when it has one. */
  function gpsFix() {
    if (typeof S === 'undefined' || !S.gpsOn || !S.lastFix) return null;
    const f = S.lastFix;
    const lat = f.lat !== undefined ? f.lat : (f.latlng && f.latlng.lat);
    const lng = f.lng !== undefined ? f.lng : (f.latlng && f.latlng.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng, label: 'GPS', accuracy: f.accuracy, live: true };
  }

  /**
   * A dot for anything on a live layer. Emoji rather than drawn icons: each
   * layer already has one in its checkbox row, so the map and the panel read as
   * the same list, and it costs no extra asset.
   */
  function liveIcon(layer, item, tracked) {
    const rot = Number.isFinite(item.heading) ? `transform:rotate(${item.heading}deg)` : '';
    return L.divIcon({
      className: `smx-live-dot${tracked ? ' tracked' : ''}`,
      iconSize: [22, 22], iconAnchor: [11, 11],
      html: `<span class="glyph" style="${rot}">${item.glyph || layer.emoji}</span>`,
    });
  }

  /* ------------------------------ location ------------------------------ */

  function setHome(latlng, label) {
    live.home = { lat: latlng.lat, lng: latlng.lng, label: label || 'My location' };
    drawHome();
    save();
    renderPanel();
    // Home-dependent layers can only load once there is a home.
    live.layers.forEach((l) => { if (l.needsHome && live.state[l.id].on) refresh(l.id); });
    evaluateAlerts();
  }

  function drawHome() {
    if (!live.home) return;
    const at = [live.home.lat, live.home.lng];
    if (!live.homeMarker) {
      live.homeMarker = L.marker(at, {
        pane: 'smx-live', zIndexOffset: 900,
        icon: L.divIcon({ className: 'smx-home', iconSize: [26, 26], iconAnchor: [13, 13], html: '<span>◉</span>' }),
      }).addTo(map).bindTooltip(() => `${X.esc(live.home.label)}<br>${live.home.lat.toFixed(4)}, ${live.home.lng.toFixed(4)}`);
      live.homeCircle = L.circle(at, {
        pane: 'smx-live-raster', radius: live.radiusKm * 1000,
        color: X.ANNOTATION, weight: 1.5, dashArray: '6 6', fillColor: X.ANNOTATION, fillOpacity: 0.05,
      }).addTo(map);
    } else {
      live.homeMarker.setLatLng(at);
      live.homeCircle.setLatLng(at).setRadius(live.radiusKm * 1000);
    }
  }

  function useGps() {
    if (!navigator.geolocation) { X.notify('This build has no geolocation.', 'err'); return; }
    X.notify('Asking for your position…', 'info', 2000);
    navigator.geolocation.getCurrentPosition(
      (pos) => setHome({ lat: pos.coords.latitude, lng: pos.coords.longitude }, 'GPS fix'),
      (err) => X.notify(`Geolocation failed: ${err.message}. Set a location by alt-clicking the map instead.`, 'err', 5000),
      { enableHighAccuracy: true, timeout: 12000 },
    );
  }

  /* ------------------------------ registry ------------------------------ */

  function register(layer) {
    live.layers.push(layer);
    live.state[layer.id] = {
      on: false, group: L.layerGroup([], { pane: 'smx-live' }), items: [], note: '',
      markers: new Map(),        // item id -> marker, kept across refreshes
      error: null, at: 0, busy: false, timer: null, raster: null,
      alert: Object.assign({ on: false }, (layer.alert && layer.alert.defaults) || {}),
    };
    return layer;
  }

  async function setLayer(id, on) {
    const layer = live.layers.find((l) => l.id === id);
    const st = live.state[id];
    if (!layer || !st || st.on === on) return;
    st.on = on;
    if (on) {
      if (layer.raster) {
        st.raster = layer.raster();
        if (st.raster) st.raster.addTo(map);
      }
      st.group.addTo(map);
      await refresh(id);
      schedule(id);
    } else {
      clearTimeout(st.timer);
      st.timer = null;
      st.group.clearLayers().remove();
      st.markers.clear();
      if (st.raster) { st.raster.remove(); st.raster = null; }
      st.items = [];
      for (const track of [...live.tracks.values()]) {
        if (track.layerId === id) stopTracking(track.key);
      }
    }
    save();
    renderPanel();
  }

  function schedule(id) {
    const layer = live.layers.find((l) => l.id === id);
    const st = live.state[id];
    clearTimeout(st.timer);
    st.timer = null;
    if (!st.on || !layer.every || !live.autoRefresh) return;
    st.timer = setTimeout(() => refresh(id).then(() => schedule(id)), layer.every * 1000);
  }

  /** Load one layer, draw it, and run its alert rule over the result. */
  async function refresh(id) {
    const layer = live.layers.find((l) => l.id === id);
    const st = live.state[id];
    if (!layer || !st || !st.on || st.busy) return;
    if (layer.needsHome && !live.home) {
      st.error = 'needs a location';
      renderPanel();
      return;
    }
    // Some layers are only meaningful close in: a city's worth of bus stops at
    // country zoom is one illegible blob, and a pointless request for it.
    if (layer.minZoom && map.getZoom() < layer.minZoom) {
      st.items = [];
      st.group.clearLayers();
      st.note = `zoom in to level ${layer.minZoom} to load`;
      st.at = Date.now();
      renderPanel();
      return;
    }
    st.busy = true;
    st.error = null;
    renderPanel();
    try {
      const ctx = context(layer);
      const out = (await layer.load(ctx)) || {};
      st.items = out.items || [];
      st.note = out.note || '';
      st.at = Date.now();
      // Only a layer with its own draw gets a clean slate. The default draw
      // reconciles instead: a marker that is still there is moved, not rebuilt,
      // so an open popup survives a refresh — which is the difference between
      // being able to press Track and watching it vanish under the pointer.
      if (layer.draw) {
        st.group.clearLayers();
        st.markers.clear();
        layer.draw(st.items, ctx);
      } else {
        defaultDraw(st.items, ctx);
      }
      evaluateAlerts(id);
      for (const track of live.tracks.values()) {
        if (track.layerId === id) updateTrack(track);
      }
      drawGpsLines();
      renderTrackedReadout();
    } catch (err) {
      st.error = err && err.message ? err.message : String(err);
    } finally {
      st.busy = false;
      renderPanel();
    }
  }

  const refreshAll = () => Promise.all(live.layers.filter((l) => live.state[l.id].on).map((l) => refresh(l.id)));

  function context(layer) {
    const st = live.state[layer.id];
    return {
      layer, state: st, group: st.group, map, home: live.home,
      radiusKm: live.radiusKm, bounds: boundsBox(), json: X.json,
      icon: (item, tracked) => liveIcon(layer, item, tracked),
      isTracked: (item) => isTracking(layer.id, item.id),
      onClick: (item) => (e) => { if (e && e.target && e.target.openPopup) e.target.openPopup(); select(layer.id, item.id); },
    };
  }

  /**
   * A marker per item, reused between refreshes.
   *
   * Markers are kept in a map by item id: one that is still in the data moves,
   * one that has gone is removed, and only genuinely new ones are created. An
   * open popup therefore stays open across a refresh — with satellites
   * refreshing every five seconds, rebuilding them made the popup impossible to
   * click.
   */
  function defaultDraw(items, ctx) {
    const state = ctx.state;
    const seen = new Set();
    for (const item of items) {
      if (!Number.isFinite(item.lat) || !Number.isFinite(item.lng)) continue;
      const key = String(item.id);
      seen.add(key);
      let marker = state.markers.get(key);
      if (marker) {
        marker.setLatLng([item.lat, item.lng]);
        marker.setIcon(ctx.icon(item, ctx.isTracked(item)));
        marker.smxItem = item;                       // the popup reads the latest fix
        if (marker.isPopupOpen && marker.isPopupOpen()) {
          marker.setPopupContent(popupHtml(ctx.layer, item));
        }
        continue;
      }
      marker = L.marker([item.lat, item.lng], {
        pane: 'smx-live', icon: ctx.icon(item, ctx.isTracked(item)), riseOnHover: true,
      });
      marker.smxItem = item;
      marker.bindPopup(() => popupHtml(ctx.layer, marker.smxItem));
      marker.addTo(ctx.group);
      state.markers.set(key, marker);
    }
    for (const [key, marker] of [...state.markers]) {
      if (seen.has(key)) continue;
      // Through the group, not marker.remove(): that only detaches it from the
      // map and leaves it in the group, so getLayers() keeps handing back
      // markers that are no longer anywhere.
      ctx.group.removeLayer(marker);
      state.markers.delete(key);
    }
  }

  /** Redraw one item's marker icon, e.g. when it starts or stops being tracked. */
  function refreshMarker(layerId, itemId) {
    const st = live.state[layerId];
    const layer = live.layers.find((l) => l.id === layerId);
    if (!st || !layer) return;
    const marker = st.markers.get(String(itemId));
    const item = st.items.find((i) => String(i.id) === String(itemId));
    if (marker && item) marker.setIcon(liveIcon(layer, item, isTracking(layerId, itemId)));
  }

  function popupHtml(layer, item) {
    const d = distanceToHome(item);
    return `<b>${layer.emoji} ${X.esc(item.label || item.id)}</b>
      ${item.detail ? `<div style="margin-top:4px">${item.detail}</div>` : ''}
      ${d !== null ? `<div style="margin-top:4px">${km(d)} from ${X.esc(live.home.label)}</div>` : ''}
      <div style="margin-top:6px;display:flex;gap:6px">
        <button class="btn" data-smx-track="${X.esc(layer.id)}|${X.esc(String(item.id))}">
          ${isTracking(layer.id, item.id) ? 'Stop tracking' : 'Track'}
        </button>
      </div>`;
  }

  /**
   * The Track button, handled by delegation.
   *
   * It used to be found with a selector built from the layer and item id — which
   * breaks the moment an id contains a space or a bracket, as every satellite
   * name does: the selector is invalid, so the button silently stayed unwired
   * and a stale one elsewhere in the document answered the click instead.
   * Reading the id back off the element cannot go wrong that way.
   */
  document.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest && e.target.closest('[data-smx-track]');
    if (!btn) return;
    e.preventDefault();
    const raw = btn.dataset.smxTrack || '';
    const split = raw.indexOf('|');
    if (split < 0) return;
    const layerId = raw.slice(0, split);
    const itemId = raw.slice(split + 1);
    if (isTracking(layerId, itemId)) stopTracking(trackKey(layerId, itemId));
    else startTracking(layerId, itemId);
    refreshMarker(layerId, itemId);
    map.closePopup();
  });

  /* ------------------------------ tracking ------------------------------ */

  const trackKey = (layerId, itemId) => `${layerId}:${itemId}`;

  /**
   * Start following an object. Several can be tracked at once; the camera
   * follows at most one of them, and following is optional — the map can stay
   * where you put it while the tracks keep updating.
   *
   * A track that was followed before keeps its saved history: the points are
   * stored with their timestamps, so closing the tool and coming back leaves the
   * trail intact rather than starting from a blank map.
   */
  function startTracking(layerId, itemId) {
    const key = trackKey(layerId, itemId);
    if (live.tracks.has(key)) return live.tracks.get(key);
    const layer = live.layers.find((l) => l.id === layerId);
    const item = (live.state[layerId] || { items: [] }).items.find((i) => String(i.id) === String(itemId));
    const color = TRACK_COLORS[live.tracks.size % TRACK_COLORS.length];

    const track = {
      key, layerId, itemId,
      label: (item && item.label) || String(itemId),
      emoji: (item && item.glyph) || (layer && layer.emoji) || '📍',
      color,
      points: (savedTracks[key] && savedTracks[key].points) || [],
      startedAt: (savedTracks[key] && savedTracks[key].startedAt) || Date.now(),
      // The line is the only thing permanently on the map. Everything else —
      // the sightline to your location, the footprint it can be seen from —
      // appears while the pointer is on the line, and leaves with it.
      trail: L.polyline([], {
        pane: 'smx-live', color, weight: 3, opacity: 0.95,
        interactive: true, bubblingMouseEvents: false,
      }).addTo(map),
      sightline: L.polyline([], {
        pane: 'smx-live-raster', color, weight: 1.5, opacity: 0.85, dashArray: '2 6', interactive: false,
      }),
      footprint: L.circle([0, 0], {
        pane: 'smx-live-raster', radius: 0, color, weight: 1, opacity: 0.5,
        fillColor: color, fillOpacity: 0.04, interactive: false,
      }),
      marks: L.layerGroup([], { pane: 'smx-live-raster' }),
      hovering: false,
      view: null,               // the geometry of the latest fix
      pass: null,               // when it can next be seen, if the layer knows
    };
    track.trail.setLatLngs(track.points.map((pt) => [pt.lat, pt.lng]));
    bindTrackHover(track);
    live.tracks.set(key, track);
    refreshMarker(layerId, itemId);
    X.notify(`Tracking ${track.label}. The map stays where it is — hover the line for its numbers.`, 'ok', 3000);
    updateTrack(track);
    drawGpsLines();
    renderPanel();
    return track;
  }

  /**
   * Hovering the line is how you read a track: the pointer picks the nearest
   * recorded fix, the tooltip gives its time and what was true then, and the
   * sightline and footprint appear for as long as you are looking.
   */
  function bindTrackHover(track) {
    const show = () => {
      track.hovering = true;
      if (observerPoint()) track.sightline.addTo(map);
      if (track.view && track.view.footprint > 0) track.footprint.addTo(map);
      track.marks.addTo(map);
      drawTimeMarks(track);
    };
    const hide = () => {
      track.hovering = false;
      track.sightline.remove();
      track.footprint.remove();
      track.marks.remove();
    };
    track.trail.on('mouseover', show);
    track.trail.on('mouseout', hide);
    track.trail.on('mousemove', (e) => {
      track.trail.setTooltipContent(hoverInfo(track, e.latlng));
    });
    track.trail.bindTooltip(() => hoverInfo(track, null), { sticky: true, direction: 'top' });
    track._hideHover = hide;
  }

  /** What was true at the recorded fix nearest the pointer. */
  function hoverInfo(track, latlng) {
    if (!track.points.length) return X.esc(track.label);
    let fix = track.points[track.points.length - 1];
    if (latlng) {
      let best = Infinity;
      for (const p of track.points) {
        const d = Mx.haversine(latlng, p);
        if (d < best) { best = d; fix = p; }
      }
    }
    const when = new Date(fix.t);
    return `<b>${track.emoji} ${X.esc(track.label)}</b>`
      + `<br>${when.toLocaleTimeString()} · ${fix.lat.toFixed(4)}, ${fix.lng.toFixed(4)}`
      + `${fix.alt !== null && fix.alt !== undefined ? `<br>${(fix.alt / 1000).toFixed(fix.alt > 10000 ? 0 : 1)} km up` : ''}`
      + `${fix.spd ? ` · ${Math.round(fix.spd * 3.6)} km/h` : ''}`
      + `${fix.rng ? `<br>${km(fix.rng)} from you, ${Mx.compass(fix.az)} at ${Math.round(fix.el)}°` : ''}`
      + `<br><small>${track.points.length} fixes · hover the line to read any moment</small>`;
  }

  /** Time labels along the recorded line: a map that reads like a timetable. */
  function drawTimeMarks(track) {
    track.marks.clearLayers();
    for (const mark of Mx.timeMarks(track.points, { count: 6 })) {
      L.marker([mark.lat, mark.lng], {
        pane: 'smx-live-raster', interactive: false,
        icon: L.divIcon({
          className: 'smx-timemark', iconSize: [46, 14], iconAnchor: [23, 7],
          html: `<span>${Mx.clock(secondsOfDay(mark.t))}</span>`,
        }),
      }).addTo(track.marks);
    }
  }

  function stopTracking(key) {
    if (key === undefined) {                       // stop all of them
      for (const k of [...live.tracks.keys()]) stopTracking(k);
      return;
    }
    const track = live.tracks.get(key);
    if (!track) return;
    // Keep what was recorded: stopping means "stop following", not "throw the
    // history away". Forgetting it is a separate, deliberate act.
    savedTracks[key] = {
      layerId: track.layerId, itemId: track.itemId, label: track.label,
      startedAt: track.startedAt, points: track.points,
    };
    track.trail.remove();
    track.sightline.remove();
    track.footprint.remove();
    track.marks.remove();
    if (track.ghost) track.ghost.remove();
    live.tracks.delete(key);
    refreshMarker(track.layerId, track.itemId);
    drawGpsLines();
    if (live.followKey === key) live.followKey = live.tracks.size ? [...live.tracks.keys()][0] : null;
    saveTracks();
    renderPanel();
  }

  const isTracking = (layerId, itemId) => live.tracks.has(trackKey(layerId, itemId));

  /** The current fix for a track, from whatever its layer last loaded. */
  const trackedItem = (track) => {
    const st = live.state[track.layerId];
    return st ? st.items.find((i) => String(i.id) === String(track.itemId)) || null : null;
  };

  /**
   * Bring one track up to date: append a timestamped point, redraw the trail,
   * the sightline to your location and the footprint, and work out whether it
   * can be seen and when.
   */
  function updateTrack(track) {
    const item = trackedItem(track);
    if (!item || !Number.isFinite(item.lat)) return;
    const now = Date.now();
    const at = [item.lat, item.lng];

    const from = observerPoint();
    const observer = from
      ? { lat: from.lat, lng: from.lng, altitude: live.eyeHeight }
      : null;
    const target = { lat: item.lat, lng: item.lng, altitude: item.altitude || 0 };
    const layer = live.layers.find((l) => l.id === track.layerId);

    let view = null;
    if (observer) {
      const look = Mx.lookAngles(observer, target);
      const sunEl = Mx.sunElevation(new Date(now), observer.lat, observer.lng);
      const sunlit = item.altitude ? Mx.isSunlit(target, new Date(now)) : sunEl > -6;
      const eye = Mx.nakedEye({
        elevation: look.elevation,
        sunElevation: sunEl,
        sunlit,
        needsDarkness: !!(layer && layer.visibility && layer.visibility.needsDarkness),
        needsSunlight: !!(layer && layer.visibility && layer.visibility.needsSunlight),
        range: look.range,
        maxRange: layer && layer.visibility ? layer.visibility.maxRange : undefined,
        minElevation: layer && layer.visibility ? layer.visibility.minElevation : 10,
      });
      view = {
        azimuth: look.azimuth, elevation: look.elevation, range: look.range,
        groundRange: look.groundRange, sunElevation: sunEl, sunlit,
        footprint: Mx.horizonRadius(item.altitude || 0),
        eye,
        approach: Mx.closestApproach(observer, {
          lat: item.lat, lng: item.lng, altitude: item.altitude || 0,
          speed: item.speed, heading: item.heading,
        }),
      };
      track.sightline.setLatLngs([[observer.lat, observer.lng], at]);
      track.footprint.setLatLng(at).setRadius(view.footprint);
    }
    track.view = view;

    const last = track.points[track.points.length - 1];
    if (!last || now - last.t >= MIN_POINT_GAP_MS) {
      track.points.push({
        t: now, lat: item.lat, lng: item.lng,
        alt: Number.isFinite(item.altitude) ? Math.round(item.altitude) : null,
        spd: Number.isFinite(item.speed) ? Math.round(item.speed) : null,
        az: view ? Math.round(view.azimuth) : null,
        el: view ? Math.round(view.elevation * 10) / 10 : null,
        rng: view ? Math.round(view.range) : null,
      });
      if (track.points.length > MAX_POINTS) track.points = track.points.slice(-MAX_POINTS);
      track.trail.addLatLng(at);
      const drawn = track.trail.getLatLngs();
      if (drawn.length > MAX_POINTS) track.trail.setLatLngs(drawn.slice(-MAX_POINTS));
      saveTracks();
    }

    // "When can I see it": the layer answers if it can do better than geometry.
    if (observer && layer && typeof layer.predictPass === 'function') {
      const stale = !track.pass || !track.pass.computedAt || now - track.pass.computedAt > 120000;
      if (stale) {
        try {
          track.pass = Object.assign({ computedAt: now }, layer.predictPass(item, observer) || {});
        } catch (_) {
          track.pass = null;
        }
      }
    }

    // The map only moves if this track was explicitly told to lead it.
    if (live.followKey === track.key) map.panTo(at, { animate: false });
    if (track.hovering) drawTimeMarks(track);
  }

  const updateTracks = () => {
    for (const track of live.tracks.values()) updateTrack(track);
    drawGpsLines();
    renderTrackedReadout();
  };

  /**
   * With a live GPS fix, every tracked object gets its own line back to where
   * you actually are, and the whole set gets an outline: the ground your GPS
   * position and everything you are following span between them, with its area.
   *
   * These are the one thing drawn without hovering, because they answer the
   * question you asked by turning GPS on — where am I in all this.
   */
  function drawGpsLines() {
    if (!live.gpsLayer) live.gpsLayer = L.layerGroup([], { pane: 'smx-live-raster' });
    live.gpsLayer.clearLayers();
    live.coverage = null;

    const from = gpsFix();
    if (!from || !live.gpsLines || !live.tracks.size) {
      live.gpsLayer.remove();
      return;
    }

    const heads = [];
    for (const track of live.tracks.values()) {
      const item = trackedItem(track);
      const at = live.replay.on ? Mx.sampleTrack(track.points, live.replay.t) : item;
      if (!at || !Number.isFinite(at.lat)) continue;
      heads.push({ lat: at.lat, lng: at.lng });
      L.polyline([[from.lat, from.lng], [at.lat, at.lng]], {
        pane: 'smx-live-raster', color: track.color, weight: 1.5, opacity: 0.7, dashArray: '1 5',
        interactive: true,
      })
        .bindTooltip(`${track.emoji} ${X.esc(track.label)}<br>${km(Mx.haversine(from, at))} from your GPS fix`,
          { sticky: true })
        .addTo(live.gpsLayer);
    }

    if (heads.length >= 2) {
      const ring = Mx.convexHull([from, ...heads]);
      if (ring.length >= 3) {
        const area = Mx.polygonArea(ring);
        live.coverage = { area, corners: ring.length, centre: Mx.centroid(ring) };
        L.polygon(ring.map((p) => [p.lat, p.lng]), {
          pane: 'smx-live-raster', color: X.ANNOTATION, weight: 1, opacity: 0.6,
          dashArray: '4 4', fillColor: X.ANNOTATION, fillOpacity: 0.06, interactive: true,
        })
          .bindTooltip(`Area you and your ${heads.length} tracked objects span`
            + `<br>${(area / 1e6).toLocaleString(undefined, { maximumFractionDigits: 0 })} km²`, { sticky: true })
          .addTo(live.gpsLayer);
      }
    }
    if (!map.hasLayer(live.gpsLayer)) live.gpsLayer.addTo(map);
  }

  /* -------------------------------- replay -------------------------------- */

  /**
   * Replay walks the recorded window instead of showing only the newest fix.
   * Every tracked object gets a ghost marker at where it was at the replay time,
   * and its line is clipped to what it had flown by then — so scrubbing back
   * unwinds the whole picture, not one object at a time.
   */
  function replayWindow() {
    let from = Infinity, to = -Infinity;
    for (const track of live.tracks.values()) {
      if (!track.points.length) continue;
      from = Math.min(from, track.points[0].t);
      to = Math.max(to, track.points[track.points.length - 1].t);
    }
    return Number.isFinite(from) ? { from, to } : null;
  }

  function setReplay(on) {
    const window = replayWindow();
    if (on && !window) { X.notify('Nothing recorded yet — track something for a while first.', 'warn'); return; }
    live.replay.on = !!on;
    if (on) {
      live.replay.from = window.from;
      live.replay.to = window.to;
      live.replay.t = Mx.clamp(live.replay.t || window.to, window.from, window.to);
      live.followKey = null;                      // a replay never drags the camera
      drawReplay();
    } else {
      pauseReplay();
      for (const track of live.tracks.values()) {
        if (track.ghost) { track.ghost.remove(); track.ghost = null; }
        track.trail.setLatLngs(track.points.map((p) => [p.lat, p.lng]));
      }
    }
    renderPanel();
  }

  function setReplayTime(t) {
    const window = replayWindow();
    if (!window) return;
    live.replay.from = window.from;
    live.replay.to = window.to;
    live.replay.t = Mx.clamp(t, window.from, window.to);
    drawReplay();
    drawGpsLines();
    renderTrackedReadout();
  }

  /** Put every track where it was at the replay time. */
  function drawReplay() {
    if (!live.replay.on) return;
    const t = live.replay.t;
    for (const track of live.tracks.values()) {
      const at = Mx.sampleTrack(track.points, t);
      if (!at) continue;
      track.trail.setLatLngs(Mx.trackUpTo(track.points, t).map((p) => [p.lat, p.lng]));
      if (!track.ghost) {
        track.ghost = L.marker([at.lat, at.lng], {
          pane: 'smx-live', zIndexOffset: 700,
          icon: L.divIcon({
            className: 'smx-live-dot replay', iconSize: [22, 22], iconAnchor: [11, 11],
            html: `<span class="glyph">${track.emoji}</span>`,
          }),
        }).addTo(map);
        track.ghost.bindTooltip(() => replayLabel(track), { direction: 'top' });
      } else {
        track.ghost.setLatLng([at.lat, at.lng]);
      }
      const from = observerPoint();
    if (from && track.hovering) track.sightline.setLatLngs([[from.lat, from.lng], [at.lat, at.lng]]);
    }
  }

  function replayLabel(track) {
    const at = Mx.sampleTrack(track.points, live.replay.t);
    if (!at) return X.esc(track.label);
    return `<b>${track.emoji} ${X.esc(track.label)}</b><br>${new Date(live.replay.t).toLocaleTimeString()}`
      + `${at.alt ? `<br>${(at.alt / 1000).toFixed(at.alt > 10000 ? 0 : 1)} km up` : ''}`
      + `${at.rng ? `<br>${km(at.rng)} from you` : ''}`
      + `${at.before || at.after ? '<br><small>outside the recording</small>' : ''}`;
  }

  function playReplay() {
    if (!live.replay.on || live.replay.playing) return;
    if (live.replay.t >= live.replay.to) live.replay.t = live.replay.from;
    live.replay.playing = true;
    live.replay.last = performance.now();
    const step = (now) => {
      if (!live.replay.playing) return;
      const dt = Mx.clamp((now - live.replay.last) / 1000, 0, 0.25);
      live.replay.last = now;
      live.replay.t += dt * live.replay.rate * 1000;
      if (live.replay.t >= live.replay.to) {
        live.replay.t = live.replay.to;
        pauseReplay();
      }
      drawReplay();
      renderReplayControls();
      if (live.replay.playing) live.replay.frame = requestAnimationFrame(step);
    };
    live.replay.frame = requestAnimationFrame(step);
    renderReplayControls();
  }

  function pauseReplay() {
    live.replay.playing = false;
    if (live.replay.frame) cancelAnimationFrame(live.replay.frame);
    live.replay.frame = null;
    renderReplayControls();
  }

  /* -------------------------- saved track history -------------------------- */

  let savedTracks = {};
  try {
    savedTracks = store.get(TRACK_STORE, {}) || {};
  } catch (_) {
    savedTracks = {};
  }

  function saveTracks() {
    // Start from what is already on disk so a stopped track's history survives.
    const out = Object.assign({}, savedTracks);
    for (const track of live.tracks.values()) {
      out[track.key] = {
        layerId: track.layerId, itemId: track.itemId, label: track.label,
        startedAt: track.startedAt, points: track.points,
      };
    }
    savedTracks = out;
    try {
      store.set(TRACK_STORE, out);
    } catch (_) {
      // Storage is finite; drop the oldest half rather than losing the newest.
      for (const track of live.tracks.values()) track.points = track.points.slice(-Math.floor(MAX_POINTS / 2));
      try { store.set(TRACK_STORE, out); } catch (__) { /* give up quietly */ }
    }
  }

  /** Restore any saved track whose layer is on again. */
  function restoreTracks() {
    for (const key of Object.keys(savedTracks)) {
      const rec = savedTracks[key];
      if (rec && live.state[rec.layerId] && live.state[rec.layerId].on) startTracking(rec.layerId, rec.itemId);
    }
  }

  /** Drop a saved history for good — the only thing that deletes recorded fixes. */
  function forgetTrack(key) {
    const track = live.tracks.get(key);
    if (track) {
      track.points = [];
      track.trail.setLatLngs([]);
      track.startedAt = Date.now();
    }
    delete savedTracks[key];
    try { store.set(TRACK_STORE, savedTracks); } catch (_) { /* best effort */ }
    renderPanel();
  }

  function forgetAllTracks() {
    savedTracks = {};
    for (const track of live.tracks.values()) {
      track.points = [];
      track.trail.setLatLngs([]);
      track.startedAt = Date.now();
    }
    try { store.set(TRACK_STORE, {}); } catch (_) { /* best effort */ }
    renderPanel();
  }

  const pad = (n) => String(n).padStart(2, '0');
  const stamp = (ms) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      + `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  /**
   * Export one track. GPX so it opens in anything that reads a track, CSV for a
   * spreadsheet, JSON for everything else — each keeps the timestamps, and the
   * look angles that were true at the time.
   */
  function exportTrack(key, format) {
    const track = live.tracks.get(key);
    if (!track || !track.points.length) { X.notify('Nothing recorded yet.', 'warn'); return; }
    const safe = track.label.replace(/[^\w.-]+/g, '_').slice(0, 40);
    const name = `starmap-track-${safe}-${stamp(track.startedAt).replace(/[:T]/g, '')}`;
    if (format === 'gpx') {
      const pts = track.points.map((p) => `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}">`
        + `${p.alt !== null ? `<ele>${p.alt}</ele>` : ''}`
        + `<time>${new Date(p.t).toISOString()}</time></trkpt>`).join('\n');
      download(`${name}.gpx`,
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        + '<gpx version="1.1" creator="DevHelper Map Lab" xmlns="http://www.topografix.com/GPX/1/1">\n'
        + `  <trk><name>${X.esc(track.label)}</name><trkseg>\n${pts}\n  </trkseg></trk>\n</gpx>\n`,
        'application/gpx+xml');
    } else if (format === 'csv') {
      const rows = ['time,lat,lon,altitude_m,speed_mps,azimuth_deg,elevation_deg,range_m']
        .concat(track.points.map((p) => [new Date(p.t).toISOString(), p.lat.toFixed(6), p.lng.toFixed(6),
          p.alt ?? '', p.spd ?? '', p.az ?? '', p.el ?? '', p.rng ?? ''].join(',')));
      download(`${name}.csv`, `${rows.join('\n')}\n`, 'text/csv');
    } else {
      download(`${name}.json`, JSON.stringify({
        label: track.label, layer: track.layerId, id: track.itemId,
        startedAt: new Date(track.startedAt).toISOString(),
        observer: live.home, points: track.points,
      }, null, 2), 'application/json');
    }
  }

  /* ------------------------------- alerts ------------------------------- */

  /**
   * Alerts are per layer and always answer the same question: has something
   * this layer cares about come within `radiusKm` of my location? A layer can
   * add its own condition on top (a magnitude floor, an altitude ceiling, a
   * time window) through `alert.test`.
   */
  function evaluateAlerts(onlyId) {
    if (!live.home) return;
    const layers = live.layers.filter((l) => l.alert && live.state[l.id].on && live.state[l.id].alert.on
      && (!onlyId || l.id === onlyId));
    for (const layer of layers) {
      const st = live.state[layer.id];
      for (const item of st.items) {
        const ctx = Object.assign(context(layer), { settings: st.alert, distance: distanceToHome(item) });
        let why = null;
        try {
          why = layer.alert.test(item, ctx);
        } catch (_) {
          why = null;
        }
        if (!why) continue;
        const key = `${layer.id}:${item.id}:${why}`;
        if (live.alerted.has(key)) continue;
        live.alerted.add(key);
        fire(layer, item, why);
      }
    }
    // Keep the dedupe set from growing without bound over a long session.
    if (live.alerted.size > 4000) live.alerted = new Set([...live.alerted].slice(-2000));
  }

  function fire(layer, item, why) {
    const alert = {
      at: Date.now(), layerId: layer.id, emoji: layer.emoji,
      label: item.label || String(item.id), why,
      lat: item.lat, lng: item.lng, itemId: item.id,
    };
    live.alerts.unshift(alert);
    live.alerts = live.alerts.slice(0, 40);
    if (!live.muted) X.notify(`${layer.emoji} ${alert.label} — ${why}`, 'warn', 5000);
    renderPanel();
  }

  /* ---------------------------- persistence ---------------------------- */

  function save() {
    try {
      store.set(STORE_KEY, {
        home: live.home, radiusKm: live.radiusKm, autoRefresh: live.autoRefresh, muted: live.muted,
        on: live.layers.filter((l) => live.state[l.id].on).map((l) => l.id),
        alerts: Object.fromEntries(live.layers.map((l) => [l.id, live.state[l.id].alert])),
      });
    } catch (_) { /* best effort */ }
  }

  function restore() {
    let saved = null;
    try { saved = store.get(STORE_KEY, null); } catch (_) { return; }
    if (!saved) return;
    live.radiusKm = saved.radiusKm || live.radiusKm;
    live.autoRefresh = saved.autoRefresh !== false;
    live.muted = !!saved.muted;
    for (const l of live.layers) {
      const a = saved.alerts && saved.alerts[l.id];
      if (a) Object.assign(live.state[l.id].alert, a);
    }
    if (saved.home) setHome(saved.home, saved.home.label);
    (saved.on || []).forEach((id) => { if (live.state[id]) setLayer(id, true); });
  }

  /* --------------------------------- UI --------------------------------- */

  let root = null;

  X.registerTab({
    id: 'live',
    label: 'Live',
    icon: 'satellite',
    title: 'Live layers, your location, proximity alerts and tracking',
    build(el) {
      root = el;
      el.innerHTML = `
        <h4>My location</h4>
        <div id="smxHome"></div>

        <h4>Layers <span class="smx-hint" id="smxLayerCount"></span></h4>
        <div class="smx-row">
          <label class="smx-lbl grow" for="smxAuto">Auto-refresh</label>
          <input type="checkbox" id="smxAuto" />
          <button class="smx-btn" id="smxRefreshAll" title="Refresh every layer that is on">${X.icon('rotate')}</button>
        </div>
        <div id="smxLayers"></div>

        <h4>Tracking</h4>
        <div id="smxTracked"></div>

        <h4>Replay</h4>
        <div id="smxReplay"></div>

        <h4>Alerts <span class="smx-hint" id="smxAlertCount"></span></h4>
        <div id="smxAlerts"></div>
      `;
      el.querySelector('#smxAuto').addEventListener('change', (e) => {
        live.autoRefresh = e.target.checked;
        live.layers.forEach((l) => schedule(l.id));
        save();
      });
      el.querySelector('#smxRefreshAll').addEventListener('click', refreshAll);

      X.on(el, '[data-layer]', 'change', (e, box) => setLayer(box.dataset.layer, box.checked));
      X.on(el, '[data-layer-refresh]', 'click', (_e, b) => refresh(b.dataset.layerRefresh));
      X.on(el, '[data-alert-on]', 'change', (e, box) => {
        live.state[box.dataset.alertOn].alert.on = box.checked;
        save();
        evaluateAlerts(box.dataset.alertOn);
        renderPanel();
      });
      X.on(el, '[data-alert-field]', 'input', (e, input) => {
        const [id, field] = input.dataset.alertField.split('|');
        live.state[id].alert[field] = Number(input.value);
        save();
        renderPanel();
      });

      restore();
      restoreTracks();
      renderPanel();
    },
    onShow: () => renderPanel(),
  });

  // A location can also be dropped with alt-click, like every other point pick.
  X.onPick((latlng) => {
    if (live.armHome) {
      live.armHome = false;
      setHome(latlng, 'Picked point');
    }
  });

  function renderPanel() {
    if (!root) return;
    renderHome();
    renderLayers();
    renderTrackedReadout();
    renderReplayControls();
    renderAlerts();
    const auto = root.querySelector('#smxAuto');
    if (auto) auto.checked = live.autoRefresh;
    const count = root.querySelector('#smxLayerCount');
    if (count) {
      const on = live.layers.filter((l) => live.state[l.id].on).length;
      count.textContent = on ? `· ${on} on` : '· all off';
    }
  }

  function renderHome() {
    const host = root.querySelector('#smxHome');
    if (!host) return;
    const fix = gpsFix();
    host.innerHTML = `
      ${fix ? `<div class="smx-row" style="margin-top:0">
          <span class="smx-chip" style="border-color:var(--green)">📡 live GPS fix in use
            ${fix.accuracy ? `· ±${Math.round(fix.accuracy)} m` : ''}</span>
        </div>
        <div class="smx-row">
          <label class="smx-lbl grow" for="smxGpsLines">Lines from my GPS to tracked objects</label>
          <input type="checkbox" id="smxGpsLines" ${live.gpsLines ? 'checked' : ''} />
        </div>
        ${live.coverage ? `<div class="smx-hint" style="margin:0">Together you span
          <b>${(live.coverage.area / 1e6).toLocaleString(undefined, { maximumFractionDigits: 0 })} km²</b>
          — the dashed outline on the map.</div>` : ''}` : ''}`;
    host.innerHTML += `
      ${live.home ? `<div class="smx-mono">${X.esc(live.home.label)} · ${live.home.lat.toFixed(4)}, ${live.home.lng.toFixed(4)}</div>`
        : '<div class="smx-hint">No location set. Everything that needs a distance from you is off until there is one.</div>'}
      <div class="smx-btns" style="margin-top:6px">
        <button class="smx-btn" id="smxHomeGps">${X.icon('crosshair')} GPS</button>
        <button class="smx-btn" id="smxHomeCentre">${X.icon('pin')} Map centre</button>
        <button class="smx-btn" id="smxHomePick">${X.icon('pointer')} Pick</button>
      </div>
      <div class="smx-row">
        <label class="smx-lbl">Radius ${live.radiusKm} km</label>
        <input type="range" id="smxRadius" min="5" max="2000" step="5" value="${live.radiusKm}" class="grow" />
      </div>
      <div class="smx-hint">Alerts fire when something crosses this circle. It is also the search radius for the
        layers that ask for one.</div>`;
    const gpsLines = host.querySelector('#smxGpsLines');
    if (gpsLines) {
      gpsLines.addEventListener('change', (e) => {
        live.gpsLines = e.target.checked;
        drawGpsLines();
        renderPanel();
      });
    }
    host.querySelector('#smxHomeGps').addEventListener('click', useGps);
    host.querySelector('#smxHomeCentre').addEventListener('click', () => setHome(map.getCenter(), 'Map centre'));
    host.querySelector('#smxHomePick').addEventListener('click', () => {
      live.armHome = true;
      X.notify('Alt-click the map to set your location.', 'info', 3200);
    });
    host.querySelector('#smxRadius').addEventListener('input', (e) => {
      live.radiusKm = Number(e.target.value);
      const label = host.querySelector('.smx-lbl');
      if (label) label.textContent = `Radius ${live.radiusKm} km`;
      if (live.homeCircle) live.homeCircle.setRadius(live.radiusKm * 1000);
      save();
    });
  }

  function renderLayers() {
    const host = root.querySelector('#smxLayers');
    if (!host) return;
    host.innerHTML = live.layers.map((l) => {
      const st = live.state[l.id];
      const status = st.busy ? 'loading…'
        : st.error ? `<span class="smx-warn">${X.esc(st.error)}</span>`
        : st.on ? `${st.items.length ? `${st.items.length} shown · ` : ''}${ago(st.at)}${st.note ? ` · ${X.esc(st.note)}` : ''}`
        : '';
      return `
        <div class="smx-card${st.on ? ' on' : ''}">
          <div class="smx-row" style="margin-top:0">
            <input type="checkbox" data-layer="${l.id}" id="smxL-${l.id}" ${st.on ? 'checked' : ''} />
            <label class="grow" for="smxL-${l.id}" style="cursor:pointer">${l.emoji} ${X.esc(l.label)}</label>
            ${st.on ? `<button class="smx-btn" data-layer-refresh="${l.id}" title="Refresh now">${X.icon('rotate')}</button>` : ''}
          </div>
          <div class="smx-hint" style="margin:2px 0">${X.esc(l.hint)}${l.every ? ` · every ${l.every}s` : ''}</div>
          ${status ? `<div class="smx-hint" style="margin:2px 0">${status}</div>` : ''}
          ${st.on && l.alert ? `
            <div class="smx-row">
              <input type="checkbox" data-alert-on="${l.id}" id="smxA-${l.id}" ${st.alert.on ? 'checked' : ''} />
              <label class="grow smx-lbl" for="smxA-${l.id}" style="min-width:0">Alert: ${X.esc(l.alert.label)}</label>
            </div>
            ${st.alert.on && l.alert.fields ? l.alert.fields.map((f) => `
              <div class="smx-row">
                <label class="smx-lbl">${X.esc(f.label)} ${st.alert[f.key]}</label>
                <input type="range" class="grow" data-alert-field="${l.id}|${f.key}"
                       min="${f.min}" max="${f.max}" step="${f.step}" value="${st.alert[f.key]}" />
              </div>`).join('') : ''}` : ''}
        </div>`;
    }).join('');
  }

  /**
   * One card per tracked object: where to look, how far, whether it can be seen
   * with the naked eye right now, when it next can be, and what has been
   * recorded so far.
   */
  function renderTrackedReadout() {
    const host = root && root.querySelector('#smxTracked');
    if (!host) return;
    if (!live.tracks.size) {
      host.innerHTML = `<div class="smx-hint">Nothing tracked. Click any live object on the map and press
        Track — more than one at a time is fine.</div>`;
      return;
    }

    host.innerHTML = `
      <div class="smx-row">
        <label class="smx-lbl grow">${live.tracks.size} tracked${live.home ? '' : ' · set a location for look angles'}</label>
        <button class="smx-btn" id="smxTrackForgetAll"
                title="Delete every saved track history">${X.icon('trash')}</button>
        <button class="smx-btn" id="smxTrackStopAll" title="Stop tracking everything">${X.icon('x')}</button>
      </div>
      ${[...live.tracks.values()].map((t) => trackCard(t)).join('')}`;

    host.querySelector('#smxTrackStopAll').addEventListener('click', () => stopTracking());
    host.querySelector('#smxTrackForgetAll').addEventListener('click', forgetAllTracks);
    X.on(host, '[data-track-forget]', 'click', (_e, b) => forgetTrack(b.dataset.trackForget));
    X.on(host, '[data-track-follow]', 'click', (_e, b) => {
      const key = b.dataset.trackFollow;
      live.followKey = live.followKey === key ? null : key;   // toggle: follow, or hold still
      if (live.followKey) updateTracks();
      renderTrackedReadout();
    });
    X.on(host, '[data-track-go]', 'click', (_e, b) => {
      const t = live.tracks.get(b.dataset.trackGo);
      const item = t && trackedItem(t);
      if (item) map.flyTo([item.lat, item.lng], Math.max(map.getZoom(), 6));
    });
    X.on(host, '[data-track-stop]', 'click', (_e, b) => stopTracking(b.dataset.trackStop));
    X.on(host, '[data-track-export]', 'click', (_e, b) => {
      const [key, format] = b.dataset.trackExport.split('|');
      exportTrack(key, format);
    });
  }

  function trackCard(track) {
    const item = trackedItem(track);
    const v = track.view;
    const following = live.followKey === track.key;
    const recorded = track.points.length;
    const span = recorded > 1 ? (track.points[recorded - 1].t - track.points[0].t) / 1000 : 0;

    return `
      <div class="smx-card${following ? ' on' : ''}">
        <div class="smx-row" style="margin-top:0">
          <span class="smx-sw" style="background:${track.color}"></span>
          <b class="grow" style="min-width:0;font-size:12px">${track.emoji} ${X.esc(track.label)}</b>
          <button class="smx-btn${following ? ' on' : ''}" data-track-follow="${track.key}"
                  title="${following ? 'Stop the camera following it — the map holds still'
                    : 'Let the camera follow it (the map stays put by default)'}">
            ${following ? X.icon('crosshair') : X.icon('pin')}
          </button>
          <button class="smx-btn" data-track-go="${track.key}" title="Jump to it once">${X.icon('play')}</button>
          <button class="smx-btn" data-track-stop="${track.key}" title="Stop tracking">${X.icon('x')}</button>
        </div>

        ${!item ? `<div class="smx-hint smx-warn">Not in the latest data — it left the feed or the view.
          Everything below is its last fix, ${ago(track.points.length ? track.points[track.points.length - 1].t : 0)}.</div>` : ''}

        ${v ? `
          <div class="smx-stats">
            <div class="smx-stat"><b>${Mx.compass(v.azimuth)}</b><small>${item ? 'look' : 'was'} ${Math.round(v.azimuth)}\u00b0</small></div>
            <div class="smx-stat"><b>${v.elevation.toFixed(0)}\u00b0</b><small>${v.elevation > 0 ? 'above horizon' : 'below horizon'}</small></div>
            <div class="smx-stat"><b>${km(v.range)}</b><small>line of sight</small></div>
            <div class="smx-stat"><b>${km(v.groundRange)}</b><small>over ground</small></div>
          </div>
          <div class="smx-row" style="margin:2px 0">
            <span class="smx-chip" style="border-color:${v.eye.visible ? 'var(--green)' : 'var(--border)'}">
              ${v.eye.visible ? '👁️ visible now to the naked eye' : `🚫 ${X.esc(v.eye.reasons[0])}`}
            </span>
          </div>
          ${v.eye.reasons.length > 1 ? `<div class="smx-hint" style="margin:0">also ${X.esc(v.eye.reasons.slice(1).join(', '))}</div>` : ''}
          <div class="smx-hint" style="margin:2px 0">
            ${whenToLook(track, v)}
          </div>
          ${v.footprint > 0 ? `<div class="smx-hint" style="margin:0">Above the horizon anywhere inside
            ${km(v.footprint)} of the point under it — that circle is drawn on the map.</div>` : ''}
        ` : '<div class="smx-hint">Set your location to get direction, elevation and visibility.</div>'}

        <div class="smx-row" style="margin:4px 0 0">
          <span class="smx-lbl grow" style="min-width:0">${recorded} fixes${span > 60 ? ` over ${Mx.dur(span)}` : ''} saved</span>
          <button class="smx-btn" data-track-export="${track.key}|gpx" title="Export as GPX">GPX</button>
          <button class="smx-btn" data-track-export="${track.key}|csv" title="Export as CSV">CSV</button>
          <button class="smx-btn" data-track-export="${track.key}|json" title="Export as JSON">JSON</button>
          <button class="smx-btn" data-track-forget="${track.key}"
                  title="Delete the recorded history for this object">${X.icon('trash')}</button>
        </div>
      </div>`;
  }

  /** The plain-language answer to "when do I go outside and look up?" */
  function whenToLook(track, v) {
    if (!trackedItem(track)) return 'Waiting for it to come back into the data before predicting anything.';
    if (v.eye.visible) return '<b>Look now.</b> It is up there, in the direction above.';
    const pass = track.pass;
    if (pass && pass.aos) {
      const secs = (new Date(pass.aos).valueOf() - Date.now()) / 1000;
      if (secs > 0) {
        return `Next pass in <b>${Mx.dur(secs)}</b> (${Mx.clock(secondsOfDay(pass.aos))})`
          + `${pass.maxElevation ? `, up to ${Math.round(pass.maxElevation)}\u00b0` : ''}`
          + `${pass.visible === false ? ' — but in daylight or shadow, so not to the naked eye' : ''}`
          + `${pass.visible === true ? ' — and dark enough to see it' : ''}.`;
      }
      return 'Overhead now, but not visible.';
    }
    if (v.approach && v.approach.approaching) {
      return `Closest in <b>${Mx.dur(v.approach.seconds)}</b>, passing ${km(v.approach.distance)} away`
        + `${v.elevation > 0 ? '' : ' — still below your horizon'}.`;
    }
    if (v.approach && !v.approach.approaching) return 'Already past its closest point and moving away.';
    return 'No prediction for this one — it does not report a course, and its layer offers no pass model.';
  }

  const secondsOfDay = (when) => {
    const d = new Date(when);
    return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
  };

  const REPLAY_RATES = [1, 10, 60, 300, 1800];

  /**
   * The scrubber. It spans exactly the recorded window, so the ends of the
   * slider are the first and last fix rather than an arbitrary clock.
   */
  function renderReplayControls() {
    const host = root && root.querySelector('#smxReplay');
    if (!host) return;
    const window = replayWindow();
    if (!window) {
      host.innerHTML = '<div class="smx-hint">Track something for a minute, then replay it here.</div>';
      return;
    }
    const r = live.replay;
    const span = Math.max(1, (window.to - window.from) / 1000);

    // While playing, only the moving parts are rewritten — rebuilding the slider
    // every frame would fight the pointer that is dragging it.
    const slider = host.querySelector('#smxReplaySlider');
    if (slider && r.on) {
      slider.min = String(Math.floor(window.from / 1000));
      slider.max = String(Math.ceil(window.to / 1000));
      if (document.activeElement !== slider) slider.value = String(Math.round(r.t / 1000));
      const clockEl = host.querySelector('#smxReplayClock');
      if (clockEl) clockEl.textContent = new Date(r.t).toLocaleTimeString();
      const playBtn = host.querySelector('#smxReplayPlay');
      if (playBtn) playBtn.innerHTML = r.playing ? `${X.icon('pause')} Pause` : `${X.icon('play')} Play`;
      return;
    }

    host.innerHTML = `
      <div class="smx-row">
        <label class="smx-lbl grow" for="smxReplayOn">Replay the recording</label>
        <input type="checkbox" id="smxReplayOn" ${r.on ? 'checked' : ''} />
      </div>
      <div class="smx-hint" style="margin:2px 0">
        ${Mx.dur(span)} recorded, ${new Date(window.from).toLocaleTimeString()} to ${new Date(window.to).toLocaleTimeString()}
        ${r.on ? '· live updates keep appending while you scrub' : ''}
      </div>
      ${r.on ? `
        <div class="smx-row">
          <button class="smx-btn" id="smxReplayPlay" style="min-width:74px">${r.playing ? `${X.icon('pause')} Pause` : `${X.icon('play')} Play`}</button>
          <button class="smx-btn" id="smxReplayStart" title="Back to the first fix">${X.icon('rewind')}</button>
          <b class="grow smx-mono" id="smxReplayClock" style="text-align:right;font-size:14px">${new Date(r.t).toLocaleTimeString()}</b>
        </div>
        <input type="range" id="smxReplaySlider" aria-label="Replay time"
               min="${Math.floor(window.from / 1000)}" max="${Math.ceil(window.to / 1000)}" step="1"
               value="${Math.round(r.t / 1000)}" />
        <div class="smx-row" style="justify-content:space-between;margin-top:-2px">
          <small class="smx-hint">${new Date(window.from).toLocaleTimeString()}</small>
          <small class="smx-hint">${new Date(window.to).toLocaleTimeString()}</small>
        </div>
        <div class="smx-row">
          <label class="smx-lbl" for="smxReplayRate">Speed</label>
          <select id="smxReplayRate" class="grow">
            ${REPLAY_RATES.map((v) => `<option value="${v}" ${v === r.rate ? 'selected' : ''}>${v}× real time</option>`).join('')}
          </select>
        </div>
        <div class="smx-hint">Each tracked object sits where it was at that moment, and its line is clipped to
          what it had covered by then. Hover a line to read any single fix.</div>
      ` : ''}`;

    host.querySelector('#smxReplayOn').addEventListener('change', (e) => setReplay(e.target.checked));
    if (!r.on) return;
    host.querySelector('#smxReplayPlay').addEventListener('click', () => (r.playing ? pauseReplay() : playReplay()));
    host.querySelector('#smxReplayStart').addEventListener('click', () => { pauseReplay(); setReplayTime(window.from); });
    host.querySelector('#smxReplaySlider').addEventListener('input', (e) => {
      pauseReplay();
      setReplayTime(Number(e.target.value) * 1000);
    });
    host.querySelector('#smxReplayRate').addEventListener('change', (e) => { r.rate = Number(e.target.value); });
  }

  function renderAlerts() {
    const host = root && root.querySelector('#smxAlerts');
    const count = root && root.querySelector('#smxAlertCount');
    if (!host) return;
    if (count) count.textContent = live.alerts.length ? `· ${live.alerts.length}` : '';
    host.innerHTML = `
      <div class="smx-row">
        <label class="smx-lbl grow" for="smxMute">Silence toasts</label>
        <input type="checkbox" id="smxMute" ${live.muted ? 'checked' : ''} />
        <button class="smx-btn" id="smxAlertClear" title="Clear the log">${X.icon('eraser')}</button>
      </div>
      ${live.alerts.length ? live.alerts.slice(0, 12).map((a, i) => `
        <div class="smx-row" style="gap:6px">
          <span>${a.emoji}</span>
          <span class="grow" style="min-width:0">
            <b style="font-size:11.5px">${X.esc(a.label)}</b>
            <span class="smx-hint" style="margin:0"> ${X.esc(a.why)}</span>
          </span>
          <small class="smx-hint" style="margin:0">${ago(a.at)}</small>
          ${Number.isFinite(a.lat) ? `<button class="smx-btn" data-alert-go="${i}" title="Show on the map">${X.icon('pin')}</button>` : ''}
        </div>`).join('')
        : `<div class="smx-hint">${live.home ? 'No alerts yet.' : 'Set a location first — alerts are all "near me".'}</div>`}`;
    host.querySelector('#smxMute').addEventListener('change', (e) => { live.muted = e.target.checked; save(); });
    host.querySelector('#smxAlertClear').addEventListener('click', () => {
      live.alerts = [];
      live.alerted = new Set();
      renderAlerts();
    });
    X.on(host, '[data-alert-go]', 'click', (_e, b) => {
      const a = live.alerts[Number(b.dataset.alertGo)];
      if (a && Number.isFinite(a.lat)) map.flyTo([a.lat, a.lng], Math.max(map.getZoom(), 8));
    });
  }

  function select(layerId, itemId) {
    const st = live.state[layerId];
    const item = st && st.items.find((i) => String(i.id) === String(itemId));
    if (item) renderTrackedReadout();
  }

  // Bounds-aware layers refetch when the view settles somewhere else.
  map.on('moveend', X.throttle(() => {
    live.layers.forEach((l) => { if (l.needsBounds && live.state[l.id].on) refresh(l.id); });
  }, 3000));

  X.live = {
    state: live,
    get tracks() { return live.tracks; },
    trackKey, isTracking, updateTracks, exportTrack, trackedItem, forgetTrack, forgetAllTracks,
    refreshMarker,
    setReplay, setReplayTime, playReplay, pauseReplay, replayWindow, hoverInfo,
    drawGpsLines, observerPoint, gpsFix,
    get layers() { return live.layers; },
    layerState: (id) => live.state[id],
    register, setLayer, refresh, refreshAll, setHome, useGps,
    startTracking, stopTracking, evaluateAlerts, distanceToHome, liveIcon,
    renderPanel, defaultDraw, boundsBox, rasterPane: 'smx-live-raster', pane: 'smx-live',
  };
})();
