# Changelog

All notable changes to DevHelper are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased] — Post-v1 evolution, 2026-07-25

### Added — UI theming & Command Reference
- Per-category accent colors across sidebar, tool cards and nav (`categoryColors.ts`).
- **Command Reference** tool — tabbed, usage-grouped cheatsheet (Git, SSH/PuTTY, Linux,
  Windows, MSSQL, PgSQL, Redis, NATS, cURL, Network, .NET, npm, Azure/Cloud) with
  hover-info tooltips, copy buttons and destructive-command flags.

### Added — Database Toolkit engines (MySQL, SQL Server, Oracle)
- **MySQL / MariaDB** via mysql_async and **SQL Server** via tiberius (tokio TCP, typed
  value cascade → text). Both compile clean; runtime needs a live server (not verified in
  this environment).
- **Oracle** implemented but **feature-gated** (`cargo build --features oracle`): the
  `oracle` crate needs Oracle Instant Client (ODPI-C) at build+runtime, so it is OFF by
  default and the standard build never links it. UI marks Oracle "needs special build".
- Frontend: engine list, default ports and connection-string builders for all five
  engines; Postgres `postgresql://`, MySQL `mysql://`, SQL Server tiberius ADO string,
  Oracle `user/pass@//host:port/service`.

### Added — Database Toolkit (increment 1: PostgreSQL + SQLite)
- New **Database Toolkit** tool: connection manager (session-only passwords, never
  persisted to disk), object explorer (tables/views/procedures/functions), SQL runner,
  results grid, CSV/JSON export, and code generation (C# class/record, EF Core entity,
  TS interface, JSON example).
- **SQL safe-mode**: static analysis flags DROP/TRUNCATE, unfiltered UPDATE/DELETE and
  schema changes; risky statements need explicit confirm; safe-mode connections block
  writes outright.
- Native Rust `db` commands (`db_test`/`db_query`/`db_objects`): PostgreSQL via
  tokio-postgres (simple-query, text values) and SQLite via rusqlite (bundled). Async
  commands; SQLite runs on the blocking pool.
- Tests: +23 frontend unit tests (sqlSafety, dbCodegen) and 2 native Rust tests for the
  SQLite path — **100 JS tests + 2 Rust tests passing**.
- Deferred to next increments: SQL Server (tiberius), Monaco editor for the SQL surface,
  secure OS credential storage.

## [Unreleased] — Phases 4–6 (DevOps, AI, Power User), 2026-07-24

### Added — Phase 4 (DevOps & Integration)
- **Docker** (containers/images/logs/actions), **Environment Checker**, **Process
  Manager**, **Network Utilities** (ping/DNS/TCP), **Log Viewer**, **Redis** (built-in
  RESP client), **RabbitMQ** (mgmt API), **NATS** (monitoring API).
- Native Rust commands: docker, process list/kill, tcp/dns/ping, env probe, file read, redis.

### Added — Phase 5 (AI & Diagnostics)
- Optional AI layer (Ollama + OpenAI-compatible), configured in Settings.
- **Error Explainer**, **Code Explainer**, **API Failure Analyzer**, **Test Generator**,
  **Stack Trace Analyzer** (local parse + optional AI), **DevHelper Context Pack**.

### Added — Phase 6 (Power User)
- **System tray** (Open/Quit), **global hotkey** (Ctrl+Shift+Space), **Snippet Library**,
  **Project Profiles**.

## [Unreleased] — Phase 3 (Healthcare Integration), 2026-07-24

### Added
- **HL7 Toolkit** — parse/explore/validate HL7 v2, segment+field explorer, HL7 → JSON.
- **FHIR Toolkit (R4)** — validate, resource summary, format, JSON → C#.
- **Healthcare De-identifier** — detect + redact email/phone/SSN/MRN/date/IP (local only).
- **Medical Text Utility** — medical abbreviation lookup + inline expansion.
- **SOAP / XML Tester** — build SOAP envelope, send, inspect formatted response.

> All healthcare tools are developer/integration utilities — no clinical advice; local-first.

## [Unreleased] — Phase 2 (API & Data), 2026-07-24

### Added
- **Test Data Generator** — synthetic users/customers/patients/orders/etc. → JSON/CSV/
  SQL/XML (patient data is PHI-free).
- **OpenAPI / Swagger** — import specs to collections; compare two versions with
  breaking-change detection.
- **API Tester** — full request builder (methods, params, headers, Bearer/Basic auth,
  body types), Send/Cancel, response viewer (status/time/size, pretty JSON, headers).
- **API Collections** — folders + saved requests, persisted locally.
- **Environment Manager** — DEV/QA/UAT/PROD with `{{VAR}}` variables, active-env
  selector, production warning badge.
- **Code generators** — cURL, C# HttpClient, Python requests, JS/TS fetch.
- **XML / YAML / SQL** tools — format, validate, convert; SQL destructive-statement flag.
- Native HTTP via Tauri http plugin (CORS-free in desktop); browser fetch fallback.

### Changed
- All tool screens are now lazy-loaded (code-split); main bundle ~67 kB gzip.

## [0.1.0] — 2026-07-24

### Added — Phase 1 (Foundation + Core MVP)

- Tauri 2 + React + TypeScript + Vite + Tailwind + shadcn-style UI scaffold.
- Application shell: sidebar (category-grouped, registry-driven), header with search
  trigger and theme toggle.
- Global **command palette** (`Ctrl+K` / `Ctrl+Space`) with fuzzy search, keyboard
  navigation, favorite/recent indicators, and direct actions (e.g. generate GUID).
- **Tool Registry** — single source of truth; all UI derives from it.
- Favorites and Recent tools, persisted to `localStorage` via Zustand.
- Dark / light themes (dark-first), persisted.
- Tools: JSON Formatter (+validate/minify/sort), JSON Diff, JSON → C#, JWT Decoder,
  GUID Generator, Unix Timestamp Converter, Base64, URL Encode/Decode, Regex Tester,
  Port Checker (native, Windows).
- Rust native commands: `check_port`, `kill_process`, `app_info`.
- Toast notifications, copy-to-clipboard helper, native-bridge with graceful browser
  fallback.
- Unit tests (Vitest) for json, jwt, time, encoding, guid logic.
- Docs: INFO.md, STATUS.md, ARCHITECTURE.md, README.md, CONTRIBUTING.md.
