import { describe, expect, it } from "vitest";
import {
  AUDIENCE,
  formatCell,
  innermostMessage,
  KqlTargetError,
  leadingTable,
  lintQuery,
  parseResult,
  queryAdvice,
  queryBody,
  queryHeaders,
  queryUrl,
  snippetsFor,
  SNIPPETS,
  tableToCsv,
  tableToObjects,
  timespanFor,
  tokenCommand,
  type KqlTable,
} from "./kql";

const WORKSPACE = "11111111-2222-3333-4444-555555555555";

describe("queryUrl", () => {
  it("addresses each backend by id", () => {
    expect(queryUrl({ backend: "loganalytics", id: WORKSPACE })).toBe(`https://api.loganalytics.io/v1/workspaces/${WORKSPACE}/query`);
    expect(queryUrl({ backend: "appinsights", id: WORKSPACE })).toBe(`https://api.applicationinsights.io/v1/apps/${WORKSPACE}/query`);
  });

  it("says which id is missing, in the words of the portal blade it is on", () => {
    expect(() => queryUrl({ backend: "loganalytics", id: "" })).toThrow(/overview blade/);
    expect(() => queryUrl({ backend: "appinsights", id: " " })).toThrow(/instrumentation key/);
  });

  it("rejects a resource name, which would otherwise 404 later", () => {
    expect(() => queryUrl({ backend: "loganalytics", id: "prod-logs" })).toThrow(KqlTargetError);
    expect(() => queryUrl({ backend: "loganalytics", id: "prod-logs" })).toThrow(/not a GUID/);
  });
});

describe("queryHeaders", () => {
  it("sends a bearer token, tolerating a pasted 'Bearer ' prefix", () => {
    expect(queryHeaders({ backend: "loganalytics", id: WORKSPACE, token: "abc" }).Authorization).toBe("Bearer abc");
    expect(queryHeaders({ backend: "loganalytics", id: WORKSPACE, token: "Bearer abc" }).Authorization).toBe("Bearer abc");
  });

  it("prefers an App Insights API key over a token", () => {
    const headers = queryHeaders({ backend: "appinsights", id: WORKSPACE, apiKey: "k", token: "t" });
    expect(headers["X-API-Key"]).toBe("k");
    expect(headers.Authorization).toBeUndefined();
  });

  it("ignores an API key on Log Analytics, which has no such option", () => {
    expect(() => queryHeaders({ backend: "loganalytics", id: WORKSPACE, apiKey: "k" })).toThrow(/no API-key option/);
  });

  it("names the audience a token must be for when there is no credential", () => {
    expect(() => queryHeaders({ backend: "loganalytics", id: WORKSPACE })).toThrow(AUDIENCE.loganalytics);
    expect(tokenCommand("appinsights")).toContain(AUDIENCE.appinsights);
  });
});

describe("timespanFor and queryBody", () => {
  it("prefers the coarsest ISO-8601 unit that is exact", () => {
    expect(timespanFor(15)).toBe("PT15M");
    expect(timespanFor(60)).toBe("PT1H");
    expect(timespanFor(240)).toBe("PT4H");
    expect(timespanFor(1440)).toBe("P1D");
    expect(timespanFor(10080)).toBe("P7D");
    expect(timespanFor(90)).toBe("PT90M");
  });

  it("omits the timespan entirely when the query owns the range", () => {
    expect(timespanFor(0)).toBe("");
    expect(JSON.parse(queryBody("Heartbeat", 0))).toEqual({ query: "Heartbeat" });
    expect(JSON.parse(queryBody("Heartbeat", 60))).toEqual({ query: "Heartbeat", timespan: "PT1H" });
  });
});

