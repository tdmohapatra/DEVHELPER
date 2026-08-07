import { describe, it, expect } from "vitest";
import {
  APP_COMMANDS,
  actionId,
  actionLabel,
  comboFromEvent,
  comboProblem,
  findConflicts,
  formatCombo,
  matchBinding,
  normalizeCombo,
  resolveBindings,
  shouldIgnoreTarget,
  type Binding,
} from "./keybindings";

const ev = (over: Partial<Parameters<typeof comboFromEvent>[0]>) => ({
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  key: "",
  ...over,
});

describe("normalizeCombo", () => {
  it("puts modifiers in a fixed order so one binding has one spelling", () => {
    expect(normalizeCombo("shift+ctrl+j")).toBe("Ctrl+Shift+J");
    expect(normalizeCombo("Ctrl+Shift+J")).toBe("Ctrl+Shift+J");
  });

  it("accepts the usual aliases", () => {
    expect(normalizeCombo("control+alt+k")).toBe("Ctrl+Alt+K");
    expect(normalizeCombo("cmd+k")).toBe("Meta+K");
    expect(normalizeCombo("option+k")).toBe("Alt+K");
  });

  it("keeps named keys as they are", () => {
    expect(normalizeCombo("ctrl+Space")).toBe("Ctrl+Space");
    expect(normalizeCombo("F5")).toBe("F5");
  });

  it("is empty when there is no key, only modifiers", () => {
    expect(normalizeCombo("Ctrl+Shift")).toBe("");
    expect(normalizeCombo("")).toBe("");
  });
});

describe("comboFromEvent", () => {
  it("prefers the physical key, so a binding does not move with the layout", () => {
    expect(comboFromEvent(ev({ ctrlKey: true, shiftKey: true, key: "¬", code: "KeyJ" }))).toBe("Ctrl+Shift+J");
  });

  it("falls back to the key when the code is not a letter or digit", () => {
    expect(comboFromEvent(ev({ ctrlKey: true, key: "/", code: "Slash" }))).toBe("Ctrl+/");
  });

  it("reads digits and Space", () => {
    expect(comboFromEvent(ev({ ctrlKey: true, key: "1", code: "Digit1" }))).toBe("Ctrl+1");
    expect(comboFromEvent(ev({ ctrlKey: true, key: " ", code: "Space" }))).toBe("Ctrl+Space");
  });

  it("reads function and navigation keys", () => {
    expect(comboFromEvent(ev({ key: "F5", code: "F5" }))).toBe("F5");
    expect(comboFromEvent(ev({ ctrlKey: true, key: "ArrowUp", code: "ArrowUp" }))).toBe("Ctrl+ArrowUp");
  });

  it("ignores a modifier pressed on its own", () => {
    expect(comboFromEvent(ev({ ctrlKey: true, key: "Control", code: "ControlLeft" }))).toBe("");
  });
});

describe("comboProblem", () => {
  it("requires a modifier, since a bare letter fires while typing", () => {
    expect(comboProblem("J")).toMatch(/modifier/);
  });

  it("allows a bare function key", () => {
    expect(comboProblem("F5")).toBeNull();
  });

  it("refuses navigation keys with no modifier", () => {
    expect(comboProblem("Tab")).toMatch(/navigation/);
  });

  it("asks for something when nothing was pressed", () => {
    expect(comboProblem("")).toMatch(/Press a key/);
  });

  it("accepts an ordinary shortcut", () => {
    expect(comboProblem("Ctrl+Shift+J")).toBeNull();
  });
});

describe("actionId / actionLabel", () => {
  it("gives commands and tools distinct ids", () => {
    expect(actionId({ kind: "command", id: "palette" })).toBe("cmd:palette");
    expect(actionId({ kind: "tool", toolId: "palette" })).toBe("tool:palette");
  });

  it("labels a command from the catalog and a tool from the lookup", () => {
    expect(actionLabel({ kind: "command", id: "palette" }, () => undefined)).toBe("Command palette");
    expect(actionLabel({ kind: "tool", toolId: "t1" }, () => "JSON Formatter")).toBe("JSON Formatter");
  });

  it("falls back to the id for a tool that no longer exists", () => {
    expect(actionLabel({ kind: "tool", toolId: "gone" }, () => undefined)).toBe("gone");
  });

  it("covers every app command", () => {
    for (const c of APP_COMMANDS) {
      expect(actionLabel({ kind: "command", id: c.id }, () => undefined)).toBe(c.label);
    }
  });
});

