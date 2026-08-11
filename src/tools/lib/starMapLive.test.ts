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
const panes: Record<string, HTMLElement> = {};

function makeLayer(kind: string, extra: Record<string, any> = {}) {
  const layer: any = {
    kind, _latlngs: [], _style: {}, _map: null, _popup: null, _tooltip: null,
    addTo(m: any) { this._map = m; if (m && m.addLayer) m.addLayer(this); return this; },
    remove() { if (this._map && this._map.removeLayer) this._map.removeLayer(this); this._map = null; return this; },
    clearLayers() { this._children = []; return this; },
    addLayer(l: any) { (this._children ||= []).push(l); return this; },
    getLayers() { return this._children || []; },
    setLatLngs(v: any[]) { this._latlngs = v; return this; },
    getLatLngs() { return this._latlngs; },
    addLatLng(v: any) { this._latlngs.push(v); return this; },
    setLatLng(v: any) { this._latlng = v; return this; },
    setRadius(r: number) { this._radius = r; return this; },
    setStyle(s: any) { Object.assign(this._style, s); return this; },
    setOpacity() { return this; },
    setIcon() { return this; },
    bindPopup(p: any) { this._popup = p; return this; },
    bindTooltip(t: any) { this._tooltip = t; return this; },
    openPopup() { return this; },
    on() { return this; },
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
      "transport", "places", "ocean", "asteroids", "launches", "internet", "gibs",
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
  it("follows an object, grows a trail and stops cleanly", async () => {
    live().setHome({ lat: 12.9716, lng: 77.5946 }, "Bengaluru");
    await load("aircraft");
    const target = stateOf("aircraft").items[0];
    live().startTracking("aircraft", target.id);
    expect(live().state.tracked.itemId).toBe(target.id);
    expect(live().state.tracked.trail.getLatLngs().length).toBe(1);

    await live().refresh("aircraft");
    await vi.waitUntil(() => live().state.tracked.trail.getLatLngs().length > 1, { timeout: 5000 });
    expect($("#smxTracked")!.textContent).toContain("AI101");

    live().stopTracking();
    expect(live().state.tracked).toBeNull();
    expect($("#smxTracked")!.textContent).toContain("Nothing tracked");
    await live().setLayer("aircraft", false);
  });

  it("drops tracking when the layer it belongs to is switched off", async () => {
    await load("aircraft");
    live().startTracking("aircraft", stateOf("aircraft").items[0].id);
    await live().setLayer("aircraft", false);
    expect(live().state.tracked).toBeNull();
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
