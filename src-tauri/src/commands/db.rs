//! Database Toolkit native layer.
//!
//! Engines:
//!   - PostgreSQL — tokio-postgres, simple-query protocol (every value arrives as text).
//!   - SQLite     — rusqlite (bundled), runs on the blocking pool.
//!   - SQL Server — tiberius over tokio TCP (values extracted via a typed cascade).
//!   - MySQL      — mysql_async.
//!   - Oracle     — feature-gated (`--features oracle`); requires Oracle Instant Client at
//!                  build + runtime, so it is OFF by default and the default build never
//!                  links it. UI marks it accordingly.
//!
//! This is a read/execute surface for a developer tool: values are returned as strings for
//! display. Destructive-statement gating and safe-mode live in the frontend.

use serde::Serialize;
use std::time::Instant;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Option<String>>>,
    pub row_count: usize,
    pub elapsed_ms: u64,
    pub truncated: bool,
}

#[derive(Serialize)]
pub struct DbObject {
    pub name: String,
    pub kind: String,
    pub schema: Option<String>,
}

const MAX_ROWS_HARD_CAP: usize = 5000;

/// Dispatch a query to the right engine and return a text QueryResult.
async fn run(engine: &str, conn_str: &str, sql: &str, max_rows: usize) -> Result<QueryResult, String> {
    let cap = max_rows.min(MAX_ROWS_HARD_CAP);
    match engine {
        "postgres" => pg_query(conn_str, sql, cap).await,
        "mssql" => mssql_query(conn_str, sql, cap).await,
        "mysql" => mysql_query(conn_str, sql, cap).await,
        "sqlite" => {
            let (cs, q) = (conn_str.to_string(), sql.to_string());
            tauri::async_runtime::spawn_blocking(move || sqlite_query(&cs, &q, cap))
                .await
                .map_err(|e| e.to_string())?
        }
        #[cfg(feature = "oracle")]
        "oracle" => {
            let (cs, q) = (conn_str.to_string(), sql.to_string());
            tauri::async_runtime::spawn_blocking(move || oracle_query(&cs, &q, cap))
                .await
                .map_err(|e| e.to_string())?
        }
        other => Err(format!(
            "Engine '{other}' is not supported in this build. (Oracle requires building with --features oracle and Oracle Instant Client installed.)"
        )),
    }
}

// ---------------------------------------------------------------------------
// PostgreSQL
// ---------------------------------------------------------------------------

/// Render a tokio-postgres error usefully.
///
/// Its `Display` is a category word — "db error", "error communicating with the server" —
/// and everything actionable (SQLSTATE, the server's message, its hint) lives in the
/// database error or the source chain. Reporting only the category tells the user nothing.
fn pg_error(prefix: &str, err: &tokio_postgres::Error) -> String {
    use std::error::Error;

    if let Some(db) = err.as_db_error() {
        let mut text = format!("{prefix}: {} [{}]", db.message(), db.code().code());
        if let Some(detail) = db.detail() {
            text.push_str(&format!("\n{detail}"));
        }
        if let Some(hint) = db.hint() {
            text.push_str(&format!("\nHint: {hint}"));
        }
        return text;
    }

    // Not a server-side error: unwrap the chain so the transport cause is visible.
    let mut text = format!("{prefix}: {err}");
    let mut source = err.source();
    while let Some(cause) = source {
        text.push_str(&format!(" — {cause}"));
        source = cause.source();
    }
    text
}

