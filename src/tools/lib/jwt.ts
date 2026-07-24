/** Local-only JWT decoding. No network, no signature verification (Phase 1). */

export interface JwtParts {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signature: string;
  /** Human-readable expiry status derived from the `exp` claim. */
  status: "valid" | "expired" | "not-yet-valid" | "no-expiry";
  expiresAt?: Date;
  issuedAt?: Date;
  notBefore?: Date;
}

function base64UrlDecode(segment: string): string {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 ? "=".repeat(4 - (padded.length % 4)) : "";
  const binary = atob(padded + pad);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function decodeJwt(token: string, now: number = Date.now()): JwtParts {
  const parts = token.trim().split(".");
  if (parts.length < 2) throw new Error("Not a valid JWT: expected at least header.payload");

  const header = JSON.parse(base64UrlDecode(parts[0]));
  const payload = JSON.parse(base64UrlDecode(parts[1]));
  const signature = parts[2] ?? "";

  const exp = typeof payload.exp === "number" ? payload.exp : undefined;
  const iat = typeof payload.iat === "number" ? payload.iat : undefined;
  const nbf = typeof payload.nbf === "number" ? payload.nbf : undefined;
  const nowSec = now / 1000;

  let status: JwtParts["status"] = "no-expiry";
  if (nbf !== undefined && nowSec < nbf) status = "not-yet-valid";
  else if (exp !== undefined) status = nowSec >= exp ? "expired" : "valid";

  return {
    header,
    payload,
    signature,
    status,
    expiresAt: exp ? new Date(exp * 1000) : undefined,
    issuedAt: iat ? new Date(iat * 1000) : undefined,
    notBefore: nbf ? new Date(nbf * 1000) : undefined,
  };
}
