import { useState, type ReactNode } from "react";
import { AlertTriangle, ExternalLink, KeyRound, PlugZap, Search, ShieldCheck } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { CopyButton } from "@/components/CopyButton";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { executeRequest, corsLimited } from "@/lib/http";
import {
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
  SANDBOXES,
  signAssertion,
  unsupportedScopes,
  type SmartConfiguration,
  type SmartToken,
} from "@/tools/lib/smart";

type Mode = "code" | "backend";

export function EmrConnect() {
  const [fhirBase, setFhirBase] = useState(SANDBOXES[0].fhirBase);
  const [config, setConfig] = useState<SmartConfiguration | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [mode, setMode] = useState<Mode>("code");
  const [clientId, setClientId] = useState("");
  const [redirectUri, setRedirectUri] = useState("http://localhost:8080/callback");
  const [scope, setScope] = useState("openid fhirUser launch/patient patient/Patient.read patient/Observation.read");
  const [launch, setLaunch] = useState("");
  const [verifier, setVerifier] = useState("");
  const [authorizeUrl, setAuthorizeUrl] = useState("");
  const [redirect, setRedirect] = useState("");

  const [backendScope, setBackendScope] = useState("system/Patient.read");
  const [privateKey, setPrivateKey] = useState("");
  const [kid, setKid] = useState("");

  const [token, setToken] = useState<SmartToken | null>(null);
  const [probe, setProbe] = useState("");

  const requested = mode === "code" ? scope : backendScope;
  const scopeList = requested.split(/\s+/).filter(Boolean);
  const notAdvertised = config ? unsupportedScopes(requested, config.scopesSupported) : [];

  const discover = async () => {
    setBusy(true);
    setError("");
    setConfig(null);
    setToken(null);
    try {
      const res = await executeRequest({ method: "GET", url: discoveryUrl(fhirBase), headers: { Accept: "application/json" } }, undefined, { timeoutMs: 15000 });
      if (res.ok) {
        setConfig(parseSmartConfiguration(JSON.parse(res.body)));
        toast.success("SMART configuration found");
        return;
      }

      // Older servers publish the endpoints in the CapabilityStatement instead,
      // which is why "this server does not support SMART" is so often wrong.
      const meta = await executeRequest({ method: "GET", url: metadataUrl(fhirBase), headers: { Accept: "application/fhir+json" } }, undefined, { timeoutMs: 20000 });
      if (!meta.ok) throw new Error(`${res.status} from .well-known and ${meta.status} from /metadata.`);
      const endpoints = endpointsFromCapabilityStatement(JSON.parse(meta.body));
      if (!endpoints) throw new Error("Neither .well-known/smart-configuration nor the CapabilityStatement's oauth-uris extension is present. This server is not SMART-enabled.");
      setConfig({
        authorizationEndpoint: endpoints.authorize,
        tokenEndpoint: endpoints.token,
        scopesSupported: [],
        capabilities: [],
        grantTypesSupported: [],
        codeChallengeMethods: [],
        tokenEndpointAuthMethods: [],
      });
      toast.success("Found the endpoints in the CapabilityStatement");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const buildUrl = async () => {
    if (!config) return;
    try {
      const v = generateVerifier();
      setVerifier(v);
      const url = buildAuthorizeUrl(config, {
        clientId,
        redirectUri,
        scope,
        state: generateVerifier().slice(0, 12),
        aud: fhirBase,
        launch: launch || undefined,
        challenge: await codeChallenge(v),
      });
      setAuthorizeUrl(url);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const exchange = async () => {
    if (!config) return;
    const parsed = parseRedirect(redirect);
    if (parsed.error) {
      setError(`${parsed.error}\n\n${explainAuthError(parsed.error, parsed.description)}`);
      return;
    }
    if (!parsed.code) {
      setError("No `code` in what was pasted. Paste the whole URL the browser was redirected to.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await executeRequest(
        {
          method: "POST",
          url: config.tokenEndpoint,
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body: codeExchangeBody({ code: parsed.code, redirectUri, clientId, verifier: verifier || undefined }),
        },
        undefined,
        { timeoutMs: 20000 },
      );
      const json = JSON.parse(res.body);
      if (!res.ok) throw new Error(`${json.error ?? res.status}\n\n${explainAuthError(json.error ?? "", json.error_description)}`);
      setToken(parseTokenResponse(json));
      toast.success("Token received");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const backendToken = async () => {
    if (!config) return;
    setBusy(true);
    setError("");
    try {
      const assertion = await signAssertion(privateKey, { clientId, tokenEndpoint: config.tokenEndpoint, kid: kid || undefined });
      const res = await executeRequest(
        {
          method: "POST",
          url: config.tokenEndpoint,
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body: backendTokenBody(backendScope, assertion),
        },
        undefined,
        { timeoutMs: 20000 },
      );
      const json = JSON.parse(res.body);
      if (!res.ok) throw new Error(`${json.error ?? res.status}\n\n${explainAuthError(json.error ?? "", json.error_description)}`);
      setToken(parseTokenResponse(json));
      toast.success("Token received");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const tryIt = async () => {
    if (!token) return;
    setBusy(true);
    try {
      const url = `${fhirBase.replace(/\/+$/, "")}/Patient?_count=1`;
      const res = await executeRequest(
        { method: "GET", url, headers: { Authorization: `${token.tokenType} ${token.accessToken}`, Accept: "application/fhir+json" } },
        undefined,
        { timeoutMs: 20000 },
      );
      setProbe(`${res.status} ${res.statusText}\n\n${res.body.slice(0, 4000)}`);
    } catch (e) {
      setProbe(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const denied = token ? deniedScopes(requested, token.scope) : [];

  return (
    <ToolShell
      toolId="emr-connect"
      title="EMR Connect"
      description="SMART on FHIR: discover a server, get a token it accepts, and see the launch context it sends back."
    >
      {corsLimited() && (
        <div className="mb-3 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
          Browser dev mode: EMR endpoints send no CORS headers. Use the desktop app.
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
        <F label="FHIR base URL (this is also the `aud`)">
          <Input className="mono h-8 w-[30rem]" value={fhirBase} onChange={(e) => setFhirBase(e.target.value)} />
        </F>
        <Button size="sm" onClick={discover} disabled={busy}>
          <Search className="size-3.5" /> Discover
        </Button>
        <select
          className="h-8 rounded-md border border-border bg-background px-2 text-sm"
          value=""
          onChange={(e) => e.target.value && setFhirBase(e.target.value)}
        >
          <option value="">Sandboxes…</option>
          {SANDBOXES.map((s) => (
            <option key={s.name} value={s.fhirBase}>{s.name}</option>
          ))}
        </select>
        {config && <Badge variant="success">discovered</Badge>}
        <p className="w-full text-[11px] text-muted-foreground">
          The `aud` parameter must be exactly this URL. Omitting it, or sending a proxy hostname instead, produces a bare
          <span className="mono"> invalid_request</span> with no explanation — the single most common SMART failure.
        </p>
      </div>

      {error && (
        <div className="mb-3 whitespace-pre-wrap rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {config && (
        <>
          <div className="mb-3 grid grid-cols-1 gap-2 rounded-md border border-border p-3 text-[11px] lg:grid-cols-2">
            <div>
              <p><b>Authorize:</b> <span className="mono">{config.authorizationEndpoint || "— not published"}</span></p>
              <p><b>Token:</b> <span className="mono">{config.tokenEndpoint}</span></p>
              {config.registrationEndpoint && <p><b>Register:</b> <span className="mono">{config.registrationEndpoint}</span></p>}
            </div>
            <div>
              {config.capabilities.length > 0 && (
                <p className="mb-1"><b>Capabilities:</b> {config.capabilities.join(", ")}</p>
              )}
              {config.grantTypesSupported.length > 0 && <p><b>Grants:</b> {config.grantTypesSupported.join(", ")}</p>}
              {config.tokenEndpointAuthMethods.length > 0 && <p><b>Client auth:</b> {config.tokenEndpointAuthMethods.join(", ")}</p>}
              {config.codeChallengeMethods.length > 0 && <p><b>PKCE:</b> {config.codeChallengeMethods.join(", ")}</p>}
            </div>
          </div>

          <div className="mb-3 flex flex-wrap gap-1 border-b border-border">
            {(["code", "backend"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-sm",
                  mode === m ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m === "code" ? <PlugZap className="size-3.5" /> : <KeyRound className="size-3.5" />}
                {m === "code" ? "Authorization code (a user logs in)" : "Backend services (no user)"}
              </button>
            ))}
          </div>

          {mode === "code" ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-end gap-2">
                <F label="Client id"><Input className="h-8 w-56" value={clientId} onChange={(e) => setClientId(e.target.value)} /></F>
                <F label="Redirect URI"><Input className="mono h-8 w-72" value={redirectUri} onChange={(e) => setRedirectUri(e.target.value)} /></F>
                <F label="launch (EHR launch only)"><Input className="h-8 w-40" value={launch} onChange={(e) => setLaunch(e.target.value)} placeholder="from the EMR" /></F>
                <Button size="sm" onClick={buildUrl} disabled={!clientId}>Build authorize URL</Button>
              </div>
              <F label="Scopes"><Textarea mono className="h-16" value={scope} onChange={(e) => setScope(e.target.value)} spellCheck={false} /></F>

              {authorizeUrl && (
                <div className="rounded-md border border-border p-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">Open this, log in, then paste where the browser lands</span>
                    <CopyButton className="ml-auto" value={authorizeUrl} />
                    <Button size="sm" variant="ghost" onClick={() => window.open(authorizeUrl, "_blank")}>
                      <ExternalLink className="size-3.5" /> Open
                    </Button>
                  </div>
                  <pre className="mono mt-1 max-h-24 overflow-auto whitespace-pre-wrap text-[10px] text-muted-foreground">{authorizeUrl}</pre>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    The PKCE verifier for this attempt is held in memory only. Build a new URL and the old code becomes
                    unexchangeable — which is the point of PKCE.
                  </p>
                </div>
              )}

              <div className="flex flex-wrap items-end gap-2">
                <F label="Redirected URL (or just the query string)">
                  <Input className="mono h-8 w-[34rem]" value={redirect} onChange={(e) => setRedirect(e.target.value)} placeholder="http://localhost:8080/callback?code=…&state=…" />
                </F>
                <Button size="sm" onClick={exchange} disabled={busy || !redirect}>Exchange for a token</Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-end gap-2">
                <F label="Client id"><Input className="h-8 w-56" value={clientId} onChange={(e) => setClientId(e.target.value)} /></F>
                <F label="Key id (kid)"><Input className="h-8 w-40" value={kid} onChange={(e) => setKid(e.target.value)} placeholder="matches your JWKS" /></F>
                <F label="Scopes"><Input className="mono h-8 w-72" value={backendScope} onChange={(e) => setBackendScope(e.target.value)} /></F>
                <Button size="sm" onClick={backendToken} disabled={busy || !clientId || !privateKey}>Get a token</Button>
              </div>
              <F label="Private key (PKCS#8 PEM)">
                <Textarea
                  mono
                  className="h-28"
                  value={privateKey}
                  onChange={(e) => setPrivateKey(e.target.value)}
                  placeholder="-----BEGIN PRIVATE KEY-----"
                  spellCheck={false}
                />
              </F>
              <p className="text-[11px] text-muted-foreground">
                Held in memory for this screen only, never saved. The assertion is signed <b>RS384</b> — not RS256, which
                is what every JWT library defaults to and why a correct-looking assertion is rejected as invalid_client.
              </p>
            </div>
          )}

          <div className="mt-3 rounded-md border border-border p-3">
            <p className="text-xs font-medium">What these scopes ask for</p>
            <div className="mt-1 flex flex-col gap-0.5 text-[11px]">
              {scopeList.map((s) => {
                const explained = explainScope(s);
                return (
                  <p key={s}>
                    <span className="mono">{s}</span> — {explained.meaning}
                    {explained.caution && <b className="text-warning"> {explained.caution}</b>}
                    {notAdvertised.includes(s) && <b className="text-destructive"> Not in scopes_supported.</b>}
                  </p>
                );
              })}
            </div>
          </div>
        </>
      )}

      {token && (
        <div className="mt-3 flex flex-col gap-2 rounded-md border border-success/40 bg-success/5 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <ShieldCheck className="size-4 text-success" />
            <span className="text-sm font-medium">Token received</span>
            {token.expiresIn && <Badge variant="outline">expires in {token.expiresIn}s</Badge>}
            {token.refreshToken && <Badge variant="outline">refresh token</Badge>}
            {token.idToken && <Badge variant="outline">id_token</Badge>}
            <CopyButton className="ml-auto" value={token.accessToken} />
            <Button size="sm" variant="outline" onClick={tryIt} disabled={busy}>Try a Patient read</Button>
          </div>

          <p className="text-[11px]"><b>Granted:</b> <span className="mono">{token.scope || "(the server said nothing)"}</span></p>
          {denied.length > 0 && (
            <p className="text-[11px] text-warning">
              <AlertTriangle className="mr-1 inline size-3" />
              <b>Not granted:</b> <span className="mono">{denied.join(" ")}</span> — servers downgrade silently, and this
              turns up later as a 403 on the first write.
            </p>
          )}

          {describeContext(token.context).map((note, i) => (
            <p key={i} className="text-[11px] text-muted-foreground">{note}</p>
          ))}

          {Object.keys(token.context).length > 0 && (
            <pre className="mono max-h-32 overflow-auto whitespace-pre-wrap rounded bg-muted/30 p-2 text-[10px]">
              {JSON.stringify(token.context, null, 2)}
            </pre>
          )}

          {probe && (
            <pre className="mono max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted/30 p-2 text-[10px]">{probe}</pre>
          )}
        </div>
      )}
    </ToolShell>
  );
}

function F({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
