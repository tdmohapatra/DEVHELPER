import { describe, expect, it } from "vitest";

// Classic browser script; its UMD wrapper publishes the API on window.
import "../../../public/gadgets/star-map.x-space.js";

const S = (globalThis as unknown as { SMXSpace: Record<string, any> }).SMXSpace;

const CAMERA = { centreX: 200, centreY: 150, pixelsPerUnit: 40, yaw: 0, pitch: 0 };

describe("projecting a position onto the canvas", () => {
  it("puts the origin in the middle, whatever the camera is doing", () => {
    for (const [yaw, pitch] of [[0, 0], [37, 62], [180, 90], [-90, 12]]) {
      const p = S.project({ x: 0, y: 0, z: 0 }, { ...CAMERA, yaw, pitch });
      expect(p.x).toBeCloseTo(200, 9);
      expect(p.y).toBeCloseTo(150, 9);
    }
  });

  it("is orthographic: equal distances are equal pixels anywhere on screen", () => {
    // The whole point of the view is comparing distances by eye, so 1 AU must be
    // the same number of pixels near the middle and out at the edge.
    const a = S.project({ x: 1, y: 0, z: 0 }, CAMERA);
    const b = S.project({ x: 2, y: 0, z: 0 }, CAMERA);
    const c = S.project({ x: 8, y: 0, z: 0 }, CAMERA);
    expect(b.x - a.x).toBeCloseTo(40, 9);
    expect(c.x - S.project({ x: 7, y: 0, z: 0 }, CAMERA).x).toBeCloseTo(40, 9);
  });

  it("looks straight down on the ecliptic at pitch zero", () => {
    // Flat on: the whole orbital plane maps to the screen plane, so z does nothing.
    const inPlane = S.project({ x: 1, y: 1, z: 0 }, CAMERA);
    const above = S.project({ x: 1, y: 1, z: 5 }, CAMERA);
    expect(above.x).toBeCloseTo(inPlane.x, 9);
    expect(above.y).toBeCloseTo(inPlane.y, 9);
    // It only changes which is drawn on top.
    expect(above.depth).toBeGreaterThan(inPlane.depth);
  });

  it("flattens the plane as the view tips towards edge-on", () => {
    const flatOn = S.project({ x: 0, y: 1, z: 0 }, { ...CAMERA, pitch: 0 });
    const tipped = S.project({ x: 0, y: 1, z: 0 }, { ...CAMERA, pitch: 60 });
    const edgeOn = S.project({ x: 0, y: 1, z: 0 }, { ...CAMERA, pitch: 90 });
    const spread = (p: any) => Math.abs(p.y - CAMERA.centreY);
    expect(spread(tipped)).toBeLessThan(spread(flatOn));
    // Exactly edge-on, an orbit is a line: everything in the plane lands on one row.
    expect(spread(edgeOn)).toBeCloseTo(0, 9);
  });

  it("turns the system under the camera when the yaw changes", () => {
    const at0 = S.project({ x: 1, y: 0, z: 0 }, { ...CAMERA, yaw: 0 });
    const at90 = S.project({ x: 1, y: 0, z: 0 }, { ...CAMERA, yaw: 90 });
    expect(at0.x - CAMERA.centreX).toBeCloseTo(40, 9);
    // A quarter turn moves that same point off the x axis entirely.
    expect(at90.x - CAMERA.centreX).toBeCloseTo(0, 9);
  });

  it("keeps every point the same distance from the middle as the camera turns", () => {
    // A rotation cannot change how far from the Sun something is; only a bug can.
    const point = { x: 1.3, y: -0.7, z: 0.2 };
    const radius = (yaw: number) => {
      const p = S.project(point, { ...CAMERA, yaw, pitch: 0 });
      return Math.hypot(p.x - CAMERA.centreX, p.y - CAMERA.centreY);
    };
    for (const yaw of [0, 45, 137, 263]) expect(radius(yaw)).toBeCloseTo(radius(0), 9);
  });
});

