import { useMemo, useState } from "react";
import { ShieldCheck, ShieldX, Clock } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/CopyButton";
import { decodeJwt, type JwtParts } from "@/tools/lib/jwt";

const SAMPLE =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

function StatusBadge({ status }: { status: JwtParts["status"] }) {
  if (status === "valid") return <Badge variant="success" className="gap-1"><ShieldCheck className="size-3" /> Valid</Badge>;
  if (status === "expired") return <Badge variant="destructive" className="gap-1"><ShieldX className="size-3" /> Expired</Badge>;
  if (status === "not-yet-valid") return <Badge variant="warning" className="gap-1"><Clock className="size-3" /> Not yet valid</Badge>;
  return <Badge variant="secondary">No expiry</Badge>;
}

export function JwtDecoder() {
  const [token, setToken] = useState(SAMPLE);
  const [error, setError] = useState("");

  const decoded = useMemo(() => {
    if (!token.trim()) return null;
    try {
      setError("");
      return decodeJwt(token);
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }, [token]);

  return (
    <ToolShell
      toolId="jwt-decoder"
      title="JWT Decoder"
      description="Decode JWT header and claims locally. Nothing is sent anywhere; signature is not verified."
      actions={decoded && <StatusBadge status={decoded.status} />}
    >
      <label className="text-xs font-medium text-muted-foreground">Token</label>
      <Textarea mono className="mt-1 h-28" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Paste a JWT…" />
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      {decoded && (
        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Section title="Header" value={JSON.stringify(decoded.header, null, 2)} />
          <Section title="Payload" value={JSON.stringify(decoded.payload, null, 2)} />
          <div className="lg:col-span-2 rounded-md border border-border p-3 text-sm">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Claim label="Issued" value={decoded.issuedAt?.toLocaleString()} />
              <Claim label="Expires" value={decoded.expiresAt?.toLocaleString()} />
              <Claim label="Not before" value={decoded.notBefore?.toLocaleString()} />
            </div>
          </div>
        </div>
      )}
    </ToolShell>
  );
}

function Section({ title, value }: { title: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground">{title}</label>
        <CopyButton value={value} size="sm" variant="ghost" />
      </div>
      <Textarea mono readOnly className="h-48 bg-muted/30" value={value} />
    </div>
  );
}

function Claim({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-mono text-[13px]">{value ?? "—"}</div>
    </div>
  );
}
