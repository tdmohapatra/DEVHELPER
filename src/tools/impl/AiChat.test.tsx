import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const aiChat = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai")>()),
  aiChat,
  aiDestinationLabel: () => "offline model on this machine (test-model)",
}));

import { AiChat } from "./AiChat";
import { useAiStore } from "@/stores/useAiStore";
import { useChatStore } from "@/stores/useChatStore";

/**
 * The one thing a chat screen must get right that a single-shot tool need not:
 * the conversation goes out again with every message. A screen that sends only
 * the newest line looks identical until the second question, and then the model
 * answers as if the first never happened.
 */
describe("AiChat", () => {
  const box = () => screen.getAllByRole("textbox")[0] as HTMLTextAreaElement;
  const ask = (text: string) => {
    fireEvent.change(box(), { target: { value: text } });
    fireEvent.keyDown(box(), { key: "Enter" });
  };

  beforeEach(() => {
    aiChat.mockReset();
    aiChat.mockResolvedValue("an answer");
    useChatStore.setState({ turns: [] });
    // Configured, offline, running — the state the feature exists for.
    useAiStore.setState({
      provider: "local", localEnabled: true, onlineEnabled: false, localKind: "local",
      localModelPath: "C:/hub/m.gguf", localModelLabel: "test-model", localPort: 8081, localRunning: true,
    });
  });

  it("shows the answer against the question that was asked", async () => {
    render(<AiChat />);
    ask("why does this MLLP link drop?");
    expect(await screen.findByText("an answer")).toBeTruthy();
    expect(screen.getByText("why does this MLLP link drop?")).toBeTruthy();
  });

  it("resends the whole conversation, so a follow-up has context", async () => {
    render(<AiChat />);
    ask("first question");
    await screen.findByText("an answer");
    ask("and the follow-up?");
    await waitFor(() => expect(aiChat).toHaveBeenCalledTimes(2));

    const second = aiChat.mock.calls[1][0] as { role: string; content: string }[];
    expect(second.map((m) => m.content)).toEqual([
      expect.stringContaining("integration engineer"), // the system prompt
      "first question",
      "an answer",
      "and the follow-up?",
    ]);
  });

  it("names the destination on the reply, not just in Settings", async () => {
    render(<AiChat />);
    ask("hi");
    await screen.findByText("an answer");
    // Twice: the header badge says where prompts go, and the reply says where
    // this one came from. The second is the one that survives a settings change.
    expect(screen.getAllByText(/offline model on this machine/).length).toBe(2);
  });

  it("reports the failure instead of leaving a question unanswered", async () => {
    aiChat.mockRejectedValue(new Error("llama-server exited with code 1"));
    render(<AiChat />);
    ask("hi");
    expect(await screen.findByText(/exited with code 1/)).toBeTruthy();
  });

  it("will not send while no AI is switched on", () => {
    useAiStore.setState({ localEnabled: false, onlineEnabled: false });
    render(<AiChat />);
    expect(box().disabled).toBe(true);
    expect(screen.getByText(/Tick Local AI or Online AI/)).toBeTruthy();
  });

  it("clears the conversation on request", async () => {
    render(<AiChat />);
    ask("hi");
    await screen.findByText("an answer");
    fireEvent.click(screen.getByRole("button", { name: /Clear/ }));
    expect(screen.queryByText("an answer")).toBeNull();
  });
});
