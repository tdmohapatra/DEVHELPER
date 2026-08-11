"use strict";
/* ==========================================================================
   Star Map v2 — single-file personal map
   Sections: config → utils → state → map → layers → waypoints → routing
             → search → places → tracking → measure → data → ui → init
   ========================================================================== */

/* ------------------------------ CONFIG ------------------------------ */
const CFG = {
  storePrefix: 'starmap.v3.',
  osrm: 'https://router.project-osrm.org/route/v1',
  nominatim: 'https://nominatim.openstreetmap.org',
  radarApi: 'https://api.rainviewer.com/public/weather-maps.json',
  defaultView: { lat: 22.5726, lng: 78.9629, zoom: 5 },
  searchDebounce: 550,      // Nominatim asks for <= 1 req/s
  routeDebounce: 450,
  minTrailMove: 4,          // metres before a fix joins the trail
  movingSpeed: 0.7,         // m/s floor that counts as "moving"
  colors: {
    selected: '#24b364', alternate: '#8b5cf6',
    trail: '#ef4444', measure: '#f59e0b'
  }
};

/* ------------------------------ UTILS ------------------------------ */
const $  = (id) => document.getElementById(id);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

let _uidCounter = 0;
const uid = () => `w${Date.now().toString(36)}${(_uidCounter++).toString(36)}`;

/** Escape user/remote text before it ever touches innerHTML. */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Great-circle distance in metres. */
function haversine(a, b) {
  const R = 6371008.8, toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const la1 = a.lat * toRad, la2 = b.lat * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function pathLength(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += haversine(pts[i - 1], pts[i]);
  return d;
}

/* --- formatting (unit aware) --- */
const imperial = () => S.prefs.units === 'imperial';
function fmtDist(metres) {
  if (!isFinite(metres)) return '—';
  if (imperial()) {
    const ft = metres * 3.28084;
    return ft < 1000 ? `${Math.round(ft)} ft` : `${(metres / 1609.344).toFixed(metres < 16093 ? 2 : 1)} mi`;
  }
  return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(metres < 10000 ? 2 : 1)} km`;
}
function fmtSpeed(mps) {
  if (!isFinite(mps) || mps < 0) return 0;
  return Math.round(mps * (imperial() ? 2.23694 : 3.6));
}
const speedUnit = () => (imperial() ? 'mph' : 'km/h');
function fmtDur(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '—';
  const s = Math.round(seconds), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}
function fmtClock(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
           : `${m}:${String(sec).padStart(2, '0')}`;
}
function etaClock(seconds) {
  const t = new Date(Date.now() + seconds * 1000);
  return t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
const fmtLatLng = (lat, lng) => `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

/* --- toasts --- */
let toastTimer = new Map();
function toast(msg, kind = 'info', ms = 2600) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('toasts').appendChild(el);
  const t = setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .25s';
    setTimeout(() => el.remove(), 260);
  }, ms);
  toastTimer.set(el, t);
}

/* --- storage --- */
const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(CFG.storePrefix + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, val) {
    try { localStorage.setItem(CFG.storePrefix + key, JSON.stringify(val)); return true; }
    catch (e) {
      toast('Local storage full or blocked — changes will not persist.', 'err', 4200);
      return false;
    }
  },
  del(key) { try { localStorage.removeItem(CFG.storePrefix + key); } catch {} },
  keys() {
    try { return Object.keys(localStorage).filter(k => k.startsWith(CFG.storePrefix)); }
    catch { return []; }
  },
  bytes() {
    return this.keys().reduce((n, k) => n + k.length + (localStorage.getItem(k) || '').length, 0);
  }
};

/* --- download --- */
function download(filename, text, mime = 'application/octet-stream') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* --- fetch with timeout --- */
async function getJSON(url, ms = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(timer); }
}

const debounce = (fn, ms) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

/* ------------------------------ STATE ------------------------------ */
const S = {
  prefs: Object.assign({
    units: 'metric', theme: 'dark', hiAcc: true, autoRoute: true,
    tapAdd: true, showCoords: false, trailCap: 2000,
    router: 'osrm', routerCustom: '', base: 'carto-dark',
    labels: true, overlayOpacity: 0.7, geofence: false, geofenceRadius: 250,
    trail: true, wakeLock: false,
    tfEnabled: false, tfMode: 'live', tfProvider: 'tomtom', tfKey: '',
    tfCustom: '', tfStyle: 'relative0', tfRefresh: 120, tfOpacity: 0.85,
    tfRecord: true
  }, store.get('prefs', {})),

  waypoints: [],           // { id, lat, lng, name, marker }
  savedPlaces: store.get('places', []),
  savedRoutes: store.get('routes', []),

  routes: [],              // { idx, layer, distance, duration, steps }
  selectedRoute: 0,
  mode: 'driving',
  routing: false,

  gpsOn: false, watchId: null, follow: false,
  me: null, meCircle: null, heading: null,
  lastFix: null, trail: [], trailLine: null,

  trip: { dist: 0, start: null, moving: 0, max: 0, pts: 0, lastT: null },

  measuring: false, measurePts: [], measureLine: null, measureMarkers: [],
  geofenceHit: new Set(),
  wakeSentinel: null,
  undoStack: []
};

/* ------------------------------ MAP ------------------------------ */
const map = L.map('map', {
  zoomControl: false, attributionControl: true,
  preferCanvas: false,           // SVG renderer: routes stay stylable + clickable
  maxZoom: 19, minZoom: 2,
  worldCopyJump: true, tap: true
});

const routeRenderer = L.svg({ padding: 0.4 });
map.addLayer(routeRenderer);

L.control.scale({ position: 'bottomleft', imperial: false, metric: true }).addTo(map);

/* ------------------------------ LAYERS ------------------------------ */
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const BASES = {
  'carto-dark':  { name: 'Dark',        icon: 'fa-moon',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    opts: { maxZoom: 20, attribution: `${OSM_ATTR}, &copy; CARTO` } },
  'carto-light': { name: 'Light',       icon: 'fa-sun',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    opts: { maxZoom: 20, attribution: `${OSM_ATTR}, &copy; CARTO` } },
  'osm':         { name: 'OSM standard', icon: 'fa-map',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    opts: { maxZoom: 19, attribution: OSM_ATTR } },
  'sat':         { name: 'Satellite',   icon: 'fa-satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    opts: { maxZoom: 19, attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics' } },
  'topo':        { name: 'Topographic', icon: 'fa-mountain',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    opts: { maxZoom: 17, attribution: `${OSM_ATTR}, SRTM | &copy; OpenTopoMap (CC-BY-SA)` } },
  'cyclosm':     { name: 'Cycling',     icon: 'fa-bicycle',
    url: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
    opts: { maxZoom: 20, subdomains: 'abc', attribution: `${OSM_ATTR}, CyclOSM` } }
};

/* Tile-layer factory. The single-file build swaps this for an IndexedDB-backed
   subclass; the PWA build leaves it alone because its service worker already
   intercepts tile requests. Every tile layer must go through it. */
let mkTileLayer = (url, opts) => L.tileLayer(url, opts);

/* ==========================================================================
   SINGLE-FILE BUILD — IndexedDB tile cache
   Injected by build-single.js immediately after the mkTileLayer factory.

   There is no service worker here and there cannot be one: the spec only
   allows registering a worker from a same-origin *script URL*, so blob: and
   data: are rejected and a one-file app has nowhere to put it. Instead every
   tile is routed through a TileLayer subclass that reads and writes an
   IndexedDB object store. That works from file://, where workers do not.
   ========================================================================== */
const TILE_DB = 'starmap-tiles', TILE_STORE = 'tiles', TILE_DB_V = 1;
const IDB_TIMEOUT = 2500;

let _tdb = null;
/** null = not probed yet, true = usable, false = unusable (see tileCacheReason) */
let tileCacheAvailable = null;
let tileCacheReason = '';

function tdb() {
  if (_tdb) return _tdb;
  _tdb = new Promise((resolve) => {
    let settled = false;
    const give = (db, reason) => {
      if (settled) return;
      settled = true;
      tileCacheAvailable = !!db;
      tileCacheReason = reason || '';
      resolve(db || null);
    };

    if (typeof indexedDB === 'undefined' || !indexedDB) {
      return give(null, 'IndexedDB is not available in this browser.');
    }

    let req;
    try { req = indexedDB.open(TILE_DB, TILE_DB_V); }
    catch (e) { return give(null, `IndexedDB blocked: ${e.message || e.name}`); }

    /* Chromium never fires success OR error for indexedDB.open on a file://
       origin — the request just hangs forever. Without this timeout every tile
       would await a promise that never settles and the map would stay blank. */
    const timer = setTimeout(() => give(null, location.protocol === 'file:'
      ? 'Browsers block persistent storage on file:// — serve this file over http://localhost to enable offline tiles.'
      : 'IndexedDB did not respond.'), IDB_TIMEOUT);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TILE_STORE)) {
        db.createObjectStore(TILE_STORE, { keyPath: 'url' }).createIndex('t', 't');
      }
    };
    req.onsuccess = () => { clearTimeout(timer); give(req.result); };
    req.onerror   = () => { clearTimeout(timer); give(null, `IndexedDB error: ${req.error?.message || 'unknown'}`); };
    req.onblocked = () => { clearTimeout(timer); give(null, 'IndexedDB is blocked by another open tab.'); };
  });
  return _tdb;
}

/* Probe immediately so the verdict is in before the first tiles resolve. */
tdb();

const idbReq = (r) => new Promise((res, rej) => {
  r.onsuccess = () => res(r.result);
  r.onerror   = () => rej(r.error);
});

async function tileStore(mode) {
  const db = await tdb();
  if (!db) return null;
  try { return db.transaction(TILE_STORE, mode).objectStore(TILE_STORE); }
  catch { return null; }
}

async function tileGet(url) {
  if (tileCacheAvailable === false) return null;
  try {
    const st = await tileStore('readonly');
    if (!st) return null;
    const rec = await idbReq(st.get(url));
    return rec ? rec.blob : null;
  } catch { return null; }
}

async function tilePut(url, blob) {
  if (tileCacheAvailable === false) return false;
  try {
    const st = await tileStore('readwrite');
    if (!st) return false;
    await idbReq(st.put({ url, blob, size: blob.size, t: Date.now() }));
    return true;
  } catch (e) {
    // QuotaExceededError is the common one — surface it once, then stop nagging.
    if (!tilePut._warned) { tilePut._warned = true; toast('Tile storage is full. Clear the cache in the Offline tab.', 'err', 5000); }
    return false;
  }
}

/** Count and total bytes in a single cursor pass — a second request on an
 *  already-drained transaction is not portable across engines. */
async function tileStats() {
  try {
    const store = await tileStore('readonly');
    if (!store) return { count: 0, bytes: 0 };
    let count = 0, bytes = 0;
    await new Promise((res, rej) => {
      const c = store.openCursor();
      c.onsuccess = () => {
        const cur = c.result;
        if (!cur) return res();
        count++; bytes += cur.value.size || 0;
        cur.continue();
      };
      c.onerror = () => rej(c.error);
    });
    return { count, bytes };
  } catch { return { count: 0, bytes: 0 }; }
}

async function tileClear() {
  try {
    const st = await tileStore('readwrite');
    if (!st) return false;
    await idbReq(st.clear());
    return true;
  } catch { return false; }
}

/** Evict oldest-first once over the ceiling. */
async function tileTrim(limit) {
  try {
    const { count } = await tileStats();
    if (count <= limit) return 0;
    const store = await tileStore('readwrite');
    if (!store) return 0;
    let toKill = count - limit;
    let killed = 0;
    await new Promise((res, rej) => {
      const c = store.index('t').openCursor();       // ascending by timestamp
      c.onsuccess = () => {
        const cur = c.result;
        if (!cur || killed >= toKill) return res();
        cur.delete(); killed++; cur.continue();
      };
      c.onerror = () => rej(c.error);
    });
    return killed;
  } catch { return 0; }
}

/* ------------------------- cached tile layer ------------------------- */
const OFFLINE_TILE = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">' +
  '<rect width="256" height="256" fill="#1a2130"/>' +
  '<path d="M0 0L256 256M256 0L0 256" stroke="#232c3d" stroke-width="1"/>' +
  '<text x="128" y="132" fill="#3a4658" font-family="sans-serif" font-size="11" ' +
  'text-anchor="middle">offline</text></svg>');

const CachedTileLayer = L.TileLayer.extend({
  createTile: function (coords, done) {
    const img = document.createElement('img');
    img.setAttribute('role', 'presentation');
    img.alt = '';

    const url = this.getTileUrl(coords);

    const settle = (src, isObjectUrl) => {
      if (isObjectUrl) img._objUrl = src;
      img.onload  = () => done(null, img);
      img.onerror = () => {
        img.onerror = null;              // never re-enter, or the fallback loops
        img.src = OFFLINE_TILE;
        done(null, img);
      };
      img.src = src;
    };

    // Traffic layers opt out entirely: a cached congestion tile is a lie.
    if (this.options.noCache) {
      settle(url, false);
      return img;
    }

    (async () => {
      const hit = tileCacheAvailable === false ? null : await tileGet(url);
      if (hit) return settle(URL.createObjectURL(hit), true);
      if (!navigator.onLine) return settle(OFFLINE_TILE, false);
      try {
        // CORS mode so the blob is readable and storable. Opaque responses
        // cannot be written to IndexedDB at all.
        const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        tilePut(url, blob);
        settle(URL.createObjectURL(blob), true);
      } catch {
        settle(url, false);              // last resort: plain <img> load, uncached
      }
    })();

    return img;
  }
});

