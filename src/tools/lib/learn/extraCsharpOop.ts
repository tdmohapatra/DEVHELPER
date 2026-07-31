import type { Question } from "./types";

/** Second batch: C# and OOP questions that come up once the basics are covered. */
export const CSHARP_EXTRA: Question[] = [
  {
    id: "cs2-const-readonly",
    topic: "csharp",
    subtopic: "Language",
    level: "basic",
    question: "`const` vs `readonly` vs `static readonly` vs `init`?",
    answer: `- **\`const\`** — compile-time constant, implicitly static, and **inlined into the calling assembly**. Changing it means recompiling every consumer, which is why public constants in libraries are a versioning trap.
- **\`readonly\`** — assigned in the declaration or the constructor; per instance.
- **\`static readonly\`** — one value, computed at runtime, safe to change without recompiling callers.
- **\`init\`** — settable only during object initialisation, so an object can be built fluently and then stay immutable.

\`readonly\` on a reference type freezes the *reference*, not the object: a \`readonly List<T>\` can still be added to.`,
    language: "csharp",
    code: `public const int MaxRetries = 3;                 // baked into callers
public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(30);  // runtime value

public class Config
{
    private readonly List<string> _hosts = new();
    public Config() => _hosts.Add("a");           // allowed: mutating the object
    // _hosts = new List<string>();               // not allowed: reassigning the field

    public string Name { get; init; } = "";       // set only in an initialiser
}`,
    followUps: [
      {
        question: "Why can a `const` only be a primitive, string or null?",
        answer: "Its value must be embeddable in IL metadata at compile time. Anything requiring construction has to be `static readonly`.",
      },
    ],
    tags: ["const", "readonly", "init", "immutability"],
  },
  {
    id: "cs2-span-memory",
    topic: "csharp",
    subtopic: "Performance",
    level: "advanced",
    question: "What are `Span<T>` and `Memory<T>` for?",
    answer: `\`Span<T>\` is a view over contiguous memory — an array, a stack buffer, or unmanaged memory — that lets you slice **without allocating or copying**.

It is a \`ref struct\`: stack-only, so it cannot be a field of a class, boxed, captured in a lambda, or used across an \`await\`. \`Memory<T>\` is the heap-friendly version for exactly those cases, with \`.Span\` to get a span when you need one.

Typical wins: parsing (slice instead of \`Substring\`), buffer handling, and avoiding intermediate arrays in hot paths.`,
    language: "csharp",
    code: `// Allocates two strings per call
static int ParseYearSlow(string date) => int.Parse(date.Substring(0, 4));

// No allocation at all
static int ParseYear(ReadOnlySpan<char> date) => int.Parse(date[..4]);

// Stack buffer for a small, short-lived array
Span<byte> buffer = stackalloc byte[64];

// Async needs Memory<T>, because a Span cannot cross an await
async Task ReadAsync(Stream s, Memory<byte> destination) => await s.ReadAsync(destination);`,
    followUps: [
      {
        question: "When is `Span<T>` not worth it?",
        answer: "In code that is not hot. It complicates signatures and cannot be used in async methods or LINQ. Measure first — most allocations are irrelevant.",
      },
    ],
    tags: ["span", "memory", "allocation", "performance", "ref struct"],
  },
  {
    id: "cs2-linq-deferred-pitfalls",
    topic: "csharp",
    subtopic: "LINQ",
    level: "intermediate",
    mustKnow: true,
    question: "What are the classic LINQ mistakes?",
    answer: `1. **Multiple enumeration** — iterating the same \`IEnumerable\` twice runs the query twice (two database round trips, or two file reads). Materialise once with \`ToList()\`.
2. **Closure capture in a loop** — capturing a loop variable in a deferred query. \`foreach\` is safe since C# 5; a \`for\` loop variable is not.
3. **\`Count() > 0\`** instead of \`Any()\` — counts everything to answer a yes/no.
4. **\`First()\` when empty is expected** — throws; use \`FirstOrDefault\`.
5. **\`Where(...).Count()\`** when the source is a database — fine for EF (translated), wasteful in memory if you already have the list and only need existence.
6. **Sorting before filtering** — order the smaller set.`,
    language: "csharp",
    code: `// Two round trips: the query runs on each enumeration
var query = db.Orders.Where(o => o.IsOpen);
var count = query.Count();
foreach (var o in query) { }        // executes again

// One
var open = await db.Orders.Where(o => o.IsOpen).ToListAsync();

// Deferred + captured variable: all closures see the final value of i
var actions = new List<Func<int>>();
for (int i = 0; i < 3; i++) actions.Add(() => i);    // 3, 3, 3
for (int i = 0; i < 3; i++) { int copy = i; actions.Add(() => copy); }  // 0, 1, 2`,
    followUps: [
      {
        question: "How do you spot multiple enumeration in review?",
        answer: "A method parameter typed `IEnumerable<T>` used more than once. Either take `IReadOnlyCollection<T>`, or materialise at the top of the method.",
      },
    ],
    tags: ["linq", "deferred execution", "closures", "any", "performance"],
  },
  {
    id: "cs2-yield",
    topic: "csharp",
    subtopic: "Language",
    level: "intermediate",
    question: "What does `yield return` do?",
    answer: `It makes the compiler generate a state machine implementing \`IEnumerable<T>\`, producing values **lazily** — nothing runs until the caller iterates, and only as far as it iterates.

Benefits: constant memory over huge or infinite sequences, and early exit costs nothing.

Traps: the method body does not execute at call time, so argument validation inside an iterator is deferred until the first \`MoveNext\` — split validation into a wrapper method. Also, you cannot \`yield return\` inside a \`try\` with a \`catch\`.`,
    language: "csharp",
    code: `// Validation runs only when enumeration starts — usually a surprise
public IEnumerable<string> ReadLines(string path)
{
    if (path is null) throw new ArgumentNullException(nameof(path));   // deferred!
    foreach (var line in File.ReadLines(path)) yield return line;
}

// Fix: validate eagerly, iterate lazily
public IEnumerable<string> ReadLinesSafe(string path)
{
    ArgumentNullException.ThrowIfNull(path);
    return Iterate(path);

    static IEnumerable<string> Iterate(string p)
    {
        foreach (var line in File.ReadLines(p)) yield return line;
    }
}`,
    followUps: [
      {
        question: "What is `IAsyncEnumerable<T>`?",
        answer: "The async equivalent — `await foreach` over items that arrive over time (paged API results, a stream). Combine with `yield return` in an `async IAsyncEnumerable<T>` method.",
      },
    ],
    tags: ["yield", "iterator", "lazy", "iasyncenumerable"],
  },
  {
    id: "cs2-cancellation",
    topic: "csharp",
    subtopic: "Async",
    level: "intermediate",
    mustKnow: true,
    question: "How should `CancellationToken` be used properly?",
    answer: `Accept a token in every async public method and **pass it down** to everything you await. A token that is accepted and ignored is worse than none — callers believe cancellation works.

- Check \`ThrowIfCancellationRequested()\` in long CPU loops.
- \`OperationCanceledException\` is expected on cancel; do not log it as an error.
- Combine tokens with \`CreateLinkedTokenSource\` when you need "caller cancelled **or** timeout".
- In ASP.NET Core, \`HttpContext.RequestAborted\` cancels when the client disconnects — plumb it through and stop doing work nobody will receive.`,
    language: "csharp",
    code: `public async Task<Report> BuildAsync(int id, CancellationToken ct)
{
    using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
    timeout.CancelAfter(TimeSpan.FromSeconds(10));       // caller cancel OR 10s

    var rows = await _db.Rows.Where(r => r.Id == id).ToListAsync(timeout.Token);

    foreach (var row in rows)
    {
        timeout.Token.ThrowIfCancellationRequested();     // cooperative, in a CPU loop
        Process(row);
    }
    return new Report(rows);
}`,
    followUps: [
      {
        question: "Can you cancel a task that ignores the token?",
        answer: "No. Cancellation is cooperative — nothing forcibly aborts a thread. `Thread.Abort` is gone from .NET Core for exactly that reason.",
      },
    ],
    tags: ["cancellation", "async", "timeout", "requestaborted"],
  },
  {
    id: "cs2-static-constructor",
    topic: "csharp",
    subtopic: "Types",
    level: "intermediate",
    question: "When does a static constructor run, and why is it risky?",
    answer: `A static constructor runs **once**, lazily, immediately before the first instance is created or any static member is accessed. The runtime guarantees thread safety for that initialisation.

Risks:

- **Ordering is implicit** — you cannot control when it fires, which makes debugging initialisation-dependent bugs hard.
- **An exception inside it** becomes a \`TypeInitializationException\` and the type is **permanently unusable** for the process lifetime. Every later use fails with the same error, far from the real cause.
- It can deadlock if it blocks on something that also touches the type.

Prefer explicit initialisation through DI, or \`Lazy<T>\` where laziness is genuinely wanted.`,
    language: "csharp",
    code: `public class Settings
{
    private static readonly Settings _instance;

    static Settings()
    {
        // If this throws, the whole type is dead for the process
        _instance = Load(File.ReadAllText("settings.json"));
    }
}

// Safer: explicit, injectable, and failures surface where they happen
public class SettingsProvider(IConfiguration config)
{
    private readonly Lazy<Settings> _settings = new(() => config.Get<Settings>()!);
    public Settings Current => _settings.Value;
}`,
    followUps: [
      {
        question: "Is `Lazy<T>` thread-safe?",
        answer: "By default yes — `ExecutionAndPublication` mode ensures the factory runs once. Other modes trade that for speed and can run the factory more than once.",
      },
    ],
    tags: ["static constructor", "type initializer", "lazy", "initialisation"],
  },
  {
    id: "cs2-struct-equality-perf",
    topic: "csharp",
    subtopic: "Performance",
    level: "advanced",
    question: "Why is the default `struct` equality slow, and how do you fix it?",
    answer: `\`ValueType.Equals\` falls back to **reflection** over the fields when the struct contains any reference type or has padding — comparing field by field at runtime. \`GetHashCode\` has the same problem and, worse, historically hashed only the first field, so structs with the same first field collide.

Fix by implementing \`IEquatable<T>\` explicitly and overriding \`GetHashCode\`, or by declaring a \`record struct\`, which generates both correctly.

This matters most when structs are dictionary keys or compared in loops.`,
    language: "csharp",
    code: `// Slow: reflection-based comparison, poor hash distribution
public struct PointSlow { public int X; public string Label; }

// Fast: no boxing, no reflection
public readonly struct Point : IEquatable<Point>
{
    public int X { get; init; }
    public int Y { get; init; }

    public bool Equals(Point other) => X == other.X && Y == other.Y;
    public override bool Equals(object? obj) => obj is Point p && Equals(p);
    public override int GetHashCode() => HashCode.Combine(X, Y);
}

// Or simply
public readonly record struct Point2(int X, int Y);`,
    followUps: [
      {
        question: "Why `readonly struct`?",
        answer: "It tells the compiler no method can mutate the instance, so defensive copies when calling members through a `readonly` field or `in` parameter are unnecessary. Non-readonly structs silently copy in those cases.",
      },
    ],
    tags: ["struct", "equality", "performance", "record struct", "boxing"],
  },
  {
    id: "cs2-pattern-matching",
    topic: "csharp",
    subtopic: "Language",
    level: "intermediate",
    question: "What can modern pattern matching do?",
    answer: `Pattern matching replaced most \`if\`/cast chains:

- **Type pattern** — \`if (o is Order order)\`
- **Property pattern** — \`{ Status: OrderStatus.Paid, Total: > 100 }\`
- **Relational and logical** — \`> 100 and < 500\`, \`not null\`
- **Positional** on records/tuples — \`(0, 0)\`
- **List pattern** (C# 11) — \`[first, .., last]\`
- **switch expression** — an expression, so it must produce a value and the compiler warns on missing cases.`,
    language: "csharp",
    code: `decimal Fee(Payment p) => p switch
{
    { Method: "upi" }                          => 0m,
    { Method: "card", Amount: > 10_000 }       => p.Amount * 0.015m,
    { Method: "card" }                         => p.Amount * 0.025m,
    { Amount: <= 0 }                           => throw new ArgumentException("Amount must be positive"),
    _                                          => p.Amount * 0.03m
};

string Describe(object o) => o switch
{
    null                       => "nothing",
    int n and > 0              => $"positive {n}",
    string { Length: 0 }       => "empty string",
    int[] [var only]           => $"single element {only}",
    _                          => o.GetType().Name
};`,
    followUps: [
      {
        question: "When is a switch expression worse than a polymorphic dispatch?",
        answer: "When the set of cases grows with new features — that is the Open/Closed violation. A switch over a closed, stable set (an enum of statuses) is fine and clearer.",
      },
    ],
    tags: ["pattern matching", "switch expression", "c# 8", "list pattern"],
  },
  {
    id: "cs2-task-whenall-exceptions",
    topic: "csharp",
    subtopic: "Async",
    level: "advanced",
    question: "How do exceptions behave with `Task.WhenAll` and `Task.WhenAny`?",
    answer: `\`await Task.WhenAll(...)\` rethrows **only the first** exception, even if several tasks failed. The rest are still on the returned task's \`AggregateException\` — inspect \`task.Exception\` if you need them all.

\`Task.WhenAny\` completes when the first task finishes, successfully or not. The other tasks keep running: if you abandon them, their exceptions become **unobserved**, and any resources they hold leak. Cancel them, or await them and swallow deliberately.

\`Task.WhenAll\` also waits for *all* tasks even after one fails — it does not short-circuit.`,
    language: "csharp",
    code: `var tasks = new[] { CallAsync("a"), CallAsync("b"), CallAsync("c") };
var all = Task.WhenAll(tasks);

try
{
    await all;                       // throws the first exception only
}
catch (Exception)
{
    // Every failure, not just the first
    foreach (var ex in all.Exception!.InnerExceptions) _log.LogError(ex, "Call failed");
}

// WhenAny with a timeout: cancel the loser so it does not run on unobserved
using var cts = new CancellationTokenSource();
var work = DoWorkAsync(cts.Token);
var completed = await Task.WhenAny(work, Task.Delay(5000, cts.Token));
cts.Cancel();
if (completed != work) throw new TimeoutException();`,
    followUps: [
      {
        question: "What happens to an unobserved task exception?",
        answer: "Since .NET 4.5 it no longer crashes the process, but it is silently swallowed — the failure disappears. Subscribe to `TaskScheduler.UnobservedTaskException` to detect them.",
      },
    ],
    tags: ["task", "whenall", "whenany", "exceptions", "async"],
  },
  {
    id: "cs2-equals-operator-overload",
    topic: "csharp",
    subtopic: "Types",
    level: "intermediate",
    question: "What is the difference between `is`, `as`, and a cast?",
    answer: `- **Cast \`(T)x\`** — throws \`InvalidCastException\` on failure. Use when failure is a bug.
- **\`as\`** — returns \`null\` on failure; reference and nullable types only. Requires a null check afterwards.
- **\`is\` with a pattern** — tests and assigns in one step, which is the modern idiom and avoids the double-check.

The old \`if (x is Foo) { var f = (Foo)x; }\` performs the type check twice; \`if (x is Foo f)\` does it once.`,
    language: "csharp",
    code: `object value = GetValue();

var forced = (Order)value;               // throws if wrong
var maybe  = value as Order;             // null if wrong
if (maybe is not null) { }

if (value is Order order && order.Total > 0)   // check + bind, once
{
    Process(order);
}`,
    tags: ["is", "as", "cast", "pattern matching"],
  },
  {
    id: "cs2-di-scope-async",
    topic: "csharp",
    subtopic: "Concurrency",
    level: "advanced",
    question: "What is `AsyncLocal<T>` and when would you use it?",
    answer: `\`AsyncLocal<T>\` stores a value that flows with the **logical** async call chain, surviving \`await\` and thread switches — unlike \`ThreadStatic\`, which breaks the moment a continuation resumes on another thread.

Uses: correlation ids, ambient user context, and how \`Activity.Current\` works for distributed tracing.

Caveats: writes made in a child do not flow back to the parent (it copies on write down the chain), and abusing it recreates a hidden global — hard to test, easy to leak between requests if you forget it is per logical flow, not per request.`,
    language: "csharp",
    code: `private static readonly AsyncLocal<string?> _correlationId = new();

public static string? CorrelationId
{
    get => _correlationId.Value;
    set => _correlationId.Value = value;
}

// Set once in middleware; every downstream await sees it
app.Use(async (ctx, next) =>
{
    CorrelationId = ctx.Request.Headers["x-correlation-id"].FirstOrDefault() ?? Guid.NewGuid().ToString();
    await next();
});`,
    followUps: [
      {
        question: "Why not just pass the value as a parameter?",
        answer: "You should, where the call chain is yours. `AsyncLocal` is for cross-cutting context that would otherwise pollute every signature in the codebase.",
      },
    ],
    tags: ["asynclocal", "context", "correlation", "threadstatic"],
  },
  {
    id: "cs2-httpclient",
    topic: "csharp",
    subtopic: "Networking",
    level: "intermediate",
    mustKnow: true,
    question: "What is the correct way to use `HttpClient`?",
    answer: `Neither "new one per request" nor "one static forever":

- **Per request + dispose** — each disposal leaves a socket in TIME_WAIT for minutes. Under load the machine runs out of ports.
- **One static instance forever** — sockets are reused, but the handler caches DNS, so a failover or IP change is never noticed.

The answer is \`IHttpClientFactory\`: it pools handlers and rotates them on a schedule (two minutes by default), giving reuse *and* DNS refresh. Typed clients also give a natural home for base address, default headers and Polly policies.`,
    language: "csharp",
    code: `builder.Services.AddHttpClient<PricingClient>(c =>
{
    c.BaseAddress = new Uri("https://pricing.internal/");
    c.Timeout = TimeSpan.FromSeconds(10);
})
.AddStandardResilienceHandler();

public class PricingClient(HttpClient http)      // injected, do not dispose
{
    public async Task<Price> GetAsync(string sku, CancellationToken ct) =>
        await http.GetFromJsonAsync<Price>($"prices/{sku}", ct) ?? throw new InvalidOperationException();
}`,
    followUps: [
      {
        question: "Why does `HttpClient` ignore `Timeout` per request?",
        answer: "`Timeout` applies to the whole client. For per-request control, pass a `CancellationToken` from a `CancellationTokenSource` with its own deadline.",
      },
    ],
    tags: ["httpclient", "socket exhaustion", "ihttpclientfactory", "dns"],
  },
];

