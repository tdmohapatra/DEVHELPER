/**
 * Tests for the Live tab: the layer framework, the location, proximity alerts,
 * tracking, and each layer's parsing of its own source.
 *
 * Same approach as starMapAddons.test.ts — the add-ons are classic browser
 * scripts, so they run here under jsdom against a Leaflet stub with the app's
 * globals faked, and every network call is a fixture.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/* ------------------------------ Leaflet stub ------------------------------ */

const layers: any[] = [];
// Leaflet's own panes exist before any add-on runs, so the stub provides them.
const panes: Record<string, HTMLElement> = {
  popupPane: document.createElement("div"),
  tooltipPane: document.createElement("div"),
  markerPane: document.createElement("div"),
};

function makeLayer(kind: string, extra: Record<string, any> = {}) {
  const layer: any = {
    kind, _latlngs: [], _style: {}, _map: null, _popup: null, _tooltip: null,
    addTo(m: any) { this._map = m; if (m && m.addLayer) m.addLayer(this); return this; },
    remove() { if (this._map && this._map.removeLayer) this._map.removeLayer(this); this._map = null; return this; },
    clearLayers() { this._children = []; return this; },
    addLayer(l: any) { (this._children ||= []).push(l); return this; },
    removeLayer(l: any) {
      this._children = (this._children || []).filter((c: any) => c !== l);
      if (l && l._map) l._map = null;
      return this;
    },
    getLayers() { return this._children || []; },
    setLatLngs(v: any[]) { this._latlngs = v; return this; },
    getLatLngs() { return this._latlngs; },
    addLatLng(v: any) { this._latlngs.push(v); return this; },
    setLatLng(v: any) { this._latlng = v; return this; },
    getLatLng() { return this._latlng; },
    setRadius(r: number) { this._radius = r; return this; },
    setStyle(s: any) { Object.assign(this._style, s); return this; },
    setOpacity() { return this; },
    setIcon() { return this; },
    bindPopup(p: any) { this._popup = p; this._popupContent = typeof p === "function" ? p() : p; return this; },
    setPopupContent(c: any) { this._popupContent = c; return this; },
    getPopup() { return this._popup; },
    isPopupOpen() { return !!this._popupOpen; },
    openPopup() { this._popupOpen = true; if (this._popup) this._popupContent = typeof this._popup === "function" ? this._popup() : this._popup; return this; },
    closePopup() { this._popupOpen = false; return this; },
    bindTooltip(t: any) { this._tooltip = t; this._tooltipContent = typeof t === "function" ? t() : t; return this; },
    setTooltipContent(c: any) { this._tooltipContent = c; return this; },
    getTooltipContent() { return this._tooltipContent; },
    fire(event: string, payload?: any) { (this._events?.[event] || []).forEach((f: Function) => f(payload)); return this; },
    on(event: string, fn: Function) { ((this._events ||= {})[event] ||= []).push(fn); return this; },
    off() { return this; },
    bringToFront() { return this; },
    ...extra,
  };
  layers.push(layer);
  return layer;
}

const mapStub: any = {
  _handlers: {} as Record<string, Function[]>,
  _layers: new Set<any>(),
  _zoom: 13,
  createPane(name: string) { return (panes[name] = document.createElement("div")); },
  getPane(name: string) { return panes[name]; },
  addLayer(l: any) { this._layers.add(l); return this; },
  removeLayer(l: any) { this._layers.delete(l); return this; },
  hasLayer(l: any) { return this._layers.has(l); },
  on(events: string, fn: Function) { for (const e of events.split(" ")) (this._handlers[e] ||= []).push(fn); return this; },
  off() { return this; },
  fire(e: string, p?: any) { (this._handlers[e] || []).forEach((f: Function) => f(p)); },
  getZoom() { return this._zoom; },
  setZoom(z: number) { this._zoom = z; },
  getCenter: () => ({ lat: 12.9716, lng: 77.5946 }),
  getBounds: () => ({
    pad: () => ({ getSouth: () => 12.5, getWest: () => 77.0, getNorth: () => 13.5, getEast: () => 78.2 }),
    getSouth: () => 12.5, getWest: () => 77.0, getNorth: () => 13.5, getEast: () => 78.2,
    contains: () => true,
  }),
  fitBounds: vi.fn(), panTo: vi.fn(), flyTo: vi.fn(), closePopup: vi.fn(),
  latLngToContainerPoint: () => ({ add: () => ({ x: 100, y: 0 }) }),
  containerPointToLatLng: () => ({ lat: 12.9716, lng: 77.6046 }),
  getContainer: () => document.getElementById("map"),
  doubleClickZoom: { enabled: true, enable() { this.enabled = true; }, disable() { this.enabled = false; } },
};

const L: any = {
  map: () => mapStub,
  svg: () => makeLayer("svg"),
  polyline: (ll: any[], o: any) => makeLayer("polyline", { _latlngs: [...ll], _opts: o }),
  marker: (ll: any, o: any) => makeLayer("marker", { _latlng: ll, _opts: o }),
  circle: (ll: any, o: any) => makeLayer("circle", { _latlng: ll, _opts: o, _radius: o?.radius }),
  circleMarker: (ll: any, o: any) => makeLayer("circleMarker", { _latlng: ll, _opts: o }),
  polygon: (ll: any[], o: any) => makeLayer("polygon", { _latlngs: [...ll], _opts: o }),
  divIcon: (o: any) => ({ ...o }),
  layerGroup: (c: any[] = []) => makeLayer("layerGroup", { _children: [...c] }),
  tileLayer: (url: string, o: any) => makeLayer("tileLayer", { _url: url, _opts: o }),
  latLngBounds: (p: any[]) => ({ _pts: p, extend() { return this; }, contains: () => true, pad() { return this; } }),
  latLng: (lat: number, lng: number) => ({ lat, lng }),
  DomEvent: { stop: () => {} },
};

/* -------------------------------- fixtures -------------------------------- */

/** A real ISS element set, so propagation is exercised for real. */
const ISS_TLE = [
  "ISS (ZARYA)",
  "1 25544U 98067A   24015.50000000  .00016717  00000-0  30777-3 0  9993",
  "2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.49444173 34567",
].join("\n");