/* Replace the factory declared just above. Every tile layer in the app is
   built through it, so this single line switches the whole map onto the cache. */
mkTileLayer = function (url, opts) {
  const layer = new CachedTileLayer(url, opts);
  layer.on('tileunload', (e) => {
    if (e.tile && e.tile._objUrl) { URL.revokeObjectURL(e.tile._objUrl); e.tile._objUrl = null; }
  });
  return layer;
};


let baseLayer = null;
const labelLayer = mkTileLayer(
  'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png',
  { maxZoom: 20, pane: 'shadowPane', attribution: '&copy; CARTO' }
);
const hillLayer = mkTileLayer(
  'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
  { maxZoom: 17, opacity: 0.35, attribution: '&copy; OpenTopoMap' }
);
let radarLayer = null;

function setBase(key) {
  const def = BASES[key] || BASES['carto-dark'];
  if (baseLayer) map.removeLayer(baseLayer);
  baseLayer = mkTileLayer(def.url, Object.assign({ keepBuffer: 3, updateWhenIdle: false }, def.opts));
  baseLayer.addTo(map).bringToBack();
  S.prefs.base = key;
  savePrefs();
  syncLabelLayer();
  renderBaseList();
}

function syncLabelLayer() {
  const needsLabels = S.prefs.base === 'sat' && S.prefs.labels;
  if (needsLabels && !map.hasLayer(labelLayer)) labelLayer.addTo(map);
  if (!needsLabels && map.hasLayer(labelLayer)) map.removeLayer(labelLayer);
}

function renderBaseList() {
  $('baseList').innerHTML = Object.entries(BASES).map(([key, b]) => `
    <li data-base="${esc(key)}" style="cursor:pointer">
      <i class="fa-solid ${esc(b.icon)}" style="width:18px;color:var(--text-dim)"></i>
      <span class="grow">${esc(b.name)}</span>
      ${key === S.prefs.base ? '<i class="fa-solid fa-check" style="color:var(--green)"></i>' : ''}
    </li>`).join('');
}

async function enableRadar() {
  try {
    const meta = await getJSON(CFG.radarApi, 9000);
    const frames = (meta.radar && (meta.radar.past || [])).concat(meta.radar?.nowcast || []);
    if (!frames.length) throw new Error('no frames');
    const latest = frames[frames.length - 1];
    radarLayer = mkTileLayer(`${meta.host}${latest.path}/256/{z}/{x}/{y}/4/1_1.png`, {
      opacity: S.prefs.overlayOpacity, maxZoom: 12,
      attribution: '&copy; <a href="https://rainviewer.com">RainViewer</a>'
    }).addTo(map);
    toast('Rain radar on.', 'ok');
  } catch (e) {
    $('radarToggle').checked = false;
    toast('Radar unavailable right now.', 'err');
  }
}
function disableRadar() {
  if (radarLayer) { map.removeLayer(radarLayer); radarLayer = null; }
}

/* ------------------------------ WAYPOINTS ------------------------------ */
function wpIcon(index, total) {
  const cls = index === 0 ? 'wp-pin start'
            : index === total - 1 ? 'wp-pin end' : 'wp-pin';
  return L.divIcon({
    className: cls,
    html: `<div><span>${index + 1}</span></div>`,
    iconSize: [26, 26], iconAnchor: [13, 26], popupAnchor: [0, -26]
  });
}

function addWaypoint(lat, lng, name, opts = {}) {
  lat = +lat; lng = +lng;
  if (!isFinite(lat) || !isFinite(lng)) return null;

  // reject a duplicate within ~5 m
  const dupe = S.waypoints.find(w => haversine(w, { lat, lng }) < 5);
  if (dupe) { toast('Already a waypoint here.', 'warn'); return dupe; }

  const wp = { id: uid(), lat, lng, name: name || `Point ${S.waypoints.length + 1}`, marker: null };

  // Give it the real icon up front. Without this Leaflet reaches for its default
  // marker PNG, which resolves relative to the leaflet.js URL — and there is no
  // script URL to resolve against in the inlined single-file build.
  wp.marker = L.marker([lat, lng], {
    icon: wpIcon(S.waypoints.length, S.waypoints.length + 1),
    draggable: true, autoPan: true, riseOnHover: true
  })
    .addTo(map)
    .on('dragend', () => {
      const p = wp.marker.getLatLng();
      wp.lat = p.lat; wp.lng = p.lng;
      renderWaypoints();
      if (S.prefs.autoRoute) queueRoute();
    })
    .on('click', () => openWpPopup(wp));

  S.waypoints.push(wp);
  S.undoStack.push({ type: 'wp', id: wp.id });
  renderWaypoints();
  if (!opts.silent && S.prefs.autoRoute) queueRoute();
  return wp;
}

/** Popup content is built per-open and bound to the waypoint OBJECT, never an index.
 *  This is what made the original build delete the wrong pin after a removal. */
function openWpPopup(wp) {
  const idx = S.waypoints.indexOf(wp);
  const box = document.createElement('div');
  box.innerHTML = `
    <b>${esc(wp.name)}</b><br>
    <span style="color:var(--text-dim);font-size:12px">${esc(fmtLatLng(wp.lat, wp.lng))}</span>
    <input type="text" class="pp-name" placeholder="Save as…" value="${esc(wp.name)}"
           style="width:100%;padding:8px;margin:9px 0;border:1px solid var(--border);
                  border-radius:9px;background:transparent;color:inherit">
    <div style="display:flex;gap:6px">
      <button class="pp-save"   style="flex:1;padding:8px;border:0;border-radius:9px;background:#0a84ff;color:#fff">Save place</button>
      <button class="pp-remove" style="flex:1;padding:8px;border:0;border-radius:9px;background:#ef4444;color:#fff">Remove</button>
    </div>
    <button class="pp-geo" style="width:100%;margin-top:6px;padding:7px;border:1px solid var(--border);
            border-radius:9px;background:transparent;color:inherit">Look up address</button>`;

  box.querySelector('.pp-save').onclick = () => {
    const name = box.querySelector('.pp-name').value.trim() || `Place ${S.savedPlaces.length + 1}`;
    savePlace(name, wp.lat, wp.lng);
    wp.marker.closePopup();
  };
  box.querySelector('.pp-remove').onclick = () => removeWaypoint(wp.id);
  box.querySelector('.pp-geo').onclick = async (ev) => {
    ev.target.textContent = 'Looking up…';
    const name = await reverseGeocode(wp.lat, wp.lng);
    if (name) {
      wp.name = name;
      box.querySelector('.pp-name').value = name;
      renderWaypoints();
    }
    ev.target.textContent = 'Look up address';
  };

  wp.marker.bindPopup(box, { closeButton: true }).openPopup();
  if (idx < 0) wp.marker.closePopup();
}

function removeWaypoint(id) {
  const i = S.waypoints.findIndex(w => w.id === id);
  if (i < 0) return;
  map.removeLayer(S.waypoints[i].marker);
  S.waypoints.splice(i, 1);
  renderWaypoints();
  if (S.waypoints.length < 2) clearRoutes();
  else if (S.prefs.autoRoute) queueRoute();
}

function moveWaypoint(id, delta) {
  const i = S.waypoints.findIndex(w => w.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= S.waypoints.length) return;
  [S.waypoints[i], S.waypoints[j]] = [S.waypoints[j], S.waypoints[i]];
  renderWaypoints();
  if (S.prefs.autoRoute) queueRoute();
}

function clearWaypoints() {
  S.waypoints.forEach(w => map.removeLayer(w.marker));
  S.waypoints = [];
  renderWaypoints();
  clearRoutes();
}

function renderWaypoints() {
  const list = $('wpList'), empty = $('wpEmpty');
  const n = S.waypoints.length;

  S.waypoints.forEach((w, i) => w.marker.setIcon(wpIcon(i, n)));

  if (!n) {
    list.innerHTML = ''; list.style.display = 'none'; empty.style.display = 'block';
  } else {
    list.style.display = ''; empty.style.display = 'none';
    list.innerHTML = S.waypoints.map((w, i) => `
      <li data-wp="${esc(w.id)}">
        <span class="idx">${i + 1}</span>
        <span class="grow">${esc(w.name)}<div class="sub">${esc(fmtLatLng(w.lat, w.lng))}</div></span>
        <button class="mini" data-act="up"   title="Move up"   ${i === 0 ? 'disabled' : ''}><i class="fa-solid fa-chevron-up"></i></button>
        <button class="mini" data-act="down" title="Move down" ${i === n - 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-down"></i></button>
        <button class="mini" data-act="go"   title="Zoom to"><i class="fa-solid fa-crosshairs"></i></button>
        <button class="mini del" data-act="del" title="Remove"><i class="fa-solid fa-xmark"></i></button>
      </li>`).join('');
  }

  const straight = n >= 2 ? pathLength(S.waypoints) : 0;
  $('headSummary').textContent = n
    ? `${n} pt${n > 1 ? 's' : ''}${straight ? ' · ' + fmtDist(straight) + ' direct' : ''}`
    : '';
  updateRouteEmptyState();
}

/* ------------------------------ ROUTING ------------------------------ */
const OSRM_PROFILE = { driving: 'driving', cycling: 'cycling', foot: 'foot' };

function routerBase() {
  if (S.prefs.router === 'custom' && S.prefs.routerCustom.trim()) {
    return S.prefs.routerCustom.trim().replace(/\/+$/, '');
  }
  return CFG.osrm;
}

function clearRoutes() {
  S.routes.forEach(r => map.removeLayer(r.layer));
  S.routes = [];
  S.selectedRoute = 0;
  $('routeCards').innerHTML = '';
  $('stepsList').innerHTML = '';
  $('stepsList').style.display = 'none';
  $('stepsHead').style.display = 'none';
  updateRouteEmptyState();
}

function updateRouteEmptyState() {
  const has = S.routes.length > 0;
  $('routeEmpty').style.display = has ? 'none' : 'block';
  $('routeEmpty').textContent = S.waypoints.length < 2
    ? 'Add 2+ waypoints, then hit Route.'
    : 'Hit Route to calculate.';
}

const queueRoute = debounce(() => calculateRoutes(), CFG.routeDebounce);

async function calculateRoutes() {
  if (S.waypoints.length < 2) { clearRoutes(); return; }
  if (S.routing) return;
  S.routing = true;
  $('calcBtn').disabled = true;
  $('routeEmpty').style.display = 'block';
  $('routeEmpty').innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Calculating…';

  clearRoutes();
  $('routeEmpty').style.display = 'block';
  $('routeEmpty').innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Calculating…';

  const profile = OSRM_PROFILE[S.mode] || 'driving';
  const coords = S.waypoints.map(w => `${w.lng.toFixed(6)},${w.lat.toFixed(6)}`).join(';');
  const url = `${routerBase()}/${profile}/${coords}` +
              `?overview=full&geometries=geojson&steps=true&alternatives=true&annotations=false`;

  try {
    const data = await getJSON(url, 20000);
    if (data.code !== 'Ok' || !data.routes?.length) {
      throw new Error(data.message || 'No route found');
    }

    data.routes.forEach((r, i) => {
      const latlngs = r.geometry.coordinates.map(c => [c[1], c[0]]);
      const layer = L.polyline(latlngs, {
        renderer: routeRenderer,
        color: i === 0 ? CFG.colors.selected : CFG.colors.alternate,
        weight: i === 0 ? 7 : 4,
        opacity: i === 0 ? 0.92 : 0.55,
        dashArray: i === 0 ? null : '10,9',
        lineJoin: 'round', lineCap: 'round',
        interactive: true, smoothFactor: 1.2
      }).addTo(map);

      layer.on('click', () => selectRoute(i));
      layer.bindTooltip(
        `${fmtDist(r.distance)} · ${fmtDur(r.duration)}`,
        { sticky: true, direction: 'top' }
      );

      S.routes.push({
        idx: i, layer,
        distance: r.distance, duration: r.duration,
        steps: (r.legs || []).flatMap(l => l.steps || [])
      });
    });

    selectRoute(0);
    fitRoute();
    toast(`${S.routes.length} route${S.routes.length > 1 ? 's' : ''} found.`, 'ok');
  } catch (err) {
    clearRoutes();
    $('routeEmpty').style.display = 'block';
    $('routeEmpty').textContent = `Routing failed: ${err.message}. Public OSRM rate-limits — wait a few seconds.`;
    toast('Routing failed.', 'err');
  } finally {
    S.routing = false;
    $('calcBtn').disabled = false;
  }
}

function selectRoute(i) {
  if (!S.routes[i]) return;
  S.selectedRoute = i;
  S.routes.forEach((r, k) => {
    const on = k === i;
    r.layer.setStyle({
      color: on ? CFG.colors.selected : CFG.colors.alternate,
      weight: on ? 7 : 4,
      opacity: on ? 0.92 : 0.55,
      dashArray: on ? null : '10,9'
    });
    if (on) r.layer.bringToFront();
  });
  renderRouteCards();
  renderSteps(S.routes[i].steps);
}

