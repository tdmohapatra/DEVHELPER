import { describe, it, expect } from "vitest";
import {
  importPostmanCollection,
  exportPostmanCollection,
  postmanUrlToString,
  PostmanImportError,
} from "./postmanCollection";
import { emptyRequest, type ApiRequest } from "./apiTypes";

const collection = {
  info: { name: "Orders API", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
  variable: [{ key: "baseUrl", value: "https://api.dev" }],
  item: [
    {
      name: "Health",
      request: { method: "GET", url: { raw: "{{baseUrl}}/health", host: ["{{baseUrl}}"], path: ["health"] } },
    },
    {
      name: "Orders",
      item: [
        {
          name: "List orders",
          request: {
            method: "GET",
            header: [{ key: "Accept", value: "application/json" }],
            url: {
              raw: "{{baseUrl}}/orders?page=1",
              host: ["{{baseUrl}}"],
              path: ["orders"],
              query: [
                { key: "page", value: "1" },
                { key: "debug", value: "true", disabled: true },
              ],
            },
            auth: { type: "bearer", bearer: [{ key: "token", value: "{{token}}" }] },
          },
          event: [{ listen: "test" }],
        },
        {
          name: "Create order",
          request: {
            method: "POST",
            url: "{{baseUrl}}/orders",
            body: { mode: "raw", raw: '{"sku":"A1"}', options: { raw: { language: "json" } } },
          },
        },
      ],
    },
  ],
};

describe("importPostmanCollection", () => {
  const imported = importPostmanCollection(JSON.stringify(collection));

  it("reads the collection name and variables", () => {
    expect(imported.name).toBe("Orders API");
    expect(imported.variables.map((v) => [v.key, v.value])).toEqual([["baseUrl", "https://api.dev"]]);
  });

  it("puts root requests first, then folders", () => {
    expect(imported.folders.map((f) => f.name)).toEqual(["", "Orders"]);
    expect(imported.folders[0].requests.map((r) => r.name)).toEqual(["Health"]);
    expect(imported.folders[1].requests.map((r) => r.name)).toEqual(["List orders", "Create order"]);
  });

  it("imports method, headers and query params, keeping disabled state", () => {
    const list = imported.folders[1].requests[0];
    expect(list.method).toBe("GET");
    expect(list.url).toBe("{{baseUrl}}/orders");
    expect(list.headers.map((h) => h.key)).toEqual(["Accept"]);
    expect(list.query.map((q) => [q.key, q.enabled])).toEqual([
      ["page", true],
      ["debug", false],
    ]);
  });

  it("imports auth", () => {
    expect(imported.folders[1].requests[0].auth).toMatchObject({ type: "bearer", token: "{{token}}" });
  });

  it("imports a raw JSON body with its language", () => {
    const create = imported.folders[1].requests[1];
    expect(create).toMatchObject({ method: "POST", bodyType: "json", body: '{"sku":"A1"}' });
  });

  it("reports scripts as skipped rather than dropping them silently", () => {
    expect(imported.skipped.join(" ")).toMatch(/List orders/);
  });

  it("imports urlencoded and formdata bodies", () => {
    const doc = {
      info: { name: "c" },
      item: [
        {
          name: "form",
          request: {
            method: "POST",
            url: "https://x.dev",
            body: { mode: "urlencoded", urlencoded: [{ key: "a", value: "1" }, { key: "b", value: "2", disabled: true }] },
          },
        },
        {
          name: "multipart",
          request: {
            method: "POST",
            url: "https://x.dev",
            body: { mode: "formdata", formdata: [{ key: "file", type: "file", src: "C:\\a.png" }] },
          },
        },
      ],
    };
    const r = importPostmanCollection(JSON.stringify(doc)).folders[0].requests;
    expect(r[0]).toMatchObject({ bodyType: "x-www-form-urlencoded", body: "a=1" });
    expect(r[1]).toMatchObject({ bodyType: "form-data", body: "file=C:\\a.png" });
  });

  it("flattens nested folders instead of losing them", () => {
    const doc = {
      info: { name: "c" },
      item: [{ name: "A", item: [{ name: "B", item: [{ name: "deep", request: "https://x.dev" }] }] }],
    };
    const out = importPostmanCollection(JSON.stringify(doc));
    expect(out.folders[0].name).toBe("A / B");
    expect(out.folders[0].requests[0].url).toBe("https://x.dev");
  });

  it("rejects input that is not a collection", () => {
    expect(() => importPostmanCollection("{}")).toThrow(PostmanImportError);
    expect(() => importPostmanCollection("not json")).toThrow(/valid JSON/);
    expect(() => importPostmanCollection(JSON.stringify({ info: { name: "x" }, item: [] }))).toThrow(/no requests/);
  });
});

describe("postmanUrlToString", () => {
  it("rebuilds a split url", () => {
    expect(postmanUrlToString({ protocol: "https", host: ["api", "dev"], path: ["v1", "users"] })).toBe(
      "https://api.dev/v1/users",
    );
  });
  it("prefers raw, without its query string", () => {
    expect(postmanUrlToString({ raw: "https://api.dev/x?a=1" })).toBe("https://api.dev/x");
  });
  it("accepts a plain string", () => {
    expect(postmanUrlToString("https://api.dev")).toBe("https://api.dev");
  });
});

describe("exportPostmanCollection", () => {
  const req: ApiRequest = {
    ...emptyRequest("r1"),
    name: "Create order",
    method: "POST",
    url: "https://api.dev/orders",
    headers: [{ id: "h1", key: "Accept", value: "application/json", enabled: true }],
    query: [{ id: "q1", key: "dry", value: "1", enabled: true }],
    bodyType: "json",
    body: '{"sku":"A1"}',
    auth: { type: "bearer", token: "tok" },
  };

  const doc = JSON.parse(exportPostmanCollection("Mine", [{ name: "Orders", requests: [req] }]));

  it("writes a v2.1 collection", () => {
    expect(doc.info.name).toBe("Mine");
    expect(doc.info.schema).toContain("v2.1.0");
  });

  it("writes the request under its folder", () => {
    expect(doc.item[0].name).toBe("Orders");
    expect(doc.item[0].item[0].name).toBe("Create order");
  });

  it("writes method, headers, query and body", () => {
    const out = doc.item[0].item[0].request;
    expect(out.method).toBe("POST");
    expect(out.header[0]).toMatchObject({ key: "Accept", disabled: false });
    expect(out.url.raw).toBe("https://api.dev/orders?dry=1");
    expect(out.body).toMatchObject({ mode: "raw", raw: '{"sku":"A1"}' });
    expect(out.auth).toMatchObject({ type: "bearer" });
  });

  it("round-trips back through the importer", () => {
    const back = importPostmanCollection(exportPostmanCollection("Mine", [{ name: "Orders", requests: [req] }]));
    const r = back.folders[0].requests[0];
    expect(r).toMatchObject({ name: "Create order", method: "POST", url: "https://api.dev/orders", bodyType: "json" });
    expect(r.auth).toMatchObject({ type: "bearer", token: "tok" });
    expect(r.query.map((q) => [q.key, q.value])).toEqual([["dry", "1"]]);
  });

  it("names an unfoldered group so Postman shows it", () => {
    const out = JSON.parse(exportPostmanCollection("Mine", [{ name: "", requests: [req] }]));
    expect(out.item[0].name).toBe("Requests");
  });
});