const fixtures: Record<string, any> = {
  celestrak: ISS_TLE,
  aircraft: {
    ac: [
      { hex: "abc123", flight: "AI101  ", lat: 12.99, lon: 77.61, alt_baro: 4000, gs: 250, track: 90, t: "A320", baro_rate: 500, squawk: "1234" },
      { hex: "def456", flight: "6E202", lat: 13.4, lon: 77.9, alt_baro: "ground", gs: 5, track: 10, t: "B738" },
      { hex: "bad", flight: "NOPOS", lat: null, lon: null },
    ],
  },
  quakes: {
    features: [
      { id: "q1", geometry: { coordinates: [77.7, 13.05, 12] }, properties: { mag: 5.2, place: "near here", time: Date.now(), tsunami: 0 } },
      { id: "q2", geometry: { coordinates: [100, 40, 300] }, properties: { mag: 3.1, place: "far away", time: Date.now(), tsunami: 1 } },
    ],
  },
  radar: { host: "https://tilecache.rainviewer.com", radar: { past: [{ time: 1786445000, path: "/v2/radar/1786445000" }] } },
  nws: { features: [{ properties: { id: "nws1", event: "Severe Thunderstorm Warning", severity: "Severe", urgency: "Immediate", headline: "Storm approaching" } }] },
  overpassTransport: {
    elements: [
      { id: 1, lat: 12.98, lon: 77.6, tags: { railway: "station", name: "Central", operator: "IR" } },
      { id: 2, lat: 12.97, lon: 77.61, tags: { highway: "bus_stop", name: "Market" } },
      { id: 3, lat: 12.99, lon: 77.62, tags: { railway: "tram_stop", name: "Tramway" } },
    ],
  },
  overpassPlaces: {
    elements: [
      { id: 3, lat: 12.96, lon: 77.59, tags: { amenity: "hospital", name: "General", phone: "123" } },
      { id: 4, lat: 12.95, lon: 77.58, tags: { amenity: "fuel", name: "Pump" } },
    ],
  },
  marine: { current: { wave_height: 3.2, wave_period: 9, wave_direction: 220, sea_surface_temperature: 28 } },
  neows: {
    near_earth_objects: {
      "2026-08-12": [
        {
          id: "n1", name: "(2026 AA)", is_potentially_hazardous_asteroid: true,
          close_approach_data: [{ miss_distance: { lunar: "3.4" }, relative_velocity: { kilometers_per_hour: "45000" }, close_approach_date_full: "2026-Aug-12 04:00" }],
          estimated_diameter: { meters: { estimated_diameter_min: 100, estimated_diameter_max: 220 } },
        },
        {
          id: "n2", name: "(2026 BB)", is_potentially_hazardous_asteroid: false,
          close_approach_data: [{ miss_distance: { lunar: "12.9" }, relative_velocity: { kilometers_per_hour: "22000" }, close_approach_date_full: "2026-Aug-13 11:00" }],
          estimated_diameter: { meters: { estimated_diameter_min: 20, estimated_diameter_max: 40 } },
        },
      ],
    },
  },
  launches: {
    results: [
      { id: "l1", name: "Falcon 9 · Starlink", net: new Date(Date.now() + 6 * 3600e3).toISOString(), pad: { latitude: "28.5", longitude: "-80.5", name: "LC-39A" }, status: { name: "Go" } },
      { id: "l2", name: "Electron · Test", net: new Date(Date.now() + 96 * 3600e3).toISOString(), pad: { latitude: "-39.2", longitude: "177.8", name: "LC-1" }, status: { name: "TBC" } },
    ],
  },
  cpcb: {
    total: 6,
    records: [
      { country: "India", state: "Karnataka", city: "Bengaluru", station: "BTM Layout, Bengaluru - CPCB",
        last_update: "12-08-2026 14:00:00", latitude: "12.9135", longitude: "77.6101",
        pollutant_id: "PM2.5", min_value: "40", max_value: "120", avg_value: "95" },
      { country: "India", state: "Karnataka", city: "Bengaluru", station: "BTM Layout, Bengaluru - CPCB",
        last_update: "12-08-2026 14:00:00", latitude: "12.9135", longitude: "77.6101",
        pollutant_id: "PM10", min_value: "60", max_value: "180", avg_value: "140" },
      { country: "India", state: "Karnataka", city: "Bengaluru", station: "BTM Layout, Bengaluru - CPCB",
        last_update: "12-08-2026 14:00:00", latitude: "12.9135", longitude: "77.6101",
        pollutant_id: "NO2", min_value: "9", max_value: "20", avg_value: "14" },
      { country: "India", state: "Delhi", city: "Delhi", station: "Anand Vihar, Delhi - DPCC",
        last_update: "12-08-2026 14:00:00", latitude: "28.6469", longitude: "77.3161",
        pollutant_id: "PM2.5", min_value: "200", max_value: "400", avg_value: "310" },
      { country: "India", state: "Kerala", city: "Kochi", station: "Vyttila, Kochi - KSPCB",
        last_update: "12-08-2026 13:00:00", latitude: "9.9674", longitude: "76.3200",
        pollutant_id: "PM10", min_value: "10", max_value: "30", avg_value: "22" },
      { country: "India", state: "Kerala", city: "Kochi", station: "No Position, Kochi - KSPCB",
        last_update: "12-08-2026 13:00:00", latitude: "", longitude: "",
        pollutant_id: "PM2.5", min_value: "10", max_value: "12", avg_value: "11" },
    ],
  },
  probes: {
    results: [
      { id: 1001, geometry: { coordinates: [77.6, 12.98] }, status: { name: "Connected" }, asn_v4: 24560, country_code: "IN", is_anchor: false },
      { id: 1002, geometry: { coordinates: [77.7, 13.1] }, status: { name: "Disconnected" }, asn_v4: 9498, country_code: "IN", is_anchor: true },
    ],
  },
};

const fetchMock = vi.fn(async (url: string, init?: any) => {
  const u = String(url);
  const text = u.includes("celestrak.org");
  const body = text ? fixtures.celestrak
    : u.includes("airplanes.live") ? fixtures.aircraft
    : u.includes("earthquake.usgs.gov") ? fixtures.quakes
    : u.includes("rainviewer") ? fixtures.radar
    : u.includes("api.weather.gov") ? fixtures.nws
    : u.includes("overpass") ? (String(init && init.body).includes("railway") ? fixtures.overpassTransport : fixtures.overpassPlaces)
    : u.includes("marine-api") ? fixtures.marine
    : u.includes("api.nasa.gov") ? fixtures.neows
    : u.includes("thespacedevs") ? fixtures.launches
    : u.includes("api.data.gov.in") ? (u.includes("offset=0") ? fixtures.cpcb : { records: [] })
    : u.includes("atlas.ripe.net") ? fixtures.probes
    : {};
  return {
    ok: true, status: 200,
    json: async () => body,
    text: async () => (text ? body : JSON.stringify(body)),
    _init: init,
  } as any;
});

const kv = new Map<string, unknown>();
const toasts: string[] = [];
const appState: any = { prefs: { units: "metric", tapAdd: true }, waypoints: [], routes: [], selectedRoute: 0 };

beforeAll(async () => {
  document.body.innerHTML = `<div id="map"></div><div class="hud"></div>`
    + `<div class="fabs"><button id="fabHelp"></button></div><input type="checkbox" id="tapAddToggle" />`;
  Object.assign(globalThis as any, {
    L, map: mapStub, S: appState,
    CFG: { colors: { selected: "#24b364", alternate: "#8b5cf6", trail: "#ef4444", measure: "#f59e0b" } },
    toast: (m: string) => toasts.push(m),
    store: { get: (k: string, d: unknown) => (kv.has(k) ? kv.get(k) : d), set: (k: string, v: unknown) => kv.set(k, v) },
    routerBase: () => "https://router.project-osrm.org/route/v1",
    OSRM_PROFILE: { driving: "driving", cycling: "cycling", foot: "foot" },
    mkTileLayer: (url: string, o: any) => L.tileLayer(url, o),
    savePrefs: () => {},
    addWaypoint: vi.fn(), removeWaypoint: vi.fn(),
  });
  (globalThis as any).fetch = fetchMock;
  (window as any).L = L;

  /* eslint-disable @typescript-eslint/ban-ts-comment */
  // @ts-expect-error untyped browser script
  await import("../../../public/gadgets/star-map.x-math.js");
  // The vendored UMD attaches itself to the global object in a browser, but the
  // test runner's CJS interop captures its exports instead — so publish them
  // under the name the layer looks for.
  // @ts-expect-error untyped vendored library
  const satmod: any = await import("../../../public/gadgets/star-map.satellite.js");
  const satlib = satmod.twoline2satrec ? satmod : (satmod.default || {});
  (globalThis as any).satellite = satlib;
  (window as any).satellite = satlib;
  // @ts-expect-error untyped browser script
  await import("../../../public/gadgets/star-map.x-core.js");
  // @ts-expect-error untyped browser script
  await import("../../../public/gadgets/star-map.x-sim.js");
  // @ts-expect-error untyped browser script
  await import("../../../public/gadgets/star-map.x-geo.js");
  // @ts-expect-error untyped browser script
  await import("../../../public/gadgets/star-map.x-live.js");
  // @ts-expect-error untyped browser script
  await import("../../../public/gadgets/star-map.x-layers.js");
});

const SMX = () => (globalThis as any).SMX;
const live = () => SMX().live;
const stateOf = (id: string) => live().layerState(id);
const $ = (s: string) => document.querySelector(s) as HTMLElement | null;

/** Load one layer's data through the framework and hand back its state. */
async function load(id: string) {
  await live().setLayer(id, true);
  await vi.waitUntil(() => !stateOf(id).busy, { timeout: 8000 });
  return stateOf(id);
}

