/**
 * Running KQL against Log Analytics and Application Insights.
 *
 * Both are the same query language over the same engine behind two different
 * REST front doors, and the difference matters mostly at authentication time:
 *
 * - **Log Analytics** — `https://api.loganalytics.io/v1/workspaces/{id}/query`,
 *   authorised with an Entra bearer token whose audience is the API itself. The
 *   token comes from `az account get-access-token --resource
 *   https://api.loganalytics.io`, and it is a token for *the API*, not for
 *   `https://management.azure.com` — pasting a management token here is the
 *   single most common 401 and the error body does not say which audience it
 *   wanted.
 * - **Application Insights** — `https://api.applicationinsights.io/v1/apps/
 *   {appId}/query`, which additionally accepts a plain API key in `X-API-Key`.
 *   That key is created in the resource itself and needs no Entra involvement,
 *   which is why the App Insights path is usually the one that works first.
 *
 * The response is the same either way: `{ tables: [{ name, columns, rows }] }`,
 * columns typed with the Kusto type names and rows as positional arrays. Nothing
 * in the payload marks which table is the interesting one — by convention the
 * first is `PrimaryResult` and the rest are query statistics, so the shaping
 * here goes by name and falls back to position.
 *
 * Everything is pure over strings and parsed JSON, so it is all testable without
 * a workspace.
 */

export type Backend = "loganalytics" | "appinsights";

export interface KqlTarget {
  backend: Backend;
  /** Workspace id (Log Analytics) or application id (App Insights). */
  id: string;
  /** Entra bearer token, without the "Bearer " prefix. */
  token?: string;
  /** App Insights API key, an alternative to a token. */
  apiKey?: string;
}

/** The audience a bearer token has to be issued for, per backend. */
export const AUDIENCE: Record<Backend, string> = {
  loganalytics: "https://api.loganalytics.io",
  appinsights: "https://api.applicationinsights.io",
};

/** The `az` command that mints a usable token, ready to copy. */
export function tokenCommand(backend: Backend): string {
  return `az account get-access-token --resource ${AUDIENCE[backend]} --query accessToken -o tsv`;
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export class KqlTargetError extends Error {}

/** The query endpoint for a target. */
export function queryUrl(target: Pick<KqlTarget, "backend" | "id">): string {
  const id = target.id.trim();
  if (!id) {
    throw new KqlTargetError(
      target.backend === "loganalytics"
        ? "A workspace id is required — it is the GUID on the Log Analytics workspace's overview blade, not the resource name."
        : "An application id is required — it is on the Application Insights resource under API Access, not the instrumentation key.",
    );
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    throw new KqlTargetError(`"${id}" is not a GUID. Both backends address the resource by its id, not by its name.`);
  }
  return target.backend === "loganalytics"
    ? `https://api.loganalytics.io/v1/workspaces/${id}/query`
    : `https://api.applicationinsights.io/v1/apps/${id}/query`;
}

/** Headers for a query, preferring an API key when one is given. */
export function queryHeaders(target: KqlTarget): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const key = target.apiKey?.trim();
  const token = target.token?.trim().replace(/^Bearer\s+/i, "");
  if (target.backend === "appinsights" && key) {
    headers["X-API-Key"] = key;
  } else if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  } else {
    throw new KqlTargetError(
      target.backend === "appinsights"
        ? `Paste either an API key or a bearer token. A token must be for ${AUDIENCE.appinsights}.`
        : `Paste a bearer token for ${AUDIENCE.loganalytics}. Log Analytics has no API-key option.`,
    );
  }
  return headers;
}

/**
 * An ISO-8601 timespan for a "last N" range.
 *
 * The `timespan` field is applied on top of the query and intersected with any
 * `ago()` filter inside it, so the narrower of the two wins. That is a feature —
 * it means a saved query cannot accidentally scan a year — but it also means a
 * query whose own filter is wider than the picker silently returns less.
 */
export function timespanFor(minutes: number): string {
  if (minutes <= 0) return "";
  if (minutes % 1440 === 0) return `P${minutes / 1440}D`;
  if (minutes % 60 === 0) return `PT${minutes / 60}H`;
  return `PT${minutes}M`;
}

export const TIME_RANGES: { label: string; minutes: number }[] = [
  { label: "Last 15 minutes", minutes: 15 },
  { label: "Last hour", minutes: 60 },
  { label: "Last 4 hours", minutes: 240 },
  { label: "Last 24 hours", minutes: 1440 },
  { label: "Last 7 days", minutes: 10080 },
  { label: "Last 30 days", minutes: 43200 },
  { label: "Whatever the query says", minutes: 0 },
];

