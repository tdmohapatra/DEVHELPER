import { describe, it, expect } from "vitest";
import {
  parseMssqlConnString,
  splitServerAddress,
  formatServerAddress,
  explainMssqlError,
  convertRawConnection,
} from "./mssqlConn";
import { buildConnString, connTarget, connectionProblems, looksLikeSecret, type DbConnection } from "./dbTypes";

describe("splitServerAddress", () => {
  it("reads a bare host", () => {
    expect(splitServerAddress("localhost")).toEqual({ host: "localhost", instance: undefined, port: undefined });
  });
  it("reads host and port", () => {
    expect(splitServerAddress("db01,1433")).toMatchObject({ host: "db01", port: 1433 });
  });
  it("reads a named instance", () => {
    expect(splitServerAddress("DESKTOP-X\\SQLEXPRESS")).toMatchObject({ host: "DESKTOP-X", instance: "SQLEXPRESS" });
  });
  it("reads instance and port together", () => {
    expect(splitServerAddress("DESKTOP-X\\DEV,49823")).toMatchObject({
      host: "DESKTOP-X",
      instance: "DEV",
      port: 49823,
    });
  });
  it("strips a tcp: prefix", () => {
    expect(splitServerAddress("tcp:db01,1433")).toMatchObject({ host: "db01", port: 1433 });
  });
  it("expands the (local) and . shorthands", () => {
    expect(splitServerAddress("(local)").host).toBe("localhost");
    expect(splitServerAddress(".\\SQLEXPRESS")).toMatchObject({ host: "localhost", instance: "SQLEXPRESS" });
  });
  it("does not treat a non-port suffix as a port", () => {
    expect(splitServerAddress("db01,notaport")).toMatchObject({ host: "db01,notaport", port: undefined });
  });
});

describe("formatServerAddress", () => {
  it("joins host and instance", () => {
    expect(formatServerAddress("HOST", "DEV")).toBe("HOST\\DEV");
  });
  it("omits the default instance name", () => {
    expect(formatServerAddress("HOST", "MSSQLSERVER")).toBe("HOST");
    expect(formatServerAddress("HOST")).toBe("HOST");
  });
});

describe("parseMssqlConnString", () => {
  it("parses a SQL-login ADO string", () => {
    const { conn, password } = parseMssqlConnString(
      "Server=tcp:db01,1433;Database=Sales;User Id=sa;Password=s3cret;TrustServerCertificate=True",
    );
    expect(conn).toMatchObject({
      engine: "mssql",
      host: "db01",
      port: 1433,
      database: "Sales",
      user: "sa",
      trustServerCertificate: true,
    });
    expect(password).toBe("s3cret");
  });

  it("parses the SSMS default-instance form", () => {
    const { conn } = parseMssqlConnString(
      'Data Source=DESKTOP-MHPFCI3;Integrated Security=True;Encrypt=True;Application Name="SQL Server Management Studio"',
    );
    expect(conn).toMatchObject({ host: "DESKTOP-MHPFCI3", integratedSecurity: true, port: 1433, database: "master" });
  });

  it("keeps a named instance and does not invent a port for it", () => {
    const { conn, notes } = parseMssqlConnString("Server=DESKTOP-X\\SQLEXPRESS;Initial Catalog=App;Trusted_Connection=yes");
    expect(conn.host).toBe("DESKTOP-X\\SQLEXPRESS");
    expect(conn.port).toBeUndefined();
    expect(conn.integratedSecurity).toBe(true);
    expect(notes.join(" ")).toMatch(/SQL Browser/);
  });

  it("parses a JDBC URL", () => {
    const { conn, password } = parseMssqlConnString(
      "jdbc:sqlserver://db01:1433;databaseName=App;user=svc;password=p@ss",
    );
    expect(conn).toMatchObject({ host: "db01", port: 1433, database: "App", user: "svc" });
    expect(password).toBe("p@ss");
  });

  it("parses a JDBC URL naming an instance", () => {
    const { conn } = parseMssqlConnString("jdbc:sqlserver://HOST\\DEV;databaseName=App");
    expect(conn.host).toBe("HOST\\DEV");
  });

  it("defaults a missing database to master and says so", () => {
    const { conn, notes } = parseMssqlConnString("Server=db01");
    expect(conn.database).toBe("master");
    expect(notes.join(" ")).toMatch(/master/);
  });

  it("flags options it cannot honour", () => {
    const { notes } = parseMssqlConnString("Server=db01;MultiSubnetFailover=True");
    expect(notes.join(" ")).toMatch(/MultiSubnetFailover/i);
  });

  it("rejects a string with no server", () => {
    expect(() => parseMssqlConnString("Database=App;User Id=sa")).toThrow(/No server/);
    expect(() => parseMssqlConnString("   ")).toThrow();
  });

  it("round-trips into a connection string the driver accepts", () => {
    const { conn, password } = parseMssqlConnString("Server=db01,1433;Database=App;User Id=sa;Password=p");
    const built = buildConnString({ id: "1", name: "x", ...conn } as DbConnection, password ?? "");
    expect(built).toContain("Server=tcp:db01,1433");
    expect(built).toContain("Database=App");
    expect(built).toContain("Password=p");
  });
});

