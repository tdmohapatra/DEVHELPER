# DevHelper

> Your Everyday Developer Toolbox — a fast, local-first Windows developer utility app.

DevHelper bundles the small utilities developers use every day (JSON tools, JWT
decoding, GUID/timestamp/Base64/URL helpers, regex testing, port checking, and more)
into one keyboard-driven desktop app built with **Tauri 2 + React + TypeScript**.

See [`INFO.md`](./INFO.md) for the product overview, [`ARCHITECTURE.md`](./ARCHITECTURE.md)
for design decisions, and [`STATUS.md`](./STATUS.md) for a dated log of completed work.

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