/** The POST body for a query. */
export function queryBody(query: string, minutes: number): string {
  const span = timespanFor(minutes);
  return JSON.stringify(span ? { query, timespan: span } : { query });
}

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

export interface KqlColumn {
  name: string;
  type: string;
}

export interface KqlTable {
  name: string;
  columns: KqlColumn[];
  rows: unknown[][];
}

export interface KqlResult {
  tables: KqlTable[];
  /** The table a reader means when they say "the results". */
  primary: KqlTable | null;
}

/**
 * Shape a query response.
 *
 * Written defensively on purpose: the same endpoint returns `columns` as
 * `{name,type}` and, in some error and preview shapes, as `{ColumnName,
 * ColumnType}`. A viewer that only understands one of them renders a table of
 * `undefined` headers over perfectly good rows.
 */
export function parseResult(payload: unknown): KqlResult {
  const raw = (payload as { tables?: unknown[] })?.tables;
  if (!Array.isArray(raw)) return { tables: [], primary: null };

  const tables: KqlTable[] = raw.map((entry, i) => {
    const t = entry as { name?: string; TableName?: string; columns?: unknown[]; rows?: unknown[] };
    const columns = Array.isArray(t.columns)
      ? t.columns.map((c) => {
          const col = c as { name?: string; type?: string; ColumnName?: string; ColumnType?: string };
          return { name: col.name ?? col.ColumnName ?? "", type: col.type ?? col.ColumnType ?? "dynamic" };
        })
      : [];
    const rows = Array.isArray(t.rows) ? t.rows.filter(Array.isArray).map((r) => [...(r as unknown[])]) : [];
    return { name: t.name ?? t.TableName ?? `Table_${i}`, columns, rows };
  });

  const primary = tables.find((t) => t.name === "PrimaryResult") ?? tables[0] ?? null;
  return { tables, primary };
}

/** One cell as text — `dynamic` columns arrive as objects and must not print as [object Object]. */
export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/** A table as rows of objects, which is what a copy-as-JSON wants. */
export function tableToObjects(table: KqlTable): Record<string, unknown>[] {
  return table.rows.map((row) => {
    const out: Record<string, unknown> = {};
    table.columns.forEach((col, i) => (out[col.name] = row[i]));
    return out;
  });
}

