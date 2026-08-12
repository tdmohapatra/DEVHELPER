/**
 * Poke every Map Lab interaction and demand silence.
 *
 *   1. npm run dev
 *   2. chrome --headless=new --remote-debugging-port=9222 --user-data-dir=<temp> about:blank
 *   3. node scripts/stress-map-lab.mjs http://localhost:5173/gadgets/star-map.html
 *
 * Exits after printing either NO ERRORS or the list. Not part of `npm test`: it
 * needs a browser and the live upstream APIs, so it is a thing you run when you
 * have changed the add-ons, not on every commit.
 *
 * Turns on every layer, clicks and hovers real markers, drives both map modes,
 * tracks several objects, scrubs the replay, exports, toggles GPS on and off with
 * and without a saved location — and fails on any uncaught exception or console
 * error. The class of bug this catches is the one that keeps biting: an optional
 * thing read without a guard on a path only a click reaches.
 */
const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const ws = new WebSocket(list.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pending = new Map(); const errors = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); }
  if (m.method === "Runtime.exceptionThrown") errors.push("EXCEPTION " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || "").split("\n")[0]);
  if (m.method === "Log.entryAdded" && m.params.entry.level === "error"
      && !/Failed to load resource|net::ERR|429|504|CORS/.test(m.params.entry.text)) {
    errors.push("console " + m.params.entry.text.slice(0, 160));
  }
});
const send = (method, params = {}) => new Promise((res, rej) => { const n = ++id; pending.set(n, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: n, method, params })); });
const evaluate = async (e) => {
  const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) { errors.push("EVAL " + (r.exceptionDetails.exception?.description || "").split("\n")[0]); return null; }
  return r.result.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const click = async (x, y) => {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0 });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1, buttons: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1, buttons: 0 });
};
const step = async (name, expr) => { const out = await evaluate(expr); console.log(`${name}: ${out === null || out === undefined ? "ok" : out}`); };

await send("Runtime.enable"); await send("Log.enable"); await send("Page.enable");
await send("Page.navigate", { url: process.argv[2] });
for (let i = 0; i < 60 && (await evaluate("typeof window.SMX")) !== "object"; i++) await wait(500);

await step("open", "document.querySelector('#fabLab').click(); window.SMX.selectTab('live'); map.setView([12.9716,77.5946],9); window.SMX.live.forgetAllTracks(); 'ok'");

// 1. Every layer on, with no location and no GPS at all.
await step("noLocation", `(() => { S.gpsOn = false; S.lastFix = null; window.SMX.live.state.home = null; return 'ok'; })()`);
await step("allLayersOn", `(async () => {
  for (const l of window.SMX.live.layers) await window.SMX.live.setLayer(l.id, true);
  return 'ok';
})()`);
await wait(20000);
await step("layerStates", `JSON.stringify(window.SMX.live.layers.map(l => {
  const st = window.SMX.live.layerState(l.id);
  return l.id + '=' + (st.error ? 'ERR:' + st.error : st.items.length);
}))`);

// 2. Click real markers of several layers, with no location set.
for (const layerId of ["aircraft", "satellites", "launches", "internet"]) {
  const at = await evaluate(`(() => {
    const st = window.SMX.live.layerState(${JSON.stringify(layerId)});
    for (const [, m] of st.markers) {
      const p = map.latLngToContainerPoint(m.getLatLng());
      if (p.x > 360 && p.y > 30 && p.x < innerWidth - 40 && p.y < 380) return JSON.stringify({ x: Math.round(p.x), y: Math.round(p.y) });
    }
    return null;
  })()`);
  if (!at) { console.log(`click:${layerId}: no marker in a clear spot`); continue; }
  const p = JSON.parse(at);
  await click(p.x, p.y);
  await wait(500);
  const got = await evaluate(`(() => {
    const b = document.querySelector('.leaflet-popup [data-smx-track]');
    if (!b) return 'popup without a track button';
    b.click();
    return 'tracked ' + b.dataset.smxTrack;
  })()`);
  console.log(`click:${layerId}: ${got}`);
}