async fn pg_query(conn_str: &str, sql: &str, cap: usize) -> Result<QueryResult, String> {
    let (client, connection) = tokio_postgres::connect(conn_str, tokio_postgres::NoTls)
        .await
        .map_err(|e| pg_error("Connect failed", &e))?;
    tauri::async_runtime::spawn(async move {
        let _ = connection.await;
    });

    let start = Instant::now();
    let messages = client.simple_query(sql).await.map_err(|e| pg_error("Query failed", &e))?;
    let elapsed_ms = start.elapsed().as_millis() as u64;

    let mut columns: Vec<String> = Vec::new();
    let mut rows: Vec<Vec<Option<String>>> = Vec::new();
    let mut total = 0usize;
    let mut affected = 0u64;

    for msg in messages {
        match msg {
            tokio_postgres::SimpleQueryMessage::Row(row) => {
                if columns.is_empty() {
                    columns = row.columns().iter().map(|c| c.name().to_string()).collect();
                }
                total += 1;
                if rows.len() < cap {
                    let mut out = Vec::with_capacity(columns.len());
                    for i in 0..row.len() {
                        out.push(row.get(i).map(|s| s.to_string()));
                    }
                    rows.push(out);
                }
            }
            tokio_postgres::SimpleQueryMessage::CommandComplete(n) => affected = affected.max(n),
            _ => {}
        }
    }

    let row_count = if total > 0 { total } else { affected as usize };
    Ok(QueryResult { columns, truncated: total > rows.len(), rows, row_count, elapsed_ms })
}

// ---------------------------------------------------------------------------
// SQLite
// ---------------------------------------------------------------------------

fn sqlite_query(path: &str, sql: &str, cap: usize) -> Result<QueryResult, String> {
    let conn = rusqlite::Connection::open(path).map_err(|e| format!("Open failed: {e}"))?;
    let start = Instant::now();
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let col_count = stmt.column_count();

    if col_count == 0 {
        let affected = stmt.execute([]).map_err(|e| e.to_string())?;
        return Ok(QueryResult {
            columns: Vec::new(),
            rows: Vec::new(),
            row_count: affected,
            elapsed_ms: start.elapsed().as_millis() as u64,
            truncated: false,
        });
    }

    let columns: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let mut rows: Vec<Vec<Option<String>>> = Vec::new();
    let mut total = 0usize;
    let mut query_rows = stmt.query([]).map_err(|e| e.to_string())?;
    while let Some(row) = query_rows.next().map_err(|e| e.to_string())? {
        total += 1;
        if rows.len() >= cap {
            continue;
        }
        let mut out = Vec::with_capacity(col_count);
        for i in 0..col_count {
            out.push(value_ref_to_string(row.get_ref(i).map_err(|e| e.to_string())?));
        }
        rows.push(out);
    }

    Ok(QueryResult {
        columns,
        truncated: total > rows.len(),
        rows,
        row_count: total,
        elapsed_ms: start.elapsed().as_millis() as u64,
    })
}

fn value_ref_to_string(v: rusqlite::types::ValueRef<'_>) -> Option<String> {
    use rusqlite::types::ValueRef;
    match v {
        ValueRef::Null => None,
        ValueRef::Integer(i) => Some(i.to_string()),
        ValueRef::Real(f) => Some(f.to_string()),
        ValueRef::Text(t) => Some(String::from_utf8_lossy(t).to_string()),
        ValueRef::Blob(b) => Some(format!("<blob {} bytes>", b.len())),
    }
}

// ---------------------------------------------------------------------------
// SQL Server (tiberius)
// ---------------------------------------------------------------------------

/// ADO keys that carry the server address.
const MSSQL_SERVER_KEYS: [&str; 5] = ["server", "data source", "addr", "address", "network address"];

/// Split an ADO string into `key=value` segments, keeping the original text of each.
fn ado_segments(conn_str: &str) -> Vec<String> {
    conn_str.split(';').map(|s| s.to_string()).collect()
}

/// Value of one ADO key, matched case-insensitively and unquoted. None when absent.
fn ado_value(conn_str: &str, key: &str) -> Option<String> {
    for seg in conn_str.split(';') {
        let (k, v) = seg.split_once('=')?;
        if k.trim().eq_ignore_ascii_case(key) {
            return Some(v.trim().trim_matches('"').trim_matches('\'').to_string());
        }
    }
    None
}

