/* ==========================================================================
   star-map.x-core.js — add-on shell: panel, panes, animated route renderer.

   Loaded after star-map.app.js, so the upstream app's script-level globals
   (map, S, CFG, toast, store, getJSON, routerBase, OSRM_PROFILE) are already
   in the global lexical scope and are read from here. Nothing in the generated
   app files is modified; this only adds.

   Exposes window.SMX for star-map.x-sim.js and star-map.x-geo.js.
   ========================================================================== */
'use strict';

window.SMX = (function () {
  const Mx = window.SMXMath;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /* ------------------------------ styles ------------------------------ */

  const CSS = `
  /* ---- panel ---- */
  .smx {
    position:absolute; z-index:1450;
    top: calc(112px + var(--safe-t)); left: calc(12px + var(--safe-l));
    width: 336px; max-width: calc(100vw - 84px);
    display:flex; flex-direction:column;
    background: var(--surface); backdrop-filter: blur(14px);
    border:1px solid var(--border); border-radius: var(--radius);
    box-shadow: var(--shadow); overflow:hidden;
    font-size:13px;
  }
  .smx.hidden { display:none; }
  .smx-head { display:flex; align-items:center; gap:8px; padding:9px 12px;
              border-bottom:1px solid var(--border); cursor:grab; user-select:none; }
  .smx-head.grabbing { cursor:grabbing; }
  .smx-head b { font-size:13px; letter-spacing:.01em; flex:1; }
  .smx-head .smx-x { background:none; border:0; color:var(--text-dim); padding:2px 4px; }
  .smx-head .smx-x:hover { color:var(--text); }
  .smx-tabs { display:flex; gap:2px; padding:6px 8px 0; border-bottom:1px solid var(--border); }
  .smx-tab { flex:1; background:transparent; border:0; border-bottom:2px solid transparent;
             color:var(--text-dim); padding:6px 2px 7px; font-size:11px; font-weight:600;
             text-transform:uppercase; letter-spacing:.03em; border-radius:6px 6px 0 0; }
  .smx-tab:hover { color:var(--text); background:var(--surface-2); }
  .smx-tab.on { color:var(--text); border-bottom-color: var(--blue); }
  .smx-tab i { display:block; font-size:13px; margin-bottom:3px; }
  .smx-body { overflow-y:auto; max-height: min(58vh, 520px); padding:10px 12px 14px; }
  .smx-body::-webkit-scrollbar { width:5px; }
  .smx-body::-webkit-scrollbar-thumb { background:var(--border); border-radius:9px; }
  .smx-collapsed .smx-tabs, .smx-collapsed .smx-body { display:none; }

  /* ---- bits ---- */
  .smx h4 { font-size:10.5px; text-transform:uppercase; letter-spacing:.06em;
            color:var(--text-dim); margin:12px 0 6px; font-weight:700; }
  .smx h4:first-child { margin-top:0; }
  .smx .smx-hint { color:var(--text-dim); font-size:11px; line-height:1.45; margin:6px 0; }
  .smx .smx-row { display:flex; align-items:center; gap:8px; margin:6px 0; }
  .smx .smx-row > .grow { flex:1; min-width:0; }
  .smx label.smx-lbl { color:var(--text-dim); font-size:11px; min-width:74px; }
  .smx input[type=text], .smx input[type=number], .smx select {
    background: var(--surface-2); border:1px solid var(--border); color:var(--text);
    border-radius:9px; padding:5px 8px; font-size:12px; min-width:0; width:100%;
  }
  .smx input[type=range] { width:100%; accent-color: var(--blue); }
  .smx .smx-btn { background:var(--surface-2); border:1px solid var(--border); color:var(--text);
                  border-radius:10px; padding:6px 10px; font-size:12px; font-weight:600;
                  display:inline-flex; align-items:center; gap:6px; justify-content:center; }
  .smx .smx-btn:hover { border-color: var(--blue); }
  .smx .smx-btn.on { background: var(--accent); color: var(--accent-text); border-color:transparent; }
  .smx .smx-btn.wide { width:100%; }
  .smx .smx-btn:disabled { opacity:.45; pointer-events:none; }
  .smx .smx-btns { display:flex; gap:6px; flex-wrap:wrap; }
  .smx .smx-btns > .smx-btn { flex:1 1 0; }
  .smx .smx-chip { display:inline-flex; align-items:center; gap:5px; padding:3px 8px;
                   border:1px solid var(--border); border-radius:999px; font-size:11px;
                   background:var(--surface-2); }
  .smx .smx-sw { width:10px; height:10px; border-radius:50%; flex:0 0 auto; }
  .smx .smx-stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(72px,1fr)); gap:6px; margin:8px 0; }
  .smx .smx-stat { background:var(--surface-2); border-radius:10px; padding:6px 8px; }
  .smx .smx-stat b { display:block; font-size:14px; font-variant-numeric:tabular-nums; }
  .smx .smx-stat small { color:var(--text-dim); font-size:10px; text-transform:uppercase; letter-spacing:.04em; }
  .smx table.smx-t { width:100%; border-collapse:collapse; font-size:11.5px; }
  .smx table.smx-t th { text-align:left; color:var(--text-dim); font-weight:600; font-size:10px;
                        text-transform:uppercase; letter-spacing:.04em; padding:4px 4px; }
  .smx table.smx-t td { padding:4px 4px; border-top:1px solid var(--border);
                        font-variant-numeric:tabular-nums; }
  .smx .smx-card { border:1px solid var(--border); border-radius:12px; padding:8px 9px; margin:6px 0;
                   background:var(--surface-2); }
  .smx .smx-card.on { border-color: var(--blue); }
  .smx .smx-warn { color:var(--amber); }
  .smx .smx-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:11px; }
  .smx .smx-legend { display:flex; flex-wrap:wrap; gap:8px; font-size:10.5px; color:var(--text-dim); }

  /* ---- animated route ---- */
  @keyframes smx-flow { to { stroke-dashoffset: -240; } }
  @keyframes smx-pulse { 0%,100% { opacity:.16; } 50% { opacity:.34; } }
  path.smx-flow { animation: smx-flow 3.6s linear infinite; pointer-events:none; }
  path.smx-flow.fast { animation-duration: 1.5s; }
  path.smx-glow { animation: smx-pulse 2.8s ease-in-out infinite; pointer-events:none;
                  filter: blur(2px); }
  .smx-ico { width:15px; height:15px; flex:0 0 auto; vertical-align:-3px; }
  .smx-tab .smx-ico { width:15px; height:15px; margin:0 auto 3px; display:block; vertical-align:0; }
  .smx-hint .smx-ico { width:13px; height:13px; }
  @keyframes smx-spin { to { transform: rotate(360deg); } }
  .smx-spin { animation: smx-spin 1s linear infinite; transform-origin: 50% 50%; }

  /* ---- the Space tab's 3D overlay ----
     It covers the map rather than living inside the panel: a solar system in a
     280px column is unreadable, and the panel stays usable on top of it. */
  .smx-space { position:fixed; inset:0; z-index:8000; background:#05070d; }
  .smx-space-canvas { position:absolute; inset:0; }
  .smx-space-canvas canvas { display:block; }
  .smx-space-hud { position:absolute; left:14px; top:14px; max-width:min(520px, 52vw);
                   background:rgba(10,14,22,.72); border:1px solid var(--border);
                   border-radius:10px; padding:10px 12px; backdrop-filter: blur(6px);
                   pointer-events:none; }
  .smx-space-hud b { font-size:15px; }
  .smx-space-row { display:flex; flex-direction:column; gap:2px; }
  .smx-space-close { position:absolute; right:14px; top:14px; width:32px; height:32px;
                     border-radius:8px; background:rgba(10,14,22,.72); color:var(--text);
                     border:1px solid var(--border); cursor:pointer; font-size:15px; }
  .smx-space-close:hover { border-color: var(--blue); }
  .smx-space-fail { position:absolute; inset:0; display:grid; place-items:center;
                    color:var(--text-dim); padding:24px; text-align:center; }
  .smx .smx-btn.smx-primary { background:var(--accent); color:var(--accent-text); border-color:transparent; }

  /* the checkboxes, both on the view and in the panel */
  .smx-space-layers { position:absolute; right:14px; top:56px; display:flex; flex-direction:column;
                      gap:3px; background:rgba(10,14,22,.72); border:1px solid var(--border);
                      border-radius:10px; padding:9px 11px; backdrop-filter: blur(6px); }
  .smx-space-layer, .smx-check { display:flex; align-items:center; gap:6px; font-size:12px;
                                 color:var(--text); cursor:pointer; user-select:none; }
  .smx-check { padding:2px 0; }
  .smx-space-layer input, .smx-check input { accent-color: var(--blue); cursor:pointer; margin:0; }

  /* the event console: small, out of the way, and never covering the middle */
  .smx-space-console { position:absolute; left:14px; bottom:14px; width:min(420px, 44vw);
                       max-height:34vh; overflow:auto; background:rgba(10,14,22,.78);
                       border:1px solid var(--border); border-radius:10px; padding:8px 10px;
                       backdrop-filter: blur(6px); font-size:12px; }
  .smx-space-console-head { font-weight:600; margin-bottom:4px; }
  .smx-space-event { padding:2px 0; border-left:2px solid transparent; padding-left:6px; }
  .smx-space-event.smx-ev-near { border-left-color:#00e676; }
  .smx-space-event.smx-ev-approach { border-left-color:#ff5470; }
  .smx-space-event.smx-ev-moon { border-left-color:#cfd4da; }
  .smx-space-event.smx-ev-follow, .smx-space-event.smx-ev-data { border-left-color:var(--blue); }

  /* the geometry readout for whatever is selected */
  .smx-space-geometry { margin-top:6px; padding-top:6px; border-top:1px solid var(--border);
                        font-size:12px; line-height:1.5; max-height:42vh; overflow:auto; }
  .smx-geo-row { display:flex; gap:10px; align-items:baseline; padding:1px 0; }
  .smx-geo-row > span { flex:0 0 92px; text-align:right; color:var(--text-dim); }
  .smx-geo-row > b { flex:1 1 auto; font-weight:500; min-width:0; }

  /* the hover readout */
  .smx-space-tip { position:absolute; pointer-events:none; background:rgba(10,14,22,.92);
                   border:1px solid var(--border); border-radius:8px; padding:6px 9px;
                   font-size:12px; line-height:1.45; max-width:260px; z-index:2; }

  /* ---- drag / mark mode pill (lives in the app's own HUD) ---- */
  .smx-mode { cursor:pointer; user-select:none; }
  .smx-mode .smx-mode-dot { width:8px; height:8px; border-radius:50%; background:var(--text-dim);
                            box-shadow:0 0 0 0 rgba(236,72,153,.6); flex:0 0 auto; }
  .smx-mode.marking { border-color:#ec4899; }
  .smx-mode.marking .smx-mode-dot { background:#ec4899; animation: smx-mark 1.8s infinite; }
  @keyframes smx-mark {
    0%   { box-shadow:0 0 0 0 rgba(236,72,153,.6); }
    70%  { box-shadow:0 0 0 8px rgba(236,72,153,0); }
    100% { box-shadow:0 0 0 0 rgba(236,72,153,0); }
  }

  .smx-arrow { pointer-events:none; }
  .smx-arrow svg { display:block; filter: drop-shadow(0 0 2px rgba(0,0,0,.65)); }

  /* ---- agent marker ---- */
  .smx-agent { pointer-events:auto; }
  .smx-agent .body { width:26px; height:26px; margin:-13px 0 0 -13px; border-radius:50%;
                     display:grid; place-items:center; color:#fff; font-size:12px;
                     box-shadow:0 2px 10px rgba(0,0,0,.5); border:2px solid rgba(255,255,255,.85); }
  .smx-agent .tag { position:absolute; left:16px; top:-8px; white-space:nowrap;
                    background:var(--surface); border:1px solid var(--border);
                    border-radius:999px; padding:1px 7px; font-size:10.5px; font-weight:700;
                    box-shadow:var(--shadow); }
  .smx-agent.waiting .body { opacity:.5; }
  .smx-agent.arrived .body { filter:saturate(.4); }
  /* Encounters are annotation, not severity — magenta, never amber. */
  .smx-meet { pointer-events:auto; }
  .smx-meet div { width:16px; height:16px; margin:-8px 0 0 -8px; border-radius:50%;
                  border:2px solid #ec4899; background:rgba(236,72,153,.35); }

  /* ---- structured popup / readout blocks ---- */
  /* A label above its value, in a grid: reads as a table without drawing one. */
  .smx-kv { display:grid; grid-template-columns:repeat(auto-fit,minmax(64px,1fr));
            gap:5px 10px; margin:5px 0; }
  .smx-kv > div { min-width:0; }
  .smx-kv b { display:block; font-size:12.5px; font-variant-numeric:tabular-nums;
              white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .smx-kv small { display:block; font-size:9px; letter-spacing:.07em; text-transform:uppercase;
                  color:var(--text-dim); }
  .smx-route { display:flex; align-items:baseline; gap:7px; margin:5px 0 2px; flex-wrap:wrap; }
  .smx-route .code { font-size:15px; font-weight:800; letter-spacing:.02em; }
  .smx-route .place { font-size:10.5px; color:var(--text-dim); }
  .smx-route .arrow { color:var(--text-dim); font-size:13px; }
  .smx-meta { font-size:10.5px; color:var(--text-dim); margin:3px 0 0; }
  .smx-rule { height:1px; background:var(--border); margin:6px 0; border:0; }
  .smx-progress { height:3px; border-radius:2px; background:var(--surface-2); overflow:hidden; margin:4px 0 2px; }
  .smx-progress span { display:block; height:100%; background:var(--blue); }

  /* ---- live layers ---- */
  .smx-live-dot { pointer-events:auto; }
  .smx-live-dot .glyph { display:block; width:22px; height:22px; line-height:22px; text-align:center;
                         font-size:14px; filter: drop-shadow(0 1px 2px rgba(0,0,0,.7)); }
  .smx-live-dot.tracked .glyph { filter: drop-shadow(0 0 6px #ec4899); }
  .smx-live-dot.tracked::after { content:''; position:absolute; inset:-5px; border-radius:50%;
                                 border:2px solid #ec4899; animation: smx-mark 1.6s infinite; }
  /* Direction rhythms: one per tracked object, so two tracks never animate alike. */
  .smx-flow-0 { animation-duration: 3.6s; }
  .smx-flow-1 { animation-duration: 2.2s; }
  .smx-flow-2 { animation-duration: 1.3s; }
  .smx-flow-3 { animation-duration: 5s; }
  .smx-flow-4 { animation-duration: 2.8s; animation-direction: reverse; }

  /* ---- aircraft, told apart by silhouette ---- */
  /* One colour for all civil traffic: the shape is what classifies it. */
  .smx-live-dot.smx-ac svg { color:#e6edf5; filter: drop-shadow(0 1px 2px rgba(0,0,0,.85)); }
  .smx-live-dot.smx-ac .glyph { display:grid; place-items:center; width:100%; height:100%; }
  /* Only two things move, and both earn it. */
  .smx-live-dot.smx-ac-helicopter .rotor { transform-origin:12px 6.2px; animation: smx-rotor 1.1s linear infinite; }
  @keyframes smx-rotor { to { transform: rotate(360deg); } }
  .smx-live-dot.smx-ac-drone svg { animation: smx-drone 1.8s ease-in-out infinite; }
  @keyframes smx-drone { 0%,100% { opacity:.75; } 50% { opacity:1; } }
  /* On the ground: still there, no longer shouting. */
  .smx-live-dot.smx-ac-parked svg { color:#8b98a8; filter:none; opacity:.75; }
  .smx-live-dot.smx-ac-parked::after { display:none; }

  /* A military or state aircraft: its own mark, glowing, unmistakable among airliners. */
  .smx-live-dot.smx-mil .glyph { width:26px; height:26px; line-height:26px; }
  .smx-live-dot.smx-mil svg { color:#00e676; fill:#00e676;
                              filter: drop-shadow(0 0 5px #00e676) drop-shadow(0 0 1px #000); }
  .smx-live-dot.smx-mil::after { content:''; position:absolute; inset:-4px; border-radius:50%;
                                 border:1.5px solid rgba(0,230,118,.75); animation: smx-mil 2.2s infinite; }
  @keyframes smx-mil {
    0%   { box-shadow:0 0 0 0 rgba(0,230,118,.55); opacity:1; }
    70%  { box-shadow:0 0 0 10px rgba(0,230,118,0); opacity:.6; }
    100% { box-shadow:0 0 0 0 rgba(0,230,118,0); opacity:1; }
  }

  .smx-live-dot.replay .glyph { opacity:.85; filter: drop-shadow(0 0 5px #ec4899); }
  .smx-timemark span { display:block; font-size:9.5px; font-weight:700; text-align:center;
                       color:var(--text); background:var(--surface); border:1px solid var(--border);
                       border-radius:999px; padding:0 4px; box-shadow:var(--shadow); }
  .smx-home span { display:block; width:26px; height:26px; line-height:24px; text-align:center;
                   color:#ec4899; font-size:20px; filter: drop-shadow(0 1px 3px rgba(0,0,0,.8)); }

  /* ---- profile chart ---- */
  .smx-chart { width:100%; height:110px; display:block; touch-action:none; }
  .smx-chart .grid { stroke: var(--border); stroke-width:1; }
  .smx-chart .fill { fill: rgba(10,132,255,.18); }
  .smx-chart .line { fill:none; stroke: var(--blue); stroke-width:1.6; }
  .smx-chart .cursor { stroke:#ec4899; stroke-width:1; }
  .smx-fab-badge { position:absolute; top:-3px; right:-3px; background:var(--blue); color:#fff;
                   border-radius:999px; font-size:9px; line-height:1; padding:2px 4px; font-weight:800; }
  `;

  const style = document.createElement('style');
  style.id = 'smx-style';
  style.textContent = CSS;
  document.head.appendChild(style);

  /* ------------------------------ panes ------------------------------ */

  const PANES = { glow: 393, line: 405, deco: 455, agent: 615 };
  for (const [name, z] of Object.entries(PANES)) {
    const pane = map.createPane('smx-' + name);
    pane.style.zIndex = String(z);
    if (name !== 'agent') pane.style.pointerEvents = 'none';
  }
  /**
   * Popups and tooltips have to sit above every panel, not just above the map.
   *
   * Leaflet puts them at z-index 700, while the Map Lab panel is at 1450 and the
   * app's own sheet at 2000 — so a popup for anything behind those (most of the
   * left and right edges of the screen) opened invisible and unclickable, which
   * looked exactly like the marker ignoring the click.
   */
  const popupPane = map.getPane('popupPane');
  if (popupPane) popupPane.style.zIndex = '2100';
  const tooltipPane = map.getPane('tooltipPane');
  if (tooltipPane) tooltipPane.style.zIndex = '2050';

  const renderers = {
    glow: L.svg({ pane: 'smx-glow', padding: 0.5 }),
    line: L.svg({ pane: 'smx-line', padding: 0.5 }),
  };
  map.addLayer(renderers.glow);
  map.addLayer(renderers.line);

  /* ------------------------------ icons ------------------------------ */

  /**
   * Inline SVG icons.
   *
   * The vendored app cannot supply these: its build scans the source HTML for
   * `fa-*` class names and inlines only the glyphs it finds, so any Font Awesome
   * icon added at runtime renders as an empty box. These are self-contained,
   * inherit currentColor, and work with the tile cache offline.
   */
  const ICONS = {
    flask: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3"/>',
    route: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H14a4 4 0 0 0 0-8H9"/>',
    mountain: '<path d="M3 19l6-10 4 6 2-3 6 7z"/>',
    gem: '<path d="M12 3l7 6-7 12L5 9z"/><path d="M5 9h14"/>',
    sky: '<circle cx="8" cy="8" r="3"/><path d="M7 19h10a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.6 1.3A3 3 0 0 0 7 19z"/>',
    play: '<path d="M8 5l11 7-11 7z"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    rewind: '<path d="M6 5v14"/><path d="M20 5l-11 7 11 7z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    rotate: '<path d="M20 12a8 8 0 1 1-3-6.2"/><path d="M20 4v5h-5"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    crosshair: '<circle cx="12" cy="12" r="7"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
    pin: '<path d="M12 21s6-6.5 6-11a6 6 0 1 0-12 0c0 4.5 6 11 6 11z"/><circle cx="12" cy="10" r="2.2"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5h10"/>',
    chart: '<path d="M4 19h16"/><path d="M4 15l5-6 4 4 6-8"/>',
    dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.3"/><circle cx="15" cy="15" r="1.3"/>',
    pointer: '<path d="M6 3l12 9-5 1 3 6-2.2 1-3-6-2.8 4z"/>',
    quake: '<path d="M3 20h18"/><path d="M6 20V10l6-6 6 6v10"/><path d="M12 10l-2 3 3 2-1 3"/>',
    road: '<path d="M6 21L9 3M18 21l-3-18"/><path d="M12 6v3M12 12v3M12 18v2"/>',
    car: '<path d="M4 16v-3l2-5h12l2 5v3"/><path d="M3 16h18"/><circle cx="7.5" cy="17.5" r="1.8"/><circle cx="16.5" cy="17.5" r="1.8"/>',
    bike: '<circle cx="6" cy="17" r="3.2"/><circle cx="18" cy="17" r="3.2"/><path d="M6 17l4-7h4l-2 7M14 10l3-3"/>',
    walk: '<circle cx="12" cy="4.5" r="2"/><path d="M12 7v6l-3 8M12 13l3 8M12 10l-3.5 2M12 10l3.5 2"/>',
    eraser: '<path d="M7 20h10"/><path d="M9 17L4 12l8-8 5 5-8 8z"/>',
    spinner: '<circle cx="12" cy="12" r="8" stroke-dasharray="34 18"/>',
    satellite: '<path d="M6 10l4-4 3 3-4 4z"/><path d="M13 17l4-4 3 3-4 4z"/><path d="M10 14l4-4"/><path d="M4 20l3-3M17 7l3-3"/>',
  };

  /** `icon('play')` → an inline SVG string sized for buttons and tab strips. */
  function icon(name, extraClass) {
    const body = ICONS[name] || ICONS.pin;
    const fill = name === 'play' || name === 'rewind' || name === 'pointer' || name === 'mountain' ? 'currentColor' : 'none';
    return `<svg class="smx-ico ${extraClass || ''}" viewBox="0 0 24 24" fill="${fill}" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
  }

  /**
   * A grid of label-and-value pairs. Values are given already formatted; empty
   * ones are dropped rather than rendered blank, so a sparse feed does not leave
   * holes in the layout.
   */
  const kv = (pairs) => {
    const cells = pairs
      .filter(([, value]) => value !== null && value !== undefined && value !== '')
      .map(([label, value]) => `<div><b>${value}</b><small>${esc(label)}</small></div>`);
    return cells.length ? `<div class="smx-kv">${cells.join('')}</div>` : '';
  };

  const rule = () => '<hr class="smx-rule">';

  const spinner = (label) => `<div class="smx-hint">${icon('spinner', 'smx-spin')} ${esc(label)}</div>`;

  /* ------------------------------ helpers ------------------------------ */

  /**
   * Colour system — three families that never share a hue, so a colour always
   * answers exactly one question.
   *
   *   IDENTITY    who is moving. One hue per travel mode (blue drive, violet
   *               cycle, cyan walk), shaded when several agents share a mode.
   *               Cool hues only, so an agent can never be mistaken for a
   *               severity reading.
   *   SEVERITY    how bad or how steep: the green→amber→red ramp, used for
   *               congestion bands, gradient bands and congestion zones — and
   *               for nothing else.
   *   ANNOTATION  where you pointed and what happened there: magenta. Picked
   *               points, the profile cursor and encounter pins.
   */
  const MODE_SHADES = {
    driving: ['#3b82f6', '#1d4ed8', '#60a5fa', '#1e3a8a', '#93c5fd'],
    cycling: ['#8b5cf6', '#6d28d9', '#a78bfa', '#4c1d95', '#c4b5fd'],
    foot: ['#06b6d4', '#0e7490', '#22d3ee', '#155e75', '#67e8f9'],
  };
  const MODE_LABELS = { driving: 'Drive', cycling: 'Cycle', foot: 'Walk' };
  const SEVERITY = ['#22c55e', '#a3e635', '#f59e0b', '#ef4444', '#991b1b'];
  const ANNOTATION = '#ec4899';

  /** Mix a hex colour towards white — used for the moving dashes on a route. */
  function lighten(hex, amount) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '#ffffff';
    const n = parseInt(m[1], 16);
    const mix = (c) => Math.round(c + (255 - c) * clamp(amount, 0, 1));
    const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
  }

  /** Identity colour for the nth agent travelling by `mode`. */
  const modeColor = (mode, n) => {
    const shades = MODE_SHADES[mode] || MODE_SHADES.driving;
    return shades[(n || 0) % shades.length];
  };

  /**
   * Bring the upstream app's own palette into the same three families. Left
   * alone it draws the selected route in severity green, alternates in the
   * cycling violet, the GPS trail in severity red and the measuring line in
   * severity amber — four colours that each say something the ramp is supposed
   * to own, which is most of why the map was hard to read.
   *
   * CFG is a live config object the app reads when it builds each layer, so
   * assigning here (before anything is drawn) is enough; existing layers are
   * restyled below.
   */
  function alignAppPalette() {
    if (typeof CFG === 'undefined' || !CFG.colors) return;
    CFG.colors.selected = MODE_SHADES.driving[0];    // a route is identity, not severity
    CFG.colors.alternate = MODE_SHADES.driving[4];   // same family, clearly secondary
    CFG.colors.trail = ANNOTATION;                   // your own track is annotation
    CFG.colors.measure = '#be185d';                  // also yours, a shade apart
    (S.routes || []).forEach((r, i) => {
      if (r.layer && r.layer.setStyle) {
        r.layer.setStyle({ color: i === S.selectedRoute ? CFG.colors.selected : CFG.colors.alternate });
      }
    });
    if (S.trailLine && S.trailLine.setStyle) S.trailLine.setStyle({ color: CFG.colors.trail });
    if (S.measureLine && S.measureLine.setStyle) S.measureLine.setStyle({ color: CFG.colors.measure });
  }

  const TRAFFIC_COLORS = SEVERITY.slice(0, 4);
  const TRAFFIC_LABELS = ['Free flowing', 'Light', 'Heavy', 'Jammed'];

  /** The legend that explains the three families; shown in more than one tab. */
  const colourKey = () => `
    <div class="smx-hint" style="margin-top:2px">Hue always means one thing:</div>
    <div class="smx-legend">
      ${Object.keys(MODE_SHADES).map((m) =>
        `<span class="smx-chip"><span class="smx-sw" style="background:${modeColor(m, 0)}"></span>${MODE_LABELS[m]}</span>`).join('')}
      <span class="smx-chip"><span class="smx-sw" style="background:linear-gradient(90deg,${SEVERITY[0]},${SEVERITY[2]},${SEVERITY[3]});border-radius:3px"></span>severity</span>
      <span class="smx-chip"><span class="smx-sw" style="background:${ANNOTATION}"></span>your picks &amp; events</span>
      <span class="smx-chip"><span class="smx-sw" style="background:#00e676"></span>military / state aircraft</span>
    </div>
    <div class="smx-hint">Cool blues, violets and cyans identify <b>who</b> is travelling — shaded apart when
      several share a mode, and the map's own calculated route is the same blue. The green-to-red ramp only ever
      reports <b>how bad or how steep</b> something is. Magenta is only ever <b>yours</b>: the point you picked,
      your GPS trail, the line you measured, the moments agents meet.</div>`;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const el = (html) => {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  };
  const on = (root, sel, event, fn) => {
    root.addEventListener(event, (e) => {
      const hit = e.target.closest(sel);
      if (hit && root.contains(hit)) fn(e, hit);
    });
  };
  const throttle = (fn, ms) => {
    let last = 0, timer = null;
    return (...a) => {
      const now = performance.now();
      if (now - last >= ms) { last = now; fn(...a); return; }
      if (!timer) timer = setTimeout(() => { timer = null; last = performance.now(); fn(...a); }, ms - (now - last));
    };
  };

  /**
   * The desktop app's own fetch, if this page is the gadget iframe inside it.
   *
   * Same origin, so the helper the host puts on its window can be read directly.
   * Absent when the map is opened in its own window or served by a plain `npm run
   * dev`, and the caller falls back to the browser's fetch.
   */
  function hostJson() {
    try {
      const host = window.parent && window.parent !== window ? window.parent : null;
      return host && typeof host.__smxHostJson === 'function' ? host.__smxHostJson : null;
    } catch (_) {
      return null; // a cross-origin parent: not ours, so not a bridge
    }
  }

  /**
   * fetch + JSON with a timeout, so a hung tile/API call cannot wedge the UI.
   *
   * `host: true` asks for the call to go through the desktop app instead. Some
   * feeds answer 200 with no Access-Control-Allow-Origin header, and a webview
   * throws that response away rather than hand it back; fetched from the Rust
   * side there is no origin to enforce. Only worth setting for a feed known to
   * lack the header — everything else should stay in the browser, where it is
   * visible in devtools.
   */
  async function json(url, opts) {
    const o = opts || {};
    if (o.host) {
      const via = hostJson();
      // If the bridge is there, its failure is the answer: falling back to the
      // browser would only reproduce the CORS error that `host` exists to avoid.
      if (via) return await via(url, { timeout: o.timeout || 15000, method: o.method || 'GET', body: o.body || null });
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), o.timeout || 15000);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        method: o.method || 'GET',
        headers: o.body ? { 'content-type': 'application/json' } : undefined,
        body: o.body ? JSON.stringify(o.body) : undefined,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  const notify = (msg, kind, ms) => { try { toast(msg, kind || 'info', ms); } catch (_) { /* app-owned */ } };
  const metric = () => !S || !S.prefs || S.prefs.units !== 'imperial';
  const dist = (m) => (metric()
    ? (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`)
    : (m < 1609 ? `${Math.round(m * 3.28084)} ft` : `${(m / 1609.344).toFixed(1)} mi`));
  const speed = (mps) => (metric() ? `${(mps * 3.6).toFixed(0)} km/h` : `${(mps * 2.23694).toFixed(0)} mph`);
  const ele = (m) => (metric() ? `${Math.round(m)} m` : `${Math.round(m * 3.28084)} ft`);

  /* ------------------------- OSRM route fetching ------------------------- */

  /**
   * Route through `points` with per-segment speed annotations.
   *
   * Uses the app's own router setting so a custom OSRM instance keeps working.
   * annotations=speed,duration is what makes traffic-free baselines honest:
   * segment speeds come from the router, congestion is applied on top.
   */
  async function route(points, mode, timeout) {
    if (!points || points.length < 2) throw new Error('need at least two points');
    const profile = (typeof OSRM_PROFILE !== 'undefined' && OSRM_PROFILE[mode]) || 'driving';
    const coords = points.map((p) => `${(p.lng !== undefined ? p.lng : p.lon).toFixed(6)},${p.lat.toFixed(6)}`).join(';');
    const base = typeof routerBase === 'function' ? routerBase() : 'https://router.project-osrm.org/route/v1';
    const url = `${base}/${profile}/${coords}?overview=full&geometries=geojson&steps=true&annotations=speed,duration,distance`;
    const data = await json(url, { timeout: timeout || 20000 });
    if (data.code !== 'Ok' || !data.routes || !data.routes.length) throw new Error(data.message || 'no route');
    const r = data.routes[0];
    const pts = r.geometry.coordinates.map((c) => ({ lat: c[1], lng: c[0] }));
    // Legs concatenate; the annotation arrays are per-leg and one shorter than
    // that leg's node list, so they append cleanly into one per-segment array.
    const speeds = (r.legs || []).flatMap((l) => (l.annotation && l.annotation.speed) || []);
    return {
      points: pts,
      speeds: speeds.length === pts.length - 1 ? speeds : null,
      distance: r.distance,
      duration: r.duration,
      steps: (r.legs || []).flatMap((l) => l.steps || []),
    };
  }

  /* --------------------------- animated route --------------------------- */

  /**
   * One route drawn as four stacked layers: a blurred pulsing glow, a dim
   * "remaining" line, a bright "travelled" line, and a dashed line whose
   * dash offset animates so the route visibly flows towards the destination.
   * Direction arrows are markers spaced by on-screen distance and re-laid out
   * on zoom, which keeps them readable at every scale without a plugin.
   */
  class FlowRoute {
    constructor(points, opts) {
      const o = opts || {};
      this.points = points;
      this.cum = Mx.cumulative(points);
      this.color = o.color || MODE_SHADES.driving[0];
      this.arrowsEnabled = o.arrows !== false;
      this.group = L.layerGroup([], { pane: 'smx-line' });
      this.arrowLayer = L.layerGroup([], { pane: 'smx-deco' });
      this.segments = null;

      const latlngs = points.map((p) => [p.lat, p.lng]);
      this.glow = L.polyline(latlngs, {
        renderer: renderers.glow, pane: 'smx-glow', className: 'smx-glow',
        color: this.color, weight: (o.weight || 6) + 10, opacity: 0.22,
        lineCap: 'round', lineJoin: 'round', interactive: false,
      });
      this.remaining = L.polyline(latlngs, {
        renderer: renderers.line, pane: 'smx-line',
        color: this.color, weight: o.weight || 6, opacity: 0.5,
        lineCap: 'round', lineJoin: 'round', interactive: false, dashArray: o.dashRemaining || null,
      });
      this.travelled = L.polyline([], {
        renderer: renderers.line, pane: 'smx-line',
        color: this.color, weight: (o.weight || 6) + 1, opacity: 0.95,
        lineCap: 'round', lineJoin: 'round', interactive: false,
      });
      this.flow = L.polyline(latlngs, {
        renderer: renderers.line, pane: 'smx-line', className: 'smx-flow' + (o.fastFlow ? ' fast' : ''),
        color: lighten(this.color, 0.6), weight: Math.max(2, (o.weight || 6) - 3), opacity: 0.9,
        dashArray: '2 18', lineCap: 'round', interactive: false,
      });
      this.group.addLayer(this.glow).addLayer(this.remaining).addLayer(this.travelled).addLayer(this.flow);
      this._relayout = throttle(() => this.layoutArrows(), 180);
    }

    addTo(m) {
      this.group.addTo(m);
      if (this.arrowsEnabled) {
        this.arrowLayer.addTo(m);
        this.layoutArrows();
        m.on('zoomend moveend', this._relayout);
      }
      return this;
    }

    remove() {
      map.off('zoomend moveend', this._relayout);
      this.group.remove();
      this.arrowLayer.remove();
      if (this.segments) this.segments.remove();
    }

    setStyle(o) {
      if (o.color) {
        this.color = o.color;
        this.glow.setStyle({ color: o.color });
        this.remaining.setStyle({ color: o.color });
        this.travelled.setStyle({ color: o.color });
        this.flow.setStyle({ color: lighten(o.color, 0.6) });
      }
      if (o.opacity !== undefined) {
        this.glow.setStyle({ opacity: 0.22 * o.opacity });
        this.remaining.setStyle({ opacity: 0.5 * o.opacity });
        this.travelled.setStyle({ opacity: 0.95 * o.opacity });
        this.flow.setStyle({ opacity: 0.9 * o.opacity });
      }
      if (o.flow !== undefined) this.flow.setStyle({ opacity: o.flow ? 0.9 : 0 });
      if (o.weight !== undefined) this.setWeight(o.weight);
    }

    /**
     * Width is how overlapping routes stay readable: agents sharing a road are
     * drawn at different widths and stacked narrowest-on-top, so the same
     * geometry travelled by three agents reads as three nested lines rather
     * than one line in whichever colour happened to be drawn last.
     */
    setWeight(w) {
      this.weight = w;
      this.glow.setStyle({ weight: w + 9 });
      this.remaining.setStyle({ weight: w });
      this.travelled.setStyle({ weight: w + 1 });
      this.flow.setStyle({ weight: Math.max(1.5, w - 2.5) });
    }

    /** Raise this route above the others (call on the narrowest last). */
    bringToFront() {
      this.remaining.bringToFront();
      this.travelled.bringToFront();
      this.flow.bringToFront();
      if (this.segments) this.segments.getLayers().forEach((l) => l.bringToFront());
    }

    /** Split the line into travelled (bright) and remaining (dim) at `metres`. */
    setProgress(metres) {
      if (!(metres > 0)) { this.travelled.setLatLngs([]); return; }
      const part = Mx.sliceTo(this.points, this.cum, metres);
      this.travelled.setLatLngs(part.map((p) => [p.lat, p.lng]));
    }

    /**
     * Colour the line by congestion band instead of by agent.
     * `factors` is one speed multiplier per segment (see SMXMath.trafficFactor).
     */
    showTraffic(factors) {
      this.hideTraffic();
      if (!factors || !factors.length) return;
      const runs = [];
      let start = 0, band = Mx.congestionBand(factors[0]);
      for (let i = 1; i <= factors.length; i++) {
        const b = i < factors.length ? Mx.congestionBand(factors[i]) : -1;
        if (b !== band) {
          runs.push({ from: start, to: i, band });
          start = i; band = b;
        }
      }
      this.segments = L.layerGroup(runs.map((run) => L.polyline(
        this.points.slice(run.from, run.to + 1).map((p) => [p.lat, p.lng]),
        {
          renderer: renderers.line, pane: 'smx-line',
          color: TRAFFIC_COLORS[run.band], weight: 4, opacity: 0.95,
          lineCap: 'butt', interactive: false,
        },
      )), { pane: 'smx-line' }).addTo(map);
      this.remaining.setStyle({ opacity: 0.12 });
    }

    hideTraffic() {
      if (this.segments) { this.segments.remove(); this.segments = null; }
      this.remaining.setStyle({ opacity: 0.5 });
    }

    /**
     * Arrowheads every ~110 screen pixels, inside the viewport only, capped so
     * a country-wide route does not spawn thousands of markers.
     */
    layoutArrows() {
      if (!this.arrowsEnabled || !map.hasLayer(this.arrowLayer)) return;
      this.arrowLayer.clearLayers();
      const total = this.cum[this.cum.length - 1];
      if (!(total > 0)) return;
      const c = map.getCenter();
      const metresPerPixel = Mx.haversine(c, map.containerPointToLatLng(
        map.latLngToContainerPoint(c).add([100, 0]),
      )) / 100;
      const spacing = Math.max(total / 220, metresPerPixel * 110);
      const bounds = map.getBounds().pad(0.08);
      let placed = 0;
      for (let d = spacing / 2; d < total && placed < 90; d += spacing) {
        const p = Mx.pointAt(this.points, this.cum, d);
        if (!bounds.contains([p.lat, p.lng])) continue;
        this.arrowLayer.addLayer(L.marker([p.lat, p.lng], {
          pane: 'smx-deco', interactive: false, keyboard: false,
          icon: L.divIcon({
            className: 'smx-arrow', iconSize: [14, 14], iconAnchor: [7, 7],
            html: `<svg width="13" height="13" viewBox="0 0 24 24" fill="${this.color}"
                     style="transform:rotate(${p.bearing - 90}deg)"><path d="M6 4l13 8-13 8z"/></svg>`,
          }),
        }));
        placed++;
      }
    }
  }

  /* ------------------------------ panel ------------------------------ */

  const tabs = [];
  const panel = el(`
    <div class="smx hidden" id="smxPanel" role="dialog" aria-label="Map lab">
      <div class="smx-head" id="smxHead">
        <span style="color:var(--blue);display:flex">${icon('flask')}</span>
        <b>Map Lab</b>
        <button class="smx-x" id="smxMin" title="Collapse" aria-label="Collapse">${icon('minus')}</button>
        <button class="smx-x" id="smxClose" title="Close (X)" aria-label="Close">${icon('x')}</button>
      </div>
      <div class="smx-tabs" id="smxTabs" role="tablist"></div>
      <div class="smx-body" id="smxBody"></div>
    </div>`);
  document.body.appendChild(panel);

  const tabStrip = panel.querySelector('#smxTabs');
  const body = panel.querySelector('#smxBody');
  let active = null;

  function registerTab(def) {
    tabs.push(def);
    const btn = el(`<button class="smx-tab" role="tab" data-tab="${esc(def.id)}" title="${esc(def.title || def.label)}">
        ${icon(def.icon)}${esc(def.label)}</button>`);
    tabStrip.appendChild(btn);
    def.root = el('<div style="display:none"></div>');
    body.appendChild(def.root);
    if (typeof def.build === 'function') def.build(def.root);
    if (!active) selectTab(def.id);
    return def;
  }

  function selectTab(id) {
    active = id;
    for (const t of tabs) {
      const isOn = t.id === id;
      t.root.style.display = isOn ? '' : 'none';
      const btn = tabStrip.querySelector(`[data-tab="${t.id}"]`);
      if (btn) btn.classList.toggle('on', isOn);
      if (isOn && typeof t.onShow === 'function') t.onShow();
    }
    body.scrollTop = 0;
  }

  on(tabStrip, '.smx-tab', 'click', (_e, btn) => selectTab(btn.dataset.tab));
  panel.querySelector('#smxClose').addEventListener('click', () => toggle(false));
  panel.querySelector('#smxMin').addEventListener('click', () => panel.classList.toggle('smx-collapsed'));

  // Drag the panel by its header — the map is the point of the screen, and a
  // fixed panel always ends up covering the one place you want to look at.
  (function draggable() {
    const head = panel.querySelector('#smxHead');
    let from = null;
    head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      from = { x: e.clientX, y: e.clientY, left: panel.offsetLeft, top: panel.offsetTop };
      head.classList.add('grabbing');
      head.setPointerCapture(e.pointerId);
    });
    head.addEventListener('pointermove', (e) => {
      if (!from) return;
      const maxLeft = window.innerWidth - 80, maxTop = window.innerHeight - 60;
      panel.style.left = `${Mx.clamp(from.left + e.clientX - from.x, 4, maxLeft)}px`;
      panel.style.top = `${Mx.clamp(from.top + e.clientY - from.y, 4, maxTop)}px`;
    });
    const end = (e) => { from = null; head.classList.remove('grabbing'); if (e && e.pointerId !== undefined) { try { head.releasePointerCapture(e.pointerId); } catch (_) {} } };
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);
  })();

  const fab = el(`<button class="fab" id="fabLab" title="Map Lab — simulation, terrain, geology (X)" aria-label="Map Lab">
      ${icon('flask')}</button>`);
  const fabs = document.querySelector('.fabs');
  if (fabs) fabs.insertBefore(fab, fabs.querySelector('#fabHelp') || null);

  function toggle(force) {
    const show = force === undefined ? panel.classList.contains('hidden') : force;
    panel.classList.toggle('hidden', !show);
    fab.classList.toggle('on', show);
    if (show) {
      panel.classList.remove('smx-collapsed');
      const t = tabs.find((x) => x.id === active);
      if (t && typeof t.onShow === 'function') t.onShow();
    }
  }
  fab.addEventListener('click', () => toggle());

  // 'x' opens the lab; the upstream app owns every other single-key shortcut.
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key === 'x' || e.key === 'X') { e.preventDefault(); toggle(); }
  });

  /* ------------------------- shared map plumbing ------------------------- */

  /**
   * One map-click consumer at a time (pick a point, drop a congestion zone…).
   * The app adds a waypoint on click, so a mode must be able to swallow the
   * event: handlers run on 'click' with L.DomEvent.stop already applied by
   * Leaflet's own dispatch order, and returning true keeps the mode armed.
   */
  let clickMode = null;
  map.on('click', (e) => {
    // Alt-click always means "read this point", in either mode.
    if (!clickMode && e.originalEvent && e.originalEvent.altKey) {
      L.DomEvent.stop(e);
      pickPoint(e.latlng);
      return;
    }
    if (!clickMode) return;
    const keep = clickMode.handler(e.latlng);
    if (!keep) setClickMode(null);
  });

  /**
   * Alt-click, or an armed picker, selects the point the lab tabs read from.
   * Not shift-click: Leaflet's box-zoom handler owns shift and swallows the click.
   */
  const pickHandlers = [];
  const onPick = (fn) => pickHandlers.push(fn);
  const pickPoint = (latlng) => pickHandlers.forEach((fn) => fn(latlng));

  /* --------------------------- drag / mark modes --------------------------- */

  /**
   * Two explicit map modes, toggled by a triple-click.
   *
   *   drag — pan and zoom only. A stray tap does nothing.
   *   mark — a tap drops a waypoint, and the route recalculates.
   *
   * The upstream app has one persisted "tap to add" preference and no visible
   * sign of its state, which makes a tap either do nothing or silently move your
   * route depending on a setting three panels deep. Same switch, but driven by a
   * gesture and shown in the HUD, so the map always tells you what a tap will do.
   *
   * Three clicks rather than two, so double-click keeps its usual job of zooming
   * in and a double-click aimed at an object cannot flip the mode by accident.
   */
  let mode = 'drag';

  const modePill = el(`
    <div class="hud-pill smx-mode" id="smxMode" role="button" tabindex="0"
         title="Triple-click the map (or click here) to switch between dragging and marking points">
      <span class="smx-mode-dot"></span><b id="smxModeLabel">Drag</b>
      <span class="sep"></span><small id="smxModeHint">triple-click to mark points</small>
    </div>`);
  const hud = document.querySelector('.hud');
  if (hud) hud.appendChild(modePill);

  function setMode(next, quiet) {
    mode = next === 'mark' ? 'mark' : 'drag';
    const marking = mode === 'mark';
    // The app reads this on every map click; keep the two in step and persisted.
    if (S && S.prefs) {
      S.prefs.tapAdd = marking;
      if (typeof savePrefs === 'function') savePrefs();
      const toggle = document.getElementById('tapAddToggle');
      if (toggle) toggle.checked = marking;
    }
    modePill.classList.toggle('marking', marking);
    const label = modePill.querySelector('#smxModeLabel');
    const hint = modePill.querySelector('#smxModeHint');
    if (label) label.textContent = marking ? 'Mark' : 'Drag';
    if (hint) hint.textContent = marking ? 'tap adds a point · triple-click to stop' : 'triple-click to mark points';
    if (!quiet) {
      notify(marking
        ? 'Mark mode — tap the map to add points. Double-click to go back to dragging.'
        : 'Drag mode — taps no longer add points.', 'info', 2600);
    }
  }

  const getMode = () => mode;
  const toggleMode = () => setMode(mode === 'mark' ? 'drag' : 'mark');
  modePill.addEventListener('click', toggleMode);
  modePill.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleMode(); }
  });

  /**
   * The app adds a waypoint on `click`, so in mark mode the three clicks of the
   * gesture would leave three points behind. There is no way to cancel the app's
   * handler from here, so undo them instead: wrap addWaypoint to remember what
   * was added and when, and drop anything added during the gesture.
   */
  const GESTURE_MS = 800;                 // how long three clicks may take
  let recentAdds = [];

  if (typeof window.addWaypoint === 'function') {
    const nativeAdd = window.addWaypoint;
    window.addWaypoint = function wrappedAddWaypoint() {
      const out = nativeAdd.apply(this, arguments);
      const wp = S.waypoints && S.waypoints[S.waypoints.length - 1];
      if (wp) recentAdds.push({ id: wp.id, at: Date.now() });
      recentAdds = recentAdds.filter((a) => Date.now() - a.at < 2000);
      return out;
    };
  }

  /**
   * Remove whatever one particular gesture put on the map.
   *
   * Scoped to the gesture's own start time rather than "anything recent": the
   * sweep also runs on a short timer, and a timer left over from an earlier
   * gesture must never delete a point the user has since placed deliberately.
   */
  function undoGestureAdds(since, until) {
    if (typeof removeWaypoint !== 'function') return;
    const from = since === undefined ? Date.now() - (GESTURE_MS + 200) : since;
    // Bounded at both ends: a sweep scheduled by one gesture must not reach
    // forward into points placed after it, however late its timer fires.
    const to = until === undefined ? Date.now() : until;
    const doomed = recentAdds.filter((a) => a.at >= from && a.at <= to);
    for (const add of doomed) removeWaypoint(add.id);
    recentAdds = recentAdds.filter((a) => !doomed.includes(a));
  }

  /**
   * Counted on the container in the capture phase, not on Leaflet's own map
   * click.
   *
   * In mark mode the first click drops a pin, and the pin then swallows the
   * second and third — Leaflet does not forward a click on a marker to the map,
   * so the gesture died halfway and left the stray point behind. Watching the
   * container sees every click wherever it lands.
   *
   * Clicks inside a popup or a control are excluded: pressing Track in a popup
   * three times must not flip the mode underneath it.
   */
  let clickTimes = [];
  const GESTURE_IGNORE = '.leaflet-popup, .leaflet-control, .smx, .sheet, .fabs, .hud';

  map.getContainer().addEventListener('click', (e) => {
    if (e.target && e.target.closest && e.target.closest(GESTURE_IGNORE)) return;
    const now = Date.now();
    clickTimes = clickTimes.filter((t) => now - t < GESTURE_MS);
    clickTimes.push(now);
    if (clickTimes.length < 3) return;
    const gestureStart = clickTimes[0];
    clickTimes = [];

    // Stop this one click going any further. The mode changes in the capture
    // phase, so without this Leaflet would handle the very same click with
    // marking freshly switched on and drop a stray pin. Only this click is
    // swallowed — the next one is a normal click again.
    e.stopPropagation();
    e.preventDefault();
    undoGestureAdds(gestureStart);
    toggleMode();

    // Switching into mark mode, hold the app's own marking off for a beat.
    // Leaflet raises its map click from this same gesture through a path a DOM
    // stopPropagation does not always reach, and that straggler would land with
    // marking freshly on — dropping a pin nobody asked for. Cheaper and more
    // certain than trying to undo it afterwards.
    if (getMode() === 'mark' && S && S.prefs) {
      S.prefs.tapAdd = false;
      // Only re-arm; no deferred cleanup. Holding the setting is enough to stop
      // the straggler, and a timed sweep could only ever reach forward into
      // points placed after this gesture — which is worse than the problem.
      setTimeout(() => { if (getMode() === 'mark') S.prefs.tapAdd = true; }, 300);
    }
  }, true);
  // Double-click keeps its usual meaning now that the gesture is three clicks.
  if (map.doubleClickZoom) map.doubleClickZoom.enable();

  // Start in drag mode whatever the stored preference was, so the pill and the
  // map always agree on the first tap of a session.
  setMode('drag', true);
  alignAppPalette();

  function setClickMode(mode) {
    if (clickMode && clickMode.onEnd) clickMode.onEnd();
    clickMode = mode;
    const container = map.getContainer();
    if (container) container.style.cursor = mode ? 'crosshair' : '';
    if (mode) {
      // Marking would fight the picker, so drop to drag mode for the duration.
      // The mode is a visible, deliberate state now, so nothing is hidden.
      pickerReturnMode = pickerReturnMode === null ? getMode() : pickerReturnMode;
      setMode('drag', true);
      if (mode.hint) notify(mode.hint, 'info', 3200);
    } else if (pickerReturnMode !== null) {
      setMode(pickerReturnMode, true);
      pickerReturnMode = null;
    }
  }
  let pickerReturnMode = null;

  /* ---------------------- the app's own route, animated ---------------------- */

  /**
   * The upstream app draws its calculated route as a plain polyline. Wrap the two
   * functions that own that lifecycle so the selected route also gets the glow,
   * the direction arrows and the flowing dashes, and draws itself in once when it
   * arrives — the visual confirmation that a fresh route was just calculated.
   *
   * `selectRoute` and `clearRoutes` are function declarations in the app's
   * classic script, so they are properties of the global object and the app's own
   * calls go through these wrappers.
   */
  let appRoute = null;
  let drawInFrame = null;

  function clearAppRoute() {
    if (drawInFrame) { cancelAnimationFrame(drawInFrame); drawInFrame = null; }
    if (appRoute) { appRoute.remove(); appRoute = null; }
  }

  function decorateAppRoute(index) {
    clearAppRoute();
    const r = S.routes && S.routes[index];
    if (!r || !r.layer || typeof r.layer.getLatLngs !== 'function') return;
    const pts = r.layer.getLatLngs().map((p) => ({ lat: p.lat, lng: p.lng }));
    if (pts.length < 2) return;

    const colour = (typeof CFG !== 'undefined' && CFG.colors && CFG.colors.selected) || MODE_SHADES.driving[0];
    appRoute = new FlowRoute(pts, { color: colour, weight: 7 }).addTo(map);
    // The app's own line stays underneath as the base; ours carries the motion.
    appRoute.remaining.setStyle({ opacity: 0.2 });

    const total = appRoute.cum[appRoute.cum.length - 1];
    const started = performance.now();
    const DRAW_MS = 900;
    const step = (now) => {
      const f = clamp((now - started) / DRAW_MS, 0, 1);
      appRoute.setProgress(total * (f < 1 ? f * f * (3 - 2 * f) : 1));   // smoothstep
      drawInFrame = f < 1 ? requestAnimationFrame(step) : null;
    };
    drawInFrame = requestAnimationFrame(step);
  }

  if (typeof window.selectRoute === 'function') {
    const nativeSelect = window.selectRoute;
    window.selectRoute = function wrappedSelectRoute(i) {
      const out = nativeSelect.apply(this, arguments);
      try { decorateAppRoute(i); } catch (_) { /* decoration is never load-bearing */ }
      return out;
    };
  }
  if (typeof window.clearRoutes === 'function') {
    const nativeClear = window.clearRoutes;
    window.clearRoutes = function wrappedClearRoutes() {
      clearAppRoute();
      return nativeClear.apply(this, arguments);
    };
  }

  /** Waypoints currently on the map, as plain points the add-ons can route. */
  const waypoints = () => (S.waypoints || []).map((w) => ({ lat: w.lat, lng: w.lng, name: w.name, id: w.id }));

  return {
    Mx, el, esc, on, json, notify, throttle, icon, spinner,
    dist, speed, ele, metric, lighten,
    MODE_SHADES, MODE_LABELS, modeColor, SEVERITY, ANNOTATION, colourKey, alignAppPalette,
    kv, rule,
    TRAFFIC_COLORS, TRAFFIC_LABELS, PANES, renderers,
    FlowRoute, route, waypoints, decorateAppRoute, clearAppRoute,
    appRouteLayer: () => appRoute,
    panel, body, registerTab, selectTab, toggle, setClickMode, onPick, pickPoint,
    setMode, toggleMode, getMode, undoGestureAdds,
    isOpen: () => !panel.classList.contains('hidden'),
  };
})();
