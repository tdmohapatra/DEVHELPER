import { describe, it, expect, vi, beforeEach } from "vitest";

const executeRequest = vi.hoisted(() => vi.fn());
vi.mock("./http", () => ({ executeRequest, corsLimited: () => false }));

import { activePolicy, aiChat, AiNotConfiguredError, PhiBlockedError } from "./ai";
import { useAiStore } from "@/stores/useAiStore";
import { usePhiStore } from "@/stores/usePhiStore";

/**
 * The gateway, at the one place it has to work.
 *
 * `phi.ts` is tested on its own. What is asserted here is the wiring that makes
 * it matter: that the bytes handed to the network are the redacted ones, that a
 * blocked prompt never reaches the network at all, and that the caller still
 * gets real values back.
 */
describe("aiChat", () => {
  /** The body actually sent, parsed. */
  const sentBody = () => JSON.parse(executeRequest.mock.calls[0][0].body);
  const sentContents = () => sentBody().messages.map((m: { content: string }) => m.content);

  const reply = (content: string) =>
    executeRequest.mockResolvedValue({
      status: 200,
      statusText: "",
      headers: {},
      body: JSON.stringify({ choices: [{ message: { content } }] }),
      timeMs: 1,
      sizeBytes: 0,
      ok: true,
    });

  const remote = () =>
    useAiStore.setState({ provider: "openai", openaiBaseUrl: "https://api.openai.com/v1", openaiKey: "k", openaiModel: "gpt-4o-mini" });

  beforeEach(() => {
    executeRequest.mockReset();
    remote();
    usePhiStore.setState({ policy: "redact", trustLocal: true, log: [] });
  });

  it("refuses to run at all when no provider is configured", async () => {
    useAiStore.setState({ provider: "openai", openaiKey: "", openaiModel: "" });
    await expect(aiChat([{ role: "user", content: "hi" }])).rejects.toBeInstanceOf(AiNotConfiguredError);
    expect(executeRequest).not.toHaveBeenCalled();
  });

  it("sends tokens, not the identifiers that were in the prompt", async () => {
    reply("ok");
    await aiChat([{ role: "user", content: "why did MRN: 100234 fail?" }]);
    expect(sentContents()[0]).toBe("why did MRN: [MRN_1] fail?");
    expect(JSON.stringify(sentBody())).not.toContain("100234");
  });

  it("gives the same value the same token across the messages of one prompt", async () => {
    reply("ok");
    await aiChat([
      { role: "system", content: "context: MRN: 100234" },
      { role: "user", content: "why did MRN: 100234 fail?" },
    ]);
    const [system, user] = sentContents();
    expect(system).toContain("[MRN_1]");
    expect(user).toContain("[MRN_1]");
  });

  it("puts the real values back into the answer, so the caller never sees a token", async () => {
    reply("The message for [MRN_1] was rejected.");
    const answer = await aiChat([{ role: "user", content: "MRN: 100234" }]);
    expect(answer).toBe("The message for 100234 was rejected.");
  });

  it("redacts an HL7 message by field, leaving the result that is being asked about", async () => {
    reply("ok");
    await aiChat([
      { role: "user", content: "PID|1||100234^^^HOSP^MR||SHARMA^PRIYA^K||19750214|F\rOBX|1|NM|718-7^Haemoglobin||9.1|g/dL" },
    ]);
    const sent = sentContents()[0];
    expect(sent).not.toContain("SHARMA");
    expect(sent).not.toContain("19750214");
    expect(sent).toContain("9.1|g/dL");
    expect(sent).toContain("718-7^Haemoglobin");
  });

  it("blocks without touching the network, and says why", async () => {
    reply("ok");
    usePhiStore.setState({ policy: "block" });
    // `redact` is idempotent over the shipped detectors, so a real block needs a
    // residual the redactor could not remove — forced here by a policy run over
    // text whose findings the caller has already been told about.
    const spy = vi.spyOn(await import("@/tools/lib/phi"), "applyPolicyToMessages");
    spy.mockReturnValueOnce({
      allowed: false,
      texts: ["x"],
      map: {},
      findings: [],
      residual: [{ kind: "name", value: "Sharma", start: 0, end: 6, reason: "test", certain: true }],
      message: "Blocked: 1 identifier(s) are still present after redaction (Name).",
    });
    await expect(aiChat([{ role: "user", content: "anything" }])).rejects.toBeInstanceOf(PhiBlockedError);
    expect(executeRequest).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("records every request — counts and categories, never a value", async () => {
    reply("ok");
    await aiChat([{ role: "user", content: "MRN: 100234 and email a@b.co" }], "error-explainer");
    const [entry] = usePhiStore.getState().log;
    expect(entry.tool).toBe("error-explainer");
    expect(entry.sent).toBe(true);
    expect(entry.found).toBeGreaterThan(0);
    expect(entry.kinds.mrn).toBe(1);
    expect(JSON.stringify(entry)).not.toContain("100234");
    expect(JSON.stringify(entry)).not.toContain("a@b.co");
  });

  it("records a block as a request that was not sent", async () => {
    const spy = vi.spyOn(await import("@/tools/lib/phi"), "applyPolicyToMessages");
    spy.mockReturnValueOnce({ allowed: false, texts: [], map: {}, findings: [], residual: [], message: "no" });
    await expect(aiChat([{ role: "user", content: "x" }])).rejects.toThrow();
    expect(usePhiStore.getState().log[0].sent).toBe(false);
    spy.mockRestore();
  });

  it("warn sends the text as written and keeps no map", async () => {
    reply("about [MRN_1]");
    usePhiStore.setState({ policy: "warn" });
    const answer = await aiChat([{ role: "user", content: "MRN: 100234" }]);
    expect(sentContents()[0]).toBe("MRN: 100234");
    // Nothing was tokenised, so nothing is put back — the token stays a token.
    expect(answer).toBe("about [MRN_1]");
    expect(usePhiStore.getState().log[0].found).toBeGreaterThan(0);
  });

  it("off sends the text untouched and finds nothing to report", async () => {
    reply("ok");
    usePhiStore.setState({ policy: "off" });
    await aiChat([{ role: "user", content: "MRN: 100234" }]);
    expect(sentContents()[0]).toBe("MRN: 100234");
    expect(usePhiStore.getState().log[0].found).toBe(0);
  });
});

/**
 * The offline provider, at the wiring that distinguishes it.
 *
 * A GGUF file served by a llama.cpp process on this machine speaks the same
 * OpenAI shape as the hosted APIs, so almost nothing is different — and the
 * "almost" is what is asserted here: where the request goes, that it carries no
 * bearer token, and that a chosen-but-not-running model is not "configured".
 */
describe("aiChat with an offline model", () => {
  const reply = (content: string) =>
    executeRequest.mockResolvedValue({
      status: 200, statusText: "", headers: {},
      body: JSON.stringify({ choices: [{ message: { content } }] }),
      timeMs: 1, sizeBytes: 0, ok: true,
    });
  const sent = () => executeRequest.mock.calls[0][0];

  beforeEach(() => {
    executeRequest.mockReset();
    usePhiStore.setState({ policy: "redact", trustLocal: true, log: [] });
    useAiStore.setState({
      provider: "local",
      localModelPath: "C:/TDM/TDM_OFFLINE_LLMHUB/llama-8b-Q4_K_M.gguf",
      localModelLabel: "llama-8b-Q4_K_M",
      localPort: 8081,
      localRunning: true,
    });
  });

  it("posts to the loopback server that DevHelper started", async () => {
    reply("ok");
    await aiChat([{ role: "user", content: "hi" }]);
    expect(sent().url).toBe("http://127.0.0.1:8081/v1/chat/completions");
    expect(JSON.parse(sent().body).model).toBe("llama-8b-Q4_K_M");
  });

  it("sends no Authorization header — there is no key, and an empty bearer gets a 401", async () => {
    reply("ok");
    await aiChat([{ role: "user", content: "hi" }]);
    expect(Object.keys(sent().headers)).not.toContain("Authorization");
  });

  it("is not configured while the model is only chosen", async () => {
    useAiStore.setState({ localRunning: false, localPort: 0 });
    await expect(aiChat([{ role: "user", content: "hi" }])).rejects.toBeInstanceOf(AiNotConfiguredError);
    expect(executeRequest).not.toHaveBeenCalled();
  });

  it("counts as a machine-local destination, so trustLocal applies", () => {
    expect(activePolicy()).toMatchObject({ policy: "off", local: true });
  });

  it("still redacts when the local destination is not trusted", () => {
    usePhiStore.setState({ trustLocal: false });
    expect(activePolicy().policy).toBe("redact");
  });
});

describe("activePolicy", () => {
  beforeEach(() => usePhiStore.setState({ policy: "redact", trustLocal: true }));

  it("relaxes to off for a model on this machine, when told to", () => {
    useAiStore.setState({ provider: "ollama", ollamaUrl: "http://localhost:11434", ollamaModel: "llama3.1" });
    expect(activePolicy()).toMatchObject({ policy: "off", local: true });
  });

  it("keeps the policy for a local model when not told to trust it", () => {
    useAiStore.setState({ provider: "ollama", ollamaUrl: "http://localhost:11434", ollamaModel: "llama3.1" });
    usePhiStore.setState({ trustLocal: false });
    expect(activePolicy().policy).toBe("redact");
  });

  it("never relaxes for a remote endpoint, whatever it is called", () => {
    useAiStore.setState({ provider: "openai", openaiBaseUrl: "https://localhost.evil.com/v1", openaiKey: "k", openaiModel: "m" });
    expect(activePolicy()).toMatchObject({ policy: "redact", local: false });
  });
});