function renderRouteCards() {
  $('routeEmpty').style.display = 'none';
  $('routeCards').innerHTML = S.routes.map((r, i) => {
    const fastest = r.duration === Math.min(...S.routes.map(x => x.duration));
    const shortest = r.distance === Math.min(...S.routes.map(x => x.distance));
    const tag = fastest ? 'Fastest' : shortest ? 'Shortest' : `Alt ${i}`;
    return `
      <div class="rcard ${i === S.selectedRoute ? 'on' : ''}" data-route="${i}">
        <span class="swatch" style="background:${i === S.selectedRoute ? CFG.colors.selected : CFG.colors.alternate}"></span>
        <div>
          <div class="big">${esc(fmtDist(r.distance))} · ${esc(fmtDur(r.duration))}</div>
          <div class="meta">Arrive ~${esc(etaClock(r.duration))} · ${r.steps.length} steps</div>
        </div>
        <span class="tag">${esc(tag)}</span>
      </div>`;
  }).join('');
}

const MANEUVER_ICON = {
  'turn-left': 'fa-arrow-left', 'turn-right': 'fa-arrow-right',
  'turn-slight left': 'fa-arrow-turn-up', 'turn-slight right': 'fa-arrow-turn-up',
  'turn-sharp left': 'fa-arrow-left', 'turn-sharp right': 'fa-arrow-right',
  'turn-uturn': 'fa-arrow-rotate-left',
  'depart': 'fa-circle-dot', 'arrive': 'fa-flag-checkered',
  'roundabout': 'fa-rotate-right', 'rotary': 'fa-rotate-right',
  'merge': 'fa-code-merge', 'fork': 'fa-code-branch',
  'on ramp': 'fa-diagram-successor', 'off ramp': 'fa-diagram-predecessor'
};

function stepIcon(st) {
  const m = st.maneuver || {};
  return MANEUVER_ICON[`${m.type}-${m.modifier}`] || MANEUVER_ICON[m.type] || 'fa-arrow-up';
}

/** Human instruction from an OSRM step. OSRM returns data, not sentences. */
function stepText(st) {
  const m = st.maneuver || {};
  const road = st.name ? ` onto ${st.name}` : '';
  const on   = st.name ? ` on ${st.name}` : '';
  const mod  = (m.modifier || '').replace(/_/g, ' ');
  switch (m.type) {
    case 'depart':      return `Start${on}`;
    case 'arrive':      return m.modifier ? `Arrive, destination on the ${mod}` : 'Arrive at destination';
    case 'turn':        return `Turn ${mod}${road}`;
    case 'new name':    return `Continue${road}`;
    case 'continue':    return `Continue ${mod}${on}`.replace('  ', ' ');
    case 'merge':       return `Merge ${mod}${road}`;
    case 'fork':        return `Keep ${mod}${road}`;
    case 'end of road': return `Turn ${mod} at the end of the road${road}`;
    case 'on ramp':     return `Take the ramp ${mod}${road}`;
    case 'off ramp':    return `Take the exit ${mod}${road}`;
    case 'roundabout':
    case 'rotary':      return `At the roundabout take exit ${m.exit || '?'}${road}`;
    case 'notification':return `Continue${on}`;
    default:            return `${m.type || 'Continue'} ${mod}`.trim() + on;
  }
}

function renderSteps(steps) {
  const list = $('stepsList'), head = $('stepsHead');
  if (!steps || !steps.length) {
    list.style.display = 'none'; head.style.display = 'none'; return;
  }
  head.style.display = ''; list.style.display = '';
  list.innerHTML = steps.map((st, i) => `
    <li data-step="${i}">
      <span class="ico"><i class="fa-solid ${esc(stepIcon(st))}"></i></span>
      <span class="grow" style="white-space:normal">${esc(stepText(st))}</span>
      <span class="dist">${esc(fmtDist(st.distance))}</span>
    </li>`).join('');
}

function fitRoute() {
  const sel = S.routes[S.selectedRoute];
  if (sel) { map.fitBounds(sel.layer.getBounds(), { padding: [60, 60], maxZoom: 17 }); return; }
  if (S.waypoints.length) {
    map.fitBounds(L.latLngBounds(S.waypoints.map(w => [w.lat, w.lng])), { padding: [70, 70], maxZoom: 16 });
  }
}

/* ------------------------------ SEARCH ------------------------------ */
let suggestItems = [], suggestIndex = -1;

const runSuggest = debounce(async (q) => {
  if (q.length < 3) { hideSuggest(); return; }
  try {
    const url = `${CFG.nominatim}/search?format=jsonv2&limit=6&addressdetails=1&q=${encodeURIComponent(q)}`;
    const data = await getJSON(url, 12000);
    suggestItems = data || [];
    if (!suggestItems.length) { hideSuggest(); toast('Nothing found.', 'warn'); return; }
    suggestIndex = -1;
    $('suggest').innerHTML = suggestItems.map((r, i) => {
      const parts = String(r.display_name).split(',');
      return `<li data-sug="${i}" role="option">
                <div>${esc(parts[0])}</div>
                <div class="sub">${esc(parts.slice(1, 4).join(',').trim())}</div>
              </li>`;
    }).join('');
    $('suggest').classList.add('on');
  } catch {
    hideSuggest();
    toast('Search failed — Nominatim rate limit or offline.', 'err');
  }
}, CFG.searchDebounce);

function hideSuggest() {
  $('suggest').classList.remove('on');
  $('suggest').innerHTML = '';
  suggestItems = []; suggestIndex = -1;
}

function pickSuggest(i) {
  const r = suggestItems[i];
  if (!r) return;
  const lat = parseFloat(r.lat), lng = parseFloat(r.lon);
  const label = String(r.display_name).split(',')[0];
  map.flyTo([lat, lng], Math.max(map.getZoom(), 15), { duration: 1.1 });
  addWaypoint(lat, lng, label);
  hideSuggest();
  $('searchInput').value = '';
  toast(`Added “${label}”.`, 'ok');
}

async function reverseGeocode(lat, lng) {
  try {
    const url = `${CFG.nominatim}/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=17`;
    const d = await getJSON(url, 12000);
    if (!d || !d.display_name) return null;
    const a = d.address || {};
    return a.road || a.neighbourhood || a.suburb || a.village ||
           a.town || a.city || String(d.display_name).split(',')[0];
  } catch { return null; }
}

/* ------------------------------ SAVED PLACES ------------------------------ */
const placeMarkers = new Map();

function savePlace(name, lat, lng) {
  const p = { id: uid(), name: name.slice(0, 80), lat, lng, at: Date.now() };
  S.savedPlaces.push(p);
  store.set('places', S.savedPlaces.map(({ id, name, lat, lng, at }) => ({ id, name, lat, lng, at })));
  renderPlaces();
  toast(`Saved “${p.name}”.`, 'ok');
  return p;
}

function deletePlace(id) {
  S.savedPlaces = S.savedPlaces.filter(p => p.id !== id);
  store.set('places', S.savedPlaces);
  renderPlaces();
}

function renderPlaces() {
  const filter = $('placeFilter').value.trim().toLowerCase();
  const list = $('placeList'), empty = $('placeEmpty');

  // markers
  placeMarkers.forEach(m => map.removeLayer(m));
  placeMarkers.clear();
  S.savedPlaces.forEach(p => {
    const m = L.marker([p.lat, p.lng], {
      icon: L.divIcon({ className: 'saved-pin', html: '<div><i class="fa-solid fa-star"></i></div>', iconSize: [22, 22] })
    }).addTo(map).bindTooltip(p.name, { direction: 'top' });
    m.on('click', () => addWaypoint(p.lat, p.lng, p.name));
    placeMarkers.set(p.id, m);
  });

  const shown = S.savedPlaces.filter(p => !filter || p.name.toLowerCase().includes(filter));
  if (!shown.length) {
    list.innerHTML = ''; list.style.display = 'none';
    empty.style.display = 'block';
    empty.textContent = S.savedPlaces.length ? 'No match.' : 'Nothing saved yet.';
    return;
  }
  list.style.display = ''; empty.style.display = 'none';
  list.innerHTML = shown.map(p => `
    <li data-place="${esc(p.id)}">
      <i class="fa-solid fa-star" style="color:var(--amber)"></i>
      <span class="grow">${esc(p.name)}<div class="sub">${esc(fmtLatLng(p.lat, p.lng))}</div></span>
      <button class="mini" data-act="add" title="Add to route"><i class="fa-solid fa-plus"></i></button>
      <button class="mini" data-act="go"  title="Zoom to"><i class="fa-solid fa-crosshairs"></i></button>
      <button class="mini del" data-act="del" title="Delete"><i class="fa-solid fa-trash"></i></button>
    </li>`).join('');
}

/* ------------------------------ SAVED ROUTES ------------------------------ */
function renderSavedRoutes() {
  const list = $('routeList'), empty = $('routeListEmpty');
  if (!S.savedRoutes.length) {
    list.innerHTML = ''; list.style.display = 'none'; empty.style.display = 'block'; return;
  }
  list.style.display = ''; empty.style.display = 'none';
  list.innerHTML = S.savedRoutes.map(r => `
    <li data-sroute="${esc(r.id)}">
      <i class="fa-solid fa-route" style="color:var(--blue)"></i>
      <span class="grow">${esc(r.name)}<div class="sub">${r.pts.length} points · ${esc(r.mode)}</div></span>
      <button class="mini" data-act="load" title="Load"><i class="fa-solid fa-folder-open"></i></button>
      <button class="mini del" data-act="del" title="Delete"><i class="fa-solid fa-trash"></i></button>
    </li>`).join('');
}

/* ------------------------------ TRACKING ------------------------------ */
function meIcon() {
  const cone = S.heading == null ? '' :
    `<div class="cone" style="transform:rotate(${S.heading}deg)"></div>`;
  return L.divIcon({ className: '', html: `<div class="me-dot">${cone}</div>`, iconSize: [20, 20], iconAnchor: [10, 10] });
}

function startGPS() {
  if (!navigator.geolocation) { toast('Geolocation not supported here.', 'err'); return; }
  if (!window.isSecureContext) { toast('GPS needs HTTPS or localhost.', 'err', 5000); return; }

  stopGPS(true);
  S.gpsOn = true;
  setGpsUI('wait');
  S.watchId = navigator.geolocation.watchPosition(onFix, onFixError, {
    enableHighAccuracy: S.prefs.hiAcc, maximumAge: 2000, timeout: 20000
  });
  $('fabGps').classList.add('on');
  if (S.prefs.wakeLock) requestWakeLock();
}

function stopGPS(quiet) {
  if (S.watchId != null) { navigator.geolocation.clearWatch(S.watchId); S.watchId = null; }
  S.gpsOn = false;
  if (!quiet) {
    setGpsUI('off');
    $('fabGps').classList.remove('on');
    if (S.me)       { map.removeLayer(S.me);       S.me = null; }
    if (S.meCircle) { map.removeLayer(S.meCircle); S.meCircle = null; }
    releaseWakeLock();
    setFollow(false);
  }
}

function setGpsUI(mode, txt) {
  const dot = $('gpsDot'), t = $('gpsText');
  dot.className = 'live-dot' + (mode === 'off' ? ' off' : mode === 'wait' ? ' stale' : '');
  t.textContent = txt || (mode === 'off' ? 'GPS off' : mode === 'wait' ? 'Acquiring…' : 'Live');
}

function onFixError(err) {
  const msg = { 1: 'Location permission denied.', 2: 'Position unavailable.', 3: 'Location timed out.' };
  setGpsUI('wait', msg[err.code] || 'GPS error');
  if (err.code === 1) { stopGPS(); toast(msg[1] + ' Enable it in browser settings.', 'err', 5000); }
}

function onFix(pos) {
  const { latitude: lat, longitude: lng, accuracy, altitude, speed, heading } = pos.coords;
  const now = pos.timestamp || Date.now();
  const here = { lat, lng };

  if (heading != null && !isNaN(heading)) S.heading = heading;

  // marker + accuracy ring
  if (!S.me) {
    S.me = L.marker([lat, lng], { icon: meIcon(), zIndexOffset: 1000, interactive: false }).addTo(map);
    S.meCircle = L.circle([lat, lng], {
      radius: accuracy, color: '#0a84ff', weight: 1, fillColor: '#0a84ff', fillOpacity: 0.12, interactive: false
    }).addTo(map);
    if (map.getZoom() < 8) map.setView([lat, lng], 16);
  } else {
    S.me.setLatLng([lat, lng]);
    S.me.setIcon(meIcon());
    S.meCircle.setLatLng([lat, lng]).setRadius(accuracy);
  }

  setGpsUI('live', accuracy > 50 ? `Live · ±${Math.round(accuracy)} m` : 'Live');

  // ---- trip stats ----
  let computedSpeed = speed;
  if (S.lastFix) {
    const d = haversine(S.lastFix, here);
    const dt = (now - S.lastFix.t) / 1000;
    if (computedSpeed == null || isNaN(computedSpeed)) {
      computedSpeed = dt > 0 ? d / dt : 0;
    }
    // reject GPS jitter: sub-accuracy jumps do not count as travel
    if (d > Math.max(CFG.minTrailMove, accuracy * 0.5)) {
      S.trip.dist += d;
      if (S.prefs.trail) pushTrail(here);
    }
    if (computedSpeed > CFG.movingSpeed && dt < 30) S.trip.moving += dt;
  } else {
    S.trip.start = now;
    if (S.prefs.trail) pushTrail(here);
  }

  S.trip.pts++;
  S.trip.max = Math.max(S.trip.max, computedSpeed || 0);
  S.lastFix = { lat, lng, t: now };

  recordSpeedSample(lat, lng, computedSpeed, accuracy, now);

  updateHud(computedSpeed, accuracy, altitude);
  updateTripPanel(accuracy, altitude);
  if (S.prefs.geofence) checkGeofence(here);
  if (S.follow) map.panTo([lat, lng], { animate: true, duration: 0.5 });
}

