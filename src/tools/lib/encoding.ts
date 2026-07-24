/** Base64 and URL encoding helpers. UTF-8 safe. */

export function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

export function base64ToText(b64: string): string {
  const binary = atob(b64.trim());
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function urlEncode(text: string): string {
  return encodeURIComponent(text);
}

export function urlDecode(text: string): string {
  return decodeURIComponent(text);
}

export interface QueryParam {
  key: string;
  value: string;
}

/** Parse the query string of a URL (or a bare `a=1&b=2` string) into pairs. */
export function parseQueryParams(input: string): QueryParam[] {
  let query = input.trim();
  const qIndex = query.indexOf("?");
  if (qIndex >= 0) {
    // Everything after the first "?" is the query string.
    query = query.slice(qIndex + 1);
  } else if (query.includes("/")) {
    // Looks like a URL/path with no query string.
    return [];
  }
  // Otherwise treat the input as a bare "a=1&b=2" query string.
  const hashIndex = query.indexOf("#");
  if (hashIndex >= 0) query = query.slice(0, hashIndex);
  if (!query) return [];
  return query.split("&").map((pair) => {
    const [k, ...rest] = pair.split("=");
    return { key: decodeURIComponent(k), value: decodeURIComponent(rest.join("=") || "") };
  });
}
