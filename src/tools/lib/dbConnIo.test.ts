import { describe, it, expect } from "vitest";
import { serializeConnections, parseConnectionsFile, type DbConnection } from "./dbTypes";

const conns: DbConnection[] = [
  { id: "1", name: "Local MSSQL", engine: "mssql", host: "localhost", port: 1434, integratedSecurity: true, trustServerCertificate: true, rawConnString: "Server=...secret..." },
  { id: "2", name: "Dev PG", engine: "postgres", host: "dev", port: 5432, database: "app", user: "app" },
];

describe("serializeConnections", () => {
  it("emits a versioned file and strips the raw connection string", () => {
    const json = serializeConnections(conns);
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(1);
    expect(parsed.connections).toHaveLength(2);
    expect(parsed.connections[0].rawConnString).toBeUndefined();
    expect(parsed.connections[0].name).toBe("Local MSSQL");
  });
});

describe("parseConnectionsFile", () => {
  it("round-trips an exported file", () => {
    const back = parseConnectionsFile(serializeConnections(conns));
    expect(back.map((c) => c.name)).toEqual(["Local MSSQL", "Dev PG"]);
    expect(back[0].rawConnString).toBeUndefined();
  });
  it("accepts a bare array too", () => {
    expect(parseConnectionsFile('[{"name":"x","engine":"sqlite"}]')).toHaveLength(1);
  });
  it("drops invalid entries and throws when none remain", () => {
    expect(() => parseConnectionsFile('{"connections":[{"foo":1}]}')).toThrow();
    expect(() => parseConnectionsFile("not json")).toThrow();
  });
});