function pushTrail(pt) {
  const last = S.trail[S.trail.length - 1];
  if (last && haversine({ lat: last[0], lng: last[1] }, pt) < CFG.minTrailMove) return;
  S.trail.push([pt.lat, pt.lng]);
  const cap = +S.prefs.trailCap;
  if (cap > 0 && S.trail.length > cap) S.trail.splice(0, S.trail.length - cap);

  if (!S.trailLine) {
    S.trailLine = L.polyline(S.trail, {
      renderer: routeRenderer, color: CFG.colors.trail,
      weight: 4, opacity: 0.7, lineJoin: 'round', lineCap: 'round'
    }).addTo(map);
  } else {
    S.trailLine.setLatLngs(S.trail);
  }
}

function clearTrail() {
  S.trail = [];
  if (S.trailLine) { map.removeLayer(S.trailLine); S.trailLine = null; }
  toast('Trail cleared.', 'ok');
}

function resetTrip() {
  S.trip = { dist: 0, start: Date.now(), moving: 0, max: 0, pts: 0, lastT: null };
  S.lastFix = null;
  updateTripPanel();
  toast('Trip stats reset.', 'ok');
}

function updateHud(speed, accuracy, altitude) {
  $('hudSpeed').textContent = fmtSpeed(speed);
  $('hudSpeedUnit').textContent = speedUnit();
}

function updateTripPanel(accuracy, altitude) {
  const t = S.trip;
  const elapsed = t.start ? (Date.now() - t.start) / 1000 : 0;
  const avg = t.moving > 5 ? t.dist / t.moving : 0;

  $('stDist').textContent  = imperial() ? (t.dist / 1609.344).toFixed(2) : (t.dist / 1000).toFixed(2);
  $('stDistU').textContent = imperial() ? 'mi' : 'km';
  $('stTime').textContent  = fmtClock(elapsed);
  $('stMoving').textContent= fmtClock(t.moving);
  $('stAvg').textContent   = fmtSpeed(avg);
  $('stAvgU').textContent  = 'avg ' + speedUnit();
  $('stMax').textContent   = fmtSpeed(t.max);
  $('stMaxU').textContent  = 'max ' + speedUnit();
  $('stPts').textContent   = t.pts;
  if (altitude != null && !isNaN(altitude)) $('stAlt').textContent = Math.round(altitude);
  if (accuracy != null) $('stAcc').textContent = Math.round(accuracy);
  $('stHead').textContent = S.heading == null ? '—' : `${Math.round(S.heading)}°`;
}

function setFollow(on) {
  S.follow = on;
  $('fabFollow').classList.toggle('on', on);
  if (on) {
    if (!S.gpsOn) startGPS();
    if (S.me) map.panTo(S.me.getLatLng());
    toast('Follow mode on.', 'ok', 1600);
  }
}

/* --- wake lock --- */
async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    S.wakeSentinel = await navigator.wakeLock.request('screen');
    S.wakeSentinel.addEventListener('release', () => { S.wakeSentinel = null; });
  } catch {}
}
function releaseWakeLock() {
  try { S.wakeSentinel?.release(); } catch {}
  S.wakeSentinel = null;
}

/* --- compass --- */
async function enableCompass() {
  const DOE = window.DeviceOrientationEvent;
  if (!DOE) { toast('No orientation sensor.', 'warn'); $('compassToggle').checked = false; return; }
  if (typeof DOE.requestPermission === 'function') {
    try {
      const res = await DOE.requestPermission();
      if (res !== 'granted') throw new Error('denied');
    } catch {
      toast('Compass permission denied.', 'err');
      $('compassToggle').checked = false; return;
    }
  }
  window.addEventListener('deviceorientation', onOrientation, true);
  toast('Compass on.', 'ok');
}
function disableCompass() {
  window.removeEventListener('deviceorientation', onOrientation, true);
  S.heading = null;
  if (S.me) S.me.setIcon(meIcon());
}
function onOrientation(e) {
  const h = e.webkitCompassHeading != null ? e.webkitCompassHeading
          : (e.alpha != null ? 360 - e.alpha : null);
  if (h == null || isNaN(h)) return;
  S.heading = (h + 360) % 360;
  if (S.me) S.me.setIcon(meIcon());
  $('stHead').textContent = `${Math.round(S.heading)}°`;
}

/* --- geofence --- */
function checkGeofence(here) {
  const r = +S.prefs.geofenceRadius;
  S.savedPlaces.forEach(p => {
    const d = haversine(here, p);
    if (d <= r && !S.geofenceHit.has(p.id)) {
      S.geofenceHit.add(p.id);
      toast(`Near “${p.name}” — ${fmtDist(d)} away.`, 'ok', 4200);
    } else if (d > r * 1.4) {
      S.geofenceHit.delete(p.id);
    }
  });
}

/* ------------------------------ MEASURE ------------------------------ */
function toggleMeasure(force) {
  S.measuring = force != null ? force : !S.measuring;
  $('fabMeasure').classList.toggle('on', S.measuring);
  if (S.measuring) {
    toast('Measure: tap points. Tap the tool again to finish.', 'info', 3400);
  } else {
    clearMeasure();
  }
}

function clearMeasure() {
  S.measurePts = [];
  if (S.measureLine) { map.removeLayer(S.measureLine); S.measureLine = null; }
  S.measureMarkers.forEach(m => map.removeLayer(m));
  S.measureMarkers = [];
}

function addMeasurePoint(latlng) {
  S.measurePts.push(latlng);
  const m = L.circleMarker(latlng, {
    renderer: routeRenderer, radius: 5, color: '#fff', weight: 2,
    fillColor: CFG.colors.measure, fillOpacity: 1
  }).addTo(map);
  S.measureMarkers.push(m);

  if (!S.measureLine) {
    S.measureLine = L.polyline(S.measurePts, {
      renderer: routeRenderer, color: CFG.colors.measure,
      weight: 3, dashArray: '7,7'
    }).addTo(map);
  } else {
    S.measureLine.setLatLngs(S.measurePts);
  }

  if (S.measurePts.length > 1) {
    const total = pathLength(S.measurePts.map(p => ({ lat: p.lat, lng: p.lng })));
    m.bindTooltip(fmtDist(total), { permanent: true, direction: 'right', offset: [8, 0] }).openTooltip();
  }
}

/* ------------------------------ DATA I/O ------------------------------ */
function gpxHeader() {
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
         `<gpx version="1.1" creator="Star Map v2" xmlns="http://www.topografix.com/GPX/1/1">\n`;
}
function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function exportTrailGPX() {
  if (!S.trail.length) { toast('No trail recorded yet.', 'warn'); return; }
  const pts = S.trail.map(([lat, lng]) => `      <trkpt lat="${lat}" lon="${lng}"></trkpt>`).join('\n');
  const gpx = `${gpxHeader()}  <trk><name>Star Map trail ${stamp()}</name>\n    <trkseg>\n${pts}\n    </trkseg>\n  </trk>\n</gpx>\n`;
  download(`starmap-trail-${stamp()}.gpx`, gpx, 'application/gpx+xml');
  toast('Trail exported.', 'ok');
}

function exportRouteGPX() {
  const sel = S.routes[S.selectedRoute];
  if (!sel && S.waypoints.length < 2) { toast('Nothing to export.', 'warn'); return; }
  const wpts = S.waypoints.map(w =>
    `  <wpt lat="${w.lat}" lon="${w.lng}"><name>${esc(w.name)}</name></wpt>`).join('\n');
  const line = sel
    ? sel.layer.getLatLngs().map(p => `      <rtept lat="${p.lat}" lon="${p.lng}"></rtept>`).join('\n')
    : S.waypoints.map(w => `      <rtept lat="${w.lat}" lon="${w.lng}"></rtept>`).join('\n');
  const gpx = `${gpxHeader()}${wpts}\n  <rte><name>Star Map route ${stamp()}</name>\n${line}\n  </rte>\n</gpx>\n`;
  download(`starmap-route-${stamp()}.gpx`, gpx, 'application/gpx+xml');
  toast('Route exported.', 'ok');
}

function exportGeoJSON() {
  const features = [];
  S.waypoints.forEach((w, i) => features.push({
    type: 'Feature',
    properties: { name: w.name, kind: 'waypoint', order: i + 1 },
    geometry: { type: 'Point', coordinates: [w.lng, w.lat] }
  }));
  S.savedPlaces.forEach(p => features.push({
    type: 'Feature',
    properties: { name: p.name, kind: 'place' },
    geometry: { type: 'Point', coordinates: [p.lng, p.lat] }
  }));
  const sel = S.routes[S.selectedRoute];
  if (sel) features.push({
    type: 'Feature',
    properties: { kind: 'route', mode: S.mode, distance: sel.distance, duration: sel.duration },
    geometry: { type: 'LineString', coordinates: sel.layer.getLatLngs().map(p => [p.lng, p.lat]) }
  });
  if (S.trail.length > 1) features.push({
    type: 'Feature',
    properties: { kind: 'trail' },
    geometry: { type: 'LineString', coordinates: S.trail.map(([lat, lng]) => [lng, lat]) }
  });
  if (!features.length) { toast('Nothing to export.', 'warn'); return; }
  download(`starmap-${stamp()}.geojson`,
           JSON.stringify({ type: 'FeatureCollection', features }, null, 2),
           'application/geo+json');
  toast('GeoJSON exported.', 'ok');
}

function exportBackup() {
  const backup = {
    _app: 'starmap', _version: 2, _at: new Date().toISOString(),
    prefs: S.prefs, places: S.savedPlaces, routes: S.savedRoutes,
    waypoints: S.waypoints.map(({ id, lat, lng, name }) => ({ id, lat, lng, name }))
  };
  download(`starmap-backup-${stamp()}.json`, JSON.stringify(backup, null, 2), 'application/json');
  toast('Backup downloaded.', 'ok');
}

async function importFile(file) {
  const text = await file.text();
  const name = file.name.toLowerCase();
  try {
    if (name.endsWith('.gpx')) return importGPX(text);
    const json = JSON.parse(text);
    if (json._app === 'starmap') return importBackup(json);
    return importGeoJSON(json);
  } catch (e) {
    toast(`Import failed: ${e.message}`, 'err', 4200);
  }
}

function importGPX(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('malformed GPX');

  const trkpts = Array.from(doc.getElementsByTagName('trkpt'));
  const rtepts = Array.from(doc.getElementsByTagName('rtept'));
  const wpts   = Array.from(doc.getElementsByTagName('wpt'));
  const read   = (n) => [parseFloat(n.getAttribute('lat')), parseFloat(n.getAttribute('lon'))];

  let added = 0;
  if (trkpts.length > 1) {
    S.trail = trkpts.map(read).filter(p => isFinite(p[0]) && isFinite(p[1]));
    if (S.trailLine) map.removeLayer(S.trailLine);
    S.trailLine = L.polyline(S.trail, {
      renderer: routeRenderer, color: CFG.colors.trail, weight: 4, opacity: 0.7
    }).addTo(map);
    map.fitBounds(S.trailLine.getBounds(), { padding: [50, 50] });
    added += S.trail.length;
  }
  const pins = wpts.length ? wpts : rtepts;
  pins.slice(0, 25).forEach((n, i) => {
    const [lat, lng] = read(n);
    const nm = n.getElementsByTagName('name')[0]?.textContent?.trim();
    addWaypoint(lat, lng, nm || `Imported ${i + 1}`, { silent: true });
  });
  renderWaypoints();
  if (S.waypoints.length >= 2 && S.prefs.autoRoute) queueRoute();
  toast(`GPX loaded: ${pins.length} points, ${added} trail fixes.`, 'ok', 3600);
}

function importGeoJSON(json) {
  const feats = json.type === 'FeatureCollection' ? json.features : [json];
  let pts = 0, lines = 0;
  feats.forEach(f => {
    const g = f.geometry; if (!g) return;
    if (g.type === 'Point') {
      addWaypoint(g.coordinates[1], g.coordinates[0], f.properties?.name || `Point ${++pts}`, { silent: true });
    } else if (g.type === 'LineString') {
      L.polyline(g.coordinates.map(c => [c[1], c[0]]),
                 { renderer: routeRenderer, color: CFG.colors.alternate, weight: 3, dashArray: '5,6' }).addTo(map);
      lines++;
    }
  });
  renderWaypoints();
  if (S.waypoints.length >= 2 && S.prefs.autoRoute) queueRoute();
  toast(`GeoJSON loaded: ${pts} points, ${lines} lines.`, 'ok');
}

function importBackup(b) {
  if (b.prefs)  { S.prefs = Object.assign(S.prefs, b.prefs); savePrefs(); applyPrefs(); }
  if (b.places) { S.savedPlaces = b.places; store.set('places', S.savedPlaces); renderPlaces(); }
  if (b.routes) { S.savedRoutes = b.routes; store.set('routes', S.savedRoutes); renderSavedRoutes(); }
  if (b.waypoints) {
    clearWaypoints();
    b.waypoints.forEach(w => addWaypoint(w.lat, w.lng, w.name, { silent: true }));
    renderWaypoints();
  }
  toast('Backup restored.', 'ok');
}

