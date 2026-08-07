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

## 2026-07-26 — Toolchain Manager (Environment Checker rebuilt)

- [x] `toolchain.ts`: declarative 59-tool catalog (runtimes, IDEs, databases, messaging,
      cloud, API, AI, VCS, CLI) with capability chips, winget id / download URL / manual
      command, caveat notes and an `essential` core-stack flag. Pure helpers
      (`probeSpecs`/`cleanVersion`/`buildRows`/`filterRows`/`summarize`/`byGroup`/
      `isValidWingetId`/`installCommand`) + 20 unit tests. 206 JS tests total.
- [x] `commands/toolchain.rs`: `toolchain_probe` (cli / uninstall-registry / path checks,
      `%VAR%` expansion, 8-lane threading, `CREATE_NO_WINDOW`, registry snapshot cached in a
      `OnceLock` and read once via PowerShell → JSON), `toolchain_install` (winget, package
      id validated against arg injection, transcript tail returned) and
      `toolchain_winget_available`. +5 Rust tests (9 total).
- [x] UI: headline counts, search over names *and* capabilities, category tabs,
      all/installed/missing filter, per-tool card with version + how it was detected,
      two-step confirm before any install, winget output log, single-tool re-probe after a
      successful install. `opener:allow-open-url` added to the capability set for the
      vendor download links.
- [x] Verified: typecheck, 206 JS tests, `cargo check`, `cargo test --lib`, `vite build`,
      release exe. GUI not clicked (no browser/GUI harness in this session) — detection
      logic covered by unit tests plus a manual PowerShell cross-check of the registry
      patterns against this machine.

---

## 2026-07-26 — Config Inspector

- [x] New tool (devops): compare appsettings.json across N environments. `configInspect.ts`
      flattens nested config to `Section:Key`, diffs (changed/same/partial), reuses
      `isSecretKey`/`maskValue` for secret masking. UI: N config panes (paste or load .json),
      diff table with reveal-secrets + differences-only + filter + diff copy. Local only.
- [x] `configInspect` pure lib + 8 unit tests. 145 JS tests. Typecheck + build clean.

---

## 2026-07-26 — Environment Manager 2.0 (increment 1)

- [x] `Environment` extended with optional typed `connections` (database/api/redis/nats/
      rabbitmq/mqtt/websocket) — metadata only, backward compatible; API Tester unchanged.
- [x] Environments tool rebuilt: Edit mode (variables + per-kind connection editor) and
      **Compare** mode — variable + connection diff (added/removed/changed/same), counts,
      hide-identical, secret masking with reveal toggle.
- [x] `envCompare.ts` pure logic (`diffVariables`/`diffConnections`/`countStates`/
      `isSecretKey`/`maskValue`) + 6 unit tests. 125 JS tests. Typecheck + build clean.

### Cross-tool consumption (done 2026-07-26)
- [x] Environment `database` ref → "Open in DB Toolkit" (creates the connection, navigates,
      selects it). Database Toolkit → "From environment" prefill from the active env's db refs.
- [x] `dbConnectionFromEnvRef` / `normalizeEngine` shared helpers (+4 tests). 129 JS tests.

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
- [x] Visual service-flow diagram — Trace Explorer renders an SVG flow (status-colored nodes,
      latency-labelled edges) + Copy Mermaid export. `serviceEdges`/`toMermaidFlow` (+2 tests).
- [x] Capture from Error Explainer / Stack Trace Analyzer (done earlier).
- [x] Capture from messaging tools (Redis/NATS/RabbitMQ) — done 2026-08-07, see below.

---

## 2026-08-07 — Cross-cutting audit: durability, discovery, desktop, protocols

Driven by an audit of the whole app rather than one tool. The tool-level quality was
high; the gaps were all cross-cutting.

- [x] **Workspace backup** (`lib/workspace.ts`, +34 tests) — every store was in the
      webview's local storage with no way out. One versioned export/restore covering all
      nine, working at the storage layer so a new store cannot silently be left out (a
      test asserts the list matches what the app writes). Also fixed `Clear local data`,
      which removed one of nine keys and claimed to have cleared everything.
