# DevHelper — Architecture

This document is the up-front architecture analysis required before coding, and the
living reference for how DevHelper is built.

---

## 1. Architecture Decision

**Tauri 2** — chosen over Electron for a small binary and low idle memory. It uses the
OS WebView2 (no bundled Chromium) and a Rust backend, which fits a "small, fast,
local-first" tool that a developer keeps running all day.

**React + TypeScript + Vite** — mainstream, fast HMR, strong typing for a tool registry
and many self-contained tool screens. Vite 6 gives instant dev startup.

**Rust (native layer)** — used **only** where the web layer cannot go: TCP port
inspection, process management, file/OS access, global shortcuts, tray. Business logic
lives in TypeScript; Rust is a thin command surface exposed via `invoke`. A
`platform.ts` bridge throws `NativeUnavailableError` in browser mode so the UI degrades
gracefully instead of crashing.

**SQLite (planned, Phase 2)** — structured local persistence for API collections,
environments, snippets, and history. Phase 1 uses `localStorage` (via Zustand persist)
for settings/favorites/recents, which is sufficient and dependency-free.

**AI (planned, Phase 5)** — an abstraction with pluggable providers (Ollama,
OpenAI-compatible). AI is strictly opt-in; the UI must show when data leaves the
machine. Nothing in Phase 1 makes network calls.

---

## 2. MVP Scope (Phase 1) — implemented

App shell + sidebar + header · command palette (`Ctrl+K` / `Ctrl+Space`) · tool
registry · favorites · recent · dark/light themes · and these tools:
JSON Formatter · JSON Validator (inline) · JSON Diff · JSON → C# · JWT Decoder ·
GUID Generator · Unix Timestamp Converter · Base64 · URL Encode/Decode · Regex Tester ·
Port Checker (native).

---

## 3. Project Structure

```
DevHelper/
├── src/
│   ├── components/
│   │   ├── ui/           button, input, textarea, card, badge, toast
│   │   ├── layout/       Sidebar, Header
│   │   ├── CommandPalette.tsx
│   │   ├── ToolShell.tsx   consistent tool header + body
│   │   ├── ToolCard.tsx
│   │   └── CopyButton.tsx
│   ├── pages/            Dashboard, ToolList (favorites/recent), Settings
│   ├── tools/
│   │   ├── types.ts       Tool + Category types
│   │   ├── registry.ts    single source of truth for all tools
│   │   ├── categoryIcons.ts
│   │   ├── lib/           pure, tested logic (json, jwt, time, encoding, guid)
│   │   └── impl/          one React screen per tool
│   ├── stores/           useAppStore (theme, favorites, recent, view)
│   ├── lib/              utils (cn, clipboard), platform (Tauri bridge)
│   └── test/             vitest setup
└── src-tauri/
    ├── src/
    │   ├── main.rs, lib.rs
    │   └── commands/     ports.rs, system.rs
    ├── capabilities/     default.json (permission scopes)
    ├── Cargo.toml, build.rs, tauri.conf.json
```

Modules are loosely coupled; navigation is data-driven from the registry, never
hardcoded.

---

## 4. UI Design System

- **Colors:** HSL CSS variables in `index.css`, dark-first. Semantic tokens —
  `background/foreground/card/primary/secondary/muted/accent/destructive/success/warning/border/input/ring`.
  Primary is indigo (`244 76% 59%`); success green; warning amber; destructive red.
- **Typography:** Inter/Segoe UI for UI text; JetBrains Mono/Cascadia/Consolas for code.
- **Spacing:** Tailwind scale; 4/6px rhythm; tool bodies padded `p-6`.
- **Borders / Radius:** `--radius: 0.625rem`; subtle 1px borders using `--border`.
- **Icons:** Lucide, `size-4` default.
- **Components:** shadcn/ui-style primitives (CVA variants) kept minimal and inlined.
- **Motion:** `fade-in` / `slide-up` only, ~150ms. No decorative animation.
- **Themes:** `.dark` class on `<html>`, toggled by the store and persisted.

---

## 5. Data Model (Phase 1)

Persisted via `localStorage` key `devhelper-app`:

```ts
{
  theme:     "dark" | "light",
  favorites: string[],   // tool ids
  recent:    string[],   // tool ids, most-recent first, capped at 12
}
```

Planned SQLite tables (Phase 2+): `settings`, `favorites`, `recent_tools`,
`api_collections`, `api_requests`, `environments`, `snippets`, `project_profiles`,
`tool_history`.

---

## 6. Tool Registry

`src/tools/registry.ts` holds a `TOOLS: Tool[]` array. Each entry is metadata
(`id, name, description, category, icon, keywords, route, shortcut, requiresNative`)
plus the tool's React `component`. The sidebar, dashboard, command palette, and the
router in `App.tsx` all derive from this array. **Adding a tool = one registry entry +
one component.** Helpers: `getTool`, `toolsByCategory`, `searchTools`.

---

## 7. Command Palette

`searchTools(query)` scores tools by matching every query term against
`name + description + keywords`. With an empty query it surfaces recents and favorites
first. The palette also supports **direct actions** (e.g. "generate guid" copies a GUID
immediately) — an extensible pattern for future action verbs. Keyboard: ↑/↓ to move,
Enter to run, Esc to close.

---

## 8. Security Model

- **Secrets:** never logged; sensitive values masked. Credential storage (Phase 2+) via
  Windows DPAPI / Credential Manager, never plaintext.
- **JWT:** decoded locally only; signature not verified in Phase 1 (clearly labeled);
  never transmitted.
- **Healthcare (Phase 3):** integration/developer utilities only, no clinical advice;
  local-first, no external transmission without explicit consent.
- **AI (Phase 5):** opt-in; explicit indication whenever data is sent to a provider.
- **Destructive actions:** two-step confirmation (e.g. kill process); production
  environment warnings before dangerous operations (Phase 2).

---

## 9. Testing Strategy

- **Unit (Vitest):** pure logic in `tools/lib` — json, jwt, time, encoding, guid.
  Covers valid/invalid/edge inputs.
- **Component (Testing Library, jsdom):** tool screens (incremental).
- **Integration:** native commands via Tauri (incremental, Phase 2+).
- **E2E:** WebDriver/Tauri driver for critical flows (later).

---

## 10. Implementation Plan

1. ✅ Scaffold config, Tauri shell, Tailwind design tokens.
2. ✅ Store, tool registry, layout (sidebar/header), command palette, theming.
3. ✅ Core tool logic libs + unit tests.
4. ✅ Tool screens (JSON suite, JWT, GUID, timestamp, base64, URL, regex, port).
5. ✅ Dashboard, favorites/recent, settings, docs.
6. ⏭ Phase 2: API tester, collections, environments, SQLite, code generators.

See `STATUS.md` for the dated record.