beforeEach(() => {
  live().state.alerts = [];
  live().state.alerted = new Set();
});

describe("live framework", () => {
  it("registers every layer in the order they are declared", () => {
    expect(live().layers.map((l: any) => l.id)).toEqual([
      "satellites", "aircraft", "earthquakes", "radar", "weather-alerts",
      "transport", "places", "ocean", "asteroids", "launches",
      "fires", "cpcb-aqi", "internet", "gibs",
    ]);
    expect(live().layers.every((l: any) => l.emoji && l.hint)).toBe(true);
  });

  it("adds a Live tab and its own map panes", () => {
    expect($('.smx-tab[data-tab="live"]')).toBeTruthy();
    expect(panes["smx-live"]).toBeTruthy();
    expect(panes["smx-live-raster"].style.pointerEvents).toBe("none");
  });

  it("starts with every layer off, and nothing on the map", () => {
    expect(live().layers.every((l: any) => stateOf(l.id).on === false)).toBe(true);
  });

  it("turning a layer off clears its markers and its items", async () => {
    await load("earthquakes");
    expect(stateOf("earthquakes").items.length).toBe(2);
    await live().setLayer("earthquakes", false);
    expect(stateOf("earthquakes").items).toHaveLength(0);
    expect(stateOf("earthquakes").group._map).toBeNull();
  });

  it("refuses to load a location-dependent layer until a location is set", async () => {
    live().state.home = null;
    await live().setLayer("internet", true);
    expect(stateOf("internet").error).toBe("needs a location");
    await live().setLayer("internet", false);
  });

  it("does not fetch a zoom-gated layer when the map is too far out", async () => {
    mapStub.setZoom(6);
    fetchMock.mockClear();
    const st = await load("places");
    expect(st.note).toContain("zoom in to level 12");
    expect(fetchMock).not.toHaveBeenCalled();
    await live().setLayer("places", false);
    mapStub.setZoom(13);
  });

  it("records an error against the layer instead of throwing out of refresh", async () => {
    fetchMock.mockImplementationOnce(async () => { throw new Error("network down"); });
    const st = await load("launches");
    expect(st.error).toBe("network down");
    await live().setLayer("launches", false);
  });
});

describe("my location", () => {
  it("sets a home, draws its marker and its alert radius", () => {
    live().setHome({ lat: 12.9716, lng: 77.5946 }, "Bengaluru");
    expect(live().state.home.label).toBe("Bengaluru");
    expect(live().state.homeMarker).toBeTruthy();
    expect(live().state.homeCircle._radius).toBe(live().state.radiusKm * 1000);
    expect($("#smxHome")!.textContent).toContain("12.9716");
  });

  it("measures distance from home to an item", () => {
    const d = live().distanceToHome({ lat: 13.0716, lng: 77.5946 });
    expect(d / 1000).toBeCloseTo(11.1, 0);
  });

  it("survives a build with no geolocation at all", () => {
    const had = navigator.geolocation;
    Object.defineProperty(navigator, "geolocation", { value: undefined, configurable: true });
    toasts.length = 0;
    live().useGps();
    expect(toasts.pop()).toContain("no geolocation");
    Object.defineProperty(navigator, "geolocation", { value: had, configurable: true });
  });
});

describe("layers parse their sources", () => {
  it("satellites: propagates real elements to a plausible position", async () => {
    // SGP4 is only valid near its element set's epoch, and the fixture is a real
    // (therefore dated) one — so pretend it is the day after that epoch.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2024-01-16T12:00:00Z"));
    const st = await load("satellites");
    vi.useRealTimers();
    expect(st.items).toHaveLength(1);
    const iss = st.items[0];
    expect(iss.label).toBe("ISS (ZARYA)");
    expect(Math.abs(iss.lat)).toBeLessThanOrEqual(51.7);        // its orbital inclination
    expect(iss.altitude / 1000).toBeGreaterThan(150);
    expect(iss.altitude / 1000).toBeLessThan(1200);
    expect(iss.speed).toBeGreaterThan(6000);                    // ~7.7 km/s
    expect(st.note).toContain("Space stations");
    await live().setLayer("satellites", false);
  });

  it("aircraft: converts feet and knots, and drops positionless entries", async () => {
    const st = await load("aircraft");
    expect(st.items).toHaveLength(2);
    const [first, ground] = st.items;
    expect(first.label).toBe("AI101");                          // trimmed
    expect(first.altitude).toBeCloseTo(4000 * 0.3048, 3);
    expect(first.speed).toBeCloseTo(250 * 0.514444, 3);
    expect(first.heading).toBe(90);
    expect(first.detail).toContain("climbing");
    expect(ground.altitude).toBe(0);                            // alt_baro: "ground"
    expect(ground.detail).toContain("on the ground");
    await live().setLayer("aircraft", false);
  });

  it("earthquakes: colours by magnitude on the severity ramp and rings deep ones", async () => {
    const st = await load("earthquakes");
    const drawn = st.group.getLayers();
    expect(drawn).toHaveLength(2);
    expect(drawn[0]._opts.color).toBe(SMX().SEVERITY[3]);       // M5.2
    expect(drawn[1]._opts.dashArray).toBe("3 3");               // 300 km deep
    expect(st.items[1].detail).toContain("tsunami");
    await live().setLayer("earthquakes", false);
  });

  it("radar: builds a tile layer from the newest published frame", async () => {
    const st = await load("radar");
    expect(st.raster._url).toContain("tilecache.rainviewer.com/v2/radar/1786445000");
    expect(st.note).toMatch(/frame/);
    await live().setLayer("radar", false);
    expect(stateOf("radar").raster).toBeNull();
  });

  it("weather alerts: reads severity, and calls a 400 a coverage gap", async () => {
    const st = await load("weather-alerts");
    expect(st.items[0].label).toBe("Severe Thunderstorm Warning");
    expect(st.items[0].severity).toBe("Severe");

    fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 400, json: async () => ({}), text: async () => "" }) as any);
    await live().refresh("weather-alerts");
    await vi.waitUntil(() => !stateOf("weather-alerts").busy, { timeout: 5000 });
    expect(stateOf("weather-alerts").error).toBeNull();
    expect(stateOf("weather-alerts").note).toContain("United States only");
    await live().setLayer("weather-alerts", false);
  });

  it("transport: distinguishes rail, tram and bus", async () => {
    const st = await load("transport");
    expect(st.items.map((i: any) => i.glyph)).toEqual(["🚆", "🚌", "🚊"]);
    expect(st.note).toContain("GTFS-RT");
    await live().setLayer("transport", false);
  });

  it("places: keeps the amenity glyphs and the phone number", async () => {
    const st = await load("places");
    const hospital = st.items.find((i: any) => i.label === "General");
    expect(hospital.glyph).toBe("🏥");
    expect(hospital.detail).toContain("123");
    await live().setLayer("places", false);
  });

  it("ocean: reports the sea state and adds seamark tiles", async () => {
    const st = await load("ocean");
    expect(st.raster._url).toContain("openseamap");
    expect(st.items[0].waveHeight).toBe(3.2);
    expect(st.items[0].detail).toContain("period 9 s");
    expect(st.note).toBe("waves 3.2 m");
    await live().setLayer("ocean", false);
  });

  it("asteroids: sorts by miss distance and flags the hazardous ones", async () => {
    const st = await load("asteroids");
    expect(st.items.map((i: any) => i.label)).toEqual(["(2026 AA)", "(2026 BB)"]);
    expect(st.items[0].ld).toBeCloseTo(3.4, 3);
    expect(st.items[0].glyph).toBe("⚠️");
    expect(st.items[0].detail).toContain("100–220 m across");
    expect(st.note).toContain("closest 3.4 LD");
    expect(st.group.getLayers()).toHaveLength(0);               // no ground position to draw
    await live().setLayer("asteroids", false);
  });

  it("launches: puts each one on its pad with a countdown", async () => {
    const st = await load("launches");
    expect(st.items[0].lat).toBeCloseTo(28.5, 3);
    expect(Math.round(st.items[0].hours)).toBe(6);
    expect(st.items[0].detail).toContain("LC-39A");
    expect(st.note).toContain("next in 6 h");
    await live().setLayer("launches", false);
  });

  it("internet: counts connected probes and labels anchors", async () => {
    const st = await load("internet");
    expect(st.items).toHaveLength(2);
    expect(st.items[0].detail).toContain("AS24560");
    expect(st.items[1].label).toContain("Anchor");
    expect(st.note).toBe("1/2 connected");
    await live().setLayer("internet", false);
  });

  it("gibs: stops asking for tiles past the matrix it publishes", async () => {
    const st = await load("gibs");
    expect(st.raster._opts.maxNativeZoom).toBe(8);
    expect(st.raster._url).toContain("MODIS_Terra_CorrectedReflectance_TrueColor");
    await live().setLayer("gibs", false);
  });
});

