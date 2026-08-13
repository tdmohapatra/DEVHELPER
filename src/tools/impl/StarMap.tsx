import { useEffect, useRef, useState } from "react";
import { fetch as hostFetch } from "@tauri-apps/plugin-http";
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

type HostJson = (url: string, opts?: { timeout?: number }) => Promise<unknown>;

export function StarMap() {
  const frame = useRef<HTMLIFrameElement>(null);
  // Bumping the key remounts the iframe, which is the only reliable reload:
  // frame.contentWindow.location.reload() is blocked once the page has navigated.
  const [nonce, setNonce] = useState(0);

  /**
   * A fetch the iframe can borrow.
   *
   * The gadget is same-origin, so it reads this straight off window.parent. It
   * asks for it only for feeds that answer without an Access-Control-Allow-Origin
   * header — the webview discards those, while the Rust side has no origin to
   * enforce. Not installed outside the desktop app (`npm run dev` in a browser),
   * where the gadget falls back to its own fetch.
   */
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const w = window as unknown as { __smxHostJson?: HostJson };
    w.__smxHostJson = async (url, opts) => {
      const res = await hostFetch(url, { method: "GET", connectTimeout: opts?.timeout ?? 15000 });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    };
    return () => {
      delete w.__smxHostJson;
    };
  }, []);

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
