import { describe, expect, it } from "vitest";
import {
  assertionClaims,
  backendTokenBody,
  buildAuthorizeUrl,
  codeChallenge,
  codeExchangeBody,
  deniedScopes,
  describeContext,
  discoveryUrl,
  endpointsFromCapabilityStatement,
  explainAuthError,
  explainScope,
  generateVerifier,
  metadataUrl,
  parseRedirect,
  parseSmartConfiguration,
  parseTokenResponse,
  pemToBytes,
  SANDBOXES,
  signAssertion,
  SmartError,
  unsupportedScopes,
} from "./smart";

const CONFIG = {
  authorization_endpoint: "https://ehr.example/auth/authorize",
  token_endpoint: "https://ehr.example/auth/token",
  introspection_endpoint: "https://ehr.example/auth/introspect",
  scopes_supported: ["openid", "fhirUser", "launch", "patient/Patient.read", "patient/Observation.read"],
  capabilities: ["launch-ehr", "client-public", "context-ehr-patient"],
  grant_types_supported: ["authorization_code", "client_credentials"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["private_key_jwt"],
};

describe("discovery", () => {
  it("builds the well-known and metadata URLs, tolerating a trailing slash", () => {
    expect(discoveryUrl("https://ehr.example/fhir/")).toBe("https://ehr.example/fhir/.well-known/smart-configuration");
    expect(metadataUrl("https://ehr.example/fhir")).toBe("https://ehr.example/fhir/metadata");
  });

  it("reads the configuration", () => {
    const config = parseSmartConfiguration(CONFIG);
    expect(config.tokenEndpoint).toBe("https://ehr.example/auth/token");
    expect(config.capabilities).toContain("launch-ehr");
    expect(config.codeChallengeMethods).toEqual(["S256"]);
    expect(config.tokenEndpointAuthMethods).toEqual(["private_key_jwt"]);
  });

  it("refuses a document with no token endpoint rather than half-working", () => {
    expect(() => parseSmartConfiguration({ authorization_endpoint: "x" })).toThrow(SmartError);
    expect(() => parseSmartConfiguration(null)).toThrow(/not a SMART configuration/);
  });

  it("survives arrays that are not arrays", () => {
    const config = parseSmartConfiguration({ token_endpoint: "t", scopes_supported: "oops", capabilities: null });
    expect(config.scopesSupported).toEqual([]);
    expect(config.capabilities).toEqual([]);
  });

  it("digs the endpoints out of a CapabilityStatement, which is where older servers keep them", () => {
    const statement = {
      rest: [
        {
          security: {
            extension: [
              {
                url: "http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris",
                extension: [
                  { url: "authorize", valueUri: "https://old.example/authorize" },
                  { url: "token", valueUri: "https://old.example/token" },
                ],
              },
            ],
          },
        },
      ],
    };
    expect(endpointsFromCapabilityStatement(statement)).toEqual({
      authorize: "https://old.example/authorize",
      token: "https://old.example/token",
    });
  });

  it("returns null for a CapabilityStatement with no OAuth extension", () => {
    expect(endpointsFromCapabilityStatement({ rest: [{ security: {} }] })).toBeNull();
    expect(endpointsFromCapabilityStatement({})).toBeNull();
  });
});

describe("explainScope", () => {
  it("distinguishes the three subject prefixes, which change the blast radius", () => {
    expect(explainScope("patient/Observation.read").meaning).toMatch(/only the patient in context/);
    expect(explainScope("user/Observation.read").meaning).toMatch(/logged-in user is allowed to see/);
    expect(explainScope("system/Observation.read").meaning).toMatch(/no user at all/);
  });

  it("warns about the two scopes that are a whole hospital", () => {
    expect(explainScope("user/*.*").caution).toMatch(/most of a hospital/);
    expect(explainScope("system/*.*").caution).toMatch(/whole dataset/);
    expect(explainScope("patient/Observation.read").caution).toBeUndefined();
  });

  it("expands SMART v2 granular access letters", () => {
    expect(explainScope("patient/Observation.rs").meaning).toMatch(/read, search/);
    expect(explainScope("patient/Observation.cruds").meaning).toMatch(/create, read, update, delete, search/);
  });

  it("explains the launch and identity scopes", () => {
    expect(explainScope("launch").meaning).toMatch(/started from inside the EMR/);
    expect(explainScope("launch/patient").meaning).toMatch(/Standalone launch/);
    expect(explainScope("fhirUser").meaning).toMatch(/Practitioner or Patient/);
    expect(explainScope("offline_access").caution).toMatch(/long-lived credential/);
  });

  it("says so rather than guessing at an unrecognised shape", () => {
    expect(explainScope("read:everything").meaning).toMatch(/Not a recognised SMART scope/);
  });

  it("lists scopes the server never advertised", () => {
    expect(unsupportedScopes("openid patient/Patient.read patient/Immunization.read", CONFIG.scopes_supported)).toEqual([
      "patient/Immunization.read",
    ]);
    // A server that publishes no list is not evidence of anything.
    expect(unsupportedScopes("anything", [])).toEqual([]);
  });
});

describe("PKCE", () => {
  it("produces a verifier in the legal character set and length", () => {
    const verifier = generateVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });

  it("computes the S256 challenge from the RFC 7636 test vector", async () => {
    // The verifier and challenge given in RFC 7636 appendix B.
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(await codeChallenge(verifier)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("gives a different verifier each time", () => {
    expect(generateVerifier()).not.toBe(generateVerifier());
  });
});

describe("buildAuthorizeUrl", () => {
  const config = parseSmartConfiguration(CONFIG);
  const params = {
    clientId: "my-app",
    redirectUri: "http://localhost:8080/callback",
    scope: "openid fhirUser patient/Patient.read",
    state: "abc",
    aud: "https://ehr.example/fhir",
  };

  it("includes aud, which is the requirement everyone misses", () => {
    const url = new URL(buildAuthorizeUrl(config, params));
    expect(url.searchParams.get("aud")).toBe("https://ehr.example/fhir");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid fhirUser patient/Patient.read");
  });

  it("refuses to build a URL with no aud rather than producing one that fails opaquely", () => {
    expect(() => buildAuthorizeUrl(config, { ...params, aud: "  " })).toThrow(/must be the FHIR base URL/);
  });

  it("normalises a trailing slash on aud, which servers compare exactly", () => {
    const url = new URL(buildAuthorizeUrl(config, { ...params, aud: "https://ehr.example/fhir/" }));
    expect(url.searchParams.get("aud")).toBe("https://ehr.example/fhir");
  });

  it("adds the PKCE challenge and its method together", () => {
    const url = new URL(buildAuthorizeUrl(config, { ...params, challenge: "xyz" }));
    expect(url.searchParams.get("code_challenge")).toBe("xyz");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("passes launch through only for an EHR launch", () => {
    expect(new URL(buildAuthorizeUrl(config, params)).searchParams.get("launch")).toBeNull();
    expect(new URL(buildAuthorizeUrl(config, { ...params, launch: "L1" })).searchParams.get("launch")).toBe("L1");
  });

  it("appends to an endpoint that already has a query string", () => {
    const url = buildAuthorizeUrl({ authorizationEndpoint: "https://ehr.example/auth?tenant=1" }, params);
    expect(url).toContain("?tenant=1&response_type=code");
  });

  it("says so when the server offers no authorize endpoint at all", () => {
    expect(() => buildAuthorizeUrl({ authorizationEndpoint: "" }, params)).toThrow(/not available/);
  });
});

describe("parseRedirect", () => {
  it("reads a successful redirect", () => {
    expect(parseRedirect("http://localhost:8080/callback?code=C1&state=abc")).toMatchObject({ code: "C1", state: "abc" });
  });

  it("reads the error case, which is the one worth pasting back", () => {
    const result = parseRedirect("http://localhost:8080/cb?error=invalid_scope&error_description=nope");
    expect(result.error).toBe("invalid_scope");
    expect(result.description).toBe("nope");
  });

  it("accepts a bare query string, since that is what people copy", () => {
    expect(parseRedirect("?code=C2&state=s").code).toBe("C2");
    expect(parseRedirect("code=C3").code).toBe("C3");
  });
});

describe("code exchange", () => {
  it("sends the verifier when there is one", () => {
    const body = codeExchangeBody({ code: "C", redirectUri: "http://localhost/cb", clientId: "app", verifier: "V" });
    expect(body).toContain("grant_type=authorization_code");
    expect(body).toContain("code_verifier=V");
  });

  it("omits the verifier when PKCE was not used", () => {
    expect(codeExchangeBody({ code: "C", redirectUri: "r", clientId: "a" })).not.toContain("code_verifier");
  });
});

describe("backend services", () => {
  it("asserts about itself, to the token endpoint, with a short life", () => {
    const claims = assertionClaims({ clientId: "app", tokenEndpoint: "https://ehr.example/auth/token" }, 1_700_000_000_000, "j1");
    expect(claims).toMatchObject({
      iss: "app",
      sub: "app",
      aud: "https://ehr.example/auth/token",
      jti: "j1",
      exp: 1_700_000_300,
    });
  });

  it("clamps the lifetime to the five minutes SMART allows", () => {
    const long = assertionClaims({ clientId: "a", tokenEndpoint: "t", ttlSeconds: 86400 }, 1_700_000_000_000, "j");
    expect(long.exp).toBe(1_700_000_300);
    const short = assertionClaims({ clientId: "a", tokenEndpoint: "t", ttlSeconds: 1 }, 1_700_000_000_000, "j");
    expect(short.exp).toBe(1_700_000_030);
  });

  it("decodes a PEM and rejects one that is not base64", () => {
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa("hello")}\n-----END PRIVATE KEY-----`;
    expect(pemToBytes(pem)).toEqual(new Uint8Array([104, 101, 108, 108, 111]));
    expect(() => pemToBytes("-----BEGIN PRIVATE KEY-----\n!!!\n-----END PRIVATE KEY-----")).toThrow(/valid base64/);
    expect(() => pemToBytes("")).toThrow(/PKCS#8/);
  });

  it("signs an RS384 assertion a server can verify", async () => {
    const pair = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-384" },
      true,
      ["sign", "verify"],
    );
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
    let binary = "";
    for (const b of pkcs8) binary += String.fromCharCode(b);
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(binary)}\n-----END PRIVATE KEY-----`;

    const jwt = await signAssertion(pem, { clientId: "app", tokenEndpoint: "https://ehr.example/auth/token", kid: "k1" }, 1_700_000_000_000, "j1");
    const [header, payload, signature] = jwt.split(".");

    const decode = (part: string) => JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
    // RS384, not RS256 — the default of every JWT library, and why a
    // correct-looking assertion gets rejected.
    expect(decode(header)).toEqual({ alg: "RS384", typ: "JWT", kid: "k1" });
    expect(decode(payload).aud).toBe("https://ehr.example/auth/token");

    const bytes = Uint8Array.from(atob(signature.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    const verified = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      pair.publicKey,
      bytes,
      new TextEncoder().encode(`${header}.${payload}`),
    );
    expect(verified).toBe(true);
  });

  it("explains a key that is not PKCS#8 instead of failing obscurely", async () => {
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa("not a key")}\n-----END PRIVATE KEY-----`;
    await expect(signAssertion(pem, { clientId: "a", tokenEndpoint: "t" })).rejects.toThrow(/PKCS#8/);
  });

  it("builds the client_credentials body with the assertion type SMART requires", () => {
    const body = backendTokenBody("system/Patient.read", "JWT");
    expect(body).toContain("grant_type=client_credentials");
    expect(body).toContain("client_assertion_type=urn%3Aietf%3Aparams%3Aoauth%3Aclient-assertion-type%3Ajwt-bearer");
    expect(body).toContain("client_assertion=JWT");
  });
});

describe("parseTokenResponse", () => {
  it("keeps the launch context, which arrives as extra top-level fields", () => {
    const token = parseTokenResponse({
      access_token: "AT",
      token_type: "Bearer",
      expires_in: 3600,
      scope: "patient/Patient.read",
      patient: "123",
      encounter: "456",
      need_patient_banner: false,
      tenant: "acme",
    });
    expect(token.accessToken).toBe("AT");
    expect(token.context).toEqual({ patient: "123", encounter: "456", need_patient_banner: "false", tenant: "acme" });
  });

  it("throws with the server's own error rather than a generic one", () => {
    expect(() => parseTokenResponse({ error: "invalid_client", error_description: "unknown client" })).toThrow(
      /invalid_client: unknown client/,
    );
    expect(() => parseTokenResponse({})).toThrow(/no access_token/);
  });

  it("finds scopes the server quietly refused to grant", () => {
    expect(deniedScopes("patient/Patient.read patient/Patient.write", "patient/Patient.read")).toEqual(["patient/Patient.write"]);
    expect(deniedScopes("a b", "b a")).toEqual([]);
  });

  it("turns the context into something worth reading", () => {
    const notes = describeContext({ patient: "123", need_patient_banner: "true", fhirUser: "Practitioner/9" });
    expect(notes[0]).toMatch(/violation, not a bug/);
    expect(notes.some((n) => /must display one/.test(n))).toBe(true);
    expect(describeContext({})).toEqual([]);
  });
});

describe("explainAuthError", () => {
  it("points invalid_request at aud, which is what it almost always is", () => {
    expect(explainAuthError("invalid_request")).toMatch(/`aud`/);
  });

  it("points invalid_client at RS384 and the JWKS for backend services", () => {
    const text = explainAuthError("invalid_client");
    expect(text).toMatch(/RS384/);
    expect(text).toMatch(/JWKS/);
  });

  it("appends whatever the server said", () => {
    expect(explainAuthError("invalid_grant", "code expired")).toMatch(/The server said: code expired/);
  });

  it("has something for an error it does not know", () => {
    expect(explainAuthError("weird_error")).toMatch(/description/);
  });
});

describe("SANDBOXES", () => {
  it("names somewhere to point the tool with no EMR to hand", () => {
    expect(SANDBOXES.length).toBeGreaterThan(2);
    for (const sandbox of SANDBOXES) {
      expect(sandbox.fhirBase).toMatch(/^https:\/\//);
      expect(sandbox.note.length).toBeGreaterThan(10);
    }
  });
});
