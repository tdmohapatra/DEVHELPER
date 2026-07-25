import { Bug } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { pushDebugEvent, useDebugStore } from "@/stores/useDebugStore";
import type { ParsedEvent } from "@/tools/lib/debugSession";

/**
 * One-click capture of a tool's result into the active Debug Session (a "Captured" session
 * is created if none exists). `makeEvent` is called on click so the event snapshots the
 * current state.
 */
export function AddToDebug({
  makeEvent,
  label = "Add to Debug Session",
  variant = "outline",
  size = "sm",
  ...props
}: { makeEvent: () => ParsedEvent; label?: string } & Omit<ButtonProps, "onClick">) {
  return (
    <Button
      variant={variant}
      size={size}
      title="Capture this onto the Debug Session timeline"
      onClick={() => {
        const id = pushDebugEvent(makeEvent());
        const name = useDebugStore.getState().sessions.find((s) => s.id === id)?.name ?? "session";
        toast.success(`Added to "${name}"`);
      }}
      {...props}
    >
      <Bug /> {label}
    </Button>
  );
}
