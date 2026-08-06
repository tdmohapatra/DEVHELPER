/**
 * A catalog of ready-to-run SQL, per engine.
 *
 * Two surfaces use it: the editor's snippet picker, and the health dashboard,
 * which runs the `diagnostic` entries and renders their grids. Keeping both on
 * one catalog means a query is written, reviewed and corrected once.
 *
 * Every entry is written for the engines listed in `sql`. An engine that is
 * absent is simply not offered — a half-translated diagnostic that returns the
 * wrong number is worse than no entry at all.
 */

import type { DbEngine } from "./dbTypes";

export type SnippetCategory =
  | "windows"
  | "patterns"
  | "activity"
  | "performance"
  | "indexes"
  | "storage"
  | "schema"
  | "maintenance";

export const CATEGORY_LABELS: Record<SnippetCategory, string> = {
  windows: "Window functions",
  patterns: "Query patterns",
  activity: "Live activity",
  performance: "Performance",
  indexes: "Indexes",
  storage: "Storage & size",
  schema: "Schema",
  maintenance: "Maintenance",
};

/** Categories whose entries are safe to run unprompted on the dashboard. */
export const DIAGNOSTIC_CATEGORIES: SnippetCategory[] = [
  "activity",
  "performance",
  "indexes",
  "storage",
  "schema",
  "maintenance",
];

export interface Snippet {
  id: string;
  title: string;
  category: SnippetCategory;
  /** When to reach for it — one line, shown under the title. */
  description: string;
  /** SQL per engine. Absent engines do not offer the snippet. */
  sql: Partial<Record<DbEngine, string>>;
  tags: string[];
  /**
   * A teaching example over invented table names, meant to be edited before
   * running. Diagnostics are the opposite: they run as-is against the server.
   */
  template?: boolean;
  /** Needs elevated rights (VIEW SERVER STATE, pg_monitor, PROCESS). */
  privileged?: boolean;
}

// ---------------------------------------------------------------------------
// Window functions — teaching templates over placeholder tables
// ---------------------------------------------------------------------------

const WINDOW_SNIPPETS: Snippet[] = [
  {
    id: "win-row-number",
    title: "Number rows within each group",
    category: "windows",
    description: "ROW_NUMBER() restarts at 1 per group — the basis of top-N-per-group and dedupe.",
    tags: ["row_number", "partition", "rank", "group"],
    template: true,
    sql: {
      mssql: `SELECT
  customer_id,
  order_id,
  order_date,
  ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY order_date DESC) AS rn
FROM dbo.Orders;`,
      postgres: `SELECT
  customer_id,
  order_id,
  order_date,
  ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY order_date DESC) AS rn
FROM orders;`,
      mysql: `SELECT
  customer_id,
  order_id,
  order_date,
  ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY order_date DESC) AS rn
FROM orders;`,
      sqlite: `SELECT
  customer_id,
  order_id,
  order_date,
  ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY order_date DESC) AS rn
FROM orders;`,
    },
  },
  {
    id: "win-latest-per-key",
    title: "Latest row per key",
    category: "windows",
    description: "The most common window-function job: one row per customer, the newest one.",
    tags: ["latest", "newest", "top 1", "per group", "row_number"],
    template: true,
    sql: {
      mssql: `WITH ranked AS (
  SELECT *,
    ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY order_date DESC, order_id DESC) AS rn
  FROM dbo.Orders
)
SELECT * FROM ranked WHERE rn = 1;`,
      postgres: `-- Postgres has a shorter way when you only need whole rows:
SELECT DISTINCT ON (customer_id) *
FROM orders
ORDER BY customer_id, order_date DESC, order_id DESC;`,
      mysql: `WITH ranked AS (
  SELECT *,
    ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY order_date DESC, order_id DESC) AS rn
  FROM orders
)
SELECT * FROM ranked WHERE rn = 1;`,
      sqlite: `WITH ranked AS (
  SELECT *,
    ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY order_date DESC, order_id DESC) AS rn
  FROM orders
)
SELECT * FROM ranked WHERE rn = 1;`,
    },
  },
  {
    id: "win-rank-vs-dense",
    title: "RANK vs DENSE_RANK vs ROW_NUMBER",
    category: "windows",
    description: "Side by side on one dataset — ties are where they differ, and where bugs come from.",
    tags: ["rank", "dense_rank", "row_number", "ties"],
    template: true,
    sql: {
      mssql: `SELECT
  category,
  product_name,
  sales,
  ROW_NUMBER() OVER (PARTITION BY category ORDER BY sales DESC) AS row_num,   -- always unique
  RANK()       OVER (PARTITION BY category ORDER BY sales DESC) AS rank_gaps, -- ties share, then skip
  DENSE_RANK() OVER (PARTITION BY category ORDER BY sales DESC) AS rank_dense -- ties share, no skip
FROM dbo.Products;`,
      postgres: `SELECT
  category,
  product_name,
  sales,
  ROW_NUMBER() OVER (PARTITION BY category ORDER BY sales DESC) AS row_num,
  RANK()       OVER (PARTITION BY category ORDER BY sales DESC) AS rank_gaps,
  DENSE_RANK() OVER (PARTITION BY category ORDER BY sales DESC) AS rank_dense
FROM products;`,
      mysql: `SELECT
  category,
  product_name,
  sales,
  ROW_NUMBER() OVER (PARTITION BY category ORDER BY sales DESC) AS row_num,
  RANK()       OVER (PARTITION BY category ORDER BY sales DESC) AS rank_gaps,
  DENSE_RANK() OVER (PARTITION BY category ORDER BY sales DESC) AS rank_dense
FROM products;`,
    },
  },
  {
    id: "win-running-total",
    title: "Running total",
    category: "windows",
    description: "A cumulative sum ordered by date. The frame clause is what makes it cumulative.",
    tags: ["running total", "cumulative", "sum", "frame", "rows between"],
    template: true,
    sql: {
      mssql: `SELECT
  order_date,
  amount,
  SUM(amount) OVER (
    ORDER BY order_date
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ) AS running_total
FROM dbo.Orders
ORDER BY order_date;`,
      postgres: `SELECT
  order_date,
  amount,
  SUM(amount) OVER (
    ORDER BY order_date
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ) AS running_total
FROM orders
ORDER BY order_date;`,
      mysql: `SELECT
  order_date,
  amount,
  SUM(amount) OVER (
    ORDER BY order_date
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ) AS running_total
FROM orders
ORDER BY order_date;`,
      sqlite: `SELECT
  order_date,
  amount,
  SUM(amount) OVER (
    ORDER BY order_date
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
  ) AS running_total
FROM orders
ORDER BY order_date;`,
    },
  },
  {
    id: "win-moving-average",
    title: "Moving average over 7 rows",
    category: "windows",
    description: "A trailing window. ROWS counts rows; RANGE counts values — they differ when dates repeat.",
    tags: ["moving average", "rolling", "window frame", "trend"],
    template: true,
    sql: {
      mssql: `SELECT
  order_date,
  amount,
  AVG(amount * 1.0) OVER (
    ORDER BY order_date
    ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
  ) AS avg_7
FROM dbo.Orders
ORDER BY order_date;`,
      postgres: `SELECT
  order_date,
  amount,
  AVG(amount) OVER (
    ORDER BY order_date
    ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
  ) AS avg_7
FROM orders
ORDER BY order_date;`,
      mysql: `SELECT
  order_date,
  amount,
  AVG(amount) OVER (
    ORDER BY order_date
    ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
  ) AS avg_7
FROM orders
ORDER BY order_date;`,
    },
  },
  {
    id: "win-lag-lead",
    title: "Compare a row with the one before it",
    category: "windows",
    description: "LAG/LEAD reach across rows — deltas, time between events, change detection.",
    tags: ["lag", "lead", "delta", "previous row", "difference"],
    template: true,
    sql: {
      mssql: `SELECT
  order_date,
  amount,
  LAG(amount)  OVER (ORDER BY order_date) AS prev_amount,
  amount - LAG(amount) OVER (ORDER BY order_date) AS change,
  DATEDIFF(day, LAG(order_date) OVER (ORDER BY order_date), order_date) AS days_since_prev
FROM dbo.Orders
ORDER BY order_date;`,
      postgres: `SELECT
  order_date,
  amount,
  LAG(amount) OVER (ORDER BY order_date) AS prev_amount,
  amount - LAG(amount) OVER (ORDER BY order_date) AS change,
  order_date - LAG(order_date) OVER (ORDER BY order_date) AS since_prev
FROM orders
ORDER BY order_date;`,
      mysql: `SELECT
  order_date,
  amount,
  LAG(amount) OVER (ORDER BY order_date) AS prev_amount,
  amount - LAG(amount) OVER (ORDER BY order_date) AS \`change\`,
  DATEDIFF(order_date, LAG(order_date) OVER (ORDER BY order_date)) AS days_since_prev
FROM orders
ORDER BY order_date;`,
    },
  },
  {
    id: "win-percent-of-total",
    title: "Share of the group total",
    category: "windows",
    description: "An aggregate with no ORDER BY in the OVER clause spans the whole partition.",
    tags: ["percent", "share", "ratio", "partition", "total"],
    template: true,
    sql: {
      mssql: `SELECT
  category,
  product_name,
  sales,
  SUM(sales) OVER (PARTITION BY category) AS category_total,
  100.0 * sales / NULLIF(SUM(sales) OVER (PARTITION BY category), 0) AS pct_of_category
FROM dbo.Products
ORDER BY category, sales DESC;`,
      postgres: `SELECT
  category,
  product_name,
  sales,
  SUM(sales) OVER (PARTITION BY category) AS category_total,
  100.0 * sales / NULLIF(SUM(sales) OVER (PARTITION BY category), 0) AS pct_of_category
FROM products
ORDER BY category, sales DESC;`,
      mysql: `SELECT
  category,
  product_name,
  sales,
  SUM(sales) OVER (PARTITION BY category) AS category_total,
  100.0 * sales / NULLIF(SUM(sales) OVER (PARTITION BY category), 0) AS pct_of_category
FROM products
ORDER BY category, sales DESC;`,
    },
  },
  {
    id: "win-ntile",
    title: "Split rows into quartiles",
    category: "windows",
    description: "NTILE buckets by position, not by value — equal counts, unequal ranges.",
    tags: ["ntile", "quartile", "percentile", "bucket", "decile"],
    template: true,
    sql: {
      mssql: `SELECT
  customer_id,
  total_spend,
  NTILE(4) OVER (ORDER BY total_spend DESC) AS quartile,
  PERCENT_RANK() OVER (ORDER BY total_spend DESC) AS pct_rank
FROM dbo.CustomerTotals;`,
      postgres: `SELECT
  customer_id,
  total_spend,
  NTILE(4) OVER (ORDER BY total_spend DESC) AS quartile,
  PERCENT_RANK() OVER (ORDER BY total_spend DESC) AS pct_rank
FROM customer_totals;`,
      mysql: `SELECT
  customer_id,
  total_spend,
  NTILE(4) OVER (ORDER BY total_spend DESC) AS quartile,
  PERCENT_RANK() OVER (ORDER BY total_spend DESC) AS pct_rank
FROM customer_totals;`,
    },
  },
  {
    id: "win-first-last-value",
    title: "First and last value in a partition",
    category: "windows",
    description: "LAST_VALUE needs an explicit frame — the default frame stops at the current row.",
    tags: ["first_value", "last_value", "frame", "unbounded following"],
    template: true,
    sql: {
      mssql: `SELECT
  customer_id,
  order_date,
  amount,
  FIRST_VALUE(amount) OVER (
    PARTITION BY customer_id ORDER BY order_date
  ) AS first_order_amount,
  LAST_VALUE(amount) OVER (
    PARTITION BY customer_id ORDER BY order_date
    ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING  -- without this you get the current row
  ) AS latest_order_amount
FROM dbo.Orders;`,
      postgres: `SELECT
  customer_id,
  order_date,
  amount,
  FIRST_VALUE(amount) OVER (PARTITION BY customer_id ORDER BY order_date) AS first_order_amount,
  LAST_VALUE(amount) OVER (
    PARTITION BY customer_id ORDER BY order_date
    ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
  ) AS latest_order_amount
FROM orders;`,
    },
  },
  {
    id: "win-dedupe",
    title: "Find and delete duplicate rows",
    category: "windows",
    description: "Number the duplicates, keep rn = 1. Run the SELECT first — the DELETE is commented.",
    tags: ["duplicate", "dedupe", "delete", "row_number", "cleanup"],
    template: true,
    sql: {
      mssql: `WITH dupes AS (
  SELECT *,
    ROW_NUMBER() OVER (PARTITION BY email ORDER BY created_at, id) AS rn
  FROM dbo.Users
)
SELECT * FROM dupes WHERE rn > 1;   -- inspect first

-- Only once the rows above are the ones you want gone:
-- DELETE FROM dupes WHERE rn > 1;`,
      postgres: `WITH dupes AS (
  SELECT ctid,
    ROW_NUMBER() OVER (PARTITION BY email ORDER BY created_at, id) AS rn
  FROM users
)
SELECT * FROM dupes WHERE rn > 1;   -- inspect first

-- DELETE FROM users WHERE ctid IN (SELECT ctid FROM dupes WHERE rn > 1);`,
      mysql: `WITH dupes AS (
  SELECT id,
    ROW_NUMBER() OVER (PARTITION BY email ORDER BY created_at, id) AS rn
  FROM users
)
SELECT * FROM dupes WHERE rn > 1;

-- DELETE FROM users WHERE id IN (SELECT id FROM dupes WHERE rn > 1);`,
    },
  },
  {
    id: "win-gaps-islands",
    title: "Gaps and islands",
    category: "windows",
    description: "Collapse consecutive dates into ranges. The trick is that value − row_number is constant within a run.",
    tags: ["gaps", "islands", "consecutive", "streak", "ranges"],
    template: true,
    sql: {
      mssql: `WITH grouped AS (
  SELECT
    user_id,
    activity_date,
    DATEADD(day, -ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY activity_date), activity_date) AS grp
  FROM dbo.Activity
)
SELECT
  user_id,
  MIN(activity_date) AS streak_start,
  MAX(activity_date) AS streak_end,
  COUNT(*)           AS days
FROM grouped
GROUP BY user_id, grp
ORDER BY user_id, streak_start;`,
      postgres: `WITH grouped AS (
  SELECT
    user_id,
    activity_date,
    activity_date - (ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY activity_date))::int AS grp
  FROM activity
)
SELECT user_id, MIN(activity_date) AS streak_start, MAX(activity_date) AS streak_end, COUNT(*) AS days
FROM grouped
GROUP BY user_id, grp
ORDER BY user_id, streak_start;`,
    },
  },
];

