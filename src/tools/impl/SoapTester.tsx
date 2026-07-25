import { useMemo, useState } from "react";
import { Send, Ban } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/CopyButton";
import { AddToDebug } from "@/components/AddToDebug";
import { toast } from "@/components/ui/toast";
import { executeRequest, corsLimited } from "@/lib/http";
import { formatXml } from "@/tools/lib/xml";
import type { ApiResponse } from "@/tools/lib/apiTypes";

const SAMPLE_BODY = `<web:GetWeather>
  <web:City>London</web:City>
  <web:Country>UK</web:Country>
</web:GetWeather>`;

function envelope(body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:web="http://example.com/webservice">
  <soap:Header/>
  <soap:Body>
${body.split("\n").map((l) => "    " + l).join("\n")}
  </soap:Body>
</soap:Envelope>`;
}

export function SoapTester() {
  const [url, setUrl] = useState("");
  const [action, setAction] = useState("");
  const [body, setBody] = useState(SAMPLE_BODY);
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [ctrl, setCtrl] = useState<AbortController | null>(null);

  const preview = useMemo(() => envelope(body), [body]);

  const send = async () => {
    if (!url.trim()) return toast.error("Enter a SOAP endpoint URL");
    setLoading(true);
    setError("");
    setResponse(null);
    const controller = new AbortController();
    setCtrl(controller);
    try {
      const headers: Record<string, string> = { "Content-Type": "text/xml; charset=utf-8" };
      if (action.trim()) headers["SOAPAction"] = action.trim();
      const res = await executeRequest({ method: "POST", url: url.trim(), headers, body: preview }, controller.signal);
      setResponse(res);
    } catch (e) {
      setError((e as Error).name === "AbortError" ? "Request cancelled" : (e as Error).message);
    } finally {
      setLoading(false);
      setCtrl(null);
    }
  };

  const prettyResp = useMemo(() => {
    if (!response) return "";
    try {
      return formatXml(response.body);
    } catch {
      return response.body;
    }
  }, [response]);

  return (
    <ToolShell
      toolId="soap-tester"
      title="SOAP / XML Tester"
      description="Build a SOAP envelope, send it, and inspect the response."
      actions={response && <CopyButton value={prettyResp} label="Copy response" />}
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Endpoint URL</label>
            <Input className="font-mono text-sm" placeholder="https://service.example.com/soap" value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
          <div className="flex w-64 flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">SOAPAction (optional)</label>
            <Input className="font-mono text-xs" placeholder="urn:GetWeather" value={action} onChange={(e) => setAction(e.target.value)} />
          </div>
          {loading ? (
            <Button variant="destructive" onClick={() => ctrl?.abort()}><Ban /> Cancel</Button>
          ) : (
            <Button onClick={send}><Send /> Send</Button>
          )}
        </div>

        {corsLimited() && (
          <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs">
            Browser dev mode: subject to CORS. The desktop app sends natively.
          </div>
        )}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Body (wrapped in a SOAP envelope on send)</label>
          <Textarea mono className="h-40" value={body} onChange={(e) => setBody(e.target.value)} />
          <label className="mt-2 text-xs font-medium text-muted-foreground">Envelope preview</label>
          <Textarea mono readOnly className="h-40 bg-muted/30" value={preview} />
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground">Response</label>
            {response && (
              <>
                <Badge variant={response.ok ? "success" : "destructive"}>{response.status} {response.statusText}</Badge>
                <span className="text-xs text-muted-foreground">{response.timeMs} ms</span>
                <AddToDebug
                  className="ml-auto"
                  variant="ghost"
                  label="Debug"
                  makeEvent={() => ({
                    source: "http" as const,
                    status: response.ok ? ("ok" as const) : ("error" as const),
                    title: `SOAP ${action || url} → ${response.status}`,
                    durationMs: response.timeMs,
                    payload: JSON.stringify({ url, action, body: response.body.slice(0, 2000) }),
                    error: response.ok ? undefined : response.body.slice(0, 800),
                  })}
                />
              </>
            )}
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Textarea mono readOnly className="h-[336px] bg-muted/30" value={prettyResp} placeholder={loading ? "Sending…" : "Response appears here…"} />
        </div>
      </div>
    </ToolShell>
  );
}
