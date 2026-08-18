# DevHelper

> Your Everyday Developer Toolbox — a fast, local-first Windows developer utility app.

DevHelper bundles the small utilities developers use every day (JSON tools, JWT
decoding, GUID/timestamp/Base64/URL helpers, regex testing, port checking, and more)
into one keyboard-driven desktop app built with **Tauri 2 + React + TypeScript**.

See [`INFO.md`](./INFO.md) for the product overview, [`ARCHITECTURE.md`](./ARCHITECTURE.md)
for design decisions, [`STATUS.md`](./STATUS.md) for a dated log of completed work, and
[`docs/OFFLINE_AI.md`](./docs/OFFLINE_AI.md) for running a language model on your own machine.

---

## Prerequisites

| Requirement | Version | Needed for |
| ----------- | ------- | ---------- |
| Node.js     | ≥ 18 (tested on 25) | Frontend + build |
| npm         | ≥ 9     | Package management |
| Rust        | ≥ 1.77 (via [rustup](https://rustup.rs)) | **Desktop app / `.exe` build only** |
| Microsoft C++ Build Tools + WebView2 | latest | Tauri Windows build |

> **Note:** The frontend runs in the browser **without Rust**. Rust is only required to
> run the Tauri desktop shell and to produce `DevHelper.exe`.

### Installing Rust (for the desktop build)

```powershell
# Download & run rustup from https://rustup.rs, then verify:
rustc --version
cargo --version
```

---

## Development setup

```powershell
# From the DevHelper directory
npm install
```

### Run the frontend in the browser (no Rust needed)

```powershell
npm run dev
# open http://localhost:5173
```

Native-only tools (e.g. Port Checker) show a "desktop only" notice in this mode.

### Run the full desktop app (requires Rust)

```powershell
npm run tauri:dev
```

### After a fresh clone or a `git pull`

```powershell
npm install          # dependencies change with the lock file
npm run tauri:dev    # cargo restores Rust crates on the first build
```

Nothing else is checked in that needs setting up: no `.env`, no local config, no
generated files. The first Rust build after a pull that touched `src-tauri/` takes
a few minutes because crates compile; later ones are incremental.

---

## AI on a new machine

DevHelper works fully without AI. To use the AI tools, open **Settings → AI** and
tick one or both:

- **Local AI** — a model that runs on this computer. Prompts never leave it.
  DevHelper installs what is missing itself: it creates the model folder, offers to
  download llama.cpp's engine (~18 MB, checksum-verified), and offers to download a
  chat model (1.8–4.7 GB). Each step names exactly what it will fetch and waits for
  you to confirm. See [`docs/OFFLINE_AI.md`](./docs/OFFLINE_AI.md).
- **Online AI** — any OpenAI-compatible API. Needs a key, which is stored in the
  Windows credential store rather than in DevHelper's own files.

With both ticked, the local model answers and nothing falls back to the internet.

Neither the engine nor any model is committed to this repository — a binary that
size does not belong in git, and models are licensed by their publishers. That is
why a fresh install has some downloading to do before the first answer, and why
that download is a button rather than a manual hunt through release pages.

---

## Testing

```powershell
npm test          # run unit tests once
npm run test:watch
npm run typecheck # TypeScript, no emit
```

---

## Production build

### Frontend bundle

```powershell
npm run build     # outputs to dist/
```

### Windows `.exe` / installer (requires Rust + WebView2)

```powershell
npm run tauri:build
```

Artifacts are written to `src-tauri/target/release/` (the executable) and
`src-tauri/target/release/bundle/` (MSI + NSIS installers).

> **Icons:** Before the first `tauri:build`, generate app icons:
> ```powershell
> npm run tauri icon path\to\app-icon.png
> ```
> This populates `src-tauri/icons/`.

---

## Keyboard shortcuts

| Shortcut         | Action              |
| ---------------- | ------------------- |
| `Ctrl + K` / `Ctrl + Space` | Command palette |
| `Ctrl + Shift + J` | JSON Formatter    |
| `Ctrl + Shift + G` | GUID Generator    |
| `Ctrl + Shift + P` | Port Checker      |

---

## Project scripts

| Script | Description |
| ------ | ----------- |
| `npm run dev` | Vite dev server (browser) |
| `npm run build` | Type-check + production frontend build |
| `npm run tauri:dev` | Run desktop app (Rust required) |
| `npm run tauri:build` | Build Windows executable + installers |
| `npm test` | Vitest unit tests |
| `npm run typecheck` | TypeScript check |