describe("parseResult", () => {
  const payload = {
    tables: [
      {
        name: "PrimaryResult",
        columns: [
          { name: "Name", type: "string" },
          { name: "Count", type: "long" },
        ],
        rows: [
          ["GET /orders", 5],
          ["GET /health", 900],
        ],
      },
      { name: "QueryStatistics", columns: [{ name: "Value", type: "dynamic" }], rows: [[{ ms: 12 }]] },
    ],
  };

  it("picks PrimaryResult as the table a reader means", () => {
    const result = parseResult(payload);
    expect(result.tables).toHaveLength(2);
    expect(result.primary?.name).toBe("PrimaryResult");
    expect(result.primary?.rows).toHaveLength(2);
  });

  it("falls back to the first table when nothing is named PrimaryResult", () => {
    expect(parseResult({ tables: [{ name: "Other", columns: [], rows: [] }] }).primary?.name).toBe("Other");
  });

  it("reads the PascalCase column shape the same endpoint also returns", () => {
    const result = parseResult({ tables: [{ TableName: "T", columns: [{ ColumnName: "a", ColumnType: "string" }], rows: [["x"]] }] });
    expect(result.primary?.name).toBe("T");
    expect(result.primary?.columns).toEqual([{ name: "a", type: "string" }]);
  });

  it("survives a body that is not a result at all", () => {
    expect(parseResult(null)).toEqual({ tables: [], primary: null });
    expect(parseResult({ error: { message: "no" } })).toEqual({ tables: [], primary: null });
    expect(parseResult({ tables: [{ name: "T" }] }).primary).toEqual({ name: "T", columns: [], rows: [] });
  });
});

const TABLE: KqlTable = {
  name: "PrimaryResult",
  columns: [
    { name: "Name", type: "string" },
    { name: "Props", type: "dynamic" },
  ],
  rows: [
    ["a, with comma", { k: 1 }],
    ['say "hi"', null],
  ],
};

describe("cells and export", () => {
  it("renders a dynamic column as JSON rather than [object Object]", () => {
    expect(formatCell({ k: 1 })).toBe('{"k":1}');
    expect(formatCell(null)).toBe("");
    expect(formatCell(undefined)).toBe("");
    expect(formatCell(0)).toBe("0");
    expect(formatCell(false)).toBe("false");
  });

  it("pairs columns with row positions", () => {
    expect(tableToObjects(TABLE)[0]).toEqual({ Name: "a, with comma", Props: { k: 1 } });
  });

  it("quotes only the CSV cells that need it", () => {
    const csv = tableToCsv(TABLE).split("\n");
    expect(csv[0]).toBe("Name,Props");
    expect(csv[1]).toBe('"a, with comma","{""k"":1}"');
    expect(csv[2]).toBe('"say ""hi""",');
  });
});

describe("innermostMessage", () => {
  it("walks past the generic outer errors to the real complaint", () => {
    const payload = {
      error: {
        message: "The request had some invalid properties",
        code: "BadArgumentError",
        innererror: {
          message: "SyntaxError",
          innererror: { message: "Query could not be parsed at 'form' on line [2,7]" },
        },
      },
    };
    expect(innermostMessage(payload)).toBe("Query could not be parsed at 'form' on line [2,7]");
  });

  it("uses the outermost message when there is nothing nested", () => {
    expect(innermostMessage({ error: { message: "plain" } })).toBe("plain");
    expect(innermostMessage({})).toBeNull();
    expect(innermostMessage("oops")).toBeNull();
  });

  it("does not loop forever on a self-referential body", () => {
    const node: Record<string, unknown> = { message: "loop" };
    node.innererror = node;
    expect(innermostMessage({ error: node })).toBe("loop");
  });
});

describe("queryAdvice", () => {
  it("names the audience a 401 actually wanted, per backend", () => {
    expect(queryAdvice(401, "loganalytics")).toContain(AUDIENCE.loganalytics);
    expect(queryAdvice(401, "appinsights")).toContain(AUDIENCE.appinsights);
    expect(queryAdvice(401, "loganalytics")).toMatch(/management\.azure\.com/);
  });

  it("gives 403 the role that is actually needed", () => {
    expect(queryAdvice(403, "loganalytics")).toMatch(/Log Analytics Reader/);
    expect(queryAdvice(403, "appinsights")).toMatch(/Read telemetry/);
  });

  it("covers the other statuses that matter", () => {
    expect(queryAdvice(400, "loganalytics")).toMatch(/innermost error/);
    expect(queryAdvice(404, "loganalytics")).toMatch(/GUID/);
    expect(queryAdvice(429, "loganalytics")).toMatch(/throttled/i);
    expect(queryAdvice(504, "loganalytics")).toMatch(/Narrow the time range/);
    expect(queryAdvice(500, "loganalytics")).toContain("500");
  });
});

