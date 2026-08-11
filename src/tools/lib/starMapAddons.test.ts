/**
 * Smoke tests for the Star Map add-ons (public/gadgets/star-map.x-{core,sim,geo}.js).
 *
 * Those files are classic browser scripts that extend the vendored Leaflet app
 * in an iframe, so they cannot be imported as modules or rendered by React.
 * Here they run under jsdom against a minimal Leaflet stub and stubs of the
 * app's script-level globals, which is enough to catch what actually breaks in
 * practice: load-time reference errors, bad DOM wiring, and handlers that throw
 * on the first click.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

/* ------------------------------ Leaflet stub ------------------------------ */

type LatLng = { lat: number; lng: number };
const asLatLng = (p: any): LatLng => (Array.isArray(p) ? { lat: p[0], lng: p[1] } : { lat: p.lat, lng: p.lng });

const layers: any[] = [];

function makeLayer(kind: string, extra: Record<string, any> = {}) {
  const layer: any = {
    kind,
    _latlngs: [],
    _style: {},
    _map: null,
    addTo(m: any) { this._map = m; m.addLayer(this); return this; },
    remove() { if (this._map) this._map.removeLayer(this); this._map = null; return this; },
    setLatLngs(v: any[]) { this._latlngs = v; return this; },
    getLatLngs() { return this._latlngs; },
    setLatLng(v: any) { this._latlng = asLatLng(v); return this; },
    getLatLng() { return this._latlng; },
    setStyle(s: any) { Object.assign(this._style, s); return this; },
    setIcon() { return this; },
    setOpacity() { return this; },
    bindTooltip() { return this; },
    bindPopup() { return this; },
    bringToFront() { return this; },
    on() { return this; },
    off() { return this; },
    ...extra,
  };
  layers.push(layer);
  return layer;
}

function makeGroup(children: any[] = []) {
  return makeLayer("layerGroup", {
    _children: [...children],
    addLayer(l: any) { this._children.push(l); return this; },
    clearLayers() { this._children = []; return this; },
    getLayers() { return this._children; },
  });
}

const panes: Record<string, HTMLElement> = {};

const mapStub: any = {
  _handlers: {} as Record<string, Function[]>,
  _layers: new Set<any>(),
  createPane(name: string) {
    const el = document.createElement("div");
    panes[name] = el;
    return el;
  },
  getPane: (n: string) => panes[n],
  addLayer(l: any) { this._layers.add(l); return this; },
  removeLayer(l: any) { this._layers.delete(l); return this; },
  hasLayer(l: any) { return this._layers.has(l); },
  on(events: string, fn: Function) {
    for (const e of events.split(" ")) (this._handlers[e] ||= []).push(fn);
    return this;
  },
  off() { return this; },
  fire(event: string, payload?: any) { (this._handlers[event] || []).forEach((f: Function) => f(payload)); },
  getCenter: () => ({ lat: 12.9716, lng: 77.5946 }),
  getZoom: () => 13,
  getContainer: () => document.getElementById("map"),
  getBounds: () => ({ pad: () => ({ contains: () => true }), contains: () => true }),
  fitBounds: vi.fn(),
  panTo: vi.fn(),
  flyTo: vi.fn(),
  latLngToContainerPoint: () => ({ add: () => ({ x: 100, y: 0 }) }),
  doubleClickZoom: { enabled: true, enable() { this.enabled = true; }, disable() { this.enabled = false; } },
  containerPointToLatLng: () => ({ lat: 12.9716, lng: 77.6046 }),
};

const L: any = {
  map: () => mapStub,
  svg: () => makeLayer("svg"),
  polyline: (latlngs: any[], opts: any) => makeLayer("polyline", { _latlngs: latlngs, _opts: opts }),
  marker: (latlng: any, opts: any) => makeLayer("marker", { _latlng: asLatLng(latlng), _opts: opts }),
  circle: (latlng: any, opts: any) => makeLayer("circle", { _latlng: asLatLng(latlng), _opts: opts }),
  circleMarker: (latlng: any, opts: any) => makeLayer("circleMarker", { _latlng: asLatLng(latlng), _opts: opts }),
  divIcon: (o: any) => ({ ...o }),
  layerGroup: (children: any[] = []) => makeGroup(children),
  tileLayer: (url: string, opts: any) => makeLayer("tileLayer", { _url: url, _opts: opts }),
  latLngBounds: (pts: any[]) => ({ _pts: pts, extend() { return this; }, contains: () => true, pad() { return this; } }),
  latLng: (lat: number, lng: number) => ({ lat, lng }),
  DomEvent: { stop: () => {} },
};

/* --------------------------- app globals stub --------------------------- */

const toasts: { msg: string; kind?: string }[] = [];
const removeWaypointSpy = vi.fn();
const kv = new Map<string, unknown>();

const appState: any = {
  prefs: { units: "metric", tapAdd: true },
  waypoints: [],
  routes: [],
  selectedRoute: 0,
};

