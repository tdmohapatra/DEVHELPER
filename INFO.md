# DevHelper — Project Information

> **Your Everyday Developer Toolbox**

## What is DevHelper?

DevHelper is a small, fast, modern, **local-first** Windows desktop application that
bundles the little utilities developers reach for every day into one keyboard-driven
app. It is **not** a replacement for Visual Studio, VS Code, Postman, Docker Desktop,
Jira, or database GUIs — it fills the gap between them.

Core loop:

> Open DevHelper → `Ctrl + Space` → search → use the tool → copy/export → keep working.

The app is useful across many projects and technology stacks, not tied to any single
organization.

## Principles

| Principle       | What it means here                                                        |
| --------------- | ------------------------------------------------------------------------- |
| Local-first     | Core tools run entirely on your machine. Nothing is sent anywhere.        |
| Privacy-focused | JWTs, tokens, logs, and healthcare data stay local by default.            |
| Keyboard-first  | Global command palette; every tool reachable without the mouse.           |
| Modular         | One central Tool Registry; adding a tool is a single entry + component.    |
| Lightweight     | Tauri 2 (Rust + system webview) — small binary, low idle memory.          |
| AI optional     | The app is fully functional with zero AI configured.                      |

## Technology Stack

- **Shell:** Tauri 2 (Rust native layer, Windows `.exe`)
- **Frontend:** React 18 + TypeScript + Vite 6
- **Styling:** Tailwind CSS + shadcn/ui-style primitives + Lucide icons
- **State:** Zustand (with `localStorage` persistence)
- **Native commands:** Rust (`sysinfo`, `netstat`) for ports/processes
- **Storage (planned):** SQLite for collections/snippets/history; Windows DPAPI /
  Credential Manager for secrets
- **Tests:** Vitest + Testing Library

## Feature Categories (full product vision)

⚡ Quick Tools · 🧩 Data & Code · 🌐 API · 🔐 Security · 🏥 Healthcare Integration ·
🔌 Integration · 🧪 Testing · 🐳 DevOps · 🗄 Database · 📨 Messaging · 📊 Diagnostics ·
🤖 AI Assistant

The product is delivered in **phases** (see `STATUS.md`). Phase 1 focuses on the app
shell, command palette, tool registry, and a set of fully-working core tools.

## Two run modes

DevHelper runs in either mode from the same codebase:

1. **Desktop app (Tauri):** full feature set, including native tools like the Port
   Checker. Produces `DevHelper.exe`.
2. **Browser dev mode (`npm run dev`):** everything except native OS tools. Native
   tools show a clear "desktop only" notice instead of failing.

## Repository layout

```
DevHelper/
├── src/                  React + TypeScript frontend
│   ├── components/       UI primitives, layout, palette, shared widgets
│   ├── pages/            Dashboard, Favorites/Recent, Settings
│   ├── tools/            Tool registry + per-tool logic (lib/) and screens (impl/)
│   ├── stores/           Zustand app store
│   └── lib/              cross-cutting helpers (cn, clipboard, platform bridge)
├── src-tauri/            Rust native layer (commands, config, capabilities)
├── INFO.md               this file
├── STATUS.md             dated log of completed work
├── ARCHITECTURE.md       architecture decisions & design system
└── README.md            setup / build / run
```

## Security posture

- No network calls in core tools.
- Secrets are never logged; sensitive values masked in the UI.
- Destructive actions (e.g. killing a process) require explicit confirmation.
- Healthcare tools (Phase 3) are integration/developer utilities only — **no clinical
  advice**, and all processing is local by default.
