import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ToolShell } from "./ToolShell";
import { BUILT_IN_QUESTIONS, questionsForTool } from "@/tools/lib/learn";

/**
 * The tool-to-theory link, tested through ToolShell because that is where every
 * tool gets it. The catalogue knows which tools a card can be practised in; the
 * shell asks, and offers what it finds.
 */
describe("Concepts in ToolShell", () => {
  const shell = (toolId: string) =>
    render(
      <ToolShell toolId={toolId} title="Test" description="A tool">
        <p>tool body</p>
      </ToolShell>,
    );

  it("offers the concepts for a tool that has them", () => {
    shell("device-link");
    expect(screen.getByRole("button", { name: "Concepts behind this tool" })).toBeInTheDocument();
  });

  it("offers nothing for a tool the catalogue does not mention", () => {
    shell("guid-generator");
    expect(screen.queryByRole("button", { name: "Concepts behind this tool" })).toBeNull();
  });

  it("stays closed until asked — it is not a banner", () => {
    shell("device-link");
    expect(screen.queryByText(/Concepts behind this tool/)).toBeNull();
    expect(screen.getByText("tool body")).toBeInTheDocument();
  });

  it("shows the cards for that tool, and only those", () => {
    shell("device-link");
    fireEvent.click(screen.getByRole("button", { name: "Concepts behind this tool" }));

    const mine = questionsForTool(BUILT_IN_QUESTIONS, "device-link");
    expect(mine.length).toBeGreaterThan(5);
    expect(screen.getByText(mine[0].question)).toBeInTheDocument();

    const other = BUILT_IN_QUESTIONS.find((q) => !q.relatedTools?.includes("device-link") && q.topic === "csharp")!;
    expect(screen.queryByText(other.question)).toBeNull();
  });

  it("expands the first card so there is something to read immediately", () => {
    shell("hl7-toolkit");
    fireEvent.click(screen.getByRole("button", { name: "Concepts behind this tool" }));
    const first = questionsForTool(BUILT_IN_QUESTIONS, "hl7-toolkit")[0];
    expect(screen.getByText(first.question)).toBeInTheDocument();

    // The answer body is rendered too, not only the heading. Markdown strips
    // its own punctuation, so match on a long word rather than a raw slice.
    const word = first.answer
      .replace(/[*`#\[\]()]/g, " ")
      .split(/\s+/)
      .filter((w) => /^[A-Za-z]{9,}$/.test(w))[0];
    expect(word, "the card should contain a long plain word to match on").toBeTruthy();
    expect(document.body.textContent).toContain(word);
  });

  it("closes again from inside the panel", () => {
    shell("device-link");
    fireEvent.click(screen.getByRole("button", { name: "Concepts behind this tool" }));
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByRole("button", { name: "Hide" })).toBeNull();
  });
});
