/**
 * SMART on FHIR — getting a token an EMR will accept.
 *
 * Every EMR integration starts here and most of them stall here, because SMART
 * is OAuth2 with four extra requirements that the OAuth2 you already know does
 * not have, and the errors do not name any of them:
 *
 * - **`aud` is mandatory and must be the FHIR base URL.** Omit it and the
 *   server answers `invalid_request` with no hint. This is the single most
 *   common failure, and it is why a request that works against a plain OAuth2
 *   server fails against Epic.
 * - **Scopes carry a subject prefix.** `patient/Observation.read` means "the
 *   patient in context", `user/Observation.read` means "everything this user
 *   may see", `system/Observation.read` means backend access with nobody logged
 *   in. Asking for the wrong prefix is the difference between one record and a
 *   whole hospital, and servers refuse rather than downgrade.
 * - **The token response carries clinical context.** `patient`, `encounter`,
 *   `need_patient_banner` — the app is told which patient is on screen and must
 *   never assume it may read another.
 * - **Backend services do not use a client secret.** They use a JWT signed with
 *   your private key, RS384, with `jti` and a short expiry. Nothing about that
 *   is guessable from an OAuth2 tutorial.
 *
 * What this module can and cannot do: the **backend services** flow runs
 * end-to-end here, because no human is involved. The **authorization code**
 * flow needs a browser redirect, so the URL is built for you to open and the
 * returned code is pasted back — which is also how you debug the flow in
 * practice, one step at a time.
 */

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export interface SmartConfiguration {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  introspectionEndpoint?: string;
  revocationEndpoint?: string;
  registrationEndpoint?: string;
  scopesSupported: string[];
  capabilities: string[];
  grantTypesSupported: string[];
  /** PKCE methods the server accepts. SMART v2 requires S256. */
  codeChallengeMethods: string[];
  tokenEndpointAuthMethods: string[];
}

export class SmartError extends Error {}

/** The well-known document every SMART server publishes. */
export function discoveryUrl(fhirBase: string): string {
  return `${fhirBase.trim().replace(/\/+$/, "")}/.well-known/smart-configuration`;
}

/** The CapabilityStatement, where an older server hides the same endpoints. */
export function metadataUrl(fhirBase: string): string {
  return `${fhirBase.trim().replace(/\/+$/, "")}/metadata`;
}

export function parseSmartConfiguration(json: unknown): SmartConfiguration {
  const doc = json as Record<string, unknown>;
  const authorize = typeof doc?.authorization_endpoint === "string" ? doc.authorization_endpoint : "";
  const token = typeof doc?.token_endpoint === "string" ? doc.token_endpoint : "";
  if (!token) throw new SmartError("The discovery document has no token_endpoint, so it is not a SMART configuration.");

  const list = (key: string): string[] => {
    const value = doc[key];
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  };
  const scopes = list("scopes_supported");

  return {
    authorizationEndpoint: authorize,
    tokenEndpoint: token,
    introspectionEndpoint: typeof doc.introspection_endpoint === "string" ? doc.introspection_endpoint : undefined,
    revocationEndpoint: typeof doc.revocation_endpoint === "string" ? doc.revocation_endpoint : undefined,
    registrationEndpoint: typeof doc.registration_endpoint === "string" ? doc.registration_endpoint : undefined,
    scopesSupported: scopes,
    capabilities: list("capabilities"),
    grantTypesSupported: list("grant_types_supported"),
    codeChallengeMethods: list("code_challenge_methods_supported"),
    tokenEndpointAuthMethods: list("token_endpoint_auth_methods_supported"),
  };
}

/**
 * The OAuth endpoints out of a CapabilityStatement.
 *
 * The pre-2021 way of publishing them, still what several production EMRs do.
 * The extension URL is long and unmemorable and the endpoints are nested two
 * levels inside it, which is why "the server does not support SMART" is so
 * often wrong.
 */
