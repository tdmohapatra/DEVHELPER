/** GUID/UUID v4 generation with formatting options. */

export interface GuidOptions {
  count: number;
  uppercase: boolean;
  hyphens: boolean;
  braces: boolean;
}

function uuidV4(): string {
  // crypto.randomUUID is available in modern browsers and the Tauri webview.
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  // Fallback using getRandomValues.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

export function generateGuids(opts: GuidOptions): string[] {
  const count = Math.max(1, Math.min(1000, opts.count));
  return Array.from({ length: count }, () => {
    let g = uuidV4();
    if (!opts.hyphens) g = g.replace(/-/g, "");
    if (opts.uppercase) g = g.toUpperCase();
    if (opts.braces) g = `{${g}}`;
    return g;
  });
}
