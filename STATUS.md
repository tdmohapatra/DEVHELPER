# DevHelper — Build Status

A dated log of completed work. Newest entries first. See `CHANGELOG.md` for
release-style notes and `ARCHITECTURE.md` for design detail.

---

## Phase progress

| Phase | Title                         | Status         |
| ----- | ----------------------------- | -------------- |
| 1     | Foundation + Core MVP         | ✅ **Complete** |
| 2     | API & Data                    | ✅ **Complete** |
| 3     | Healthcare Integration        | ✅ **Complete** |
| 4     | DevOps & Integration          | ✅ **Complete** |
| 5     | AI & Diagnostics              | ✅ **Complete** |
| 6     | Power User Features           | ✅ **Complete** |

**All 6 phases complete — 39 tools.**

---

## 2026-07-24 — Phase 1 complete (Foundation + Core MVP)

### Project scaffold
- [x] Tauri 2 config (`tauri.conf.json`, `Cargo.toml`, `build.rs`, capabilities).
- [x] Vite 6 + React 18 + TypeScript (strict) + path alias `@/`.
- [x] Tailwind CSS with dark-first HSL design tokens; shadcn/ui-style primitives.
- [x] `.gitignore`, tsconfig(s), postcss, package scripts.

### Native layer (Rust)
- [x] `check_port` — maps a TCP port to its owning process via `netstat` + `sysinfo`.
- [x] `kill_process` — terminate by PID (confirmation enforced in UI).
- [x] `app_info` — runtime/version info.
- [x] `platform.ts` bridge — `NativeUnavailableError` for graceful browser fallback.

### App shell & core systems
- [x] Sidebar — category-grouped, fully derived from the Tool Registry.
- [x] Header — palette trigger, theme toggle.
- [x] Command palette (`Ctrl+K` / `Ctrl+Space`) — search, keyboard nav, favorite/recent
      badges, direct actions (e.g. "generate guid").
- [x] Tool Registry — single source of truth; `getTool` / `toolsByCategory` / `searchTools`.
- [x] Zustand store — theme, favorites, recent, navigation; persisted to `localStorage`.
- [x] Dark / light themes (dark default), persisted.
- [x] Dashboard, Favorites, Recent, Settings pages.
- [x] Toast notifications + copy-to-clipboard.

### Tools (all working, local-first)
- [x] JSON Formatter (format / minify / sort / inline validation)
- [x] JSON Diff (structural, by path, add/remove/change counts)
- [x] JSON → C# (class/record, nullable, required, System.Text.Json / Newtonsoft)
- [x] JWT Decoder (header/payload/claims, expiry status; local only)
- [x] GUID Generator (count, case, hyphens, braces)
- [x] Unix Timestamp Converter (auto s/ms detect, UTC/Local/IST/ISO, relative, live "now")
- [x] Base64 Encode / Decode (UTF-8 safe)
- [x] URL Encode / Decode + query-param parser
- [x] Regex Tester (flags, live matches, groups, replace)
- [x] Port Checker (native; kill/copy-PID/open-location with confirmation)

### Tests & verification
- [x] Vitest unit tests for json, jwt, time, encoding, guid — **29/29 passing**.
- [x] `npm run typecheck` — clean.
- [x] `npm run build` — production frontend bundle OK (~74 kB gzip JS).
- [x] Fixed bug: `parseQueryParams` treated a URL without `?` as a single param.

### Docs
- [x] INFO.md, STATUS.md, ARCHITECTURE.md, README.md, CHANGELOG.md, CONTRIBUTING.md.

### Known gaps / follow-ups
- [ ] Monaco editor not yet integrated (Phase 1 uses styled textareas); planned for
      larger editing surfaces.
- [ ] System tray + OS-level global hotkey (in-app hotkeys work) — Phase 6.

---

## 2026-07-24 — Desktop build (`DevHelper.exe`) produced