/** Metres per second the real OSRM demo server reports for each profile. */
const PROFILE_SPEED: Record<string, number> = { driving: 13.3, cycling: 4.5, foot: 1.4 };

/** One straight OSRM-shaped route from a→b, with speed annotations. */
function osrmResponse(from: LatLng, to: LatLng, speed: number, steps = 40) {
  const coordinates = Array.from({ length: steps }, (_, i) => {
    const f = i / (steps - 1);
    return [from.lng + (to.lng - from.lng) * f, from.lat + (to.lat - from.lat) * f];
  });
  return {
    code: "Ok",
    routes: [{
      distance: 12000,
      duration: 12000 / speed,
      geometry: { type: "LineString", coordinates },
      legs: [{
        steps: [],
        annotation: { speed: new Array(steps - 1).fill(speed), duration: new Array(steps - 1).fill(1), distance: new Array(steps - 1).fill(1) },
      }],
    }],
  };
}

const fetchMock = vi.fn(async (url: string) => {
  const u = String(url);
  const body = u.includes("/route/v1/")
    ? osrmResponse(
      { lat: 12.9716, lng: 77.5946 }, { lat: 13.03, lng: 77.65 },
      PROFILE_SPEED[(/\/route\/v1\/(\w+)\//.exec(u) || [])[1] || "driving"] || 13.3,
    )
    : u.includes("/v1/elevation")
      ? { elevation: new Array(200).fill(0).map((_, i) => 900 + (i % 17) * 3) }
      : u.includes("air-quality")
        ? { current: { pm2_5: 22, pm10: 40, us_aqi: 71 } }
        : u.includes("/v1/forecast")
          ? {
            timezone: "Asia/Kolkata",
            current: {
              temperature_2m: 28, apparent_temperature: 30, relative_humidity_2m: 60, precipitation: 0,
              weather_code: 2, cloud_cover: 40, pressure_msl: 1012, wind_speed_10m: 11,
              wind_direction_10m: 250, wind_gusts_10m: 19, visibility: 12000,
            },
            hourly: {
              time: Array.from({ length: 12 }, (_, i) => new Date(Date.now() + (i + 1) * 3600e3).toISOString()),
              temperature_2m: new Array(12).fill(27),
              precipitation_probability: new Array(12).fill(15),
            },
          }
          : u.includes("macrostrat")
            ? { success: { data: [{ name: "Peninsular Gneiss", b_age: 3000, t_age: 2500, b_int_name: "Archean", t_int_name: "Archean", lith: "gneiss, granite", environ: "plutonic" }] } }
            : u.includes("earthquake.usgs.gov")
              ? {
                features: [{
                  geometry: { coordinates: [77.6, 12.9, 12] },
                  properties: { mag: 4.2, place: "near nowhere", time: Date.now(), url: "https://example.test", tsunami: 0 },
                }],
              }
              : {};
  return { ok: true, status: 200, json: async () => body } as any;
});

beforeAll(async () => {
  document.body.innerHTML = `<div id="map"></div><div class="hud"></div>` +
    `<div class="fabs"><button id="fabHelp"></button></div><input type="checkbox" id="tapAddToggle" />`;

  Object.assign(globalThis as any, {
    L,
    map: mapStub,
    S: appState,
    CFG: { colors: { selected: "#24b364", alternate: "#8b5cf6", trail: "#ef4444", measure: "#f59e0b" } },
    toast: (msg: string, kind?: string) => { toasts.push({ msg, kind }); },
    store: { get: (k: string, d: unknown) => (kv.has(k) ? kv.get(k) : d), set: (k: string, v: unknown) => kv.set(k, v) },
    routerBase: () => "https://router.project-osrm.org/route/v1",
    OSRM_PROFILE: { driving: "driving", cycling: "cycling", foot: "foot" },
    mkTileLayer: (url: string, opts: any) => L.tileLayer(url, opts),
    addWaypoint: (lat: number, lng: number, name?: string) => {
      appState.waypoints.push({ id: `wp-${name || appState.waypoints.length}`, lat, lng, name });
    },
    removeWaypoint: (id: string) => {
      removeWaypointSpy(id);
      appState.waypoints = appState.waypoints.filter((w: any) => w.id !== id);
    },
    savePrefs: () => kv.set("prefs", { ...appState.prefs }),
    // The add-on wraps these two to animate the app's own calculated route.
    selectRoute: vi.fn((i: number) => { appState.selectedRoute = i; }),
    clearRoutes: vi.fn(() => { appState.routes = []; }),
  });
  (globalThis as any).fetch = fetchMock;
  (window as any).L = L;

  // Load order mirrors the <script> tags the vendor script writes. These are
  // plain browser scripts with no types and no exports; they are imported for
  // their side effects, after the globals above exist.
  /* eslint-disable @typescript-eslint/ban-ts-comment */
  // @ts-expect-error untyped browser script
  await import("../../../public/gadgets/star-map.x-math.js");
  // @ts-expect-error untyped browser script
  await import("../../../public/gadgets/star-map.x-core.js");
  // @ts-expect-error untyped browser script
  await import("../../../public/gadgets/star-map.x-sim.js");
  // @ts-expect-error untyped browser script
  await import("../../../public/gadgets/star-map.x-geo.js");
});

const SMX = () => (globalThis as any).SMX;
const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** Presets route in the background; wait for every agent to have a timetable. */
const waitForSim = (count: number) =>
  vi.waitUntil(
    () => {
      const a = SMX().sim.state.agents;
      return a.length === count && a.every((x: any) => x.schedule || x.error) ? a : false;
    },
    { timeout: 8000, interval: 20 },
  );

describe("add-on shell", () => {
  it("loads all four scripts and exposes the API", () => {
    expect(SMX()).toBeTruthy();
    expect(typeof SMX().FlowRoute).toBe("function");
    expect(typeof SMX().route).toBe("function");
  });

  it("injects the panel, the fab and its stylesheet", () => {
    expect($("#smxPanel")).toBeTruthy();
    expect($("#fabLab")).toBeTruthy();
    expect($("#smx-style")!.textContent).toContain("@keyframes smx-flow");
    // The lab button sits in the app's own fab rail, before Help.
    expect($(".fabs")!.children[0].id).toBe("fabLab");
  });

  it("creates its own map panes so lines stack under markers", () => {
    expect(Object.keys(panes).sort()).toEqual(["smx-agent", "smx-deco", "smx-glow", "smx-line"]);
    expect(panes["smx-line"].style.pointerEvents).toBe("none");
    expect(panes["smx-agent"].style.pointerEvents).toBe("");
  });

  it("registers the four tabs and switches between them", () => {
    const ids = [...document.querySelectorAll(".smx-tab")].map((b) => (b as HTMLElement).dataset.tab);
    expect(ids).toEqual(["sim", "terrain", "geology", "sky"]);
    expect($('.smx-tab[data-tab="sim"]')!.classList.contains("on")).toBe(true);
    SMX().selectTab("geology");
    expect($('.smx-tab[data-tab="geology"]')!.classList.contains("on")).toBe(true);
    SMX().selectTab("sim");
  });

  it("opens and closes from the fab", () => {
    expect(SMX().isOpen()).toBe(false);
    ($("#fabLab") as HTMLButtonElement).click();
    expect(SMX().isOpen()).toBe(true);
    ($("#smxClose") as HTMLButtonElement).click();
    expect(SMX().isOpen()).toBe(false);
    SMX().toggle(true);
  });

  it("formats distance and speed in the app's unit setting", () => {
    expect(SMX().dist(850)).toBe("850 m");
    expect(SMX().dist(4200)).toBe("4.20 km");
    expect(SMX().speed(10)).toBe("36 km/h");
    appState.prefs.units = "imperial";
    expect(SMX().dist(4200)).toBe("2.6 mi");
    expect(SMX().speed(10)).toBe("22 mph");
    appState.prefs.units = "metric";
  });
});

describe("the app's own palette", () => {
  it("moves the app's four colours into the three families", () => {
    const CFG = (globalThis as any).CFG;
    expect(CFG.colors.selected).toBe(SMX().MODE_SHADES.driving[0]);   // was severity green
    expect(CFG.colors.alternate).toBe(SMX().MODE_SHADES.driving[4]);  // was the cycling violet
    expect(CFG.colors.trail).toBe(SMX().ANNOTATION);                  // was severity red
    expect(SMX().SEVERITY).not.toContain(CFG.colors.measure);         // was severity amber
  });

  it("restyles routes that already existed when it ran", () => {
    const layer = makeLayer("polyline");
    appState.routes = [{ layer }];
    appState.selectedRoute = 0;
    SMX().alignAppPalette();
    expect(layer._style.color).toBe(SMX().MODE_SHADES.driving[0]);
    appState.routes = [];
  });
});

describe("animated route", () => {
  const pts = Array.from({ length: 20 }, (_, i) => ({ lat: 12.97, lng: 77.59 + i * 0.002 }));

  it("stacks glow, remaining, travelled and flow lines plus direction arrows", () => {
    const fr = new (SMX().FlowRoute)(pts, { color: "#ff0000" }).addTo(mapStub);
    expect(fr.group._children).toHaveLength(4);
    expect(fr.flow._opts.className).toContain("smx-flow");
    expect(fr.glow._opts.className).toBe("smx-glow");
    expect(fr.flow._opts.dashArray).toBe("2 18");
    expect(fr.arrowLayer._children.length).toBeGreaterThan(0);
    fr.remove();
  });

  it("splits travelled from remaining as progress advances", () => {
    const fr = new (SMX().FlowRoute)(pts, {}).addTo(mapStub);
    expect(fr.travelled.getLatLngs()).toHaveLength(0);
    fr.setProgress(fr.cum[fr.cum.length - 1] / 2);
    const half = fr.travelled.getLatLngs().length;
    expect(half).toBeGreaterThan(2);
    fr.setProgress(fr.cum[fr.cum.length - 1]);
    expect(fr.travelled.getLatLngs().length).toBeGreaterThan(half);
    fr.remove();
  });

  it("re-colours the line into congestion runs and back", () => {
    const fr = new (SMX().FlowRoute)(pts, {}).addTo(mapStub);
    const factors = pts.slice(1).map((_, i) => (i < 8 ? 0.95 : i < 14 ? 0.5 : 0.2));
    fr.showTraffic(factors);
    expect(fr.segments._children).toHaveLength(3);
    const colours = fr.segments._children.map((c: any) => c._opts.color);
    expect(colours).toEqual([SMX().SEVERITY[0], SMX().SEVERITY[2], SMX().SEVERITY[3]]);
    fr.hideTraffic();
    expect(fr.segments).toBeNull();
    fr.remove();
  });
});

describe("simulation tab", () => {
  it("refuses a scenario until there are waypoints to work with", () => {
    toasts.length = 0;
    ($('[data-preset="same-time"]') as HTMLButtonElement).click();
    expect(toasts.pop()!.msg).toContain("two waypoints");
  });

  it("builds one agent per travel mode for same origin, same departure", async () => {
    appState.waypoints = [
      { id: "w1", lat: 12.9716, lng: 77.5946, name: "Home" },
      { id: "w2", lat: 13.03, lng: 77.65, name: "Office" },
    ];
    fetchMock.mockClear();
    ($('[data-preset="same-time"]') as HTMLButtonElement).click();
    const agents = await waitForSim(3);
    expect(agents.map((a: any) => a.error)).toEqual([null, null, null]);

    expect(fetchMock.mock.calls.every((c) => String(c[0]).includes("annotations=speed"))).toBe(true);
    const names = [...document.querySelectorAll("[data-agent] [data-f='name']")].map((i) => (i as HTMLInputElement).value);
    expect(names).toEqual(["Drive", "Cycle", "Walk"]);
    const rows = [...document.querySelectorAll("#smxLiveTable tbody tr")].map((r) => r.textContent || "");
    expect(rows).toHaveLength(3);
    // Walking the same road takes far longer than driving it.
    const durations = SMX().sim.state.agents.map((a: any) => a.schedule.duration);
    expect(durations[2]).toBeGreaterThan(durations[0] * 5);
    expect($("#smxLive")!.textContent).toContain("Arrival order");
  });

  it("colours agents by travel mode, shading agents that share one", async () => {
    const sim = SMX().sim.state;
    const byMode = Object.fromEntries(sim.agents.map((a: any) => [a.mode, a.color]));
    expect(byMode.driving).toBe(SMX().MODE_SHADES.driving[0]);
    expect(byMode.cycling).toBe(SMX().MODE_SHADES.cycling[0]);
    expect(byMode.foot).toBe(SMX().MODE_SHADES.foot[0]);

    // No agent may wear a severity-ramp colour — that is what made the two
    // meanings indistinguishable in the first place.
    const severity: string[] = SMX().SEVERITY;
    expect(sim.agents.some((a: any) => severity.includes(a.color))).toBe(false);
    expect(sim.agents.some((a: any) => a.color === SMX().ANNOTATION)).toBe(false);
  });

  it("nests overlapping routes at different widths, narrowest on top", () => {
    const sim = SMX().sim.state;
    const weights = sim.agents.map((a: any) => a.weight);
    expect(new Set(weights).size).toBe(3);
    expect(weights[0]).toBeGreaterThan(weights[1]);
    expect(weights[1]).toBeGreaterThan(weights[2]);
    expect(Math.min(...weights)).toBeGreaterThanOrEqual(3);
    // Each route's own layers scale with its width.
    const a0 = sim.agents[0];
    expect(a0.flow.glow._style.weight).toBe(a0.weight + 9);
    expect(a0.flow.travelled._style.weight).toBe(a0.weight + 1);
  });

  it("recolours an agent when its mode changes", async () => {
    const card = document.querySelector("[data-agent]") as HTMLElement;
    const sim = SMX().sim.state;
    const agent = sim.agents.find((a: any) => a.id === card.dataset.agent);
    expect(agent.mode).toBe("driving");
    const select = card.querySelector("[data-f='mode']") as HTMLSelectElement;
    select.value = "foot";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    // Now two agents walk: this one is first in the list, the old Walk second.
    expect(agent.color).toBe(SMX().MODE_SHADES.foot[0]);
    expect(sim.agents[2].color).toBe(SMX().MODE_SHADES.foot[1]);
    await waitForSim(3);
  }, 15000);

  it("shades several agents of one mode apart", async () => {
    ($('[data-preset="pace"]') as HTMLButtonElement).click();
    const agents = await waitForSim(3);
    const colours = agents.map((a: any) => a.color);
    expect(new Set(colours).size).toBe(3);
    expect(colours).toEqual(SMX().MODE_SHADES.driving.slice(0, 3));
  }, 15000);

  it("queues a rebuild requested mid-build instead of dropping it", async () => {
    ($('[data-preset="converge"]') as HTMLButtonElement).click();   // starts routing
    ($('[data-preset="same-time"]') as HTMLButtonElement).click();  // arrives mid-flight
    expect(SMX().sim.state.rebuildQueued || SMX().sim.state.building).toBe(true);
    const agents = await waitForSim(3);
    expect(agents.map((a: any) => a.mode)).toEqual(["driving", "cycling", "foot"]);
    expect(agents.every((a: any) => a.schedule)).toBe(true);
  }, 20000);

  it("orders arrivals fastest-first and reports the gap", () => {
    const podium = [...document.querySelectorAll("#smxLive .smx-chip")].map((c) => c.textContent!.trim());
    expect(podium[0]).toContain("1. Drive");
    expect(podium[2]).toContain("3. Walk");
    expect(podium[2]).toMatch(/\+\d/);
  });

  it("finds encounters between agents sharing the road at the same time", () => {
    expect(SMX().sim.state.encounters.length).toBeGreaterThan(0);
    expect($("#smxLive")!.textContent).toContain("Encounters");
  });

  it("plays and pauses the clock", async () => {
    const play = $("#smxPlay") as HTMLButtonElement;
    play.click();
    expect(SMX().sim.state.playing).toBe(true);
    const started = SMX().sim.state.t;
    await tick(80);
    play.click();
    expect(SMX().sim.state.playing).toBe(false);
    // The clock advances by rate × elapsed real time, never backwards.
    expect(SMX().sim.state.t).toBeGreaterThan(started);
    expect(SMX().sim.state.t).toBeLessThanOrEqual(SMX().sim.state.to);
  });

  it("scrubs to an arbitrary time and moves every agent", () => {
    const scrub = $("#smxScrub") as HTMLInputElement;
    const sim = SMX().sim.state;
    const mid = String(Math.round((sim.from + sim.to) / 2));
    scrub.value = mid;
    scrub.dispatchEvent(new Event("input", { bubbles: true }));
    expect(sim.t).toBe(Number(mid));
    const walker = sim.agents.find((a: any) => a.mode === "foot");
    const driver = sim.agents.find((a: any) => a.mode === "driving");
    // At the same moment the driver is further along than the walker.
    expect(SMX().Mx.stateAt(driver, sim.t).dist).toBeGreaterThan(SMX().Mx.stateAt(walker, sim.t).dist);
  });

  it("re-times, not re-routes, when congestion severity changes", async () => {
    const sim = SMX().sim.state;
    const driver = sim.agents.find((a: any) => a.mode === "driving");
    const before = driver.schedule.duration;
    fetchMock.mockClear();
    const sev = $("#smxTfSev") as HTMLInputElement;
    sev.value = "1";
    sev.dispatchEvent(new Event("input", { bubbles: true }));
    await tick(10);
    expect(driver.schedule.duration).not.toBe(before);
    expect(driver.schedule.duration).toBeGreaterThan(driver.schedule.freeFlowDuration);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("turning congestion off returns the driver to free-flow timing", async () => {
    const sim = SMX().sim.state;
    const driver = sim.agents.find((a: any) => a.mode === "driving");
    ($("#smxTfOn") as HTMLInputElement).click();
    await tick(10);
    expect(sim.traffic.enabled).toBe(false);
    expect(driver.schedule.duration).toBeCloseTo(driver.schedule.freeFlowDuration, 3);
    ($("#smxTfOn") as HTMLInputElement).click();
    await tick(10);
  });

  it("a congestion zone dropped on the map slows the agents through it", async () => {
    const sim = SMX().sim.state;
    const driver = sim.agents.find((a: any) => a.mode === "driving");
    const before = driver.schedule.duration;
    ($("#smxZoneAdd") as HTMLButtonElement).click();
    mapStub.fire("click", { latlng: { lat: 13.0, lng: 77.62 } });
    await tick(10);
    expect(sim.traffic.zones).toHaveLength(1);
    expect(driver.schedule.duration).toBeGreaterThan(before);
    ($("#smxZoneClear") as HTMLButtonElement).click();
    await tick(10);
    expect(sim.traffic.zones).toHaveLength(0);
  });

  it("edits a departure time from the agent card, and rejects nonsense", async () => {
    const sim = SMX().sim.state;
    const card = document.querySelector("[data-agent]") as HTMLElement;
    const field = card.querySelector("[data-f='depart']") as HTMLInputElement;
    field.value = "07:15";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await tick(10);
    const agent = sim.agents.find((a: any) => a.id === card.dataset.agent);
    expect(agent.depart).toBe(7 * 3600 + 15 * 60);
    field.value = "99:99";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    expect(field.style.borderColor).toBe("var(--red)");
    expect(agent.depart).toBe(7 * 3600 + 15 * 60);
  });

  it("staggered departures leave agents waiting at the start", async () => {
    ($('[data-preset="staggered"]') as HTMLButtonElement).click();
    await waitForSim(3);
    const sim = SMX().sim.state;
    const departs = sim.agents.map((a: any) => a.depart);
    expect(departs[1] - departs[0]).toBe(900);
    expect(departs[2] - departs[0]).toBe(1800);
    // Nobody has left yet at the first departure instant except the first agent.
    expect(SMX().Mx.stateAt(sim.agents[2], sim.from).phase).toBe("waiting");
  });

  it("removes an agent from its card", async () => {
    const before = SMX().sim.state.agents.length;
    (document.querySelector("[data-agent] [data-act='del']") as HTMLButtonElement).click();
    await tick(10);
    expect(SMX().sim.state.agents).toHaveLength(before - 1);
  });

  it("persists the scenario so a reload keeps it", () => {
    const saved = kv.get("smx.sim") as any;
    expect(saved.agents.length).toBe(SMX().sim.state.agents.length);
    expect(saved.traffic).toBeTruthy();
  });
});

describe("drag and mark modes", () => {
  it("starts in drag mode with the app's tap-to-add off, and shows it in the HUD", () => {
    expect(SMX().getMode()).toBe("drag");
    expect(appState.prefs.tapAdd).toBe(false);
    const pill = $("#smxMode")!;
    expect(document.querySelector(".hud")!.contains(pill)).toBe(true);
    expect($("#smxModeLabel")!.textContent).toBe("Drag");
    expect(pill.classList.contains("marking")).toBe(false);
  });

  it("gives up the map's double-click zoom, since double-click switches mode", () => {
    expect(mapStub.doubleClickZoom.enabled).toBe(false);
  });

  it("double-clicking the map turns marking on, and again turns it off", () => {
    mapStub.fire("dblclick", { latlng: { lat: 12.9, lng: 77.6 } });
    expect(SMX().getMode()).toBe("mark");
    expect(appState.prefs.tapAdd).toBe(true);
    expect($("#smxModeLabel")!.textContent).toBe("Mark");
    expect($("#smxMode")!.classList.contains("marking")).toBe(true);
    expect($("#smxModeHint")!.textContent).toContain("tap adds a point");

    mapStub.fire("dblclick", { latlng: { lat: 12.9, lng: 77.6 } });
    expect(SMX().getMode()).toBe("drag");
    expect(appState.prefs.tapAdd).toBe(false);
  });

  it("undoes the point the exiting double-click just added", () => {
    SMX().setMode("mark");
    // The app adds on click, and a double-click delivers a click first.
    const before = appState.waypoints.length;
    (globalThis as any).addWaypoint(12.9, 77.6, "stray");
    expect(appState.waypoints).toHaveLength(before + 1);
    mapStub.fire("dblclick", { latlng: { lat: 12.9, lng: 77.6 } });
    expect(removeWaypointSpy).toHaveBeenCalledWith("wp-stray");
    expect(appState.waypoints).toHaveLength(before);
    expect(SMX().getMode()).toBe("drag");
  });

  it("keeps a point that was added well before the double-click", async () => {
    removeWaypointSpy.mockClear();
    SMX().setMode("mark");
    (globalThis as any).addWaypoint(12.8, 77.5, "kept");
    // Real time, not a mocked clock: faking Date here also stalls the route
    // draw-in animation, which runs off requestAnimationFrame.
    await tick(500);                              // longer than the 450 ms gesture window
    mapStub.fire("dblclick", { latlng: { lat: 12.8, lng: 77.5 } });
    expect(removeWaypointSpy).not.toHaveBeenCalled();
    expect(appState.waypoints.some((w: any) => w.id === "wp-kept")).toBe(true);
  });

  it("persists the switch and keeps the app's own settings checkbox in step", () => {
    SMX().setMode("mark");
    expect((kv.get("prefs") as any).tapAdd).toBe(true);
    expect(($("#tapAddToggle") as HTMLInputElement).checked).toBe(true);
    SMX().setMode("drag");
    expect(($("#tapAddToggle") as HTMLInputElement).checked).toBe(false);
  });

  it("switches from the HUD pill too", () => {
    ($("#smxMode") as HTMLElement).click();
    expect(SMX().getMode()).toBe("mark");
    ($("#smxMode") as HTMLElement).click();
    expect(SMX().getMode()).toBe("drag");
  });

  it("drops to drag mode while a picker is armed, then restores marking", () => {
    SMX().setClickMode(null);          // earlier tabs may still have one armed
    SMX().setMode("mark");
    SMX().setClickMode({ handler: () => false });
    expect(SMX().getMode()).toBe("drag");
    mapStub.fire("click", { latlng: { lat: 12.9, lng: 77.6 } });
    expect(SMX().getMode()).toBe("mark");
    SMX().setMode("drag");
  });
});

describe("picking a point with alt-click", () => {
  it("selects the alt-clicked point and probes it", async () => {
    SMX().selectTab("terrain");
    mapStub.fire("click", { latlng: { lat: 12.95, lng: 77.62 }, originalEvent: { altKey: true } });
    expect(SMX().geo.state.point).toEqual({ lat: 12.95, lng: 77.62 });
    await vi.waitUntil(() => $("#smxProbe")!.textContent!.includes("Slope"), { timeout: 4000 });
    expect($("#smxCoords")!.textContent).toContain("12.950000, 77.620000");
  });

  it("ignores shift, which Leaflet's box-zoom owns", () => {
    const before = SMX().geo.state.point;
    mapStub.fire("click", { latlng: { lat: 9, lng: 9 }, originalEvent: { shiftKey: true } });
    expect(SMX().geo.state.point).toBe(before);
  });

  it("leaves a plain click alone, so marking still belongs to the app", () => {
    const before = SMX().geo.state.point;
    mapStub.fire("click", { latlng: { lat: 1, lng: 2 }, originalEvent: { altKey: false } });
    expect(SMX().geo.state.point).toBe(before);
  });

  it("also fetches the rock unit when the geology tab is the one showing", async () => {
    SMX().selectTab("geology");
    $("#smxUnits")!.innerHTML = "";
    mapStub.fire("click", { latlng: { lat: 13.1, lng: 77.7 }, originalEvent: { altKey: true } });
    await vi.waitUntil(() => $("#smxUnits")!.textContent!.includes("Peninsular Gneiss"), { timeout: 4000 });
    expect(SMX().geo.state.point).toEqual({ lat: 13.1, lng: 77.7 });
  });
});

describe("the app's own route, animated", () => {
  const line = Array.from({ length: 12 }, (_, i) => ({ lat: 12.97, lng: 77.59 + i * 0.003 }));

  it("wraps the app's selectRoute and clearRoutes", () => {
    expect((globalThis as any).selectRoute.name).toBe("wrappedSelectRoute");
    expect((globalThis as any).clearRoutes.name).toBe("wrappedClearRoutes");
  });

  it("decorates the selected route with a glow and flowing dashes, then draws it in", async () => {
    appState.routes = [{ layer: makeLayer("polyline", { _latlngs: line }) }];
    (globalThis as any).selectRoute(0);

    const deco = SMX().appRouteLayer();
    expect(deco).toBeTruthy();
    expect(deco.group._children).toHaveLength(4);          // glow, remaining, travelled, flow
    expect(deco.flow._opts.className).toContain("smx-flow");
    expect(deco.glow._opts.className).toBe("smx-glow");
    expect(deco.arrowLayer._children.length).toBeGreaterThan(0);
    expect(deco.remaining._style.opacity).toBe(0.2);       // the app's line stays the base

    // The draw-in animation grows the bright part from nothing towards the whole
    // line. It is frame-driven, so assert that it advances rather than pinning a
    // deadline — requestAnimationFrame starves when the whole suite runs at once.
    expect(deco.travelled.getLatLngs()).toHaveLength(0);
    await vi.waitUntil(() => deco.travelled.getLatLngs().length > line.length / 2, { timeout: 15000 });
  }, 25000);

  it("replaces the decoration rather than stacking one per selection", () => {
    const first = SMX().appRouteLayer();
    (globalThis as any).selectRoute(0);
    expect(SMX().appRouteLayer()).not.toBe(first);
    expect(first.group._map).toBeNull();                    // the old one was removed
  });

  it("removes its decoration when the app clears routes", () => {
    expect(SMX().appRouteLayer()).toBeTruthy();
    (globalThis as any).clearRoutes();
    expect(SMX().appRouteLayer()).toBeNull();
    expect(appState.routes).toEqual([]);
  });

  it("survives a route with no usable geometry", () => {
    appState.routes = [{ layer: makeLayer("polyline", { _latlngs: [] }) }];
    expect(() => (globalThis as any).selectRoute(0)).not.toThrow();
    expect(() => (globalThis as any).selectRoute(9)).not.toThrow();
  });
});

describe("terrain tab", () => {
  beforeAll(() => SMX().selectTab("terrain"));

  it("loads an elevation profile and reports climb, descent and gradient", async () => {
    ($("#smxProfileLoad") as HTMLButtonElement).click();
    await vi.waitUntil(() => $("#smxProfile")!.textContent!.includes("Climb"), { timeout: 4000 });
    const text = $("#smxProfile")!.textContent!;
    expect(text).toContain("Descent");
    expect(text).toContain("Steepest");
    expect($("#smxChart")).toBeTruthy();
    expect(SMX().geo.state.profile.samples.length).toBe(120);
  });

  it("colours the path by gradient band on request", async () => {
    ($("#smxGradeOn") as HTMLInputElement).click();
    await tick(10);
    expect(SMX().geo.state.gradeLayer).toBeTruthy();
    expect(SMX().geo.state.gradeLayer._children.length).toBeGreaterThan(50);
    ($("#smxGradeOn") as HTMLInputElement).click();
    expect(SMX().geo.state.gradeLayer).toBeNull();
  });

  it("probes elevation, slope and aspect at a picked point", async () => {
    ($("#smxPick") as HTMLButtonElement).click();
    mapStub.fire("click", { latlng: { lat: 12.99, lng: 77.6 } });
    await vi.waitUntil(() => $("#smxProbe")!.textContent!.includes("Slope"), { timeout: 4000 });
    expect($("#smxProbe")!.textContent).toContain("Faces");
    expect(SMX().geo.state.point.lat).toBe(12.99);
  });

  it("shows the picked point in decimal, DMS, UTM and geohash", () => {
    const text = $("#smxCoords")!.textContent!;
    expect(text).toContain("12.990000, 77.600000");
    expect(text).toMatch(/12° 59′/);
    expect(text).toContain("UTM 43P");
    expect(text).toMatch(/geohash tdr/);
  });
});

describe("geology tab", () => {
  beforeAll(() => SMX().selectTab("geology"));

  it("toggles the raster overlays through the app's caching tile factory", async () => {
    const box = $("#smxOv-geology") as HTMLInputElement;
    box.click();
    await tick(10);
    expect(SMX().geo.state.layers.geology._url).toContain("tiles.macrostrat.org");
    box.click();
    await tick(10);
    expect(SMX().geo.state.layers.geology).toBeUndefined();
  });

  it("shows the feed the state actually holds, not just the first option", () => {
    const select = $("#smxQuakeFeed") as HTMLSelectElement;
    expect(select.value).toBe(SMX().geo.state.quakes.feed);
    expect(select.value).toBe("2.5_week");
  });

  it("keeps the geology overlay visible past its deepest tiles by upscaling", async () => {
    const box = $("#smxOv-geology") as HTMLInputElement;
    box.click();
    await tick(10);
    const opts = SMX().geo.state.layers.geology._opts;
    expect(opts.maxNativeZoom).toBe(13);
    expect(opts.maxZoom).toBeGreaterThan(opts.maxNativeZoom);
    box.click();
    await tick(10);
  });

  it("queries the mapped rock unit at a point", async () => {
    ($("#smxGeoPick") as HTMLButtonElement).click();
    mapStub.fire("click", { latlng: { lat: 12.9, lng: 77.5 } });
    await vi.waitUntil(() => $("#smxUnits")!.textContent!.includes("Peninsular Gneiss"), { timeout: 4000 });
    expect($("#smxUnits")!.textContent).toContain("3000–2500 Ma");
    expect($("#smxUnits")!.textContent).toContain("gneiss");
  });

  it("plots the USGS earthquake feed and clears it again", async () => {
    ($("#smxQuakeLoad") as HTMLButtonElement).click();
    await vi.waitUntil(() => $("#smxQuakeInfo")!.textContent!.includes("events plotted"), { timeout: 4000 });
    expect(SMX().geo.state.quakes.layer._children).toHaveLength(1);
    ($("#smxQuakeClear") as HTMLButtonElement).click();
    expect(SMX().geo.state.quakes.layer).toBeNull();
  });

  it("filters the feed by minimum magnitude", async () => {
    const mag = $("#smxQuakeMag") as HTMLInputElement;
    mag.value = "5";
    mag.dispatchEvent(new Event("input", { bubbles: true }));
    ($("#smxQuakeLoad") as HTMLButtonElement).click();
    await vi.waitUntil(() => $("#smxQuakeInfo")!.textContent!.includes("0 events plotted"), { timeout: 4000 });
    expect(SMX().geo.state.quakes.layer._children).toHaveLength(0);
  });
});

describe("sky tab", () => {
  beforeAll(() => SMX().selectTab("sky"));

  it("computes sun and moon locally, then fetches weather and air quality", async () => {
    ($("#smxSkyLoad") as HTMLButtonElement).click();
    await vi.waitUntil(() => $("#smxWx")!.textContent!.includes("US AQI"), { timeout: 4000 });
    const sky = $("#smxSky")!.textContent!;
    expect(sky).toContain("Sunrise");
    expect(sky).toContain("Golden hour");
    expect(sky).toMatch(/Moon is/);
    const wx = $("#smxWx")!.textContent!;
    expect(wx).toContain("Partly cloudy");
    expect(wx).toContain("hPa");
    expect(wx).toContain("71");                       // the stubbed AQI
  });

  it("checks conditions at five points along the route", async () => {
    ($("#smxRouteWxLoad") as HTMLButtonElement).click();
    await vi.waitUntil(() => $("#smxRouteWx")!.textContent!.includes("five points"), { timeout: 4000 });
    expect(document.querySelectorAll("#smxRouteWx tbody tr")).toHaveLength(1);
  });
});