describe("encryption and dropped keys", () => {
  it("reads Encrypt", () => {
    expect(parseMssqlConnString("Server=h;Encrypt=True").conn.encrypt).toBe(true);
    expect(parseMssqlConnString("Server=h;Encrypt=False").conn.encrypt).toBe(false);
    expect(parseMssqlConnString("Server=h").conn.encrypt).toBeUndefined();
  });

  it("sends Encrypt only when it was chosen", () => {
    const base: DbConnection = { id: "1", name: "n", engine: "mssql", host: "h", port: 1433, database: "d", user: "u" };
    expect(buildConnString(base, "p")).not.toContain("Encrypt=");
    expect(buildConnString({ ...base, encrypt: true }, "p")).toContain("Encrypt=true");
    expect(buildConnString({ ...base, encrypt: false }, "p")).toContain("Encrypt=false");
  });

  it("names the keys it drops", () => {
    const notes = parseMssqlConnString("Server=h;MultiSubnetFailover=True;Replication=True;Odd Key=1").notes;
    expect(notes.join(" ")).toContain("Odd Key");
  });

  it("stays quiet about client-side keys that change nothing", () => {
    const notes = parseMssqlConnString(
      'Data Source=h;Persist Security Info=True;Pooling=False;MultipleActiveResultSets=False;Application Name="SQL Server Management Studio";Command Timeout=0',
    ).notes;
    expect(notes.join(" ")).not.toContain("Not carried over");
  });
});

describe("convertRawConnection", () => {
  const raw: DbConnection = {
    id: "abc",
    name: "tradelab",
    engine: "mssql",
    usesRawConnString: true,
    rawConnString:
      'Data Source=192.168.0.7;Persist Security Info=True;User ID=sa;Password=hunter2;Pooling=False;Encrypt=True;TrustServerCertificate=True;Application Name="SQL Server Management Studio"',
    safeMode: true,
  };

  it("moves the server details into saved fields", () => {
    const { conn } = convertRawConnection(raw);
    expect(conn).toMatchObject({
      id: "abc",
      name: "tradelab",
      host: "192.168.0.7",
      port: 1433,
      user: "sa",
      encrypt: true,
      trustServerCertificate: true,
      usesRawConnString: false,
    });
  });

  it("leaves the password out of the saved connection", () => {
    const { conn, password } = convertRawConnection(raw);
    expect(password).toBe("hunter2");
    expect(JSON.stringify(conn)).not.toContain("hunter2");
    expect(conn.rawConnString).toBeUndefined();
  });

  it("keeps the connection's own settings that the string says nothing about", () => {
    expect(convertRawConnection(raw).conn.safeMode).toBe(true);
  });

  it("produces a connection string equivalent to the one it replaced", () => {
    const { conn, password } = convertRawConnection(raw);
    const built = buildConnString(conn, password ?? "");
    expect(built).toContain("Server=tcp:192.168.0.7,1433");
    expect(built).toContain("User Id=sa");
    expect(built).toContain("Password=hunter2");
    expect(built).toContain("Encrypt=true");
  });

  it("refuses an engine with no parser", () => {
    expect(() => convertRawConnection({ ...raw, engine: "postgres" })).toThrow(/SQL Server/);
  });

  it("reports an unparseable string rather than saving a broken connection", () => {
    expect(() => convertRawConnection({ ...raw, rawConnString: "nonsense" })).toThrow(/No server found/);
  });
});

