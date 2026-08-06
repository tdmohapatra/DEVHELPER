import { describe, it, expect } from "vitest";
import {
  detectBodyKind,
  mediaType,
  headerValue,
  formatBody,
  formatMarkup,
  availableModes,
  htmlSummary,
  bodyStats,
  supportsJsonPath,
} from "./responseBody";

describe("headerValue", () => {
  it("matches the name case-insensitively", () => {
    expect(headerValue({ "Content-Type": "application/json" }, "content-type")).toBe("application/json");
    expect(headerValue({ "content-type": "text/html" }, "Content-Type")).toBe("text/html");
  });

  it("returns an empty string when absent", () => {
    expect(headerValue({}, "content-type")).toBe("");
  });
});

describe("mediaType", () => {
  it("drops parameters and lowercases", () => {
    expect(mediaType("Application/JSON; charset=utf-8")).toBe("application/json");
    expect(mediaType("")).toBe("");
  });
});

describe("detectBodyKind", () => {
  it("reads the declared type", () => {
    expect(detectBodyKind("application/json", '{"a":1}')).toBe("json");
    expect(detectBodyKind("text/html; charset=utf-8", "<html><body>hi</body></html>")).toBe("html");
    expect(detectBodyKind("application/xml", "<?xml version='1.0'?><a/>")).toBe("xml");
    expect(detectBodyKind("text/csv", "a,b\n1,2")).toBe("csv");
    expect(detectBodyKind("text/css", "body{color:red}")).toBe("css");
    expect(detectBodyKind("application/javascript", "var a = 1;")).toBe("javascript");
    expect(detectBodyKind("text/plain", "just words")).toBe("text");
  });

  it("handles the +json and +xml suffixes", () => {
    expect(detectBodyKind("application/problem+json", "not parseable")).toBe("json");
    expect(detectBodyKind("application/soap+xml", "<Envelope/>")).toBe("xml");
  });

  it("believes the body over a wrong header", () => {
    // Endpoints answering JSON as text/plain are everywhere.
    expect(detectBodyKind("text/plain", '{"ok":true}')).toBe("json");
    // And an error page served where JSON was promised.
    expect(detectBodyKind("application/json", "<!DOCTYPE html><html><body>502</body></html>")).toBe("html");
  });

  it("recognises HTML with no doctype", () => {
    expect(detectBodyKind("", '<html data-dpl-id="x" lang="en"><head><meta charSet="utf-8"/>')).toBe("html");
  });

  it("does not call a JSON-looking string JSON unless it parses", () => {
    expect(detectBodyKind("text/plain", "{not json at all")).toBe("text");
  });

  it("flags binary bodies", () => {
    expect(detectBodyKind("image/png", "\u0000PNG\r\n")).toBe("binary");
    expect(detectBodyKind("application/octet-stream", "plain looking")).toBe("binary");
  });

  it("treats an empty body as text rather than binary", () => {
    expect(detectBodyKind("", "")).toBe("text");
  });
});

describe("formatBody", () => {
  it("indents JSON", () => {
    expect(formatBody("json", '{"a":1}').text).toBe('{\n  "a": 1\n}');
  });

  it("says why JSON could not be formatted, and still shows the body", () => {
    const out = formatBody("json", "{broken");
    expect(out.text).toBe("{broken");
    expect(out.note).toMatch(/not valid json/i);
  });

  it("leaves plain text alone", () => {
    expect(formatBody("text", "line1\nline2").text).toBe("line1\nline2");
  });

  it("refuses to render binary as text", () => {
    const out = formatBody("binary", "\u0000\u0001");
    expect(out.text).toBe("");
    expect(out.note).toMatch(/binary/i);
  });
});

