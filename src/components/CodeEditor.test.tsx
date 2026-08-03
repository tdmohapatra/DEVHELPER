import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CodeEditor } from "./CodeEditor";

// Monaco needs real layout APIs that jsdom does not provide, so it can never load
// here. That makes this the exact scenario the fallback exists for: the editor
// must stay usable when the Monaco chunk fails.
vi.mock("./MonacoEditor", () => {
  throw new Error("monaco unavailable");
});

describe("CodeEditor fallback", () => {
  // React reports the caught boundary error on console.error; that is the
  // expected path here, so keep it out of the test output.
  const consoleError = vi.spyOn(console, "error");
  beforeAll(() => consoleError.mockImplementation(() => {}));
  afterAll(() => consoleError.mockRestore());

  it("falls back to an editable textarea when Monaco cannot load", async () => {
    const onChange = vi.fn();
    render(<CodeEditor value="SELECT 1" onChange={onChange} language="sql" ariaLabel="SQL query editor" />);

    const box = await waitFor(() => screen.getByLabelText("SQL query editor"));
    expect(box).toHaveValue("SELECT 1");

    fireEvent.change(box, { target: { value: "SELECT 2" } });
    expect(onChange).toHaveBeenCalledWith("SELECT 2");
  });

  it("keeps the placeholder and readOnly contract in the fallback", async () => {
    render(
      <CodeEditor
        value=""
        onChange={() => {}}
        language="sql"
        placeholder="Write SQL…"
        readOnly
        ariaLabel="SQL query editor"
      />,
    );
    const box = await waitFor(() => screen.getByPlaceholderText("Write SQL…"));
    expect(box).toHaveAttribute("readonly");
  });
});