/// Does this ADO string explicitly ask for the server certificate to be verified?
///
/// `Config::from_ado_string` already reads TrustServerCertificate, but the call to
/// `trust_cert()` that follows overrides whatever it decided. Accepting any
/// certificate is the right default for a dev tool talking to a self-signed local
/// server, and the wrong thing to do when the user has written the opposite.
fn mssql_verifies_cert(conn_str: &str) -> bool {
    ado_value(conn_str, "trustservercertificate")
        .map(|v| matches!(v.to_ascii_lowercase().as_str(), "false" | "no" | "0"))
        .unwrap_or(false)
}

/// How long to wait for the TCP handshake before giving up.
///
/// Without this, a filtered port leaves the caller on the OS default — around 21
/// seconds on Windows — with no output and no way to tell a slow server from a
/// firewalled one.
const MSSQL_CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// Rewrite `Server=HOST\INSTANCE` into `Server=tcp:HOST,PORT`.
///
/// tiberius only performs SQL Browser lookups with the `sql-browser-tokio` feature, so the
/// instance is resolved here instead — a named instance is what most developers actually
/// have, and its port is dynamic.
pub async fn resolve_mssql_instance(conn_str: &str) -> Result<String, String> {
    let mut segments = ado_segments(conn_str);
    for seg in segments.iter_mut() {
        let Some((key, value)) = seg.split_once('=') else { continue };
        let key_norm = key.trim().to_ascii_lowercase();
        if !MSSQL_SERVER_KEYS.contains(&key_norm.as_str()) {
            continue;
        }

        let raw = value.trim().trim_matches('"');
        let addr = raw.strip_prefix("tcp:").unwrap_or(raw).trim();
        let Some((host, rest)) = addr.split_once('\\') else { continue };
        let host = host.trim();
        if host.is_empty() {
            continue;
        }

        // `HOST\INSTANCE,1433` — the port is already explicit, so just drop the instance.
        let new_addr = if let Some((_, port)) = rest.split_once(',') {
            format!("tcp:{host},{}", port.trim())
        } else {
            let port = super::mssql::mssql_instance_port(host.to_string(), rest.trim().to_string()).await?;
            format!("tcp:{host},{port}")
        };
        *seg = format!("{}={new_addr}", key.trim());
    }
    Ok(segments.join(";"))
}

/// Turn low-level driver failures into something a developer can act on.
fn friendly_mssql_error(err: &str) -> String {
    let low = err.to_ascii_lowercase();
    if low.contains("refused") || low.contains("10061") {
        return format!(
            "{err}\n\nNothing is listening on that port. Check that the SQL Server service is running and that TCP/IP is enabled (SQL Server Configuration Manager → Network Configuration → Protocols → TCP/IP), then restart the service."
        );
    }
    if low.contains("timed out") || low.contains("10060") {
        return format!("{err}\n\nThe server did not answer. A firewall may be blocking the port, or the host name may be wrong.");
    }
    if low.contains("login failed") {
        return format!(
            "{err}\n\nIf this is a SQL login, the server must run in mixed mode (SQL Server & Windows Authentication). For a domain/local account, tick 'Windows authentication' instead."
        );
    }
    if low.contains("certificate") {
        return format!("{err}\n\nAdd TrustServerCertificate=true for a self-signed development certificate.");
    }
    err.to_string()
}

