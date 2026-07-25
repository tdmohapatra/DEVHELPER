import type { DbEngine } from "./dbTypes";

/**
 * Read-only monitoring queries per engine. Each returns SQL or null when the engine has no
 * equivalent (e.g. SQLite is a single file — no sessions/locks). Kept intentionally simple
 * and version-tolerant; failures surface gracefully in the UI.
 */

/** Active sessions / who is connected. */
export function sessionsQuery(engine: DbEngine): string | null {
  switch (engine) {
    case "mssql":
      return (
        "SELECT s.session_id, s.login_name, s.host_name, s.program_name, " +
        "r.status, r.command, DB_NAME(r.database_id) AS [database], r.cpu_time, " +
        "r.wait_type, r.blocking_session_id " +
        "FROM sys.dm_exec_sessions s " +
        "LEFT JOIN sys.dm_exec_requests r ON s.session_id = r.session_id " +
        "WHERE s.is_user_process = 1 ORDER BY s.session_id"
      );
    case "postgres":
      return (
        "SELECT pid, usename, application_name, client_addr, state, wait_event_type, " +
        "LEFT(query, 200) AS query FROM pg_stat_activity WHERE pid <> pg_backend_pid() ORDER BY pid"
      );
    case "mysql":
      return (
        "SELECT ID AS id, USER AS user, HOST AS host, DB AS db, COMMAND AS command, " +
        "TIME AS time_s, STATE AS state, LEFT(INFO, 200) AS info " +
        "FROM information_schema.PROCESSLIST ORDER BY ID"
      );
    default:
      return null;
  }
}

/** Blocking / lock waits. */
export function locksQuery(engine: DbEngine): string | null {
  switch (engine) {
    case "mssql":
      return (
        "SELECT r.session_id AS blocked_session, r.blocking_session_id AS blocking_session, " +
        "r.wait_type, r.wait_time AS wait_ms, r.wait_resource, DB_NAME(r.database_id) AS [database], " +
        "LEFT(t.text, 200) AS blocked_query " +
        "FROM sys.dm_exec_requests r CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t " +
        "WHERE r.blocking_session_id <> 0"
      );
    case "postgres":
      return (
        "SELECT blocked.pid AS blocked_pid, blocking.pid AS blocking_pid, " +
        "LEFT(blocked.query, 160) AS blocked_query, LEFT(blocking.query, 160) AS blocking_query " +
        "FROM pg_stat_activity blocked " +
        "JOIN pg_stat_activity blocking ON blocking.pid = ANY(pg_blocking_pids(blocked.pid)) " +
        "WHERE cardinality(pg_blocking_pids(blocked.pid)) > 0"
      );
    case "mysql":
      return (
        "SELECT w.requesting_engine_transaction_id AS waiting_trx, " +
        "w.blocking_engine_transaction_id AS blocking_trx, " +
        "r.trx_mysql_thread_id AS waiting_thread, b.trx_mysql_thread_id AS blocking_thread " +
        "FROM performance_schema.data_lock_waits w " +
        "JOIN information_schema.innodb_trx r ON r.trx_id = w.requesting_engine_transaction_id " +
        "JOIN information_schema.innodb_trx b ON b.trx_id = w.blocking_engine_transaction_id"
      );
    default:
      return null;
  }
}

/** Most recently modified objects. */
export function lastModifiedQuery(engine: DbEngine): string | null {
  switch (engine) {
    case "mssql":
      return (
        "SELECT TOP 30 name, type_desc, create_date, modify_date " +
        "FROM sys.objects WHERE is_ms_shipped = 0 ORDER BY modify_date DESC"
      );
    case "mysql":
      return (
        "SELECT table_name, table_type, create_time, update_time " +
        "FROM information_schema.tables WHERE table_schema = DATABASE() " +
        "ORDER BY update_time DESC"
      );
    case "postgres":
      return (
        "SELECT relname, last_vacuum, last_autovacuum, last_analyze " +
        "FROM pg_stat_user_tables " +
        "ORDER BY GREATEST(last_vacuum, last_autovacuum, last_analyze) DESC NULLS LAST LIMIT 30"
      );
    default:
      return null;
  }
}

/** Database size (single value / small result). */
export function dbSizeQuery(engine: DbEngine): string | null {
  switch (engine) {
    case "mssql":
      return "SELECT CAST(SUM(size) * 8.0 / 1024 AS DECIMAL(12,2)) AS size_mb FROM sys.database_files";
    case "postgres":
      return "SELECT pg_size_pretty(pg_database_size(current_database())) AS size";
    case "mysql":
      return "SELECT ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) AS size_mb FROM information_schema.tables WHERE table_schema = DATABASE()";
    default:
      return null;
  }
}

/** Statement to terminate a session/connection by id. */
export function killQuery(engine: DbEngine, sessionId: string): string | null {
  const id = sessionId.trim().replace(/[^0-9]/g, "");
  if (!id) return null;
  switch (engine) {
    case "mssql":
      return `KILL ${id}`;
    case "postgres":
      return `SELECT pg_terminate_backend(${id})`;
    case "mysql":
      return `KILL ${id}`;
    default:
      return null;
  }
}
