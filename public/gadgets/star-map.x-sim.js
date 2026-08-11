/* ==========================================================================
   star-map.x-sim.js — multi-agent route simulation with synthetic congestion.

   Several "agents" travel their own routes on one clock. Each has an origin,
   a destination, a travel mode, a speed factor and a departure time, so the
   interesting cases all fall out of the same model:

     · same origin, same departure  → which mode/speed wins, and by how much
     · same origin, staggered       → gaps, overtakes, catch-up
     · different origins, one time  → who converges, where they meet

   Timing comes from the router's per-segment speeds, scaled by the agent's
   speed factor and by a *simulated* congestion model (SMXMath.trafficFactor).
   Live congestion is not free data; the app's own TomTom layer remains the
   real-data option and the UI says so.
   ========================================================================== */
'use strict';

(function () {
  const X = window.SMX, Mx = X.Mx;
  // `max` caps whatever speed the router reports. The public OSRM demo hosts
  // only the driving profile and answers cycling/foot requests with car speeds,
  // so without a cap a pedestrian would arrive before the car.
  const MODES = {
    driving: { label: 'Drive', base: 13.9, max: Infinity, icon: 'car' },
    cycling: { label: 'Cycle', base: 5.2, max: 6.5, icon: 'bike' },
    foot: { label: 'Walk', base: 1.35, max: 1.6, icon: 'walk' },
  };
  const SPEED_STEPS = [1, 5, 20, 60, 240, 900];
  const STORE_KEY = 'smx.sim';

  const sim = {
    agents: [],
    traffic: { enabled: true, severity: 0.8, seed: 42, zones: [], colour: true },
    t: 0,                     // simulation clock, seconds of day
    from: 0, to: 0,           // timeline bounds
    playing: false,
    rate: 20,                 // sim seconds per real second
    follow: '',
    encounters: [],
    showEncounters: true,
    encounterLayer: L.layerGroup([], { pane: 'smx-agent' }),
    zoneLayer: L.layerGroup(),
    building: false,
    rebuildQueued: false,
    lastFrame: 0,
  };

  const nowClock = () => {
    const d = new Date();
    return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
  };

  let uid = 0;
  const nextId = () => `a${++uid}`;

  /* ------------------------------ agents ------------------------------ */

  function makeAgent(opts) {
    const o = opts || {};
    const i = sim.agents.length;
    return {
      id: nextId(),
      name: o.name || `Agent ${i + 1}`,
      points: null,               // geometry, set from the route once it lands
      color: '#3b82f6',           // replaced by recolour(); never set by hand
      mode: o.mode || 'driving',
      speedScale: o.speedScale || 1,
      depart: o.depart === undefined ? nowClock() : o.depart,
      from: o.from || null,        // {lat,lng,name}
      to: o.to || null,
      via: o.via || [],
      route: null, schedule: null, flow: null, marker: null,
      error: null,
    };
  }

  /**
   * Give every agent its identity colour: the hue of its travel mode, shaded
   * apart from others sharing that mode. Derived, never stored by the user, so
   * switching an agent from Drive to Walk recolours it instead of leaving a blue
   * pedestrian on the map.
   */
  function recolour() {
    const used = {};
    sim.agents.forEach((a, i) => {
      used[a.mode] = (used[a.mode] || 0);
      a.color = X.modeColor(a.mode, used[a.mode]++);
      a.weight = lineWeight(i);
      a.tagRow = i;                    // stagger name tags so shared origins stay readable
      if (a.flow) a.flow.setStyle({ color: a.color, weight: a.weight });
      if (a.marker) a.marker.setIcon(agentIcon(a, 'waiting', 0));
    });
    // Narrowest last so it ends up on top of the wider ones beneath it.
    [...sim.agents].sort((x, y) => y.weight - x.weight).forEach((a) => a.flow && a.flow.bringToFront());
  }

  /** Widths for nested overlapping routes: first agent widest, later ones thinner. */
  const lineWeight = (i) => Math.max(3, 9 - i * 2.2);

  /** Preset scenarios built from whatever waypoints are on the map. */
  function preset(kind) {
    const wp = X.waypoints();
    if (wp.length < 2) {
      X.notify('Add at least two waypoints first — tap the map, then pick a scenario.', 'warn', 4200);
      return;
    }
    const origin = wp[0], dest = wp[wp.length - 1];
    const via = wp.slice(1, -1);
    const base = nowClock();
    clearAgents();

    if (kind === 'same-time') {
      const modes = ['driving', 'cycling', 'foot'];
      modes.forEach((m) => sim.agents.push(makeAgent({
        name: MODES[m].label, mode: m, from: origin, to: dest, via, depart: base,
      })));
    } else if (kind === 'staggered') {
      [0, 900, 1800].forEach((offset) => sim.agents.push(makeAgent({
        name: `+${Mx.dur(offset) === '0s' ? '0m' : Mx.dur(offset)}`, mode: 'driving',
        from: origin, to: dest, via, depart: base + offset, speedScale: 1,
      })));
    } else if (kind === 'converge') {
      const origins = wp.slice(0, -1);
      origins.forEach((o, i) => sim.agents.push(makeAgent({
        name: o.name || `From ${i + 1}`, mode: 'driving', from: o, to: dest, depart: base,
      })));
    } else if (kind === 'pace') {
      [[0.7, 'Cautious'], [1, 'Normal'], [1.35, 'Quick']].forEach(([scale, name]) => sim.agents.push(makeAgent({
        name, mode: 'driving', from: origin, to: dest, via, depart: base, speedScale: scale,
      })));
    }
    recolour();
    renderAgents();
    build();
  }

  function clearAgents() {
    for (const a of sim.agents) disposeAgent(a);
    sim.agents = [];
    sim.encounters = [];
    sim.encounterLayer.clearLayers();
  }

  function disposeAgent(a) {
    if (a.flow) a.flow.remove();
    if (a.marker) a.marker.remove();
    a.flow = null; a.marker = null; a.schedule = null; a.route = null; a.points = null;
  }

  /* ------------------------------ building ------------------------------ */

  /**
   * Route every agent and turn each geometry into a time table.
   *
   * Requests are sequential with a small gap: the public OSRM demo server
   * rate-limits, and a burst of parallel calls is the fastest way to get 429s
   * for the rest of the session.
   */
  async function build() {
    // A second request mid-flight (a new preset, a changed mode) must not be
    // dropped, or the agents keep the previous run's routes — or none at all.
    if (sim.building) { sim.rebuildQueued = true; return; }
    if (!sim.agents.length) { paint(); return; }
    sim.building = true;
    pause();
    setStatus('Routing…');
    try {
      for (const a of sim.agents) {
        a.error = null;
        if (!a.from || !a.to) { a.error = 'no origin/destination'; continue; }
        try {
          const pts = [a.from, ...(a.via || []), a.to];
          a.route = await X.route(pts, a.mode, 20000);
        } catch (err) {
          a.error = err.message || 'routing failed';
          continue;
        }
        await new Promise((r) => setTimeout(r, 220));
      }
      for (const a of sim.agents) rebuildSchedule(a);
      recolour();                        // widths and z-order follow the final list
      recompute();
      sim.t = sim.from;
      fitAll();
      const ok = sim.agents.filter((a) => a.schedule).length;
      setStatus(ok ? '' : 'Routing failed for every agent.');
      if (ok) X.notify(`${ok} agent${ok > 1 ? 's' : ''} ready. Press play.`, 'ok');
      save();
    } finally {
      sim.building = false;
      renderAgents();
      paint();
      if (sim.rebuildQueued) {
        sim.rebuildQueued = false;
        build();
      }
    }
  }

  /** Re-time an agent without re-routing — cheap, so sliders stay responsive. */
  function rebuildSchedule(a) {
    if (!a.route) { a.schedule = null; a.points = null; return; }
    // SMXMath reads geometry off `agent.points` (stateAt, encounters), so mirror
    // the routed geometry there rather than passing it around separately.
    a.points = a.route.points;
    a.schedule = Mx.buildSchedule({
      points: a.route.points,
      speeds: a.route.speeds,
      baseSpeed: MODES[a.mode].base,
      maxSpeed: MODES[a.mode].max,
      speedScale: a.speedScale,
      departAt: a.depart,
      startHour: 0,                       // depart is already seconds of day
      traffic: {
        enabled: sim.traffic.enabled && a.mode === 'driving',
        seed: sim.traffic.seed,
        severity: sim.traffic.severity,
        zones: sim.traffic.zones,
      },
    });
    if (!a.flow) {
      a.flow = new X.FlowRoute(a.route.points, {
        color: a.color,
        weight: a.weight === undefined ? lineWeight(sim.agents.indexOf(a)) : a.weight,
      }).addTo(map);
      a.marker = L.marker([a.route.points[0].lat, a.route.points[0].lng], {
        pane: 'smx-agent', icon: agentIcon(a, 'waiting', 0), zIndexOffset: 500,
      }).addTo(map);
      a.marker.bindTooltip(() => tooltipFor(a), { direction: 'right', offset: [12, 0] });
    } else {
      a.flow.setStyle({ color: a.color, weight: a.weight });
    }
    if (sim.traffic.colour && sim.traffic.enabled && a.mode === 'driving') a.flow.showTraffic(a.schedule.factors);
    else a.flow.hideTraffic();
  }

  function agentIcon(a, phase, bearing) {
    return L.divIcon({
      className: `smx-agent ${phase}`, iconSize: [26, 26], iconAnchor: [13, 13],
      html: `<div class="body" style="background:${a.color};transform:rotate(${bearing}deg)">
               <span style="display:flex;transform:rotate(${-bearing}deg)">${X.icon(MODES[a.mode].icon)}</span>
             </div><span class="tag" style="top:${-8 - (a.tagRow || 0) * 15}px">${X.esc(a.name)}</span>`,
    });
  }

  function tooltipFor(a) {
    if (!a.schedule) return X.esc(a.name);
    const st = Mx.stateAt(a, sim.t);
    return `<b>${X.esc(a.name)}</b><br>${X.dist(st.dist)} of ${X.dist(a.schedule.distance)}
            <br>${X.speed(st.speed)} · ${st.phase}
            <br>ETA ${Mx.clock(a.schedule.departAt + a.schedule.duration)}`;
  }

  /** Timeline bounds, encounters and arrival order — after any timing change. */
  function recompute() {
    const ready = sim.agents.filter((a) => a.schedule);
    if (!ready.length) { sim.from = sim.to = 0; sim.encounters = []; return; }
    sim.from = Math.min(...ready.map((a) => a.schedule.departAt));
    sim.to = Math.max(...ready.map((a) => a.schedule.departAt + a.schedule.duration)) + 30;
    sim.t = Mx.clamp(sim.t, sim.from, sim.to);
    // Sampling every 4 s of sim time keeps a 2-hour, 6-agent scenario at a few
    // hundred thousand distance checks — fast enough to do synchronously.
    sim.encounters = ready.length > 1
      ? Mx.encounters(ready, { threshold: 130, step: 4, end: sim.to })
      : [];
    drawEncounters();
  }

  function drawEncounters() {
    sim.encounterLayer.clearLayers();
    if (!sim.showEncounters) return;
    sim.encounters.forEach((ev, i) => {
      L.marker([ev.lat, ev.lng], {
        pane: 'smx-agent',
        icon: L.divIcon({ className: 'smx-meet', iconSize: [16, 16], iconAnchor: [8, 8], html: '<div></div>' }),
      })
        .bindTooltip(`${X.esc(ev.aName)} × ${X.esc(ev.bName)}<br>${Mx.clock(ev.t)} · ${X.dist(ev.distance)} apart`,
          { direction: 'top' })
        .addTo(sim.encounterLayer)
        .on('click', () => jumpTo(ev.t, [ev.lat, ev.lng], i));
    });
    if (!map.hasLayer(sim.encounterLayer)) sim.encounterLayer.addTo(map);
  }

  function fitAll() {
    const bounds = sim.agents.filter((a) => a.route).reduce((acc, a) => {
      const b = L.latLngBounds(a.route.points.map((p) => [p.lat, p.lng]));
      return acc ? acc.extend(b) : b;
    }, null);
    if (bounds) map.fitBounds(bounds, { padding: [60, 60], maxZoom: 15 });
  }

  /* ------------------------------ playback ------------------------------ */

  function play() {
    if (sim.playing || !sim.agents.some((a) => a.schedule)) return;
    if (sim.t >= sim.to) sim.t = sim.from;
    sim.playing = true;
    sim.lastFrame = performance.now();
    requestAnimationFrame(frame);
    syncControls();
  }

  function pause() {
    sim.playing = false;
    syncControls();
  }

  function frame(now) {
    if (!sim.playing) return;
    // Clamped at both ends: a tab-switch produces a huge gap, and a frame
    // timestamp on a different clock base than performance.now() can produce a
    // negative one, which would run the simulation backwards.
    const dt = Mx.clamp((now - sim.lastFrame) / 1000, 0, 0.25);
    sim.lastFrame = now;
    sim.t += dt * sim.rate;
    if (sim.t >= sim.to) { sim.t = sim.to; pause(); }
    paint();
    if (sim.playing) requestAnimationFrame(frame);
  }

  function jumpTo(t, latlng, encounterIndex) {
    sim.t = Mx.clamp(t, sim.from, sim.to);
    if (latlng) map.panTo(latlng);
    if (encounterIndex !== undefined) highlightEncounter(encounterIndex);
    paint();
  }

  /** Move every marker/line to the current clock and refresh the readouts. */
  function paint() {
    for (const a of sim.agents) {
      if (!a.schedule || !a.marker) continue;
      const st = Mx.stateAt(a, sim.t);
      a.marker.setLatLng([st.lat, st.lng]);
      a.marker.setIcon(agentIcon(a, st.phase, st.bearing));
      a.flow.setProgress(st.dist);
      a.flow.setStyle({ opacity: st.phase === 'arrived' ? 0.55 : 1 });
      if (sim.follow === a.id && st.phase === 'moving') map.panTo([st.lat, st.lng], { animate: false });
    }
    paintReadouts();
  }

  const paintReadouts = X.throttle(() => {
    const clockEl = root.querySelector('#smxClock');
    if (clockEl) clockEl.textContent = Mx.clock(sim.t, true);
    const scrub = root.querySelector('#smxScrub');
    if (scrub && document.activeElement !== scrub) {
      scrub.min = String(sim.from);
      scrub.max = String(Math.max(sim.to, sim.from + 1));
      scrub.value = String(sim.t);
    }
    renderLive();
  }, 120);

  /* ------------------------------ traffic ------------------------------ */

  function armZonePicker() {
    X.setClickMode({
      hint: 'Tap the map to drop a congestion zone. Esc to stop.',
      handler: (latlng) => {
        const radius = Number(root.querySelector('#smxZoneRadius').value) || 600;
        const severity = Number(root.querySelector('#smxZoneSeverity').value) || 0.8;
        sim.traffic.zones.push({ lat: latlng.lat, lng: latlng.lng, radius, severity });
        drawZones();
        retime();
        renderTraffic();
        return true;                                    // stay armed for more
      },
      onEnd: () => { map.getContainer().style.cursor = ''; },
    });
  }

  function drawZones() {
    sim.zoneLayer.clearLayers();
    sim.traffic.zones.forEach((z, i) => {
      L.circle([z.lat, z.lng], {
        radius: z.radius, color: X.TRAFFIC_COLORS[3], weight: 1.5,
        fillColor: X.TRAFFIC_COLORS[3], fillOpacity: 0.12 + 0.2 * z.severity,
      })
        .bindTooltip(`Congestion zone ${i + 1}<br>${X.dist(z.radius)} · severity ${Math.round(z.severity * 100)}%`,
          { direction: 'top' })
        .addTo(sim.zoneLayer);
    });
    if (!map.hasLayer(sim.zoneLayer)) sim.zoneLayer.addTo(map);
  }

  /** Re-time all agents (no re-routing) and refresh derived data. */
  function retime() {
    for (const a of sim.agents) rebuildSchedule(a);
    recompute();
    paint();
    renderLive();
    save();
  }

  /* ---------------------------- persistence ---------------------------- */

  function save() {
    try {
      store.set(STORE_KEY, {
        traffic: { ...sim.traffic, zones: sim.traffic.zones },
        rate: sim.rate,
        agents: sim.agents.map((a) => ({
          name: a.name, color: a.color, mode: a.mode, speedScale: a.speedScale,
          depart: a.depart, from: a.from, to: a.to, via: a.via,
        })),
      });
    } catch (_) { /* storage is best-effort */ }
  }

  function restore() {
    let saved = null;
    try { saved = store.get(STORE_KEY, null); } catch (_) { return; }
    if (!saved || !Array.isArray(saved.agents) || !saved.agents.length) return;
    Object.assign(sim.traffic, saved.traffic || {});
    sim.traffic.zones = (saved.traffic && saved.traffic.zones) || [];
    sim.rate = saved.rate || sim.rate;
    sim.agents = saved.agents.map((a) => makeAgent(a));
    recolour();
    drawZones();
    renderAgents();
    renderTraffic();
  }

  /* -------------------------------- UI -------------------------------- */

  let root = null;

  const tab = X.registerTab({
    id: 'sim',
    label: 'Sim',
    icon: 'route',
    title: 'Route simulation — several travellers on one clock',
    build(el) {
      root = el;
      el.innerHTML = `
        <h4>Scenario</h4>
        <div class="smx-btns">
          <button class="smx-btn" data-preset="same-time" title="Same origin and destination, all leaving now, one per travel mode">Same point, same time</button>
          <button class="smx-btn" data-preset="staggered" title="Same route, departures 15 minutes apart">Staggered start</button>
        </div>
        <div class="smx-btns" style="margin-top:6px">
          <button class="smx-btn" data-preset="converge" title="Every waypoint except the last becomes an origin heading to the last one">Different points, one time</button>
          <button class="smx-btn" data-preset="pace" title="Same route, three driving paces">Pace compare</button>
        </div>
        <div class="smx-hint" id="smxStatus"></div>
        <div class="smx-hint">Cycling and walking follow the <i>driving</i> road geometry at capped speeds —
          the public OSRM demo server only hosts the car profile. Use them to compare pace and departure
          time, not as real cycling or footpath routes.</div>

        <h4>Clock</h4>
        <div class="smx-row">
          <button class="smx-btn" id="smxPlay" style="min-width:64px">${X.icon('play')} Play</button>
          <button class="smx-btn" id="smxRewind" title="Back to the first departure">${X.icon('rewind')}</button>
          <b class="grow smx-mono" id="smxClock" style="text-align:right;font-size:15px">--:--:--</b>
        </div>
        <input type="range" id="smxScrub" min="0" max="1" step="1" value="0" aria-label="Simulation time" />
        <div class="smx-row">
          <label class="smx-lbl" for="smxRate">Speed</label>
          <select id="smxRate" class="grow">${SPEED_STEPS.map((s) => `<option value="${s}">${s}× real time</option>`).join('')}</select>
        </div>
        <div class="smx-row">
          <label class="smx-lbl" for="smxFollow">Camera</label>
          <select id="smxFollow" class="grow"><option value="">Free</option></select>
        </div>

        <h4>Agents <span id="smxCount" class="smx-hint"></span></h4>
        <div id="smxAgents"></div>
        <div class="smx-btns" style="margin-top:6px">
          <button class="smx-btn" id="smxAdd">${X.icon('plus')} Add agent</button>
          <button class="smx-btn" id="smxRebuild">${X.icon('rotate')} Re-route</button>
          <button class="smx-btn" id="smxClear" title="Remove every agent">${X.icon('trash')}</button>
        </div>

        <h4>Live</h4>
        <div id="smxLive"></div>

        <h4>Congestion <span class="smx-warn" title="Modelled, not measured">(simulated)</span></h4>
        <div id="smxTraffic"></div>

        <h4>Colour key</h4>
        <div id="smxColourKey"></div>
      `;

      X.on(el, '[data-preset]', 'click', (_e, b) => preset(b.dataset.preset));
      el.querySelector('#smxPlay').addEventListener('click', () => (sim.playing ? pause() : play()));
      el.querySelector('#smxRewind').addEventListener('click', () => { pause(); sim.t = sim.from; paint(); });
      el.querySelector('#smxScrub').addEventListener('input', (e) => { pause(); sim.t = Number(e.target.value); paint(); });
      el.querySelector('#smxRate').addEventListener('change', (e) => { sim.rate = Number(e.target.value); save(); });
      el.querySelector('#smxRate').value = String(sim.rate);
      el.querySelector('#smxFollow').addEventListener('change', (e) => { sim.follow = e.target.value; });
      el.querySelector('#smxAdd').addEventListener('click', addFromWaypoints);
      el.querySelector('#smxRebuild').addEventListener('click', build);
      el.querySelector('#smxClear').addEventListener('click', () => { clearAgents(); renderAgents(); paint(); save(); });

      renderTraffic();
      el.querySelector('#smxColourKey').innerHTML = X.colourKey();
      renderAgents();
      restore();
      syncControls();
    },
    onShow() { renderAgents(); paint(); },
  });

  function setStatus(text) {
    const s = root && root.querySelector('#smxStatus');
    if (s) s.textContent = text || '';
  }

  function syncControls() {
    if (!root) return;
    const btn = root.querySelector('#smxPlay');
    if (btn) {
      btn.innerHTML = sim.playing
        ? `${X.icon('pause')} Pause`
        : `${X.icon('play')} Play`;
      btn.disabled = !sim.agents.some((a) => a.schedule);
    }
  }

  function addFromWaypoints() {
    const wp = X.waypoints();
    if (wp.length < 2) { X.notify('Add at least two waypoints on the map first.', 'warn'); return; }
    sim.agents.push(makeAgent({
      from: wp[0], to: wp[wp.length - 1], via: wp.slice(1, -1), depart: nowClock(),
    }));
    recolour();
    renderAgents();
    build();
  }

  function renderAgents() {
    if (!root) return;
    const host = root.querySelector('#smxAgents');
    const count = root.querySelector('#smxCount');
    if (count) count.textContent = sim.agents.length ? `· ${sim.agents.length}` : '· none yet';
    if (!host) return;
    if (!sim.agents.length) {
      host.innerHTML = `<div class="smx-hint">No agents. Drop waypoints on the map, then pick a scenario above —
        or add one agent at a time and give each its own departure time.</div>`;
    } else {
      host.innerHTML = sim.agents.map((a) => `
        <div class="smx-card" data-agent="${a.id}">
          <div class="smx-row" style="margin-top:0">
            <span class="smx-sw" style="background:${a.color}"></span>
            <input type="text" class="grow" data-f="name" value="${X.esc(a.name)}" aria-label="Agent name" />
            <button class="smx-btn" data-act="focus" title="Zoom to this route">${X.icon('crosshair')}</button>
            <button class="smx-btn" data-act="del" title="Remove">${X.icon('x')}</button>
          </div>
          <div class="smx-row">
            <label class="smx-lbl">Mode</label>
            <select data-f="mode" class="grow">
              ${Object.entries(MODES).map(([k, m]) => `<option value="${k}" ${a.mode === k ? 'selected' : ''}>${m.label}</option>`).join('')}
            </select>
            <label class="smx-lbl" style="min-width:42px;text-align:right">Depart</label>
            <input type="text" data-f="depart" value="${Mx.clock(a.depart)}" style="max-width:62px" aria-label="Departure time" />
          </div>
          <div class="smx-row">
            <label class="smx-lbl">Pace ${a.speedScale.toFixed(2)}×</label>
            <input type="range" data-f="speedScale" min="0.4" max="2" step="0.05" value="${a.speedScale}" class="grow" />
          </div>
          <div class="smx-hint" style="margin:2px 0 0">
            ${a.error ? `<span class="smx-warn">${X.esc(a.error)}</span>`
              : a.schedule
                ? `${X.dist(a.schedule.distance)} · ${Mx.dur(a.schedule.duration)} · arrive ${Mx.clock(a.schedule.departAt + a.schedule.duration)}
                   ${a.schedule.duration - a.schedule.freeFlowDuration > 30
                     ? `· <span class="smx-warn">+${Mx.dur(a.schedule.duration - a.schedule.freeFlowDuration)} congestion</span>` : ''}`
                : 'not routed yet'}
          </div>
        </div>`).join('');
    }

    const follow = root.querySelector('#smxFollow');
    if (follow) {
      const prev = sim.follow;
      follow.innerHTML = '<option value="">Free</option>' +
        sim.agents.map((a) => `<option value="${a.id}">Follow ${X.esc(a.name)}</option>`).join('');
      follow.value = sim.agents.some((a) => a.id === prev) ? prev : '';
      sim.follow = follow.value;
    }
    syncControls();
    renderLive();
  }

  // Field edits: name/mode/pace/depart. Mode changes need a new route; the
  // others only need re-timing, which is instant.
  document.addEventListener('input', (e) => {
    const card = e.target.closest && e.target.closest('[data-agent]');
    if (!card || !root || !root.contains(card)) return;
    const a = sim.agents.find((x) => x.id === card.dataset.agent);
    if (!a) return;
    const field = e.target.dataset.f;
    if (field === 'name') { a.name = e.target.value.slice(0, 24) || a.name; if (a.marker) a.marker.setIcon(agentIcon(a, 'waiting', 0)); save(); return; }
    if (field === 'speedScale') {
      a.speedScale = Number(e.target.value);
      const label = card.querySelector('.smx-lbl');
      if (label) label.textContent = `Pace ${a.speedScale.toFixed(2)}×`;
      retime();
      return;
    }
    if (field === 'depart') {
      const parsed = Mx.parseClock(e.target.value);
      e.target.style.borderColor = parsed === null ? 'var(--red)' : '';
      if (parsed !== null) { a.depart = parsed; retime(); }
    }
  });

  document.addEventListener('change', (e) => {
    const card = e.target.closest && e.target.closest('[data-agent]');
    if (!card || !root || !root.contains(card)) return;
    const a = sim.agents.find((x) => x.id === card.dataset.agent);
    if (a && e.target.dataset.f === 'mode') {
      a.mode = e.target.value;
      disposeAgent(a);
      recolour();                       // the hue follows the mode, always
      build();
    }
  });

  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('[data-act]');
    const card = btn && btn.closest('[data-agent]');
    if (!card || !root || !root.contains(card)) return;
    const idx = sim.agents.findIndex((x) => x.id === card.dataset.agent);
    if (idx < 0) return;
    const a = sim.agents[idx];
    if (btn.dataset.act === 'del') {
      disposeAgent(a);
      sim.agents.splice(idx, 1);
      recolour();
      recompute();
      renderAgents();
      paint();
      save();
    } else if (btn.dataset.act === 'focus' && a.route) {
      map.fitBounds(L.latLngBounds(a.route.points.map((p) => [p.lat, p.lng])), { padding: [50, 50] });
    }
  });

  /* ---------------------------- live readouts ---------------------------- */

  function renderLive() {
    if (!root) return;
    const host = root.querySelector('#smxLive');
    if (!host) return;
    const ready = sim.agents.filter((a) => a.schedule);
    if (!ready.length) { host.innerHTML = '<div class="smx-hint">Nothing simulated yet.</div>'; return; }

    const rows = ready.map((a) => {
      const st = Mx.stateAt(a, sim.t);
      const delay = a.schedule.duration - a.schedule.freeFlowDuration;
      return `<tr>
        <td><span class="smx-sw" style="background:${a.color};display:inline-block"></span> ${X.esc(a.name)}</td>
        <td>${Math.round(st.progress * 100)}%</td>
        <td>${X.dist(st.remaining)}</td>
        <td>${st.phase === 'moving' ? X.speed(st.speed) : st.phase === 'waiting' ? `waits ${Mx.dur(a.schedule.departAt - sim.t)}` : 'arrived'}</td>
        <td>${Mx.clock(st.eta)}${delay > 30 ? ` <span class="smx-warn">+${Mx.dur(delay)}</span>` : ''}</td>
      </tr>`;
    }).join('');

    const order = Mx.arrivals(ready);
    const podium = order.map((a) => `<span class="smx-chip">${a.rank}. ${X.esc(a.name)}
        ${a.behind ? `<span class="smx-hint">+${Mx.dur(a.behind)}</span>` : X.icon('pin')}</span>`).join(' ');

    const meets = sim.encounters.length
      ? `<table class="smx-t"><thead><tr><th>Time</th><th>Who</th><th>Gap</th><th></th></tr></thead><tbody>
          ${sim.encounters.slice(0, 12).map((ev, i) => `<tr>
            <td>${Mx.clock(ev.t)}</td>
            <td>${X.esc(ev.aName)} × ${X.esc(ev.bName)}</td>
            <td>${X.dist(ev.distance)}</td>
            <td><button class="smx-btn" data-meet="${i}" title="Jump to this moment">${X.icon('pin')}</button></td>
          </tr>`).join('')}
        </tbody></table>
        ${sim.encounters.length > 12 ? `<div class="smx-hint">+${sim.encounters.length - 12} more</div>` : ''}`
      : '<div class="smx-hint">No two agents come within 130 m of each other in this run.</div>';

    host.innerHTML = `
      <table class="smx-t" id="smxLiveTable">
        <thead><tr><th>Agent</th><th>Done</th><th>Left</th><th>Now</th><th>ETA</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <h4>Arrival order</h4>
      <div class="smx-legend">${podium}</div>
      <h4>Encounters <span class="smx-hint">within 130 m</span></h4>
      ${meets}
      <div class="smx-row">
        <label class="smx-lbl grow" for="smxShowMeet">Show encounter pins</label>
        <input type="checkbox" id="smxShowMeet" ${sim.showEncounters ? 'checked' : ''} />
      </div>`;

    host.querySelector('#smxShowMeet').addEventListener('change', (e) => {
      sim.showEncounters = e.target.checked;
      drawEncounters();
    });
    X.on(host, '[data-meet]', 'click', (_e, b) => {
      const ev = sim.encounters[Number(b.dataset.meet)];
      if (ev) jumpTo(ev.t, [ev.lat, ev.lng], Number(b.dataset.meet));
    });
  }

  function highlightEncounter(i) {
    const ev = sim.encounters[i];
    if (!ev) return;
    L.circle([ev.lat, ev.lng], { radius: 130, color: '#f59e0b', weight: 2, fill: false })
      .addTo(map)
      .on('add', function () { setTimeout(() => this.remove(), 2200); });
  }

  /* ---------------------------- traffic UI ---------------------------- */

  function renderTraffic() {
    if (!root) return;
    const host = root.querySelector('#smxTraffic');
    if (!host) return;
    host.innerHTML = `
      <div class="smx-row">
        <label class="smx-lbl grow" for="smxTfOn">Model congestion</label>
        <input type="checkbox" id="smxTfOn" ${sim.traffic.enabled ? 'checked' : ''} />
      </div>
      <div class="smx-row">
        <label class="smx-lbl">Severity</label>
        <input type="range" id="smxTfSev" min="0" max="1" step="0.05" value="${sim.traffic.severity}" class="grow" />
        <span class="smx-mono" id="smxTfSevVal">${Math.round(sim.traffic.severity * 100)}%</span>
      </div>
      <div class="smx-row">
        <label class="smx-lbl" for="smxTfSeed">Pattern</label>
        <input type="number" id="smxTfSeed" value="${sim.traffic.seed}" min="0" max="9999" class="grow" />
        <button class="smx-btn" id="smxTfDice" title="Another congestion pattern">${X.icon('dice')}</button>
      </div>
      <div class="smx-row">
        <label class="smx-lbl grow" for="smxTfColour">Colour routes by congestion</label>
        <input type="checkbox" id="smxTfColour" ${sim.traffic.colour ? 'checked' : ''} />
      </div>
      <div class="smx-legend">${X.TRAFFIC_COLORS.map((c, i) =>
        `<span class="smx-chip"><span class="smx-sw" style="background:${c}"></span>${X.TRAFFIC_LABELS[i]}</span>`).join('')}</div>
      <div class="smx-hint">With this on, each route is overpainted by congestion band while its glow and the
        travelled part keep the agent's own colour — so you can still tell whose route it is. Agents sharing a
        road are drawn at different widths (first agent widest) so none of them hides the others.</div>

      <h4>Congestion zones</h4>
      <div class="smx-row">
        <label class="smx-lbl" for="smxZoneRadius">Radius m</label>
        <input type="number" id="smxZoneRadius" value="600" min="50" max="20000" step="50" class="grow" />
        <label class="smx-lbl" style="min-width:52px;text-align:right" for="smxZoneSeverity">Severity</label>
        <input type="number" id="smxZoneSeverity" value="0.85" min="0" max="1" step="0.05" style="max-width:64px" />
      </div>
      <div class="smx-btns">
        <button class="smx-btn" id="smxZoneAdd">${X.icon('pointer')} Drop zones on map</button>
        <button class="smx-btn" id="smxZoneClear" title="Clear zones" ${sim.traffic.zones.length ? '' : 'disabled'}>${X.icon('trash')}</button>
      </div>
      <div class="smx-hint">${sim.traffic.zones.length
        ? `${sim.traffic.zones.length} zone${sim.traffic.zones.length > 1 ? 's' : ''} — segments inside them slow down regardless of the hour.`
        : 'Roadworks, a flooded underpass, a market street: drop a zone and re-time.'}</div>
      <div class="smx-hint">
        This congestion is <b>modelled</b>: a rush-hour curve for each agent's own departure time, a
        deterministic per-road roughness from the pattern seed, plus your zones. It is repeatable and
        good for comparing departures — it is not measured traffic. For real congestion tiles use the
        app's own traffic button with a TomTom key.
      </div>`;

    host.querySelector('#smxTfOn').addEventListener('change', (e) => { sim.traffic.enabled = e.target.checked; retime(); });
    host.querySelector('#smxTfColour').addEventListener('change', (e) => { sim.traffic.colour = e.target.checked; retime(); });
    host.querySelector('#smxTfSev').addEventListener('input', (e) => {
      sim.traffic.severity = Number(e.target.value);
      host.querySelector('#smxTfSevVal').textContent = `${Math.round(sim.traffic.severity * 100)}%`;
      retime();
    });
    host.querySelector('#smxTfSeed').addEventListener('change', (e) => { sim.traffic.seed = Number(e.target.value) || 0; retime(); });
    host.querySelector('#smxTfDice').addEventListener('click', () => {
      sim.traffic.seed = Math.floor(Math.random() * 9999);
      renderTraffic();
      retime();
    });
    host.querySelector('#smxZoneAdd').addEventListener('click', armZonePicker);
    host.querySelector('#smxZoneClear').addEventListener('click', () => {
      sim.traffic.zones = [];
      drawZones();
      renderTraffic();
      retime();
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') X.setClickMode(null);
  });

  // Let the other add-on tabs reuse a simulated route (elevation, weather…).
  X.sim = {
    state: sim,
    activeRoute: () => {
      const a = sim.agents.find((x) => x.id === sim.follow) || sim.agents.find((x) => x.route);
      return a && a.route ? { name: a.name, points: a.route.points, distance: a.route.distance } : null;
    },
    tab,
  };
})();
