# Contributing to DevHelper

## Adding a new tool

DevHelper is registry-driven. To add a tool:

1. **Logic first (if any):** put pure, side-effect-free functions in
   `src/tools/lib/<name>.ts` and write a matching `<name>.test.ts`.
2. **Screen:** create `src/tools/impl/<Name>.tsx`. Wrap the UI in `<ToolShell>` for a
   consistent header, favorite star, and scroll area.
3. **Register:** add one entry to `TOOLS` in `src/tools/registry.ts` with
   `id, name, description, category, icon, keywords, route, component` (and
   `shortcut` / `requiresNative` if relevant).

That's it — the sidebar, dashboard, command palette, and router pick it up
automatically. Do **not** hardcode navigation anywhere else.

## Native (Rust) commands

Add commands under `src-tauri/src/commands/`, register them in `lib.rs`
`invoke_handler!`, and add any required permission to
`src-tauri/capabilities/default.json`. Call them from the frontend via
`invokeNative()` in `src/lib/platform.ts` so browser mode degrades gracefully.

## Conventions

- TypeScript strict mode; no `any` unless justified.
- Keep tools local-first. No network calls in core tools. Never log secrets.
- Destructive actions require explicit user confirmation.
- Match the surrounding code style; keep components small and reusable.

## Checks before pushing

```powershell
npm run typecheck
npm test
npm run build
```
