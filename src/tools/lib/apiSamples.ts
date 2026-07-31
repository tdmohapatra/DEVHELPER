/**
 * Public API requests for trying the tester out.
 *
 * Every entry was called and returned 200 before being listed, needs no API key (or uses
 * a documented demo key), and returns JSON worth looking at. A few carry assertions so
 * the Tests tab has something real to evaluate on the first send.
 */

import { emptyRequest, type ApiRequest, type Assertion } from "./apiTypes";

export type SampleCategory = "Weather & earth" | "News" | "Reference" | "Finance" | "Fun" | "Utilities";

export interface ApiSample {
  id: string;
  name: string;
  category: SampleCategory;
  description: string;
  method: ApiRequest["method"];
  url: string;
  assertions?: Omit<Assertion, "id">[];
}

export const API_SAMPLES: ApiSample[] = [
  // ---- Weather & earth ----
  {
    id: "open-meteo",
    name: "Weather now (Open-Meteo)",
    category: "Weather & earth",
    description: "Current temperature and wind for a coordinate. No key, no rate limit for light use.",
    method: "GET",
    url: "https://api.open-meteo.com/v1/forecast?latitude=20.29&longitude=85.82&current=temperature_2m,wind_speed_10m",
    assertions: [
      { enabled: true, kind: "status", op: "equals", expected: "200" },
      { enabled: true, kind: "jsonPath", target: "$.current.temperature_2m", op: "exists" },
    ],
  },
  {
    id: "usgs-quakes",
    name: "Significant earthquakes (USGS)",
    category: "Weather & earth",
    description: "GeoJSON of notable earthquakes in the past week — a large nested payload, good for the JSONPath filter.",
    method: "GET",
    url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.geojson",
    assertions: [{ enabled: true, kind: "jsonPath", target: "$.features[0].properties.place", op: "exists" }],
  },
  {
    id: "sunrise",
    name: "Sunrise and sunset",
    category: "Weather & earth",
    description: "Solar times for a coordinate, returned in UTC.",
    method: "GET",
    url: "https://api.sunrise-sunset.org/json?lat=20.29&lng=85.82",
  },

  // ---- News ----
  {
    id: "hn-top",
    name: "Hacker News top stories",
    category: "News",
    description: "Array of the current top story ids. Follow one with /v0/item/<id>.json.",
    method: "GET",
    url: "https://hacker-news.firebaseio.com/v0/topstories.json",
  },
  {
    id: "spaceflight-news",
    name: "Spaceflight news",
    category: "News",
    description: "Recent spaceflight articles with titles, summaries and sources.",
    method: "GET",
    url: "https://api.spaceflightnewsapi.net/v4/articles/?limit=5",
    assertions: [{ enabled: true, kind: "jsonPath", target: "$.results[0].title", op: "exists" }],
  },
  {
    id: "wikipedia-featured",
    name: "Wikipedia featured content",
    category: "News",
    description: "The featured article, most-read pages and picture of the day for a date.",
    method: "GET",
    url: "https://api.wikimedia.org/feed/v1/wikipedia/en/featured/2026/07/31",
  },
  {
    id: "nasa-apod",
    name: "NASA picture of the day",
    category: "News",
    description: "Uses NASA's documented DEMO_KEY, which is rate limited but needs no signup.",
    method: "GET",
    url: "https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY",
  },

  // ---- Reference ----
  {
    id: "restcountries",
    name: "Country facts",
    category: "Reference",
    description: "Capital, population and names for a country.",
    method: "GET",
    url: "https://restcountries.com/v3.1/name/india?fields=name,capital,population",
  },
  {
    id: "github-repo",
    name: "GitHub repository",
    category: "Reference",
    description: "Public repo metadata. Unauthenticated requests are limited to 60 per hour per IP.",
    method: "GET",
    url: "https://api.github.com/repos/microsoft/vscode",
    assertions: [{ enabled: true, kind: "jsonPath", target: "$.stargazers_count", op: "exists" }],
  },
  {
    id: "pokeapi",
    name: "PokéAPI",
    category: "Reference",
    description: "A deeply nested payload — the usual example for JSONPath and code generation.",
    method: "GET",
    url: "https://pokeapi.co/api/v2/pokemon/pikachu",
  },

  // ---- Finance ----
  {
    id: "frankfurter",
    name: "Exchange rates (Frankfurter)",
    category: "Finance",
    description: "ECB reference rates. No key, no attribution required.",
    method: "GET",
    url: "https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR,EUR,GBP",
    assertions: [{ enabled: true, kind: "jsonPath", target: "$.rates.INR", op: "exists" }],
  },
  {
    id: "exchangerate-api",
    name: "Exchange rates (open access)",
    category: "Finance",
    description: "A second rate source, useful for comparing two responses with the JSON Diff tool.",
    method: "GET",
    url: "https://api.exchangerate-api.com/v4/latest/USD",
  },

  // ---- Utilities ----
  {
    id: "postman-echo-get",
    name: "Echo a GET (Postman Echo)",
    category: "Utilities",
    description: "Reflects your query, headers and origin — the quickest way to confirm what was actually sent.",
    method: "GET",
    url: "https://postman-echo.com/get?tool=devhelper",
    assertions: [{ enabled: true, kind: "jsonPath", target: "$.args.tool", op: "equals", expected: "devhelper" }],
  },
  {
    id: "postman-echo-post",
    name: "Echo a POST body",
    category: "Utilities",
    description: "Send a JSON body and see it returned, including a dynamic {{$guid}} in the payload.",
    method: "POST",
    url: "https://postman-echo.com/post",
  },
  {
    id: "jsonplaceholder",
    name: "JSONPlaceholder post",
    category: "Utilities",
    description: "The standard fake REST endpoint — small, stable, ideal for code generation.",
    method: "GET",
    url: "https://jsonplaceholder.typicode.com/posts/1",
  },
  {
    id: "ipify",
    name: "What is my IP",
    category: "Utilities",
    description: "Returns the public IP the request came from.",
    method: "GET",
    url: "https://api.ipify.org?format=json",
  },

  // ---- Fun ----
  {
    id: "catfact",
    name: "Cat fact",
    category: "Fun",
    description: "One random fact. Tiny response, handy for checking latency.",
    method: "GET",
    url: "https://catfact.ninja/fact",
  },
  {
    id: "agify",
    name: "Guess age from a name",
    category: "Fun",
    description: "Predicts an age for a first name. Demonstrates a query parameter.",
    method: "GET",
    url: "https://api.agify.io?name=tarakanta",
  },
];