describe("lintQuery", () => {
  const messages = (query: string, minutes = 60) => lintQuery(query, minutes).map((h) => h.message).join(" | ");

  it("says nothing about an empty editor", () => {
    expect(lintQuery("", 60)).toEqual([]);
    expect(lintQuery("   ", 0)).toEqual([]);
  });

  it("catches SQL and translates the three operators people reach for", () => {
    const hints = lintQuery("select * from AppRequests", 60);
    expect(hints[0].severity).toBe("warn");
    expect(hints[0].message).toMatch(/project/);
    expect(hints[0].message).toMatch(/summarize/);
  });

  it("does not read SQL inside a comment as SQL", () => {
    expect(messages("// select * from x\nAppRequests | take 10")).not.toMatch(/looks like SQL/);
  });

  it("warns about an unbounded scan only when nothing bounds the time", () => {
    expect(messages("AppRequests | take 10", 0)).toMatch(/full retention/);
    expect(messages("AppRequests | where TimeGenerated > ago(1h) | take 10", 0)).not.toMatch(/full retention/);
    expect(messages("AppRequests | take 10", 60)).not.toMatch(/full retention/);
  });

  it("calls out search as the expensive habit it is", () => {
    expect(messages('search "error" | take 10')).toMatch(/every column of every table/);
    expect(messages('AppTraces | search "error" | take 10')).toMatch(/every column of every table/);
    expect(messages("AppTraces | where Message has 'error' | take 10")).not.toMatch(/every column of every table/);
  });

  it("catches take-before-sort, which silently is not the top N", () => {
    expect(messages("AppRequests | take 100 | order by DurationMs desc")).toMatch(/does not give you the top N/);
    expect(messages("AppRequests | order by DurationMs desc | take 100")).not.toMatch(/does not give you the top N/);
  });

  it("notes an unbounded result set, and the row cap that makes it fail", () => {
    expect(messages("AppRequests | where Success == false")).toMatch(/500,000 rows/);
    expect(messages("AppRequests | summarize count() by Name")).not.toMatch(/500,000 rows/);
    expect(messages("AppRequests | take 10")).not.toMatch(/500,000 rows/);
  });

  it("suggests has over contains, and filtering before distinct", () => {
    expect(messages("AppTraces | where Message contains 'timeout' | take 10")).toMatch(/whole terms against the index/);
    expect(messages("AppTraces | distinct OperationId")).toMatch(/Filter first/);
    expect(messages("AppTraces | where Success == false | distinct OperationId | take 5")).not.toMatch(/Filter first/);
  });

  it("keeps hints to warnings and information, never blocking a query", () => {
    for (const hint of lintQuery("select * from x", 0)) {
      expect(["warn", "info"]).toContain(hint.severity);
    }
  });
});

describe("leadingTable", () => {
  it("finds the table a query reads", () => {
    expect(leadingTable("AppRequests | where Success == false")).toBe("AppRequests");
    expect(leadingTable("  ContainerLogV2\n| take 5")).toBe("ContainerLogV2");
  });

  it("looks past let statements and comments", () => {
    expect(leadingTable('// the failing endpoint\nlet op = "x";\nAppRequests | where OperationId == op')).toBe("AppRequests");
  });

  it("returns null when there is no table to name", () => {
    expect(leadingTable("")).toBeNull();
    expect(leadingTable("| take 5")).toBeNull();
  });
});

describe("snippets", () => {
  it("offers the classic tables to App Insights and the workspace tables to Log Analytics", () => {
    const classic = snippetsFor("appinsights");
    expect(classic.length).toBeGreaterThan(0);
    expect(classic.every((s) => s.backend === "appinsights" || s.backend === "both")).toBe(true);
    expect(snippetsFor("loganalytics").some((s) => s.query.includes("AppRequests"))).toBe(true);
  });

  it("has unique ids and a purpose written as a question someone would ask", () => {
    expect(new Set(SNIPPETS.map((s) => s.id)).size).toBe(SNIPPETS.length);
    for (const s of SNIPPETS) {
      expect(s.title.length).toBeGreaterThan(8);
      expect(s.purpose.length).toBeGreaterThan(8);
      expect(s.query.trim().length).toBeGreaterThan(20);
    }
  });

  it("ships no snippet its own linter would call SQL, or leave unbounded in time", () => {
    for (const s of SNIPPETS) {
      const hints = lintQuery(s.query, 0).filter((h) => h.severity === "warn");
      expect(hints.map((h) => h.message)).toEqual([]);
    }
  });
});