export const OOP_EXTRA: Question[] = [
  {
    id: "oop2-law-of-demeter",
    topic: "oop",
    subtopic: "Design",
    level: "intermediate",
    question: "What is the Law of Demeter and why does it matter?",
    answer: `"Talk to your friends, not to strangers." A method should call methods on itself, its parameters, objects it creates, and its own fields — not reach through a chain of objects.

\`order.Customer.Address.City.Name\` couples the caller to four types. Any of them changing breaks it, and it cannot be tested without building the whole graph.

The counter-argument worth knowing: it applies to *behaviour*, not to data structures or fluent builders. \`query.Where(...).OrderBy(...).ToList()\` is not a violation.`,
    language: "csharp",
    code: `// Reaches through three objects
if (order.Customer.Address.Country == "IN") ApplyGst(order);

// The object answers the question itself
if (order.IsDomestic) ApplyGst(order);

public bool IsDomestic => Customer.IsInCountry("IN");   // knowledge stays where the data is`,
    tags: ["law of demeter", "coupling", "tell don't ask"],
  },
  {
    id: "oop2-value-entity",
    topic: "oop",
    subtopic: "Modelling",
    level: "advanced",
    question: "What is the difference between an entity and a value object?",
    answer: `- **Entity** — has identity that persists through change. Two orders with identical contents are still different orders. Equality is by **id**.
- **Value object** — defined entirely by its values, immutable, interchangeable. Two \`Money(100, "INR")\` are the same thing. Equality is by **all fields**.

Value objects are where invariants live cheaply: a \`Money\` type that refuses to add different currencies removes a whole class of bug that \`decimal\` cannot.

In C#: entity as a class with an Id, value object as a \`record\` or \`readonly record struct\`.`,
    language: "csharp",
    code: `public record Money(decimal Amount, string Currency)
{
    public static Money operator +(Money a, Money b) =>
        a.Currency == b.Currency
            ? a with { Amount = a.Amount + b.Amount }
            : throw new InvalidOperationException("Cannot add different currencies");
}

public class Order                       // entity: identity survives change
{
    public OrderId Id { get; }
    public Money Total { get; private set; }
    public override bool Equals(object? o) => o is Order other && Id == other.Id;
}`,
    followUps: [
      {
        question: "How do you persist a value object with EF Core?",
        answer: "As an owned type (`OwnsOne`) so it maps to columns on the owner's table, or a converter for single-value wrappers. It has no table or key of its own.",
      },
    ],
    tags: ["ddd", "entity", "value object", "invariants", "record"],
  },
  {
    id: "oop2-template-strategy",
    topic: "oop",
    subtopic: "Patterns",
    level: "intermediate",
    question: "Template Method vs Strategy — they look similar.",
    answer: `Both vary part of an algorithm.

- **Template Method** — an abstract base defines the skeleton and calls abstract steps that subclasses fill in. Variation is fixed at **compile time** by inheritance.
- **Strategy** — the varying part is an injected object. Variation is chosen at **runtime** and can be swapped, composed and tested alone.

Prefer Strategy: it composes, avoids the fragile base class, and is trivial to fake in tests. Template Method is reasonable when the steps are genuinely meaningless outside the base and there is no runtime choice.`,
    language: "csharp",
    code: `// Template Method: subclass supplies the step
public abstract class Importer
{
    public void Run(Stream s) { Validate(s); var rows = Parse(s); Save(rows); }
    protected abstract IEnumerable<Row> Parse(Stream s);
}

// Strategy: the parser is chosen at runtime
public class Importer2(IParser parser)
{
    public void Run(Stream s) { Validate(s); Save(parser.Parse(s)); }
}
var importer = new Importer2(fileName.EndsWith(".csv") ? new CsvParser() : new XmlParser());`,
    tags: ["template method", "strategy", "patterns", "inheritance"],
  },
  {
    id: "oop2-cqs",
    topic: "oop",
    subtopic: "Design",
    level: "intermediate",
    question: "What is Command-Query Separation?",
    answer: `A method should either **do** something (command, changes state, returns void) or **answer** something (query, returns data, no side effects) — never both.

Why it matters: a query with a hidden side effect makes code unsafe to call twice, unsafe to remove, and unsafe to reorder. Debuggers evaluating a property can even trigger it.

Practical exceptions are accepted — \`stack.Pop()\`, \`TryGetValue\`, and anything that must be atomic — but they should be obvious from the name.`,
    language: "csharp",
    code: `// Violation: looks like a query, silently mutates
public Order GetOrCreateOrder(int customerId)
{
    var order = _db.Orders.FirstOrDefault(o => o.CustomerId == customerId);
    if (order is null) { order = new Order(customerId); _db.Add(order); _db.SaveChanges(); }
    return order;
}

// Separated: the caller decides
public Order? FindOpenOrder(int customerId) => ...;      // query
public Order CreateOrder(int customerId) => ...;         // command`,
    tags: ["cqs", "side effects", "design", "purity"],
  },
  {
    id: "oop2-inversion-of-control",
    topic: "oop",
    subtopic: "Design",
    level: "intermediate",
    question: "Is inversion of control the same as dependency injection?",
    answer: `No — DI is one form of IoC.

**Inversion of control** is the general idea that the framework calls your code rather than your code driving the flow: event handlers, middleware, template methods, and the ASP.NET Core request pipeline are all IoC.

**Dependency injection** specifically inverts *who supplies dependencies*: the class declares what it needs and something else provides it.

A **DI container** is just a tool that automates the wiring. You can do DI with plain \`new\` in a composition root and still get every testing benefit.`,
    tags: ["ioc", "di", "container", "composition root"],
  },
  {
    id: "oop2-inheritance-abstract-sealed",
    topic: "oop",
    subtopic: "Types",
    level: "intermediate",
    question: "Why would you mark a class `sealed`?",
    answer: `- **Design intent** — the class was not built for extension. Inheriting from something with no virtual members and no documented extension points usually breaks later.
- **Correctness** — a sealed class cannot have its behaviour subverted by an override, which matters for security-sensitive or invariant-heavy types.
- **Performance** — the JIT can devirtualise calls on a sealed type, and interface dispatch gets cheaper. Small but free.

The counterweight: sealing a public library type prevents legitimate extension you did not anticipate. Seal by default internally, be more conservative in a public API.`,
    tags: ["sealed", "inheritance", "design", "performance"],
  },
  {
    id: "oop2-god-object",
    topic: "oop",
    subtopic: "Smells",
    level: "basic",
    question: "Which code smells do you look for, and what do they indicate?",
    answer: `- **God object / large class** — does everything, changes for every reason. Split by responsibility.
- **Long method** — more than one level of abstraction; extract until each level reads as a summary.
- **Long parameter list** — the parameters usually form a concept; introduce a type.
- **Feature envy** — a method that mostly uses another object's data; move it there.
- **Primitive obsession** — \`string customerId\`, \`decimal amount\` everywhere; wrap in value objects and the compiler starts catching bugs.
- **Shotgun surgery** — one change touches ten files; the concept is scattered.
- **Divergent change** — one file changes for ten reasons; the opposite problem.

A smell is a prompt to look, not a rule violation. Sometimes the smelly version is genuinely the simplest thing.`,
    tags: ["code smells", "refactoring", "primitive obsession"],
  },
  {
    id: "oop2-solid-vs-yagni",
    topic: "oop",
    subtopic: "Design",
    level: "advanced",
    question: "How do you decide when to introduce an abstraction?",
    answer: `Cost/benefit, not principle:

- **Rule of three** — duplicate once, notice; duplicate twice, extract. Premature abstraction locks in the wrong shape.
- **Is variation real?** An interface with one implementation, created "in case we swap it", usually never gets a second — and makes navigation harder.
- **Is there a test seam problem?** That is a legitimate reason on its own: abstract the database, the clock, the network.
- **Does it hide a boundary?** Abstractions at module edges age well; abstractions inside a class usually do not.

Say YAGNI and the rule of three out loud — interviewers are often probing whether you over-engineer.`,
    tags: ["yagni", "abstraction", "rule of three", "over-engineering"],
  },
];
