import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CommandPalette } from "./CommandPalette";
import { useApiStore } from "@/stores/useApiStore";
import { useDbStore } from "@/stores/useDbStore";
import { useSnippetStore } from "@/stores/useSnippetStore";
import { useDebugStore } from "@/stores/useDebugStore";
import { useProjectStore } from "@/stores/useProjectStore";
import { useAppStore } from "@/stores/useAppStore";
import { useHandoffStore } from "@/stores/useHandoffStore";
import { emptyRequest } from "@/tools/lib/apiTypes";

function seed() {
  useApiStore.setState({
    requests: { r1: { ...emptyRequest("r1"), name: "Create order", method: "POST", url: "https://api.dev/orders" } },
    environments: [{ id: "e1", name: "Staging", isProduction: false, variables: [] }],
    folders: [],
    activeEnvId: null,
  });
  useDbStore.setState({
    connections: [{ id: "c1", name: "prod-readonly", engine: "postgres", host: "db01", database: "sales", safeMode: true }],
    activeId: null,
  });
  useSnippetStore.setState({
    snippets: [{ id: "s1", title: "Kill port", language: "PowerShell", code: "", tags: ["windows"], favorite: false, updatedAt: 0 }],
  });
  useDebugStore.setState({ sessions: [{ id: "d1", name: "Checkout failure", createdAt: 0, events: [] }], activeId: null });
  useProjectStore.setState({ profiles: [], activeId: null, scopeEnabled: false });
  useAppStore.setState({ favorites: [], recent: [] });
  useHandoffStore.setState({ pending: {} });
}

const type = (value: string) => fireEvent.change(screen.getByLabelText(/Search tools/), { target: { value } });

/**
 * Find a result row by the text it renders.
 *
 * The visible label is split into per-character spans by the fuzzy-match
 * highlighting, so neither a plain text query nor the computed accessible name
 * matches reliably. The row's own textContent does.
 */
const rows = () => [...document.querySelectorAll<HTMLElement>("li button")];
const findRow = (pattern: RegExp) => rows().find((b) => pattern.test(b.textContent ?? ""));
const row = (pattern: RegExp): HTMLElement => {
  const found = findRow(pattern);
  if (!found) throw new Error(`No palette row matching ${pattern}. Rows: ${rows().map((r) => r.textContent).join(" | ")}`);
  return found;
};

beforeEach(seed);

describe("CommandPalette", () => {
  it("shows nothing when closed", () => {
    const { container } = render(<CommandPalette open={false} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("opens on the tools, not on a dump of everything you own", () => {
    render(<CommandPalette open onClose={() => {}} />);
    // No query: saved artefacts are searched, never listed.
    expect(findRow(/Create order/)).toBeUndefined();
    expect(row(/Go to Dashboard/)).toBeInTheDocument();
  });

  it("finds a saved request by name", () => {
    render(<CommandPalette open onClose={() => {}} />);
    type("Create order");
    expect(row(/Create order/)).toHaveTextContent("POST https://api.dev/orders");
  });

  it("labels what kind of thing each result is", () => {
    render(<CommandPalette open onClose={() => {}} />);
    type("prod-readonly");
    expect(row(/prod-readonly/)).toHaveTextContent("Connection");
  });

  it("finds a snippet by its tag", () => {
    render(<CommandPalette open onClose={() => {}} />);
    type("windows");
    expect(row(/Kill port/)).toBeInTheDocument();
  });

  it("finds a debug session", () => {
    render(<CommandPalette open onClose={() => {}} />);
    type("Checkout");
    expect(row(/Checkout failure/)).toBeInTheDocument();
  });

  it("opening a connection selects it and navigates to its tool", () => {
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} />);
    type("prod-readonly");
    fireEvent.click(row(/prod-readonly/));

    expect(useDbStore.getState().activeId).toBe("c1");
    expect(useAppStore.getState().view).toEqual({ kind: "tool", toolId: "database-toolkit" });
    expect(onClose).toHaveBeenCalled();
  });

  it("opening an environment makes it the active one", () => {
    render(<CommandPalette open onClose={() => {}} />);
    type("Staging");
    fireEvent.click(row(/Staging/));
    expect(useApiStore.getState().activeEnvId).toBe("e1");
  });

  it("opening a request hands the id to the API Tester, which has no active concept", () => {
    render(<CommandPalette open onClose={() => {}} />);
    type("Create order");
    fireEvent.click(row(/Create order/));

    expect(useHandoffStore.getState().pending["api-tester"]?.fields.selectId).toBe("r1");
    expect(useAppStore.getState().view).toEqual({ kind: "tool", toolId: "api-tester" });
  });

  it("still finds tools", () => {
    render(<CommandPalette open onClose={() => {}} />);
    type("JSON Formatter");
    expect(row(/JSON Formatter/)).toBeInTheDocument();
  });

  it("says so when nothing matches", () => {
    render(<CommandPalette open onClose={() => {}} />);
    type("zzzzqqqq");
    expect(screen.getByText(/No results for/)).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
