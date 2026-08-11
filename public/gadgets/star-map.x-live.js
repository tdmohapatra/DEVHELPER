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
    tracked: null,              // { layerId, itemId, trail: L.polyline }
    muted: false,
  };

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

  const distanceToHome = (item) => (live.home && Number.isFinite(item.lat) ? Mx.haversine(live.home, item) : null);

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
      if (st.raster) { st.raster.remove(); st.raster = null; }
      st.items = [];
      if (live.tracked && live.tracked.layerId === id) stopTracking();
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
      st.group.clearLayers();
      (layer.draw || defaultDraw)(st.items, ctx);
      evaluateAlerts(id);
      if (live.tracked && live.tracked.layerId === id) followTracked();
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
      isTracked: (item) => !!(live.tracked && live.tracked.layerId === layer.id && live.tracked.itemId === item.id),
      onClick: (item) => (e) => { if (e && e.target && e.target.openPopup) e.target.openPopup(); select(layer.id, item.id); },
    };
  }

  /** What most layers want: a marker per item with a popup and a track button. */
  function defaultDraw(items, ctx) {
    for (const item of items) {
      if (!Number.isFinite(item.lat) || !Number.isFinite(item.lng)) continue;
      L.marker([item.lat, item.lng], {
        pane: 'smx-live', icon: ctx.icon(item, ctx.isTracked(item)), riseOnHover: true,
      })
        .bindPopup(() => popupHtml(ctx.layer, item))
        .on('popupopen', () => bindPopupButtons(ctx.layer, item))
        .addTo(ctx.group);
    }
  }

  function popupHtml(layer, item) {
    const d = distanceToHome(item);
    return `<b>${layer.emoji} ${X.esc(item.label || item.id)}</b>
      ${item.detail ? `<div style="margin-top:4px">${item.detail}</div>` : ''}
      ${d !== null ? `<div style="margin-top:4px">${km(d)} from ${X.esc(live.home.label)}</div>` : ''}
      <div style="margin-top:6px;display:flex;gap:6px">
        <button class="btn" data-smx-track="${X.esc(layer.id)}|${X.esc(String(item.id))}">
          ${live.tracked && live.tracked.itemId === item.id ? 'Stop tracking' : 'Track'}
        </button>
      </div>`;
  }

  function bindPopupButtons(layer, item) {
    const btn = document.querySelector(`[data-smx-track="${layer.id}|${item.id}"]`);
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (live.tracked && live.tracked.itemId === item.id) stopTracking();
      else startTracking(layer.id, item.id);
      map.closePopup();
    });
  }

  /* ------------------------------ tracking ------------------------------ */

  function startTracking(layerId, itemId) {
    stopTracking();
    live.tracked = {
      layerId, itemId,
      trail: L.polyline([], {
        pane: 'smx-live-raster', color: X.ANNOTATION, weight: 2, opacity: 0.9, dashArray: '4 4',
      }).addTo(map),
    };
    const item = currentTracked();
    X.notify(item ? `Tracking ${item.label}.` : 'Tracking.', 'ok', 2200);
    followTracked();
    renderPanel();
  }

  function stopTracking() {
    if (live.tracked && live.tracked.trail) live.tracked.trail.remove();
    live.tracked = null;
    renderPanel();
  }

  const currentTracked = () => {
    if (!live.tracked) return null;
    const st = live.state[live.tracked.layerId];
    return st ? st.items.find((i) => String(i.id) === String(live.tracked.itemId)) || null : null;
  };

  /** Keep the camera on the tracked object and extend its trail. */
  function followTracked() {
    const item = currentTracked();
    if (!item || !Number.isFinite(item.lat)) return;
    const at = [item.lat, item.lng];
    live.tracked.trail.addLatLng(at);
    const pts = live.tracked.trail.getLatLngs();
    if (pts.length > 400) live.tracked.trail.setLatLngs(pts.slice(-400));
    if (live.followCamera !== false) map.panTo(at, { animate: false });
    renderTrackedReadout();
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
    host.innerHTML = `
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

  function renderTrackedReadout() {
    const host = root && root.querySelector('#smxTracked');
    if (!host) return;
    const item = currentTracked();
    if (!live.tracked || !item) {
      host.innerHTML = '<div class="smx-hint">Nothing tracked. Click any live object on the map and press Track.</div>';
      return;
    }
    const d = distanceToHome(item);
    host.innerHTML = `
      <div class="smx-mono">${X.esc(item.label || item.id)}</div>
      <div class="smx-stats">
        <div class="smx-stat"><b>${item.lat.toFixed(3)}</b><small>lat</small></div>
        <div class="smx-stat"><b>${item.lng.toFixed(3)}</b><small>lon</small></div>
        ${Number.isFinite(item.altitude) ? `<div class="smx-stat"><b>${Math.round(item.altitude)}</b><small>alt m</small></div>` : ''}
        ${Number.isFinite(item.speed) ? `<div class="smx-stat"><b>${Math.round(item.speed * 3.6)}</b><small>km/h</small></div>` : ''}
        ${d !== null ? `<div class="smx-stat"><b>${km(d)}</b><small>from you</small></div>` : ''}
      </div>
      <div class="smx-btns">
        <button class="smx-btn" id="smxTrackCam">${X.icon('crosshair')} ${live.followCamera === false ? 'Follow camera' : 'Stop following'}</button>
        <button class="smx-btn" id="smxTrackStop">${X.icon('x')} Stop</button>
      </div>`;
    host.querySelector('#smxTrackStop').addEventListener('click', stopTracking);
    host.querySelector('#smxTrackCam').addEventListener('click', () => {
      live.followCamera = live.followCamera === false;
      renderTrackedReadout();
    });
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
    get layers() { return live.layers; },
    layerState: (id) => live.state[id],
    register, setLayer, refresh, refreshAll, setHome, useGps,
    startTracking, stopTracking, evaluateAlerts, distanceToHome, liveIcon,
    renderPanel, defaultDraw, boundsBox, rasterPane: 'smx-live-raster', pane: 'smx-live',
  };
})();