// ---------------------------------------------------------------------------
// Query patterns
// ---------------------------------------------------------------------------

const PATTERN_SNIPPETS: Snippet[] = [
  {
    id: "pat-recursive-dates",
    title: "Generate a date series",
    category: "patterns",
    description: "A calendar to LEFT JOIN against, so days with no rows still appear in a report.",
    tags: ["recursive", "cte", "calendar", "date series", "generate_series"],
    template: true,
    sql: {
      mssql: `WITH dates AS (
  SELECT CAST('2026-01-01' AS date) AS d
  UNION ALL
  SELECT DATEADD(day, 1, d) FROM dates WHERE d < '2026-12-31'
)
SELECT d FROM dates
OPTION (MAXRECURSION 400);   -- the default limit is 100`,
      postgres: `SELECT d::date
FROM generate_series('2026-01-01'::date, '2026-12-31'::date, interval '1 day') AS d;`,
      mysql: `WITH RECURSIVE dates AS (
  SELECT DATE('2026-01-01') AS d
  UNION ALL
  SELECT d + INTERVAL 1 DAY FROM dates WHERE d < '2026-12-31'
)
SELECT d FROM dates;`,
      sqlite: `WITH RECURSIVE dates(d) AS (
  SELECT date('2026-01-01')
  UNION ALL
  SELECT date(d, '+1 day') FROM dates WHERE d < '2026-12-31'
)
SELECT d FROM dates;`,
    },
  },
  {
    id: "pat-recursive-hierarchy",
    title: "Walk a parent/child hierarchy",
    category: "patterns",
    description: "Recursive CTE down an org chart or a BOM, carrying depth and path.",
    tags: ["recursive", "hierarchy", "tree", "parent", "org chart", "bom"],
    template: true,
    sql: {
      mssql: `WITH tree AS (
  SELECT id, parent_id, name, 0 AS depth, CAST(name AS varchar(4000)) AS path
  FROM dbo.Employees
  WHERE parent_id IS NULL
  UNION ALL
  SELECT e.id, e.parent_id, e.name, t.depth + 1, CAST(t.path + ' > ' + e.name AS varchar(4000))
  FROM dbo.Employees e
  JOIN tree t ON e.parent_id = t.id
)
SELECT * FROM tree ORDER BY path;`,
      postgres: `WITH RECURSIVE tree AS (
  SELECT id, parent_id, name, 0 AS depth, name::text AS path
  FROM employees WHERE parent_id IS NULL
  UNION ALL
  SELECT e.id, e.parent_id, e.name, t.depth + 1, t.path || ' > ' || e.name
  FROM employees e JOIN tree t ON e.parent_id = t.id
)
SELECT * FROM tree ORDER BY path;`,
      mysql: `WITH RECURSIVE tree AS (
  SELECT id, parent_id, name, 0 AS depth, CAST(name AS CHAR(1000)) AS path
  FROM employees WHERE parent_id IS NULL
  UNION ALL
  SELECT e.id, e.parent_id, e.name, t.depth + 1, CONCAT(t.path, ' > ', e.name)
  FROM employees e JOIN tree t ON e.parent_id = t.id
)
SELECT * FROM tree ORDER BY path;`,
    },
  },
  {
    id: "pat-pivot",
    title: "Pivot rows into columns",
    category: "patterns",
    description: "Conditional aggregation. Portable, readable, and it beats PIVOT syntax for a fixed column list.",
    tags: ["pivot", "crosstab", "conditional aggregation", "case when"],
    template: true,
    sql: {
      mssql: `SELECT
  customer_id,
  SUM(CASE WHEN MONTH(order_date) = 1 THEN amount ELSE 0 END) AS jan,
  SUM(CASE WHEN MONTH(order_date) = 2 THEN amount ELSE 0 END) AS feb,
  SUM(CASE WHEN MONTH(order_date) = 3 THEN amount ELSE 0 END) AS mar,
  SUM(amount) AS total
FROM dbo.Orders
WHERE order_date >= '2026-01-01'
GROUP BY customer_id
ORDER BY total DESC;`,
      postgres: `SELECT
  customer_id,
  SUM(amount) FILTER (WHERE EXTRACT(month FROM order_date) = 1) AS jan,
  SUM(amount) FILTER (WHERE EXTRACT(month FROM order_date) = 2) AS feb,
  SUM(amount) FILTER (WHERE EXTRACT(month FROM order_date) = 3) AS mar,
  SUM(amount) AS total
FROM orders
WHERE order_date >= '2026-01-01'
GROUP BY customer_id
ORDER BY total DESC;`,
      mysql: `SELECT
  customer_id,
  SUM(CASE WHEN MONTH(order_date) = 1 THEN amount ELSE 0 END) AS jan,
  SUM(CASE WHEN MONTH(order_date) = 2 THEN amount ELSE 0 END) AS feb,
  SUM(CASE WHEN MONTH(order_date) = 3 THEN amount ELSE 0 END) AS mar,
  SUM(amount) AS total
FROM orders
GROUP BY customer_id
ORDER BY total DESC;`,
    },
  },
  {
    id: "pat-anti-join",
    title: "Rows with no match in another table",
    category: "patterns",
    description: "NOT EXISTS, not NOT IN — a single NULL in the subquery makes NOT IN return nothing at all.",
    tags: ["anti join", "not exists", "not in", "null", "missing"],
    template: true,
    sql: {
      mssql: `-- Customers who have never ordered.
SELECT c.*
FROM dbo.Customers c
WHERE NOT EXISTS (
  SELECT 1 FROM dbo.Orders o WHERE o.customer_id = c.id
);

-- NOT IN is a trap: if any Orders.customer_id is NULL, this returns zero rows.
-- SELECT * FROM dbo.Customers WHERE id NOT IN (SELECT customer_id FROM dbo.Orders);`,
      postgres: `SELECT c.*
FROM customers c
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id);`,
      mysql: `SELECT c.*
FROM customers c
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id);`,
      sqlite: `SELECT c.*
FROM customers c
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id);`,
    },
  },
  {
    id: "pat-upsert",
    title: "Insert or update (upsert)",
    category: "patterns",
    description: "One statement instead of a read-then-write race.",
    tags: ["upsert", "merge", "on conflict", "insert or update"],
    template: true,
    sql: {
      mssql: `MERGE dbo.Targets AS t
USING (SELECT @id AS id, @name AS name) AS s
  ON t.id = s.id
WHEN MATCHED THEN
  UPDATE SET t.name = s.name, t.updated_at = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
  INSERT (id, name) VALUES (s.id, s.name);
-- MERGE has a long history of edge-case bugs; for high-concurrency paths
-- prefer an explicit UPDATE then INSERT under a transaction.`,
      postgres: `INSERT INTO targets (id, name)
VALUES (1, 'example')
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name, updated_at = now();`,
      mysql: `INSERT INTO targets (id, name)
VALUES (1, 'example')
ON DUPLICATE KEY UPDATE name = VALUES(name), updated_at = NOW();`,
      sqlite: `INSERT INTO targets (id, name)
VALUES (1, 'example')
ON CONFLICT (id) DO UPDATE SET name = excluded.name;`,
    },
  },
  {
    id: "pat-date-buckets",
    title: "Group by day, month or hour",
    category: "patterns",
    description: "Truncate the timestamp, then group. Grouping on the raw value gives one row per row.",
    tags: ["group by", "date", "truncate", "bucket", "time series"],
    template: true,
    sql: {
      mssql: `SELECT
  CAST(created_at AS date)                                   AS by_day,
  DATEADD(hour, DATEDIFF(hour, 0, created_at), 0)            AS by_hour,
  DATEFROMPARTS(YEAR(created_at), MONTH(created_at), 1)      AS by_month,
  COUNT(*)                                                   AS n
FROM dbo.Events
GROUP BY
  CAST(created_at AS date),
  DATEADD(hour, DATEDIFF(hour, 0, created_at), 0),
  DATEFROMPARTS(YEAR(created_at), MONTH(created_at), 1)
ORDER BY by_day;`,
      postgres: `SELECT
  date_trunc('day', created_at)   AS by_day,
  date_trunc('hour', created_at)  AS by_hour,
  date_trunc('month', created_at) AS by_month,
  COUNT(*) AS n
FROM events
GROUP BY 1, 2, 3
ORDER BY by_day;`,
      mysql: `SELECT
  DATE(created_at)                        AS by_day,
  DATE_FORMAT(created_at, '%Y-%m-%d %H')  AS by_hour,
  DATE_FORMAT(created_at, '%Y-%m-01')     AS by_month,
  COUNT(*) AS n
FROM events
GROUP BY 1, 2, 3
ORDER BY by_day;`,
    },
  },
  {
    id: "pat-sargable",
    title: "Make a WHERE clause use its index",
    category: "patterns",
    description: "Wrapping the column in a function disables the index. Rewrite as a range instead.",
    tags: ["sargable", "index", "performance", "where", "function"],
    template: true,
    sql: {
      mssql: `-- Scans: the column is inside a function.
SELECT * FROM dbo.Orders WHERE YEAR(order_date) = 2026;

-- Seeks: the same rows expressed as a half-open range.
SELECT * FROM dbo.Orders
WHERE order_date >= '2026-01-01' AND order_date < '2027-01-01';

-- Same trap with strings and with implicit conversion of an nvarchar parameter
-- against a varchar column, which silently converts the whole column.`,
      postgres: `-- Scans:
SELECT * FROM orders WHERE EXTRACT(year FROM order_date) = 2026;

-- Seeks:
SELECT * FROM orders
WHERE order_date >= '2026-01-01' AND order_date < '2027-01-01';

-- Or index the expression itself:
-- CREATE INDEX ON orders ((EXTRACT(year FROM order_date)));`,
      mysql: `SELECT * FROM orders WHERE order_date >= '2026-01-01' AND order_date < '2027-01-01';`,
    },
  },
  {
    id: "pat-paging",
    title: "Keyset paging instead of OFFSET",
    category: "patterns",
    description: "OFFSET 100000 reads and discards 100000 rows. Paging by the last key read does not.",
    tags: ["paging", "keyset", "seek", "offset", "pagination", "performance"],
    template: true,
    sql: {
      mssql: `-- Page 1
SELECT TOP (50) id, created_at, name
FROM dbo.Items
ORDER BY created_at DESC, id DESC;

-- Next page: pass the last row's values back in
SELECT TOP (50) id, created_at, name
FROM dbo.Items
WHERE (created_at < @last_created_at)
   OR (created_at = @last_created_at AND id < @last_id)
ORDER BY created_at DESC, id DESC;`,
      postgres: `SELECT id, created_at, name FROM items
ORDER BY created_at DESC, id DESC
LIMIT 50;

SELECT id, created_at, name FROM items
WHERE (created_at, id) < ($1, $2)
ORDER BY created_at DESC, id DESC
LIMIT 50;`,
      mysql: `SELECT id, created_at, name FROM items
WHERE (created_at, id) < (?, ?)
ORDER BY created_at DESC, id DESC
LIMIT 50;`,
    },
  },
];