// 3. Hover every tracked line.
await step("hoverAll", `(() => {
  for (const t of window.SMX.live.tracks.values()) {
    t.trail.fire('mouseover');
    window.SMX.live.hoverInfo(t, t.points.length ? { lat: t.points[0].lat, lng: t.points[0].lng } : null);
    t.trail.fire('mouseout');
  }
  return window.SMX.live.tracks.size + ' hovered';
})()`);

// 4. GPS on with no saved location — the exact crash the user reported.
await step("gpsNoHome", `(() => {
  S.gpsOn = true; S.lastFix = { lat: 12.9716, lng: 77.5946, accuracy: 9 };
  window.SMX.live.state.home = null;
  window.SMX.live.drawGpsLines();
  window.SMX.live.updateTracks();
  window.SMX.live.renderPanel();
  const st = window.SMX.live.layerState('aircraft');
  const m = [...st.markers.values()][0];
  if (m) m.openPopup();
  return 'popup ok, lines=' + window.SMX.live.state.gpsLayer.getLayers().length;
})()`);

// 5. Then a saved location as well, and alerts armed on every layer that has one.
await step("armAllAlerts", `(() => {
  window.SMX.live.setHome({ lat: 12.9716, lng: 77.5946 }, 'Bengaluru');
  for (const l of window.SMX.live.layers) {
    const st = window.SMX.live.layerState(l.id);
    if (l.alert) { st.alert.on = true; window.SMX.live.evaluateAlerts(l.id); }
  }
  return window.SMX.live.state.alerts.length + ' alerts';
})()`);

// 6. Replay: on, scrub both ends, play, pause, off.
await step("replay", `(() => {
  window.SMX.live.setReplay(true);
  const r = window.SMX.live.state.replay;
  window.SMX.live.setReplayTime(r.from);
  window.SMX.live.setReplayTime((r.from + r.to) / 2);
  window.SMX.live.playReplay();
  window.SMX.live.pauseReplay();
  window.SMX.live.setReplayTime(r.to);
  window.SMX.live.setReplay(false);
  return 'ok';
})()`);

// 7. Exports for every track, all three formats.
await step("exports", `(() => {
  const original = window.download; let n = 0;
  window.download = () => { n++; };
  for (const key of window.SMX.live.tracks.keys()) {
    for (const f of ['gpx', 'csv', 'json']) window.SMX.live.exportTrack(key, f);
  }
  window.download = original;
  return n + ' files';
})()`);

// 8. Modes, and a triple-click gesture in each. Close any popup first: a click
// inside one is deliberately ignored by the gesture, which would confound this.
await step("closePopups", "map.closePopup(); document.querySelectorAll('.leaflet-popup').forEach(n => n.remove()); 'ok'");
await step("modes", `(() => {
  window.SMX.setMode('mark');
  const marking = window.SMX.getMode();
  window.SMX.setMode('drag');
  return marking + ' -> ' + window.SMX.getMode();
})()`);
for (let i = 0; i < 3; i++) { await click(700, 500); await wait(90); }
await wait(400);
await step("afterTriple", "window.SMX.getMode() + ' waypoints=' + S.waypoints.length");
for (let i = 0; i < 3; i++) { await click(700, 500); await wait(90); }
await wait(400);
await step("afterTriple2", "window.SMX.getMode() + ' waypoints=' + S.waypoints.length");

// 9. Other tabs, since they share the same globals.
await step("otherTabs", `(() => {
  for (const tab of ['sim', 'terrain', 'geology', 'sky', 'live']) window.SMX.selectTab(tab);
  return 'ok';
})()`);

// 10. Everything off again.
await step("allOff", `(async () => {
  for (const l of window.SMX.live.layers) await window.SMX.live.setLayer(l.id, false);
  window.SMX.live.stopTracking();
  return window.SMX.live.tracks.size + ' tracks left';
})()`);

await wait(1500);
console.log(errors.length ? `\nERRORS (${errors.length}):\n` + [...new Set(errors)].join("\n") : "\nNO ERRORS");
ws.close();
