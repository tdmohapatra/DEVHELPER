# Changelog

All notable changes to DevHelper are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

Nothing yet.

## [0.2.0] — 2026-08-07

Everything below shipped since 0.1.0.

### Added — Workspace backup, palette search, credentials, shortcuts, live protocols
- **Back up and restore everything.** All saved work lived in the webview's local storage
  with no way out — not a file any backup tool sees. One versioned document now covers
  every store, with secrets an explicit choice. `Clear local data` also actually clears it
  now; it used to remove one key of nine and report success.
- **`Ctrl+K` finds your own work**, not just tool names: requests, environments,
  connections, snippets, debug sessions and projects, each opening in the tool that owns
  it.
- **Passwords can be remembered by the OS.** Opt-in, per server account, in the Windows
  Credential Manager — DevHelper still writes no password of its own. The AI API key has
  moved out of local storage, where it sat in plain text and a backup would have copied it.
- **Project profiles now scope the app.** A profile can claim environments, connections
  and snippets; the Database Toolkit, Environment Manager and Snippet Library can filter
  to the active one. Anything unclaimed stays visible everywhere.
- **Keyboard shortcuts are rebindable**, with conflicts reported rather than decided by
  iteration order, and matching on the physical key so bindings survive a layout change.
- **Window position remembered, and one instance at a time.** Launching DevHelper again
  raises the copy already running, which is what the tray icon and global hotkey do too.
- **Releases are built by CI from a tag** and published as drafts — installers you download
  and run. No auto-update: see `docs/RELEASES.md`.
- **NATS speaks its client protocol**: publish, request-reply and live subscriptions on
  4222, not only the read-only monitoring port.
- **Redis holds a connection open** for SUBSCRIBE, PSUBSCRIBE and MONITOR.
- **RabbitMQ can show what is in a queue**, requeueing by default; removing messages
  permanently takes a second confirmation.
- First tests that render a screen — the suite had been almost entirely pure logic.
  1452 JS tests, 49 Rust tests.

### Added — Trace Explorer attributes the span; Debug Session sees its flows
- **Waterfall view and gap analysis in Trace Explorer.** A chronological list says what
  happened in what order; it does not say that four of a five-second request went into
  one gap between two services. Gaps are measured from when the previous step *finished*,
  so time a step reported is not counted twice and what remains is genuinely unaccounted
  for. Insight cards call out a gap or a step that dominates the span, the first failure
  with a count of the errors that followed it, retry loops, and timestamps shared across
  services — where the displayed order is not evidence of causality.
- **Debug Session groups its captures into flows.** A session accumulates whatever you
  pressed Debug on, minutes apart, belonging to several different requests. It now shows
  the flows it contains — events, span, services, status — and one click filters the
  timeline to one of them.
- **Duplicate removal and orphan attachment.** Re-importing the same log collapses instead
  of doubling (two genuine retries still differ, so they survive). Captures with no
  correlation id — a broker snapshot is about the broker, not the request — can be
  attached to the flow whose window they fall inside, but only when exactly one flow was
  in flight; guessing would put fabricated causality in front of someone debugging.
- New `traceAnalysis.ts` and `sessionAnalysis.ts` (+61 tests). 1247 JS tests total.

### Added — Environment Manager 2.0: inheritance, transfer, and connections that open
- **Environments can inherit.** QA and UAT usually differ in three values and agree on
  twenty; the twenty now live once in a base environment and each child overrides only
  what differs. Every tool that interpolates `{{VAR}}` sees the resolved set. The editor
  shows each value with where it came from — own, inherited, or overriding — because an
  environment that inherits twenty values otherwise looks empty.
- **Compare diffs resolved values**, so a difference is something someone chose rather
  than something someone forgot to copy.
- **Import / export environments as JSON.** Secrets are an explicit decision, and a
  redacted export keeps the keys so the recipient knows what has to be filled in. Import
  matches on name — the same environment exported from two machines is one environment —
  and offers keep-both / keep-mine / use-theirs.
- **"Open in Redis / NATS / RabbitMQ"** from a connection reference, alongside the
  existing "Open in DB Toolkit". The port is translated rather than copied: environments
  record the client port (4222, 5672) and these tools need the operator port (8222,
  15672), so handing the address over unchanged looks like the server is down.
- New `envResolve.ts`, `envIo.ts`, `envHandoff.ts` and `useHandoffStore` (+69 tests).
  1186 JS tests total.