/* Set when the app was opened straight to a tab (manifest shortcut). The
   install banner collapses the sheet, which would hide the tab the user
   deliberately asked for, so it stays quiet in that case. */
let deepLinked = false;

/* --- share link --- */
function buildShareURL() {
  const c = map.getCenter();
  const parts = [`@${c.lat.toFixed(5)},${c.lng.toFixed(5)},${map.getZoom()}z`, `m=${S.mode}`];
  if (S.waypoints.length) {
    parts.push('w=' + S.waypoints.map(w => `${w.lat.toFixed(5)},${w.lng.toFixed(5)}`).join('|'));
  }
  return `${location.origin}${location.pathname}#${parts.join('&')}`;
}

function applyHash() {
  const h = decodeURIComponent(location.hash.replace(/^#/, ''));
  if (!h) return false;
  let moved = false;
  h.split('&').forEach(part => {
    if (part.startsWith('@')) {
      const [lat, lng, z] = part.slice(1).replace('z', '').split(',').map(Number);
      if (isFinite(lat) && isFinite(lng)) { map.setView([lat, lng], clamp(z || 13, 2, 19)); moved = true; }
    } else if (part.startsWith('w=')) {
      part.slice(2).split('|').forEach((pair, i) => {
        const [lat, lng] = pair.split(',').map(Number);
        if (isFinite(lat) && isFinite(lng)) addWaypoint(lat, lng, `Shared ${i + 1}`, { silent: true });
      });
    } else if (part.startsWith('m=')) {
      const m = part.slice(2);
      if (OSRM_PROFILE[m]) setMode(m);
    } else if (part.startsWith('tab=')) {
      // manifest shortcut target
      const t = document.querySelector(`.tab[data-pane="${part.slice(4)}"]`);
      if (t) { t.click(); deepLinked = true; }
    } else if (part === 'follow=1') {
      setTimeout(() => setFollow(true), 400);
    }
  });
  if (S.waypoints.length) { renderWaypoints(); queueRoute(); }
  return moved;
}

async function copyShare() {
  const url = buildShareURL();
  try {
    if (navigator.share && /iPhone|iPad|Android/.test(navigator.userAgent)) {
      await navigator.share({ title: 'Star Map', url });
      return;
    }
    await navigator.clipboard.writeText(url);
    toast('Link copied.', 'ok');
  } catch {
    prompt('Copy this link:', url);
  }
}

function openExternalMaps() {
  if (!S.waypoints.length) { toast('Add waypoints first.', 'warn'); return; }
  const pts = S.waypoints.map(w => `${w.lat},${w.lng}`);
  const dest = pts.pop();
  const via = pts.length > 1 ? `&waypoints=${pts.slice(1).join('|')}` : '';
  const origin = pts.length ? `&origin=${pts[0]}` : '';
  const mode = { driving: 'driving', cycling: 'bicycling', foot: 'walking' }[S.mode];
  window.open(
    `https://www.google.com/maps/dir/?api=1&destination=${dest}${origin}${via}&travelmode=${mode}`,
    '_blank', 'noopener'
  );
}

/* ------------------------------ PREFS ------------------------------ */
function savePrefs() { store.set('prefs', S.prefs); }

function applyTheme() {
  let t = S.prefs.theme;
  if (t === 'auto') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
  $('fabTheme').innerHTML = `<i class="fa-solid ${t === 'dark' ? 'fa-sun' : 'fa-moon'}"></i>`;
  document.querySelector('meta[name=theme-color]').content = t === 'dark' ? '#0b0f14' : '#f2f4f7';
}

function applyPrefs() {
  applyTheme();
  $('unitSel').value        = S.prefs.units;
  $('themeSel').value       = S.prefs.theme;
  $('hiAccToggle').checked  = S.prefs.hiAcc;
  $('autoRouteToggle').checked = S.prefs.autoRoute;
  $('tapAddToggle').checked = S.prefs.tapAdd;
  $('coordToggle').checked  = S.prefs.showCoords;
  $('trailCap').value       = String(S.prefs.trailCap);
  $('routerSel').value      = S.prefs.router;
  $('routerCustom').value   = S.prefs.routerCustom;
  $('routerCustomWrap').style.display = S.prefs.router === 'custom' ? '' : 'none';
  $('labelToggle').checked  = S.prefs.labels;
  $('overlayOpacity').value = Math.round(S.prefs.overlayOpacity * 100);
  $('geofenceToggle').checked = S.prefs.geofence;
  $('geofenceRadius').value = String(S.prefs.geofenceRadius);
  $('trailToggle').checked  = S.prefs.trail;
  $('wakeToggle').checked   = S.prefs.wakeLock;
  $('coordPill').style.display = S.prefs.showCoords ? '' : 'none';
  $('tfEnable').checked   = S.prefs.tfEnabled;
  $('tfProvider').value   = S.prefs.tfProvider;
  $('tfKey').value        = S.prefs.tfKey;
  $('tfCustom').value     = S.prefs.tfCustom;
  $('tfStyle').value      = S.prefs.tfStyle;
  $('tfRefresh').value    = String(S.prefs.tfRefresh);
  $('tfOpacity').value    = Math.round(S.prefs.tfOpacity * 100);
  $('tfRecord').checked   = S.prefs.tfRecord;
  $('tfTomtomWrap').style.display = S.prefs.tfProvider === 'tomtom' ? '' : 'none';
  $('tfCustomWrap').style.display = S.prefs.tfProvider === 'custom' ? '' : 'none';
  $('hudSpeedUnit').textContent = speedUnit();
  updateTripPanel();
  renderWaypoints();
  if (S.routes.length) { renderRouteCards(); renderSteps(S.routes[S.selectedRoute]?.steps); }
}

function setMode(m) {
  S.mode = m;
  $$('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
}

/* ------------------------------ UI WIRING ------------------------------ */
/* sheet + tabs */
$('sheetHead').addEventListener('click', () => $('sheet').classList.toggle('open'));
$$('.tab').forEach(btn => btn.addEventListener('click', () => {
  $$('.tab').forEach(b => b.classList.remove('on'));
  $$('.pane').forEach(p => p.classList.remove('on'));
  btn.classList.add('on');
  $(`pane-${btn.dataset.pane}`).classList.add('on');
  $('sheet').classList.add('open');
}));

/* FABs */
$('fabLocate').onclick = () => {
  if (S.me) { map.flyTo(S.me.getLatLng(), Math.max(map.getZoom(), 16), { duration: 0.9 }); }
  else { startGPS(); toast('Getting a fix…', 'info'); }
};
$('fabFollow').onclick  = () => setFollow(!S.follow);
$('fabGps').onclick     = () => (S.gpsOn ? stopGPS() : startGPS());
$('fabZoomIn').onclick  = () => map.zoomIn();
$('fabZoomOut').onclick = () => map.zoomOut();
$('fabMeasure').onclick = () => toggleMeasure();
$('fabTraffic').onclick = () => toggleTraffic();
$('fabTheme').onclick   = () => {
  S.prefs.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  savePrefs(); applyTheme(); $('themeSel').value = S.prefs.theme;
};
$('fabFull').onclick = () => {
  const el = document.documentElement;
  if (!document.fullscreenElement) el.requestFullscreen?.().catch(() => toast('Fullscreen blocked.', 'warn'));
  else document.exitFullscreen?.();
};
$('fabHelp').onclick  = () => $('helpModal').classList.add('on');
$('helpClose').onclick = () => $('helpModal').classList.remove('on');
$('helpModal').addEventListener('click', e => { if (e.target.id === 'helpModal') e.currentTarget.classList.remove('on'); });

/* search */
$('searchInput').addEventListener('input', e => runSuggest(e.target.value.trim()));
$('searchClear').onclick = () => { $('searchInput').value = ''; hideSuggest(); $('searchInput').focus(); };
$('searchInput').addEventListener('keydown', e => {
  const n = suggestItems.length;
  if (e.key === 'ArrowDown' && n) {
    e.preventDefault(); suggestIndex = (suggestIndex + 1) % n; highlightSuggest();
  } else if (e.key === 'ArrowUp' && n) {
    e.preventDefault(); suggestIndex = (suggestIndex - 1 + n) % n; highlightSuggest();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (n) pickSuggest(suggestIndex >= 0 ? suggestIndex : 0);
  } else if (e.key === 'Escape') { hideSuggest(); }
});
function highlightSuggest() {
  $$('#suggest li').forEach((li, i) => li.classList.toggle('hl', i === suggestIndex));
}
$('suggest').addEventListener('click', e => {
  const li = e.target.closest('li[data-sug]');
  if (li) pickSuggest(+li.dataset.sug);
});

/* waypoint list delegation — id based, never index based */
$('wpList').addEventListener('click', e => {
  const btn = e.target.closest('button[data-act]');
  const li = e.target.closest('li[data-wp]');
  if (!li) return;
  const id = li.dataset.wp;
  const wp = S.waypoints.find(w => w.id === id);
  if (!btn) { if (wp) { map.flyTo([wp.lat, wp.lng], 16); openWpPopup(wp); } return; }
  switch (btn.dataset.act) {
    case 'up':   moveWaypoint(id, -1); break;
    case 'down': moveWaypoint(id, +1); break;
    case 'go':   if (wp) map.flyTo([wp.lat, wp.lng], Math.max(map.getZoom(), 16)); break;
    case 'del':  removeWaypoint(id); break;
  }
});

$('addHereBtn').onclick = () => {
  if (!S.me) { toast('No GPS fix yet.', 'warn'); startGPS(); return; }
  const p = S.me.getLatLng();
  addWaypoint(p.lat, p.lng, 'My location');
};
$('addCenterBtn').onclick = () => {
  const c = map.getCenter();
  addWaypoint(c.lat, c.lng, 'Map centre');
};
$('clearWpBtn').onclick = () => {
  if (!S.waypoints.length) return;
  if (confirm(`Remove all ${S.waypoints.length} waypoints?`)) clearWaypoints();
};
$('reverseBtn').onclick = async () => {
  if (!S.waypoints.length) { toast('No waypoints.', 'warn'); return; }
  toast('Looking up addresses… (1/sec, be patient)', 'info', 3000);
  for (const w of S.waypoints) {
    const nm = await reverseGeocode(w.lat, w.lng);
    if (nm) { w.name = nm; renderWaypoints(); }
    await new Promise(r => setTimeout(r, 1100));   // respect Nominatim policy
  }
  toast('Names updated.', 'ok');
};

/* route pane */
$('modeSeg').addEventListener('click', e => {
  const b = e.target.closest('button[data-mode]');
  if (!b) return;
  setMode(b.dataset.mode);
  if (S.waypoints.length >= 2) calculateRoutes();
});
$('calcBtn').onclick      = () => calculateRoutes();
$('fitBtn').onclick       = () => fitRoute();
$('clearRouteBtn').onclick= () => clearRoutes();
$('reverseWpBtn').onclick = () => {
  if (S.waypoints.length < 2) return;
  S.waypoints.reverse();
  renderWaypoints();
  if (S.prefs.autoRoute) queueRoute();
  toast('Direction reversed.', 'ok', 1600);
};
$('routeCards').addEventListener('click', e => {
  const c = e.target.closest('[data-route]');
  if (c) selectRoute(+c.dataset.route);
});
$('stepsList').addEventListener('click', e => {
  const li = e.target.closest('li[data-step]');
  if (!li) return;
  const st = S.routes[S.selectedRoute]?.steps[+li.dataset.step];
  const loc = st?.maneuver?.location;
  if (loc) map.flyTo([loc[1], loc[0]], 17, { duration: 0.8 });
});

/* places */
$('savePosBtn').onclick = () => {
  if (!S.me) { toast('No GPS fix yet.', 'warn'); return; }
  const p = S.me.getLatLng();
  const n = prompt('Name this place:', 'My spot');
  if (n && n.trim()) savePlace(n.trim(), p.lat, p.lng);
};
$('saveCenterBtn').onclick = () => {
  const c = map.getCenter();
  const n = prompt('Name this place:', 'Marked spot');
  if (n && n.trim()) savePlace(n.trim(), c.lat, c.lng);
};
$('placeFilter').addEventListener('input', renderPlaces);
$('placeList').addEventListener('click', e => {
  const li = e.target.closest('li[data-place]');
  const btn = e.target.closest('button[data-act]');
  if (!li) return;
  const p = S.savedPlaces.find(x => x.id === li.dataset.place);
  if (!p) return;
  if (!btn) { map.flyTo([p.lat, p.lng], 16); return; }
  if (btn.dataset.act === 'add') addWaypoint(p.lat, p.lng, p.name);
  if (btn.dataset.act === 'go')  map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), 16));
  if (btn.dataset.act === 'del' && confirm(`Delete “${p.name}”?`)) deletePlace(p.id);
});
$('clearPlacesBtn').onclick = () => {
  if (!S.savedPlaces.length) return;
  if (!confirm(`Delete all ${S.savedPlaces.length} saved places? This cannot be undone.`)) return;
  S.savedPlaces = []; store.set('places', []); renderPlaces();
  toast('All places deleted.', 'ok');
};
$('geofenceToggle').onchange = e => { S.prefs.geofence = e.target.checked; savePrefs(); };
$('geofenceRadius').onchange = e => { S.prefs.geofenceRadius = +e.target.value; savePrefs(); };