export const SAMPLE_CATEGORIES: SampleCategory[] = [
  "Weather & earth",
  "News",
  "Reference",
  "Finance",
  "Utilities",
  "Fun",
];

export function sampleById(id: string): ApiSample | undefined {
  return API_SAMPLES.find((s) => s.id === id);
}

/** Build a ready-to-send request from a sample. `id` keeps the current tab in place. */
export function requestFromSample(sample: ApiSample, id: string): ApiRequest {
  const base = emptyRequest(id);
  const query = queryFromUrl(sample.url);
  return {
    ...base,
    name: sample.name,
    method: sample.method,
    url: sample.url.split("?")[0],
    query,
    assertions: (sample.assertions ?? []).map((a, i) => ({ ...a, id: `${sample.id}-${i}` })),
    ...(sample.method === "POST"
      ? {
          bodyType: "json" as const,
          body: JSON.stringify({ id: "{{$guid}}", sentAt: "{{$isoTimestamp}}", tool: "DevHelper" }, null, 2),
        }
      : {}),
  };
}

/** Split a sample URL's query string into editable rows. */
function queryFromUrl(url: string): ApiRequest["query"] {
  const qs = url.split("?")[1];
  if (!qs) return [];
  return qs.split("&").filter(Boolean).map((pair, i) => {
    const [key, ...rest] = pair.split("=");
    return { id: `q${i}`, key: decodeURIComponent(key), value: decodeURIComponent(rest.join("=")), enabled: true };
  });
}
