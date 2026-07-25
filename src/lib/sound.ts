import { create } from "zustand";
import { persist } from "zustand/middleware";

export type SoundEvent = "success" | "error" | "copy" | "notification";

interface SoundState {
  /** Master switch. Off by default — sounds must be opted into. */
  enabled: boolean;
  volume: number; // 0..1
  set: (patch: Partial<Pick<SoundState, "enabled" | "volume">>) => void;
}

export const useSoundStore = create<SoundState>()(
  persist(
    (set) => ({
      enabled: false,
      volume: 0.3,
      set: (patch) => set(patch),
    }),
    { name: "devhelper-sound" },
  ),
);

// Lazily-created shared AudioContext. Created on first use (always inside a user gesture:
// copy / toast), so browser autoplay policies are satisfied.
let ctx: AudioContext | null = null;
function audioCtx(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(c: AudioContext, freq: number, start: number, dur: number, type: OscillatorType, gain: number) {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  // Soft attack/decay envelope to avoid clicks.
  g.gain.setValueAtTime(0, c.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, c.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  osc.connect(g).connect(c.destination);
  osc.start(c.currentTime + start);
  osc.stop(c.currentTime + start + dur + 0.02);
}

/**
 * Play a short synthesized cue for a meaningful state change. No-op unless the user has
 * enabled sound. Never throws — audio failures must not affect the app.
 */
export function playSound(event: SoundEvent): void {
  const { enabled, volume } = useSoundStore.getState();
  if (!enabled) return;
  const c = audioCtx();
  if (!c) return;
  const v = Math.max(0, Math.min(1, volume)) * 0.5;
  try {
    switch (event) {
      case "success":
        tone(c, 660, 0, 0.09, "sine", v);
        tone(c, 880, 0.08, 0.12, "sine", v);
        break;
      case "error":
        tone(c, 200, 0, 0.2, "square", v * 0.7);
        break;
      case "copy":
        tone(c, 1180, 0, 0.045, "sine", v * 0.8);
        break;
      case "notification":
        tone(c, 520, 0, 0.12, "sine", v);
        break;
    }
  } catch {
    /* ignore — audio is best-effort */
  }
}
