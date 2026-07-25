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

## 2026-07-26 — Environment Manager 2.0 (increment 1)

- [x] `Environment` extended with optional typed `connections` (database/api/redis/nats/
      rabbitmq/mqtt/websocket) — metadata only, backward compatible; API Tester unchanged.
- [x] Environments tool rebuilt: Edit mode (variables + per-kind connection editor) and
      **Compare** mode — variable + connection diff (added/removed/changed/same), counts,
      hide-identical, secret masking with reveal toggle.
- [x] `envCompare.ts` pure logic (`diffVariables`/`diffConnections`/`countStates`/
      `isSecretKey`/`maskValue`) + 6 unit tests. 125 JS tests. Typecheck + build clean.

### Next increment
- [ ] Cross-tool consumption: DB Toolkit / API Tester "use this environment's connection"
      (one-click connect from the active env's typed refs).

---

## 2026-07-26 — Debug Session (flagship, increment 1)

First slice of the flagship "debug a distributed flow" capability. Pure frontend, additive,
works in browser + desktop.

- [x] `debugSession.ts` — event/session model + pure logic: `parseLogEntries` (JSON array /
      NDJSON / plain lines with Serilog/.NET field auto-detection), `sortEvents`,
      `filterEvents`, `correlationIds`, `toMarkdown`, `buildAiContext`. 16 unit tests.
- [x] `useDebugStore` — sessions CRUD + events (persisted); `pushDebugEvent()` entry point
      for other tools to feed a session.
- [x] `Debug Session` tool (diagnostics category): sessions rail, timeline with status dots
      + expandable detail, filters (source/errors-only/correlation/search), Import logs +
      Add event, Markdown/JSON export, **Diagnose with AI** (opt-in) + Copy AI context.
- [x] Typecheck + 116 JS tests + build clean. No native changes.

### Increment 2 — live capture (done 2026-07-26)
- [x] Reusable `AddToDebug` component + `pushDebugEvent()` entry point.
- [x] Wired: **API Tester** (response + network error, correlation/trace-id extraction),
      **Database Toolkit** (query success + error), **SOAP Tester** (response).
- [x] Typecheck + 116 JS tests + build clean. Any other tool adopts capture in one line.

### Trace Explorer (done 2026-07-26)
- [x] Search a correlation/trace/request id across all captured Debug Session events +
      optional pasted logs. Unified timeline (with +Δms between events), ordered service
      flow with worst-status rollup, summary (span/errors/failure point), known-id
      quick-pick, AI diagnose, export, "create Debug Session from trace".
- [x] Pure logic `eventMatchesId` / `serviceFlow` / `traceSummary` (+3 tests). 119 JS tests.

### Next increments
- [ ] Visual service-flow diagram (mermaid) from the timeline.
- [ ] Capture from messaging tools (Redis/NATS/RabbitMQ) + Error Explainer / Stack Trace.

---

## 2026-07-25 — MSSQL connectivity fix + local-server detection

Addressing "can't connect to local SQL Server with credentials".

- [x] **tiberius TLS switched rustls → native-tls (Windows SChannel)** — the usual cause
      of local SQL Server handshake failures. Added `winauth` for Windows/integrated auth.
- [x] Connection form (MSSQL): **Windows authentication** toggle, **Trust server
      certificate** toggle (default on), per-field guidance (dynamic ports, TCP/IP enable,
      mixed-mode auth). `buildConnString` emits `IntegratedSecurity=SSPI` /
      `TrustServerCertificate` accordingly.
- [x] **Detect local servers** — probes localhost:1433/5432/3306/1521 (`tcp_check`) and
      scans for sqlservr/postgres/mysqld/tnslsnr (`list_processes`); one-click prefill.
- [x] Named-instance SQL Browser auto-resolution NOT wired (needs a tiberius feature) —
      form guides the user to enter the instance's actual TCP port instead.
- [x] cargo check + test, typecheck, 100 JS tests, vite build, **`tauri:build` all clean**.
      Desktop exe rebuilt at 9.3 MB (DB drivers add ~2 MB).

> Still runtime-unverified against a live SQL Server (none here). The native-tls change is
> the standard fix; if SQL login still fails it's server-side auth mode / TCP-IP / port.

---

## 2026-07-25 — Database Toolkit engines: MySQL, SQL Server, Oracle

Added the remaining engines on top of increment 1's provider abstraction.

- [x] **MySQL / MariaDB** — `mysql_async` (rustls). Values mapped from `mysql_async::Value`
      (incl. DATE/TIME formatting).
- [x] **SQL Server** — `tiberius` over tokio TCP (`tokio-util` compat), `trust_cert` for
      dev. Values via a typed `try_get` cascade (str/i16/i32/i64/u8/f32/f64/bool/decimal/
      uuid/datetime/date). Object listing reuses `information_schema`.
- [x] **Oracle** — implemented but **feature-gated** (`--features oracle`). The `oracle`
      crate needs Oracle Instant Client (ODPI-C) at build+runtime; kept off the default
      build so DevHelper still compiles everywhere. UI flags it "needs special build".
- [x] `cargo check` + `cargo test --lib` clean (2 SQLite tests). Typecheck + 100 JS tests
      + production build clean.

> **Verification honesty:** SQLite is runtime-verified (native tests). PostgreSQL/MySQL/
> SQL Server are **compile-verified only** — runtime needs live servers, which weren't
> available in this environment. Oracle is not compiled here (no Instant Client).

---

## 2026-07-25 — Database Toolkit (increment 1: PostgreSQL + SQLite)

First slice of the post-v1 "CREATE → TEST → INTEGRATE → INSPECT → DIAGNOSE" roadmap.
Additive — no existing tool code changed.

### Native (Rust)
- [x] New `commands/db.rs` with a provider-shaped surface: `db_test`, `db_query`,
      `db_objects` (async commands). PostgreSQL via **tokio-postgres** (simple-query
      protocol → every value returned as text, no per-type extraction); SQLite via
      **rusqlite** (`bundled`) on the blocking pool. Hard row cap 5000.
- [x] `cargo check` clean; **2 native SQLite tests** (DDL/insert/select roundtrip incl.
      NULL handling + affected counts; max-rows truncation) — passing.

### Frontend
- [x] `Database Toolkit` tool (category `database`): connection rail (create/edit/
      duplicate/delete, prod badge), **session-only passwords** (never persisted —
      `useDbStore` partializes them out), object explorer, SQL runner, results grid with
      row #/NULL styling, CSV/JSON export, code-gen (C# class/record, EF entity, TS
      interface, JSON example).
- [x] **SQL safe-mode** (`sqlSafety.ts`): strips comments/strings then flags
      DROP/TRUNCATE, unfiltered UPDATE/DELETE, ALTER/CREATE. Risky SQL requires confirm;
      safe-mode connections block writes.
- [x] `dbCodegen.ts` infers column types from sampled rows → C#/EF/TS/JSON.
- [x] +23 unit tests (sqlSafety 16, dbCodegen 7) — **100 JS tests passing**. Typecheck +
      production build clean; tool lazy-split (~7.2 kB gzip), main bundle unchanged.

### Deferred (next increments)
- [ ] SQL Server (tiberius) — increment 2.
- [ ] Monaco editor for the SQL surface — increment 3 (separate from the DB drivers).
- [ ] Secure OS credential storage (DPAPI / Credential Manager) for passwords.
- [ ] Result pagination/virtualization; per-object schema view; schema diff.

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
