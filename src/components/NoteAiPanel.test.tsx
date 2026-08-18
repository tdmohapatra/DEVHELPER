import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const aiChat = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai")>()),
  aiChat,
}));

import { NoteAiPanel } from "./NoteAiPanel";
import { useAiStore } from "@/stores/useAiStore";
import { usePhiStore } from "@/stores/usePhiStore";

/**
 * The guarantee worth testing on this screen is restraint: nothing reaches the
 * note until the user says so, and a read-only answer offers no way to.
 */
describe("NoteAiPanel", () => {
  const onBody = vi.fn();
  const onMeta = vi.fn();
  const note = { title: "Queue migration", body: "Move the queue first. Then the DB." };

  const panel = (props: Partial<Parameters<typeof NoteAiPanel>[0]> = {}) =>
    render(<NoteAiPanel title={note.title} body={note.body} onBody={onBody} onMeta={onMeta} {...props} />);

  beforeEach(() => {
    aiChat.mockReset();
    aiChat.mockResolvedValue("- moved the queue\n- then the DB");
    onBody.mockReset();
    onMeta.mockReset();
    usePhiStore.setState({ policy: "redact", trustLocal: true, log: [] });
    useAiStore.setState({
      provider: "local", localEnabled: true, onlineEnabled: false, localKind: "local",
      localModelPath: "C:/hub/m.gguf", localModelLabel: "m", localPort: 8081, localRunning: true,
    });
  });

  it("does not touch the note until Apply is pressed", async () => {
    panel();
    fireEvent.click(screen.getByRole("button", { name: /Summarise/ }));
    expect(await screen.findByText(/moved the queue/)).toBeTruthy();
    expect(onBody).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Apply/ }));
    expect(onBody).toHaveBeenCalledTimes(1);
    // Appended under its heading, with the original text intact.
    const next = onBody.mock.calls[0][0] as string;
    expect(next.startsWith(note.body)).toBe(true);
    expect(next).toContain("## Summary");
  });

  it("discards without touching the note", async () => {
    panel();
    fireEvent.click(screen.getByRole("button", { name: /Summarise/ }));
    await screen.findByText(/moved the queue/);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onBody).not.toHaveBeenCalled();
    expect(screen.queryByText(/moved the queue/)).toBeNull();
  });

  it("offers no Apply for an answer that is only to be read", async () => {
    aiChat.mockResolvedValue("## What this is about\nA migration.");
    panel();
    fireEvent.click(screen.getByRole("button", { name: /Analyse/ }));
    await screen.findByText(/A migration/);
    expect(screen.queryByRole("button", { name: /Apply/ })).toBeNull();
    expect(screen.getByText(/for reading/)).toBeTruthy();
  });

  it("sends only the selection, and says which part it is working on", async () => {
    panel({ selection: { start: 0, end: 21 } });
    expect(screen.getByText(/selection · 21 chars/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Summarise/ }));
    await screen.findByText(/moved the queue/);
    const sent = aiChat.mock.calls[0][0] as { content: string }[];
    expect(sent[1].content).toContain("Move the queue first.");
    expect(sent[1].content).not.toContain("Then the DB.");
  });

  it("hands a title and tags to the note rather than editing its text", async () => {
    aiChat.mockResolvedValue("Title: Queue migration plan\nTags: #azure #service-bus");
    panel();
    fireEvent.click(screen.getByRole("button", { name: /Title & tags/ }));
    await screen.findByText(/Queue migration plan/);
    fireEvent.click(screen.getByRole("button", { name: /Use these/ }));
    expect(onMeta).toHaveBeenCalledWith({ title: "Queue migration plan", tags: ["azure", "service-bus"] });
    expect(onBody).not.toHaveBeenCalled();
  });

  it("reports a failure instead of pretending it worked", async () => {
    aiChat.mockRejectedValue(new Error("llama-server stopped"));
    panel();
    fireEvent.click(screen.getByRole("button", { name: /Improve writing/ }));
    expect(await screen.findByText(/llama-server stopped/)).toBeTruthy();
    expect(onBody).not.toHaveBeenCalled();
  });

  it("is disabled with nothing to work on, and when no AI is switched on", () => {
    const { unmount } = panel({ body: "   " });
    expect((screen.getByRole("button", { name: /Summarise/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/nothing in this note/)).toBeTruthy();
    unmount();

    useAiStore.setState({ localEnabled: false, onlineEnabled: false });
    panel();
    expect((screen.getByRole("button", { name: /Summarise/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Tick Local AI or Online AI/)).toBeTruthy();
  });
});