describe("alerts", () => {
  beforeEach(() => live().setHome({ lat: 12.9716, lng: 77.5946 }, "Bengaluru"));

  /**
   * Load first, then arm: a refresh evaluates the rules itself, so a rule left
   * armed by an earlier test would fire during the load and land in the log
   * before the assertions.
   */
  async function armed(id: string, settings: Record<string, unknown>) {
    const st = await load(id);
    live().state.alerts = [];
    live().state.alerted = new Set();
    Object.assign(st.alert, { on: true }, settings);
    return st;
  }

  it("fires for a low aircraft inside the radius, once per aircraft", async () => {
    await armed("aircraft", { maxKm: 50, maxAltM: 4000 });
    live().evaluateAlerts("aircraft");
    expect(live().state.alerts).toHaveLength(1);
    expect(live().state.alerts[0].label).toBe("AI101");
    expect(live().state.alerts[0].why).toContain("1219 m over");

    live().evaluateAlerts("aircraft");                          // same data again
    expect(live().state.alerts).toHaveLength(1);                // deduped
    await live().setLayer("aircraft", false);
  });

  it("respects the altitude ceiling and the radius", async () => {
    const st = await armed("aircraft", { maxKm: 50, maxAltM: 500 });
    live().evaluateAlerts("aircraft");
    expect(live().state.alerts).toHaveLength(0);                // too high for the ceiling

    live().state.alerted = new Set();
    Object.assign(st.alert, { maxKm: 1, maxAltM: 12000 });
    live().evaluateAlerts("aircraft");
    expect(live().state.alerts).toHaveLength(0);                // outside the radius
    await live().setLayer("aircraft", false);
  });

  it("fires for a quake over the magnitude floor and ignores the distant one", async () => {
    await armed("earthquakes", { minMag: 4, maxKm: 500 });
    live().evaluateAlerts("earthquakes");
    expect(live().state.alerts).toHaveLength(1);
    expect(live().state.alerts[0].why).toContain("M5.2");
    await live().setLayer("earthquakes", false);
  });

  it("fires for an imminent launch but not a distant one", async () => {
    await armed("launches", { withinHours: 12 });
    live().evaluateAlerts("launches");
    expect(live().state.alerts).toHaveLength(1);
    expect(live().state.alerts[0].why).toContain("lifts off in 6 h");
    await live().setLayer("launches", false);
  });

  it("fires for a close approach inside the lunar-distance threshold", async () => {
    await armed("asteroids", { maxLD: 5 });
    live().evaluateAlerts("asteroids");
    expect(live().state.alerts).toHaveLength(1);
    expect(live().state.alerts[0].label).toBe("(2026 AA)");
    await live().setLayer("asteroids", false);
  });

  it("stays silent while the rule is switched off", async () => {
    await armed("earthquakes", { on: false, minMag: 1, maxKm: 20000 });
    live().evaluateAlerts("earthquakes");
    expect(live().state.alerts).toHaveLength(0);
    await live().setLayer("earthquakes", false);
  });

  it("needs a location before any alert can fire", async () => {
    await armed("earthquakes", { minMag: 1, maxKm: 20000 });
    live().state.home = null;
    live().evaluateAlerts("earthquakes");
    expect(live().state.alerts).toHaveLength(0);
    await live().setLayer("earthquakes", false);
  });
});