/** A table as CSV, quoting only what needs it. */
export function tableToCsv(table: KqlTable): string {
  const escape = (value: unknown) => {
    const text = formatCell(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [table.columns.map((c) => escape(c.name)).join(","), ...table.rows.map((r) => r.map(escape).join(","))].join("\n");
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Turn an error response into something that says what to change.
 *
 * The API's own error bodies are nested — `error.innererror.innererror.message`
 * is where the actual syntax complaint lives — and the outer layers say only
 * "BadArgumentError". This walks to the innermost message it can find.
 */
export function innermostMessage(payload: unknown): string | null {
  let node = (payload as { error?: unknown })?.error;
  let message: string | null = null;
  let guard = 0;
  while (node && typeof node === "object" && guard++ < 10) {
    const obj = node as { message?: unknown; innererror?: unknown };
    if (typeof obj.message === "string" && obj.message.trim()) message = obj.message.trim();
    node = obj.innererror;
  }
  return message;
}

/** Advice for a failed query, from the status and the backend it went to. */
export function queryAdvice(status: number, backend: Backend): string {
  switch (status) {
    case 400:
      return "400 — the service parsed the request but not the query. The innermost error message below names the line and the token it stopped at.";
    case 401:
      return `401 — the credential was rejected. A bearer token has to be issued for ${AUDIENCE[backend]}; a token for https://management.azure.com authenticates fine everywhere else and is refused here. Tokens also expire after about an hour.`;
    case 403:
      return backend === "loganalytics"
        ? "403 — authenticated, but not authorised on this workspace. Reading logs needs Log Analytics Reader (or Reader) on the workspace itself, which is not implied by Contributor on the subscription."
        : "403 — authenticated, but not authorised on this Application Insights resource. An API key is scoped to specific permissions when it is created; check it has 'Read telemetry'.";
    case 404:
      return "404 — no workspace or application with that id. Both are addressed by GUID; the resource name will always 404.";
    case 429:
      return "429 — throttled. The query API limits concurrent and per-minute queries per resource, independently of how expensive the query is.";
    case 504:
      return "504 — the query ran longer than the service's limit. Narrow the time range, or summarise before projecting.";
    default:
      return `${status} — see the response body.`;
  }
}

// ---------------------------------------------------------------------------
// Lint
// ---------------------------------------------------------------------------

export interface KqlHint {
  severity: "warn" | "info";
  message: string;
}

const SQL_KEYWORDS = /(^|\n)\s*(select|insert|update|delete|drop)\b/i;

/**
 * Things worth saying about a query before it is sent.
 *
 * These are the mistakes that cost money and time rather than the ones that
 * error: KQL is happy to scan a month of a busy workspace, and the bill and the
 * 504 arrive later. The rule about `search` in particular is worth stating —
 * it is the natural thing to reach for, and it reads every column of every
 * table in the range.
 */
export function lintQuery(query: string, minutes: number): KqlHint[] {
  const hints: KqlHint[] = [];
  const text = query.trim();
  if (!text) return hints;

  // Comments hold SQL and time filters that do not run; strip before matching.
  const code = text.replace(/\/\/[^\n]*/g, "");

  if (SQL_KEYWORDS.test(code)) {
    hints.push({
      severity: "warn",
      message: "This looks like SQL. KQL starts from a table name and pipes into operators: `AppRequests | where … | project …`. `select` is `project`, `group by` is `summarize … by`, and there is no `from`.",
    });
  }

  const hasTimeFilter = /\bago\s*\(|\bbetween\s*\(|\bstartofday\s*\(|TimeGenerated\s*[<>]/i.test(code);
  if (!hasTimeFilter && minutes === 0) {
    hints.push({
      severity: "warn",
      message: "No time filter in the query and no range selected, so this scans the workspace's full retention. Add `| where TimeGenerated > ago(1h)` or pick a range.",
    });
  }

  if (/^\s*search\b/i.test(code) || /\|\s*search\b/i.test(code)) {
    hints.push({
      severity: "warn",
      message: "`search` reads every column of every table in range. Once you know the table, `TableName | where …` is orders of magnitude cheaper.",
    });
  }

  if (/\|\s*(take|limit)\s+\d+/i.test(code) && /\|\s*(order|sort)\s+by/i.test(code)) {
    const takeFirst = code.search(/\|\s*(take|limit)\s+\d+/i) < code.search(/\|\s*(order|sort)\s+by/i);
    if (takeFirst) {
      hints.push({
        severity: "warn",
        message: "`take` before `sort` samples arbitrary rows and then sorts the sample — it does not give you the top N. Sort first, or use `top N by …`.",
      });
    }
  }

  if (!/\|\s*(take|limit|top|summarize|count|render)\b/i.test(code)) {
    hints.push({
      severity: "info",
      message: "Nothing bounds the result set. The API caps a response at 500,000 rows / 64 MB and fails rather than truncating — end with `| take 100` while exploring.",
    });
  }

  if (/\bcontains\b/i.test(code) && !/\bhas\b/i.test(code)) {
    hints.push({
      severity: "info",
      message: "`contains` is a substring scan; `has` matches whole terms against the index and is much faster when the term is a whole word.",
    });
  }

  if (/\bdistinct\b/i.test(code) && !/\|\s*where\b/i.test(code)) {
    hints.push({
      severity: "info",
      message: "`distinct` over an unfiltered table reads all of it. Filter first.",
    });
  }

  return hints;
}

/**
 * Which table a query reads from, for the "does this workspace have it" check.
 *
 * Only the leading table name is taken: `let` bindings, unions and joins make a
 * complete answer a parser's job, and the first identifier is what the reader
 * needs when a query returns nothing.
 */
export function leadingTable(query: string): string | null {
  const code = query.replace(/\/\/[^\n]*/g, "");
  // Skip past any `let` statements, which precede the query proper.
  const withoutLets = code.replace(/^\s*let\b[^;]*;/gm, "");
  const m = /(^|\n)\s*([A-Za-z_][A-Za-z0-9_]*)\s*(\||$)/.exec(withoutLets);
  return m?.[2] ?? null;
}

// ---------------------------------------------------------------------------
// Snippets
// ---------------------------------------------------------------------------

export interface KqlSnippet {
  id: string;
  title: string;
  /** What question it answers, in the words someone would ask it. */
  purpose: string;
  backend: Backend | "both";
  query: string;
}

/**
 * The queries actually opened during an incident.
 *
 * Chosen for the shape they teach as much as the answer they give: `summarize`
 * with `bin()` is the histogram, `make-series` is the gap-filled version of it,
 * `top-nested` is how you get "the worst N per group", and a `join` on
 * `operation_Id` is how a request is tied to the exception it threw.
 *
 * Log Analytics and App Insights disagree on table names — `AppRequests` in a
 * workspace is `requests` in a classic Application Insights resource — so each
 * snippet says which it is for.
 */
export const SNIPPETS: KqlSnippet[] = [
  {
    id: "failed-requests",
    title: "Failing requests, worst endpoint first",
    purpose: "Which endpoint is failing, and how much of its traffic",
    backend: "loganalytics",
    query: `AppRequests
| where TimeGenerated > ago(1h)
| summarize total = count(), failed = countif(Success == false) by Name
| extend failureRate = round(100.0 * failed / total, 1)
| where failed > 0
| top 20 by failed desc`,
  },
  {
    id: "exception-groups",
    title: "Exceptions grouped by type and method",
    purpose: "What is throwing, and is it one bug or many",
    backend: "loganalytics",
    query: `AppExceptions
| where TimeGenerated > ago(6h)
| summarize count(), any(OuterMessage) by ProblemId, ExceptionType
| top 20 by count_ desc`,
  },
  {
    id: "request-to-exception",
    title: "Tie a failed request to the exception it threw",
    purpose: "The stack trace behind a 500",
    backend: "loganalytics",
    query: `AppRequests
| where TimeGenerated > ago(1h) and Success == false
| project OperationId, Name, ResultCode, DurationMs, TimeGenerated
| join kind=leftouter (
    AppExceptions
    | where TimeGenerated > ago(1h)
    | project OperationId, ExceptionType, OuterMessage, Method = OuterMethod
  ) on OperationId
| top 50 by TimeGenerated desc`,
  },
  {
    id: "latency-percentiles",
    title: "Latency percentiles over time",
    purpose: "Is it slower than it was, and for whom",
    backend: "loganalytics",
    query: `AppRequests
| where TimeGenerated > ago(24h)
| summarize percentiles(DurationMs, 50, 95, 99) by bin(TimeGenerated, 15m)
| render timechart`,
  },
  {
    id: "dependency-failures",
    title: "Failing dependencies by target",
    purpose: "Which downstream call is breaking us — SQL, HTTP, Service Bus",
    backend: "loganalytics",
    query: `AppDependencies
| where TimeGenerated > ago(1h)
| summarize calls = count(), failed = countif(Success == false), p95 = percentile(DurationMs, 95)
    by Type, Target
| where failed > 0
| top 20 by failed desc`,
  },
  {
    id: "trace-by-operation",
    title: "Everything about one operation id",
    purpose: "The whole story of a single request, in order",
    backend: "loganalytics",
    query: `let op = "PASTE-OPERATION-ID";
union AppRequests, AppDependencies, AppExceptions, AppTraces
| where TimeGenerated > ago(24h) and OperationId == op
| project TimeGenerated, itemType = Type, Name, Message, DurationMs, Success
| order by TimeGenerated asc`,
  },
  {
    id: "container-errors",
    title: "Container log lines that mention an error",
    purpose: "What AKS is complaining about",
    backend: "loganalytics",
    query: `ContainerLogV2
| where TimeGenerated > ago(1h)
| where LogMessage has_any ("error", "exception", "fatal")
| summarize count() by ContainerName, PodName
| top 30 by count_ desc`,
  },
  {
    id: "ingestion-by-table",
    title: "What is costing the most to ingest",
    purpose: "Where the workspace bill is going",
    backend: "loganalytics",
    query: `Usage
| where TimeGenerated > ago(7d) and IsBillable == true
| summarize billedGB = round(sum(Quantity) / 1024, 2) by DataType
| top 20 by billedGB desc`,
  },
  {
    id: "classic-failed-requests",
    title: "Failing requests (classic App Insights tables)",
    purpose: "The same question against an Application Insights resource",
    backend: "appinsights",
    query: `requests
| where timestamp > ago(1h)
| summarize total = count(), failed = countif(success == false) by name
| where failed > 0
| top 20 by failed desc`,
  },
  {
    id: "classic-traces",
    title: "Recent traces above a severity",
    purpose: "Application log lines, filtered the cheap way",
    backend: "appinsights",
    query: `traces
| where timestamp > ago(1h) and severityLevel >= 3
| project timestamp, message, operation_Id, cloud_RoleName
| top 100 by timestamp desc`,
  },
];

/** Snippets that apply to a backend. */
export function snippetsFor(backend: Backend): KqlSnippet[] {
  return SNIPPETS.filter((s) => s.backend === backend || s.backend === "both");
}