### Added — Messaging tools feed the Debug Session; RabbitMQ rebuilt
- **Capture from Redis, NATS and RabbitMQ** — the last tools that could not put anything
  on the Debug Session timeline now can. A broker snapshot's status is the worst thing in
  it, so one bad finding makes the whole event an error; the findings go into the event's
  error text and the numbers into its payload. New `mqCapture.ts` (+21 tests) with
  builders for a Redis health snapshot, a Redis console command, a NATS server snapshot,
  a RabbitMQ broker snapshot, a publish, and "the broker was not reachable at all" —
  which is worth distinguishing from "the broker is unhealthy" on a timeline.
- **RabbitMQ rebuilt as an operator tool**, matching what Redis and NATS already got.
  Overview / Queues / Exchanges / Nodes / Publish tabs, typed management-API shapes, and
  `brokerFindings()` for the things RabbitMQ discards quietly: a backlog with no consumer,
  messages delivered but never acked, flow control throttling publishers, a redelivery
  loop with no dead-letter exchange, a filling DLQ, a length or TTL limit with nowhere to
  dead-letter to, unroutable publishes, and node memory / disk / file-descriptor alarms.
- **Publishing now reports whether the message was actually routed.** The management API
  returns `routed: false` when nothing was bound for that key — the broker accepts the
  publish and then discards it. That used to show as a success toast.
- **Wrong-port guidance for RabbitMQ**, the same shape NATS has: 5672 is the AMQP port and
  does not speak HTTP, and the management API only exists once the plugin is enabled.
  One click switches the address to 15672. Queues are ordered by what needs attention.
- New `rabbitMonitor.ts` (+41 tests). 1117 JS tests total.

### Added — Toolchain Manager (replaces the Environment Checker)
- The `environment-checker` tool is now a full **Toolchain Manager**: a 59-tool catalog
  covering the whole stack (.NET / Node / Angular / Python / Java / Go / Rust, Visual
  Studio, VS Code, Cursor, SQL Server + SSMS + sqlcmd + ODBC, PostgreSQL, Oracle
  Instant Client / SQL Developer / Toad, DBeaver, Redis + Insight, RabbitMQ + Erlang,
  NATS, Elasticsearch, Docker, Azure/AWS CLI, kubectl, Helm, Terraform, Postman, curl,
  Wireshark, Ollama, Claude Code, Git, GitHub CLI, WinMerge, winget, jq, CMake…).
- Each tool shows **what it does** (capability chips), whether it is installed, the
  detected version, how it was found (cli / registry / path) and any caveat note.
- **One-click install of the latest version** via winget, behind a two-step confirm that
  shows the exact command; output is streamed back into a log panel and the tool is
  re-probed on success. Non-winget tools show a vendor download link or a copyable
  command (npm globals). Package ids are validated natively so they cannot inject args.
- Filters: search over names *and* capabilities, category tabs, all/installed/missing,
  plus headline counts including a "core stack" score.
- New native commands `toolchain_probe` / `toolchain_install` /
  `toolchain_winget_available` (`commands/toolchain.rs`): declarative checks (CLI version
  command, Windows uninstall-registry DisplayName match, filesystem path with `%VAR%`
  expansion), 8-lane threaded probing, console windows suppressed, registry snapshot
  cached per process. +13 JS tests, +5 Rust tests.

### Changed — Reliability & keyboard (error boundary, Ctrl+Enter, grid paging)
- **Error boundary** around the tool view — a crashing tool now shows a recover card
  (Try again / Dashboard) instead of white-screening the app; resets on navigation.
- **Keyboard-first**: `Ctrl/Cmd+Enter` runs the primary action in API Tester, the SQL
  query editor and the AI tools; `Esc` closes the DB object-details panel.
- **Result grid pagination** (100 rows/page) over the filtered+sorted set — big result
  sets no longer render thousands of DOM rows at once.

### Changed — Formatted AI output (Markdown rendering)
- AI results now render as **formatted Markdown** (headings, bold/italic, inline code,
  fenced code blocks with copy, ordered/unordered lists, links) instead of raw text.
  New dependency-free `lib/markdown.ts` parser (+7 tests) and `components/Markdown.tsx`.
  Applied to Error Explainer / Code Explainer / API Failure Analyzer / Test Generator
  (via AiPromptTool), Debug Session, Trace Explorer, Stack Trace Analyzer and Context Pack.

