import { useState } from "react";
import { ArrowRightLeft } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CopyButton } from "@/components/CopyButton";
import { base64ToText, textToBase64 } from "@/tools/lib/encoding";
import { toast } from "@/components/ui/toast";

export function Base64Tool() {
  const [text, setText] = useState("Hello, DevHelper!");
  const [b64, setB64] = useState(() => textToBase64("Hello, DevHelper!"));

  const encode = () => {
    try {
      setB64(textToBase64(text));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const decode = () => {
    try {
      setText(base64ToText(b64));
    } catch {
      toast.error("Invalid Base64 input");
    }
  };

  return (
    <ToolShell toolId="base64" title="Base64 Encode / Decode" description="Convert text to and from Base64 (UTF-8 safe).">
      <div className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-[1fr_auto_1fr]">
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">Plain text</label>
            <CopyButton value={text} size="sm" variant="ghost" />
          </div>
          <Textarea mono className="h-72" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <div className="flex flex-col items-center justify-center gap-2">
          <Button size="sm" onClick={encode} title="Text → Base64"><ArrowRightLeft /> Encode</Button>
          <Button size="sm" variant="outline" onClick={decode} title="Base64 → Text"><ArrowRightLeft /> Decode</Button>
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">Base64</label>
            <CopyButton value={b64} size="sm" variant="ghost" />
          </div>
          <Textarea mono className="h-72" value={b64} onChange={(e) => setB64(e.target.value)} />
        </div>
      </div>
    </ToolShell>
  );
}