async fn mssql_query(conn_str: &str, sql: &str, cap: usize) -> Result<QueryResult, String> {
    use tiberius::{Client, Config};
    use tokio::net::TcpStream;
    use tokio_util::compat::TokioAsyncWriteCompatExt;

    // Named instances (localhost\SQLEXPRESS) are resolved to a TCP port first.
    let resolved = resolve_mssql_instance(conn_str).await?;

    let mut config = Config::from_ado_string(&resolved).map_err(|e| e.to_string())?;
    // Dev-friendly by default: accept self-signed server certs. Skipped when the
    // connection string asks for verification, so TrustServerCertificate=false means
    // what it says instead of being quietly ignored.
    if !mssql_verifies_cert(&resolved) {
        config.trust_cert();
    }

    let addr = config.get_addr().to_string();
    let tcp = tokio::time::timeout(MSSQL_CONNECT_TIMEOUT, TcpStream::connect(&addr))
        .await
        .map_err(|_| {
            friendly_mssql_error(&format!(
                "Connect to {addr} timed out after {}s",
                MSSQL_CONNECT_TIMEOUT.as_secs()
            ))
        })?
        .map_err(|e| friendly_mssql_error(&format!("Connect failed: {e}")))?;
    tcp.set_nodelay(true).ok();

    let mut client = Client::connect(config, tcp.compat_write())
        .await
        .map_err(|e| friendly_mssql_error(&e.to_string()))?;

    let start = Instant::now();
    let result = client.simple_query(sql).await.map_err(|e| e.to_string())?;
    let all = result.into_first_result().await.map_err(|e| e.to_string())?;
    let elapsed_ms = start.elapsed().as_millis() as u64;

    let columns: Vec<String> = all
        .first()
        .map(|r| r.columns().iter().map(|c| c.name().to_string()).collect())
        .unwrap_or_default();

    let total = all.len();
    let mut rows: Vec<Vec<Option<String>>> = Vec::new();
    for row in all.into_iter().take(cap) {
        let ncols = row.columns().len();
        let mut out = Vec::with_capacity(ncols);
        for i in 0..ncols {
            out.push(mssql_cell(&row, i));
        }
        rows.push(out);
    }

    Ok(QueryResult { columns, truncated: total > rows.len(), rows, row_count: total, elapsed_ms })
}

/// Extract one SQL Server cell as text via a typed cascade (first match wins).
fn mssql_cell(row: &tiberius::Row, i: usize) -> Option<String> {
    if let Ok(v) = row.try_get::<&str, usize>(i) {
        return v.map(|s| s.to_string());
    }
    if let Ok(v) = row.try_get::<i32, usize>(i) {
        return v.map(|x| x.to_string());
    }
    if let Ok(v) = row.try_get::<i64, usize>(i) {
        return v.map(|x| x.to_string());
    }
    if let Ok(v) = row.try_get::<i16, usize>(i) {
        return v.map(|x| x.to_string());
    }
    if let Ok(v) = row.try_get::<u8, usize>(i) {
        return v.map(|x| x.to_string());
    }
    if let Ok(v) = row.try_get::<f64, usize>(i) {
        return v.map(|x| x.to_string());
    }
    if let Ok(v) = row.try_get::<f32, usize>(i) {
        return v.map(|x| x.to_string());
    }
    if let Ok(v) = row.try_get::<bool, usize>(i) {
        return v.map(|x| x.to_string());
    }
    if let Ok(v) = row.try_get::<rust_decimal::Decimal, usize>(i) {
        return v.map(|x| x.to_string());
    }
    if let Ok(v) = row.try_get::<uuid::Uuid, usize>(i) {
        return v.map(|x| x.to_string());
    }
    if let Ok(v) = row.try_get::<chrono::NaiveDateTime, usize>(i) {
        return v.map(|x| x.to_string());
    }
    if let Ok(v) = row.try_get::<chrono::NaiveDate, usize>(i) {
        return v.map(|x| x.to_string());
    }
    Some("<unsupported type>".to_string())
}

// ---------------------------------------------------------------------------
// MySQL (mysql_async)
// ---------------------------------------------------------------------------

async fn mysql_query(conn_str: &str, sql: &str, cap: usize) -> Result<QueryResult, String> {
    use mysql_async::prelude::Queryable;

    let opts = mysql_async::Opts::from_url(conn_str).map_err(|e| e.to_string())?;
    let pool = mysql_async::Pool::new(opts);
    let mut conn = pool.get_conn().await.map_err(|e| format!("Connect failed: {e}"))?;

    let start = Instant::now();
    let result = conn.query_iter(sql).await.map_err(|e| e.to_string())?;

    let columns: Vec<String> = result
        .columns()
        .map(|cols| cols.iter().map(|c| c.name_str().to_string()).collect())
        .unwrap_or_default();

    let all: Vec<mysql_async::Row> = result.collect_and_drop().await.map_err(|e| e.to_string())?;
    let elapsed_ms = start.elapsed().as_millis() as u64;
    drop(pool);

    let total = all.len();
    let mut rows: Vec<Vec<Option<String>>> = Vec::new();
    for row in all.into_iter().take(cap) {
        let ncols = row.columns_ref().len();
        let mut out = Vec::with_capacity(ncols);
        for i in 0..ncols {
            out.push(row.as_ref(i).and_then(mysql_value_to_string));
        }
        rows.push(out);
    }

    Ok(QueryResult { columns, truncated: total > rows.len(), rows, row_count: total, elapsed_ms })
}

