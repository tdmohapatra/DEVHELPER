import { describe, it, expect } from "vitest";
import {
  buildTokenRequest,
  parseTokenResponse,
  isTokenUsable,
  tokenCacheKey,
  authorizationHeader,
  describeToken,
  OAuthError,
  EXPIRY_SKEW_MS,
} from "./oauth2";
import type { AuthConfig } from "./apiTypes";

const auth: AuthConfig = {
  type: "oauth2",
  tokenUrl: "https://id.dev/oauth2/token",
  clientId: "svc",
  clientSecret: "shh",
  scope: "orders.read",
};

describe("buildTokenRequest", () => {
  it("posts the client credentials grant to the token URL", () => {
    const r = buildTokenRequest(auth);
    expect(r.method).toBe("POST");
    expect(r.url).toBe("https://id.dev/oauth2/token");
    expect(r.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(r.body).toContain("grant_type=client_credentials");
    expect(r.body).toContain("scope=orders.read");
  });

  it("sends the credentials as basic auth by default", () => {
    const r = buildTokenRequest(auth);
    expect(r.headers.Authorization).toBe(`Basic ${btoa("svc:shh")}`);
    expect(r.body).not.toContain("client_secret");
  });

  it("sends the credentials in the body when asked", () => {
    const r = buildTokenRequest({ ...auth, clientAuth: "body" });
    expect(r.headers.Authorization).toBeUndefined();
    expect(r.body).toContain("client_id=svc");
    expect(r.body).toContain("client_secret=shh");
  });

  it("omits an empty scope", () => {
    expect(buildTokenRequest({ ...auth, scope: "  " }).body).not.toContain("scope=");
  });

  it("names what is missing", () => {
    expect(() => buildTokenRequest({ ...auth, tokenUrl: "" })).toThrow(/Token URL/);
    expect(() => buildTokenRequest({ ...auth, clientId: "" })).toThrow(/Client ID/);
  });
});

describe("parseTokenResponse", () => {
  const now = 1_000_000;

  it("reads the token and computes an absolute expiry", () => {
    const t = parseTokenResponse(200, JSON.stringify({ access_token: "abc", token_type: "Bearer", expires_in: 3600 }), now);
    expect(t).toMatchObject({ accessToken: "abc", tokenType: "Bearer", expiresAt: now + 3_600_000 });
  });

  it("defaults the token type", () => {
    expect(parseTokenResponse(200, JSON.stringify({ access_token: "abc" }), now).tokenType).toBe("Bearer");
  });

  it("leaves the expiry open when none is reported", () => {
    expect(parseTokenResponse(200, JSON.stringify({ access_token: "abc" }), now).expiresAt).toBeUndefined();
  });

  it("surfaces the OAuth error shape", () => {
    const body = JSON.stringify({ error: "invalid_client", error_description: "bad secret" });
    expect(() => parseTokenResponse(401, body, now)).toThrow(/invalid_client — bad secret/);
  });

  it("explains a non-JSON reply", () => {
    expect(() => parseTokenResponse(500, "<html>oops</html>", now)).toThrow(/non-JSON body/);
  });

  it("rejects a reply with no access_token", () => {
    expect(() => parseTokenResponse(200, JSON.stringify({ foo: 1 }), now)).toThrow(OAuthError);
  });
});

describe("isTokenUsable", () => {
  const now = 1_000_000;

  it("accepts a token with time left", () => {
    expect(isTokenUsable({ accessToken: "a", tokenType: "Bearer", expiresAt: now + 120_000 }, now)).toBe(true);
  });
  it("refreshes early rather than letting one expire mid-request", () => {
    expect(isTokenUsable({ accessToken: "a", tokenType: "Bearer", expiresAt: now + EXPIRY_SKEW_MS - 1 }, now)).toBe(false);
  });
  it("accepts a token with no reported expiry", () => {
    expect(isTokenUsable({ accessToken: "a", tokenType: "Bearer" }, now)).toBe(true);
  });
  it("rejects a missing or empty token", () => {
    expect(isTokenUsable(undefined, now)).toBe(false);
    expect(isTokenUsable({ accessToken: "", tokenType: "Bearer" }, now)).toBe(false);
  });
});

describe("tokenCacheKey", () => {
  it("shares a token across requests using the same client and scope", () => {
    expect(tokenCacheKey(auth)).toBe(tokenCacheKey({ ...auth, clientSecret: "rotated" }));
  });
  it("separates different scopes and clients", () => {
    expect(tokenCacheKey(auth)).not.toBe(tokenCacheKey({ ...auth, scope: "orders.write" }));
    expect(tokenCacheKey(auth)).not.toBe(tokenCacheKey({ ...auth, clientId: "other" }));
  });
});

describe("authorizationHeader", () => {
  it("normalises the bearer casing servers send", () => {
    expect(authorizationHeader({ accessToken: "abc", tokenType: "bearer" })).toBe("Bearer abc");
  });
  it("keeps an unusual token type as given", () => {
    expect(authorizationHeader({ accessToken: "abc", tokenType: "DPoP" })).toBe("DPoP abc");
  });
});

describe("describeToken", () => {
  it("reports the remaining lifetime without showing the token", () => {
    const text = describeToken({ accessToken: "secret", tokenType: "Bearer", expiresAt: 1_060_000 }, 1_000_000);
    expect(text).toContain("expires in 60s");
    expect(text).not.toContain("secret");
  });
  it("says when no expiry was reported", () => {
    expect(describeToken({ accessToken: "a", tokenType: "Bearer" }, 0)).toMatch(/no expiry/);
  });
});
