import { useAiStore } from "@/stores/useAiStore";
import { usePhiStore } from "@/stores/usePhiStore";
import { executeRequest } from "./http";
import { applyPolicyToMessages, isLocalDestination, reidentify, type PhiKind, type PhiPolicy } from "@/tools/lib/phi";

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

/** Thrown when the PHI policy refused to let a prompt leave the machine. */
export class PhiBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhiBlockedError";
  }
}

/** Where the current provider sends data. */
export function aiEndpoint(): string {
  const cfg = useAiStore.getState();
  return cfg.provider === "ollama" ? cfg.ollamaUrl : cfg.openaiBaseUrl;
}

/**
 * The policy that applies to the current destination.
 *
 * A model on this machine is a different situation from an API on the internet,
 * and the store can be told to treat it as one. Everything else redacts.
 */
export function activePolicy(): { policy: PhiPolicy; local: boolean; destination: string } {
  const destination = aiEndpoint();
  const local = isLocalDestination(destination);
  const { policy, trustLocal } = usePhiStore.getState();
  return { policy: local && trustLocal ? "off" : policy, local, destination };
}

/**
 * Send a chat completion to the configured provider.
 *
 * Every AI tool in DevHelper goes through here, which is why the PHI gateway
 * lives here and not in any one screen: a redaction that a tool has to remember
 * to call is one a new tool will forget. The prompt is redacted on the way out
 * and the answer is re-identified on the way back, so the caller sees real
 * values and the provider never did.
 *
 * `toolId` is only used to label the log line.
 */
export async function aiChat(messages: ChatMessage[], toolId = "ai"): Promise<string> {
  const cfg = useAiStore.getState();
  if (!cfg.isConfigured()) throw new AiNotConfiguredError();

  const { policy, local, destination } = activePolicy();
  const decision = applyPolicyToMessages(messages.map((m) => m.content), policy);

  const kinds: Partial<Record<PhiKind, number>> = {};
  for (const f of decision.findings) kinds[f.kind] = (kinds[f.kind] ?? 0) + 1;
  usePhiStore.getState().record({
    at: Date.now(),
    tool: toolId,
    destination,
    local,
    policy,
    found: decision.findings.length,
    kinds,
    sent: decision.allowed,
    message: decision.message,
  });

  if (!decision.allowed) throw new PhiBlockedError(decision.message);

  const outgoing: ChatMessage[] = messages.map((m, i) => ({ ...m, content: decision.texts[i] }));
  const reply = await send(outgoing);

  // Put the real values back. With policy `off` or `warn` the map is empty and
  // this is a no-op, which is the correct behaviour for both.
  return reidentify(reply, decision.map);
}

async function send(messages: ChatMessage[]): Promise<string> {
  const cfg = useAiStore.getState();

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
