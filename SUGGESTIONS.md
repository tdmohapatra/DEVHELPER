# DevHelper — Database Toolkit / SQL Suggestions

A living backlog of features for the **Database Toolkit** (PostgreSQL, MySQL, SQL Server,
SQLite, Oracle) and SQL workflows. Ordered by value × safety × effort. Update the status
markers as items land.

Legend: ✅ done · 🔨 in progress · ⬜ todo · 🔒 blocked/needs infra

---

## Already shipped ✅
- ✅ Connection manager — create/edit/duplicate/delete, session-only passwords (never persisted)
- ✅ Engines: PostgreSQL, MySQL/MariaDB, SQL Server (native-tls + Windows auth), SQLite; Oracle feature-gated
- ✅ Object explorer — tables / views / procedures / functions
- ✅ SQL runner — values returned as text, row/time/truncation info
- ✅ SQL safe-mode — flags DROP/TRUNCATE, unfiltered UPDATE/DELETE, schema changes; confirm-to-run; write-block per connection
- ✅ Results grid — NULL styling, CSV/JSON export
- ✅ Code generation — C# class/record, EF Core entity, TS interface, JSON example
- ✅ Connection status — connected/failed + server version, rail dots
- ✅ Local server detection — probe ports + processes, one-click prefill
- ✅ Database listing + switching (server engines)
- ✅ Per-field guidance (MSSQL auth, trust cert, dynamic ports)

---

## Priority 1 — Quick wins (pure frontend, low risk)
- ✅ **Query history** (per connection, persisted) + re-run
- ⬜ **Saved queries / snippets** with names + tags (tie into existing Snippet Library)
- ⬜ **Multiple query tabs**
- ⬜ **Run on Ctrl+Enter**, format on Shift+Alt+F (reuse existing SQL Formatter)
- ✅ **Results: sort by column**, client-side filter box (column resize still todo)
- ✅ **Row detail panel** — click a row → vertical key/value view (wide tables)
- ✅ **Copy row as JSON** (cell/row copy still todo)
- 🔨 **Generate INSERT from a row** (done; UPDATE still todo)
- ⬜ **Export**: SQL INSERT, Markdown table, Excel (.xlsx), clipboard-as-TSV
- ⬜ **Copy connection string as…** ADO.NET / JDBC / EF Core / psql / sqlcmd / mysql
- ⬜ **Pretty-view JSON/XML cells** in a popover; **BLOB download**
- ⬜ **Pin / recent objects** in the explorer; explorer search already present — add type filter
- ⬜ **Query timeout** setting per run; **Max rows** preset chips (100 / 1k / 5k)

## Priority 2 — Needs native SQL per engine (medium)
- 🔨 **Object DDL viewer** — columns, types, nullability, PK + "Script as CREATE" done; FK/indexes still todo
- ⬜ **Table data browser** — paginated `SELECT *` (LIMIT/OFFSET, next/prev), row count, table size
- ⬜ **EXPLAIN / query plan** button (EXPLAIN ANALYZE PG · SHOWPLAN/`SET STATISTICS` MSSQL · EXPLAIN MySQL)
- ⬜ **Fix MSSQL rows-affected** — writes currently report 0 rows (use `execute` for non-SELECT)
- ⬜ **Multi-statement batch** — run a script, show a result set per statement
- ⬜ **Stored-procedure execution UI** — parameter form, capture return/output params
- ⬜ **Persistent session + transactions** (BEGIN/COMMIT/ROLLBACK) — currently connect-per-query
- ⬜ **Cancel running query**
- ⬜ **Parameterized queries** (`@p` / `$1` bindings) with a params panel
- ⬜ **Schema selector** (PG `search_path`, MySQL database, MSSQL schema)
- ⬜ **Result charting** — quick bar/line of a numeric column (reuse dataviz)

## Priority 3 — Big / roadmap
- ⬜ **Schema Diff / Database Compare** (DEV vs QA vs UAT vs PROD) → generate migration SQL (review-only, never auto-run)
- ⬜ **Migration helper** — apply/track ordered migration scripts
- ⬜ **Database Health dashboard** — active connections, DB/table sizes, slow queries, blocking/locks (PG `pg_stat_activity`, MSSQL `sp_who2`/DMVs, MySQL `SHOW PROCESSLIST`)
- ⬜ **Index insights** — missing-index hints, unused indexes (MSSQL DMVs, PG `pg_stat_user_indexes`)
- ⬜ **ER diagram / relationships** view from FKs (mermaid)
- ⬜ **CSV/Excel import → table** (create + bulk insert)
- ⬜ **Whole-schema DDL export** / scripting
- ⬜ **Grid cell editing** → generated UPDATE with WHERE on PK (guarded, safe-mode aware)
- ⬜ **Monaco editor** — SQL highlight + schema-aware autocomplete (roadmap increment 3)

## Priority 4 — Connectivity / security / infra
- 🔒 **Secure OS credential storage** (Windows DPAPI / Credential Manager) — persist passwords safely; today session-only
- ⬜ **SQL Server named instance** auto-resolve via SQL Browser (UDP 1434) — needs tiberius feature
- ⬜ **Azure SQL / Entra (AAD) auth** for MSSQL; **encryption level** control
- ⬜ **SSH tunnel** to reach remote DBs (jump host)
- ⬜ **TLS options** per connection (MySQL/PG sslmode, client certs)
- ⬜ **Oracle**: SID vs service toggle; ship a build with Instant Client, or document setup
- ⬜ **Read-only connection mode** (hard-enforced, separate from safe-mode)
- ⬜ **Connection folders / grouping by environment**, with stronger PROD guardrails
- ⬜ **Backup/restore guidance** panel (commands + checklist; no destructive auto-exec)
- ⬜ **Seed data into a table** — bridge to the Test Data Generator tool

---

## MSSQL-specific notes / known gaps
- Writes (INSERT/UPDATE/DDL) report **0 rows affected** — `into_first_result()` only returns SELECT rows; switch to `execute()` for non-SELECT to capture the count.
- **Named instances** (e.g. `localhost\SQLEXPRESS`) are not auto-resolved — enter the instance's actual TCP port. SQL Browser resolution is a future add.
- Only **SQL login + Windows integrated auth** supported; **Azure AD/Entra** not yet.
- Uncommon column types fall back to `<unsupported type>` in the typed cascade.
- Connection is **per-query** (stateless) — no transactions/temp-table persistence across runs yet.