- [x] **Palette finds your own work** (`lib/artifactIndex.ts`, +23 tests) — requests,
      environments, connections, snippets, debug sessions and projects are searchable and
      openable from `Ctrl+K`. Costs ~8 kB gzip on the startup bundle, since the palette
      now imports every store.
- [x] **Desktop hygiene** — window state persisted, and single-instance (registered first,
      so a second launch raises the running window).
- [x] **Release pipeline** — `.github/workflows/release.yml` builds installers from a tag
      into a draft release; `ci.yml` runs typecheck, both test suites, a frontend build and
      clippy on every push. Auto-updating was wired and then removed in favour of plain
      downloadable installers — no signing key to hold, nothing phoning home.
      See `docs/RELEASES.md`.
- [x] **OS credential storage** (`commands/secrets.rs`, `lib/secrets.ts`) — opt-in, keyed
      by server account, via Windows Credential Manager. DevHelper still writes no
      password of its own. The AI API key moved out of local storage, where a workspace
      backup would have carried it. Round-trip is runtime-verified against the real
      credential store (4 Rust tests).
- [x] **Project scoping** (`lib/projectScope.ts`, +24 tests) — profiles can claim
      environments, connections, snippets and folders; three tools filter to the active
      one. Claims are non-exclusive and anything unclaimed stays visible everywhere.
- [x] **Rebindable shortcuts** (`lib/keybindings.ts`, +34 tests) — one binding table,
      conflict detection instead of iteration-order luck, matching on `event.code` so a
      binding does not move with the keyboard layout.
- [x] **Component tests** — jsdom needed a localStorage polyfill (zustand threw on import)
      and `scrollIntoView`. Covers the palette, project scoping, capture and one whole
      tool screen. First tests in this repo that render a screen.
- [x] **NATS client protocol** (`commands/nats.rs`, `natsClient.ts`, +21 tests) — publish,
      request-reply and live subscriptions on port 4222 via `async-nats`. Connections
      pooled per address; feed capped at 500; pause freezes the view, not the subscription.
- [x] **Redis held connection** (`redis_watch`, `redisWatch.ts`, +20 tests, +6 Rust) —
      SUBSCRIBE / PSUBSCRIBE / MONITOR, which a command-per-call client cannot do.
      MONITOR carries an explicit cost warning.
- [x] **RabbitMQ message peek** — the management API's `get`, requeueing by default;
      removing permanently needs a second confirmation. No AMQP client added: inspection
      should not require draining the queue.
- [x] Verified: typecheck, **1452 JS tests** (from 1247), **49 Rust tests** (from 31),
      `vite build` and `tauri:build` clean.

---

## 2026-08-07 — Unified Debug Session + Trace Explorer depth

The last two flagship items. Both rest on new pure-analysis libs.

