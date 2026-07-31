import { describe, it, expect, beforeEach } from "vitest";
import {
  addLog,
  clearLogs,
  getLogs,
  log,
  logsToText,
  redactSecrets,
  formatDetail,
  subscribeLogs,
  setLogContext,
  LOG_LIMIT,
} from "./logBus";

beforeEach(() => clearLogs());

describe("redactSecrets", () => {
  it("masks an ADO password", () => {
    expect(redactSecrets("Server=db01;User Id=sa;Password=hunter2;")).toBe("Server=db01;User Id=sa;Password=***;");
  });
  it("masks pwd and quoted values", () => {
    expect(redactSecrets('pwd="hunter2";x=1')).toBe('pwd=***;x=1');
  });
  it("masks credentials inside a URL", () => {
    expect(redactSecrets("postgresql://user:hunter2@host:5432/db")).toBe("postgresql://user:***@host:5432/db");
  });
  it("masks tokens and api keys in JSON", () => {
    expect(redactSecrets('{"token":"abc123","apiKey":"k-9"}')).toBe('{"token":"***","apiKey":"***"}');
  });
  it("is case-insensitive", () => {
    expect(redactSecrets("PASSWORD=x")).toBe("PASSWORD=***");
  });
  it("leaves harmless text alone", () => {
    expect(redactSecrets("Server=tcp:db01,1433;Database=App")).toBe("Server=tcp:db01,1433;Database=App");
  });
});

describe("addLog", () => {
  it("records level, source and message", () => {
    log.error("db", "boom");
    const [e] = getLogs();
    expect(e).toMatchObject({ level: "error", source: "db", message: "boom" });
    expect(e.id).toBeGreaterThan(0);
  });

  it("redacts secrets in the message and the detail", () => {
    addLog("info", "native:db_test", "connStr=Server=x;Password=abc", { connStr: "Password=abc" });
    const [e] = getLogs();
    expect(e.message).not.toContain("abc");
    expect(e.detail).not.toContain("abc");
  });

  it("keeps entries in order and caps the buffer", () => {
    for (let i = 0; i < LOG_LIMIT + 25; i++) log.info("t", `m${i}`);
    const all = getLogs();
    expect(all).toHaveLength(LOG_LIMIT);
    // The oldest were dropped, the newest kept.
    expect(all[all.length - 1].message).toBe(`m${LOG_LIMIT + 24}`);
    expect(all[0].message).toBe("m25");
  });

  it("stores an elapsed time when given one", () => {
    addLog("success", "native:x", "ok", undefined, 42);
    expect(getLogs()[0].elapsedMs).toBe(42);
  });
});

describe("setLogContext", () => {
  it("tags entries with the tool that was on screen", () => {
    setLogContext("database-toolkit");
    log.info("native:db_test", "invoked");
    setLogContext(undefined);
    log.info("app", "navigated");
    const [scoped, global] = getLogs();
    expect(scoped.tool).toBe("database-toolkit");
    expect(global.tool).toBeUndefined();
  });
});

describe("subscribeLogs", () => {
  it("notifies subscribers and stops after unsubscribing", () => {
    const seen: number[] = [];
    const off = subscribeLogs((entries) => seen.push(entries.length));
    log.info("t", "one");
    log.info("t", "two");
    off();
    log.info("t", "three");
    expect(seen).toEqual([1, 2]);
  });
});

describe("formatDetail", () => {
  it("serializes objects", () => {
    expect(formatDetail({ a: 1 })).toBe('{"a":1}');
  });
  it("clips long values and says how long they were", () => {
    const out = formatDetail("x".repeat(50), 10);
    expect(out).toMatch(/^x{10}… \(50 chars\)$/);
  });
});

describe("logsToText", () => {
  it("renders one line per entry with the detail indented", () => {
    addLog("error", "native:db_test", "Login failed", "engine=mssql", 12);
    const text = logsToText(getLogs());
    expect(text).toMatch(/ERROR\s+native:db_test — Login failed \(12 ms\)/);
    expect(text).toContain("\n    engine=mssql");
  });
  it("is empty for an empty log", () => {
    expect(logsToText([])).toBe("");
  });
});