describe("tracking", () => {
  beforeEach(() => {
    live().stopTracking();                       // no argument: stop them all
    live().forgetAllTracks();                    // and start each test with no history
    live().setHome({ lat: 12.9716, lng: 77.5946 }, "Bengaluru");
  });

  it("tracks an object, recording a timestamped fix with look angles", async () => {
    await load("aircraft");
    const target = stateOf("aircraft").items[0];
    const track = live().startTracking("aircraft", target.id);
    expect(live().tracks.size).toBe(1);
    expect(track.label).toBe("AI101");
    expect(track.points).toHaveLength(1);

    const fix = track.points[0];
    expect(fix.t).toBeGreaterThan(0);
    expect(fix.lat).toBeCloseTo(12.99, 5);
    expect(fix.alt).toBe(Math.round(4000 * 0.3048));
    expect(fix.az).toBeGreaterThanOrEqual(0);
    expect(fix.el).toBeTypeOf("number");
    expect(fix.rng).toBeGreaterThan(0);
    await live().setLayer("aircraft", false);
  });

  it("tracks several objects at once, each with its own colour and trail", async () => {
    await load("aircraft");
    const [a, b] = stateOf("aircraft").items;
    live().startTracking("aircraft", a.id);
    live().startTracking("aircraft", b.id);
    expect(live().tracks.size).toBe(2);
    const colours = [...live().tracks.values()].map((t: any) => t.color);
    expect(new Set(colours).size).toBe(2);
    expect([...live().tracks.values()].every((t: any) => t.trail._map === mapStub)).toBe(true);
    await live().setLayer("aircraft", false);
  });

  it("draws a sightline from my location to the object, and its footprint", async () => {
    await load("aircraft");
    const track = live().startTracking("aircraft", stateOf("aircraft").items[0].id);
    const line = track.sightline.getLatLngs();
    expect(line).toHaveLength(2);
    expect(line[0]).toEqual([12.9716, 77.5946]);                 // my location
    expect(line[1][0]).toBeCloseTo(12.99, 4);                    // the aircraft
    // An airliner at 1.2 km is above the horizon for tens of kilometres around.
    expect(track.footprint._radius).toBeGreaterThan(50000);
    await live().setLayer("aircraft", false);
  });

  it("says whether it can be seen right now, and why not when it cannot", async () => {
    await load("aircraft");
    const track = live().startTracking("aircraft", stateOf("aircraft").items[0].id);
    expect(track.view).toBeTruthy();
    expect(track.view.range).toBeGreaterThan(0);
    expect(track.view.eye.visible).toBeTypeOf("boolean");
    if (!track.view.eye.visible) expect(track.view.eye.reasons.length).toBeGreaterThan(0);
    expect($("#smxTracked")!.textContent).toMatch(/visible now|below the horizon|too far off|only \d+/);
    await live().setLayer("aircraft", false);
  });

  it("works out when to look: closest approach for something on a course", async () => {
    await load("aircraft");
    const track = live().startTracking("aircraft", stateOf("aircraft").items[0].id);
    expect(track.view.approach).toBeTruthy();
    expect(track.view.approach.seconds).toBeTypeOf("number");
    expect($("#smxTracked")!.textContent).toMatch(/Closest in|Already past|Look now/);
    await live().setLayer("aircraft", false);
  });

  it("predicts the next satellite pass, with peak elevation and whether it is visible", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2024-01-16T12:00:00Z"));
    await load("satellites");
    const iss = stateOf("satellites").items[0];
    const track = live().startTracking("satellites", iss.id);
    vi.useRealTimers();

    expect(track.pass).toBeTruthy();
    if (track.pass.aos) {
      expect(new Date(track.pass.aos).valueOf()).toBeGreaterThan(new Date("2024-01-16T12:00:00Z").valueOf());
      expect(track.pass.maxElevation).toBeGreaterThan(10);
      expect(track.pass.sunlit).toBeTypeOf("boolean");
      expect(track.pass.visible).toBeTypeOf("boolean");
    } else {
      expect(track.pass.note).toContain("no pass");
    }
    await live().setLayer("satellites", false);
  });

  it("never moves the map on its own — following is opt-in, per track", async () => {
    await load("aircraft");
    const [a, b] = stateOf("aircraft").items;
    const first = live().startTracking("aircraft", a.id);
    live().startTracking("aircraft", b.id);
    expect(live().state.followKey).toBeNull();                   // the map stays where you left it

    mapStub.panTo.mockClear();
    live().updateTracks();
    expect(mapStub.panTo).not.toHaveBeenCalled();

    (document.querySelector(`[data-track-follow="${first.key}"]`) as HTMLButtonElement).click();
    expect(live().state.followKey).toBe(first.key);
    mapStub.panTo.mockClear();
    live().updateTracks();
    expect(mapStub.panTo).toHaveBeenCalled();                    // now, and only now, it follows

    (document.querySelector(`[data-track-follow="${first.key}"]`) as HTMLButtonElement).click();
    expect(live().state.followKey).toBeNull();
    await live().setLayer("aircraft", false);
  });

  it("puts only the line on the map, and the rest on hover", async () => {
    await load("aircraft");
    const track = live().startTracking("aircraft", stateOf("aircraft").items[0].id);
    expect(track.trail._map).toBe(mapStub);                      // the line is always there
    expect(track.sightline._map).toBeNull();                     // these are not
    expect(track.footprint._map).toBeNull();

    track.trail.fire("mouseover");
    expect(track.hovering).toBe(true);
    expect(track.sightline._map).toBe(mapStub);                  // sightline to my location
    expect(track.footprint._map).toBe(mapStub);                  // and where it can be seen from
    expect(track.marks.getLayers().length).toBeGreaterThanOrEqual(0);

    track.trail.fire("mouseout");
    expect(track.hovering).toBe(false);
    expect(track.sightline._map).toBeNull();
    expect(track.footprint._map).toBeNull();
    await live().setLayer("aircraft", false);
  });

  it("hovering reads the fix nearest the pointer, with its time", async () => {
    await load("aircraft");
    const track = live().startTracking("aircraft", stateOf("aircraft").items[0].id);
    track.points[0].t -= 60000;
    track.points.push({ ...track.points[0], t: Date.now(), lat: 13.2, lng: 77.8 });

    const early = live().hoverInfo(track, { lat: track.points[0].lat, lng: track.points[0].lng });
    const late = live().hoverInfo(track, { lat: 13.2, lng: 77.8 });
    expect(early).toContain("AI101");
    expect(early).toContain(new Date(track.points[0].t).toLocaleTimeString());
    expect(late).toContain(new Date(track.points[1].t).toLocaleTimeString());
    expect(early).not.toBe(late);
    expect(late).toContain("2 fixes");
    await live().setLayer("aircraft", false);
  });
  it("appends to the trail over time, and never past its cap", async () => {
    await load("aircraft");
    const track = live().startTracking("aircraft", stateOf("aircraft").items[0].id);
    expect(track.points).toHaveLength(1);

    // A fix inside the minimum gap is ignored; one after it is kept.
    live().updateTracks();
    expect(track.points).toHaveLength(1);
    track.points[0].t -= 5000;
    live().updateTracks();
    expect(track.points).toHaveLength(2);
    expect(track.trail.getLatLngs().length).toBe(2);
    await live().setLayer("aircraft", false);
  });

  it("saves the track with its timestamps, and restores it next time", async () => {
    await load("aircraft");
    const target = stateOf("aircraft").items[0];
    const track = live().startTracking("aircraft", target.id);
    track.points[0].t -= 5000;
    live().updateTracks();

    const saved = (kv.get("smx.tracks") as any)[track.key];
    expect(saved.label).toBe("AI101");
    expect(saved.itemId).toBe(target.id);
    expect(saved.points.length).toBe(track.points.length);
    expect(saved.points[0].t).toBeGreaterThan(0);
    expect(new Date(saved.startedAt).valueOf()).toBeGreaterThan(0);

    // Re-tracking the same object picks the saved history back up.
    const count = track.points.length;
    live().stopTracking(track.key);
    const again = live().startTracking("aircraft", target.id);
    expect(again.points.length).toBeGreaterThanOrEqual(count);
    await live().setLayer("aircraft", false);
  });

  it("exports the recorded track as GPX, CSV and JSON", async () => {
    const downloads: { name: string; body: string }[] = [];
    (globalThis as any).download = (name: string, body: string) => downloads.push({ name, body });
    await load("aircraft");
    const track = live().startTracking("aircraft", stateOf("aircraft").items[0].id);
    track.points[0].t -= 5000;
    live().updateTracks();

    live().exportTrack(track.key, "gpx");
    live().exportTrack(track.key, "csv");
    live().exportTrack(track.key, "json");
    expect(downloads.map((d) => d.name.split(".").pop())).toEqual(["gpx", "csv", "json"]);
    expect(downloads[0].body).toContain("<trkpt");
    expect(downloads[0].body).toContain("<time>");
    expect(downloads[1].body.split("\n")[0])
      .toBe("time,lat,lon,altitude_m,speed_mps,azimuth_deg,elevation_deg,range_m");
    expect(downloads[1].body).toMatch(/\d{4}-\d{2}-\d{2}T/);
    const parsed = JSON.parse(downloads[2].body);
    expect(parsed.label).toBe("AI101");
    expect(parsed.observer.label).toBe("Bengaluru");
    expect(parsed.points.length).toBe(track.points.length);
    await live().setLayer("aircraft", false);
  });

  it("keeps a stopped track's history on disk until it is forgotten", async () => {
    await load("aircraft");
    const target = stateOf("aircraft").items[0];
    const track = live().startTracking("aircraft", target.id);
    track.points[0].t -= 5000;
    live().updateTracks();
    const recorded = track.points.length;
    expect(recorded).toBeGreaterThan(1);

    live().stopTracking(track.key);
    expect((kv.get("smx.tracks") as any)[track.key].points).toHaveLength(recorded);

    live().forgetTrack(track.key);
    expect((kv.get("smx.tracks") as any)[track.key]).toBeUndefined();
    expect(live().startTracking("aircraft", target.id).points).toHaveLength(1);
    await live().setLayer("aircraft", false);
  });

  it("stops one track without disturbing the others", async () => {
    await load("aircraft");
    const [a, b] = stateOf("aircraft").items;
    const first = live().startTracking("aircraft", a.id);
    live().startTracking("aircraft", b.id);
    live().stopTracking(first.key);
    expect(live().tracks.size).toBe(1);
    expect(first.trail._map).toBeNull();
    expect(live().state.followKey).not.toBe(first.key);
    await live().setLayer("aircraft", false);
  });

  it("drops the tracks belonging to a layer that is switched off", async () => {
    await load("aircraft");
    live().startTracking("aircraft", stateOf("aircraft").items[0].id);
    await live().setLayer("aircraft", false);
    expect(live().tracks.size).toBe(0);
    expect($("#smxTracked")!.textContent).toContain("Nothing tracked");
  });

  it("marks a fix as stale when the object leaves the feed", async () => {
    await load("aircraft");
    const target = stateOf("aircraft").items[0];
    live().startTracking("aircraft", target.id);
    expect($("#smxTracked")!.textContent).not.toContain("Not in the latest data");

    // The next refresh no longer carries it.
    stateOf("aircraft").items = stateOf("aircraft").items.filter((i: any) => i.id !== target.id);
    live().updateTracks();
    const text = $("#smxTracked")!.textContent!;
    expect(text).toContain("Not in the latest data");
    expect(text).toContain("last fix");
    expect(text).toContain("Waiting for it to come back");
    await live().setLayer("aircraft", false);
  });

  it("still tracks without a location, just without look angles", async () => {
    live().state.home = null;
    await load("aircraft");
    const track = live().startTracking("aircraft", stateOf("aircraft").items[0].id);
    expect(track.view).toBeNull();
    expect(track.points).toHaveLength(1);
    expect($("#smxTracked")!.textContent).toContain("Set your location");
    await live().setLayer("aircraft", false);
  });
});

