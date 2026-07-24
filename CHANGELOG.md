# Changelog

All notable changes to DevHelper are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/).

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