// ---------------------------------------------------------------------------
// Live activity — diagnostics, run as written
// ---------------------------------------------------------------------------

const ACTIVITY_SNIPPETS: Snippet[] = [
  {
    id: "act-running",
    title: "What is running right now",
    category: "activity",
    description: "Every active request with its SQL text, wait, elapsed time and blocker.",
    tags: ["running", "requests", "who is active", "current", "slow"],
    privileged: true,
    sql: {
      mssql: `SELECT
  r.session_id,
  r.status,
  r.blocking_session_id     AS blocked_by,
  r.wait_type,
  r.wait_time / 1000.0      AS wait_sec,
  r.total_elapsed_time / 1000.0 AS elapsed_sec,
  r.cpu_time,
  r.logical_reads,
  DB_NAME(r.database_id)    AS [database],
  s.login_name,
  s.host_name,
  s.program_name,
  SUBSTRING(t.text, (r.statement_start_offset / 2) + 1,
    ((CASE r.statement_end_offset WHEN -1 THEN DATALENGTH(t.text) ELSE r.statement_end_offset END
      - r.statement_start_offset) / 2) + 1) AS running_statement
FROM sys.dm_exec_requests r
JOIN sys.dm_exec_sessions s ON s.session_id = r.session_id
OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) t
WHERE r.session_id <> @@SPID AND s.is_user_process = 1
ORDER BY r.total_elapsed_time DESC;`,
      postgres: `SELECT
  pid,
  state,
  now() - query_start AS elapsed,
  wait_event_type,
  wait_event,
  datname AS database,
  usename,
  client_addr,
  application_name,
  query
FROM pg_stat_activity
WHERE pid <> pg_backend_pid() AND state <> 'idle'
ORDER BY query_start;`,
      mysql: `SELECT id, user, host, db, command, time AS elapsed_sec, state, info AS query
FROM information_schema.PROCESSLIST
WHERE id <> CONNECTION_ID() AND command <> 'Sleep'
ORDER BY time DESC;`,
    },
  },
  {
    id: "act-blocking-tree",
    title: "Blocking chain",
    category: "activity",
    description: "Who blocks whom, following the chain to the session at the head of it.",
    tags: ["blocking", "lock", "deadlock", "chain", "head blocker"],
    privileged: true,
    sql: {
      mssql: `WITH chain AS (
  SELECT r.session_id, r.blocking_session_id, 0 AS lvl,
         CAST(r.session_id AS varchar(200)) AS path
  FROM sys.dm_exec_requests r
  WHERE r.blocking_session_id = 0
    AND EXISTS (SELECT 1 FROM sys.dm_exec_requests b WHERE b.blocking_session_id = r.session_id)
  UNION ALL
  SELECT r.session_id, r.blocking_session_id, c.lvl + 1,
         CAST(c.path + ' > ' + CAST(r.session_id AS varchar(20)) AS varchar(200))
  FROM sys.dm_exec_requests r
  JOIN chain c ON r.blocking_session_id = c.session_id
)
SELECT
  c.lvl,
  c.path,
  c.session_id,
  c.blocking_session_id,
  r.wait_type,
  r.wait_time / 1000.0 AS wait_sec,
  r.wait_resource,
  s.login_name,
  s.host_name,
  t.text AS batch
FROM chain c
LEFT JOIN sys.dm_exec_requests r ON r.session_id = c.session_id
LEFT JOIN sys.dm_exec_sessions s ON s.session_id = c.session_id
OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) t
ORDER BY c.path;`,
      postgres: `SELECT
  blocked.pid          AS blocked_pid,
  blocked.usename      AS blocked_user,
  blocking.pid         AS blocking_pid,
  blocking.usename     AS blocking_user,
  now() - blocked.query_start AS blocked_for,
  blocked.query        AS blocked_query,
  blocking.query       AS blocking_query
FROM pg_stat_activity blocked
JOIN LATERAL unnest(pg_blocking_pids(blocked.pid)) AS blocking_pid ON true
JOIN pg_stat_activity blocking ON blocking.pid = blocking_pid
WHERE cardinality(pg_blocking_pids(blocked.pid)) > 0;`,
      mysql: `SELECT
  r.trx_id AS waiting_trx, r.trx_mysql_thread_id AS waiting_thread, r.trx_query AS waiting_query,
  b.trx_id AS blocking_trx, b.trx_mysql_thread_id AS blocking_thread, b.trx_query AS blocking_query
FROM performance_schema.data_lock_waits w
JOIN information_schema.INNODB_TRX r ON r.trx_id = w.REQUESTING_ENGINE_TRANSACTION_ID
JOIN information_schema.INNODB_TRX b ON b.trx_id = w.BLOCKING_ENGINE_TRANSACTION_ID;`,
    },
  },
  {
    id: "act-open-transactions",
    title: "Open transactions",
    category: "activity",
    description: "Long-lived transactions hold locks and stop the log from truncating.",
    tags: ["transaction", "open", "log", "uncommitted", "idle in transaction"],
    privileged: true,
    sql: {
      mssql: `SELECT
  t.session_id,
  t.transaction_id,
  at.name AS transaction_name,
  at.transaction_begin_time,
  DATEDIFF(second, at.transaction_begin_time, SYSDATETIME()) AS open_sec,
  CASE at.transaction_state
    WHEN 2 THEN 'active' WHEN 3 THEN 'read-only ended' WHEN 4 THEN 'distributed'
    ELSE CAST(at.transaction_state AS varchar(10)) END AS state,
  s.login_name, s.host_name, s.program_name,
  txt.text AS last_batch
FROM sys.dm_tran_session_transactions t
JOIN sys.dm_tran_active_transactions at ON at.transaction_id = t.transaction_id
LEFT JOIN sys.dm_exec_sessions s ON s.session_id = t.session_id
OUTER APPLY (
  SELECT TOP (1) text FROM sys.dm_exec_connections c
  CROSS APPLY sys.dm_exec_sql_text(c.most_recent_sql_handle)
  WHERE c.session_id = t.session_id
) txt
ORDER BY at.transaction_begin_time;`,
      postgres: `SELECT pid, usename, state, xact_start,
       now() - xact_start AS open_for, query
FROM pg_stat_activity
WHERE xact_start IS NOT NULL
ORDER BY xact_start;`,
      mysql: `SELECT trx_id, trx_state, trx_started,
       TIMESTAMPDIFF(SECOND, trx_started, NOW()) AS open_sec,
       trx_mysql_thread_id, trx_rows_locked, trx_query
FROM information_schema.INNODB_TRX
ORDER BY trx_started;`,
    },
  },
  {
    id: "act-connections-by-source",
    title: "Connections by login, host and app",
    category: "activity",
    description: "Where the connections come from — the first thing to check when the pool is exhausted.",
    tags: ["connections", "pool", "login", "host", "sessions"],
    privileged: true,
    sql: {
      mssql: `SELECT
  login_name, host_name, program_name,
  COUNT(*) AS sessions,
  SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
  SUM(CASE WHEN status = 'sleeping' THEN 1 ELSE 0 END) AS sleeping
FROM sys.dm_exec_sessions
WHERE is_user_process = 1
GROUP BY login_name, host_name, program_name
ORDER BY sessions DESC;`,
      postgres: `SELECT usename, client_addr, application_name, state, COUNT(*) AS sessions
FROM pg_stat_activity
GROUP BY usename, client_addr, application_name, state
ORDER BY sessions DESC;`,
      mysql: `SELECT user, SUBSTRING_INDEX(host, ':', 1) AS host, db, command, COUNT(*) AS sessions
FROM information_schema.PROCESSLIST
GROUP BY user, SUBSTRING_INDEX(host, ':', 1), db, command
ORDER BY sessions DESC;`,
    },
  },
];

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