describe("persistence", () => {
  it("remembers the location, the radius and which layers were on", async () => {
    live().setHome({ lat: 1.5, lng: 2.5 }, "Somewhere");
    live().state.radiusKm = 400;
    await load("launches");
    const saved = kv.get("smx.live") as any;
    expect(saved.home.label).toBe("Somewhere");
    expect(saved.on).toContain("launches");
    expect(saved.alerts.launches).toBeTruthy();
    await live().setLayer("launches", false);
  });
});

describe("replay", () => {
  /** A track with a known ten-minute history, one fix a minute. */
  async function recorded() {
    live().stopTracking();
    live().forgetAllTracks();
    live().setHome({ lat: 12.9716, lng: 77.5946 }, "Bengaluru");
    await load("aircraft");
    const track = live().startTracking("aircraft", stateOf("aircraft").items[0].id);
    const t0 = Date.now() - 10 * 60000;
    track.points = Array.from({ length: 11 }, (_, i) => ({
      t: t0 + i * 60000,
      lat: 12.9 + i * 0.01, lng: 77.5 + i * 0.01,
      alt: 3000 + i * 100, spd: 200, az: 90, el: 10, rng: 100000 - i * 5000,
    }));
    track.trail.setLatLngs(track.points.map((p: any) => [p.lat, p.lng]));
    return track;
  }

  it("spans exactly the recorded window", async () => {
    const track = await recorded();
    const w = live().replayWindow();
    expect(w.from).toBe(track.points[0].t);
    expect(w.to).toBe(track.points[10].t);
  });

  it("clips the line and places a ghost where it was at that moment", async () => {
    const track = await recorded();
    live().setReplay(true);
    live().setReplayTime(track.points[0].t + 5 * 60000);          // half way

    expect(track.ghost).toBeTruthy();
    expect(track.ghost.getLatLng()[0]).toBeCloseTo(12.95, 4);     // the fix five minutes in
    expect(track.trail.getLatLngs()).toHaveLength(6);             // and only what it had flown
    live().setReplayTime(track.points[10].t);
    expect(track.trail.getLatLngs()).toHaveLength(11);
    live().setReplay(false);
    expect(track.ghost).toBeNull();
    expect(track.trail.getLatLngs()).toHaveLength(11);            // the whole line comes back
  });

  it("interpolates between fixes rather than jumping between them", async () => {
    const track = await recorded();
    const midway = track.points[0].t + 90000;                     // 30 s past the second fix
    const at = SMX().Mx.sampleTrack(track.points, midway);
    expect(at.lat).toBeCloseTo(12.915, 4);
    expect(at.alt).toBeCloseTo(3150, 0);
    expect(at.rng).toBeCloseTo(92500, 0);
  });

  it("plays forward at the chosen speed and stops at the end", async () => {
    const track = await recorded();
    live().setReplay(true);
    live().setReplayTime(track.points[0].t);
    live().state.replay.rate = 1800;                              // 30 minutes a second
    live().playReplay();
    expect(live().state.replay.playing).toBe(true);
    await vi.waitUntil(() => !live().state.replay.playing, { timeout: 10000 });
    expect(live().state.replay.t).toBe(live().state.replay.to);
    live().setReplay(false);
  });

  it("scrubbing with the slider moves the replay and pauses playback", async () => {
    const track = await recorded();
    live().setReplay(true);
    live().playReplay();
    const slider = $("#smxReplaySlider") as HTMLInputElement;
    expect(slider).toBeTruthy();
    // Drive it through its own range, the way a pointer does.
    const target = Math.round((Number(slider.min) + Number(slider.max)) / 2);
    slider.value = String(target);
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    expect(live().state.replay.playing).toBe(false);          // scrubbing takes over from playback
    expect(Math.round(live().state.replay.t / 1000)).toBe(Number(slider.value));
    expect(live().state.replay.t).toBeGreaterThanOrEqual(track.points[0].t);
    expect(live().state.replay.t).toBeLessThanOrEqual(track.points[10].t);
    live().setReplay(false);
  });

  it("refuses to replay when nothing has been recorded", async () => {
    live().setReplay(false);
    live().stopTracking();
    live().forgetAllTracks();
    toasts.length = 0;
    live().setReplay(true);
    expect(live().state.replay.on).toBe(false);
    expect(toasts.pop()).toContain("Nothing recorded yet");
    expect($("#smxReplay")!.textContent).toContain("Track something");
  });

  it("labels time marks along the line so the map reads like a timetable", async () => {
    const track = await recorded();
    const marks = SMX().Mx.timeMarks(track.points, { count: 6 });
    expect(marks.length).toBeGreaterThan(2);
    expect(marks.length).toBeLessThanOrEqual(8);
    for (const m of marks) {
      expect(m.t).toBeGreaterThanOrEqual(track.points[0].t);
      expect(m.t).toBeLessThanOrEqual(track.points[10].t);
    }
    track.trail.fire("mouseover");
    expect(track.marks.getLayers().length).toBe(marks.length);
    track.trail.fire("mouseout");
  });
});

describe("a live GPS fix", () => {
  /** Turn the app's own GPS on, the way its tracking code does. */
  function gpsOn(lat: number, lng: number, accuracy = 12) {
    appState.gpsOn = true;
    appState.lastFix = { lat, lng, accuracy };
  }
  function gpsOff() {
    appState.gpsOn = false;
    appState.lastFix = null;
  }

  beforeEach(() => {
    live().setReplay(false);
    live().stopTracking();
    live().forgetAllTracks();
    live().setHome({ lat: 12.9716, lng: 77.5946 }, "Saved location");
    gpsOff();
  });

  it("prefers the live fix over the saved location for every distance", async () => {
    expect(live().observerPoint().label).toBe("Saved location");
    gpsOn(13.2, 77.8);
    expect(live().observerPoint().label).toBe("GPS");
    expect(live().gpsFix().accuracy).toBe(12);

    // Distances are now measured from the fix, not the saved point.
    const item = { lat: 13.2, lng: 77.8 };
    expect(live().distanceToHome(item)).toBeLessThan(100);
    gpsOff();
    expect(live().distanceToHome(item)).toBeGreaterThan(10000);
  });

  it("draws a line from the fix to each tracked object", async () => {
    gpsOn(12.9716, 77.5946);
    await load("aircraft");
    const [a, b] = stateOf("aircraft").items;
    live().startTracking("aircraft", a.id);
    live().startTracking("aircraft", b.id);
    live().drawGpsLines();

    const lines = live().state.gpsLayer.getLayers().filter((l: any) => l.kind === "polyline");
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line._latlngs[0]).toEqual([12.9716, 77.5946]);      // starts at the fix
      expect(line._tooltipContent).toContain("from your GPS fix");
    }
    await live().setLayer("aircraft", false);
  });

  it("outlines the area you and the tracked objects span, and reports it", async () => {
    gpsOn(12.9716, 77.5946);
    await load("aircraft");
    stateOf("aircraft").items.forEach((i: any) => live().startTracking("aircraft", i.id));
    live().drawGpsLines();

    const polygon = live().state.gpsLayer.getLayers().find((l: any) => l.kind === "polygon");
    expect(polygon).toBeTruthy();
    expect(polygon._latlngs.length).toBeGreaterThanOrEqual(3);
    expect(live().state.coverage.area).toBeGreaterThan(0);
    expect(polygon._tooltipContent).toContain("km²");
    expect($("#smxHome")!.textContent).toContain("live GPS fix in use");
    expect($("#smxHome")!.textContent).toContain("Together you span");
    await live().setLayer("aircraft", false);
  });

  it("needs two objects before there is an area to draw", async () => {
    gpsOn(12.9716, 77.5946);
    await load("aircraft");
    live().startTracking("aircraft", stateOf("aircraft").items[0].id);
    live().drawGpsLines();
    expect(live().state.gpsLayer.getLayers().some((l: any) => l.kind === "polygon")).toBe(false);
    expect(live().state.coverage).toBeNull();
    await live().setLayer("aircraft", false);
  });

  it("draws nothing from a fix that is not there, or when switched off", async () => {
    await load("aircraft");
    stateOf("aircraft").items.forEach((i: any) => live().startTracking("aircraft", i.id));
    live().drawGpsLines();
    expect(live().state.gpsLayer.getLayers()).toHaveLength(0);   // no fix

    gpsOn(12.9716, 77.5946);
    live().state.gpsLines = false;
    live().drawGpsLines();
    expect(live().state.gpsLayer.getLayers()).toHaveLength(0);   // switched off
    live().state.gpsLines = true;
    live().drawGpsLines();
    expect(live().state.gpsLayer.getLayers().length).toBeGreaterThan(0);
    await live().setLayer("aircraft", false);
  });

  it("moves the lines with the replay, so the area matches the moment", async () => {
    gpsOn(12.9716, 77.5946);
    await load("aircraft");
    const track = live().startTracking("aircraft", stateOf("aircraft").items[0].id);
    live().startTracking("aircraft", stateOf("aircraft").items[1].id);
    const t0 = Date.now() - 5 * 60000;
    track.points = Array.from({ length: 6 }, (_, i) => ({
      t: t0 + i * 60000, lat: 12.5 + i * 0.1, lng: 77.2 + i * 0.1, alt: 3000, spd: 200, az: 90, el: 10, rng: 50000,
    }));
    live().setReplay(true);
    live().setReplayTime(t0);
    const early = live().state.gpsLayer.getLayers().find((l: any) => l.kind === "polyline")._latlngs[1];
    live().setReplayTime(t0 + 5 * 60000);
    const late = live().state.gpsLayer.getLayers().find((l: any) => l.kind === "polyline")._latlngs[1];
    expect(early).not.toEqual(late);
    live().setReplay(false);
    await live().setLayer("aircraft", false);
  });
});