describe("resolveBindings", () => {
  const defaults: Binding[] = [
    { combo: "Ctrl+K", action: { kind: "command", id: "palette" } },
    { combo: "Ctrl+Shift+J", action: { kind: "tool", toolId: "json-formatter" } },
  ];

  it("returns the defaults when nothing is overridden", () => {
    expect(resolveBindings(defaults, [] as unknown as Record<string, string>)).toEqual(defaults);
  });

  it("replaces a default", () => {
    const out = resolveBindings(defaults, { "cmd:palette": "ctrl+p" });
    expect(out.find((b) => actionId(b.action) === "cmd:palette")!.combo).toBe("Ctrl+P");
  });

  it("treats an empty override as deliberately unbound, not as absent", () => {
    // The difference matters: an unbound key must not come back when a release
    // changes the default.
    const out = resolveBindings(defaults, { "cmd:palette": "" });
    expect(out.some((b) => actionId(b.action) === "cmd:palette")).toBe(false);
  });

  it("can bind an action that had no default", () => {
    const out = resolveBindings(defaults, { "tool:regex-tester": "ctrl+alt+r" });
    expect(out.find((b) => actionId(b.action) === "tool:regex-tester")!.combo).toBe("Ctrl+Alt+R");
  });

  it("normalises overridden combos", () => {
    expect(resolveBindings(defaults, { "cmd:palette": "shift+ctrl+p" })[0].combo).toBe("Ctrl+Shift+P");
  });

  it("ignores an override whose id is not an action", () => {
    expect(resolveBindings(defaults, { nonsense: "Ctrl+Q" })).toHaveLength(2);
  });
});

describe("findConflicts", () => {
  it("reports a combination bound to two things rather than picking one", () => {
    const conflicts = findConflicts([
      { combo: "Ctrl+K", action: { kind: "command", id: "palette" } },
      { combo: "Ctrl+K", action: { kind: "tool", toolId: "x" } },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].actions).toHaveLength(2);
  });

  it("is quiet when everything is distinct", () => {
    expect(findConflicts([
      { combo: "Ctrl+K", action: { kind: "command", id: "palette" } },
      { combo: "Ctrl+B", action: { kind: "command", id: "sidebar" } },
    ])).toEqual([]);
  });

  it("ignores unbound entries", () => {
    expect(findConflicts([
      { combo: "", action: { kind: "command", id: "palette" } },
      { combo: "", action: { kind: "command", id: "sidebar" } },
    ])).toEqual([]);
  });
});

describe("matchBinding", () => {
  const bindings: Binding[] = [{ combo: "Ctrl+K", action: { kind: "command", id: "palette" } }];

  it("finds the action for a combination", () => {
    expect(matchBinding(bindings, "Ctrl+K")).toEqual({ kind: "command", id: "palette" });
  });

  it("finds nothing for an unbound one, or for an empty combo", () => {
    expect(matchBinding(bindings, "Ctrl+Q")).toBeUndefined();
    expect(matchBinding(bindings, "")).toBeUndefined();
  });
});

describe("shouldIgnoreTarget", () => {
  const input = { tagName: "INPUT", isContentEditable: false } as unknown as EventTarget;
  const div = { tagName: "DIV", isContentEditable: false } as unknown as EventTarget;

  it("suppresses a Shift-only shortcut while typing", () => {
    expect(shouldIgnoreTarget(input, "Shift+J")).toBe(true);
  });

  it("lets Ctrl shortcuts through from a text field, which is what people expect", () => {
    expect(shouldIgnoreTarget(input, "Ctrl+K")).toBe(false);
    expect(shouldIgnoreTarget(input, "Alt+K")).toBe(false);
  });

  it("does not suppress anything outside an editable element", () => {
    expect(shouldIgnoreTarget(div, "Shift+J")).toBe(false);
  });

  it("copes with no target", () => {
    expect(shouldIgnoreTarget(null, "Shift+J")).toBe(false);
  });
});

describe("formatCombo", () => {
  it("spaces the parts out for display", () => {
    expect(formatCombo("Ctrl+Shift+J")).toBe("Ctrl + Shift + J");
  });
});
