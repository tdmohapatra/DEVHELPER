/**
 * Which AI answers, given two switches.
 *
 * Settings offers two independent switches — Local AI and Online AI — because
 * that is how people think about it: "is the offline one on, is the cloud one
 * on". A provider is what the rest of the code needs, so the switches are the
 * input and the provider is the output, resolved in one place with tests rather
 * than re-derived in each screen.
 *
 * The rule when both are on is deliberate: **local wins, and there is no
 * fallback.** A prompt the user believed was staying on this machine must not
 * reach a cloud API because a server failed to start — so a local model that is
 * not running is an error to fix, never a reason to reroute. The tradeoff is
 * stated out loud in `routingNote`.
 */
import type { AiProvider } from "@/stores/useAiStore";

/** The two things Local AI can mean: a model file we run, or an Ollama server. */
export type LocalKind = "local" | "ollama";

export interface AiSwitches {
  localEnabled: boolean;
  onlineEnabled: boolean;
  localKind: LocalKind;
}

/**
 * The provider a prompt goes to, or null when AI is switched off entirely.
 *
 * Both switches off is a real state, not an error: DevHelper's whole point is
 * that it works without AI, so the tools should say "off" rather than "broken".
 */
export function resolveProvider(s: AiSwitches): AiProvider | null {
  if (s.localEnabled) return s.localKind;
  if (s.onlineEnabled) return "openai";
  return null;
}

/** Is any AI switched on? */
export function aiEnabled(s: AiSwitches): boolean {
  return s.localEnabled || s.onlineEnabled;
}

/**
 * What to tell the user about the current combination.
 *
 * The case worth a sentence is both-on: the online switch is configured but idle,
 * and someone who does not know that will wonder why their key is unused.
 */
export function routingNote(s: AiSwitches): string {
  if (!aiEnabled(s)) return "AI is off. Every other tool still works.";
  if (s.localEnabled && s.onlineEnabled) {
    return s.localKind === "ollama"
      ? "Both are on, so Ollama answers. The online API stays unused until you switch Local AI off — nothing falls back to it."
      : "Both are on, so your offline model answers. The online API stays unused until you switch Local AI off — nothing falls back to it.";
  }
  if (s.localEnabled) {
    return s.localKind === "ollama"
      ? "Prompts go to Ollama on this machine."
      : "Prompts go to your offline model. Nothing leaves this machine.";
  }
  return "Prompts go to an external API over the internet.";
}

/**
 * Why AI is switched on but cannot answer yet.
 *
 * "Not configured" is true but useless — the first version of the chat banner
 * said prompts were going to the offline model *and* asked the user to switch an
 * AI on, which are contradictory and neither was the actual blocker. Each
 * provider has exactly one thing missing, so name that.
 */
export function notReadyReason(s: AiSwitches, provider: AiProvider | null): string {
  if (!aiEnabled(s)) return "AI is switched off. Tick Local AI or Online AI in Settings to chat.";
  if (provider === "local") return "Local AI is on, but no model is running. Pick a model in Settings and press Start.";
  if (provider === "ollama") return "Local AI is set to Ollama, but no server URL and model are set in Settings.";
  return "Online AI is on, but no API key and model are set in Settings.";
}

/**
 * Switches that match a provider, for migrating a setting saved before the
 * switches existed.
 */
export function switchesForProvider(provider: AiProvider): AiSwitches {
  if (provider === "openai") return { localEnabled: false, onlineEnabled: true, localKind: "local" };
  return { localEnabled: true, onlineEnabled: false, localKind: provider };
}