describe("named instances in the built connection string", () => {
  const base = { id: "1", name: "n", engine: "mssql" as const, database: "App", integratedSecurity: true };

  it("keeps the backslash so the native layer can resolve the port", () => {
    const s = buildConnString({ ...base, host: "HOST\\SQLEXPRESS" } as DbConnection, "");
    expect(s).toContain("Server=HOST\\SQLEXPRESS;");
    expect(s).not.toContain("1433");
  });

  it("uses an explicit port when one is given", () => {
    const s = buildConnString({ ...base, host: "HOST\\SQLEXPRESS", port: 49823 } as DbConnection, "");
    expect(s).toContain("Server=HOST\\SQLEXPRESS,49823");
  });

  it("still emits tcp:host,port for a plain host", () => {
    const s = buildConnString({ ...base, host: "db01", port: 1433 } as DbConnection, "");
    expect(s).toContain("Server=tcp:db01,1433");
  });

  it("does not show an invented port in the target label", () => {
    expect(connTarget({ ...base, host: "HOST\\SQLEXPRESS" } as DbConnection)).toBe("HOST\\SQLEXPRESS/App");
    expect(connTarget({ ...base, host: "db01" } as DbConnection)).toBe("db01:1433/App");
  });
});

describe("connectionProblems", () => {
  const base = { id: "1", name: "n" };

  it("names the missing user that PostgreSQL reports as 'invalid configuration'", () => {
    const problems = connectionProblems({ ...base, engine: "postgres", host: "localhost", port: 5432 } as DbConnection);
    expect(problems.join(" ")).toMatch(/User is required for PostgreSQL/);
    expect(problems.join(" ")).toMatch(/Database is required/);
  });

  it("accepts a complete PostgreSQL connection", () => {
    expect(
      connectionProblems({ ...base, engine: "postgres", host: "h", port: 5432, user: "postgres", database: "postgres" } as DbConnection),
    ).toEqual([]);
  });

  it("does not demand a user for SQL Server with Windows authentication", () => {
    expect(
      connectionProblems({ ...base, engine: "mssql", host: "localhost", database: "master", integratedSecurity: true } as DbConnection),
    ).toEqual([]);
  });

  it("demands a user for SQL Server without Windows authentication", () => {
    expect(
      connectionProblems({ ...base, engine: "mssql", host: "localhost", database: "master" } as DbConnection).join(" "),
    ).toMatch(/User is required/);
  });

  it("requires a file for SQLite and nothing else", () => {
    expect(connectionProblems({ ...base, engine: "sqlite" } as DbConnection)).toHaveLength(1);
    expect(connectionProblems({ ...base, engine: "sqlite", filePath: "C:\\a.db" } as DbConnection)).toEqual([]);
  });

  it("only checks that a raw connection string is present", () => {
    expect(connectionProblems({ ...base, engine: "postgres", usesRawConnString: true } as DbConnection)).toHaveLength(1);
    expect(
      connectionProblems({ ...base, engine: "postgres", usesRawConnString: true, rawConnString: "postgresql://u@h/db" } as DbConnection),
    ).toEqual([]);
  });

  it("requires a host for server engines", () => {
    expect(connectionProblems({ ...base, engine: "mysql", user: "root", database: "mysql" } as DbConnection).join(" ")).toMatch(
      /Host is required/,
    );
  });
});

describe("looksLikeSecret", () => {
  it("flags a password typed into a persisted field", () => {
    expect(looksLikeSecret("Tradelab#12")).toBe(true);
    expect(looksLikeSecret("P@ssw0rd!")).toBe(true);
  });
  it("accepts ordinary environment tags", () => {
    for (const tag of ["DEV", "QA", "PROD", "UAT", "staging", "local", "Production EU"]) {
      expect(looksLikeSecret(tag), tag).toBe(false);
    }
  });
  it("ignores short or simple values", () => {
    expect(looksLikeSecret("Ab1!")).toBe(false);
    expect(looksLikeSecret("customer-one")).toBe(false);
    expect(looksLikeSecret(undefined)).toBe(false);
  });
});

describe("explainMssqlError", () => {
  it("explains a refused connection", () => {
    expect(explainMssqlError("Connect failed: connection refused")).toMatch(/TCP\/IP/);
  });
  it("explains a failed login", () => {
    expect(explainMssqlError("Login failed for user 'sa'")).toMatch(/mixed-mode/);
  });
  it("explains a missing SQL Browser", () => {
    expect(explainMssqlError("No reply from the SQL Browser on HOST")).toMatch(/services\.msc/);
  });
  it("explains a missing database", () => {
    expect(explainMssqlError("Cannot open database \"App\"")).toMatch(/master/);
  });
  it("returns null when it has nothing useful to add", () => {
    expect(explainMssqlError("some other failure")).toBeNull();
  });
});