const PERFORMANCE_SNIPPETS: Snippet[] = [
  {
    id: "perf-top-queries",
    title: "Most expensive queries",
    category: "performance",
    description: "Ranked by total worker time since the cache was last cleared, with per-execution averages.",
    tags: ["slow query", "expensive", "cpu", "top", "query stats", "tuning"],
    privileged: true,
    sql: {
      mssql: `SELECT TOP 25
  qs.execution_count,
  qs.total_worker_time / 1000                        AS total_cpu_ms,
  qs.total_worker_time / qs.execution_count / 1000   AS avg_cpu_ms,
  qs.total_elapsed_time / qs.execution_count / 1000  AS avg_elapsed_ms,
  qs.total_logical_reads / qs.execution_count        AS avg_reads,
  qs.total_rows / qs.execution_count                 AS avg_rows,
  qs.last_execution_time,
  DB_NAME(t.dbid)                                    AS [database],
  SUBSTRING(t.text, (qs.statement_start_offset / 2) + 1,
    ((CASE qs.statement_end_offset WHEN -1 THEN DATALENGTH(t.text) ELSE qs.statement_end_offset END
      - qs.statement_start_offset) / 2) + 1)         AS statement_text
FROM sys.dm_exec_query_stats qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) t
ORDER BY qs.total_worker_time DESC;`,
      postgres: `-- Needs the pg_stat_statements extension:
--   CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
SELECT
  calls,
  round(total_exec_time)::bigint      AS total_ms,
  round(mean_exec_time)::bigint       AS avg_ms,
  rows / GREATEST(calls, 1)           AS avg_rows,
  query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 25;`,
      mysql: `SELECT
  COUNT_STAR                                AS calls,
  ROUND(SUM_TIMER_WAIT / 1000000000)        AS total_ms,
  ROUND(AVG_TIMER_WAIT / 1000000000)        AS avg_ms,
  SUM_ROWS_EXAMINED / GREATEST(COUNT_STAR,1) AS avg_rows_examined,
  DIGEST_TEXT
FROM performance_schema.events_statements_summary_by_digest
ORDER BY SUM_TIMER_WAIT DESC
LIMIT 25;`,
    },
  },
  {
    id: "perf-waits",
    title: "Top waits",
    category: "performance",
    description: "What the server spends its time waiting on, with the routine background waits filtered out.",
    tags: ["wait stats", "bottleneck", "waits", "tuning", "diagnose"],
    privileged: true,
    sql: {
      mssql: `SELECT TOP 20
  wait_type,
  waiting_tasks_count,
  wait_time_ms,
  wait_time_ms - signal_wait_time_ms AS resource_wait_ms,
  signal_wait_time_ms                AS cpu_queue_ms,
  max_wait_time_ms,
  CAST(100.0 * wait_time_ms / NULLIF(SUM(wait_time_ms) OVER (), 0) AS decimal(5,2)) AS pct
FROM sys.dm_os_wait_stats
WHERE wait_time_ms > 0
  AND wait_type NOT IN (
    'CLR_SEMAPHORE','LAZYWRITER_SLEEP','RESOURCE_QUEUE','SLEEP_TASK','SLEEP_SYSTEMTASK',
    'SQLTRACE_BUFFER_FLUSH','WAITFOR','LOGMGR_QUEUE','CHECKPOINT_QUEUE','REQUEST_FOR_DEADLOCK_SEARCH',
    'XE_TIMER_EVENT','BROKER_TO_FLUSH','BROKER_TASK_STOP','CLR_MANUAL_EVENT','CLR_AUTO_EVENT',
    'DISPATCHER_QUEUE_SEMAPHORE','FT_IFTS_SCHEDULER_IDLE_WAIT','XE_DISPATCHER_WAIT','XE_DISPATCHER_JOIN',
    'SQLTRACE_INCREMENTAL_FLUSH_SLEEP','HADR_FILESTREAM_IOMGR_IOCOMPLETION','DIRTY_PAGE_POLL',
    'SP_SERVER_DIAGNOSTICS_SLEEP','QDS_ASYNC_QUEUE','QDS_PERSIST_TASK_MAIN_LOOP_SLEEP','SLEEP_DBSTARTUP'
  )
ORDER BY wait_time_ms DESC;`,
      postgres: `SELECT wait_event_type, wait_event, COUNT(*) AS sessions
FROM pg_stat_activity
WHERE wait_event IS NOT NULL
GROUP BY wait_event_type, wait_event
ORDER BY sessions DESC;`,
    },
  },
  {
    id: "perf-cache-hit",
    title: "Cache hit ratio and memory",
    category: "performance",
    description: "How much of the workload is served from memory. A falling ratio means more disk reads.",
    tags: ["cache", "buffer", "memory", "hit ratio", "page life expectancy"],
    privileged: true,
    sql: {
      mssql: `SELECT
  MAX(CASE WHEN counter_name LIKE 'Buffer cache hit ratio%' THEN cntr_value END)      AS buffer_hit,
  MAX(CASE WHEN counter_name LIKE 'Buffer cache hit ratio base%' THEN cntr_value END) AS buffer_hit_base,
  MAX(CASE WHEN counter_name LIKE 'Page life expectancy%' THEN cntr_value END)        AS page_life_sec,
  MAX(CASE WHEN counter_name LIKE 'Total Server Memory (KB)%' THEN cntr_value END) / 1024 AS total_memory_mb,
  MAX(CASE WHEN counter_name LIKE 'Target Server Memory (KB)%' THEN cntr_value END) / 1024 AS target_memory_mb
FROM sys.dm_os_performance_counters
WHERE counter_name LIKE 'Buffer cache hit ratio%'
   OR counter_name LIKE 'Page life expectancy%'
   OR counter_name LIKE 'Total Server Memory (KB)%'
   OR counter_name LIKE 'Target Server Memory (KB)%';`,
      postgres: `SELECT
  datname,
  blks_hit,
  blks_read,
  round(100.0 * blks_hit / NULLIF(blks_hit + blks_read, 0), 2) AS cache_hit_pct,
  xact_commit,
  xact_rollback,
  deadlocks,
  temp_files,
  pg_size_pretty(temp_bytes) AS temp_written
FROM pg_stat_database
WHERE datname = current_database();`,
      mysql: `SELECT
  VARIABLE_NAME, VARIABLE_VALUE
FROM performance_schema.global_status
WHERE VARIABLE_NAME IN (
  'Innodb_buffer_pool_read_requests','Innodb_buffer_pool_reads',
  'Innodb_buffer_pool_pages_free','Innodb_buffer_pool_pages_total',
  'Threads_connected','Threads_running','Slow_queries','Uptime'
);`,
    },
  },
  {
    id: "perf-tempdb",
    title: "TempDB usage by session",
    category: "performance",
    description: "Which sessions are burning TempDB — spills, big sorts and version store growth show here.",
    tags: ["tempdb", "spill", "sort", "version store", "space"],
    privileged: true,
    sql: {
      mssql: `SELECT
  su.session_id,
  s.login_name,
  s.program_name,
  (su.user_objects_alloc_page_count - su.user_objects_dealloc_page_count) * 8 / 1024.0     AS user_mb,
  (su.internal_objects_alloc_page_count - su.internal_objects_dealloc_page_count) * 8 / 1024.0 AS internal_mb,
  t.text AS last_batch
FROM sys.dm_db_session_space_usage su
LEFT JOIN sys.dm_exec_sessions s ON s.session_id = su.session_id
OUTER APPLY (
  SELECT TOP (1) text FROM sys.dm_exec_connections c
  CROSS APPLY sys.dm_exec_sql_text(c.most_recent_sql_handle)
  WHERE c.session_id = su.session_id
) t
WHERE su.user_objects_alloc_page_count + su.internal_objects_alloc_page_count > 0
ORDER BY internal_mb DESC;`,
    },
  },
];

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

