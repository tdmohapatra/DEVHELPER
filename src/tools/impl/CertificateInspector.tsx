import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, ShieldCheck } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { CopyButton } from "@/components/CopyButton";
import { cn } from "@/lib/utils";
import {
  analyseChain,
  certificateFindings,
  daysUntil,
  fingerprint,
  matchesHostname,
  mtlsReadiness,
  parseCertificate,
  readCertificates,
  type CertFinding,
  type Certificate,
} from "@/tools/lib/x509";

export function CertificateInspector() {
  const [text, setText] = useState("");
  const [hostname, setHostname] = useState("");
  const [prints, setPrints] = useState<string[]>([]);

  const parsed = useMemo(() => {
    if (!text.trim()) return { certificates: [] as Certificate[], error: "" };
    try {
      return { certificates: readCertificates(text).map(parseCertificate), error: "" };
    } catch (e) {
      return { certificates: [] as Certificate[], error: e instanceof Error ? e.message : String(e) };
    }
  }, [text]);

  const chain = useMemo(() => analyseChain(parsed.certificates), [parsed.certificates]);

  useEffect(() => {
    let cancelled = false;
    Promise.all(parsed.certificates.map((c) => fingerprint(c.der).catch(() => "")))
      .then((values) => !cancelled && setPrints(values))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [parsed.certificates]);

  return (
    <ToolShell
      toolId="certificate-inspector"
      title="Certificate Inspector"
      description="Read a certificate or a whole chain: expiry, names, usage and what will make the handshake fail."
    >
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Check a hostname against it (optional)</span>
          <Input className="mono h-8 w-72" value={hostname} onChange={(e) => setHostname(e.target.value)} placeholder="api.example.com" />
        </label>
        {parsed.certificates.length > 0 && <Badge variant="outline">{parsed.certificates.length} certificate(s)</Badge>}
      </div>

      <Textarea
        mono
        className="h-40"
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        placeholder={"-----BEGIN CERTIFICATE-----\n… or a whole chain, or bare base64 out of a secret"}
      />
      <p className="mt-1 text-[11px] text-muted-foreground">
        Nothing leaves the machine — this reads the bytes you paste. It does <b>not</b> verify signatures: that needs the
        issuer's key and a trust store, and a tool that implied it had checked would be worse than one that says it did
        not. To fetch a live certificate, <span className="mono">openssl s_client -connect host:443 -servername host</span>{" "}
        and paste what it prints.
      </p>

      {parsed.error && (
        <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{parsed.error}</div>
      )}

      {chain.findings.length > 0 && (
        <div className="mt-3 flex flex-col gap-1 rounded-md border border-warning/40 bg-warning/5 p-2">
          <p className="text-xs font-medium">Chain</p>
          {chain.findings.map((finding, i) => (
            <FindingRow key={i} finding={finding} />
          ))}
        </div>
      )}

      {chain.ordered.length > 1 && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Path: {chain.ordered.map((c) => c.subject.parts.CN || c.subject.text).join(" → ")}
        </p>
      )}

      <div className="mt-3 flex flex-col gap-3">
        {parsed.certificates.map((cert, index) => {
          const findings = [...certificateFindings(cert), ...mtlsReadiness(cert)];
          const remaining = daysUntil(cert.notAfter);
          const match = hostname.trim() ? matchesHostname(cert, hostname) : null;
          return (
            <div key={index} className="rounded-md border border-border">
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-1.5">
                <b className="text-sm">{cert.subject.parts.CN || cert.subject.text || "(no subject)"}</b>
                {cert.isCa && <Badge variant="secondary" className="text-[9px]">CA</Badge>}
                {cert.selfSigned && <Badge variant="outline" className="text-[9px]">self-signed</Badge>}
                {remaining !== null && (
                  <Badge variant={remaining < 0 ? "destructive" : remaining <= 45 ? "warning" : "success"} className="text-[9px]">
                    {remaining < 0 ? `expired ${Math.abs(remaining)}d ago` : `${remaining}d left`}
                  </Badge>
                )}
                {match && (
                  <Badge variant={match.matched ? "success" : "destructive"} className="text-[9px]">
                    {match.matched ? `matches ${hostname} via ${match.by}` : `does not match ${hostname}`}
                  </Badge>
                )}
                {prints[index] && <CopyButton className="ml-auto" value={prints[index]} />}
              </div>

              <div className="grid grid-cols-1 gap-x-6 gap-y-1 px-3 py-2 text-[11px] lg:grid-cols-2">
                <Row label="Subject" value={cert.subject.text} />
                <Row label="Issuer" value={cert.issuer.text} />
                <Row label="Valid from" value={cert.notBefore?.toISOString().replace(".000Z", "Z") ?? "—"} />
                <Row label="Valid to" value={cert.notAfter?.toISOString().replace(".000Z", "Z") ?? "—"} />
                <Row label="Serial" value={cert.serial} mono />
                <Row label="Signature" value={cert.signatureAlgorithm} />
                <Row label="Key" value={`${cert.keyAlgorithm}${cert.keyBits ? ` ${cert.keyBits} bits` : ""}`} />
                <Row label="Version" value={`v${cert.version}`} />
                {cert.altNames.length > 0 && <Row label="Alt names" value={cert.altNames.join(", ")} mono wide />}
                {cert.keyUsage.length > 0 && <Row label="Key usage" value={cert.keyUsage.join(", ")} />}
                {cert.extendedKeyUsage.length > 0 && <Row label="Extended usage" value={cert.extendedKeyUsage.join(", ")} />}
                {cert.subjectKeyId && <Row label="Subject key id" value={cert.subjectKeyId} mono wide />}
                {cert.authorityKeyId && <Row label="Authority key id" value={cert.authorityKeyId} mono wide />}
                {cert.ocspUrls.length > 0 && <Row label="OCSP" value={cert.ocspUrls.join(", ")} mono wide />}
                {cert.issuerUrls.length > 0 && <Row label="Issuer certificate" value={cert.issuerUrls.join(", ")} mono wide />}
                {cert.crlUrls.length > 0 && <Row label="CRL" value={cert.crlUrls.join(", ")} mono wide />}
                {prints[index] && <Row label="SHA-256 fingerprint" value={prints[index]} mono wide />}
              </div>

              {findings.length > 0 ? (
                <div className="flex flex-col gap-1 border-t border-border px-3 py-2">
                  {findings.map((finding, i) => (
                    <FindingRow key={i} finding={finding} />
                  ))}
                </div>
              ) : (
                <p className="border-t border-border px-3 py-2 text-[11px] text-success">
                  <CheckCircle2 className="mr-1 inline size-3" /> Nothing to flag: in date, named, and signed with
                  something current.
                </p>
              )}

              {cert.extensions.length > 0 && (
                <details className="border-t border-border px-3 py-1.5">
                  <summary className="cursor-pointer text-[11px] text-muted-foreground">
                    {cert.extensions.length} extension(s)
                  </summary>
                  <div className="mt-1 flex flex-col gap-0.5 text-[10px]">
                    {cert.extensions.map((extension) => (
                      <div key={extension.oid}>
                        <span className="mono">{extension.oid}</span> — {extension.name}
                        {extension.critical && <Badge variant="warning" className="ml-2 text-[9px]">critical</Badge>}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          );
        })}
      </div>

      {parsed.certificates.length === 0 && !parsed.error && (
        <div className="mt-6 rounded-md border border-border p-3 text-[11px] text-muted-foreground">
          <p className="flex items-center gap-2 font-medium text-foreground">
            <ShieldCheck className="size-4" /> What this catches
          </p>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
            <li>Expiry, and the fortnight before it, when a change window still has to be raised.</li>
            <li>A certificate not yet valid — usually clock skew between two servers, which no handshake error mentions.</li>
            <li>A missing subjectAltName. Clients ignore the CN now, so a CN-only certificate fails everywhere.</li>
            <li>A chain missing its intermediate: works in a browser, which caches them, fails from curl, which does not.</li>
            <li>A client certificate with no <span className="mono">clientAuth</span>, which the server reports only as <span className="mono">handshake failure</span>.</li>
          </ul>
        </div>
      )}
    </ToolShell>
  );
}

function FindingRow({ finding }: { finding: CertFinding }) {
  return (
    <p className="text-[11px]">
      {finding.level === "error" ? (
        <AlertTriangle className="mr-1 inline size-3 text-destructive" />
      ) : finding.level === "warn" ? (
        <AlertTriangle className="mr-1 inline size-3 text-warning" />
      ) : (
        <Info className="mr-1 inline size-3 text-muted-foreground" />
      )}
      <b>{finding.subject}:</b> {finding.message}
    </p>
  );
}

function Row({ label, value, mono, wide }: { label: string; value: string; mono?: boolean; wide?: boolean }) {
  return (
    <div className={cn("flex gap-2", wide && "lg:col-span-2")}>
      <span className="w-36 shrink-0 text-muted-foreground">{label}</span>
      <span className={cn("min-w-0 break-all", mono && "mono")}>{value}</span>
    </div>
  );
}