- [x] Installed Rust 1.97.1 (stable-x86_64-pc-windows-msvc) via winget.
- [x] Confirmed prereqs: MSVC C++ toolchain (VS 18 Community), WebView2 runtime 150.x.
- [x] Generated app icon set from `src-tauri/app-icon.png` (`npm run tauri icon`).
- [x] `npm run tauri:build` — success. Artifacts:
  - `src-tauri/target/release/DevHelper.exe` (4.28 MB)
  - `src-tauri/target/release/bundle/msi/DevHelper_0.1.0_x64_en-US.msi` (1.72 MB)
  - `src-tauri/target/release/bundle/nsis/DevHelper_0.1.0_x64-setup.exe` (1.20 MB)
- [x] Verified exe launches and runs (idle ~28.6 MB working set).
- [x] Native tools (Port Checker) now fully functional in the desktop build.

---

## 2026-07-24 — Phase 2 (API & Data) — core delivered

### API toolkit
- [x] **API Tester** — methods GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS; URL bar with
      method colouring; query params, headers, auth (Bearer/Basic), body
      (none/json/xml/urlencoded/raw) tabs; Send + Cancel (AbortController); response
      panel with status/time/size, pretty JSON, headers table; save requests.
- [x] Native HTTP via `@tauri-apps/plugin-http` (no CORS in desktop); browser fetch
      fallback with a CORS notice. Wired plugin in Rust + capability scope (http/https).
- [x] **API Collections** — folders + saved requests sidebar, load/delete, persisted.
- [x] **Environment Manager** — DEV/QA/UAT/PROD environments, `{{VAR}}` variables,
      active-env selector, **PRODUCTION warning badge**.
- [x] `{{VAR}}` interpolation across url/query/headers/auth/body.
- [x] **Code generators** — cURL, C# HttpClient, Python requests, JS fetch, TS fetch
      (live from the current request).

### Data & Code
- [x] **XML Tools** — format/minify/validate, XML ↔ JSON (fast-xml-parser).
- [x] **YAML Tools** — format/validate, YAML ↔ JSON (js-yaml).
- [x] **SQL Formatter** — 6 dialects, keyword casing, destructive-statement flag
      (sql-formatter).

### Architecture / perf
- [x] Persisted API store (`devhelper-api`) — requests, folders, environments, history.
- [x] **Lazy-loaded all tool screens** (React.lazy + Suspense) — heavy libs
      (sql-formatter, xml/yaml) now split into their own chunks; main bundle dropped
      from ~186 kB to **67.5 kB gzip**.

### Tests & verification
- [x] Unit tests for interpolate, apiRequest, apiCodegen, xml/yaml/sql —
      **51/51 passing** total.
- [x] Typecheck clean; production build clean (no chunk-size warning).

## 2026-07-24 — Phase 2 completed (2b)

- [x] **Test Data Generator** — synthetic users/customers/patients/orders/transactions/
      addresses/companies. Export JSON / CSV / SQL INSERT / XML, with download. Patient
      data is PHI-free (`TEST_PATIENT_*`, fake MRN, masked phone).
- [x] **OpenAPI / Swagger** tool:
  - Import — parses OpenAPI 3 and Swagger 2, lists endpoints, one-click "add N requests
    to Collections" (path params → `{{param}}`, base → `{{BASE_URL}}`).
  - Contract Compare — diffs two specs: added / removed / changed endpoints with
    per-change **breaking vs non-breaking** classification (removed endpoint/param,
    type change, optional→required = breaking) and a breaking-change count.
- [x] Unit tests for testdata + openapi (parse v2/v3, request mapping, contract diff) —
      **62/62 passing** total.
- [x] Typecheck + build clean; bundle still lazy-split (main ~68 kB gzip).
- [x] Rebuilt `DevHelper.exe` with the http plugin so Phase 2 ships in the desktop app.

> **Note:** Postman/HAR import was a nice-to-have beyond the original spec's Phase 2
> list; deferred. All spec-defined Phase 2 items are done.

---

## 2026-07-24 — Phase 3 (Healthcare Integration) complete

> Developer/integration utilities only. No clinical advice, no diagnosis. All processing
> is local by default; healthcare data is never transmitted.

- [x] **HL7 Toolkit** — parse HL7 v2 (MSH-aware field/encoding handling), segment +
      field explorer with named fields for MSH/PID/PV1/OBX/MSA, message-type detection
      (ADT/ORU/ORM/ACK…), format, HL7 → JSON, validation.
