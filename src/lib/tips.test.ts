import { describe, it, expect } from "vitest";
import { matchTips, resolveCommand, serviceNameFor, domainForSource, type Tip } from "./tips";
import { ALL_TIPS } from "./tipsData";

const tip = (id: string): Tip => {
  const found = ALL_TIPS.find((t) => t.id === id);
  if (!found) throw new Error(`no tip ${id}`);
  return found;
};

describe("tip corpus", () => {
  it("has unique ids", () => {
    const ids = ALL_TIPS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("gives every tip a cause, steps and match terms", () => {
    for (const t of ALL_TIPS) {
      expect(t.cause.length, t.id).toBeGreaterThan(20);
      expect(t.steps.length, t.id).toBeGreaterThan(0);
      expect(t.matches.length, t.id).toBeGreaterThan(0);
    }
  });
  it("uses lower-case match terms", () => {
    for (const t of ALL_TIPS) {
      for (const m of t.matches) expect(m, t.id).toBe(m.toLowerCase());
    }
  });
  it("warns whenever a command changes the system", () => {
    for (const t of ALL_TIPS) {
      if (t.command && /Set-ItemProperty|Restart-Service|Start-Service|Set-Service/.test(t.command)) {
        expect(t.warning, `${t.id} should warn about elevation`).toBeTruthy();
      }
    }
  });
  it("covers every tool family", () => {
    const domains = new Set(ALL_TIPS.map((t) => t.domain));
    for (const d of ["mssql", "postgres", "mysql", "sqlite", "oracle", "redis", "docker", "http", "app"]) {
      expect(domains.has(d as Tip["domain"]), d).toBe(true);
    }
  });
});

describe("matchTips", () => {
  it("ranks a SQLSTATE above a generic word", () => {
    const tips = matchTips(ALL_TIPS, 'db error: password authentication failed for user "postgres" [28P01]');
    expect(tips[0].id).toBe("pg-auth-failed");
  });

  it("finds the TCP/IP tip for a refused SQL Server connection", () => {
    const tips = matchTips(ALL_TIPS, "Connect failed: ... actively refused it. (os error 10061)", "mssql");
    expect(tips[0].id).toBe("mssql-tcp-disabled");
  });

  it("restricts to a domain when asked", () => {
    const all = matchTips(ALL_TIPS, "connection refused");
    const pg = matchTips(ALL_TIPS, "connection refused", "postgres");
    expect(pg.every((t) => t.domain === "postgres")).toBe(true);
    expect(all.length).toBeGreaterThan(pg.length);
  });

  it("matches MySQL access denied", () => {
    expect(matchTips(ALL_TIPS, "ERROR 1045 (28000): Access denied for user", "mysql")[0].id).toBe("mysql-access-denied");
  });

  it("matches a locked SQLite file", () => {
    expect(matchTips(ALL_TIPS, "database is locked", "sqlite")[0].id).toBe("sqlite-locked");
  });

  it("matches a stopped Docker daemon", () => {
    expect(matchTips(ALL_TIPS, "error during connect: cannot connect to the Docker daemon")[0].domain).toBe("docker");
  });

  it("matches Redis NOAUTH", () => {
    expect(matchTips(ALL_TIPS, "NOAUTH Authentication required.")[0].id).toBe("redis-noauth");
  });

  it("matches the browser-only native error", () => {
    expect(
      matchTips(ALL_TIPS, 'Native command "db_test" is only available in the DevHelper desktop app.')[0].id,
    ).toBe("app-native-unavailable");
  });

  it("is case-insensitive", () => {
    expect(matchTips(ALL_TIPS, "DATABASE IS LOCKED", "sqlite")).toHaveLength(1);
  });

  it("returns nothing for an unrecognised message", () => {
    expect(matchTips(ALL_TIPS, "everything is fine")).toEqual([]);
  });
});

describe("resolveCommand", () => {
  it("substitutes the SQL Server registry instance name", () => {
    const { text, resolved } = resolveCommand(tip("mssql-tcp-disabled").command!, { internalName: "MSSQL17.MSSQLSERVER" });
    expect(text).toContain("MSSQL17.MSSQLSERVER");
    expect(resolved).toBe(true);
  });

  it("reports an unresolved command instead of leaving a broken path", () => {
    const { text, resolved } = resolveCommand(tip("mssql-tcp-disabled").command!, {});
    expect(text).toContain("<MSSQLnn.INSTANCE>");
    expect(resolved).toBe(false);
  });

  it("substitutes a named instance's service", () => {
    const { text } = resolveCommand(tip("mssql-tcp-disabled").command!, {
      internalName: "MSSQL15.SQLEXPRESS",
      serviceName: "MSSQL$SQLEXPRESS",
    });
    expect(text).toContain("Restart-Service MSSQL$SQLEXPRESS -Force");
  });

  it("substitutes host and port", () => {
    const { text, resolved } = resolveCommand(tip("pg-auth-failed").command!, { host: "db01", port: 5433 });
    expect(text).toContain("-h db01");
    expect(text).toContain("-p 5433");
    expect(resolved).toBe(true);
  });

  it("leaves a command with no placeholders alone", () => {
    const cmd = tip("docker-daemon").command!;
    expect(resolveCommand(cmd, {}).text).toBe(cmd);
  });
});

describe("serviceNameFor", () => {
  it("names the default instance's service", () => {
    expect(serviceNameFor("MSSQLSERVER")).toBe("MSSQLSERVER");
    expect(serviceNameFor(undefined)).toBe("MSSQLSERVER");
  });
  it("names a named instance's service", () => {
    expect(serviceNameFor("SQLEXPRESS")).toBe("MSSQL$SQLEXPRESS");
  });
});

describe("domainForSource", () => {
  it("maps log sources onto domains", () => {
    expect(domainForSource("native:redis_exec")).toBe("redis");
    expect(domainForSource("native:docker_ps")).toBe("docker");
    expect(domainForSource("native:mssql_instances")).toBe("mssql");
    expect(domainForSource("native:http_request")).toBe("http");
  });
  it("returns nothing when the source is ambiguous", () => {
    // db_query serves five engines, so the message must decide.
    expect(domainForSource("native:db_query")).toBeUndefined();
  });
});
