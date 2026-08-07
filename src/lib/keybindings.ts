/**
 * Which keys do what, and letting that be changed.
 *
 * The shortcuts were hardcoded: `Ctrl+Shift+<letter>` for a handful of tools
 * plus a few fixed app commands. That is fine until one of them collides with
 * something the OS, the browser or another tool has already taken — at which
 * point the binding is simply unavailable and there is nothing to be done about
 * it.
 *
 * This module is the whole model: a canonical string form for a key
 * combination, the list of actions that can be bound, conflict detection, and
 * the merge of user overrides onto defaults. Matching is done on `event.code`
 * where possible so a binding does not move when the keyboard layout does.
 */

import { TOOLS } from "@/tools/registry";

export type BindingAction =
  | { kind: "command"; id: AppCommandId }
  | { kind: "tool"; toolId: string };

/**
 * `paletteAlt` exists because the palette ships with two bindings.
 *
 * Two defaults sharing one action id would mean an override replaced both with
 * the same combination, which then reads as a conflict with itself. A second id
 * keeps the alias independently rebindable and independently removable.
 */
export type AppCommandId =
  | "palette"
  | "paletteAlt"
  | "sidebar"
  | "logs"
  | "theme"
  | "dashboard"
  | "settings";

export const APP_COMMANDS: { id: AppCommandId; label: string }[] = [
  { id: "palette", label: "Command palette" },
  { id: "paletteAlt", label: "Command palette (second binding)" },
  { id: "sidebar", label: "Show/hide sidebar" },
  { id: "logs", label: "Show/hide log dock" },
  { id: "theme", label: "Toggle theme" },
  { id: "dashboard", label: "Go to dashboard" },
  { id: "settings", label: "Open settings" },
];

/** A binding: one key combination, one thing it does. */
export interface Binding {
  /** Canonical combo string, e.g. "Ctrl+Shift+J". */
  combo: string;
  action: BindingAction;
}

/** Stable identity for an action, used as the override map's key. */
export function actionId(action: BindingAction): string {
  return action.kind === "command" ? `cmd:${action.id}` : `tool:${action.toolId}`;
}

/** Human label for an action, given a way to name a tool. */
export function actionLabel(action: BindingAction, toolName: (id: string) => string | undefined): string {
  if (action.kind === "command") {
    return APP_COMMANDS.find((c) => c.id === action.id)?.label ?? action.id;
  }
  return toolName(action.toolId) ?? action.toolId;
}

const MODIFIER_ORDER = ["Ctrl", "Alt", "Shift", "Meta"] as const;

/**
 * Canonical form of a combination.
 *
 * Modifiers always in the same order and the key upper-cased, so "shift+ctrl+j"
 * and "Ctrl+Shift+J" are recognised as the same binding rather than as two that
 * silently shadow each other.
 */
export function normalizeCombo(input: string): string {
  const parts = input
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return "";

  const mods = new Set<string>();
  let key = "";
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === "ctrl" || lower === "control") mods.add("Ctrl");
    else if (lower === "alt" || lower === "option") mods.add("Alt");
    else if (lower === "shift") mods.add("Shift");
    else if (lower === "meta" || lower === "cmd" || lower === "command" || lower === "win") mods.add("Meta");
    else key = part.length === 1 ? part.toUpperCase() : part;
  }
  if (!key) return "";
  return [...MODIFIER_ORDER.filter((m) => mods.has(m)), key].join("+");
}

/** The combination a keyboard event represents, in canonical form. */
export function comboFromEvent(e: {
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  key: string;
  code?: string;
}): string {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Meta");

  // Prefer the physical key: `event.key` for Ctrl+Shift+J on some layouts is
  // not "J", and a binding that moves with the layout is a binding that breaks.
  let key = "";
  const code = e.code ?? "";
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  else if (code === "Space") key = "Space";
  else if (code && /^(F\d{1,2}|Escape|Enter|Tab|Backspace|Delete|Home|End|PageUp|PageDown|Arrow(Up|Down|Left|Right))$/.test(code)) {
    key = code;
  } else if (e.key && e.key.length === 1) key = e.key.toUpperCase();
  else if (e.key) key = e.key;

  if (!key || ["Control", "Alt", "Shift", "Meta"].includes(key)) return "";
  return [...mods, key].join("+");
}

