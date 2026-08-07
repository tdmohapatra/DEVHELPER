import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProjectScope, ProjectMemberToggle } from "./ProjectScope";
import { useProjectStore } from "@/stores/useProjectStore";

const reset = (over: Partial<ReturnType<typeof useProjectStore.getState>> = {}) =>
  useProjectStore.setState({ profiles: [], activeId: null, scopeEnabled: false, ...over });

beforeEach(() => reset());

describe("ProjectScope", () => {
  it("renders nothing when no project is active", () => {
    const { container } = render(<ProjectScope kind="connections" ids={["a", "b"]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the toggle provably cannot change what is on screen", () => {
    // Active project, but nothing anywhere is claimed: every id is unfiled and
    // would stay visible either way.
    reset({ profiles: [{ id: "p1", name: "Billing", technologies: [], notes: "" }], activeId: "p1" });
    const { container } = render(<ProjectScope kind="connections" ids={["a", "b"]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers to scope once the project claims something", () => {
    reset({
      profiles: [{ id: "p1", name: "Billing", technologies: [], notes: "", members: { connections: ["a"] } }],
      activeId: "p1",
    });
    render(<ProjectScope kind="connections" ids={["a", "b"]} />);
    expect(screen.getByRole("button", { name: /Scope to Billing/ })).toBeInTheDocument();
  });

  it("says how the list breaks down before scoping is on", () => {
    reset({
      profiles: [
        { id: "p1", name: "Billing", technologies: [], notes: "", members: { connections: ["a"] } },
        { id: "p2", name: "Orders", technologies: [], notes: "", members: { connections: ["b"] } },
      ],
      activeId: "p1",
    });
    render(<ProjectScope kind="connections" ids={["a", "b", "c"]} />);
    expect(screen.getByText(/1 belong to Billing, 1 to other projects, 1 unfiled/)).toBeInTheDocument();
  });

  it("turns scoping on and says what it hid, so it is not forgotten", () => {
    reset({
      profiles: [
        { id: "p1", name: "Billing", technologies: [], notes: "", members: { connections: ["a"] } },
        { id: "p2", name: "Orders", technologies: [], notes: "", members: { connections: ["b"] } },
      ],
      activeId: "p1",
    });
    render(<ProjectScope kind="connections" ids={["a", "b", "c"]} />);
    fireEvent.click(screen.getByRole("button", { name: /Scope to Billing/ }));

    expect(useProjectStore.getState().scopeEnabled).toBe(true);
    expect(screen.getByText(/1 hidden/)).toBeInTheDocument();
    expect(screen.getByText(/1 unfiled item\(s\) stay visible/)).toBeInTheDocument();
  });
});

describe("ProjectMemberToggle", () => {
  beforeEach(() =>
    reset({ profiles: [{ id: "p1", name: "Billing", technologies: [], notes: "" }], activeId: "p1" }),
  );

  it("claims an item for the active project", () => {
    render(<ProjectMemberToggle kind="snippets" id="s1" />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(useProjectStore.getState().profiles[0].members?.snippets).toEqual(["s1"]);
  });

  it("releases it again", () => {
    render(<ProjectMemberToggle kind="snippets" id="s1" />);
    const box = screen.getByRole("checkbox");
    fireEvent.click(box);
    fireEvent.click(box);
    expect(useProjectStore.getState().profiles[0].members?.snippets).toBeUndefined();
  });

  it("renders nothing without an active project", () => {
    reset();
    const { container } = render(<ProjectMemberToggle kind="snippets" id="s1" />);
    expect(container).toBeEmptyDOMElement();
  });
});
