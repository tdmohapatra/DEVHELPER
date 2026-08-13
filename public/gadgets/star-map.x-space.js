/* ==========================================================================
   star-map.x-space.js — the pixel solar system for Map Lab's Space tab.

   DevHelper add-on to the vendored Star Map. Draws what star-map.x-orbits.js
   computes — the Sun, the planets, the Moon, asteroids, spacecraft — on a plain
   2D canvas, as pixel sprites over a fixed starfield. No WebGL, no 3D library,
   nothing vendored: a few hundred lines of arithmetic and `putImageData`.

   Pixels rather than lit spheres, deliberately. A solar system is mostly empty
   space and the interesting part is where things ARE, not what they look like.
   Flat colours and 8-pixel discs redraw in a millisecond, read clearly at any
   size, and cannot imply detail the data does not have.

   Two honesty rules run through the whole file:

     · POSITIONS ARE TRUE. Every distance is the real one, to the accuracy the
       orbit maths states. Nothing is nudged to look better.
     · SIZES ARE NOT. Earth is 4.3e-5 AU across; drawn to scale beside its own
       orbit it is a hundredth of a pixel. Bodies are drawn at a fixed pixel
       size that carries no information beyond "planet, moon, or rock", and the
       view says so.

   The maths (projection, hit-testing, the sprites, the scales) is pure and
   unit-tested from Node in src/tools/lib/starMapSpace.test.ts. Only the drawing
   itself touches a canvas.

   Loaded as a classic script (window.SMXSpace) and as CommonJS (tests).
   ========================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SMXSpace = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  /* ------------------------------ palette ------------------------------- */

  /**
   * Sixteen colours, and every one of them means something.
   *
   * The map's own rule applies here too: a colour identifies, it never measures.
   * Planets keep the tint they are actually seen as, everything the tab adds is
   * one of four job colours, and nothing else is coloured at all.
   */
  const PALETTE = {
    sun: '#ffd166',
    orbit: '#2f3b52',
    orbitLit: '#4b5f84',
    star: '#c9d4e8',
    label: '#8fa3c0',
    asteroid: '#ff9f43',        // anything on a small-body orbit
    spacecraft: '#00e5ff',      // anything we launched
    approach: '#ff5470',        // a pass close enough to be listed
    selected: '#ffffff',
    grid: '#1b2333',
  };

  /* ---------------------------- projection ------------------------------ */

  /**
   * Turn a heliocentric position into a pixel.
   *
   * Orthographic, not perspective: the whole point of this view is comparing
   * distances by eye, and perspective makes the far side of an orbit smaller
   * than the near side for no gain. Yaw spins the ecliptic under the camera,
   * pitch tips it towards edge-on, and at pitch 0 the view is exactly the plane
   * the planets orbit in.
   *
   * Returns pixel x/y and a depth, which is only used to decide what is drawn
   * on top of what.
   */
  function project(point, camera) {
    const yaw = (camera.yaw * Math.PI) / 180;
    const pitch = (camera.pitch * Math.PI) / 180;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);

    // Rotate about z (yaw), then about the resulting x axis (pitch).
    const x1 = point.x * cy + point.y * sy;
    const y1 = -point.x * sy + point.y * cy;
    const z1 = point.z;

    const y2 = y1 * cp + z1 * sp;
    const depth = -y1 * sp + z1 * cp;

    return {
      x: camera.centreX + x1 * camera.pixelsPerUnit,
      y: camera.centreY - y2 * camera.pixelsPerUnit,
      depth,
    };
  }

  /**
   * Where an astronomical unit lands in scene units, before pixels.
   *
   *   'true'       one AU is one unit. Distances stay proportional.
   *   'compressed' distances grow logarithmically past 1 AU, so all eight
   *                planets are on screen at once. Ratios are destroyed on
   *                purpose; no number is ever read off this.
   */
  function scaleDistance(au, mode) {
    if (mode !== 'compressed') return au;
    const sign = au < 0 ? -1 : 1;
    const r = Math.abs(au);
    return sign * (r <= 1 ? r : 1 + Math.log10(r) * 2.2);
  }

  /** Scale a position, keeping its direction exactly. */
  function scalePosition(v, mode) {
    if (mode !== 'compressed') return { x: v.x, y: v.y, z: v.z };
    const r = Math.hypot(v.x, v.y, v.z);
    if (r === 0) return { x: 0, y: 0, z: 0 };
    const f = scaleDistance(r, mode) / r;
    return { x: v.x * f, y: v.y * f, z: v.z * f };
  }

  /**
   * The origin the view works around: the Sun, or Earth.
   *
   * Subtracting a position is all "Earth-centred" means, so both views are the
   * same numbers seen from different places and neither can drift from the other.
   */
  function frameOrigin(frame, positions) {
    if (frame === 'geocentric' && positions && positions.earth) return positions.earth;
    return { x: 0, y: 0, z: 0 };
  }

  /** Move a heliocentric position into whichever frame is showing. */
  function intoFrame(position, frame, positions) {
    const o = frameOrigin(frame, positions);
    return { x: position.x - o.x, y: position.y - o.y, z: position.z - o.z };
  }

  /* ------------------------------ sprites ------------------------------- */

  /**
   * A body as a small disc of pixels, shaded in three flat tones.
   *
   * Built once per colour and size and then blitted, because building it is the
   * expensive part and there are only a handful of distinct ones. The shading is
   * two steps — lit side, body, shadow side — which is enough to read as a
   * sphere at eight pixels and cheap enough to be free.
   *
   * Returns {size, pixels} where pixels is RGBA, so the whole thing is testable
   * without a canvas.
   */
  function discSprite(size, colour, options) {
    const opts = options || {};
    const n = Math.max(2, Math.round(size));
    const pixels = new Uint8ClampedArray(n * n * 4);
    const base = parseColour(colour);
    const lit = mix(base, { r: 255, g: 255, b: 255 }, 0.35);
    const dark = mix(base, { r: 0, g: 0, b: 0 }, 0.45);
    const centre = (n - 1) / 2;
    const radius = n / 2;

    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const dx = x - centre, dy = y - centre;
        const d = Math.hypot(dx, dy);
        if (d > radius) continue;                     // outside the disc
        // Light comes from the direction given, or from the top left.
        const lx = opts.lightX === undefined ? -0.6 : opts.lightX;
        const ly = opts.lightY === undefined ? -0.6 : opts.lightY;
        const facing = (dx * lx + dy * ly) / (radius || 1);
        const tone = facing > 0.25 ? lit : facing < -0.35 ? dark : base;
        const i = (y * n + x) * 4;
        pixels[i] = tone.r; pixels[i + 1] = tone.g; pixels[i + 2] = tone.b;
        // One pixel of softening at the rim, so a disc does not look like a square.
        pixels[i + 3] = d > radius - 1 ? 170 : 255;
      }
    }
    return { size: n, pixels };
  }

  /** A ring, for Saturn — two pixels of ellipse, flattened by the view's pitch. */
  function ringPoints(radiusPx, pitchDeg, steps) {
    const n = steps || 48;
    const squash = Math.sin((Math.abs(pitchDeg) * Math.PI) / 180);
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      out.push({ x: Math.cos(a) * radiusPx, y: Math.sin(a) * radiusPx * squash });
    }
    return out;
  }

  function parseColour(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '#ffffff'));
    const n = m ? parseInt(m[1], 16) : 0xffffff;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  const mix = (a, b, t) => ({
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  });

  /* ---------------------------- hit testing ----------------------------- */

  /**
   * What is under the pointer.
   *
   * Nearest within a generous radius rather than exact pixel coverage: a planet
   * is eight pixels across and an asteroid is three, and demanding a direct hit
   * on three pixels makes the whole thing feel broken. Ties go to the smaller
   * body, so a rock next to Jupiter can still be picked.
   */
  function hitTest(drawn, x, y, radius) {
    const r = radius || 14;
    let best = null, bestScore = Infinity;
    for (const item of drawn) {
      const d = Math.hypot(item.x - x, item.y - y);
      if (d > r + item.size / 2) continue;
      // Distance first, then size: a small thing wins a near tie.
      const score = d + item.size * 0.35;
      if (score < bestScore) { bestScore = score; best = item; }
    }
    return best;
  }

  /* ----------------------------- starfield ------------------------------ */

  /**
   * A fixed field of background stars, in screen space.
   *
   * Seeded so the sky is the same every time the tab opens and reads as a
   * backdrop rather than as noise. They are decoration: never labelled, never
   * clickable, and they do not move when the camera turns, because a real
   * parallax on a 400-pixel canvas would be a lie about how far away they are.
   */
  function starfield(count, seed, width, height) {
    const n = count || 220;
    let s = seed || 20260813;
    const random = () => {
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const stars = new Array(n);
    for (let i = 0; i < n; i++) {
      stars[i] = {
        x: Math.floor(random() * width),
        y: Math.floor(random() * height),
        // Mostly faint, a few bright: random() squared, which is what a real
        // magnitude distribution roughly looks like at this crudeness.
        brightness: 0.25 + random() * random() * 0.75,
      };
    }
    return stars;
  }

  /* ------------------------------ the view ------------------------------ */

  /**
   * Build the view into a container element.
   *
   * Returns a handle the tab drives: hand it positions, tell it what to show,
   * ask what is under the pointer. Everything is redrawn from scratch each
   * frame — at these object counts that is cheaper than working out what
   * changed, and it means what is on screen is never stale.
   */
  function createView(container, options) {
    const opts = options || {};
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:100%;height:100%;display:block;cursor:crosshair;image-rendering:pixelated';
    container.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('this machine cannot draw on a canvas');

    const state = {
      frame: opts.frame || 'heliocentric',
      scaleMode: opts.scaleMode || 'compressed',
      zoom: opts.zoom || 1,
      yaw: 0,
      pitch: 62,                 // looking down on the ecliptic, but not flat on
      bodies: new Map(),         // id -> definition
      positions: {},             // id -> true heliocentric position, AU
      visible: {},               // layer id -> shown
      selected: null,
      hovered: null,
      drawn: [],                 // what was on screen last frame, for hit tests
      stars: [],
      sprites: new Map(),
      width: 0, height: 0, dpr: 1,
    };

    /* ---------------------------- interaction --------------------------- */

    let dragging = false, lastX = 0, lastY = 0;

    canvas.addEventListener('pointerdown', (e) => {
      dragging = true; lastX = e.clientX; lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      if (dragging) {
        state.yaw = (state.yaw - (e.clientX - lastX) * 0.5 + 360) % 360;
        state.pitch = Math.max(2, Math.min(90, state.pitch + (e.clientY - lastY) * 0.35));
        lastX = e.clientX; lastY = e.clientY;
        draw();
        return;
      }
      const hit = hitTest(state.drawn, px, py);
      const id = hit ? hit.id : null;
      if (id !== state.hovered) {
        state.hovered = id;
        canvas.style.cursor = id ? 'pointer' : 'crosshair';
        if (opts.onHover) opts.onHover(id, { x: px, y: py });
        draw();
      } else if (id && opts.onHover) {
        opts.onHover(id, { x: px, y: py });         // keep the tooltip with the pointer
      }
    });
    const endDrag = (e) => {
      dragging = false;
      if (e && e.pointerId !== undefined && canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('pointerleave', () => {
      state.hovered = null;
      if (opts.onHover) opts.onHover(null);
      draw();
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      state.zoom = Math.max(0.05, Math.min(60, state.zoom * (e.deltaY > 0 ? 0.88 : 1.14)));
      draw();
    }, { passive: false });
    canvas.addEventListener('click', () => {
      state.selected = state.hovered;
      if (opts.onSelect) opts.onSelect(state.selected);
      draw();
    });

    /* ------------------------------ drawing ----------------------------- */

    function resize() {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.floor(rect.width)), h = Math.max(1, Math.floor(rect.height));
      if (w === state.width && h === state.height && dpr === state.dpr) return false;
      state.width = w; state.height = h; state.dpr = dpr;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      state.stars = starfield(opts.stars || 260, 20260813, w, h);
      return true;
    }

    /** The sprite for a colour and size, made once and kept. */
    function spriteFor(size, colour) {
      const key = `${size}:${colour}`;
      let sprite = state.sprites.get(key);
      if (!sprite) {
        const built = discSprite(size, colour);
        const off = document.createElement('canvas');
        off.width = built.size; off.height = built.size;
        off.getContext('2d').putImageData(new ImageData(built.pixels, built.size, built.size), 0, 0);
        sprite = off;
        state.sprites.set(key, sprite);
      }
      return sprite;
    }

    function camera() {
      // The compressed scale tops out around 4.3 units at Neptune; true scale
      // needs the full 30. Either way the base zoom frames the whole thing.
      const span = state.scaleMode === 'compressed' ? 4.6 : 31;
      const half = Math.min(state.width, state.height) / 2;
      return {
        centreX: state.width / 2,
        centreY: state.height / 2,
        pixelsPerUnit: (half / span) * state.zoom,
        yaw: state.yaw,
        pitch: state.pitch,
      };
    }

    function draw() {
      resize();
      const cam = camera();
      const w = state.width, h = state.height;

      ctx.fillStyle = '#05070d';
      ctx.fillRect(0, 0, w, h);

      // stars
      for (const star of state.stars) {
        ctx.globalAlpha = star.brightness;
        ctx.fillStyle = PALETTE.star;
        ctx.fillRect(star.x, star.y, 1, 1);
      }
      ctx.globalAlpha = 1;

      /* Orbits, behind everything.
         Thousands of asteroids can be loaded, and projecting every one of their
         paths each frame would cost more than everything else together. So the
         faint ones are budgeted: the selected and hovered orbits are always
         drawn, then as many others as the budget allows, and the panel says how
         many were left out rather than quietly dropping them. */
      if (state.visible.orbits !== false) {
        let budget = state.orbitBudget || 260;
        let skipped = 0;
        const drawOrbit = (def, emphasis) => {
          ctx.strokeStyle = def.orbitColour || PALETTE.orbit;
          ctx.lineWidth = 1;
          ctx.globalAlpha = emphasis ? 0.95 : (def.orbitOpacity === undefined ? 0.4 : def.orbitOpacity);
          ctx.beginPath();
          for (let i = 0; i < def.orbit.length; i++) {
            const p = project(scalePosition(intoFrame(def.orbit[i], state.frame, state.positions), state.scaleMode), cam);
            if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
          }
          ctx.stroke();
        };

        for (const [id, def] of state.bodies) {
          if (!def.orbit || !def.orbit.length) continue;
          if (state.visible[def.layer] === false) continue;
          const emphasis = id === state.selected || id === state.hovered;
          if (!emphasis && budget <= 0) { skipped++; continue; }
          if (!emphasis) budget--;
          drawOrbit(def, emphasis);
        }
        state.orbitsSkipped = skipped;
        ctx.globalAlpha = 1;

        // The geometry of whatever is selected, drawn on its own orbit: where it
        // is closest to the Sun, where it is furthest, and where it crosses the
        // ecliptic. Those three points are what the tilt and the shape mean.
        const chosen = state.bodies.get(state.selected);
        if (chosen && chosen.markers) {
          const mark = (point, colour, size) => {
            const p = project(scalePosition(intoFrame(point, state.frame, state.positions), state.scaleMode), cam);
            ctx.fillStyle = colour;
            ctx.fillRect(Math.round(p.x) - size, Math.round(p.y) - size, size * 2 + 1, size * 2 + 1);
            return p;
          };
          const q = mark(chosen.markers.perihelion, PALETTE.selected, 2);
          const Q = mark(chosen.markers.aphelion, PALETTE.label, 2);
          // The line between them is the long axis of the ellipse.
          ctx.strokeStyle = PALETTE.label;
          ctx.globalAlpha = 0.35;
          ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(Q.x, Q.y); ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }

      const drawn = [];

      // the Sun, which is at the origin unless the view is Earth-centred
      if (state.visible.sun !== false) {
        const sunAt = project(scalePosition(intoFrame({ x: 0, y: 0, z: 0 }, state.frame, state.positions), state.scaleMode), cam);
        const size = 13;
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = PALETTE.sun;
        ctx.beginPath(); ctx.arc(sunAt.x, sunAt.y, size, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        const sprite = spriteFor(11, PALETTE.sun);
        ctx.drawImage(sprite, Math.round(sunAt.x - 5.5), Math.round(sunAt.y - 5.5));
        drawn.push({ id: 'sun', x: sunAt.x, y: sunAt.y, size: 11, depth: sunAt.depth });
      }

      // everything else, far to near so nearer things overlap further ones
      const items = [];
      for (const [id, def] of state.bodies) {
        if (state.visible[def.layer] === false) continue;
        const truePos = state.positions[id];
        if (!truePos) continue;
        const p = project(scalePosition(intoFrame(truePos, state.frame, state.positions), state.scaleMode), cam);
        items.push({ id, def, p });
      }
      items.sort((a, b) => a.p.depth - b.p.depth);

      for (const item of items) {
        const { id, def, p } = item;
        const size = def.size || 6;
        const colour = def.colour || '#cccccc';

        if (def.ring) {
          ctx.strokeStyle = colour;
          ctx.globalAlpha = 0.5;
          ctx.beginPath();
          const pts = ringPoints(size * 1.9, state.pitch, 40);
          pts.forEach((q, i) => (i ? ctx.lineTo(p.x + q.x, p.y + q.y) : ctx.moveTo(p.x + q.x, p.y + q.y)));
          ctx.closePath();
          ctx.stroke();
          ctx.globalAlpha = 1;
        }

        const sprite = spriteFor(size, colour);
        ctx.drawImage(sprite, Math.round(p.x - size / 2), Math.round(p.y - size / 2));

        if (id === state.selected || id === state.hovered) {
          ctx.strokeStyle = PALETTE.selected;
          ctx.lineWidth = 1;
          ctx.strokeRect(Math.round(p.x - size / 2) - 3.5, Math.round(p.y - size / 2) - 3.5, size + 7, size + 7);
        }

        // Names, but not thousands of them: a bulk asteroid layer is labelled
        // only where the pointer is, or the screen becomes unreadable text.
        const named = def.alwaysLabel !== false || id === state.hovered || id === state.selected;
        if (state.visible.labels !== false && def.label && named) {
          ctx.fillStyle = id === state.hovered ? PALETTE.selected : PALETTE.label;
          ctx.font = '10px ui-monospace, monospace';
          ctx.fillText(def.label, Math.round(p.x + size / 2 + 4), Math.round(p.y + 3));
        }

        drawn.push({ id, x: p.x, y: p.y, size, depth: p.depth });
      }

      state.drawn = drawn;

      // the scale bar: the one thing that says what a pixel is worth
      drawScaleBar(cam);
    }

    /**
     * How much sky a pixel is worth, stated plainly.
     *
     * Only drawn in true scale — under compression a bar would be a different
     * length at every radius, and drawing one anyway would be the exact lie this
     * file is trying not to tell.
     */
    function drawScaleBar(cam) {
      const y = state.height - 18;
      ctx.font = '10px ui-monospace, monospace';
      if (state.scaleMode !== 'true') {
        ctx.fillStyle = PALETTE.label;
        ctx.fillText('distances compressed — not to scale', 12, y + 4);
        return;
      }
      const targetPx = 90;
      const au = niceNumber(targetPx / cam.pixelsPerUnit);
      const px = au * cam.pixelsPerUnit;
      ctx.strokeStyle = PALETTE.label;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(12, y); ctx.lineTo(12 + px, y);
      ctx.moveTo(12, y - 3); ctx.lineTo(12, y + 3);
      ctx.moveTo(12 + px, y - 3); ctx.lineTo(12 + px, y + 3);
      ctx.stroke();
      ctx.fillStyle = PALETTE.label;
      ctx.fillText(`${au} AU`, 12, y - 6);
    }

    /** 1, 2 or 5 times a power of ten — the lengths a scale bar is allowed to be. */
    function niceNumber(x) {
      if (!(x > 0)) return 1;
      const power = Math.pow(10, Math.floor(Math.log10(x)));
      const n = x / power;
      return (n >= 5 ? 5 : n >= 2 ? 2 : 1) * power;
    }

    let raf = requestAnimationFrame(function frame() {
      raf = requestAnimationFrame(frame);
      if (state.dirty) { state.dirty = false; draw(); }
    });

    return {
      state,
      canvas,
      /** Add or replace a drawable. Cheap enough to call for every object each tick. */
      setBody(def) { state.bodies.set(def.id, def); state.dirty = true; },
      removeBody(id) { state.bodies.delete(id); delete state.positions[id]; state.dirty = true; },
      setPositions(positions) { state.positions = positions || {}; state.dirty = true; },
      setFrame(frame) { state.frame = frame; state.dirty = true; },
      setScaleMode(mode) { state.scaleMode = mode; state.dirty = true; },
      setVisible(layer, on) { state.visible[layer] = on; state.dirty = true; },
      isVisible(layer) { return state.visible[layer] !== false; },
      /** How many orbit lines may be drawn per frame before the rest are skipped. */
      setOrbitBudget(n) { state.orbitBudget = Math.max(0, n); state.dirty = true; },
      orbitsSkipped() { return state.orbitsSkipped || 0; },
      select(id) { state.selected = id; state.dirty = true; },
      lookFrom(yaw, pitch) {
        if (yaw !== undefined) state.yaw = yaw;
        if (pitch !== undefined) state.pitch = Math.max(2, Math.min(90, pitch));
        state.dirty = true;
      },
      zoomTo(zoom) { state.zoom = Math.max(0.05, Math.min(60, zoom)); state.dirty = true; },
      redraw() { draw(); },
      dispose() {
        cancelAnimationFrame(raf);
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      },
    };
  }

  return {
    PALETTE, project, scaleDistance, scalePosition, frameOrigin, intoFrame,
    discSprite, ringPoints, parseColour, mix, hitTest, starfield, createView,
  };
});