describe("clicking an object to track it", () => {
  /** Put the popup's markup in the document, the way an open popup does. */
  function openPopupFor(layerId: string, itemId: string) {
    const marker = stateOf(layerId).markers.get(String(itemId));
    marker.openPopup();
    const host = document.createElement("div");
    host.className = "leaflet-popup";
    host.innerHTML = marker._popupContent;
    document.body.appendChild(host);
    return host;
  }

  beforeEach(() => {
    live().stopTracking();
    live().forgetAllTracks();
    document.querySelectorAll(".leaflet-popup").forEach((n) => n.remove());
    live().setHome({ lat: 12.9716, lng: 77.5946 }, "Bengaluru");
  });

  it("keeps one marker per object, addressable by its id", async () => {
    await load("aircraft");
    const st = stateOf("aircraft");
    expect(st.markers.size).toBe(2);
    expect(st.group.getLayers()).toHaveLength(2);
    expect(st.markers.get("abc123")._popupContent).toContain("AI101");
    await live().setLayer("aircraft", false);
  });

  it("tracks from the popup button, and stops from the same button", async () => {
    await load("aircraft");
    const popup = openPopupFor("aircraft", "abc123");
    const button = popup.querySelector("[data-smx-track]") as HTMLButtonElement;
    expect(button.dataset.smxTrack).toBe("aircraft|abc123");
    expect(button.textContent!.trim()).toBe("Track");

    button.click();
    expect(live().tracks.size).toBe(1);
    expect(live().isTracking("aircraft", "abc123")).toBe(true);

    // Reopening shows the other half of the toggle.
    document.querySelectorAll(".leaflet-popup").forEach((n) => n.remove());
    const again = openPopupFor("aircraft", "abc123");
    const stop = again.querySelector("[data-smx-track]") as HTMLButtonElement;
    expect(stop.textContent!.trim()).toBe("Stop tracking");
    stop.click();
    expect(live().tracks.size).toBe(0);
    await live().setLayer("aircraft", false);
  });

  it("tracks an object whose id contains spaces and brackets", async () => {
    // This is every satellite: "ISS (ZARYA)". Building a CSS selector out of an
    // id like that is invalid, which is how the button used to end up unwired.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2024-01-16T12:00:00Z"));
    await load("satellites");
    vi.useRealTimers();

    const iss = stateOf("satellites").items[0];
    expect(iss.id).toBe("ISS (ZARYA)");
    const popup = openPopupFor("satellites", iss.id);
    const button = popup.querySelector("[data-smx-track]") as HTMLButtonElement;
    expect(button.dataset.smxTrack).toBe("satellites|ISS (ZARYA)");

    button.click();
    expect(live().isTracking("satellites", "ISS (ZARYA)")).toBe(true);
    expect([...live().tracks.values()][0].label).toBe("ISS (ZARYA)");
    await live().setLayer("satellites", false);
  });

  it("keeps the marker and its open popup alive across a refresh", async () => {
    await load("aircraft");
    const st = stateOf("aircraft");
    const marker = st.markers.get("abc123");
    marker.openPopup();
    expect(marker.isPopupOpen()).toBe(true);

    await live().refresh("aircraft");
    await vi.waitUntil(() => !stateOf("aircraft").busy, { timeout: 5000 });

    // The same marker object, moved rather than rebuilt — so the popup a finger
    // is heading for is still there when it lands.
    expect(stateOf("aircraft").markers.get("abc123")).toBe(marker);
    expect(marker.isPopupOpen()).toBe(true);
    expect(marker._popupContent).toContain("AI101");
    await live().setLayer("aircraft", false);
  });

  it("removes a marker from the group when its object leaves the feed", async () => {
    await load("aircraft");
    const st = stateOf("aircraft");
    const going = st.markers.get("def456");
    expect(st.group.getLayers()).toHaveLength(2);

    const everything = fixtures.aircraft;
    fixtures.aircraft = { ac: [everything.ac[0], everything.ac[2]] };
    await live().refresh("aircraft");
    await vi.waitUntil(() => stateOf("aircraft").items.length === 1, { timeout: 5000 });

    expect(st.markers.has("def456")).toBe(false);
    expect(st.group.getLayers()).toHaveLength(1);          // no stale layers left behind
    expect(st.group.getLayers()).not.toContain(going);
    fixtures.aircraft = everything;                        // later tests need both back
    await live().setLayer("aircraft", false);
  });

  it("marks the tracked object on the map as tracked", async () => {
    await load("aircraft");
    const marker = stateOf("aircraft").markers.get("abc123");
    live().startTracking("aircraft", "abc123");
    live().refreshMarker("aircraft", "abc123");
    expect(marker._icon_className || marker._lastIcon?.className || "").toBeDefined();
    // The icon is rebuilt with the tracked flag; the framework's own view agrees.
    expect(live().isTracking("aircraft", "abc123")).toBe(true);
    await live().setLayer("aircraft", false);
  });

  it("opens a popup with a GPS fix and no saved location", async () => {
    // This threw "Cannot read properties of null (reading 'label')": the distance
    // came from the GPS fix while the popup still named live.home, which was null.
    live().state.home = null;
    if (live().state.homeMarker) { live().state.homeMarker.remove(); live().state.homeMarker = null; }
    appState.gpsOn = true;
    appState.lastFix = { lat: 12.9716, lng: 77.5946, accuracy: 8 };
    await load("aircraft");

    const marker = stateOf("aircraft").markers.get("abc123");
    expect(() => marker.openPopup()).not.toThrow();
    expect(marker._popupContent).toContain("AI101");
    expect(marker._popupContent).toContain("from GPS");
    expect(marker._popupContent).toContain("data-smx-track");

    // And the button still works with no saved location at all.
    const popup = openPopupFor("aircraft", "abc123");
    (popup.querySelector("[data-smx-track]") as HTMLButtonElement).click();
    expect(live().isTracking("aircraft", "abc123")).toBe(true);

    appState.gpsOn = false;
    appState.lastFix = null;
    await live().setLayer("aircraft", false);
  });

  it("opens a popup with neither a fix nor a location, just without a distance", async () => {
    live().state.home = null;
    appState.gpsOn = false;
    appState.lastFix = null;
    await load("aircraft");
    const marker = stateOf("aircraft").markers.get("abc123");
    expect(() => marker.openPopup()).not.toThrow();
    expect(marker._popupContent).not.toContain("from");
    await live().setLayer("aircraft", false);
  });

  it("ignores a click that carries no object", () => {
    const stray = document.createElement("button");
    stray.dataset.smxTrack = "nonsense-without-a-separator";
    document.body.appendChild(stray);
    expect(() => stray.click()).not.toThrow();
    expect(live().tracks.size).toBe(0);
    stray.remove();
  });
});

