import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { Notes } from "./Notes";
import { useNotesStore } from "@/stores/useNotesStore";

/**
 * The Notes screen, driven the way a person drives it.
 *
 * The libraries under tools/lib are tested on their own; what this guards is
 * the wiring between them — that what you type reaches the preview, that the
 * preview's checkbox edits the source, and that the panels read the note that
 * is actually open.
 */
describe("Notes", () => {
  const body = () => screen.getAllByRole("textbox").find((el) => el.tagName === "TEXTAREA") as HTMLTextAreaElement;
  const type = (text: string) => fireEvent.change(body(), { target: { value: text } });

  /** Autosave is debounced; this is the wait that lets it land. */
  const settle = () => act(() => { vi.advanceTimersByTime(1000); });

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    useNotesStore.setState({ notes: [], revisions: {} });
  });
  afterEach(() => vi.useRealTimers());

  it("says what a note is made of before there is one", () => {
    render(<Notes />);
    expect(screen.getByText(/No notes yet/)).toBeInTheDocument();
    expect(screen.getByText(/Pick a note, or start a new one/)).toBeInTheDocument();
  });

  it("starts a note from a template with its body and tag already filled in", () => {
    render(<Notes />);
    fireEvent.click(screen.getByText("Bug report"));
    expect(body().value).toContain("## What happens");
    settle();
    expect(useNotesStore.getState().notes[0].tags).toEqual(["bug"]);
  });

  it("renders what you type, tasks and tables included", () => {
    render(<Notes />);
    fireEvent.click(screen.getByText("Daily log"));
    type("## Today\n\n- [ ] ship it\n\n| a | b |\n| --- | --- |\n| 1 | 2 |");
    // Twice over: once in the preview, once in the outline rail.
    expect(screen.getAllByText("Today")).toHaveLength(2);
    expect(screen.getByRole("checkbox", { name: "ship it" })).not.toBeChecked();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("ticking a box in the preview edits the line it came from", () => {
    render(<Notes />);
    fireEvent.click(screen.getByText("Daily log"));
    type("- [ ] ship it");
    fireEvent.click(screen.getByRole("checkbox", { name: "ship it" }));
    expect(body().value).toBe("- [x] ship it");
    settle();
    expect(useNotesStore.getState().notes[0].body).toBe("- [x] ship it");
  });

  it("reads tags, outline and dangling links out of the text as you type", () => {
    render(<Notes />);
    fireEvent.click(screen.getByText("Daily log"));
    type("# Heading\n\n#redis note about [[Something Else]]");
    expect(screen.getByTitle("Jump to Heading")).toBeInTheDocument();
    expect(screen.getByText("redis")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Something Else" })).toBeInTheDocument();
  });

  it("following a link that has no note creates it", () => {
    render(<Notes />);
    fireEvent.click(screen.getByText("Daily log"));
    type("see [[Release plan]]");
    fireEvent.click(screen.getByRole("button", { name: "+ Release plan" }));
    settle();
    expect(useNotesStore.getState().notes.map((n) => n.title)).toContain("Release plan");
  });

  it("shows a backlink on the note that was linked to", () => {
    render(<Notes />);
    fireEvent.click(screen.getByText("Daily log"));
    type("see [[Target]]");
    settle();
    fireEvent.click(screen.getByRole("button", { name: "+ Target" }));
    settle();
    expect(screen.getByText(/Backlinks \(1\)/)).toBeInTheDocument();
  });

  it("searches with the filter grammar, not just words", () => {
    render(<Notes />);
    fireEvent.click(screen.getByText("Daily log"));
    type("#redis only");
    settle();
    const search = screen.getByPlaceholderText(/Search/);

    fireEvent.change(search, { target: { value: "tag:redis" } });
    expect(screen.getAllByText(/Untitled|#redis/).length).toBeGreaterThan(0);

    fireEvent.change(search, { target: { value: "tag:nothing-has-this" } });
    expect(screen.getByText(/Nothing matches that search/)).toBeInTheDocument();
  });

  it("keeps the previous text as a revision once the note changes again", () => {
    render(<Notes />);
    fireEvent.click(screen.getByText("Daily log"));
    type("first");
    settle();
    type("second");
    settle();
    const id = useNotesStore.getState().notes[0].id;
    expect(useNotesStore.getState().revisions[id].length).toBeGreaterThan(0);
  });
});