const INDEX_SNIPPETS: Snippet[] = [
  {
    id: "idx-missing",
    title: "Missing index suggestions",
    category: "indexes",
    description: "The engine's own suggestions, ranked by estimated benefit. Advice, not instructions — read the columns first.",
    tags: ["missing index", "create index", "tuning", "suggestion"],
    privileged: true,
    sql: {
      mssql: `SELECT TOP 25
  CAST(migs.avg_total_user_cost * migs.avg_user_impact * (migs.user_seeks + migs.user_scans) AS bigint) AS impact_score,
  migs.user_seeks,
  migs.user_scans,
  migs.avg_user_impact,
  migs.last_user_seek,
  OBJECT_NAME(mid.object_id, mid.database_id) AS [table],
  mid.equality_columns,
  mid.inequality_columns,
  mid.included_columns,
  'CREATE INDEX IX_' + OBJECT_NAME(mid.object_id, mid.database_id) + '_todo ON '
    + mid.statement + ' ('
    + ISNULL(mid.equality_columns, '')
    + CASE WHEN mid.equality_columns IS NOT NULL AND mid.inequality_columns IS NOT NULL THEN ',' ELSE '' END
    + ISNULL(mid.inequality_columns, '') + ')'
    + ISNULL(' INCLUDE (' + mid.included_columns + ')', '') AS draft_ddl
FROM sys.dm_db_missing_index_group_stats migs
JOIN sys.dm_db_missing_index_groups mig ON mig.index_group_handle = migs.group_handle
JOIN sys.dm_db_missing_index_details mid ON mid.index_handle = mig.index_handle
WHERE mid.database_id = DB_ID()
ORDER BY impact_score DESC;`,
      postgres: `-- Postgres has no missing-index DMV. Sequential scans on big tables are the signal:
SELECT
  relname AS table,
  seq_scan,
  seq_tup_read,
  seq_tup_read / GREATEST(seq_scan, 1) AS avg_rows_per_scan,
  idx_scan,
  pg_size_pretty(pg_relation_size(relid)) AS size
FROM pg_stat_user_tables
WHERE seq_scan > 0
ORDER BY seq_tup_read DESC
LIMIT 25;`,
    },
  },
  {
    id: "idx-unused",
    title: "Unused and write-only indexes",
    category: "indexes",
    description: "Indexes that cost writes and return nothing. Check uptime first — stats reset when the service restarts.",
    tags: ["unused index", "drop index", "write overhead", "cleanup"],
    privileged: true,
    sql: {
      mssql: `SELECT
  DB_NAME()                       AS [database],
  OBJECT_SCHEMA_NAME(i.object_id) AS [schema],
  OBJECT_NAME(i.object_id)        AS [table],
  i.name                          AS index_name,
  i.type_desc,
  s.user_seeks, s.user_scans, s.user_lookups,
  s.user_updates                  AS writes_maintained,
  s.last_user_seek, s.last_user_scan,
  (SELECT sqlserver_start_time FROM sys.dm_os_sys_info) AS stats_since,
  'DROP INDEX ' + QUOTENAME(i.name) + ' ON '
    + QUOTENAME(OBJECT_SCHEMA_NAME(i.object_id)) + '.' + QUOTENAME(OBJECT_NAME(i.object_id)) AS draft_ddl
FROM sys.indexes i
LEFT JOIN sys.dm_db_index_usage_stats s
  ON s.object_id = i.object_id AND s.index_id = i.index_id AND s.database_id = DB_ID()
WHERE i.type_desc = 'NONCLUSTERED'
  AND i.is_primary_key = 0 AND i.is_unique_constraint = 0
  AND OBJECTPROPERTY(i.object_id, 'IsUserTable') = 1
  AND ISNULL(s.user_seeks, 0) + ISNULL(s.user_scans, 0) + ISNULL(s.user_lookups, 0) = 0
ORDER BY s.user_updates DESC;`,
      postgres: `SELECT
  schemaname AS schema,
  relname    AS table,
  indexrelname AS index_name,
  idx_scan,
  pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM pg_stat_user_indexes ui
JOIN pg_index i ON i.indexrelid = ui.indexrelid
WHERE idx_scan = 0 AND NOT i.indisunique AND NOT i.indisprimary
ORDER BY pg_relation_size(indexrelid) DESC;`,
      mysql: `SELECT * FROM sys.schema_unused_indexes;`,
    },
  },
  {
    id: "idx-duplicates",
    title: "Duplicate and overlapping indexes",
    category: "indexes",
    description: "Indexes whose leading columns match another's — one of the pair is usually dead weight.",
    tags: ["duplicate index", "overlapping", "redundant", "cleanup"],
    privileged: true,
    sql: {
      mssql: `WITH idx AS (
  SELECT
    i.object_id,
    i.index_id,
    i.name,
    OBJECT_SCHEMA_NAME(i.object_id) AS [schema],
    OBJECT_NAME(i.object_id)        AS [table],
    STUFF((
      SELECT ',' + c.name
      FROM sys.index_columns ic
      JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
      WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0
      ORDER BY ic.key_ordinal
      FOR XML PATH('')), 1, 1, '') AS key_columns
  FROM sys.indexes i
  WHERE i.type_desc IN ('CLUSTERED', 'NONCLUSTERED')
    AND OBJECTPROPERTY(i.object_id, 'IsUserTable') = 1
)
SELECT a.[schema], a.[table], a.name AS index_a, b.name AS index_b, a.key_columns
FROM idx a
JOIN idx b ON a.object_id = b.object_id AND a.index_id < b.index_id
WHERE a.key_columns IS NOT NULL
  AND (b.key_columns = a.key_columns OR b.key_columns LIKE a.key_columns + ',%')
ORDER BY a.[table], a.name;`,
    },
  },
  {
    id: "idx-fragmentation",
    title: "Index fragmentation",
    category: "indexes",
    description: "Only pages above a few thousand matter. Below 1000 pages, rebuilding is noise.",
    tags: ["fragmentation", "rebuild", "reorganize", "maintenance"],
    privileged: true,
    sql: {
      mssql: `SELECT
  OBJECT_SCHEMA_NAME(ips.object_id) AS [schema],
  OBJECT_NAME(ips.object_id)        AS [table],
  i.name                            AS index_name,
  ips.index_type_desc,
  CAST(ips.avg_fragmentation_in_percent AS decimal(5,2)) AS frag_pct,
  ips.page_count,
  ips.page_count * 8 / 1024.0       AS size_mb,
  CASE
    WHEN ips.avg_fragmentation_in_percent > 30 THEN 'REBUILD'
    WHEN ips.avg_fragmentation_in_percent > 10 THEN 'REORGANIZE'
    ELSE 'leave alone'
  END AS suggestion
FROM sys.dm_db_index_physical_stats(DB_ID(), NULL, NULL, NULL, 'LIMITED') ips
JOIN sys.indexes i ON i.object_id = ips.object_id AND i.index_id = ips.index_id
WHERE ips.page_count > 1000 AND i.name IS NOT NULL
ORDER BY ips.avg_fragmentation_in_percent DESC;`,
    },
  },
];

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const STORAGE_SNIPPETS: Snippet[] = [
  {
    id: "sto-table-sizes",
    title: "Biggest tables",
    category: "storage",
    description: "Rows, data and index size per table — where the space and the scans go.",
    tags: ["size", "biggest", "row count", "space", "growth"],
    sql: {
      mssql: `SELECT
  s.name AS [schema],
  t.name AS [table],
  p.rows AS row_count,
  SUM(a.total_pages) * 8 / 1024.0 AS total_mb,
  SUM(a.used_pages)  * 8 / 1024.0 AS used_mb,
  (SUM(a.total_pages) - SUM(a.used_pages)) * 8 / 1024.0 AS unused_mb
FROM sys.tables t
JOIN sys.schemas s     ON s.schema_id = t.schema_id
JOIN sys.indexes i     ON i.object_id = t.object_id
JOIN sys.partitions p  ON p.object_id = i.object_id AND p.index_id = i.index_id
JOIN sys.allocation_units a ON a.container_id = p.partition_id
WHERE i.index_id <= 1
GROUP BY s.name, t.name, p.rows
ORDER BY total_mb DESC;`,
      postgres: `SELECT
  schemaname AS schema,
  relname    AS table,
  n_live_tup AS approx_rows,
  pg_size_pretty(pg_total_relation_size(relid)) AS total,
  pg_size_pretty(pg_relation_size(relid))       AS heap,
  pg_size_pretty(pg_indexes_size(relid))        AS indexes
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC;`,
      mysql: `SELECT
  TABLE_SCHEMA AS \`schema\`, TABLE_NAME AS \`table\`, TABLE_ROWS AS approx_rows,
  ROUND(DATA_LENGTH / 1024 / 1024, 2)  AS data_mb,
  ROUND(INDEX_LENGTH / 1024 / 1024, 2) AS index_mb,
  ROUND((DATA_LENGTH + INDEX_LENGTH) / 1024 / 1024, 2) AS total_mb
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
ORDER BY DATA_LENGTH + INDEX_LENGTH DESC;`,
      sqlite: `SELECT name AS "table", SUM(pgsize) / 1024.0 AS kb
FROM dbstat GROUP BY name ORDER BY kb DESC;`,
    },
  },
  {
    id: "sto-files",
    title: "Data files, free space and growth",
    category: "storage",
    description: "Per-file size, free space and autogrowth setting — the check before a disk fills up.",
    tags: ["file", "autogrowth", "free space", "disk", "log"],
    privileged: true,
    sql: {
      mssql: `SELECT
  f.name              AS logical_name,
  f.type_desc,
  f.physical_name,
  f.size * 8 / 1024.0 AS size_mb,
  CAST(FILEPROPERTY(f.name, 'SpaceUsed') AS bigint) * 8 / 1024.0 AS used_mb,
  (f.size - CAST(FILEPROPERTY(f.name, 'SpaceUsed') AS bigint)) * 8 / 1024.0 AS free_mb,
  CASE WHEN f.is_percent_growth = 1
       THEN CAST(f.growth AS varchar(10)) + ' %'
       ELSE CAST(f.growth * 8 / 1024 AS varchar(10)) + ' MB' END AS autogrowth,
  CASE WHEN f.max_size = -1 THEN 'unlimited'
       ELSE CAST(f.max_size * 8 / 1024 AS varchar(20)) + ' MB' END AS max_size
FROM sys.database_files f;`,
      postgres: `SELECT
  pg_size_pretty(pg_database_size(current_database())) AS database_size,
  (SELECT count(*) FROM pg_stat_user_tables)           AS tables,
  (SELECT pg_size_pretty(sum(pg_total_relation_size(relid))) FROM pg_stat_user_tables) AS user_data;`,
    },
  },
  {
    id: "sto-growth-by-schema",
    title: "Space by schema",
    category: "storage",
    description: "Roll table sizes up per schema — useful when several applications share one database.",
    tags: ["schema", "size", "rollup", "space"],
    sql: {
      mssql: `SELECT
  s.name AS [schema],
  COUNT(DISTINCT t.object_id) AS tables,
  SUM(p.rows) AS rows,
  SUM(a.total_pages) * 8 / 1024.0 AS total_mb
FROM sys.tables t
JOIN sys.schemas s    ON s.schema_id = t.schema_id
JOIN sys.indexes i    ON i.object_id = t.object_id AND i.index_id <= 1
JOIN sys.partitions p ON p.object_id = i.object_id AND p.index_id = i.index_id
JOIN sys.allocation_units a ON a.container_id = p.partition_id
GROUP BY s.name
ORDER BY total_mb DESC;`,
      postgres: `SELECT
  schemaname AS schema,
  count(*) AS tables,
  sum(n_live_tup) AS approx_rows,
  pg_size_pretty(sum(pg_total_relation_size(relid))) AS total
FROM pg_stat_user_tables
GROUP BY schemaname
ORDER BY sum(pg_total_relation_size(relid)) DESC;`,
    },
  },
];

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA_SNIPPETS: Snippet[] = [
  {
    id: "sch-find-column",
    title: "Find a column anywhere",
    category: "schema",
    description: "Which tables have a column whose name matches — the fastest way into an unfamiliar database.",
    tags: ["find", "search", "column", "where is", "explore"],
    template: true,
    sql: {
      mssql: `SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE COLUMN_NAME LIKE '%customer%'
ORDER BY TABLE_SCHEMA, TABLE_NAME;`,
      postgres: `SELECT table_schema, table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE column_name ILIKE '%customer%'
  AND table_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY table_schema, table_name;`,
      mysql: `SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM information_schema.COLUMNS
WHERE COLUMN_NAME LIKE '%customer%' AND TABLE_SCHEMA = DATABASE()
ORDER BY TABLE_NAME;`,
      sqlite: `SELECT m.name AS "table", p.name AS column_name, p.type
FROM sqlite_master m JOIN pragma_table_info(m.name) p
WHERE m.type = 'table' AND p.name LIKE '%customer%';`,
    },
  },
  {
    id: "sch-find-text",
    title: "Find text in procedures and views",
    category: "schema",
    description: "Which routines mention a table or column — the impact check before changing one.",
    tags: ["search", "definition", "procedure", "view", "impact", "references"],
    template: true,
    sql: {
      mssql: `SELECT
  o.type_desc,
  SCHEMA_NAME(o.schema_id) AS [schema],
  o.name,
  o.modify_date
FROM sys.sql_modules m
JOIN sys.objects o ON o.object_id = m.object_id
WHERE m.definition LIKE '%UserDetails%'
ORDER BY o.type_desc, o.name;`,
      postgres: `SELECT n.nspname AS schema, p.proname AS name, 'function' AS kind
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE pg_get_functiondef(p.oid) ILIKE '%users%'
  AND n.nspname NOT IN ('pg_catalog', 'information_schema');`,
      mysql: `SELECT ROUTINE_SCHEMA, ROUTINE_NAME, ROUTINE_TYPE
FROM information_schema.ROUTINES
WHERE ROUTINE_DEFINITION LIKE '%users%' AND ROUTINE_SCHEMA = DATABASE();`,
    },
  },
  {
    id: "sch-foreign-keys",
    title: "Foreign keys in and out of a table",
    category: "schema",
    description: "What references this table, and what it references — the delete-order question.",
    tags: ["foreign key", "relationship", "references", "constraint", "erd"],
    sql: {
      mssql: `SELECT
  fk.name AS constraint_name,
  OBJECT_SCHEMA_NAME(fk.parent_object_id) + '.' + OBJECT_NAME(fk.parent_object_id) AS child_table,
  pc.name AS child_column,
  OBJECT_SCHEMA_NAME(fk.referenced_object_id) + '.' + OBJECT_NAME(fk.referenced_object_id) AS parent_table,
  rc.name AS parent_column,
  fk.delete_referential_action_desc AS on_delete,
  fk.update_referential_action_desc AS on_update,
  fk.is_disabled,
  fk.is_not_trusted
FROM sys.foreign_keys fk
JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
ORDER BY parent_table, child_table;`,
      postgres: `SELECT
  con.conname AS constraint_name,
  child.relname  AS child_table,
  parent.relname AS parent_table,
  pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class child  ON child.oid = con.conrelid
JOIN pg_class parent ON parent.oid = con.confrelid
WHERE con.contype = 'f'
ORDER BY parent.relname, child.relname;`,
      mysql: `SELECT
  CONSTRAINT_NAME, TABLE_NAME AS child_table, COLUMN_NAME AS child_column,
  REFERENCED_TABLE_NAME AS parent_table, REFERENCED_COLUMN_NAME AS parent_column
FROM information_schema.KEY_COLUMN_USAGE
WHERE REFERENCED_TABLE_NAME IS NOT NULL AND TABLE_SCHEMA = DATABASE()
ORDER BY parent_table, child_table;`,
    },
  },
  {
    id: "sch-heaps-no-pk",
    title: "Tables with no primary key",
    category: "schema",
    description: "Heaps and PK-less tables — they break replication, upserts and most tooling.",
    tags: ["primary key", "heap", "missing pk", "audit", "hygiene"],
    sql: {
      mssql: `SELECT
  s.name AS [schema],
  t.name AS [table],
  p.rows AS row_count,
  CASE WHEN i.type_desc = 'HEAP' THEN 'heap (no clustered index)' ELSE i.type_desc END AS storage
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id = t.schema_id
JOIN sys.indexes i ON i.object_id = t.object_id AND i.index_id <= 1
JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id = i.index_id
WHERE NOT EXISTS (SELECT 1 FROM sys.indexes pk WHERE pk.object_id = t.object_id AND pk.is_primary_key = 1)
ORDER BY p.rows DESC;`,
      postgres: `SELECT n.nspname AS schema, c.relname AS table, c.reltuples::bigint AS approx_rows
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indisprimary)
ORDER BY c.reltuples DESC;`,
      mysql: `SELECT t.TABLE_NAME, t.TABLE_ROWS
FROM information_schema.TABLES t
LEFT JOIN information_schema.TABLE_CONSTRAINTS tc
  ON tc.TABLE_SCHEMA = t.TABLE_SCHEMA AND tc.TABLE_NAME = t.TABLE_NAME
 AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
WHERE t.TABLE_SCHEMA = DATABASE() AND t.TABLE_TYPE = 'BASE TABLE' AND tc.CONSTRAINT_NAME IS NULL;`,
    },
  },
  {
    id: "sch-recent-changes",
    title: "Recently changed objects",
    category: "schema",
    description: "What was altered lately — the first question after \"it worked yesterday\".",
    tags: ["changed", "modified", "deploy", "recent", "audit"],
    sql: {
      mssql: `SELECT TOP 50
  SCHEMA_NAME(schema_id) AS [schema],
  name,
  type_desc,
  create_date,
  modify_date
FROM sys.objects
WHERE is_ms_shipped = 0
ORDER BY modify_date DESC;`,
      postgres: `-- Postgres keeps no per-object modify timestamp; the closest signal is
-- the last statistics reset and recent DDL in the log.
SELECT schemaname AS schema, relname AS table, last_analyze, last_autoanalyze, last_vacuum
FROM pg_stat_user_tables
ORDER BY GREATEST(COALESCE(last_analyze, 'epoch'), COALESCE(last_autoanalyze, 'epoch')) DESC
LIMIT 50;`,
      mysql: `SELECT TABLE_NAME, CREATE_TIME, UPDATE_TIME
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
ORDER BY COALESCE(UPDATE_TIME, CREATE_TIME) DESC
LIMIT 50;`,
    },
  },
];