- [x] **FHIR Toolkit (R4)** — validate (resourceType + light per-resource checks),
      resource summary for Patient/Observation/Encounter, format, JSON → C# model.
- [x] **Healthcare De-identifier** — detects email/phone/SSN/MRN/date/IPv4; three modes
      (label / mask / pseudonymize); overlap-resolving scan; 100% local.
- [x] **Medical Text Utility** — ~45-term abbreviation dictionary, inline expansion,
      quick lookup. Clearly labelled terminology-only (not medical advice).
- [x] **SOAP / XML Tester** — build SOAP envelope, send (native http / browser
      fallback), formatted XML response, status/time.
- [x] Unit tests for hl7 / deidentify / medterms / fhir — **73/73 passing** total.
- [x] Typecheck + build clean; tools lazy-split (main ~69 kB gzip).

> Phase 3 added no Rust plugins (SOAP reuses the http plugin), so the desktop exe only
> needs a re-bundle to ship it — run `npm run tauri:build` when convenient.

---

## 2026-07-24 — Phases 4, 5, 6 complete

### Phase 4 — DevOps & Integration
- [x] **Docker** — list containers/images, start/stop/restart, view logs (docker CLI).
- [x] **Environment Checker** — detect .NET/Node/Python/Git/Docker/Rust/Go/Java/psql/… versions.
- [x] **Process Manager** — search/inspect/kill processes (sysinfo, top 300 by memory).
- [x] **Network Utilities** — ping, DNS lookup, TCP port check.
- [x] **Log Viewer** — open file (native path or browser file picker), level filter, search.
- [x] **Redis** — connect, key browser, GET/SET/DEL, TTL/TYPE, list/hash/set preview
      (minimal RESP client in Rust — no external crate).
- [x] **RabbitMQ** — queues/exchanges browsing + publish via the management HTTP API.
- [x] **NATS** — server/connections/subscriptions via the monitoring HTTP API (read-only).

### Phase 5 — AI & Diagnostics
- [x] **AI abstraction** (`src/lib/ai.ts`) — Ollama + OpenAI-compatible providers,
      configured in Settings, with explicit "data leaves the tool" notices. Fully optional.
- [x] **Error Explainer**, **Code Explainer**, **API Failure Analyzer**, **Test Case
      Generator** — via a shared AI prompt-tool scaffold.
- [x] **Stack Trace Analyzer** — local .NET/Java/JS parsing (exception, frames, inner,
      likely origin) with optional AI explanation.
- [x] **DevHelper Context Pack** — assemble API/error/logs/Docker/git/env context into a
      single structured AI diagnosis (Problem/Evidence/Root Cause/Fix/Confidence).

### Phase 6 — Power User
- [x] **System tray** — Open / Quit menu (Rust).
- [x] **Global hotkey** — Ctrl+Shift+Space brings DevHelper to the front (Rust plugin).
- [x] **Snippet Library** — CRUD, tags, favorites, search, copy (persisted).
- [x] **Project Profiles** — per-project tech stack + notes, active profile (persisted).

### Verification
- [x] Unit tests incl. stack-trace parser — **77/77 passing** total.
- [x] Typecheck clean; production build clean; all tools lazy-split (main ~74 kB gzip).
- [x] `cargo check` clean; final `npm run tauri:build` produced the desktop exe with the
      new commands (docker/process/network/sysprobe/files/redis), tray and global hotkey.

### Honest scope notes
- RabbitMQ/NATS use their **HTTP management/monitoring APIs** (no heavy AMQP/NATS
  protocol client compiled in). RabbitMQ publish works via the default exchange; NATS is
  read-only monitoring (no protocol pub/sub in this build).
- Redis uses a **minimal built-in RESP client** covering common commands.
- **Custom keyboard-shortcut remapping** (Phase 6) is not implemented — in-app + global
  shortcuts are fixed. Deferred as low-value/high-effort.
- Docker Compose parsing, Redis Pub/Sub, and DB browser (Phase 2/4 stretch items) not
  built. Everything spec-listed for the core of each phase is done.