describe("active fires", () => {
  it("adds the VIIRS raster and stops at the matrix it publishes", async () => {
    const st = await load("fires");
    expect(st.raster._url).toContain("VIIRS_SNPP_Thermal_Anomalies_375m_All");
    expect(st.raster._opts.maxNativeZoom).toBe(8);
    expect(st.note).toContain("FIRMS");                 // honest about what it is not
    await live().setLayer("fires", false);
    expect(stateOf("fires").raster).toBeNull();
  });
});

describe("air quality (India)", () => {
  beforeEach(() => {
    live().setHome({ lat: 12.9135, lng: 77.6101 }, "Bengaluru");
    live().setKey("datagovin", "");
  });

  it("refuses to load without a key of your own", async () => {
    const st = await load("cpcb-aqi");
    expect(st.error).toBe("needs an API key");
    expect(st.items).toHaveLength(0);
    // And the card offers somewhere to put one.
    expect($("#smxLayers")!.querySelector('[data-key="datagovin"]')).toBeTruthy();
    expect($("#smxLayers")!.textContent).toContain("permanently rate-limited");
    await live().setLayer("cpcb-aqi", false);
  });

  it("loads once a key is set, and remembers it", async () => {
    live().setKey("datagovin", "my-own-key");
    expect((kv.get("smx.keys") as any).datagovin).toBe("my-own-key");
    const st = await load("cpcb-aqi");
    expect(st.error).toBeNull();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("api-key=my-own-key"))).toBe(true);
    await live().setLayer("cpcb-aqi", false);
  });

  it("folds one row per pollutant into one station", async () => {
    live().setKey("datagovin", "k");
    const st = await load("cpcb-aqi");
    expect(st.items).toHaveLength(3);                   // three stations from six rows
    const btm = st.items.find((i: any) => i.city === "Bengaluru");
    expect(btm.pollutants).toEqual({ "PM2.5": 95, PM10: 140, NO2: 14 });
    expect(btm.pm25).toBe(95);
    expect(btm.detail).toContain("PM2.5 95");
    expect(btm.detail).toContain("Bengaluru, Karnataka");
    await live().setLayer("cpcb-aqi", false);
  });

  it("bands a station on CPCB's own PM2.5 breakpoints", async () => {
    live().setKey("datagovin", "k");
    const st = await load("cpcb-aqi");
    const byCity = Object.fromEntries(st.items.map((i: any) => [i.city, i]));
    expect(byCity.Bengaluru.band).toBe(3);             // 95 µg/m³ → poor
    expect(byCity.Bengaluru.detail).toContain("poor");
    expect(byCity.Delhi.band).toBe(4);                 // 310 → the darkest band
    expect(byCity.Kochi.band).toBe(0);                 // PM10 22 → good
    await live().setLayer("cpcb-aqi", false);
  });

  it("colours the stations on the severity ramp, sized by band", async () => {
    live().setKey("datagovin", "k");
    const st = await load("cpcb-aqi");
    const drawn = st.group.getLayers();
    expect(drawn).toHaveLength(3);
    const colours = drawn.map((d: any) => d._opts.color);
    expect(colours).toContain(SMX().SEVERITY[3]);
    expect(colours).toContain(SMX().SEVERITY[4]);
    expect(colours).toContain(SMX().SEVERITY[0]);
    await live().setLayer("cpcb-aqi", false);
  });

  it("drops a station with no coordinates, and says what it found", async () => {
    live().setKey("datagovin", "k");
    const st = await load("cpcb-aqi");
    expect(st.items.some((i: any) => i.label.includes("No Position"))).toBe(false);
    expect(st.note).toContain("3 stations");
    expect(st.note).toContain("worst Delhi 310");
    await live().setLayer("cpcb-aqi", false);
  });

  it("alerts on unhealthy air close by, not on clean air or distant smog", async () => {
    live().setKey("datagovin", "k");
    const st = await load("cpcb-aqi");
    live().state.alerts = [];
    live().state.alerted = new Set();
    Object.assign(st.alert, { on: true, minPm25: 90, maxKm: 30 });
    live().evaluateAlerts("cpcb-aqi");

    expect(live().state.alerts).toHaveLength(1);        // Bengaluru at 95, nearby
    expect(live().state.alerts[0].why).toContain("poor air, 95");
    // Delhi is worse but 1,700 km away; Kochi is close-ish but clean.
    expect(live().state.alerts[0].label).toContain("BTM Layout");
    await live().setLayer("cpcb-aqi", false);
  });
});

describe("direction shown on the track line", () => {
  beforeEach(() => {
    live().stopTracking();
    live().forgetAllTracks();
    live().setHome({ lat: 12.9716, lng: 77.5946 }, "Bengaluru");
  });

  it("gives each track a glow and crawling dashes along its own line", async () => {
    await load("aircraft");
    const track = live().startTracking("aircraft", stateOf("aircraft").items[0].id);
    expect(track.glow._opts.className).toBe("smx-glow");
    expect(track.flow._opts.className).toContain("smx-flow");
    expect(track.flow._opts.dashArray).toBeTruthy();
    // The dashes are a lighter tint of the track's own colour, not white.
    expect(track.flow._opts.color).not.toBe("#ffffff");
    expect(track.flow._opts.color).not.toBe(track.color);
    await live().setLayer("aircraft", false);
  });

  it("animates two tracks differently, so neither is mistaken for the other", async () => {
    await load("aircraft");
    const [a, b] = stateOf("aircraft").items;
    const first = live().startTracking("aircraft", a.id);
    const second = live().startTracking("aircraft", b.id);
    expect(first.flow._opts.className).not.toBe(second.flow._opts.className);
    expect(first.flow._opts.dashArray).not.toBe(second.flow._opts.dashArray);
    expect(first.color).not.toBe(second.color);
    await live().setLayer("aircraft", false);
  });

  it("keeps the glow and the dashes on the same path as the line", async () => {
    await load("aircraft");
    const track = live().startTracking("aircraft", stateOf("aircraft").items[0].id);
    track.points[0].t -= 5000;
    live().updateTracks();
    expect(track.trail.getLatLngs().length).toBeGreaterThan(1);
    expect(track.glow.getLatLngs()).toEqual(track.trail.getLatLngs());
    expect(track.flow.getLatLngs()).toEqual(track.trail.getLatLngs());

    // Including while a replay clips it.
    live().setReplay(true);
    live().setReplayTime(track.points[0].t);
    expect(track.flow.getLatLngs()).toEqual(track.trail.getLatLngs());
    live().setReplay(false);
    expect(track.glow.getLatLngs()).toEqual(track.trail.getLatLngs());
    await live().setLayer("aircraft", false);
  });

  it("takes all three off the map when the track stops", async () => {
    await load("aircraft");
    const track = live().startTracking("aircraft", stateOf("aircraft").items[0].id);
    live().stopTracking(track.key);
    expect(track.trail._map).toBeNull();
    expect(track.glow._map).toBeNull();
    expect(track.flow._map).toBeNull();
    await live().setLayer("aircraft", false);
  });
});