// ---------------------------------------------------------------------------
// Maintenance
// ---------------------------------------------------------------------------

const MAINTENANCE_SNIPPETS: Snippet[] = [
  {
    id: "mnt-backups",
    title: "Last backup per database",
    category: "maintenance",
    description: "Age of the most recent full, differential and log backup. The one check nobody regrets.",
    tags: ["backup", "restore", "rpo", "msdb", "disaster recovery"],
    privileged: true,
    sql: {
      mssql: `SELECT
  d.name AS [database],
  d.recovery_model_desc,
  MAX(CASE WHEN b.type = 'D' THEN b.backup_finish_date END) AS last_full,
  MAX(CASE WHEN b.type = 'I' THEN b.backup_finish_date END) AS last_differential,
  MAX(CASE WHEN b.type = 'L' THEN b.backup_finish_date END) AS last_log,
  DATEDIFF(hour, MAX(CASE WHEN b.type = 'D' THEN b.backup_finish_date END), GETDATE()) AS full_age_hours
FROM sys.databases d
LEFT JOIN msdb.dbo.backupset b ON b.database_name = d.name
WHERE d.database_id > 4
GROUP BY d.name, d.recovery_model_desc
ORDER BY full_age_hours DESC;`,
    },
  },
  {
    id: "mnt-jobs",
    title: "Agent job outcomes",
    category: "maintenance",
    description: "Last run status per job, failures first.",
    tags: ["agent", "job", "schedule", "failed", "msdb"],
    privileged: true,
    sql: {
      mssql: `SELECT
  j.name AS job_name,
  j.enabled,
  CASE h.run_status
    WHEN 0 THEN 'failed' WHEN 1 THEN 'succeeded' WHEN 2 THEN 'retry'
    WHEN 3 THEN 'cancelled' ELSE 'in progress' END AS last_status,
  msdb.dbo.agent_datetime(h.run_date, h.run_time) AS last_run,
  STUFF(STUFF(RIGHT('000000' + CAST(h.run_duration AS varchar(6)), 6), 3, 0, ':'), 6, 0, ':') AS duration,
  h.message
FROM msdb.dbo.sysjobs j
OUTER APPLY (
  SELECT TOP (1) * FROM msdb.dbo.sysjobhistory hh
  WHERE hh.job_id = j.job_id AND hh.step_id = 0
  ORDER BY hh.run_date DESC, hh.run_time DESC
) h
ORDER BY CASE WHEN h.run_status = 0 THEN 0 ELSE 1 END, j.name;`,
    },
  },
  {
    id: "mnt-stats-stale",
    title: "Stale statistics",
    category: "maintenance",
    description: "Statistics well behind the row count make the optimizer guess badly.",
    tags: ["statistics", "stale", "update statistics", "cardinality", "plan"],
    privileged: true,
    sql: {
      mssql: `SELECT
  OBJECT_SCHEMA_NAME(s.object_id) AS [schema],
  OBJECT_NAME(s.object_id)        AS [table],
  s.name                          AS stat_name,
  sp.last_updated,
  sp.rows,
  sp.rows_sampled,
  sp.modification_counter,
  CAST(100.0 * sp.modification_counter / NULLIF(sp.rows, 0) AS decimal(6,2)) AS pct_changed
FROM sys.stats s
CROSS APPLY sys.dm_db_stats_properties(s.object_id, s.stats_id) sp
WHERE OBJECTPROPERTY(s.object_id, 'IsUserTable') = 1
  AND sp.rows > 1000
  AND sp.modification_counter > 0
ORDER BY pct_changed DESC;`,
      postgres: `SELECT
  schemaname AS schema, relname AS table,
  n_live_tup, n_dead_tup,
  round(100.0 * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0), 2) AS dead_pct,
  last_analyze, last_autoanalyze, last_vacuum, last_autovacuum
FROM pg_stat_user_tables
WHERE n_dead_tup > 0
ORDER BY n_dead_tup DESC;`,
    },
  },
  {
    id: "mnt-integrity",
    title: "Integrity and configuration check",
    category: "maintenance",
    description: "Quick health facts: uptime, recovery model, auto-shrink and other settings that bite later.",
    tags: ["integrity", "config", "uptime", "auto shrink", "health"],
    privileged: true,
    sql: {
      mssql: `SELECT
  DB_NAME()                       AS [database],
  d.recovery_model_desc,
  d.state_desc,
  d.is_auto_shrink_on,
  d.is_auto_close_on,
  d.is_read_only,
  d.page_verify_option_desc,
  d.compatibility_level,
  d.snapshot_isolation_state_desc,
  d.is_read_committed_snapshot_on,
  (SELECT sqlserver_start_time FROM sys.dm_os_sys_info) AS server_started,
  (SELECT cpu_count FROM sys.dm_os_sys_info)            AS cpu_count,
  (SELECT physical_memory_kb / 1024 FROM sys.dm_os_sys_info) AS memory_mb
FROM sys.databases d
WHERE d.database_id = DB_ID();`,
      postgres: `SELECT
  current_database() AS database,
  version()          AS version,
  pg_postmaster_start_time() AS started,
  current_setting('max_connections') AS max_connections,
  current_setting('shared_buffers')  AS shared_buffers,
  current_setting('work_mem')        AS work_mem;`,
      sqlite: `PRAGMA integrity_check;`,
    },
  },
];