/* saved routes */
$('saveRouteBtn').onclick = () => {
  if (S.waypoints.length < 2) { toast('Need 2+ waypoints.', 'warn'); return; }
  const n = prompt('Route name:', `Route ${S.savedRoutes.length + 1}`);
  if (!n || !n.trim()) return;
  S.savedRoutes.push({
    id: uid(), name: n.trim().slice(0, 60), mode: S.mode,
    pts: S.waypoints.map(({ lat, lng, name }) => ({ lat, lng, name }))
  });
  store.set('routes', S.savedRoutes);
  renderSavedRoutes();
  toast('Route saved.', 'ok');
};
$('routeList').addEventListener('click', e => {
  const li = e.target.closest('li[data-sroute]');
  const btn = e.target.closest('button[data-act]');
  if (!li || !btn) return;
  const r = S.savedRoutes.find(x => x.id === li.dataset.sroute);
  if (!r) return;
  if (btn.dataset.act === 'load') {
    clearWaypoints();
    setMode(r.mode || 'driving');
    r.pts.forEach(p => addWaypoint(p.lat, p.lng, p.name, { silent: true }));
    renderWaypoints();
    calculateRoutes();
    toast(`Loaded “${r.name}”.`, 'ok');
  }
  if (btn.dataset.act === 'del' && confirm(`Delete route “${r.name}”?`)) {
    S.savedRoutes = S.savedRoutes.filter(x => x.id !== r.id);
    store.set('routes', S.savedRoutes);
    renderSavedRoutes();
  }
});

/* trip */
$('trailToggle').onchange = e => { S.prefs.trail = e.target.checked; savePrefs(); };
$('wakeToggle').onchange  = e => {
  S.prefs.wakeLock = e.target.checked; savePrefs();
  if (e.target.checked && S.gpsOn) requestWakeLock(); else releaseWakeLock();
  if (e.target.checked && !('wakeLock' in navigator)) toast('Wake Lock unsupported in this browser.', 'warn');
};
$('compassToggle').onchange = e => (e.target.checked ? enableCompass() : disableCompass());
$('resetTripBtn').onclick  = resetTrip;
$('clearTrailBtn').onclick = clearTrail;

/* layers */
$('baseList').addEventListener('click', e => {
  const li = e.target.closest('li[data-base]');
  if (li) setBase(li.dataset.base);
});
$('radarToggle').onchange = e => (e.target.checked ? enableRadar() : disableRadar());
$('hillToggle').onchange  = e => {
  if (e.target.checked) hillLayer.setOpacity(S.prefs.overlayOpacity * 0.5).addTo(map);
  else map.removeLayer(hillLayer);
};
$('labelToggle').onchange = e => { S.prefs.labels = e.target.checked; savePrefs(); syncLabelLayer(); };
$('overlayOpacity').oninput = e => {
  S.prefs.overlayOpacity = +e.target.value / 100;
  radarLayer?.setOpacity(S.prefs.overlayOpacity);
  if (map.hasLayer(hillLayer)) hillLayer.setOpacity(S.prefs.overlayOpacity * 0.5);
};
$('overlayOpacity').onchange = savePrefs;

/* data */
$('expGpxTrail').onclick = exportTrailGPX;
$('expGpxRoute').onclick = exportRouteGPX;
$('expGeoJson').onclick  = exportGeoJSON;
$('expBackup').onclick   = exportBackup;
$('importBtn').onclick   = () => $('importFile').click();
$('importFile').onchange = e => {
  const f = e.target.files?.[0];
  if (f) importFile(f);
  e.target.value = '';
};
$('shareBtn').onclick     = copyShare;
$('shareGmapBtn').onclick = openExternalMaps;
$('wipeBtn').onclick = () => {
  if (!confirm('Delete ALL saved places, routes and settings from this browser? This cannot be undone.')) return;
  store.keys().forEach(k => localStorage.removeItem(k));
  toast('Local data wiped. Reloading…', 'ok');
  setTimeout(() => location.reload(), 900);
};
function refreshStorageUsed() {
  const b = store.bytes();
  $('storageUsed').textContent = b < 1024 ? `${b} B` : `${(b / 1024).toFixed(1)} KB`;
}

/* settings */
$('unitSel').onchange   = e => { S.prefs.units = e.target.value; savePrefs(); applyPrefs(); };
$('themeSel').onchange  = e => { S.prefs.theme = e.target.value; savePrefs(); applyTheme(); };
$('hiAccToggle').onchange = e => {
  S.prefs.hiAcc = e.target.checked; savePrefs();
  if (S.gpsOn) startGPS();                       // restart watch with new accuracy
};
$('autoRouteToggle').onchange = e => { S.prefs.autoRoute = e.target.checked; savePrefs(); };
$('tapAddToggle').onchange    = e => { S.prefs.tapAdd = e.target.checked; savePrefs(); };
$('coordToggle').onchange     = e => {
  S.prefs.showCoords = e.target.checked; savePrefs();
  $('coordPill').style.display = e.target.checked ? '' : 'none';
};
$('trailCap').onchange   = e => { S.prefs.trailCap = +e.target.value; savePrefs(); };
$('routerSel').onchange  = e => {
  S.prefs.router = e.target.value; savePrefs();
  $('routerCustomWrap').style.display = e.target.value === 'custom' ? '' : 'none';
};
$('routerCustom').onchange = e => { S.prefs.routerCustom = e.target.value.trim(); savePrefs(); };

/* map interaction */
map.on('click', e => {
  if (S.measuring) { addMeasurePoint(e.latlng); return; }
  if (!S.prefs.tapAdd) return;
  addWaypoint(e.latlng.lat, e.latlng.lng);
});
map.on('contextmenu', e => {
  const n = prompt('Save this spot as:', 'New place');
  if (n && n.trim()) savePlace(n.trim(), e.latlng.lat, e.latlng.lng);
});
map.on('mousemove', e => {
  if (S.prefs.showCoords) $('coordText').textContent = fmtLatLng(e.latlng.lat, e.latlng.lng);
});
map.on('dragstart', () => { if (S.follow) setFollow(false); });
map.on('moveend', () => {
  if (S.prefs.showCoords && 'ontouchstart' in window) {
    const c = map.getCenter();
    $('coordText').textContent = fmtLatLng(c.lat, c.lng);
  }
});

/* keyboard */
document.addEventListener('keydown', e => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
  if (e.key === 'Escape') {
    hideSuggest();
    $('helpModal').classList.remove('on');
    if (S.measuring) toggleMeasure(false);
    document.activeElement?.blur();
    return;
  }
  if (typing) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    const last = S.undoStack.pop();
    if (last?.type === 'wp') removeWaypoint(last.id);
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  switch (e.key.toLowerCase()) {
    case ' ': e.preventDefault(); $('sheet').classList.toggle('open'); break;
    case 'l': $('fabLocate').click(); break;
    case 'f': setFollow(!S.follow); break;
    case 'g': S.gpsOn ? stopGPS() : startGPS(); break;
    case 'r': calculateRoutes(); break;
    case 'm': toggleMeasure(); break;
    case 't': toggleTraffic(); break;
    case 'd': $('fabTheme').click(); break;
    case '?': $('helpModal').classList.add('on'); break;
    case '/': e.preventDefault(); $('sheet').classList.add('open'); $('searchInput').focus(); break;
  }
});

/* lifecycle */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (S.prefs.wakeLock && S.gpsOn) requestWakeLock();
    setTimeout(() => map.invalidateSize(), 120);
  }
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (S.prefs.theme === 'auto') applyTheme();
});
window.addEventListener('resize', debounce(() => map.invalidateSize(), 180));
window.addEventListener('beforeunload', () => { if (S.watchId != null) navigator.geolocation.clearWatch(S.watchId); });
window.addEventListener('error', e => console.error('[starmap]', e.message));

/* periodic clock refresh so elapsed time ticks without a GPS fix */
setInterval(() => { if (S.trip.start) updateTripPanel(); }, 1000);
setInterval(refreshStorageUsed, 5000);

/* ==========================================================================
   SINGLE-FILE BUILD — Offline pane
   Replaces the service-worker block from the PWA build. Same UI, same element
   ids, same 6 000-tile fair-use cap; storage is IndexedDB instead of the
   Cache API, and there is no app-shell caching to do because the app *is*
   the file you opened.
   ========================================================================== */
const DL_HARD_CAP  = 6000;
const DL_WARN_AT   = 1200;
const DL_WORKERS   = 4;
const DL_THROTTLE  = 30;
const TILE_LIMIT   = 25000;
const BYTES_PER_TILE = 22 * 1024;

let dlRunning = false, dlCancel = false;
let dlRegionBox = null;

function fmtBytes(n) {
  if (!isFinite(n) || n <= 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ------------------------- init ------------------------- */
async function initOffline() {
  const status = $('swStatus'), badge = $('swBadge');
  status.textContent = 'Checking storage…';

  await tdb();   // resolves to null instead of hanging; see offline-idb-core

  if (!tileCacheAvailable) {
    status.innerHTML = esc(tileCacheReason || 'Tile storage is unavailable.');
    badge.textContent = 'Unavailable'; badge.className = 'badge bad';
    $('dlStart').disabled = true;
    $('dlWarn').style.display = 'block';
    $('dlWarn').innerHTML =
      'Offline tile caching is off. The map still works online. ' +
      'To turn caching on, serve this file over <code>http://localhost</code> ' +
      'instead of opening it from disk.';
    if (location.protocol === 'file:') {
      toast('Opened from disk — offline tile caching is disabled. See the Offline tab.', 'warn', 6000);
    }
    return;
  }

  status.innerHTML = 'IndexedDB tile cache ready. No service worker in this build — ' +
                     'the app is a single file, so it always opens offline.';
  badge.textContent = 'Ready'; badge.className = 'badge ok';

  const removed = await tileTrim(TILE_LIMIT);
  if (removed) toast(`Tile cache over limit — evicted ${removed} oldest tiles.`, 'warn', 4000);
  refreshCacheStats();
}

/* ------------------------- slippy tile maths ------------------------- */
const lon2tile = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
function lat2tile(lat, z) {
  const r = clamp(lat, -85.05112878, 85.05112878) * Math.PI / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

/** Rebuild a tile URL exactly the way Leaflet would, for any z/x/y. */
function tileUrlFor(layer, x, y, z) {
  const subs = layer.options.subdomains || 'abc';
  const s = subs[Math.abs(x + y) % subs.length];
  return L.Util.template(layer._url, L.Util.extend({
    r: L.Browser.retina ? '@2x' : '',
    s, x, y, z
  }, layer.options));
}

function tilesForLayer(layer, bounds, zMin, zMax) {
  const out = [];
  const cap = Math.min(zMax, layer.options.maxZoom ?? 19);
  for (let z = Math.max(0, zMin); z <= cap; z++) {
    const n = 2 ** z;
    const x0 = clamp(lon2tile(bounds.getWest(),  z), 0, n - 1);
    const x1 = clamp(lon2tile(bounds.getEast(),  z), 0, n - 1);
    const y0 = clamp(lat2tile(bounds.getNorth(), z), 0, n - 1);
    const y1 = clamp(lat2tile(bounds.getSouth(), z), 0, n - 1);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) out.push(tileUrlFor(layer, x, y, z));
    }
  }
  return out;
}

function plannedTiles() {
  const bounds = map.getBounds();
  const zMin = map.getZoom();
  const zMax = zMin + (+$('dlDepth').value || 0);
  const layers = [baseLayer];
  if ($('dlOverlays').checked) {
    if (map.hasLayer(labelLayer)) layers.push(labelLayer);
    if (map.hasLayer(hillLayer))  layers.push(hillLayer);
  }
  const urls = new Set();
  layers.forEach(l => tilesForLayer(l, bounds, zMin, zMax).forEach(u => urls.add(u)));
  return { urls: [...urls], zMin, zMax: Math.min(zMax, baseLayer.options.maxZoom ?? 19) };
}

function updateEstimate() {
  if (!$('pane-offline').classList.contains('on')) return;
  const { urls, zMin, zMax } = plannedTiles();
  $('dlTiles').textContent = urls.length.toLocaleString();
  $('dlSize').textContent  = fmtBytes(urls.length * BYTES_PER_TILE);
  $('dlZooms').textContent = zMin === zMax ? `z${zMin}` : `z${zMin}–${zMax}`;

  const warn = $('dlWarn');
  $('dlStart').disabled = urls.length === 0 || urls.length > DL_HARD_CAP || dlRunning;
  if (urls.length > DL_HARD_CAP) {
    warn.style.display = 'block';
    warn.innerHTML = `<b>${urls.length.toLocaleString()} tiles</b> exceeds the ${DL_HARD_CAP.toLocaleString()} cap. Zoom in or drop a detail level.`;
  } else if (urls.length > DL_WARN_AT) {
    warn.style.display = 'block';
    warn.innerHTML = `Large job — ${urls.length.toLocaleString()} tiles, roughly ${Math.ceil(urls.length * DL_THROTTLE / DL_WORKERS / 1000)} s. Keep this tab open.`;
  } else {
    warn.style.display = 'none';
  }
  showRegionBox();
}

function showRegionBox() {
  hideRegionBox();
  dlRegionBox = L.rectangle(map.getBounds().pad(-0.004), {
    renderer: routeRenderer, className: 'dl-region',
    color: '#2f6fed', weight: 0, fill: false, interactive: false
  }).addTo(map);
}
function hideRegionBox() {
  if (dlRegionBox) { map.removeLayer(dlRegionBox); dlRegionBox = null; }
}

/* ------------------------- the download ------------------------- */
async function downloadArea() {
  if (dlRunning) return;
  const { urls } = plannedTiles();
  if (!urls.length) { toast('Nothing to download.', 'warn'); return; }
  if (urls.length > DL_HARD_CAP) { toast('Over the fair-use cap.', 'err'); return; }

  dlRunning = true; dlCancel = false;
  $('dlStart').style.display = 'none';
  $('dlStop').style.display = '';
  $('dlBarWrap').style.display = 'block';
  $('dlProgress').style.display = 'block';

  const queue = urls.slice();
  const total = urls.length;
  let done = 0, stored = 0, reused = 0, failed = 0, bytes = 0;

  const paint = () => {
    $('dlBar').style.width = `${((done / total) * 100).toFixed(1)}%`;
    $('dlProgress').textContent =
      `${done.toLocaleString()} / ${total.toLocaleString()} · ${stored} new · ${reused} already cached` +
      (failed ? ` · ${failed} failed` : '') +
      (bytes ? ` · ${fmtBytes(bytes)}` : '');
  };
  paint();

  const worker = async () => {
    while (queue.length && !dlCancel) {
      const url = queue.pop();
      try {
        if (await tileGet(url)) {
          reused++;
        } else {
          const res = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'no-store' });
          if (res.ok) {
            const blob = await res.blob();
            if (await tilePut(url, blob)) { bytes += blob.size; stored++; }
            else { failed++; }
          } else { failed++; }
        }
      } catch { failed++; }
      done++;
      if (done % 4 === 0 || done === total) paint();
      if (DL_THROTTLE) await sleep(DL_THROTTLE);
    }
  };

  try {
    await Promise.all(Array.from({ length: DL_WORKERS }, worker));
  } catch (e) {
    toast(`Download error: ${e.message}`, 'err');
  }

  paint();
  dlRunning = false;
  $('dlStart').style.display = '';
  $('dlStop').style.display = 'none';
  $('dlStart').disabled = false;

  if (dlCancel) {
    toast(`Stopped — ${stored} tiles saved before cancelling.`, 'warn', 4000);
  } else if (failed === total) {
    toast('Every tile failed. Check the network, or this base layer blocks CORS.', 'err', 5000);
  } else {
    toast(`Area cached: ${stored} new tiles, ${fmtBytes(bytes)}.`, 'ok', 4500);
  }

  const removed = await tileTrim(TILE_LIMIT);
  if (removed) toast(`Cache over limit — evicted ${removed} oldest tiles.`, 'warn', 4000);
  refreshCacheStats();
}