export function endpointsFromCapabilityStatement(json: unknown): { authorize: string; token: string } | null {
  const rest = (json as { rest?: unknown[] })?.rest;
  if (!Array.isArray(rest)) return null;
  for (const entry of rest) {
    const extensions = (entry as { security?: { extension?: unknown[] } })?.security?.extension;
    if (!Array.isArray(extensions)) continue;
    for (const extension of extensions) {
      const ext = extension as { url?: string; extension?: { url?: string; valueUri?: string }[] };
      if (ext.url !== "http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris") continue;
      const inner = ext.extension ?? [];
      const authorize = inner.find((e) => e.url === "authorize")?.valueUri ?? "";
      const token = inner.find((e) => e.url === "token")?.valueUri ?? "";
      if (token) return { authorize, token };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------

export interface ScopeExplanation {
  scope: string;
  subject: "patient" | "user" | "system" | "openid" | "launch" | "other";
  resource?: string;
  access?: string;
  meaning: string;
  /** Set when the scope is one to think twice about. */
  caution?: string;
}

/**
 * What a scope actually asks for.
 *
 * Worth spelling out because the prefix changes the blast radius by orders of
 * magnitude and the strings look almost identical. `user/*.read` on a consultant
 * account is most of a hospital.
 */
export function explainScope(scope: string): ScopeExplanation {
  const trimmed = scope.trim();

  if (trimmed === "openid" || trimmed === "profile" || trimmed === "fhirUser") {
    return {
      scope: trimmed,
      subject: "openid",
      meaning:
        trimmed === "fhirUser"
          ? "Asks for a reference to the FHIR resource representing the logged-in user — the Practitioner or Patient they are."
          : "Standard OpenID Connect: identifies the user, and returns an id_token.",
    };
  }
  if (trimmed.startsWith("launch")) {
    return {
      scope: trimmed,
      subject: "launch",
      meaning:
        trimmed === "launch"
          ? "EHR launch: the app was started from inside the EMR, which passes a launch parameter and supplies the patient in context."
          : `Standalone launch requesting ${trimmed.slice("launch/".length)} context — the user is asked to pick one.`,
    };
  }
  if (trimmed === "offline_access" || trimmed === "online_access") {
    return {
      scope: trimmed,
      subject: "other",
      meaning:
        trimmed === "offline_access"
          ? "Asks for a refresh token that keeps working after the user leaves. This is what a background job needs."
          : "Asks for a refresh token valid only while the user's session lasts.",
      caution: trimmed === "offline_access" ? "A refresh token that outlives the session is a long-lived credential. Store it where you would store a password." : undefined,
    };
  }

  const m = /^(patient|user|system)\/([A-Za-z*]+)\.([a-z*]+)$/.exec(trimmed);
  if (!m) {
    return { scope: trimmed, subject: "other", meaning: "Not a recognised SMART scope shape." };
  }
  const [, subject, resource, access] = m;

  const accessMeaning =
    access === "read" ? "read (v1: search and read)"
    : access === "write" ? "write (v1: create, update, delete)"
    : access === "*" ? "everything — read and write"
    : access
        .split("")
        .map((c) => ({ c: "create", r: "read", u: "update", d: "delete", s: "search" })[c] ?? c)
        .join(", ");

  const subjectMeaning =
    subject === "patient" ? "only the patient in context"
    : subject === "user" ? "everything the logged-in user is allowed to see"
    : "everything, with no user at all — backend services";

  return {
    scope: trimmed,
    subject: subject as ScopeExplanation["subject"],
    resource,
    access,
    meaning: `${accessMeaning} on ${resource === "*" ? "every resource type" : resource}, limited to ${subjectMeaning}.`,
    caution:
      subject === "user" && resource === "*"
        ? "user/*.* on a clinician account is most of a hospital. Ask for the resource types you need."
        : subject === "system" && resource === "*"
          ? "system/*.* has no user to limit it. This is the whole dataset."
          : undefined,
  };
}

/** Scopes the app wants that the server did not advertise. */
export function unsupportedScopes(requested: string, supported: string[]): string[] {
  if (supported.length === 0) return [];
  const have = new Set(supported);
  return requested
    .split(/\s+/)
    .filter(Boolean)
    .filter((scope) => !have.has(scope));
}

// ---------------------------------------------------------------------------
// PKCE
// ---------------------------------------------------------------------------

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A PKCE code verifier: 43–128 characters of unreserved ASCII. */
export function generateVerifier(random: Uint8Array = crypto.getRandomValues(new Uint8Array(32))): string {
  return base64url(random);
}

/** The S256 challenge for a verifier. SMART v2 requires this method. */
export async function codeChallenge(verifier: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new SmartError("WebCrypto is unavailable, so a PKCE challenge cannot be computed here.");
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

// ---------------------------------------------------------------------------
// Authorization code flow
// ---------------------------------------------------------------------------

export interface AuthorizeParams {
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  /** The FHIR base URL. Mandatory in SMART, and the usual reason for a bare invalid_request. */
  aud: string;
  /** Present only for an EHR launch, where the EMR supplied it. */
  launch?: string;
  challenge?: string;
}

export function buildAuthorizeUrl(config: Pick<SmartConfiguration, "authorizationEndpoint">, params: AuthorizeParams): string {
  if (!config.authorizationEndpoint) throw new SmartError("The server published no authorization_endpoint, so the authorization code flow is not available.");
  if (!params.aud.trim()) throw new SmartError("`aud` is required and must be the FHIR base URL. Without it a SMART server answers invalid_request and says nothing more.");

  const query = new URLSearchParams({
    response_type: "code",
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    scope: params.scope,
    state: params.state,
    aud: params.aud.trim().replace(/\/+$/, ""),
  });
  if (params.launch) query.set("launch", params.launch);
  if (params.challenge) {
    query.set("code_challenge", params.challenge);
    query.set("code_challenge_method", "S256");
  }
  const join = config.authorizationEndpoint.includes("?") ? "&" : "?";
  return `${config.authorizationEndpoint}${join}${query.toString()}`;
}

/** The redirect the EMR sends back, parsed — including the error case. */
export function parseRedirect(url: string): { code?: string; state?: string; error?: string; description?: string } {
  let query: URLSearchParams;
  try {
    query = new URL(url).searchParams;
  } catch {
    // A pasted fragment rather than a whole URL is common enough to accept.
    query = new URLSearchParams(url.replace(/^[^?#]*[?#]/, ""));
  }
  return {
    code: query.get("code") ?? undefined,
    state: query.get("state") ?? undefined,
    error: query.get("error") ?? undefined,
    description: query.get("error_description") ?? undefined,
  };
}

/** The form body that exchanges a code for a token. */
export function codeExchangeBody(params: { code: string; redirectUri: string; clientId: string; verifier?: string }): string {
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
  });
  if (params.verifier) form.set("code_verifier", params.verifier);
  return form.toString();
}

// ---------------------------------------------------------------------------
// Backend services
// ---------------------------------------------------------------------------

/** Strip a PEM wrapper and decode the base64 body. */
export function pemToBytes(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  if (!body) throw new SmartError("No key found. Paste a PKCS#8 private key, which starts with -----BEGIN PRIVATE KEY-----.");
  let binary: string;
  try {
    binary = atob(body);
  } catch {
    throw new SmartError("The key is not valid base64. A PKCS#8 PEM is base64 between the BEGIN and END lines.");
  }
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export interface AssertionParams {
  clientId: string;
  /** The token endpoint. It is both the `aud` of the assertion and where it is sent. */
  tokenEndpoint: string;
  /** Key id, so the server can pick the right key from your JWKS. */
  kid?: string;
  /** Seconds until the assertion expires. SMART says 5 minutes maximum. */
  ttlSeconds?: number;
}

/** The claims of a backend-services client assertion, split out so they are assertable. */
export function assertionClaims(params: AssertionParams, nowMs: number, jti: string): Record<string, unknown> {
  const now = Math.floor(nowMs / 1000);
  const ttl = Math.min(Math.max(params.ttlSeconds ?? 300, 30), 300);
  return {
    // Both iss and sub are the client id — the client is asserting about itself.
    iss: params.clientId,
    sub: params.clientId,
    aud: params.tokenEndpoint,
    exp: now + ttl,
    // jti must be unique; the server rejects a replay, which is the whole point.
    jti,
  };
}

/**
 * Sign a backend-services client assertion.
 *
 * RS384 because SMART says so — not RS256, which is what every JWT library
 * defaults to and what makes a correct-looking assertion get rejected.
 */
export async function signAssertion(
  privateKeyPem: string,
  params: AssertionParams,
  nowMs = Date.now(),
  jti = generateVerifier(),
): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new SmartError("WebCrypto is unavailable, so an assertion cannot be signed here.");

  const key = await subtle
    .importKey("pkcs8", pemToBytes(privateKeyPem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-384" }, false, ["sign"])
    .catch(() => {
      throw new SmartError("The key could not be imported. It must be an RSA private key in PKCS#8 form (BEGIN PRIVATE KEY, not BEGIN RSA PRIVATE KEY).");
    });

  const header = { alg: "RS384", typ: "JWT", ...(params.kid ? { kid: params.kid } : {}) };
  const encoder = new TextEncoder();
  const encode = (value: unknown) => base64url(encoder.encode(JSON.stringify(value)));
  const signingInput = `${encode(header)}.${encode(assertionClaims(params, nowMs, jti))}`;
  const signature = await subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(signingInput));
  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}

/** The form body for the backend-services token request. */
export function backendTokenBody(scope: string, assertion: string): string {
  return new URLSearchParams({
    grant_type: "client_credentials",
    scope: scope.trim(),
    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
    client_assertion: assertion,
  }).toString();
}

// ---------------------------------------------------------------------------
// Token response
// ---------------------------------------------------------------------------

export interface SmartToken {
  accessToken: string;
  tokenType: string;
  expiresIn?: number;
  scope: string;
  refreshToken?: string;
  idToken?: string;
  /** Launch context the server chose to send. */
  context: Record<string, string>;
  raw: Record<string, unknown>;
}

/** Fields SMART defines; everything else in the response is launch context. */
const KNOWN_TOKEN_FIELDS = new Set([
  "access_token",
  "token_type",
  "expires_in",
  "scope",
  "refresh_token",
  "id_token",
  "smart_style_url",
]);

/**
 * Read a token response, keeping the launch context.
 *
 * The context is the SMART-specific part and it arrives as extra top-level
 * fields rather than in a named object — `patient`, `encounter`,
 * `need_patient_banner`, and whatever else the EMR adds. Anything unrecognised
 * is kept rather than dropped, because vendors add their own and those are
 * often the fields an integration actually needs.
 */
export function parseTokenResponse(json: unknown): SmartToken {
  const doc = (json ?? {}) as Record<string, unknown>;
  const accessToken = typeof doc.access_token === "string" ? doc.access_token : "";
  if (!accessToken) {
    const error = typeof doc.error === "string" ? doc.error : "";
    const description = typeof doc.error_description === "string" ? doc.error_description : "";
    throw new SmartError(error ? `${error}${description ? `: ${description}` : ""}` : "The response carried no access_token.");
  }

  const context: Record<string, string> = {};
  for (const [key, value] of Object.entries(doc)) {
    if (KNOWN_TOKEN_FIELDS.has(key)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") context[key] = String(value);
  }

  return {
    accessToken,
    tokenType: typeof doc.token_type === "string" ? doc.token_type : "Bearer",
    expiresIn: typeof doc.expires_in === "number" ? doc.expires_in : undefined,
    scope: typeof doc.scope === "string" ? doc.scope : "",
    refreshToken: typeof doc.refresh_token === "string" ? doc.refresh_token : undefined,
    idToken: typeof doc.id_token === "string" ? doc.id_token : undefined,
    context,
    raw: doc,
  };
}

/**
 * Scopes asked for that the server did not grant.
 *
 * Servers downgrade silently: you ask for write, you get read, and the failure
 * turns up later as a 403 on the first update. Comparing the two lists is the
 * cheapest possible way to find that out immediately.
 */
export function deniedScopes(requested: string, granted: string): string[] {
  const got = new Set(granted.split(/\s+/).filter(Boolean));
  return requested
    .split(/\s+/)
    .filter(Boolean)
    .filter((scope) => !got.has(scope));
}

/** Human note about the launch context, when there is one. */
export function describeContext(context: Record<string, string>): string[] {
  const notes: string[] = [];
  if (context.patient) notes.push(`The app is scoped to patient ${context.patient}. Reading any other patient is a violation, not a bug.`);
  if (context.encounter) notes.push(`Encounter ${context.encounter} is in context.`);
  if (context.need_patient_banner === "true") notes.push("need_patient_banner is true — the EMR is not showing a patient banner, so the app must display one.");
  if (context.need_patient_banner === "false") notes.push("need_patient_banner is false — the EMR already shows the patient banner; do not duplicate it.");
  if (context.fhirUser) notes.push(`The logged-in user is ${context.fhirUser}.`);
  if (context.tenant) notes.push(`Tenant ${context.tenant}.`);
  return notes;
}

/** Common token-endpoint failures, with what each one usually means in SMART. */
export function explainAuthError(error: string, description?: string): string {
  const known: Record<string, string> = {
    invalid_request:
      "Usually a missing or wrong `aud`. SMART requires it on the authorize request and it must be exactly the FHIR base URL — no trailing slash difference, no proxy hostname.",
    invalid_client:
      "The client id is unknown, or for backend services the assertion did not verify: check it is RS384 (not RS256), that `aud` is the token endpoint, and that the kid matches a key in your published JWKS.",
    invalid_grant: "The code was already used, expired, or the redirect_uri does not match the one sent to authorize — byte for byte.",
    unauthorized_client: "The client is registered but not allowed this grant type. Backend services must be registered as such.",
    invalid_scope: "A scope was asked for that this client is not permitted, or the wrong subject prefix was used (patient/ vs user/ vs system/).",
    unsupported_grant_type: "The server does not offer this grant. Check grant_types_supported in the discovery document.",
  };
  const base = known[error] ?? "See the server's description.";
  return description ? `${base}\n\nThe server said: ${description}` : base;
}

/** Sandboxes worth pointing at, so the tool is usable with no EMR to hand. */
export const SANDBOXES: { name: string; fhirBase: string; note: string }[] = [
  { name: "SMART Health IT", fhirBase: "https://launch.smarthealthit.org/v/r4/fhir", note: "Open reference sandbox. Good for checking a flow works before touching a vendor." },
  { name: "HAPI FHIR (public)", fhirBase: "https://hapi.fhir.org/baseR4", note: "Open FHIR server with no auth — useful for FHIR calls, not for SMART." },
  { name: "Epic on FHIR (sandbox)", fhirBase: "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4", note: "Needs a registered client from the Epic developer portal." },
  { name: "Cerner / Oracle Health (sandbox)", fhirBase: "https://fhir-open.cerner.com/r4/ec2458f2-1e24-41c8-b71b-0e701af7583d", note: "Open endpoint for reads; the secure endpoint needs registration." },
];
