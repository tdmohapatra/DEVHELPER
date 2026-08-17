/**
 * Reviewing integration code for the things that only bite in production.
 *
 * Not a linter. A linter already has opinions about braces and unused
 * variables, and a compiler has opinions about types. What neither has is an
 * opinion about the handful of patterns that are perfectly legal, compile
 * cleanly, pass every test written against a happy path, and then take an
 * interface down at three in the morning — or quietly put a patient identifier
 * into a log aggregator.
 *
 * So the rules here are chosen by one test: **has this specific pattern caused a
 * real incident in an integration?** `new HttpClient()` in a request handler
 * exhausts sockets under load and works perfectly in every test. `.Result`
 * deadlocks under a synchronisation context and not in a console app.
 * `DateTime.Now` in a hospital that spans a daylight-saving boundary produces
 * results timestamped an hour in the past. None of those are style.
 *
 * Every finding carries **why it matters** and **what to do instead**, because a
 * finding that only says "avoid this" gets argued with rather than fixed. And
 * every one is a *heuristic over text*: this reads patterns, not semantics, so
 * it is confident about `catch (Exception) { }` and merely suspicious about
 * whether a log line contains PHI. The severity says which.
 */

export type Language = "csharp" | "typescript" | "sql" | "any";

export type Severity = "high" | "medium" | "low";

export interface Rule {
  id: string;
  languages: Language[];
  severity: Severity;
  title: string;
  /** Matched against a single line unless `multiline`. */
  pattern: RegExp;
  /** When set, the rule is suppressed if this also matches the line. */
  unless?: RegExp;
  why: string;
  fix: string;
}

/**
 * The rules.
 *
 * Ordered roughly by how much damage the pattern does, because the list is read
 * top to bottom by someone deciding what to fix first.
 */