/* ------------------------- cache stats ------------------------- */
async function refreshCacheStats() {
  const { count, bytes } = await tileStats();
  $('cacheTiles').textContent = count.toLocaleString();
  $('cacheShell').textContent = 'inlined in this file';

  let line = fmtBytes(bytes);
  if (navigator.storage?.estimate) {
    try {
      const est = await navigator.storage.estimate();
      if (est.quota) line += ` · ${((est.usage / est.quota) * 100).toFixed(1)}% of quota`;
    } catch {}
  }
  $('cacheBytes').textContent = line;
}

function setNetBadge() {
  const on = navigator.onLine;
  const b = $('netBadge');
  b.textContent = on ? 'Online' : 'Offline';
  b.className = `badge ${on ? 'ok' : 'mid'}`;
  $('offlinePill').style.display = on ? 'none' : '';
}

/* ------------------------- wiring ------------------------- */
$('dlDepth').onchange    = updateEstimate;
$('dlOverlays').onchange = updateEstimate;
$('dlStart').onclick     = downloadArea;
$('dlStop').onclick      = () => { dlCancel = true; toast('Stopping…', 'warn', 1500); };
$('cacheRefresh').onclick = () => { refreshCacheStats(); toast('Stats refreshed.', 'info', 1400); };

$('cacheClearTiles').onclick = async () => {
  const n = $('cacheTiles').textContent;
  if (!confirm(`Delete all ${n} cached map tiles? Offline areas will stop working until you download them again.`)) return;
  await tileClear();
  refreshCacheStats();
  toast('Tile cache cleared.', 'ok');
};

$('cacheClearAll').onclick = async () => {
  if (!confirm('Delete every cached tile and all saved places, routes and settings? This cannot be undone.')) return;
  await tileClear();
  store.keys().forEach(k => localStorage.removeItem(k));
  toast('Everything cleared. Reloading…', 'ok');
  setTimeout(() => location.reload(), 900);
};

$('persistBtn').onclick = async () => {
  if (!navigator.storage?.persist) { toast('Not supported in this browser.', 'warn'); return; }
  const already = await navigator.storage.persisted?.();
  if (already) { $('persistBtn').textContent = 'Granted'; toast('Already persistent.', 'ok'); return; }
  const ok = await navigator.storage.persist();
  $('persistBtn').textContent = ok ? 'Granted' : 'Denied';
  toast(ok ? 'Storage is now persistent — the browser will not evict it.'
           : 'Denied. Browsers usually grant this only to installed or frequently used sites.',
        ok ? 'ok' : 'warn', 4500);
};

window.addEventListener('online',  () => { setNetBadge(); toast('Back online.', 'ok', 2000); });
window.addEventListener('offline', () => { setNetBadge(); toast('Offline — cached tiles only.', 'warn', 3500); });
map.on('moveend zoomend', debounce(updateEstimate, 300));

$$('.tab').forEach(btn => btn.addEventListener('click', () => {
  if (btn.dataset.pane === 'offline') { updateEstimate(); refreshCacheStats(); }
  else hideRegionBox();
}));



/* ==========================================================================
   TRAFFIC
   Two independent layers behind one toggle:

     live     real congestion raster tiles from a commercial provider, using
              the user's own key. Never cached — a stale congestion tile is a
              lie, so both the service worker and the IndexedDB layer skip it.

     typical  built from the user's own recorded speeds, bucketed by
              day-of-week and hour. No free historical-traffic service exists;
              rather than fabricate one, this shows real personal data and says
              plainly that is what it is.
   ========================================================================== */

const TF_CELL   = 0.0005;        // ~55 m grid
const TF_MINACC = 50;            // metres; worse fixes are too noisy to bucket
const TF_MINSPD = 0.8;           // m/s; below this you are stopped, not driving
const TF_MAXCELLS = 20000;       // prune beyond this
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* cellKey -> { f: freeFlowMps, s: { "day_hour": [sumMps, count] } } */
let TF = store.get('traffic', {});
let tfLayer = null;              // live raster
let tfTypicalLayer = null;       // canvas overlay
let tfTimer = null;
let tfSelDay = new Date().getDay();
let tfSelHour = new Date().getHours();
let tfFollowNow = true;

const tfRenderer = L.canvas({ padding: 0.3 });
const cellKey = (lat, lng) => `${Math.round(lat / TF_CELL)},${Math.round(lng / TF_CELL)}`;
const cellCentre = (key) => {
  const [a, b] = key.split(',').map(Number);
  return [a * TF_CELL, b * TF_CELL];
};
const slotKey = (d, h) => `${d}_${h}`;

/* ------------------------- recording ------------------------- */
const persistTraffic = debounce(() => {
  if (Object.keys(TF).length > TF_MAXCELLS) pruneTraffic();
  if (!store.set('traffic', TF)) {
    // out of quota — drop the thinnest data and try once more
    pruneTraffic(0.5);
    store.set('traffic', TF);
  }
}, 4000);

/** Drop the least-sampled cells first. */
function pruneTraffic(fraction) {
  const keys = Object.keys(TF);
  const target = fraction ? Math.floor(keys.length * fraction) : Math.floor(TF_MAXCELLS * 0.8);
  if (keys.length <= target) return;
  const weight = (k) => Object.values(TF[k].s).reduce((n, v) => n + v[1], 0);
  keys.sort((a, b) => weight(a) - weight(b));
  for (const k of keys.slice(0, keys.length - target)) delete TF[k];
}

function recordSpeedSample(lat, lng, mps, accuracy, when) {
  if (!S.prefs.tfRecord) return;
  if (!isFinite(mps) || mps < TF_MINSPD) return;
  if (accuracy != null && accuracy > TF_MINACC) return;

  const d = new Date(when);
  const key = cellKey(lat, lng);
  const cell = TF[key] || (TF[key] = { f: 0, s: {} });
  const sk = slotKey(d.getDay(), d.getHours());
  const bucket = cell.s[sk] || (cell.s[sk] = [0, 0]);
  bucket[0] += mps;
  bucket[1] += 1;
  if (mps > cell.f) cell.f = mps;      // best speed ever seen here ≈ free flow
  persistTraffic();
}

/* ------------------------- colours ------------------------- */
/** ratio of typical speed to this cell's own free-flow speed */
function congestionColor(ratio) {
  if (ratio >= 0.85) return '#1f9e4a';
  if (ratio >= 0.65) return '#7ec74f';
  if (ratio >= 0.45) return '#f5b93c';
  if (ratio >= 0.25) return '#f2683c';
  return '#d92b2b';
}

/* ------------------------- live layer ------------------------- */
function liveTrafficURL() {
  if (S.prefs.tfProvider === 'custom') {
    const t = (S.prefs.tfCustom || '').trim();
    return t || null;
  }
  const key = (S.prefs.tfKey || '').trim();
  if (!key) return null;
  const style = S.prefs.tfStyle || 'relative0';
  return `https://api.tomtom.com/traffic/map/4/tile/flow/${style}/{z}/{x}/{y}.png` +
         `?key=${encodeURIComponent(key)}&_nocache=1`;
}

function buildLiveTraffic() {
  destroyLiveTraffic();
  const tpl = liveTrafficURL();
  const warn = $('tfLiveWarn');

  if (!tpl) {
    warn.style.display = 'block';
    warn.innerHTML = S.prefs.tfProvider === 'custom'
      ? 'Enter a tile URL template above.'
      : 'Enter your TomTom API key above. Live congestion is a paid data product — there is no free source to fall back on.';
    $('tfState').textContent = 'On — live provider not configured';
    return false;
  }
  warn.style.display = 'none';

  tfLayer = mkTileLayer(withCacheBuster(tpl), {
    maxZoom: 22, opacity: S.prefs.tfOpacity, noCache: true, crossOrigin: false,
    attribution: S.prefs.tfProvider === 'tomtom'
      ? '<a href="https://www.tomtom.com">&copy; TomTom</a> traffic'
      : 'traffic data &copy; provider',
    errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
  }).addTo(map);

  tfLayer.on('tileerror', onLiveTileError);
  tfLayer.once('load', () => {
    $('tfUpdated').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  });

  scheduleTrafficRefresh();
  $('tfState').textContent = 'On — live';
  return true;
}

let liveErrorCount = 0;
function onLiveTileError() {
  liveErrorCount++;
  if (liveErrorCount !== 4) return;      // one bad tile means nothing; four means a bad key
  const warn = $('tfLiveWarn');
  warn.style.display = 'block';
  warn.innerHTML = 'Tiles are failing to load. Usual causes: wrong or expired API key, ' +
                   'daily quota reached, or a URL template without <code>{z}/{x}/{y}</code>.';
}

const withCacheBuster = (tpl) =>
  tpl + (tpl.includes('?') ? '&' : '?') + '_t=' + Date.now();

function scheduleTrafficRefresh() {
  clearInterval(tfTimer);
  const secs = +S.prefs.tfRefresh || 0;
  if (!secs || !tfLayer) return;
  tfTimer = setInterval(() => {
    if (!tfLayer || !map.hasLayer(tfLayer) || document.hidden) return;
    const tpl = liveTrafficURL();
    if (!tpl) return;
    liveErrorCount = 0;
    tfLayer.setUrl(withCacheBuster(tpl));
    $('tfUpdated').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }, secs * 1000);
}

function destroyLiveTraffic() {
  clearInterval(tfTimer); tfTimer = null;
  if (tfLayer) { map.removeLayer(tfLayer); tfLayer = null; }
  liveErrorCount = 0;
}

/* ------------------------- typical layer ------------------------- */
function destroyTypicalTraffic() {
  if (tfTypicalLayer) { map.removeLayer(tfTypicalLayer); tfTypicalLayer = null; }
}