- [x] `traceAnalysis.ts` — attributes the span rather than only ordering it. `waterfall`
      (proportional layout; events with no duration get a marked sliver, not a zero bar),
      `traceGaps` (measured from when the previous step *finished*, and from the furthest
      point reached so an overlapping child does not make its parent's tail look idle),
      `slowestEvents`, `cascadeErrors`, `repeatedSteps` (retry loops), `ambiguousOrder`
      (timestamps shared across services, where the order shown is not evidence), and
      `traceInsights` over all of it. +35 tests.
- [x] **Trace Explorer**: insight cards, a "largest unaccounted gaps" table, and a
      waterfall / list toggle. The span now counts the last step's own duration.
- [x] `sessionAnalysis.ts` — `groupTraces` turns a session's single list back into the
      flows it is made of (keyed by correlation id, else trace id, else one shared
      uncorrelated bucket), `sessionOverview`, `dedupeEvents` (fingerprint on time +
      source + service + title, so a re-imported log collapses but two genuine retries do
      not), and `suggestAttachments` — uncorrelated captures that fall inside **exactly
      one** flow's window. Ambiguous ones are left alone rather than guessed at. +26 tests.
- [x] **Debug Session**: flow table (click to filter), flow/failed counts in the header,
      insight cards over the filtered timeline, one-click duplicate removal and one-click
      attach-to-flow. `updateEvent`/`setEvents` added to `useDebugStore`.
- [x] Verified: typecheck, **1247 JS tests**, `vite build` clean. No native changes.

---

## 2026-08-07 — Environment Manager 2.0 (increment 2)

Inheritance, transfer between machines, and connection references that actually open.

- [x] `envResolve.ts` — `Environment.extendsId` (optional, backward compatible) plus
      cycle-safe `inheritanceChain`/`resolveVariables`/`resolvedVariables` (each value
      labelled own / inherited / override, with what it shadows), `wouldCycle`/
      `eligibleParents` to keep the picker honest, and `missingVariables`/
      `unusedVariables`/`danglingReferences`. +23 tests.
- [x] `useApiStore.activeVars()` now resolves through the chain, so every tool that
      interpolates `{{VAR}}` gets inherited values. Deleting a parent detaches its
      children rather than leaving them pointing at a ghost.
- [x] **Compare now diffs resolved values**, not declared ones — an environment that
      inherits twenty values and overrides one differs from its sibling in one place.
      `diffVariableMaps` split out of `diffVariables` for it.
- [x] `envIo.ts` — export/import as JSON. Secrets are an explicit choice, and a redacted
      export keeps the *keys* so the recipient knows what to fill in. Import matches on
      name (the same environment from two machines is one environment), offers keep-both /
      keep-mine / use-theirs, rewrites inheritance links onto whatever ids things ended up
      with, and reports unreadable entries instead of dropping them. +27 tests.
- [x] `envHandoff.ts` + `useHandoffStore` — "Open in Redis / NATS / RabbitMQ" from a
      connection reference. The port is translated, not copied: an environment records the
      client port (4222, 5672) and these tools need the operator port (8222, 15672), so
      handing the address over unchanged would look like the server was down. The
      receiving tool shows "from DEV · cache". +19 tests.
- [x] Verified: typecheck, **1186 JS tests**, `vite build` clean. No native changes.

---

## 2026-08-07 — Messaging capture + RabbitMQ rebuilt

Closes the last open item on the Debug Session flagship: every tool that can observe a
distributed flow can now put what it sees on the timeline.

- [x] `mqCapture.ts` — pure builders turning a broker's current state into a `ParsedEvent`:
      Redis health snapshot, Redis console command, NATS server snapshot, RabbitMQ broker
      snapshot, RabbitMQ publish, and `brokerUnreachableEvent` (not-reachable and
      unhealthy look identical on a timeline unless one says so). A snapshot's status is
      the worst finding in it. +21 tests.
- [x] `rabbitMonitor.ts` — typed management-API shapes (overview/queues/exchanges/nodes)
      plus `brokerFindings()` for what RabbitMQ discards quietly: backlog with no consumer,
      all-unacked queues, flow control, redelivery loops, filling DLQs, limits with no
      dead-letter exchange, unroutable publishes, node memory/disk/FD alarms. Also
      `mgmtPortAdvice`/`withMgmtPort` (5672 vs 15672, plugin-not-enabled) and
      `routingKeyProblem`. +41 tests.
- [x] **RabbitMQ tool rebuilt** — 5 tabs, findings panel, attention-ordered queues, node
      headroom, exchange-aware publish that reports `routed: false` instead of claiming
      success. The old version was Phase-4 vintage (untyped `any`, two tables, no findings).
- [x] Redis: Debug capture on the health view, on each console command, and on a failed
      connection. NATS: capture of the server snapshot with its findings, and of a failed
      connection.
- [x] Verified: typecheck, **1117 JS tests** (was 1055), `vite build` clean. No native
      changes. GUI not clicked (no browser/GUI harness) — logic covered by unit tests.

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