describe("scaling distance", () => {
  it("leaves true scale alone, exactly", () => {
    for (const au of [0, 0.39, 1, 5.2, 30.07]) expect(S.scaleDistance(au, "true")).toBe(au);
  });

  it("keeps the inner solar system untouched even when compressed", () => {
    expect(S.scaleDistance(0.39, "compressed")).toBeCloseTo(0.39, 12);
    expect(S.scaleDistance(1, "compressed")).toBeCloseTo(1, 12);
  });

  it("pulls the outer planets in far enough to share a screen", () => {
    const ratio = S.scaleDistance(30.07, "compressed") / S.scaleDistance(1, "compressed");
    expect(ratio).toBeLessThan(5);
    expect(ratio).toBeGreaterThan(3);
  });

  it("stays ordered, so nothing overtakes anything by being compressed", () => {
    const scaled = [0.39, 0.72, 1, 1.52, 5.2, 9.54, 19.19, 30.07].map((r) => S.scaleDistance(r, "compressed"));
    expect([...scaled].sort((a, b) => a - b)).toEqual(scaled);
  });

  it("keeps a position's direction exactly when compressing it", () => {
    const p = { x: 3, y: 4, z: 12 };
    const q = S.scalePosition(p, "compressed");
    const lp = Math.hypot(p.x, p.y, p.z), lq = Math.hypot(q.x, q.y, q.z);
    expect(q.x / lq).toBeCloseTo(p.x / lp, 12);
    expect(q.z / lq).toBeCloseTo(p.z / lp, 12);
    expect(lq).toBeCloseTo(S.scaleDistance(lp, "compressed"), 12);
  });

  it("survives the origin without dividing by zero", () => {
    expect(S.scalePosition({ x: 0, y: 0, z: 0 }, "compressed")).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe("the two frames", () => {
  const positions = { earth: { x: 1, y: 0, z: 0 }, mars: { x: 0, y: 1.5, z: 0.1 } };

  it("puts the Sun at the origin when the view is Sun-centred", () => {
    expect(S.frameOrigin("heliocentric", positions)).toEqual({ x: 0, y: 0, z: 0 });
    expect(S.intoFrame(positions.mars, "heliocentric", positions)).toEqual(positions.mars);
  });

  it("puts Earth at the origin when the view is Earth-centred", () => {
    expect(S.intoFrame(positions.earth, "geocentric", positions)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it("preserves every separation when the frame changes", () => {
    // The property that lets one set of distances serve both views.
    const helio = Math.hypot(positions.mars.x - positions.earth.x, positions.mars.y - positions.earth.y,
      positions.mars.z - positions.earth.z);
    const m = S.intoFrame(positions.mars, "geocentric", positions);
    const e = S.intoFrame(positions.earth, "geocentric", positions);
    expect(Math.hypot(m.x - e.x, m.y - e.y, m.z - e.z)).toBeCloseTo(helio, 12);
  });

  it("falls back to the Sun when Earth's position is not known yet", () => {
    expect(S.frameOrigin("geocentric", {})).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe("the pixel sprites", () => {
  const alphaAt = (sprite: any, x: number, y: number) => sprite.pixels[(y * sprite.size + x) * 4 + 3];
  const rgbAt = (sprite: any, x: number, y: number) => {
    const i = (y * sprite.size + x) * 4;
    return [sprite.pixels[i], sprite.pixels[i + 1], sprite.pixels[i + 2]];
  };

  it("is a disc, not a square: the corners are empty", () => {
    const sprite = S.discSprite(8, "#4d8fd6");
    expect(alphaAt(sprite, 0, 0)).toBe(0);
    expect(alphaAt(sprite, 7, 0)).toBe(0);
    expect(alphaAt(sprite, 0, 7)).toBe(0);
    // …and the middle is solid.
    expect(alphaAt(sprite, 4, 4)).toBe(255);
  });

  it("shades in three flat tones, so eight pixels still read as a ball", () => {
    const sprite = S.discSprite(9, "#808080");
    const tones = new Set<string>();
    for (let y = 0; y < sprite.size; y++) {
      for (let x = 0; x < sprite.size; x++) {
        if (alphaAt(sprite, x, y) === 0) continue;
        tones.add(rgbAt(sprite, x, y).join(","));
      }
    }
    expect(tones.size).toBe(3);
  });

  it("lights the side the light comes from", () => {
    const sprite = S.discSprite(9, "#808080");           // light from the top left
    const topLeft = rgbAt(sprite, 2, 2)[0];
    const bottomRight = rgbAt(sprite, 6, 6)[0];
    expect(topLeft).toBeGreaterThan(bottomRight);
  });

  it("uses the colour it was given", () => {
    const sprite = S.discSprite(7, "#ff0000");
    const [r, g, b] = rgbAt(sprite, 3, 3);
    expect(r).toBe(255);
    expect(g).toBe(0);
    expect(b).toBe(0);
  });

  it("never returns a sprite too small to see", () => {
    expect(S.discSprite(0, "#fff").size).toBe(2);
    expect(S.discSprite(1, "#fff").size).toBe(2);
  });

  it("reads a colour whether or not it has a hash, and falls back to white", () => {
    expect(S.parseColour("#4d8fd6")).toEqual({ r: 77, g: 143, b: 214 });
    expect(S.parseColour("4d8fd6")).toEqual({ r: 77, g: 143, b: 214 });
    expect(S.parseColour("not a colour")).toEqual({ r: 255, g: 255, b: 255 });
  });
});

describe("Saturn's ring", () => {
  it("is a circle seen flat on, and a line seen edge-on", () => {
    const flat = S.ringPoints(10, 90, 32);              // looking straight down
    const edge = S.ringPoints(10, 0, 32);               // looking along the plane
    expect(Math.max(...flat.map((p: any) => Math.abs(p.y)))).toBeCloseTo(10, 6);
    expect(Math.max(...edge.map((p: any) => Math.abs(p.y)))).toBeCloseTo(0, 9);
    // The width never changes, whatever the pitch: only the height squashes.
    for (const pts of [flat, edge]) {
      expect(Math.max(...pts.map((p: any) => Math.abs(p.x)))).toBeCloseTo(10, 6);
    }
  });
});

describe("what is under the pointer", () => {
  const drawn = [
    { id: "jupiter", x: 100, y: 100, size: 12 },
    { id: "rock", x: 108, y: 100, size: 3 },
    { id: "neptune", x: 300, y: 40, size: 9 },
  ];

  it("finds the thing you are pointing at", () => {
    expect(S.hitTest(drawn, 300, 41).id).toBe("neptune");
  });

  it("finds nothing in empty sky", () => {
    expect(S.hitTest(drawn, 20, 200)).toBeNull();
  });

  /**
   * A rock is three pixels beside a planet that is twelve. Requiring an exact
   * hit makes the small thing unpickable, so a near tie goes to the smaller
   * body — otherwise the asteroid you loaded can never be inspected.
   */
  it("lets a small body beside a big one still be picked", () => {
    expect(S.hitTest(drawn, 108, 100).id).toBe("rock");
    expect(S.hitTest(drawn, 99, 100).id).toBe("jupiter");
  });

  it("is forgiving enough to hit a three-pixel dot", () => {
    // Six pixels off a three-pixel target still counts.
    expect(S.hitTest([{ id: "rock", x: 50, y: 50, size: 3 }], 56, 50)).toBeTruthy();
  });
});

describe("the starfield", () => {
  it("is the same sky every time, so it reads as a backdrop", () => {
    expect(S.starfield(80, 42, 400, 300)).toEqual(S.starfield(80, 42, 400, 300));
  });

  it("is a different sky for a different seed", () => {
    expect(S.starfield(80, 1, 400, 300)).not.toEqual(S.starfield(80, 2, 400, 300));
  });

  it("stays on the canvas", () => {
    for (const star of S.starfield(400, 7, 320, 240)) {
      expect(star.x).toBeGreaterThanOrEqual(0);
      expect(star.x).toBeLessThan(320);
      expect(star.y).toBeGreaterThanOrEqual(0);
      expect(star.y).toBeLessThan(240);
      expect(star.brightness).toBeGreaterThan(0);
      expect(star.brightness).toBeLessThanOrEqual(1);
    }
  });

  it("is mostly faint, with a few bright ones", () => {
    const stars = S.starfield(2000, 99, 500, 500);
    const bright = stars.filter((s: any) => s.brightness > 0.7).length;
    expect(bright / stars.length).toBeLessThan(0.3);
    expect(bright).toBeGreaterThan(0);
  });
});

describe("the palette", () => {
  /**
   * The map's rule, which this view inherits: a colour identifies, it never
   * measures. Each of these has exactly one job, and no two share one.
   */
  it("gives every job its own colour, and no colour two jobs", () => {
    const jobs = ["asteroid", "spacecraft", "approach", "sun"];
    const used = jobs.map((j) => S.PALETTE[j]);
    expect(new Set(used).size).toBe(jobs.length);
    for (const colour of used) expect(colour).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