function drawTypicalTraffic() {
  destroyTypicalTraffic();
  if (!S.prefs.tfEnabled || S.prefs.tfMode !== 'typical') return;

  const z = map.getZoom();
  if (z < 12) {
    $('tfState').textContent = 'On — typical (zoom in to 12+ to draw)';
    $('tfSlot').textContent = '—';
    return;
  }

  const b = map.getBounds().pad(0.15);
  const sk = slotKey(tfSelDay, tfSelHour);
  const marks = [];
  let shown = 0, samples = 0;

  for (const key in TF) {
    const cell = TF[key];
    const bucket = cell.s[sk];
    if (!bucket || !bucket[1] || !cell.f) continue;
    const [lat, lng] = cellCentre(key);
    if (!b.contains([lat, lng])) continue;

    const avg = bucket[0] / bucket[1];
    const ratio = clamp(avg / cell.f, 0, 1);
    shown++; samples += bucket[1];

    marks.push(L.circleMarker([lat, lng], {
      renderer: tfRenderer,
      radius: z >= 16 ? 6 : z >= 14 ? 4 : 3,
      stroke: false,
      fillColor: congestionColor(ratio),
      fillOpacity: S.prefs.tfOpacity
    }).bindTooltip(
      `${DAY_NAMES[tfSelDay]} ${String(tfSelHour).padStart(2, '0')}:00<br>` +
      `typical ${fmtSpeed(avg)} ${speedUnit()} · best ${fmtSpeed(cell.f)} ${speedUnit()}<br>` +
      `<span style="color:#888">${bucket[1]} sample${bucket[1] > 1 ? 's' : ''}</span>`,
      { direction: 'top' }
    ));
  }

  if (marks.length) {
    tfTypicalLayer = L.layerGroup(marks).addTo(map);
  }
  $('tfSlot').textContent = shown ? `${shown}` : '0';
  $('tfState').textContent = shown
    ? `On — typical, ${DAY_NAMES[tfSelDay]} ${String(tfSelHour).padStart(2, '0')}:00`
    : 'On — typical, no data for this hour here';
}

/** 24 bars: average speed you recorded in the visible area, per hour. */
function drawHourStrip() {
  const b = map.getBounds().pad(0.15);
  const sums = new Array(24).fill(0);
  const counts = new Array(24).fill(0);
  const free = new Array(24).fill(0);

  for (const key in TF) {
    const cell = TF[key];
    if (!cell.f) continue;
    const [lat, lng] = cellCentre(key);
    if (!b.contains([lat, lng])) continue;
    for (let h = 0; h < 24; h++) {
      const bucket = cell.s[slotKey(tfSelDay, h)];
      if (!bucket || !bucket[1]) continue;
      sums[h] += bucket[0] / bucket[1];
      free[h] += cell.f;
      counts[h] += 1;
    }
  }

  const html = [];
  for (let h = 0; h < 24; h++) {
    if (!counts[h]) {
      html.push(`<i data-h="${h}" class="${h === tfSelHour ? 'sel' : ''}" style="height:3px" title="${h}:00 no data"></i>`);
      continue;
    }
    const ratio = clamp((sums[h] / counts[h]) / (free[h] / counts[h]), 0, 1);
    const pct = Math.max(12, Math.round(ratio * 100));
    html.push(`<i data-h="${h}" class="${h === tfSelHour ? 'sel' : ''}" style="height:${pct}%;background:${congestionColor(ratio)}" title="${String(h).padStart(2, '0')}:00"></i>`);
  }
  $('tfHours').innerHTML = html.join('');
}

function renderTrafficStats() {
  const cells = Object.keys(TF);
  let n = 0;
  for (const k of cells) for (const s in TF[k].s) n += TF[k].s[s][1];
  $('tfCells').textContent = cells.length.toLocaleString();
  $('tfSamples').textContent = n.toLocaleString();
}

function renderDayButtons() {
  const today = new Date().getDay();
  $('tfDays').innerHTML = DAY_NAMES.map((d, i) =>
    `<button data-day="${i}" class="${i === tfSelDay ? 'on' : ''} ${i === today ? 'today' : ''}">${d}</button>`
  ).join('');
}

function setTrafficHour(h, fromUser) {
  tfSelHour = clamp(h | 0, 0, 23);
  if (fromUser) tfFollowNow = false;
  $('tfHour').value = String(tfSelHour);
  $('tfHourLabel').textContent =
    `${DAY_NAMES[tfSelDay]} ${String(tfSelHour).padStart(2, '0')}:00` +
    (tfFollowNow ? ' (now)' : '');
  drawHourStrip();
  drawTypicalTraffic();
}

/* ------------------------- master switch ------------------------- */
function applyTraffic() {
  destroyLiveTraffic();
  destroyTypicalTraffic();

  const on = S.prefs.tfEnabled;
  $('fabTraffic').classList.toggle('on', on);
  $('tfLivePanel').style.display    = S.prefs.tfMode === 'live' ? '' : 'none';
  $('tfTypicalPanel').style.display = S.prefs.tfMode === 'typical' ? '' : 'none';
  $$('#tfMode button').forEach(b => b.classList.toggle('on', b.dataset.tfmode === S.prefs.tfMode));

  if (!on) { $('tfState').textContent = 'Off'; return; }
  if (S.prefs.tfMode === 'live') buildLiveTraffic();
  else { drawHourStrip(); drawTypicalTraffic(); }
}

function toggleTraffic(force) {
  S.prefs.tfEnabled = force != null ? force : !S.prefs.tfEnabled;
  $('tfEnable').checked = S.prefs.tfEnabled;
  savePrefs();
  applyTraffic();
  if (S.prefs.tfEnabled && S.prefs.tfMode === 'live' && !liveTrafficURL()) {
    toast('Add a provider key in the Traffic tab to see live congestion.', 'warn', 4500);
  }
}

/* ------------------------- wiring ------------------------- */
$('tfEnable').onchange = (e) => toggleTraffic(e.target.checked);
$('tfMode').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tfmode]');
  if (!b) return;
  S.prefs.tfMode = b.dataset.tfmode;
  savePrefs();
  applyTraffic();
});
$('tfProvider').onchange = (e) => {
  S.prefs.tfProvider = e.target.value; savePrefs();
  $('tfTomtomWrap').style.display = e.target.value === 'tomtom' ? '' : 'none';
  $('tfCustomWrap').style.display = e.target.value === 'custom' ? '' : 'none';
  if (S.prefs.tfEnabled && S.prefs.tfMode === 'live') buildLiveTraffic();
};
const reloadLive = () => { if (S.prefs.tfEnabled && S.prefs.tfMode === 'live') buildLiveTraffic(); };
$('tfKey').onchange     = (e) => { S.prefs.tfKey = e.target.value.trim(); savePrefs(); reloadLive(); };
$('tfCustom').onchange  = (e) => { S.prefs.tfCustom = e.target.value.trim(); savePrefs(); reloadLive(); };
$('tfStyle').onchange   = (e) => { S.prefs.tfStyle = e.target.value; savePrefs(); reloadLive(); };
$('tfRefresh').onchange = (e) => { S.prefs.tfRefresh = +e.target.value; savePrefs(); scheduleTrafficRefresh(); };
$('tfRefreshNow').onclick = () => {
  if (S.prefs.tfMode !== 'live') { drawTypicalTraffic(); drawHourStrip(); return; }
  if (!tfLayer) { buildLiveTraffic(); return; }
  liveErrorCount = 0;
  tfLayer.setUrl(withCacheBuster(liveTrafficURL()));
  $('tfUpdated').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  toast('Traffic refreshed.', 'ok', 1500);
};
$('tfOpacity').oninput = (e) => {
  S.prefs.tfOpacity = +e.target.value / 100;
  tfLayer?.setOpacity(S.prefs.tfOpacity);
  if (S.prefs.tfMode === 'typical') drawTypicalTraffic();
};
$('tfOpacity').onchange = savePrefs;

$('tfDays').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-day]');
  if (!b) return;
  tfSelDay = +b.dataset.day;
  tfFollowNow = false;
  renderDayButtons();
  setTrafficHour(tfSelHour, true);
});
$('tfHour').oninput = (e) => setTrafficHour(+e.target.value, true);
$('tfHours').addEventListener('click', (e) => {
  const bar = e.target.closest('i[data-h]');
  if (bar) setTrafficHour(+bar.dataset.h, true);
});
$('tfNow').onclick = () => {
  const d = new Date();
  tfSelDay = d.getDay();
  tfFollowNow = true;
  renderDayButtons();
  setTrafficHour(d.getHours(), false);
};
$('tfRecord').onchange = (e) => { S.prefs.tfRecord = e.target.checked; savePrefs(); };
$('tfClear').onclick = () => {
  const n = Object.keys(TF).length;
  if (!n) { toast('Nothing recorded yet.', 'warn'); return; }
  if (!confirm(`Delete all recorded speed history? ${n.toLocaleString()} road cells. This cannot be undone.`)) return;
  TF = {};
  store.del('traffic');
  renderTrafficStats(); drawHourStrip(); drawTypicalTraffic();
  toast('Speed history deleted.', 'ok');
};

/* keep the typical overlay in step with the map, cheaply */
map.on('moveend zoomend', debounce(() => {
  if (S.prefs.tfEnabled && S.prefs.tfMode === 'typical') { drawTypicalTraffic(); drawHourStrip(); }
}, 320));

/* roll the clock forward while the app is open, unless the user picked a slot */
setInterval(() => {
  if (!tfFollowNow) return;
  const d = new Date();
  if (d.getHours() === tfSelHour && d.getDay() === tfSelDay) return;
  tfSelDay = d.getDay();
  renderDayButtons();
  setTrafficHour(d.getHours(), false);
}, 60000);

/* ==========================================================================
   BOOT SCREEN + iOS INSTALL PROMPT
   ========================================================================== */

/** Hide the launch screen once the map has actually drawn its first tiles,
 *  with a hard ceiling so a dead tile server can never leave it stuck. */
function dismissBoot() {
  const boot = $('boot');
  if (!boot) return;
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    boot.classList.add('gone');
    setTimeout(() => boot.remove(), 600);
  };
  if (baseLayer) baseLayer.once('load', () => setTimeout(go, 120));
  map.whenReady(() => setTimeout(go, 900));
  setTimeout(go, 4000);            // ceiling
}

const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);   // iPadOS 13+

const isStandalone = () =>
  window.navigator.standalone === true ||
  window.matchMedia('(display-mode: standalone)').matches ||
  window.matchMedia('(display-mode: fullscreen)').matches;

/** iOS has no beforeinstallprompt — Safari only offers Add to Home Screen from
 *  the Share sheet, so the best we can do is tell the user where it is. Shown
 *  once, then remembered. */
function maybeOfferInstall() {
  if (isStandalone()) { document.body.dataset.standalone = '1'; return; }
  if (store.get('a2hsDismissed', false) || deepLinked) return;
  if (!isIOS()) return;                       // Android/desktop get the real prompt below
  if (!/Safari/.test(navigator.userAgent) || /CriOS|FxiOS|EdgiOS/.test(navigator.userAgent)) {
    // Chrome/Firefox/Edge on iOS cannot install PWAs at all — do not mislead.
    return;
  }
  setTimeout(showInstallBanner, 2200);
}

/** The banner sits just above the collapsed sheet handle, so collapse the
 *  sheet while it is up — and get out of the way the moment the user reopens
 *  the sheet, without burning the "don't show again" flag. */
function showInstallBanner() {
  $('sheet').classList.remove('open');
  $('a2hs').classList.add('show');
}
function hideInstallBanner(permanent) {
  $('a2hs').classList.remove('show');
  if (permanent) store.set('a2hsDismissed', true);
}

$('a2hsClose').onclick = () => hideInstallBanner(true);
$('sheetHead').addEventListener('click', () => hideInstallBanner(false));

/* Android + desktop Chromium: use the real install prompt when offered. */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (store.get('a2hsDismissed', false) || isStandalone() || deepLinked) return;
  const box = $('a2hs');
  box.querySelector('.txt').innerHTML =
    '<b>Install Star Map</b>Add it to your home screen — fullscreen, offline-capable.';
  const btn = document.createElement('button');
  btn.className = 'btn primary';
  btn.style.cssText = 'margin-top:10px;width:100%';
  btn.innerHTML = '<i class="fa-solid fa-download"></i> Install';
  btn.onclick = async () => {
    hideInstallBanner(true);
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') toast('Installing…', 'ok');
    deferredPrompt = null;
  };
  box.querySelector('.txt').appendChild(btn);
  setTimeout(showInstallBanner, 1800);
});

window.addEventListener('appinstalled', () => {
  hideInstallBanner(true);
  toast('Installed. Launch it from your home screen.', 'ok', 4000);
});

/* ------------------------------ INIT ------------------------------ */
(function init() {
  applyPrefs();
  setBase(S.prefs.base);
  map.setView([CFG.defaultView.lat, CFG.defaultView.lng], CFG.defaultView.zoom);

  renderPlaces();
  renderSavedRoutes();
  renderWaypoints();
  renderBaseList();
  refreshStorageUsed();
  setMode('driving');

  const hadHash = applyHash();
  if (!hadHash) {
    const last = store.get('lastView', null);
    if (last) map.setView([last.lat, last.lng], last.z);
  }
  map.on('moveend', debounce(() => {
    const c = map.getCenter();
    store.set('lastView', { lat: c.lat, lng: c.lng, z: map.getZoom() });
  }, 900));

  if (!window.isSecureContext) {
    toast('Opened from disk. Map and routing work; GPS needs http://localhost or HTTPS.', 'warn', 6000);
  } else if (store.get('gpsAuto', false)) {
    startGPS();
  }
  $('fabGps').addEventListener('click', () => store.set('gpsAuto', S.gpsOn), { once: false });

  renderDayButtons();
  renderTrafficStats();
  setTrafficHour(new Date().getHours(), false);
  applyTraffic();

  setNetBadge();
  initOffline();
  dismissBoot();
  maybeOfferInstall();

  console.log('%cStar Map ready', 'color:#24b364;font-weight:700');
})();
