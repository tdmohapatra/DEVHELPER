import { describe, expect, it } from "vitest";
import {
  AI_SYSTEM_PROMPT,
  buildAiPrompt,
  CHECKLIST,
  detectLanguage,
  isComment,
  review,
  RULES,
  tally,
  toComments,
  type Language,
} from "./codeReview";

const found = (code: string, language: Language = "csharp") => review(code, language).map((f) => f.ruleId);

describe("detectLanguage", () => {
  it("recognises the three it has rules for", () => {
    expect(detectLanguage("public class Foo { async Task Bar() {} }")).toBe("csharp");
    expect(detectLanguage('import { x } from "y";')).toBe("typescript");
    expect(detectLanguage("SELECT * FROM patients")).toBe("sql");
    expect(detectLanguage("hello world")).toBe("any");
  });
});

describe("data that must not leave", () => {
  it("flags a whole payload being logged", () => {
    expect(found('_logger.LogInformation("received {Body}", body);')).toContain("log-payload");
    expect(found("console.log('patient', patient)", "typescript")).toContain("log-payload");
  });

  it("does not flag logging an id or a count", () => {
    expect(found('_logger.LogInformation("received {Count}", messages.Count);')).not.toContain("log-payload");
    expect(found('_logger.LogInformation("processed {MessageId}", message.Id);')).not.toContain("log-payload");
  });

  it("flags a hard-coded credential but not one read from configuration", () => {
    expect(found('var password = "SuperSecret123";')).toContain("hardcoded-secret");
    expect(found('var apiKey = Configuration["ApiKey"];')).not.toContain("hardcoded-secret");
    expect(found('var password = Environment.GetEnvironmentVariable("PW");')).not.toContain("hardcoded-secret");
    expect(found('var token = "{{placeholder}}";')).not.toContain("hardcoded-secret");
  });

  it("flags SQL built by concatenation", () => {
    expect(found('var sql = "SELECT * FROM Patients WHERE Mrn = \'" + mrn + "\'";')).toContain("sql-concat");
    expect(found('var sql = $"SELECT * FROM Patients WHERE Mrn = {mrn}";')).toContain("sql-concat");
    expect(found('var sql = "SELECT * FROM Patients WHERE Mrn = @mrn";')).not.toContain("sql-concat");
  });
});

describe("failures that only appear under load", () => {
  it("flags a new HttpClient and says why the tests still pass", () => {
    const finding = review("var client = new HttpClient();", "csharp").find((f) => f.ruleId === "new-httpclient")!;
    expect(finding.severity).toBe("high");
    expect(finding.why).toMatch(/TIME_WAIT/);
    expect(finding.why).toMatch(/work perfectly in every test/);
  });

  it("leaves a static readonly instance alone", () => {
    expect(found("private static readonly HttpClient Client = new HttpClient();")).not.toContain("new-httpclient");
  });

  it("flags every way of blocking on async", () => {
    expect(found("var x = FooAsync().Result;")).toContain("sync-over-async");
    expect(found("FooAsync().Wait();")).toContain("sync-over-async");
    expect(found("var x = FooAsync().GetAwaiter().GetResult();")).toContain("sync-over-async");
  });

  it("flags async void but not an event handler", () => {
    expect(found("public async void ProcessMessage(Message m) {")).toContain("async-void");
    expect(found("private async void Button_Click(object sender, EventArgs e) {")).not.toContain("async-void");
  });

  it("flags Thread.Sleep and says what it starves", () => {
    const finding = review("Thread.Sleep(5000);", "csharp").find((f) => f.ruleId === "thread-sleep-async")!;
    expect(finding.why).toMatch(/starves the pool/);
  });
});

describe("errors that vanish", () => {
  it("flags a discarded exception", () => {
    expect(found("try { Do(); } catch (Exception) { }")).toContain("swallowed-exception");
    expect(found("try { Do(); } catch { }")).toContain("swallowed-exception");
  });

  it("does not flag a catch that does something", () => {
    expect(found('try { Do(); } catch (Exception ex) { _logger.LogError(ex, "failed"); }')).not.toContain("swallowed-exception");
  });

  it("flags throw ex and explains what the log then points at", () => {
    const finding = review("catch (Exception ex) { throw ex; }", "csharp").find((f) => f.ruleId === "rethrow-loses-stack")!;
    expect(finding.fix).toMatch(/`throw;`/);
    expect(found("catch (Exception ex) { throw; }")).not.toContain("rethrow-loses-stack");
  });

  it("flags a catch that returns a default, because empty then looks like success", () => {
    const finding = review("catch (Exception) { return null; }", "csharp").find((f) => f.ruleId === "empty-catch-return")!;
    expect(finding.why).toMatch(/assumed to be working/);
  });
});

describe("time", () => {
  it("flags DateTime.Now and explains the daylight-saving case", () => {
    const finding = review("var at = DateTime.Now;", "csharp").find((f) => f.ruleId === "datetime-now")!;
    expect(finding.why).toMatch(/hour that happens twice/);
    expect(found("var at = DateTimeOffset.UtcNow;")).not.toContain("datetime-now");
  });

  it("flags a culture-dependent parse but not an exact one", () => {
    expect(found("var d = DateTime.Parse(value);")).toContain("datetime-parse-culture");
    expect(found('var d = DateTime.ParseExact(value, "yyyyMMdd", CultureInfo.InvariantCulture);')).not.toContain("datetime-parse-culture");
    expect(found("var d = DateTime.TryParse(value, CultureInfo.InvariantCulture, out var x);")).not.toContain("datetime-parse-culture");
  });
});

