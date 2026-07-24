import { useEffect, useMemo, useState } from "react";
import { Clock } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/CopyButton";
import { buildTimeView, parseUnixTimestamp } from "@/tools/lib/time";

export function UnixTimestamp() {
  const [input, setInput] = useState(() => String(Math.floor(Date.now() / 1000)));
  const [now, setNow] = useState(Date.now());

  // Tick the "current time" card once per second.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const parsed = useMemo(() => {
    try {
      const { date, detectedUnit } = parseUnixTimestamp(input);
      return { view: buildTimeView(date), detectedUnit, error: "" };
    } catch (e) {
      return { view: null, detectedUnit: null, error: (e as Error).message };
    }
  }, [input]);

  const current = buildTimeView(new Date(now), now);

  return (
    <ToolShell toolId="unix-timestamp" title="Unix Timestamp Converter" description="Convert between Unix time and human-readable dates. Auto-detects seconds vs milliseconds.">
      <div className="mb-4 rounded-md border border-border p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          <Clock className="size-4 text-primary" /> Now
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Field label="Unix seconds" value={String(current.unixSeconds)} />
          <Field label="Unix millis" value={String(current.unixMillis)} />
          <Field label="ISO 8601" value={current.iso} />
          <Field label="UTC" value={current.utc} />
          <Field label="Local" value={current.local} />
          <Field label="IST" value={current.ist} />
        </div>
        <Button size="sm" variant="outline" className="mt-3" onClick={() => setInput(String(Math.floor(Date.now() / 1000)))}>
          Use current timestamp
        </Button>
      </div>

      <label className="text-xs font-medium text-muted-foreground">Timestamp</label>
      <div className="mt-1 flex items-center gap-2">
        <Input className="mono max-w-xs" value={input} onChange={(e) => setInput(e.target.value)} placeholder="1516239022" />
        {parsed.detectedUnit && <Badge variant="secondary">Detected: {parsed.detectedUnit}</Badge>}
      </div>
      {parsed.error && <p className="mt-2 text-xs text-destructive">{parsed.error}</p>}

      {parsed.view && (
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
          <Field label="Relative" value={parsed.view.relative} />
          <Field label="ISO 8601" value={parsed.view.iso} />
          <Field label="UTC" value={parsed.view.utc} />
          <Field label="Local" value={parsed.view.local} />
          <Field label="IST" value={parsed.view.ist} />
          <Field label="Unix millis" value={String(parsed.view.unixMillis)} />
        </div>
      )}
    </ToolShell>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="group rounded-md border border-border bg-card px-3 py-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <CopyButton value={value} size="icon" variant="ghost" label="" className="size-6 opacity-0 group-hover:opacity-100" />
      </div>
      <div className="mono truncate" title={value}>{value}</div>
    </div>
  );
}
