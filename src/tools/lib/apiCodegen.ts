import type { ResolvedRequest } from "./apiRequest";

export type CodeTarget = "curl" | "csharp" | "python" | "javascript" | "typescript";

export const CODE_TARGETS: { value: CodeTarget; label: string }[] = [
  { value: "curl", label: "cURL" },
  { value: "csharp", label: "C# HttpClient" },
  { value: "python", label: "Python requests" },
  { value: "javascript", label: "JavaScript fetch" },
  { value: "typescript", label: "TypeScript fetch" },
];

const q = (s: string) => JSON.stringify(s);

function curl(r: ResolvedRequest): string {
  const lines = [`curl -X ${r.method} ${q(r.url)}`];
  for (const [k, v] of Object.entries(r.headers)) lines.push(`  -H ${q(`${k}: ${v}`)}`);
  if (r.body) lines.push(`  --data ${q(r.body)}`);
  return lines.join(" \\\n");
}

function csharp(r: ResolvedRequest): string {
  const L: string[] = [];
  L.push("using var client = new HttpClient();");
  L.push(`var request = new HttpRequestMessage(HttpMethod.${methodPascal(r.method)}, ${q(r.url)});`);
  for (const [k, v] of Object.entries(r.headers)) {
    if (k.toLowerCase() === "content-type") continue;
    L.push(`request.Headers.TryAddWithoutValidation(${q(k)}, ${q(v)});`);
  }
  if (r.body) {
    const ct = r.headers["Content-Type"] ?? r.headers["content-type"] ?? "application/json";
    L.push(`request.Content = new StringContent(${q(r.body)}, System.Text.Encoding.UTF8, ${q(ct)});`);
  }
  L.push("var response = await client.SendAsync(request);");
  L.push("response.EnsureSuccessStatusCode();");
  L.push("var responseBody = await response.Content.ReadAsStringAsync();");
  return L.join("\n");
}

function python(r: ResolvedRequest): string {
  const L: string[] = ["import requests", ""];
  const headers = JSON.stringify(r.headers, null, 4);
  L.push(`url = ${pyStr(r.url)}`);
  L.push(`headers = ${headers === "{}" ? "{}" : pyDict(r.headers)}`);
  if (r.body) L.push(`data = ${pyStr(r.body)}`);
  const args = ["url", "headers=headers", ...(r.body ? ["data=data"] : [])].join(", ");
  L.push("");
  L.push(`response = requests.${r.method.toLowerCase()}(${args})`);
  L.push("print(response.status_code)");
  L.push("print(response.text)");
  return L.join("\n");
}

function jsFetch(r: ResolvedRequest, typed: boolean): string {
  const init: string[] = [`  method: ${q(r.method)}`];
  if (Object.keys(r.headers).length) init.push(`  headers: ${JSON.stringify(r.headers, null, 2).replace(/\n/g, "\n  ")}`);
  if (r.body) init.push(`  body: ${q(r.body)}`);
  const anno = typed ? ": Response" : "";
  return [
    `const response${anno} = await fetch(${q(r.url)}, {`,
    init.join(",\n"),
    `});`,
    `const data = await response.text();`,
    `console.log(response.status, data);`,
  ].join("\n");
}

function methodPascal(m: string): string {
  const map: Record<string, string> = { GET: "Get", POST: "Post", PUT: "Put", DELETE: "Delete", PATCH: "Patch", HEAD: "Head", OPTIONS: "Options" };
  return map[m] ?? "Get";
}
function pyStr(s: string): string {
  return JSON.stringify(s);
}
function pyDict(obj: Record<string, string>): string {
  const entries = Object.entries(obj).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  return `{\n${entries.join(",\n")}\n}`;
}

export function generateCode(target: CodeTarget, r: ResolvedRequest): string {
  switch (target) {
    case "curl":
      return curl(r);
    case "csharp":
      return csharp(r);
    case "python":
      return python(r);
    case "javascript":
      return jsFetch(r, false);
    case "typescript":
      return jsFetch(r, true);
  }
}