### Changed — Command palette: fuzzy ranking + restyle
- New tested fuzzy matcher (`lib/fuzzy.ts`) — in-order subsequence scoring with prefix /
  word-boundary / camelCase / contiguity bonuses; ranks e.g. "jf" → "JSON Formatter".
- Command palette rebuilt on it: fuzzy-ranked tools with favorite/recent boosts,
  **matched-character highlighting**, category-colored icons, global **command actions**
  (dashboard / favorites / recent / settings / toggle theme / generate GUID), grouped
  empty-state (recents + suggestions), active-row scroll-into-view, and a keyboard-hint
  footer. +8 unit tests.

### Changed — Premium UI/UX modernization (design system + shell)
- Retuned the dark-first design tokens (deeper charcoal, elevated surface token, subtler
  borders, crisper primary) and added a light theme that is intentionally designed, not
  inverted. All ~46 tools inherit the new look via shared tokens — no per-tool rewrites.
- **Motion system**: `scale-in` keyframe, premium easing token, button press
  micro-interaction, keyed page fade, card hover lift; global **`prefers-reduced-motion`**
  support. Consistent, GPU-friendly, no animation library added.
- **Sidebar**: collapsible (icon-only + tooltips, persisted), active accent bar, smooth
  width transition.
- **Home**: reworked into a Command Centre — subtle grid hero, prominent palette CTA,
  quick-jump chips, favorites/recent/quick sections.
- **Header / ToolShell**: backdrop-blur sticky headers, refined focus-visible rings and
  ARIA labels for accessibility.
- **Sound manager** (`lib/sound.ts`): centralized Web-Audio synthesized cues (success /
  error / notification), **off by default**, volume + toggle in Settings, persisted,
  graceful-fail — never affects the app. Wired to success/error toasts.
- No backend/logic/API changes; existing functionality preserved.


### Added — Cron Expression tool
- New **Cron Expression** tool (quick): parse/validate 5- and 6-field cron expressions
  (`*`, ranges, `*/n` steps, lists, month/day names, Vixie DOM/DOW OR semantics), read them
  in plain English, and preview the **next run times** in local time with relative offsets.
  Presets included. New `cron` lib (parseField / parseCron / matches / nextRuns / describe)
  with 8 unit tests. Pure-TS, no dependencies.

### Added — Trace Explorer service-flow diagram
- Trace Explorer now renders the reconstructed path as an **SVG service-flow diagram**
  (nodes colored by worst status, edges labelled with inter-service latency) instead of
  plain chips — no new dependency. Plus **Copy Mermaid** to export the flow for docs.
  New tested `serviceEdges` / `toMermaidFlow` helpers.

### Added — Database Toolkit: export / import connections
- **Export** all saved connections to a JSON file and **Import** them back (icons in the
  connections rail). Passwords and the session-only raw connection string are never
  included; imported connections get fresh ids and are appended. New tested
  `serializeConnections` / `parseConnectionsFile` helpers.

### Added — Database Toolkit: Monitoring panel
- New **Monitor** tab: **active sessions** (who's connected — with a **Kill session**
  control), **blocking & locks**, **last-modified objects**, and **database size**.
  MSSQL DMVs (`dm_exec_sessions`/`dm_exec_requests`/`dm_tran_locks`, `sys.objects`,
  `database_files`) with Postgres (`pg_stat_activity`, `pg_blocking_pids`) and MySQL
  (`PROCESSLIST`, `data_lock_waits`) equivalents; "Not available" for SQLite. Kill uses
  `KILL` / `pg_terminate_backend` with confirmation. New tested `dbMonitor` lib (+5 tests).

### Added — Database Toolkit: object Details panel
- Clicking **Details** on any explorer object opens a tabbed panel: **Columns**
  (type/nullable/default/PK + CREATE), **Data** (paginated browser with Prev/Next, page
  info, row count, all columns), **Indexes**, and **Definition** (view/procedure/function
  source via `OBJECT_DEFINITION` / `SHOW CREATE` / `information_schema` / `sqlite_master`).
  Per-engine SQL through the existing `db_query` — no new native code. New tested
  `dbBrowse` lib (pageQuery / countQuery / definitionQuery / indexQuery, +7 tests).

### Added — Database Toolkit: paste connection string
- Server connections can now be defined by pasting a raw, engine-native connection string
  (e.g. a full SQL Server ADO / SSMS string, or a Postgres/MySQL URL) instead of filling
  individual fields — passed straight to the driver. The raw string is **session-only,
  never persisted** (may contain a password).

