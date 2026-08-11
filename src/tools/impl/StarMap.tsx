import { useRef, useState } from "react";
import { ExternalLink, RotateCw } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";

/**
 * Star Map, embedded as-is.
 *
 * The upstream app is a self-contained Leaflet page (vendored into
 * public/gadgets by scripts/vendor-star-map.mjs), not a React tree. Rewriting
 * ~2600 lines of working map code as components would buy nothing, so it runs
 * in an iframe from the app's own origin and keeps its own state in
 * localStorage/IndexedDB. Re-vendor to update it.
 *
 * DevHelper's own additions live beside it as star-map.x-*.js ("Map Lab": route
 * simulation, congestion model, terrain, geology, sky) and are covered by
 * src/tools/lib/starMapMath.test.ts and starMapAddons.test.ts.
 *
 * Tiles, routing and geocoding are network calls to OSM/CARTO/OSRM/Nominatim —
 * the map needs internet the first time an area is viewed, and the CSP in
 * tauri.conf.json has to keep allowing them.
 */
const SRC = "/gadgets/star-map.html";

export function StarMap() {
  const frame = useRef<HTMLIFrameElement>(null);
  // Bumping the key remounts the iframe, which is the only reliable reload:
  // frame.contentWindow.location.reload() is blocked once the page has navigated.
  const [nonce, setNonce] = useState(0);

  return (
    <ToolShell
      toolId="star-map"
      title="Star Map"
      description="Live map with routing, offline tiles and GPX — plus Map Lab (flask icon, or press X) for departure simulation, terrain, geology and sky"
      actions={
        <>
          <Button variant="ghost" size="icon" title="Reload the map" aria-label="Reload the map" onClick={() => setNonce((n) => n + 1)}>
            <RotateCw />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="Open in a separate window"
            aria-label="Open in a separate window"
            onClick={() => window.open(SRC, "_blank", "noopener")}
          >
            <ExternalLink />
          </Button>
        </>
      }
    >
      <iframe
        key={nonce}
        ref={frame}
        src={SRC}
        title="Star Map"
        allow="geolocation"
        className="h-full w-full rounded-lg border border-border bg-background"
      />
    </ToolShell>
  );
}
