/**
 * OAuth 2.0 client credentials.
 *
 * The machine-to-machine flow, which is the one an API testing tool actually needs: no
 * browser redirect, no user interaction — exchange client id and secret for a token, then
 * send it as a bearer.
 *
 * Building the token request is pure so it can be tested; performing it is left to the
 * caller's HTTP layer.
 */

import type { AuthConfig } from "./apiTypes";
import type { ResolvedRequest } from "./apiRequest";

export interface TokenResponse {
  accessToken: string;
  tokenType: string;
  /** Absolute expiry in epoch milliseconds, when the server reported a lifetime. */
  expiresAt?: number;
  scope?: string;
}

export class OAuthError extends Error {}

/** Build the token endpoint request described by RFC 6749 §4.4. */
export function buildTokenRequest(auth: AuthConfig): ResolvedRequest {
  const tokenUrl = auth.tokenUrl?.trim();
  if (!tokenUrl) throw new OAuthError("Token URL is required");
  if (!auth.clientId?.trim()) throw new OAuthError("Client ID is required");

  const form = new URLSearchParams({ grant_type: "client_credentials" });
  if (auth.scope?.trim()) form.set("scope", auth.scope.trim());

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };

  // Two ways servers accept the credentials; both are common enough to need support.
  if ((auth.clientAuth ?? "header") === "header") {
    headers.Authorization = `Basic ${btoa(`${auth.clientId}:${auth.clientSecret ?? ""}`)}`;
  } else {
    form.set("client_id", auth.clientId);
    if (auth.clientSecret) form.set("client_secret", auth.clientSecret);
  }

  return { method: "POST", url: tokenUrl, headers, body: form.toString() };
}

/** Read a token endpoint's reply, including the error shape defined by §5.2. */
export function parseTokenResponse(status: number, body: string, now = Date.now()): TokenResponse {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(body);
  } catch {
    throw new OAuthError(`The token endpoint returned ${status} with a non-JSON body: ${body.slice(0, 200)}`);
  }

  if (typeof data.error === "string") {
    const description = typeof data.error_description === "string" ? ` — ${data.error_description}` : "";
    throw new OAuthError(`${data.error}${description}`);
  }

  const token = data.access_token;
  if (typeof token !== "string" || !token) {
    throw new OAuthError(`The token endpoint returned ${status} without an access_token`);
  }

  const expiresIn = Number(data.expires_in);
  return {
    accessToken: token,
    tokenType: typeof data.token_type === "string" ? data.token_type : "Bearer",
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? now + expiresIn * 1000 : undefined,
    scope: typeof data.scope === "string" ? data.scope : undefined,
  };
}

/** Tokens are refreshed slightly early, so one does not expire mid-request. */
export const EXPIRY_SKEW_MS = 30_000;

export function isTokenUsable(token: TokenResponse | undefined, now = Date.now()): boolean {
  if (!token?.accessToken) return false;
  if (token.expiresAt === undefined) return true;
  return token.expiresAt - EXPIRY_SKEW_MS > now;
}

/** Cache key for a token: the same client and scope share one. */
export function tokenCacheKey(auth: AuthConfig): string {
  return `${auth.tokenUrl ?? ""}|${auth.clientId ?? ""}|${auth.scope ?? ""}`;
}

/** `Bearer abc…` — the header value to send with the token. */
export function authorizationHeader(token: TokenResponse): string {
  const type = token.tokenType || "Bearer";
  const normalized = type.toLowerCase() === "bearer" ? "Bearer" : type;
  return `${normalized} ${token.accessToken}`;
}

/** Human summary for the UI, without exposing the token itself. */
export function describeToken(token: TokenResponse, now = Date.now()): string {
  if (token.expiresAt === undefined) return `Token acquired (${token.tokenType}, no expiry reported)`;
  const seconds = Math.max(0, Math.round((token.expiresAt - now) / 1000));
  return `Token acquired (${token.tokenType}, expires in ${seconds}s)`;
}
