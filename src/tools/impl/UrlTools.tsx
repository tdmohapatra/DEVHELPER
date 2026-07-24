import { useMemo, useState } from "react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CopyButton } from "@/components/CopyButton";
import { parseQueryParams, urlDecode, urlEncode } from "@/tools/lib/encoding";
import { toast } from "@/components/ui/toast";

export function UrlTools() {
  const [raw, setRaw] = useState("https://api.dev/users?id=42&name=John%20Doe&active=true#top");
  const [encoded, setEncoded] = useState("");

  const params = useMemo(() => {
    try {
      return parseQueryParams(raw);
    } catch {
      return [];
    }
  }, [raw]);

  return (
    <ToolShell toolId="url-tools" title="URL Encode / Decode" description="Encode/decode URLs and inspect query parameters.">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">Input</label>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => { try { setEncoded(urlEncode(raw)); } catch (e) { toast.error((e as Error).message); } }}>Encode</Button>
            <Button size="sm" variant="outline" onClick={() => { try { setEncoded(urlDecode(raw)); } catch { toast.error("Invalid URL-encoded input"); } }}>Decode</Button>
          </div>
        </div>
        <Textarea mono className="h-24" value={raw} onChange={(e) => setRaw(e.target.value)} />
      </div>

      <div className="mt-3 flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">Result</label>
          <CopyButton value={encoded} size="sm" variant="ghost" />
        </div>
        <Textarea mono readOnly className="h-24 bg-muted/30" value={encoded} />
      </div>

      <div className="mt-4">
        <label className="text-xs font-medium text-muted-foreground">Query parameters</label>
        <div className="mt-1 rounded-md border border-border">
          {params.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">No query parameters detected.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs text-muted-foreground">
                <tr><th className="px-3 py-2 font-medium">Key</th><th className="px-3 py-2 font-medium">Value</th></tr>
              </thead>
              <tbody className="divide-y divide-border font-mono text-[13px]">
                {params.map((p, i) => (
                  <tr key={i}><td className="px-3 py-1.5">{p.key}</td><td className="px-3 py-1.5">{p.value}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </ToolShell>
  );
}