describe("integration hygiene", () => {
  it("flags HL7 split on a bar and says what the escapes do", () => {
    const finding = review('var fields = line.Split(\'|\');', "csharp").find((f) => f.ruleId === "hl7-split")!;
    expect(finding.why).toMatch(/MSH-1 and MSH-2/);
  });

  it("flags an unchecked field index", () => {
    expect(found("var mrn = fields[3];")).toContain("index-without-bounds");
  });

  it("flags disabled certificate validation in either language", () => {
    expect(found('"Server=x;TrustServerCertificate=true"')).toContain("trust-certificate");
    expect(found("{ rejectUnauthorized: false }", "typescript")).toContain("trust-certificate");
  });

  it("flags a disposable without using, but not a field or one already in a using", () => {
    expect(found("var conn = new SqlConnection(cs);")).toContain("missing-using");
    expect(found("using var conn = new SqlConnection(cs);")).not.toContain("missing-using");
    expect(found("_connection = new SqlConnection(cs);")).not.toContain("missing-using");
  });

  it("treats a missing correlation header as a question, not a verdict", () => {
    const finding = review("await _httpClient.PostAsync(url, content);", "csharp").find((f) => f.ruleId === "no-correlation")!;
    expect(finding.severity).toBe("low");
    expect(finding.why).toMatch(/Not necessarily wrong/);
    expect(found('_httpClient.DefaultRequestHeaders.Add("x-request-id", id); await _httpClient.PostAsync(url, c);')).not.toContain("no-correlation");
  });

  it("flags an async method with no cancellation token", () => {
    expect(found("public async Task<Result> ProcessAsync(Message message) {")).toContain("no-cancellation");
    expect(found("public async Task<Result> ProcessAsync(Message m, CancellationToken ct) {")).not.toContain("no-cancellation");
  });
});

describe("review", () => {
  it("ignores commented-out code", () => {
    expect(found("// var client = new HttpClient();")).toEqual([]);
    expect(found(" * var x = FooAsync().Result;")).toEqual([]);
    expect(isComment("-- SELECT 1", "sql")).toBe(true);
    expect(isComment("var x = 1;", "csharp")).toBe(false);
  });

  it("reports the line number, without which a comment is an argument", () => {
    const findings = review("line one\nvar c = new HttpClient();\nline three", "csharp");
    expect(findings[0].line).toBe(2);
    expect(findings[0].excerpt).toBe("var c = new HttpClient();");
  });

  it("puts the worst first, then by line", () => {
    const code = ["var at = DateTime.Now;", "var c = new HttpClient();"].join("\n");
    const findings = review(code, "csharp");
    expect(findings[0].severity).toBe("high");
    expect(findings[0].ruleId).toBe("new-httpclient");
  });

  it("only runs rules for the language, plus the language-agnostic ones", () => {
    expect(found("var x = FooAsync().Result;", "typescript")).not.toContain("sync-over-async");
    // The credential rule is `any`, so it fires whatever the language.
    expect(found('const password = "SuperSecret123";', "typescript")).toContain("hardcoded-secret");
  });

  it("says nothing about code with nothing wrong with it", () => {
    const clean = [
      "public async Task<Result> ProcessAsync(Message message, CancellationToken ct)",
      "{",
      "    var at = DateTimeOffset.UtcNow;",
      '    _logger.LogInformation("processing {MessageId}", message.Id);',
      "    return await _handler.HandleAsync(message, ct);",
      "}",
    ].join("\n");
    expect(review(clean, "csharp")).toEqual([]);
  });

  it("counts by severity", () => {
    const findings = review("var c = new HttpClient();\nvar at = DateTime.Now;", "csharp");
    expect(tally(findings)).toEqual({ high: 1, medium: 1, low: 0 });
  });
});

describe("rules", () => {
  it("gives every rule a reason and a fix worth reading", () => {
    for (const rule of RULES) {
      expect(rule.why.length).toBeGreaterThan(60);
      expect(rule.fix.length).toBeGreaterThan(30);
      expect(rule.languages.length).toBeGreaterThan(0);
    }
  });

  it("has unique ids", () => {
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
  });
});

describe("checklist", () => {
  it("asks what a pattern cannot see, and stays short enough to be read", () => {
    expect(CHECKLIST.length).toBeLessThanOrEqual(12);
    for (const item of CHECKLIST) {
      expect(item.question.endsWith("?")).toBe(true);
      expect(item.why.length).toBeGreaterThan(50);
    }
  });

  it("leads with running twice, which retries and at-least-once both guarantee", () => {
    expect(CHECKLIST[0].question).toMatch(/runs twice/);
  });
});

describe("AI prompt", () => {
  it("tells the model what not to say, which is most of the value", () => {
    expect(AI_SYSTEM_PROMPT).toMatch(/Do not comment on naming, formatting/);
    expect(AI_SYSTEM_PROMPT).toMatch(/say so in one line/);
  });

  it("passes the static findings so the AI does not repeat them", () => {
    const findings = review("var c = new HttpClient();", "csharp");
    const prompt = buildAiPrompt("var c = new HttpClient();", "csharp", findings);
    expect(prompt).toMatch(/do not repeat them/);
    expect(prompt).toContain("`new HttpClient()`");
  });

  it("omits that instruction when there is nothing to omit", () => {
    expect(buildAiPrompt("clean", "csharp", [])).not.toMatch(/do not repeat/);
  });
});

describe("toComments", () => {
  it("writes a comment per finding with the file and line", () => {
    const output = toComments(review("var c = new HttpClient();", "csharp"), "OrderService.cs");
    expect(output).toContain("OrderService.cs:1");
    expect(output).toContain("🔴");
    expect(output).toContain("**Instead:**");
  });

  it("says so plainly when there is nothing", () => {
    expect(toComments([])).toMatch(/No findings/);
  });
});