/** Is this a combination worth binding? */
export function comboProblem(combo: string): string | null {
  const normalized = normalizeCombo(combo);
  if (!normalized) return "Press a key combination.";
  const parts = normalized.split("+");
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  // Checked before the modifier rule so these get the specific reason rather
  // than the generic one, which would be true but unhelpful.
  if (["Tab", "Enter", "Escape"].includes(key) && mods.length === 0) {
    return `${key} is needed for navigation and cannot be bound on its own.`;
  }
  if (mods.length === 0 && !/^F\d{1,2}$/.test(key)) {
    // An unmodified letter would fire while typing into any field.
    return "Needs at least one modifier — an unmodified key would trigger while typing.";
  }
  return null;
}

/** User overrides: action id → combo. An empty string means "unbound". */
export type BindingOverrides = Record<string, string>;

/**
 * Merge overrides onto defaults.
 *
 * An override of "" removes the binding, which is different from having no
 * override at all — someone who deliberately unbound a key should not have it
 * come back on the next release that changes the default.
 */
export function resolveBindings(defaults: Binding[], overrides: BindingOverrides): Binding[] {
  const out: Binding[] = [];
  const seen = new Set<string>();

  for (const binding of defaults) {
    const id = actionId(binding.action);
    seen.add(id);
    const override = overrides[id];
    if (override === undefined) {
      out.push(binding);
    } else if (override !== "") {
      out.push({ combo: normalizeCombo(override), action: binding.action });
    }
    // override === "" → deliberately unbound
  }

  // Overrides can also bind an action that had no default.
  for (const [id, combo] of Object.entries(overrides)) {
    if (seen.has(id) || !combo) continue;
    const action: BindingAction | null = id.startsWith("cmd:")
      ? { kind: "command", id: id.slice(4) as AppCommandId }
      : id.startsWith("tool:")
        ? { kind: "tool", toolId: id.slice(5) }
        : null;
    if (action) out.push({ combo: normalizeCombo(combo), action });
  }

  return out;
}

export interface Conflict {
  combo: string;
  actions: BindingAction[];
}

/**
 * Combinations bound to more than one thing.
 *
 * Worth surfacing rather than resolving: which of two actions "wins" depends on
 * iteration order, and silently picking one is how a shortcut becomes something
 * that works on Tuesdays.
 */
export function findConflicts(bindings: Binding[]): Conflict[] {
  const byCombo = new Map<string, BindingAction[]>();
  for (const b of bindings) {
    if (!b.combo) continue;
    byCombo.set(b.combo, [...(byCombo.get(b.combo) ?? []), b.action]);
  }
  return [...byCombo.entries()]
    .filter(([, actions]) => actions.length > 1)
    .map(([combo, actions]) => ({ combo, actions }))
    .sort((a, b) => a.combo.localeCompare(b.combo));
}

/** Look up what a combination should do. First match wins; conflicts are reported separately. */
export function matchBinding(bindings: Binding[], combo: string): BindingAction | undefined {
  if (!combo) return undefined;
  return bindings.find((b) => b.combo === combo)?.action;
}

/**
 * Should a shortcut fire while this element has focus?
 *
 * Typing "b" into a search box must not toggle the sidebar. Combinations with a
 * non-Shift modifier are still allowed through — Ctrl+K from inside a text
 * field is the behaviour everyone expects.
 */
export function shouldIgnoreTarget(target: EventTarget | null, combo: string): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  const editable = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
  if (!editable) return false;
  const hasRealModifier = combo.startsWith("Ctrl+") || combo.startsWith("Alt+") || combo.startsWith("Meta+");
  return !hasRealModifier;
}

/** Display form, e.g. "Ctrl + Shift + J". */
export function formatCombo(combo: string): string {
  return combo.split("+").join(" + ");
}

/**
 * The shipped bindings: the app commands, plus every tool that declares a
 * shortcut in the registry.
 *
 * Lives here rather than in App so that Settings can read it without the two
 * importing each other — App renders Settings, so the other direction is a
 * cycle.
 */
export const DEFAULT_BINDINGS: Binding[] = [
  { combo: "Ctrl+K", action: { kind: "command", id: "palette" } },
  { combo: "Ctrl+Space", action: { kind: "command", id: "paletteAlt" } },
  { combo: "Ctrl+B", action: { kind: "command", id: "sidebar" } },
  { combo: "Ctrl+`", action: { kind: "command", id: "logs" } },
  ...TOOLS.filter((t) => t.shortcut).map((t): Binding => ({
    combo: normalizeCombo(t.shortcut!),
    action: { kind: "tool", toolId: t.id },
  })),
];
