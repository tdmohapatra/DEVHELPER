#!/usr/bin/env node
/**
 * Vendors the Star Map gadget from its own repo into public/gadgets/.
 *
 *   node scripts/vendor-star-map.mjs [path-to-STAR_MAP-repo]
 *
 * Star Map ships a self-contained "desktop" build: one HTML file with Leaflet,
 * Font Awesome and the app logic inlined. We make two changes:
 *
 *   1. Its two inline <script> blocks are written out as separate .js files, so
 *      DevHelper keeps `script-src 'self'` in its CSP instead of opening the
 *      whole app up to 'unsafe-inline'.
 *   2. DevHelper's own add-on scripts (star-map.x-*.js — Map Lab: simulation,
 *      terrain, geology, sky) are appended after the app. They are hand-written
 *      and live in public/gadgets permanently; only the files listed in
 *      GENERATED below are produced by this script.
 *
 * Re-run this after updating Star Map upstream. Do not hand-edit the output.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(process.argv[2] ?? "D:/TDM/SELF/PROJECTS/TRADELAB/STAR_MAP");
const source = join(repo, "desktop", "Star Map.html");
const outDir = join(here, "..", "public", "gadgets");

const html = readFileSync(source, "utf8");

// The desktop build has exactly two inline scripts: Leaflet, then the app.
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
if (blocks.length !== 2) {
  throw new Error(`expected 2 inline <script> blocks in ${source}, found ${blocks.length}`);
}
const GENERATED = ["star-map.leaflet.js", "star-map.app.js"];

// Order matters: the add-ons read the app's script-level globals (map, S, CFG,
// toast…), which only exist once star-map.app.js has run.
const ADDONS = [
  "star-map.x-math.js",
  "star-map.x-core.js",
  "star-map.x-sim.js",
  "star-map.x-geo.js",
];

for (const addon of ADDONS) {
  if (!existsSync(join(outDir, addon))) throw new Error(`missing add-on ${addon} in public/gadgets`);
}

let out = html;
blocks.forEach((block, i) => {
  out = out.replace(block[0], `<script src="./${GENERATED[i]}" defer></script>`);
});
out = out.replace(
  `<script src="./${GENERATED[1]}" defer></script>`,
  [`<script src="./${GENERATED[1]}" defer></script>`, ...ADDONS.map((a) => `<script src="./${a}" defer></script>`)].join("\n"),
);

mkdirSync(outDir, { recursive: true });
blocks.forEach((block, i) => writeFileSync(join(outDir, GENERATED[i]), block[1].trimStart()));
writeFileSync(
  join(outDir, "star-map.html"),
  out.replace(
    "<head>",
    `<head>\n<!-- Vendored from ${source.replace(/\\/g, "/")} by scripts/vendor-star-map.mjs. Do not edit. -->`,
  ),
);

console.log(`star-map.html + ${GENERATED.join(" + ")} → public/gadgets/ (+ ${ADDONS.length} add-ons wired)`);
