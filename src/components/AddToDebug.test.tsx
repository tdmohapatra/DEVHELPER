import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AddToDebug } from "./AddToDebug";
import { useDebugStore } from "@/stores/useDebugStore";

beforeEach(() => useDebugStore.setState({ sessions: [], activeId: null }));

const event = () => ({ source: "redis" as const, status: "error" as const, title: "Redis unreachable" });

describe("AddToDebug", () => {
  it("creates a session when there is none, rather than dropping the capture", () => {
    render(<AddToDebug makeEvent={event} />);
    fireEvent.click(screen.getByRole("button"));

    const { sessions } = useDebugStore.getState();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].events[0].title).toBe("Redis unreachable");
  });

  it("adds to the active session when one exists", () => {
    const id = useDebugStore.getState().createSession("Incident");
    render(<AddToDebug makeEvent={event} />);
    fireEvent.click(screen.getByRole("button"));

    const { sessions } = useDebugStore.getState();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(id);
    expect(sessions[0].events).toHaveLength(1);
  });

  it("snapshots state at click time, not at render time", () => {
    // The whole reason makeEvent is a function: the tool's state changes
    // between rendering the button and pressing it.
    let title = "before";
    render(<AddToDebug makeEvent={() => ({ source: "redis", status: "ok", title })} />);
    title = "after";
    fireEvent.click(screen.getByRole("button"));

    expect(useDebugStore.getState().sessions[0].events[0].title).toBe("after");
  });

  it("stamps a timestamp on an event that carries none", () => {
    render(<AddToDebug makeEvent={event} />);
    fireEvent.click(screen.getByRole("button"));
    expect(useDebugStore.getState().sessions[0].events[0].at).toBeGreaterThan(0);
  });

  it("keeps a timestamp the event already has", () => {
    render(<AddToDebug makeEvent={() => ({ ...event(), at: 1234 })} />);
    fireEvent.click(screen.getByRole("button"));
    expect(useDebugStore.getState().sessions[0].events[0].at).toBe(1234);
  });

  it("uses the label it was given", () => {
    render(<AddToDebug makeEvent={event} label="Debug" />);
    expect(screen.getByRole("button")).toHaveTextContent("Debug");
  });
});