export const SNIPPETS: Snippet[] = [
  ...WINDOW_SNIPPETS,
  ...PATTERN_SNIPPETS,
  ...ACTIVITY_SNIPPETS,
  ...PERFORMANCE_SNIPPETS,
  ...INDEX_SNIPPETS,
  ...STORAGE_SNIPPETS,
  ...SCHEMA_SNIPPETS,
  ...MAINTENANCE_SNIPPETS,
];

/** SQL for this engine, or null when the snippet was not written for it. */
export function snippetSql(snippet: Snippet, engine: DbEngine): string | null {
  return snippet.sql[engine] ?? null;
}

/** Every snippet available for an engine, catalog order preserved. */
export function snippetsFor(engine: DbEngine): Snippet[] {
  return SNIPPETS.filter((s) => s.sql[engine] !== undefined);
}

/**
 * Search by title, description and tags.
 *
 * Every term must match somewhere, so extra words narrow rather than widen —
 * "index unused" finds the one entry, not everything about indexes.
 */
export function searchSnippets(engine: DbEngine, query: string): Snippet[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const pool = snippetsFor(engine);
  if (terms.length === 0) return pool;
  return pool.filter((s) => {
    const haystack = `${s.title} ${s.description} ${s.tags.join(" ")} ${CATEGORY_LABELS[s.category]}`.toLowerCase();
    return terms.every((t) => haystack.includes(t));
  });
}

/** Snippets grouped by category, empty categories dropped. */
export function snippetsByCategory(snippets: Snippet[]): { category: SnippetCategory; items: Snippet[] }[] {
  const order = Object.keys(CATEGORY_LABELS) as SnippetCategory[];
  return order
    .map((category) => ({ category, items: snippets.filter((s) => s.category === category) }))
    .filter((g) => g.items.length > 0);
}

/** The diagnostics the health dashboard offers for an engine. */
export function diagnosticsFor(engine: DbEngine): Snippet[] {
  return snippetsFor(engine).filter((s) => DIAGNOSTIC_CATEGORIES.includes(s.category) && !s.template);
}