fn mysql_value_to_string(v: &mysql_async::Value) -> Option<String> {
    use mysql_async::Value;
    match v {
        Value::NULL => None,
        Value::Bytes(b) => Some(String::from_utf8_lossy(b).to_string()),
        Value::Int(i) => Some(i.to_string()),
        Value::UInt(u) => Some(u.to_string()),
        Value::Float(f) => Some(f.to_string()),
        Value::Double(d) => Some(d.to_string()),
        Value::Date(y, mo, d, h, mi, s, us) => Some(format!(
            "{y:04}-{mo:02}-{d:02} {h:02}:{mi:02}:{s:02}.{us:06}"
        )),
        Value::Time(neg, days, h, mi, s, us) => Some(format!(
            "{}{:02}:{:02}:{:02}.{:06}",
            if *neg { "-" } else { "" },
            (*days as u32) * 24 + *h as u32,
            mi,
            s,
            us
        )),
    }
}

// ---------------------------------------------------------------------------
// Oracle (feature-gated — requires Oracle Instant Client)
// ---------------------------------------------------------------------------

#[cfg(feature = "oracle")]
fn oracle_query(conn_str: &str, sql: &str, cap: usize) -> Result<QueryResult, String> {
    // conn_str format: user/password@//host:port/service
    let (creds, dsn) = conn_str.split_once('@').ok_or("Expected user/pass@//host:port/service")?;
    let (user, pass) = creds.split_once('/').ok_or("Expected user/password before @")?;

    let conn = oracle::Connection::connect(user, pass, dsn).map_err(|e| e.to_string())?;
    let start = Instant::now();
    let rows_iter = conn.query(sql, &[]).map_err(|e| e.to_string())?;

    let mut columns: Vec<String> = Vec::new();
    let mut rows: Vec<Vec<Option<String>>> = Vec::new();
    let mut total = 0usize;
    for row_res in rows_iter {
        let row = row_res.map_err(|e| e.to_string())?;
        if columns.is_empty() {
            columns = row.sql_values().iter().enumerate().map(|(i, _)| format!("col{i}")).collect();
        }
        total += 1;
        if rows.len() < cap {
            let mut out = Vec::new();
            for val in row.sql_values() {
                let s: Result<Option<String>, _> = val.get();
                out.push(s.unwrap_or(None));
            }
            rows.push(out);
        }
    }
    Ok(QueryResult {
        columns,
        truncated: total > rows.len(),
        rows,
        row_count: total,
        elapsed_ms: start.elapsed().as_millis() as u64,
    })
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Test a connection and return the server/engine version string.
#[tauri::command]
pub async fn db_test(engine: String, conn_str: String) -> Result<String, String> {
    let sql = match engine.as_str() {
        "postgres" => "SELECT version()",
        "sqlite" => "SELECT sqlite_version()",
        "mssql" => "SELECT @@VERSION",
        "mysql" => "SELECT VERSION()",
        "oracle" => "SELECT banner FROM v$version WHERE ROWNUM = 1",
        other => return Err(format!("Engine '{other}' is not supported")),
    };
    let r = run(&engine, &conn_str, sql, 1).await?;
    let version = r.rows.first().and_then(|row| row.first().cloned().flatten()).unwrap_or_default();
    Ok(if engine == "sqlite" { format!("SQLite {version}") } else { version })
}

/// Run a SQL statement and return columns + rows (values as strings).
#[tauri::command]
pub async fn db_query(
    engine: String,
    conn_str: String,
    sql: String,
    max_rows: Option<usize>,
) -> Result<QueryResult, String> {
    run(&engine, &conn_str, &sql, max_rows.unwrap_or(1000)).await
}

/// List tables, views, procedures and functions in the database.
#[tauri::command]
pub async fn db_objects(engine: String, conn_str: String) -> Result<Vec<DbObject>, String> {
    // Per-engine object-listing SQL. Each returns (schema, name, type) triples where a
    // type of VIEW/PROCEDURE distinguishes the kind; anything else is treated as a table.
    let queries: Vec<&str> = match engine.as_str() {
        "postgres" | "mssql" => vec![
            "SELECT table_schema, table_name, table_type FROM information_schema.tables \
             WHERE table_schema NOT IN ('pg_catalog','information_schema','sys','INFORMATION_SCHEMA') \
             ORDER BY table_schema, table_name",
            "SELECT routine_schema, routine_name, routine_type FROM information_schema.routines \
             WHERE routine_schema NOT IN ('pg_catalog','information_schema','sys') \
             ORDER BY routine_schema, routine_name",
        ],
        "mysql" => vec![
            "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES \
             WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME",
            "SELECT ROUTINE_SCHEMA, ROUTINE_NAME, ROUTINE_TYPE FROM INFORMATION_SCHEMA.ROUTINES \
             WHERE ROUTINE_SCHEMA = DATABASE() ORDER BY ROUTINE_NAME",
        ],
        "sqlite" => vec![
            "SELECT NULL AS schema, name, type FROM sqlite_master \
             WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
        ],
        "oracle" => vec![
            "SELECT USER AS owner, table_name, 'BASE TABLE' AS type FROM user_tables \
             UNION ALL SELECT USER, view_name, 'VIEW' FROM user_views \
             UNION ALL SELECT USER, object_name, object_type FROM user_procedures",
        ],
        other => return Err(format!("Engine '{other}' is not supported")),
    };

    let mut objects = Vec::new();
    for (qi, q) in queries.iter().enumerate() {
        // The first query is tables/views; the second (if any) is routines.
        let is_routines = qi == 1;
        let r = match run(&engine, &conn_str, q, MAX_ROWS_HARD_CAP).await {
            Ok(r) => r,
            Err(_) if is_routines => continue, // routines listing is best-effort
            Err(e) => return Err(e),
        };
        for row in &r.rows {
            let schema = row.first().cloned().flatten();
            let name = row.get(1).cloned().flatten().unwrap_or_default();
            let ttype = row.get(2).cloned().flatten().unwrap_or_default().to_uppercase();
            let kind = if ttype.contains("VIEW") {
                "view"
            } else if ttype.contains("PROCEDURE") {
                "procedure"
            } else if ttype.contains("FUNCTION") {
                "function"
            } else {
                "table"
            };
            if name.is_empty() {
                continue;
            }
            objects.push(DbObject { name, kind: kind.to_string(), schema });
        }
    }
    Ok(objects)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_db() -> String {
        let mut p = std::env::temp_dir();
        p.push(format!("devhelper_test_{}.db", std::process::id()));
        let path = p.to_string_lossy().to_string();
        let _ = std::fs::remove_file(&path);
        path
    }

    #[test]
    fn sqlite_ddl_insert_select_roundtrip() {
        let path = temp_db();
        let ddl = sqlite_query(&path, "CREATE TABLE users (id INTEGER, name TEXT, active INTEGER)", 100).unwrap();
        assert!(ddl.columns.is_empty());

        let ins = sqlite_query(&path, "INSERT INTO users VALUES (1,'Ada',1),(2,'Grace',NULL)", 100).unwrap();
        assert_eq!(ins.row_count, 2);
        assert!(ins.columns.is_empty());

        let sel = sqlite_query(&path, "SELECT id, name, active FROM users ORDER BY id", 100).unwrap();
        assert_eq!(sel.columns, vec!["id", "name", "active"]);
        assert_eq!(sel.row_count, 2);
        assert_eq!(sel.rows[0], vec![Some("1".into()), Some("Ada".into()), Some("1".into())]);
        assert_eq!(sel.rows[1][2], None);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn named_instance_with_an_explicit_port_drops_the_instance() {
        // No SQL Browser lookup is needed when the port is already spelled out.
        let out = tauri::async_runtime::block_on(resolve_mssql_instance(
            r"Server=DESKTOP-X\SQLEXPRESS,49823;Database=master;User Id=sa;Password=p;",
        ))
        .unwrap();
        assert_eq!(out, "Server=tcp:DESKTOP-X,49823;Database=master;User Id=sa;Password=p;");
    }

    #[test]
    fn a_plain_host_is_left_untouched() {
        let input = "Server=tcp:localhost,1433;Database=master;IntegratedSecurity=SSPI;";
        let out = tauri::async_runtime::block_on(resolve_mssql_instance(input)).unwrap();
        assert_eq!(out, input);
    }

    #[test]
    fn data_source_is_recognised_as_a_server_key() {
        let out = tauri::async_runtime::block_on(resolve_mssql_instance(
            r"Data Source=HOST\DEV,51000;Integrated Security=True;",
        ))
        .unwrap();
        assert!(out.starts_with("Data Source=tcp:HOST,51000"), "got {out}");
    }

    #[test]
    fn friendly_errors_add_guidance() {
        assert!(friendly_mssql_error("Connect failed: connection refused").contains("TCP/IP"));
        assert!(friendly_mssql_error("Login failed for user 'sa'").contains("mixed mode"));
        // An unrecognised error is passed through unchanged.
        assert_eq!(friendly_mssql_error("boom"), "boom");
    }

    #[test]
    fn mssql_ado_string_parses() {
        // The user's exact SSMS connection string — verify tiberius accepts it (unknown
        // keys ignored) and resolves host + default port 1433.
        use tiberius::Config;
        let s = "Data Source=DESKTOP-MHPFCI3;Integrated Security=True;Persist Security Info=False;Pooling=False;MultipleActiveResultSets=False;Encrypt=True;TrustServerCertificate=False;Application Name=\"SQL Server Management Studio\";Command Timeout=0";
        let mut config = Config::from_ado_string(s).expect("ADO string should parse");
        config.trust_cert();
        let addr = config.get_addr();
        assert!(addr.contains("DESKTOP-MHPFCI3"), "addr was {addr}");
        assert!(addr.contains("1433"), "addr was {addr}");
    }

    #[test]
    fn ado_values_are_read_case_insensitively_and_unquoted() {
        let s = "Data Source=x;Application Name=\"SQL Server Management Studio\";Encrypt=True";
        assert_eq!(ado_value(s, "data source").as_deref(), Some("x"));
        assert_eq!(ado_value(s, "APPLICATION NAME").as_deref(), Some("SQL Server Management Studio"));
        assert_eq!(ado_value(s, "missing"), None);
    }

    #[test]
    fn certificate_verification_is_opt_in_but_honoured() {
        // Absent or true: trust the certificate, which is what a self-signed dev
        // server needs. Explicitly false: verify it.
        assert!(!mssql_verifies_cert("Server=x;Database=y"));
        assert!(!mssql_verifies_cert("Server=x;TrustServerCertificate=True"));
        assert!(mssql_verifies_cert("Server=x;TrustServerCertificate=False"));
        assert!(mssql_verifies_cert("Server=x;trustservercertificate=no"));
        assert!(mssql_verifies_cert("Server=x;TrustServerCertificate=0"));
    }

    #[test]
    fn sqlite_respects_max_rows_and_marks_truncated() {
        let path = temp_db();
        sqlite_query(&path, "CREATE TABLE n (x INTEGER)", 100).unwrap();
        sqlite_query(&path, "INSERT INTO n VALUES (1),(2),(3),(4),(5)", 100).unwrap();

        let r = sqlite_query(&path, "SELECT x FROM n ORDER BY x", 2).unwrap();
        assert_eq!(r.rows.len(), 2);
        assert_eq!(r.row_count, 5);
        assert!(r.truncated);

        let _ = std::fs::remove_file(&path);
    }
}
