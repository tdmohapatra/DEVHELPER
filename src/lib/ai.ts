import { useAiStore } from "@/stores/useAiStore";
import { executeRequest } from "./http";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super("AI is not configured. Set up a provider in Settings → AI.");
    this.name = "AiNotConfiguredError";
  }
}

/**
 * Send a chat completion to the configured provider.
 *
 * Privacy: this sends the prompt to an EXTERNAL/local provider. Callers must make it
 * clear to the user that data leaves the tool (local for Ollama, remote for OpenAI).
 */
export async function aiChat(messages: ChatMessage[]): Promise<string> {
  const cfg = useAiStore.getState();
  if (!cfg.isConfigured()) throw new AiNotConfiguredError();

  if (cfg.provider === "ollama") {
    const res = await executeRequest({
      method: "POST",
      url: `${cfg.ollamaUrl.replace(/\/$/, "")}/api/chat`,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: cfg.ollamaModel, messages, stream: false }),
    });
    if (!res.ok) throw new Error(`Ollama error ${res.status}: ${res.body.slice(0, 300)}`);
    const json = JSON.parse(res.body);
    return json.message?.content ?? "";
  }

  // OpenAI-compatible
  const res = await executeRequest({
    method: "POST",
    url: `${cfg.openaiBaseUrl.replace(/\/$/, "")}/chat/completions`,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.openaiKey}` },
    body: JSON.stringify({ model: cfg.openaiModel, messages }),
  });
  if (!res.ok) throw new Error(`AI error ${res.status}: ${res.body.slice(0, 300)}`);
  const json = JSON.parse(res.body);
  return json.choices?.[0]?.message?.content ?? "";
}

/** Where does data go for the current provider? For privacy notices. */
export function aiDestinationLabel(): string {
  const cfg = useAiStore.getState();
  return cfg.provider === "ollama"
    ? `local Ollama (${cfg.ollamaUrl})`
    : `external API (${cfg.openaiBaseUrl})`;
}
