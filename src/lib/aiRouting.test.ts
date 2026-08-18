import { describe, expect, it } from "vitest";
import { aiEnabled, notReadyReason, resolveProvider, routingNote, switchesForProvider, type AiSwitches } from "./aiRouting";

const sw = (p: Partial<AiSwitches> = {}): AiSwitches => ({
  localEnabled: false,
  onlineEnabled: false,
  localKind: "local",
  ...p,
});

describe("resolveProvider", () => {
  it("routes to the offline model when Local AI is on", () => {
    expect(resolveProvider(sw({ localEnabled: true }))).toBe("local");
  });

  it("routes to Ollama when that is the kind of local chosen", () => {
    expect(resolveProvider(sw({ localEnabled: true, localKind: "ollama" }))).toBe("ollama");
  });

  it("routes online only when Local AI is off", () => {
    expect(resolveProvider(sw({ onlineEnabled: true }))).toBe("openai");
  });

  it("prefers local when both are on, and never falls back", () => {
    // The whole point of the offline provider is that a prompt stays here. A
    // fallback would undo that quietly, which is worse than an error.
    expect(resolveProvider(sw({ localEnabled: true, onlineEnabled: true }))).toBe("local");
  });

  it("is null when both are off", () => {
    expect(resolveProvider(sw())).toBeNull();
  });
});

describe("aiEnabled", () => {
  it("is true if either switch is on", () => {
    expect(aiEnabled(sw({ localEnabled: true }))).toBe(true);
    expect(aiEnabled(sw({ onlineEnabled: true }))).toBe(true);
    expect(aiEnabled(sw())).toBe(false);
  });
});

describe("routingNote", () => {
  it("says AI is off without implying anything is broken", () => {
    expect(routingNote(sw())).toContain("works");
  });

  it("says the online API is idle when both are on", () => {
    const note = routingNote(sw({ localEnabled: true, onlineEnabled: true }));
    expect(note).toContain("unused");
    expect(note).toContain("nothing falls back");
  });

  it("names Ollama rather than the offline model when that is the local kind", () => {
    expect(routingNote(sw({ localEnabled: true, localKind: "ollama" }))).toContain("Ollama");
  });

  it("promises nothing leaves the machine only for the offline model", () => {
    expect(routingNote(sw({ localEnabled: true }))).toContain("leaves this machine");
    expect(routingNote(sw({ onlineEnabled: true }))).toContain("over the internet");
  });
});

describe("notReadyReason", () => {
  it("asks for a switch only when both are off", () => {
    expect(notReadyReason(sw(), null)).toContain("switched off");
  });

  it("names the missing thing, not the state", () => {
    // The bug this replaced: a banner that said prompts were going to the
    // offline model and, in the same sentence, asked for an AI to be switched on.
    expect(notReadyReason(sw({ localEnabled: true }), "local")).toContain("press Start");
    expect(notReadyReason(sw({ localEnabled: true, localKind: "ollama" }), "ollama")).toContain("server URL");
    expect(notReadyReason(sw({ onlineEnabled: true }), "openai")).toContain("API key");
  });

  it("never asks to switch something on that is already on", () => {
    expect(notReadyReason(sw({ localEnabled: true }), "local")).not.toContain("Tick");
  });
});

describe("switchesForProvider", () => {
  it("carries a saved provider onto the switches, so an upgrade changes nothing", () => {
    expect(switchesForProvider("openai")).toEqual({ localEnabled: false, onlineEnabled: true, localKind: "local" });
    expect(switchesForProvider("ollama")).toEqual({ localEnabled: true, onlineEnabled: false, localKind: "ollama" });
    expect(switchesForProvider("local")).toEqual({ localEnabled: true, onlineEnabled: false, localKind: "local" });
  });
});
