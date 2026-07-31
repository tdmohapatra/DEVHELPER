import type { Question } from "./types";

/** SQL, indexing, transactions and tuning — the database half of a backend interview. */
export const DATABASE_QUESTIONS: Question[] = [
  {
    id: "db-index-how",
    topic: "database",
    subtopic: "Indexing",
    level: "intermediate",
    mustKnow: true,
    question: "How does an index work, and when does it make things worse?",
    answer: `An index is a B-tree sorted by its key columns. Instead of scanning every row, the engine descends the tree — O(log n) instead of O(n).

- **Clustered index** — *is* the table; rows are stored in its order. One per table.
- **Non-clustered index** — a separate structure holding key columns plus a pointer back to the row.

Indexes make things worse when:

- Writes dominate — every INSERT/UPDATE/DELETE must maintain every index.
- The index is unselective (a \`Gender\` column) — the engine ignores it and scans anyway.
- There are too many, overlapping — storage, memory and maintenance for no gain.
- A query is not **SARGable**: wrapping the column in a function prevents the index being used at all.`,
    language: "sql",
    code: `-- Not SARGable: the function hides the column from the index
SELECT * FROM Orders WHERE YEAR(CreatedAt) = 2026;

-- SARGable: a range the index can seek
SELECT * FROM Orders WHERE CreatedAt >= '2026-01-01' AND CreatedAt < '2027-01-01';

-- Composite index: order matters, most selective and equality columns first
CREATE INDEX IX_Orders_Customer_Created ON Orders (CustomerId, CreatedAt DESC)
    INCLUDE (Status, Total);   -- covering: the query never touches the table

-- Uses the index:            WHERE CustomerId = 5 AND CreatedAt > '...'
-- Cannot seek efficiently:   WHERE CreatedAt > '...'   (leading column missing)`,
    diagram: `B-tree seek vs table scan

      [ 50 | 100 ]           <- root
       /     |     \\
  [10|30] [60|80] [120|150]  <- intermediate
    |       |        |
  leaves -> actual rows / row pointers

Scan:  read every page          O(n)
Seek:  3-4 page reads           O(log n)`,
    followUps: [
      {
        question: "What is a covering index?",
        answer:
          "One that contains every column a query needs, in key or INCLUDE columns, so the engine never looks up the base table. It removes the key-lookup step that often dominates cost.",
      },
      {
        question: "Why does the column order in a composite index matter?",
        answer:
          "The index is sorted by the first column, then the second within it. A query filtering only on the second column cannot seek — like looking up a phone book by first name.",
      },
    ],
    tags: ["index", "b-tree", "sargable", "covering index", "performance"],
  },
  {
    id: "db-joins",
    topic: "database",
    subtopic: "SQL",
    level: "basic",
    mustKnow: true,
    question: "Explain the join types with an example.",
    answer: `- **INNER JOIN** — rows matching in both tables.
- **LEFT JOIN** — every left row; NULLs where the right has no match.
- **RIGHT JOIN** — the mirror image; rarely used, rewrite as LEFT.
- **FULL OUTER JOIN** — everything from both, NULLs where either side is missing.
- **CROSS JOIN** — Cartesian product.
- **Self join** — a table to itself, for hierarchies such as employee → manager.

The classic bug: a LEFT JOIN turned into an INNER JOIN by putting the right table's condition in the WHERE clause instead of the ON clause, because \`WHERE right.col = x\` discards the NULL rows.`,
    language: "sql",
    code: `-- Accidentally an INNER JOIN: customers with no orders are filtered out
SELECT c.Name, o.Total
FROM Customers c
LEFT JOIN Orders o ON o.CustomerId = c.Id
WHERE o.Status = 'Paid';

-- Correct: the condition belongs to the join
SELECT c.Name, o.Total
FROM Customers c
LEFT JOIN Orders o ON o.CustomerId = c.Id AND o.Status = 'Paid';

-- Customers with no orders at all
SELECT c.Name
FROM Customers c
LEFT JOIN Orders o ON o.CustomerId = c.Id
WHERE o.Id IS NULL;`,
    followUps: [
      {
        question: "What is the difference between UNION and UNION ALL?",
        answer:
          "UNION removes duplicates, which requires a sort or hash. UNION ALL just concatenates and is much cheaper. Use ALL unless you actually need deduplication.",
      },
    ],
    tags: ["sql", "joins", "left join", "null"],
  },
  {
    id: "db-acid-isolation",
    topic: "database",
    subtopic: "Transactions",
    level: "intermediate",
    mustKnow: true,
    question: "What are ACID and the isolation levels?",
    answer: `**ACID** — Atomicity (all or nothing), Consistency (constraints hold), Isolation (concurrent transactions do not corrupt each other), Durability (committed data survives a crash).

Isolation levels trade correctness against concurrency:

| Level | Dirty read | Non-repeatable read | Phantom |
|---|---|---|---|
| Read Uncommitted | possible | possible | possible |
| Read Committed | no | possible | possible |
| Repeatable Read | no | no | possible |
| Serializable | no | no | no |
| Snapshot | no | no | no (uses versions, not locks) |

SQL Server defaults to Read Committed and blocks readers behind writers unless \`READ_COMMITTED_SNAPSHOT\` is on. PostgreSQL uses MVCC, so readers never block writers.`,
    language: "sql",
    code: `-- The anomaly Repeatable Read prevents
BEGIN TRANSACTION;
SELECT Balance FROM Accounts WHERE Id = 1;   -- 1000
-- another transaction commits an update here
SELECT Balance FROM Accounts WHERE Id = 1;   -- 900 under Read Committed
COMMIT;

-- Safe decrement without a read-then-write race
UPDATE Accounts
SET    Balance = Balance - 100
WHERE  Id = 1 AND Balance >= 100;            -- one atomic statement
-- Check @@ROWCOUNT / affected rows to know whether it applied`,
    followUps: [
      {
        question: "What is a deadlock and how do you avoid it?",
        answer:
          "Two transactions each hold a lock the other needs. Avoid it by always taking locks in the same order, keeping transactions short, and never waiting for user input inside one. The engine kills one as a victim; the app should retry.",
      },
      {
        question: "Optimistic vs pessimistic concurrency?",
        answer:
          "Pessimistic locks the row up front — safe, but blocks. Optimistic reads a version/rowversion and fails the update if it changed, then retries. EF Core's concurrency token is the optimistic approach.",
      },
    ],
    tags: ["acid", "isolation", "transactions", "locking", "mvcc"],
  },
  {
    id: "db-normalization",
    topic: "database",
    subtopic: "Modelling",
    level: "basic",
    question: "Explain normalisation, and when you would denormalise.",
    answer: `- **1NF** — atomic values, no repeating groups (no comma-separated lists in a column).
- **2NF** — 1NF plus no partial dependency on part of a composite key.
- **3NF** — 2NF plus no transitive dependency: non-key columns depend only on the key.

Normalisation removes duplication, so updates happen in one place and anomalies disappear.

**Denormalise deliberately** when read performance demands it: a stored \`OrderTotal\`, a copy of the product name on the order line (which must *not* change when the product is renamed — that is history, not duplication), or a reporting table. Every denormalisation is a promise to keep two copies in step.`,
    diagram: `Normalised                        Denormalised (reporting)
+-----------+   +-------------+     +-----------------------------+
| Orders    |   | OrderLines  |     | OrderSummary                |
|-----------|   |-------------|     |-----------------------------|
| Id        |<--| OrderId     |     | OrderId, Customer, Total,    |
| CustomerId|   | ProductId   |     | LineCount, ProductNames      |
+-----------+   | Qty, Price  |     +-----------------------------+
                +-------------+       fast reads, must be kept in step`,
    followUps: [
      {
        question: "Where do you keep a total — computed or stored?",
        answer:
          "Compute it while the data is small and the query is cheap. Store it when the computation is expensive or the value is historical (an invoice total must not change when prices change). If stored, update it in the same transaction.",
      },
    ],
    tags: ["normalization", "3nf", "denormalization", "modelling"],
  },
  {
    id: "db-execution-plan",
    topic: "database",
    subtopic: "Tuning",
    level: "advanced",
    mustKnow: true,
    question: "A query is slow. How do you diagnose it?",
    answer: `A method, not a guess:

1. **Measure** — capture the actual duration, and how often it runs. A 50 ms query running 10,000 times is the real problem.
2. **Read the execution plan** — look for table/index **scans** where a seek is expected, **key lookups**, **sorts** and **hash matches** on large inputs, and a big gap between estimated and actual rows (stale statistics or a non-SARGable predicate).
3. **Check the indexes** — is there one that matches the predicate and the sort order?
4. **Look at the query** — \`SELECT *\`, functions on columns, implicit conversions (\`nvarchar\` compared to \`varchar\` kills a seek), \`OR\` across columns, and correlated subqueries in the SELECT list.
5. **Check blocking** — slow can mean waiting, not working. Look at wait types and blocking sessions.
6. **Only then** consider hints, plan guides or rewriting into a temp table.`,
    language: "sql",
    code: `-- SQL Server
SET STATISTICS IO, TIME ON;
-- then read logical reads per table; that is the cost that matters

-- What is running right now, and what is blocking it
SELECT r.session_id, r.status, r.wait_type, r.blocking_session_id,
       DB_NAME(r.database_id) AS db, t.text
FROM sys.dm_exec_requests r
CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t
WHERE r.session_id <> @@SPID;

-- PostgreSQL
EXPLAIN (ANALYZE, BUFFERS) SELECT ...;`,
    followUps: [
      {
        question: "What is parameter sniffing?",
        answer:
          "The engine caches a plan built for the first parameter value. A skewed distribution then makes that plan terrible for other values. Mitigations: `OPTIMIZE FOR`, `RECOMPILE`, local variables, or splitting into separate queries.",
      },
      {
        question: "Why is `SELECT *` a problem beyond bandwidth?",
        answer:
          "It defeats covering indexes, forcing key lookups; it breaks when columns are added or reordered; and it pulls large columns you never use.",
      },
    ],
    tags: ["execution plan", "tuning", "statistics", "blocking", "sargable"],
  },
  {
    id: "db-sql-nosql",
    topic: "database",
    subtopic: "Modelling",
    level: "intermediate",
    question: "When would you choose NoSQL over a relational database?",
    answer: `Choose relational by default: constraints, transactions, joins, and a mature query language. Choose NoSQL when a specific property of the workload demands it.

- **Document** (MongoDB, Cosmos) — the aggregate is read and written whole, the schema varies per document, and joins are rare.
- **Key-value** (Redis, DynamoDB) — lookups by a known key at very high rate.
- **Wide-column** (Cassandra) — enormous write volume, queries known in advance, availability over consistency.
- **Graph** (Neo4j) — relationship traversal is the query ("friends of friends who bought X").
- **Time series** (InfluxDB, Timescale) — append-only measurements with time-window queries.

The honest answer in most interviews: "the data is relational, so PostgreSQL or SQL Server, with Redis in front for hot reads."`,
    followUps: [
      {
        question: "Can a relational database store JSON?",
        answer:
          "Yes — SQL Server `JSON` functions and PostgreSQL `jsonb` with GIN indexes. That often removes the reason to add a document store, while keeping transactions and joins.",
      },
    ],
    tags: ["nosql", "document", "key-value", "polyglot", "modelling"],
  },
  {
    id: "db-sp-vs-orm",
    topic: "database",
    subtopic: "Access",
    level: "intermediate",
    question: "Stored procedures or an ORM?",
    answer: `**ORM (EF Core)** — the default for application CRUD: type safety, migrations, change tracking, less boilerplate, logic stays in the codebase under source control and tests.

**Stored procedures** — worth it for set-based batch work, complex reporting, logic that several applications share, or where the DBA controls access and grants execute rather than table permissions.

The bad reasons to choose procedures: "they are faster" (a parameterised query gets the same plan caching), or "they prevent SQL injection" (parameters do that, not procedures — dynamic SQL inside a procedure is just as vulnerable).`,
    language: "sql",
    code: `-- Still injectable, despite being a stored procedure
CREATE PROCEDURE SearchBad @term nvarchar(100) AS
BEGIN
    DECLARE @sql nvarchar(max) = N'SELECT * FROM Products WHERE Name LIKE ''%' + @term + '%''';
    EXEC(@sql);                     -- concatenation is the vulnerability
END

-- Safe: parameterised even inside dynamic SQL
CREATE PROCEDURE SearchGood @term nvarchar(100) AS
BEGIN
    DECLARE @sql nvarchar(max) = N'SELECT * FROM Products WHERE Name LIKE @t';
    EXEC sp_executesql @sql, N'@t nvarchar(102)', @t = '%' + @term + '%';
END`,
    followUps: [
      {
        question: "How does EF Core protect against SQL injection?",
        answer:
          "LINQ becomes parameterised SQL. The hole is `FromSqlRaw`/`ExecuteSqlRaw` with interpolation — use `FromSqlInterpolated`, which turns the interpolation into parameters.",
      },
    ],
    tags: ["stored procedure", "orm", "ef core", "sql injection"],
  },
  {
    id: "db-pagination",
    topic: "database",
    subtopic: "SQL",
    level: "intermediate",
    question: "How do you paginate a large table correctly?",
    answer: `**Offset paging** (\`OFFSET 100000 ROWS FETCH NEXT 50\`) is simple but degrades: the engine still reads and discards every skipped row, and rows shift when data is inserted, so users see duplicates or gaps.

**Keyset (seek) paging** uses the last row's sort key as the starting point. It stays fast at any depth and is stable under inserts. It needs a deterministic sort — include a unique tiebreaker.

Also: never count the whole table on every page unless the user needs an exact total; an approximate or cached count is usually enough.`,
    language: "sql",
    code: `-- Offset: page 2000 still reads 100,000 rows
SELECT * FROM Orders ORDER BY CreatedAt DESC, Id DESC
OFFSET 100000 ROWS FETCH NEXT 50 ROWS ONLY;

-- Keyset: reads exactly 50, at any depth
SELECT TOP (50) *
FROM   Orders
WHERE  (CreatedAt < @lastCreatedAt)
    OR (CreatedAt = @lastCreatedAt AND Id < @lastId)   -- tiebreaker
ORDER BY CreatedAt DESC, Id DESC;`,
    followUps: [
      {
        question: "Why does keyset paging need a unique tiebreaker?",
        answer:
          "If several rows share the same timestamp, the boundary is ambiguous and rows are skipped or repeated. Adding the primary key makes the ordering total.",
      },
    ],
    tags: ["pagination", "keyset", "offset", "performance"],
  },
  {
    id: "db-migrations",
    topic: "database",
    subtopic: "Operations",
    level: "advanced",
    question: "How do you deploy a schema change with zero downtime?",
    answer: `**Expand → migrate → contract**, so the old and new code both work against the schema at every moment.

1. **Expand** — add the new column as nullable, add the new table, add the index online. Nothing breaks.
2. **Backfill** — copy data in batches, not one huge transaction that locks the table and fills the log.
3. **Dual-write** — new code writes both old and new; old code still works.
4. **Switch reads** to the new shape and deploy.
5. **Contract** — after everything is on the new version, drop the old column.

Renaming a column in one deployment is the classic outage: the old pods are still running when it disappears.`,
    language: "sql",
    code: `-- Step 1: additive, safe with old code running
ALTER TABLE Customers ADD FullName nvarchar(200) NULL;

-- Step 2: backfill in batches so the log and locks stay small
WHILE 1 = 1
BEGIN
    UPDATE TOP (5000) Customers
    SET    FullName = CONCAT(FirstName, ' ', LastName)
    WHERE  FullName IS NULL;

    IF @@ROWCOUNT = 0 BREAK;
    WAITFOR DELAY '00:00:00.100';       -- let other work through
END

-- Step 5, a release later: DROP COLUMN FirstName, LastName;`,
    followUps: [
      {
        question: "How do you handle a failed migration in production?",
        answer:
          "Prefer forward-only fixes: every migration should be safe to re-run, and a rollback script should exist for the destructive steps. Test the migration against a restored copy of production data, not an empty database.",
      },
    ],
    tags: ["migration", "zero downtime", "expand contract", "deployment"],
  },
  {
    id: "db-cte-window",
    topic: "database",
    subtopic: "SQL",
    level: "intermediate",
    question: "What are CTEs and window functions used for?",
    answer: `A **CTE** (\`WITH\`) names a subquery to make a statement readable, and a **recursive CTE** walks hierarchies. It is not a temp table — it is inlined, so a CTE referenced twice may be evaluated twice.

**Window functions** compute across a set of rows *without collapsing them*, which is what makes them different from GROUP BY:

- \`ROW_NUMBER()\` — deduplication, top-N per group, keyset paging.
- \`RANK()\` / \`DENSE_RANK()\` — league tables with ties.
- \`LAG()\` / \`LEAD()\` — compare a row with the previous or next.
- \`SUM() OVER (...)\` — running totals.`,
    language: "sql",
    code: `-- Latest order per customer, without a correlated subquery
WITH Ranked AS (
    SELECT o.*,
           ROW_NUMBER() OVER (PARTITION BY o.CustomerId ORDER BY o.CreatedAt DESC) AS rn
    FROM   Orders o
)
SELECT * FROM Ranked WHERE rn = 1;

-- Running total and change from the previous month
SELECT Month,
       Revenue,
       SUM(Revenue) OVER (ORDER BY Month ROWS UNBOUNDED PRECEDING) AS RunningTotal,
       Revenue - LAG(Revenue) OVER (ORDER BY Month)                AS MoM
FROM   MonthlyRevenue;

-- Recursive: an org chart
WITH Tree AS (
    SELECT Id, ManagerId, Name, 0 AS Depth FROM Employees WHERE ManagerId IS NULL
    UNION ALL
    SELECT e.Id, e.ManagerId, e.Name, t.Depth + 1
    FROM Employees e JOIN Tree t ON e.ManagerId = t.Id
)
SELECT * FROM Tree ORDER BY Depth;`,
    followUps: [
      {
        question: "GROUP BY or a window function?",
        answer:
          "GROUP BY when you want one row per group. A window function when you want every row *plus* an aggregate over its group — a running total, or each row's share of the total.",
      },
    ],
    tags: ["cte", "window functions", "row_number", "recursive", "sql"],
  },
  {
    id: "db-connection-pooling",
    topic: "database",
    subtopic: "Operations",
    level: "intermediate",
    question: "How does connection pooling work, and how does it get exhausted?",
    answer: `Opening a database connection is expensive (TCP, TLS, authentication), so ADO.NET keeps a pool per distinct connection string. \`Open()\` takes one from the pool; \`Dispose()\` returns it.

Exhaustion symptoms: timeouts on \`Open()\` after ~30 s, throughput collapsing under load while the database itself looks idle.

Causes, in order of frequency:

1. Connections not disposed — a missing \`using\`, or an exception path that skips it.
2. Long-running transactions holding a connection while doing slow work (an HTTP call inside a transaction).
3. Pool too small for the concurrency, or many different connection strings each getting their own pool.
4. Blocking the thread pool with sync-over-async, so nothing returns connections in time.`,
    language: "csharp",
    code: `// Leaks a connection on every exception
var conn = new SqlConnection(cs);
conn.Open();
var result = await DoWorkAsync(conn);     // throws -> never closed
conn.Dispose();

// Returned to the pool no matter what happens
await using var conn2 = new SqlConnection(cs);
await conn2.OpenAsync(ct);
var ok = await DoWorkAsync(conn2);

// Connection string knobs
// Max Pool Size=200;Min Pool Size=5;Connect Timeout=15`,
    followUps: [
      {
        question: "Does EF Core's DbContext hold a connection open?",
        answer:
          "No — it opens per operation and returns it, unless you open it explicitly or run inside a transaction. A `DbContext` living too long is a memory and tracking problem rather than a connection one.",
      },
    ],
    tags: ["connection pool", "ado.net", "timeouts", "operations"],
  },
];