### Added — Config Inspector
- New **Config Inspector** tool (devops): compare `appsettings.json` across N environments.
  Flattens nested config to `Section:Key` dotted keys, diffs them (changed / same / missing
  in some), masks likely-secret values (passwords, keys, tokens, connection strings) with a
  reveal toggle, "differences only" filter, per-config file load, and diff copy. Pure-TS,
  local-only. New `configInspect` lib (+8 unit tests).

### Added — Object DDL viewer
- Database Toolkit explorer: a **DDL** button on tables/views shows their columns
  (type / nullable / default / **primary key**) and a generated **CREATE TABLE** (copyable).
  Metadata is fetched per engine (SQLite `PRAGMA`, MySQL `SHOW COLUMNS`, Postgres/SQL Server
  `information_schema` + PK query) — no new native code. New tested `dbSchema` lib (+6 tests).

### Added — DB Toolkit quick-wins + more Debug capture
- **Database Toolkit**: per-connection **query history** (persisted, re-run from a dropdown),
  results grid **sort by column** + **filter box**, **row detail panel** (vertical
  key/value), and **generate INSERT / copy row as JSON** from a row. New tested helpers
  `sqlLiteral` / `toInsert` (+2 unit tests).
- **More Debug capture**: `AiPromptTool` gained an optional `capture` hook — **Error
  Explainer** and **Stack Trace Analyzer** now push an `exception` event to the Debug
  Session in one click.


### Added — Environment Manager 2.0
- Environments now hold **typed connection references** (database / API / Redis / NATS /
  RabbitMQ / MQTT / WebSocket) alongside variables — metadata only, no secrets stored.
  Backward compatible (`connections` is optional; API Tester variable flow unchanged).
- **Environment Compare** — diff two environments' variables and connections
  (added / removed / changed / same) with counts, "hide identical", and **secret masking**
  (auto-detected sensitive keys, reveal toggle). New `envCompare` lib (+6 unit tests).
- **Cross-tool connect** — an environment's `database` ref opens directly in the Database
  Toolkit ("Open in DB Toolkit"), and the Database Toolkit can prefill a connection "From
  environment". Shared `dbConnectionFromEnvRef` / `normalizeEngine` helpers (+4 unit tests).

### Added — Trace Explorer
- New **Trace Explorer** tool (diagnostics): enter a correlation / trace / request id and
  reconstruct its path across every captured Debug Session event (plus optional pasted
  logs). Shows a unified timeline with inter-event deltas, an ordered **service flow**
  (A → B → C with worst-status rollup), and a **summary** (span duration, error count,
  failure point). "Known ids" quick-pick, Diagnose with AI, export, and one-click
  "create a Debug Session from this trace".
- New pure logic: `eventMatchesId`, `serviceFlow`, `traceSummary` (+3 unit tests).

### Added — Debug Session live capture (increment 2)
- Reusable **`AddToDebug`** button — one-click capture of a tool's result onto the active
  Debug Session timeline (auto-creates a "Captured" session if none).
- Wired into **API Tester** (response + network-error; extracts correlation/trace id from
  `x-correlation-id`/`x-request-id`/`traceparent`), **Database Toolkit** (query success +
  error, with SQL + row count + timing), and **SOAP Tester** (response).
- Any tool can now feed the timeline in one line via `AddToDebug` / `pushDebugEvent()`.

### Added — Debug Session (flagship, increment 1)
- New **Debug Session** tool (diagnostics): reconstruct a distributed flow on one
  chronological timeline. Events carry source/service/status/duration/correlation id/
  trace id/payload/error.
- **Import logs** — paste a JSON array, NDJSON, or plain lines; common fields
  (timestamp/level/message/service/traceId/correlationId/duration) auto-detected across
  Serilog/Winston/.NET-style shapes. Plus manual **Add event**.
- Timeline with filters (source chips, errors-only, correlation-id, free-text), expandable
  event detail, per-session persistence, Markdown/JSON export.
- **Diagnose with AI** — sends the timeline to the configured provider for a
  Root Cause / Evidence / Failure Point / Confidence / Actions summary (opt-in). Plus
  "Copy AI context". `pushDebugEvent()` lets other tools feed a session (wiring = next).
- +16 unit tests (parsing, timestamp/level mapping, sort/filter, export). 116 JS tests.


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