export const RULES: Rule[] = [
  // -- Data that must not leave -------------------------------------------
  {
    id: "log-payload",
    languages: ["csharp", "typescript"],
    severity: "high",
    title: "A whole payload is being logged",
    pattern: /\b(?:_?log(?:ger)?\.\w+|Console\.(?:Write|WriteLine)|console\.(?:log|info|warn|error|debug))\s*\([^)]*\b(message|payload|body|request|response|dto|patient|model|entity)\b/i,
    unless: /\b(?:Id|Count|Length|Type|Name)\s*\)/,
    why: "Logging a whole object logs whatever it happens to contain. In this domain that is a patient record, and the log has a year of retention and a dozen people's access. This is the single commonest way PHI leaves a system.",
    fix: "Log identifiers and counts — a correlation id, a message control id, a record count. If the body is genuinely needed to debug, run it through the PHI Gateway's de-identification first, or log it at Debug behind a switch that is off in production.",
  },
  {
    id: "hardcoded-secret",
    languages: ["any"],
    severity: "high",
    title: "A credential looks hard-coded",
    pattern: /(?:password|pwd|secret|apikey|api_key|accountkey|sharedaccesskey|token|connectionstring)\s*[=:]\s*["'][^"'{}$]{8,}["']/i,
    unless: /(?:getenv|environment|configuration|process\.env|\{\{|<%|placeholder|example|xxxx|\*\*\*)/i,
    why: "A credential in source is a credential in every clone, every branch, every CI log and the repository's whole history — removing it later does not remove it from history.",
    fix: "Read it from configuration or a secret store. If it has already been committed, rotate it: deleting the line is not enough.",
  },
  {
    id: "sql-concat",
    languages: ["csharp", "typescript"],
    severity: "high",
    title: "SQL built by string concatenation",
    /*
     * Two shapes, because they look nothing alike: an interpolated string
     * (C# `$"…{x}"`, JS template) carrying SQL and a placeholder, and a plain
     * string of SQL that something is concatenated onto. Matching the keyword
     * and the interpolation as one unit is what lets a parameterised query —
     * `WHERE Mrn = @mrn`, no concatenation — come back clean.
     */
    pattern: /(?:(?:\$"|`)[^"`]*\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^"`]*\{)|(?:"[^"]*\b(?:SELECT|INSERT|UPDATE|DELETE|WHERE|FROM)\b[^"]*"\s*\+)/i,
    why: "SQL injection, and in a system holding patient data that is the whole database. It also defeats plan caching, so it is slower as well as dangerous.",
    fix: "Parameterise. `cmd.Parameters.AddWithValue`, Dapper's anonymous-object parameters, or EF's LINQ — all of them send the value separately from the statement.",
  },

  // -- Failures that only appear under load --------------------------------
  {
    id: "new-httpclient",
    languages: ["csharp"],
    severity: "high",
    title: "`new HttpClient()`",
    pattern: /new\s+HttpClient\s*\(/,
    unless: /\/\/|static\s+readonly/,
    why: "Each instance holds its socket in TIME_WAIT after disposal, so a handler that creates one per request exhausts the port range under load. It also never picks up DNS changes, which is how a failover leaves a service calling an address that no longer serves it. Both work perfectly in every test.",
    fix: "Inject `IHttpClientFactory` and call `CreateClient`, or hold one static instance for the process lifetime.",
  },
  {
    id: "sync-over-async",
    languages: ["csharp"],
    severity: "high",
    title: "Blocking on an async call",
    pattern: /\.(?:Result\b|Wait\(\)|GetAwaiter\(\)\.GetResult\(\))/,
    why: "Under a synchronisation context this deadlocks — the continuation waits for a thread the caller is already blocking. It does not deadlock in a console app or a unit test, which is why it survives review and fails in ASP.NET.",
    fix: "Make the caller async and `await`. If the entry point genuinely cannot be async, that is the one place to block, and it should be commented as deliberate.",
  },
  {
    id: "async-void",
    languages: ["csharp"],
    severity: "high",
    title: "`async void`",
    pattern: /\basync\s+void\s+(?!\w*(?:_Click|_Load|_Tick)\b)\w+\s*\(/,
    why: "An exception thrown in an `async void` method cannot be caught by the caller — it goes to the synchronisation context and usually kills the process. Nothing can await it either, so it is invisible to any orchestration.",
    fix: "Return `Task`. `async void` is only correct for an event handler, whose signature demands it.",
  },
  {
    id: "thread-sleep-async",
    languages: ["csharp"],
    severity: "medium",
    title: "`Thread.Sleep` inside async code",
    pattern: /Thread\.Sleep\s*\(/,
    why: "It blocks the thread rather than releasing it, so a retry loop that sleeps holds a thread-pool thread for the whole delay. A handful of those under load starves the pool, and the symptom is unrelated requests timing out.",
    fix: "`await Task.Delay(...)`, with a CancellationToken so a shutdown does not wait for it.",
  },

  // -- Errors that vanish --------------------------------------------------
  {
    id: "swallowed-exception",
    languages: ["csharp", "typescript"],
    severity: "high",
    title: "An exception is caught and discarded",
    pattern: /catch\s*(?:\([^)]*\))?\s*\{\s*\}/,
    why: "The failure still happened; only the evidence is gone. In an integration this is how a message is silently dropped — the sender records success, the receiver never got it, and nothing anywhere says so.",
    fix: "At minimum log it with its correlation id. If it is genuinely expected and harmless, catch the specific type and say in a comment why it is safe.",
  },
  {
    id: "rethrow-loses-stack",
    languages: ["csharp"],
    severity: "medium",
    title: "`throw ex;` resets the stack trace",
    pattern: /\bthrow\s+(?:ex|e|exception|error)\s*;/i,
    why: "It rethrows from here, discarding where the exception actually came from. The log then points at the catch block, which is never the bug.",
    fix: "`throw;` on its own preserves the original stack. To add context, wrap: `throw new InvalidOperationException(\"…\", ex);`",
  },
  {
    id: "empty-catch-return",
    languages: ["csharp", "typescript"],
    severity: "medium",
    title: "A catch block returns a default",
    pattern: /catch\s*(?:\([^)]*\))?\s*\{\s*return\s+(?:null|false|0|new |\[\]|\{\})/,
    why: "The caller cannot tell a real empty result from a failure, so a downstream outage looks like 'no records' — and an integration that reports no records is usually assumed to be working.",
    fix: "Let it throw, or return a result type that distinguishes failure from emptiness.",
  },

  // -- Time, which this domain gets wrong constantly -----------------------
  {
    id: "datetime-now",
    languages: ["csharp"],
    severity: "medium",
    title: "`DateTime.Now`",
    pattern: /\bDateTime\.Now\b/,
    why: "Local time on whichever server happens to run the code. Two servers in different regions produce different timestamps for the same event, and a daylight-saving boundary produces an hour that happens twice — so results file out of order, or an hour in the past.",
    fix: "`DateTimeOffset.UtcNow` for anything recorded or compared. Convert to local only when displaying, and only in the display layer.",
  },
  {
    id: "datetime-parse-culture",
    languages: ["csharp"],
    severity: "medium",
    title: "Date parsed without a culture",
    pattern: /DateTime(?:Offset)?\.(?:Parse|TryParse)\s*\((?![^)]*(?:Culture|Invariant|ParseExact))/,
    why: "Parsing depends on the machine's culture, so `03/04/2026` is March on one server and April on another. HL7 and X12 dates are fixed-format and must never be parsed by guesswork.",
    fix: "`DateTime.TryParseExact` with the format the standard specifies and `CultureInfo.InvariantCulture`.",
  },

  // -- Integration hygiene -------------------------------------------------
  {
    id: "no-cancellation",
    languages: ["csharp"],
    severity: "low",
    title: "Async method with no CancellationToken",
    pattern: /\b(?:public|internal|private|protected)\s+(?:static\s+)?async\s+Task(?:<[^>]+>)?\s+\w+\s*\((?![^)]*CancellationToken)[^)]*\)/,
    unless: /\(\s*\)/,
    why: "Nothing can stop the work. On shutdown the host waits for it, and a request the caller abandoned keeps running to completion — holding a connection and, if it retries, doing the work twice.",
    fix: "Take a `CancellationToken` and pass it down to every call that accepts one.",
  },
  {
    id: "hl7-split",
    languages: ["csharp", "typescript"],
    severity: "medium",
    title: "HL7 parsed by splitting on a delimiter",
    pattern: /\.[Ss]plit\s*\(\s*['"]?\|/,
    why: "The delimiters are declared in MSH-1 and MSH-2 and are not guaranteed to be the usual ones. Escape sequences (\\F\\ for a literal bar) are not handled by a split either, so a value containing one silently becomes two fields.",
    fix: "Read the separators from the MSH segment, or use a parser. The HL7 Toolkit here does both.",
  },
  {
    id: "index-without-bounds",
    languages: ["csharp"],
    severity: "medium",
    title: "A segment field indexed without a length check",
    pattern: /\b(?:fields|segments|parts|components)\s*\[\s*\d+\s*\]/i,
    why: "Optional trailing fields are simply absent in a real message — a PID with no SSN is shorter, not padded. Indexing past the end throws, and the message that triggers it is always the one from the new sending system on go-live day.",
    fix: "Check the length, or use a helper that returns empty for a missing index.",
  },
  {
    id: "no-correlation",
    languages: ["csharp"],
    severity: "low",
    title: "An outbound call with no correlation header",
    pattern: /\b(?:_?httpClient|client)\.(?:Get|Post|Put|Delete|Send)Async\s*\(/,
    unless: /(?:traceparent|correlation|x-request-id|RequestId)/i,
    why: "Not necessarily wrong — the header may be added by a handler. But if it is not, a failure in the downstream service cannot be tied to the request that caused it, and that is discovered during an incident rather than before one.",
    fix: "Add the correlation id in a DelegatingHandler so it is on every call by construction rather than by remembering.",
  },
  {
    id: "trust-certificate",
    languages: ["csharp", "typescript"],
    severity: "high",
    title: "Certificate validation disabled",
    pattern: /(?:TrustServerCertificate\s*=\s*true|ServerCertificateCustomValidationCallback\s*=|rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED)/i,
    why: "TLS without validation is encryption without authentication: the connection is private with whoever answered, which may not be the server you meant. It is normally added to get past a local certificate problem and then ships.",
    fix: "Trust the issuing CA on the machine instead. If a self-signed certificate is genuinely required, pin its thumbprint rather than accepting everything.",
  },
  {
    id: "retry-no-jitter",
    languages: ["csharp", "typescript"],
    severity: "low",
    title: "A retry loop with a fixed delay",
    pattern: /(?:for|while)\s*\([^)]*\)[^{]*\{[^}]*(?:Task\.Delay|setTimeout)\s*\(\s*\d{3,}/,
    why: "Every client that failed together retries together, so the service that just fell over is hit by the same spike again.",
    fix: "Add jitter, and prefer a library that already handles it — the Retry Designer here emits the configuration.",
  },
  {
    id: "missing-using",
    languages: ["csharp"],
    severity: "low",
    title: "A disposable created without `using`",
    pattern: /=\s*new\s+(?:SqlConnection|StreamReader|StreamWriter|FileStream|TcpClient|NetworkStream|MemoryStream)\s*\(/,
    unless: /using\s|await\s+using\s|_\w+\s*=|this\./,
    why: "A connection or handle released only when the finalizer happens to run holds a pooled connection meanwhile. Under load the pool empties and every query waits.",
    fix: "`using var x = new …;` so it is released deterministically.",
  },
];

// ---------------------------------------------------------------------------
// Running the rules
// ---------------------------------------------------------------------------

export interface Finding {
  ruleId: string;
  severity: Severity;
  title: string;
  line: number;
  excerpt: string;
  why: string;
  fix: string;
}

/** Is this line a comment? Rules should not fire on commented-out code. */
export function isComment(line: string, language: Language): boolean {
  const trimmed = line.trim();
  if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return true;
  if (language === "sql" && trimmed.startsWith("--")) return true;
  return false;
}

/** Guess the language from what the code looks like. */
export function detectLanguage(code: string): Language {
  if (/\b(?:using System|namespace\s+\w|public\s+class|\bvar\s+\w+\s*=|async\s+Task)/.test(code)) return "csharp";
  if (/\b(?:import\s+.*from|const\s+\w+\s*[:=]|export\s+(?:function|const)|=>\s*\{)/.test(code)) return "typescript";
  if (/^\s*(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER)\b/im.test(code)) return "sql";
  return "any";
}

const SEVERITY_ORDER: Severity[] = ["high", "medium", "low"];

/**
 * Review a block of code.
 *
 * Line by line rather than over the whole text, so every finding has a line
 * number — a review comment without one is an argument rather than a fix.
 */
export function review(code: string, language: Language = detectLanguage(code)): Finding[] {
  const findings: Finding[] = [];
  const lines = code.split(/\r?\n/);

  for (const rule of RULES) {
    if (!rule.languages.includes(language) && !rule.languages.includes("any")) continue;

    lines.forEach((line, index) => {
      if (isComment(line, language)) return;
      if (!rule.pattern.test(line)) return;
      if (rule.unless?.test(line)) return;
      findings.push({
        ruleId: rule.id,
        severity: rule.severity,
        title: rule.title,
        line: index + 1,
        excerpt: line.trim().slice(0, 160),
        why: rule.why,
        fix: rule.fix,
      });
    });
  }

  return findings.sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || a.line - b.line,
  );
}

/** Counts by severity, for a header. */
export function tally(findings: Finding[]): Record<Severity, number> {
  return {
    high: findings.filter((f) => f.severity === "high").length,
    medium: findings.filter((f) => f.severity === "medium").length,
    low: findings.filter((f) => f.severity === "low").length,
  };
}

// ---------------------------------------------------------------------------
// The human half
// ---------------------------------------------------------------------------

export interface ChecklistItem {
  id: string;
  group: string;
  question: string;
  why: string;
}

/**
 * What a pattern cannot see.
 *
 * Deliberately short. A fifty-item checklist gets ticked wholesale; these are
 * the questions where the answer is genuinely not in the diff, and where getting
 * it wrong has cost somebody a weekend.
 */
export const CHECKLIST: ChecklistItem[] = [
  {
    id: "replay",
    group: "Correctness under failure",
    question: "If this runs twice, what happens?",
    why: "At-least-once delivery and retries both mean it will. The answer must be 'the same thing', and if it is not, say what makes it safe — an idempotency key, a unique constraint, a conditional update.",
  },
  {
    id: "partial",
    group: "Correctness under failure",
    question: "If it fails halfway, what is left behind?",
    why: "A message acknowledged before the database commit is a message lost; a commit before the acknowledgement is a message processed twice. Which one this code chose should be deliberate and visible.",
  },
  {
    id: "ordering",
    group: "Correctness under failure",
    question: "Does order matter here, and is it guaranteed?",
    why: "An ADT^A08 update arriving before the A04 that created the patient is normal, not exceptional. Sessions or partition keys guarantee order within a key and nothing more.",
  },
  {
    id: "unknown-code",
    group: "Data",
    question: "What happens to a code that is not in the mapping table?",
    why: "There will be one on go-live day. Passing it through unchanged, dropping the message and dead-lettering it are all defensible; doing it by accident is not.",
  },
  {
    id: "optional-fields",
    group: "Data",
    question: "Which fields are optional in the spec but assumed present here?",
    why: "The sending system that omits them is always a different one from the sending system it was built against.",
  },
  {
    id: "phi-boundary",
    group: "Data",
    question: "Where does patient data cross a boundary — a log, a metric, an error message, a third party?",
    why: "Each crossing is a decision that should have been made on purpose. Exception messages are the one people forget: they carry the payload and go wherever errors go.",
  },
  {
    id: "correlation",
    group: "Operability",
    question: "Given only a correlation id from a support ticket, can this path be traced end to end?",
    why: "If not, the first hour of the next incident is spent adding logging. Queue hops are where the id usually gets dropped.",
  },
  {
    id: "alerting",
    group: "Operability",
    question: "What alerts when this breaks, and does it alert on the symptom or on the cause?",
    why: "Alert on results not filing. CPU and exception counts are diagnostics, not symptoms, and they fire when nothing is wrong.",
  },
  {
    id: "backpressure",
    group: "Operability",
    question: "What happens when the downstream system is slower than the inbound rate?",
    why: "Something has to give: a queue grows, a limit is hit, or memory fills. Choosing which beats discovering it.",
  },
  {
    id: "rollback",
    group: "Release",
    question: "Can this be rolled back with messages already in flight?",
    why: "A schema or contract change usually cannot be, which makes it a two-step release. That is a fact to know before deployment, not during it.",
  },
];

// ---------------------------------------------------------------------------
// The AI half
// ---------------------------------------------------------------------------

/**
 * The system prompt for the AI pass.
 *
 * Narrow on purpose. A general "review this code" produces naming and formatting
 * opinions that the reader already has, and buries the one paragraph that
 * matters. The prompt also says not to repeat what the pattern rules already
 * found, because a review that lists the same thing twice gets skimmed.
 */
export const AI_SYSTEM_PROMPT = [
  "You are reviewing code for a healthcare integration: HL7 v2, FHIR, X12 claims, queues, and the services between them.",
  "",
  "Report only issues that would cause a real incident: data loss, duplicate processing, a patient identifier leaving the system, a failure that is invisible when it happens, or a resource that runs out under load.",
  "",
  "Do not comment on naming, formatting, file layout, or anything a compiler or linter already reports. Do not restate what the code does.",
  "",
  "For each issue give: the line, one sentence on what goes wrong, and the concrete change. If the code is fine, say so in one line rather than finding something to say.",
].join("\n");

export function buildAiPrompt(code: string, language: Language, alreadyFound: Finding[]): string {
  const known = alreadyFound.length > 0 ? `\n\nStatic rules already reported these — do not repeat them: ${[...new Set(alreadyFound.map((f) => f.title))].join("; ")}.` : "";
  return `Language: ${language}.${known}\n\n\`\`\`\n${code}\n\`\`\``;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/** The findings as review comments, ready to paste into a pull request. */
export function toComments(findings: Finding[], file = "file"): string {
  if (findings.length === 0) return "No findings from the pattern rules.";
  return findings
    .map((finding) => {
      const emoji = finding.severity === "high" ? "🔴" : finding.severity === "medium" ? "🟠" : "🔵";
      return [`${emoji} **${file}:${finding.line} — ${finding.title}**`, "", finding.why, "", `**Instead:** ${finding.fix}`, "", `\`${finding.excerpt}\``].join("\n");
    })
    .join("\n\n---\n\n");
}
