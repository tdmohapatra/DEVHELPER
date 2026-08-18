import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  /** Second line, for what the switch actually does. */
  hint?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * A labelled checkbox.
 *
 * The native input stays in the tree — hidden, not replaced — so the keyboard,
 * the focus ring and screen readers keep working; the visible box is drawn from
 * its state. Building the box out of a div and an onClick loses all three.
 */
export function Checkbox({ checked, onCheckedChange, label, hint, disabled, className }: Props) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-2.5", disabled && "cursor-not-allowed opacity-60", className)}>
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onCheckedChange(e.target.checked)}
      />
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border transition-colors",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background",
          checked ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background",
        )}
      >
        {checked && <Check className="size-3" strokeWidth={3} />}
      </span>
      <span className="space-y-0.5">
        <span className="block text-sm leading-none">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}