describe("formatMarkup", () => {
  it("puts one tag per line and indents by depth", () => {
    expect(formatMarkup("<a><b>x</b></a>")).toBe("<a>\n  <b>\n    x\n  </b>\n</a>");
  });

  it("does not indent after a void element", () => {
    const out = formatMarkup("<head><meta charSet=\"utf-8\"/><title>T</title></head>");
    expect(out).toBe('<head>\n  <meta charSet="utf-8"/>\n  <title>\n    T\n  </title>\n</head>');
  });

  it("treats an unclosed void tag as self-closing", () => {
    expect(formatMarkup("<div><br><br></div>")).toBe("<div>\n  <br>\n  <br>\n</div>");
  });

  it("keeps the doctype on its own line without indenting the document", () => {
    expect(formatMarkup("<!DOCTYPE html><html></html>")).toBe("<!DOCTYPE html>\n<html>\n</html>");
  });

  it("leaves script and style contents untouched", () => {
    const src = "<script>if (a<b) { x() }</script>";
    expect(formatMarkup(src)).toBe("<script>\nif (a<b) { x() }\n</script>");
  });

  it("keeps a comment whole even with angle brackets inside", () => {
    expect(formatMarkup("<div><!-- a <b> c --></div>")).toBe("<div>\n  <!-- a <b> c -->\n</div>");
  });

  it("survives an unterminated tag instead of looping", () => {
    expect(formatMarkup("<div><span")).toBe("<div>\n  <span");
  });

  it("handles an empty string", () => {
    expect(formatMarkup("")).toBe("");
  });
});

describe("availableModes", () => {
  it("offers a preview only for HTML", () => {
    expect(availableModes("html")).toEqual(["pretty", "raw", "preview"]);
    expect(availableModes("json")).toEqual(["pretty", "raw"]);
    expect(availableModes("xml")).toEqual(["pretty", "raw"]);
  });

  it("offers only raw for binary", () => {
    expect(availableModes("binary")).toEqual(["raw"]);
  });
});

describe("htmlSummary", () => {
  const page = `<!DOCTYPE html><html><head>
    <title>CoinDesk: Bitcoin &amp; Crypto News</title>
    <meta name="description" content="Leader in cryptocurrency news."/>
    <script src="/a.js"></script><style>.a{color:red}</style>
  </head><body>
    <h1>Top story</h1><p>Some &quot;text&quot; here.</p>
    <h2>Markets</h2>
    <a href="/one">1</a><a href="/two">2</a>
    <img src="/i.png"/><form action="/s"></form>
  </body></html>`;

  it("pulls the title and decodes entities", () => {
    expect(htmlSummary(page).title).toBe("CoinDesk: Bitcoin & Crypto News");
  });

  it("pulls the meta description", () => {
    expect(htmlSummary(page).description).toBe("Leader in cryptocurrency news.");
  });

  it("reads the description when content comes before name", () => {
    const s = htmlSummary('<meta content="Backwards order" name="description"/>');
    expect(s.description).toBe("Backwards order");
  });

  it("lists headings in document order", () => {
    expect(htmlSummary(page).headings).toEqual(["Top story", "Markets"]);
  });

  it("counts links, scripts, images and forms", () => {
    const s = htmlSummary(page);
    expect(s.links).toBe(2);
    expect(s.scripts).toBe(1);
    expect(s.images).toBe(1);
    expect(s.forms).toBe(1);
  });

  it("strips tags and drops script and style content from the text", () => {
    const text = htmlSummary(page).text;
    expect(text).toContain('Some "text" here.');
    expect(text).not.toContain("color:red");
    expect(text).not.toContain("a.js");
  });

  it("decodes &amp; last so &amp;lt; does not become a tag", () => {
    expect(htmlSummary("<p>&amp;lt;b&amp;gt;</p>").text).toBe("&lt;b&gt;");
  });

  it("returns empty fields for a page with none of them", () => {
    const s = htmlSummary("<html><body></body></html>");
    expect(s.title).toBe("");
    expect(s.headings).toEqual([]);
    expect(s.links).toBe(0);
  });
});

describe("bodyStats", () => {
  it("counts lines and characters", () => {
    expect(bodyStats("a\nb\nc")).toEqual({ lines: 3, chars: 5 });
  });

  it("reports no lines for an empty body", () => {
    expect(bodyStats("")).toEqual({ lines: 0, chars: 0 });
  });
});

describe("supportsJsonPath", () => {
  it("is offered for JSON only", () => {
    expect(supportsJsonPath("json")).toBe(true);
    expect(supportsJsonPath("html")).toBe(false);
  });
});
