import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { copyToClipboard } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

interface CopyButtonProps extends Omit<ButtonProps, "onClick"> {
  value: string;
  label?: string;
}

export function CopyButton({ value, label, className, variant = "outline", size = "sm", ...props }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant={variant}
      size={size}
      className={cn(className)}
      disabled={!value}
      onClick={async () => {
        const ok = await copyToClipboard(value);
        if (ok) {
          setCopied(true);
          toast.success("Copied to clipboard");
          setTimeout(() => setCopied(false), 1200);
        } else {
          toast.error("Copy failed");
        }
      }}
      {...props}
    >
      {copied ? <Check /> : <Copy />}
      {label ?? (copied ? "Copied" : "Copy")}
    </Button>
  );
}
