import type { Question } from "./types";

/** C# language questions: the ones that actually get asked, with the follow-ups. */
export const CSHARP_QUESTIONS: Question[] = [
  {
    id: "cs-value-reference",
    topic: "csharp",
    subtopic: "Memory",
    level: "basic",
    mustKnow: true,
    question: "What is the difference between a value type and a reference type?",
    answer: `A **value type** holds its data directly; a **reference type** holds a pointer to data on the heap.

- Value types: \`int\`, \`double\`, \`bool\`, \`char\`, \`decimal\`, \`enum\`, \`struct\`, \`DateTime\`, tuples.
- Reference types: \`class\`, \`interface\`, \`delegate\`, \`string\`, arrays, records (unless \`record struct\`).

Assignment copies the **value** for the first and the **reference** for the second, so mutating through one variable is visible through the other only for reference types.

Storage location is an implementation detail, not the definition: a value type that is a field of a class lives on the heap inside that object, and a captured local can be hoisted into a compiler-generated class.`,
    language: "csharp",
    code: `struct PointStruct { public int X; }
class PointClass { public int X; }

var s1 = new PointStruct { X = 1 };
var s2 = s1;          // copies the value
s2.X = 99;            // s1.X is still 1

var c1 = new PointClass { X = 1 };
var c2 = c1;          // copies the reference
c2.X = 99;            // c1.X is now 99 — same object`,
    diagram: `Stack                    Heap
+-----------+
| s1  X=1   |            (value lives in the slot)
| s2  X=99  |
+-----------+
| c1  ptr --+--------> +-------------+
| c2  ptr --+--------> |  X = 99     |  (one object)
+-----------+          +-------------+`,
    followUps: [
      {
        question: "Is `string` a value type? It behaves like one.",
        answer:
          "No — `string` is a reference type. It feels like a value type because it is immutable and `==` is overloaded to compare contents, so you can never observe a shared mutation.",
      },
      {
        question: "When would you write a struct instead of a class?",
        answer:
          "Small (roughly ≤16 bytes), immutable, short-lived, value-semantic data used in large quantities — coordinates, currency, identifiers. Copying cost is the trade: a large struct passed around repeatedly is slower than a class.",
      },
      {
        question: "What is boxing and why does it cost?",
        answer:
          "Boxing wraps a value type in a heap object so it can be treated as `object`/an interface. It allocates, adds GC pressure, and unboxing needs a type check. Generics exist largely to avoid it.",
      },
    ],
    tags: ["value type", "reference type", "stack", "heap", "boxing"],
  },
  {
    id: "cs-ref-out-in",
    topic: "csharp",
    subtopic: "Language",
    level: "basic",
    question: "Explain `ref`, `out` and `in` parameters.",
    answer: `All three pass by reference; they differ in who must assign.

- **\`ref\`** — must be initialised by the caller; the method may read and write it.
- **\`out\`** — need not be initialised by the caller; the method **must** assign before returning.
- **\`in\`** — passed by reference but read-only, used to avoid copying a large struct.

\`out\` is the classic \`TryParse\` shape; \`in\` is a performance tool, not a design one.`,
    language: "csharp",
    code: `void Increment(ref int n) => n++;          // caller must initialise
bool TryGet(string key, out string value)  // method must assign
{
    value = "found";
    return true;
}
double Distance(in LargeStruct p) => p.X;  // no copy, cannot assign

int x = 5;
Increment(ref x);                 // x == 6
TryGet("k", out var found);       // inline declaration`,
    followUps: [
      {
        question: "Does passing a reference type without `ref` let the method replace the object?",
        answer:
          "No. It can mutate the object's state, but reassigning the parameter only changes the local copy of the reference. `ref` is what makes the reassignment visible to the caller.",
      },
    ],
    tags: ["ref", "out", "in", "parameters"],
  },
  {
    id: "cs-async-await",
    topic: "csharp",
    subtopic: "Async",
    level: "intermediate",
    mustKnow: true,
    question: "How does `async`/`await` actually work?",
    answer: `The compiler rewrites an \`async\` method into a **state machine**. At each \`await\`:

1. The awaited operation is started.
2. If it has already completed, execution continues synchronously.
3. Otherwise the method **returns to its caller**, and the remainder is registered as a continuation.
4. When the operation completes, the continuation resumes — on the captured \`SynchronizationContext\` unless \`ConfigureAwait(false)\` was used.

Key point for interviews: \`await\` does **not** create a thread. For I/O there is no thread waiting at all — the completion is driven by an I/O completion port. \`async\` improves *scalability* (threads freed for other requests), not the speed of any single call.`,
    language: "csharp",
    code: `// Sequential: ~2 s total
var a = await GetAsync("a");
var b = await GetAsync("b");

// Concurrent: ~1 s total
var ta = GetAsync("a");
var tb = GetAsync("b");
await Task.WhenAll(ta, tb);
var (ra, rb) = (ta.Result, tb.Result);   // safe: already completed

// Library code: do not capture the context
var data = await httpClient.GetStringAsync(url).ConfigureAwait(false);`,
    diagram: `await on an I/O call — no thread is blocked

Request thread ──┐                       ┌── continuation (pool thread)
                 │  await ReadAsync()    │
                 └──> returns to pool    │
                          ...            │
                 OS completes I/O ───────┘`,
    followUps: [
      {
        question: "Why is `async void` dangerous?",
        answer:
          "It cannot be awaited, so exceptions are raised on the synchronization context and usually crash the process instead of surfacing to the caller. Only acceptable for event handlers.",
      },
      {
        question: "What causes a deadlock with `.Result` or `.Wait()`?",
        answer:
          "On a context that allows one thread at a time (classic ASP.NET, WinForms/WPF), blocking holds that context while the continuation waits to resume on it. Both wait forever. ASP.NET Core has no such context, so it deadlocks less — but blocking still starves the thread pool.",
      },
      {
        question: "`Task` vs `ValueTask`?",
        answer:
          "`ValueTask` avoids an allocation when the result is usually already available (a cache hit). It must be awaited exactly once and never blocked on. Default to `Task` unless profiling shows the allocation matters.",
      },
    ],
    tags: ["async", "await", "task", "threads", "ConfigureAwait"],
  },
  {
    id: "cs-ienumerable-iqueryable",
    topic: "csharp",
    subtopic: "LINQ",
    level: "intermediate",
    mustKnow: true,
    question: "`IEnumerable<T>` vs `IQueryable<T>` — when does it matter?",
    answer: `- **\`IEnumerable<T>\`** — LINQ to Objects. Filtering happens **in memory**, in your process, using delegates.
- **\`IQueryable<T>\`** — holds an **expression tree** that a provider (EF Core) translates into SQL, so filtering happens **in the database**.

The bug this question is really about: assigning a query to \`IEnumerable<T>\` too early forces the rest of the pipeline to run client-side, pulling the whole table over the wire.`,
    language: "csharp",
    code: `// Translated to: SELECT ... WHERE IsActive = 1 AND City = 'Pune'
IQueryable<User> q = db.Users.Where(u => u.IsActive);
var users = q.Where(u => u.City == "Pune").ToList();

// SELECT * FROM Users WHERE IsActive = 1  → then filters in memory
IEnumerable<User> e = db.Users.Where(u => u.IsActive);
var slow = e.Where(u => u.City == "Pune").ToList();`,
    followUps: [
      {
        question: "What happens when a query contains a method EF cannot translate?",
        answer:
          "EF Core 3.0+ throws instead of silently switching to client evaluation. The fix is to materialise deliberately with `AsEnumerable()` before the untranslatable part.",
      },
      {
        question: "What is deferred execution?",
        answer:
          "The query runs when it is enumerated — `ToList()`, `foreach`, `Count()`, `First()` — not when it is written. Enumerating twice executes twice, which is a common source of duplicated database round trips.",
      },
    ],
    tags: ["linq", "iqueryable", "ef core", "deferred execution"],
  },
  {
    id: "cs-dispose-finalize",
    topic: "csharp",
    subtopic: "Memory",
    level: "intermediate",
    question: "`IDisposable`, `using`, and finalizers — how do they relate?",
    answer: `The GC reclaims **managed memory** only. Anything else — file handles, sockets, database connections, unmanaged buffers — must be released explicitly.

- **\`IDisposable.Dispose()\`** — deterministic cleanup, called by \`using\`.
- **Finalizer (\`~Type()\`)** — a safety net run by the GC at an unpredictable time. It costs: finalizable objects survive an extra GC generation.
- The **dispose pattern** combines both: \`Dispose()\` frees and calls \`GC.SuppressFinalize(this)\` so the finalizer is skipped.

Modern guidance: implement a finalizer only if you own a raw unmanaged resource. Prefer \`SafeHandle\`, which handles it for you.`,
    language: "csharp",
    code: `public sealed class Connection : IDisposable
{
    private bool _disposed;
    private readonly SafeFileHandle _handle;

    public void Dispose()
    {
        if (_disposed) return;
        _handle.Dispose();       // release the unmanaged resource
        _disposed = true;
        GC.SuppressFinalize(this);
    }
}

// Deterministic: disposed at the closing brace, even on an exception
using var conn = new Connection();

// Async variant for resources with asynchronous teardown
await using var stream = new FileStream(path, FileMode.Open);`,
    followUps: [
      {
        question: "Does `Dispose()` free memory?",
        answer:
          "No. It releases resources the GC does not manage. The object's memory is reclaimed later by the GC like any other object.",
      },
      {
        question: "Why is `HttpClient` the classic disposal mistake?",
        answer:
          "Disposing it per request exhausts sockets in TIME_WAIT; keeping one static instance forever misses DNS changes. Use `IHttpClientFactory`, which pools and rotates handlers.",
      },
    ],
    tags: ["idisposable", "using", "finalizer", "gc", "safehandle"],
  },
  {
    id: "cs-gc-generations",
    topic: "csharp",
    subtopic: "Memory",
    level: "advanced",
    question: "How does the .NET garbage collector work?",
    answer: `Generational, mark-and-sweep, with compaction.

- **Gen 0** — new small objects. Collected often and cheaply; most objects die here.
- **Gen 1** — survivors of Gen 0; a buffer between short- and long-lived.
- **Gen 2** — long-lived objects. Collection is expensive and touches the whole heap.
- **LOH** — objects ≥ 85,000 bytes. Collected with Gen 2 and, by default, not compacted, so it fragments.

The generational hypothesis is the whole point: most objects die young, so collecting only the young ones recovers most of the memory for a fraction of the cost.

Server GC (multiple heaps and threads) suits throughput; Workstation GC suits latency in desktop apps.`,
    diagram: `Allocation ──> [ Gen 0 ] --survive--> [ Gen 1 ] --survive--> [ Gen 2 ]
                 fast, frequent          buffer            slow, rare

Large objects (>= 85 KB) ──────────────────────────────> [   LOH   ]
                                                     collected with Gen 2`,
    followUps: [
      {
        question: "What is a memory leak in a garbage-collected runtime?",
        answer:
          "An unintended reference that keeps an object reachable: static collections that only grow, event handlers never unsubscribed, captured closures in long-lived delegates, or a cache with no eviction.",
      },
      {
        question: "Why can `ArrayPool<T>` or `Span<T>` help?",
        answer:
          "They cut allocations. Pooling reuses buffers instead of creating LOH garbage; `Span<T>` slices existing memory without copying. Both reduce GC pressure rather than making the GC faster.",
      },
    ],
    tags: ["gc", "generations", "loh", "memory", "performance"],
  },
  {
    id: "cs-delegate-event",
    topic: "csharp",
    subtopic: "Language",
    level: "intermediate",
    question: "Delegates, `Func`/`Action`, and events — what is the difference?",
    answer: `A **delegate** is a type-safe function pointer. \`Func<>\`/\`Action<>\` are ready-made generic delegate types.

An **event** is a delegate field with restricted access: outside the declaring type only \`+=\` and \`-=\` are allowed. That prevents a subscriber from clearing everyone else's handlers or raising the event itself.`,
    language: "csharp",
    code: `public class Order
{
    // Anyone could overwrite or invoke this
    public Action<string>? Placed;

    // Subscribers can only add and remove
    public event EventHandler<OrderEventArgs>? Confirmed;

    protected virtual void OnConfirmed(OrderEventArgs e)
        => Confirmed?.Invoke(this, e);   // null-conditional: no subscribers is fine
}`,
    followUps: [
      {
        question: "How do events cause memory leaks?",
        answer:
          "The publisher holds a reference to every subscriber. A long-lived publisher keeps short-lived subscribers alive forever. Unsubscribe in `Dispose`, or use weak event patterns.",
      },
      {
        question: "What does a multicast delegate return?",
        answer:
          "Only the last handler's return value; earlier ones are discarded. That is why event signatures return `void`.",
      },
    ],
    tags: ["delegate", "event", "func", "action"],
  },
  {
    id: "cs-string-immutability",
    topic: "csharp",
    subtopic: "Language",
    level: "basic",
    question: "Why is `string` immutable, and when should you use `StringBuilder`?",
    answer: `Immutability makes strings safe to share across threads, cacheable, hashable and internable — a string used as a dictionary key can never change under you.

The cost: every modification allocates a new string. Concatenating in a loop is O(n²) in both time and allocations. \`StringBuilder\` keeps a mutable buffer and produces one string at the end.

Rule of thumb: a handful of concatenations — use \`+\` or interpolation, which the compiler optimises. A loop of unknown length — use \`StringBuilder\`.`,
    language: "csharp",
    code: `// Allocates a new string on every iteration
var s = "";
for (int i = 0; i < 10_000; i++) s += i;      // O(n^2)

// One growable buffer
var sb = new StringBuilder();
for (int i = 0; i < 10_000; i++) sb.Append(i);
var result = sb.ToString();                    // O(n)`,
    followUps: [
      {
        question: "What is string interning?",
        answer:
          "Identical string literals share one instance in an intern pool, so reference comparison succeeds for them. Runtime-built strings are not interned unless you call `string.Intern`.",
      },
      {
        question: "`==` vs `Equals` vs `ReferenceEquals` for strings?",
        answer:
          "`==` and `Equals` compare contents (ordinal). `ReferenceEquals` compares identity and can be false for equal strings built at runtime. For culture rules use `string.Compare` with an explicit `StringComparison`.",
      },
    ],
    tags: ["string", "immutability", "stringbuilder", "performance"],
  },
  {
    id: "cs-collections",
    topic: "csharp",
    subtopic: "Collections",
    level: "intermediate",
    mustKnow: true,
    question: "How do you choose between `List`, `Dictionary`, `HashSet`, `Queue` and `Stack`?",
    answer: `By the access pattern, which is really a complexity question.

| Need | Type | Lookup | Insert |
|---|---|---|---|
| Indexed, ordered | \`List<T>\` | O(n) by value, O(1) by index | O(1) amortised at end |
| Key → value | \`Dictionary<K,V>\` | O(1) average | O(1) average |
| Uniqueness / membership | \`HashSet<T>\` | O(1) average | O(1) average |
| FIFO | \`Queue<T>\` | — | O(1) |
| LIFO | \`Stack<T>\` | — | O(1) |
| Sorted by key | \`SortedDictionary<K,V>\` | O(log n) | O(log n) |

The classic interview trap: scanning a \`List\` inside a loop, turning an O(n) job into O(n²). Building a \`HashSet\` or \`Dictionary\` first makes it O(n).`,
    language: "csharp",
    code: `// O(n * m) — Contains scans the list every time
var missing = wanted.Where(w => !existing.Contains(w)).ToList();

// O(n + m) — one hash lookup per item
var lookup = new HashSet<string>(existing);
var fast = wanted.Where(w => !lookup.Contains(w)).ToList();`,
    followUps: [
      {
        question: "What makes a good `GetHashCode`?",
        answer:
          "Equal objects must return equal hashes, it must be stable while the object is a key, and it should spread values evenly. Mutating a key's hash-relevant field after insertion makes the entry unfindable.",
      },
      {
        question: "Which collections are thread-safe?",
        answer:
          "None of the above. Use `ConcurrentDictionary`, `ConcurrentQueue`, `BlockingCollection`, or lock around access. `ConcurrentDictionary.GetOrAdd`'s factory may run more than once, so it must be side-effect free.",
      },
    ],
    tags: ["collections", "dictionary", "hashset", "complexity"],
  },
  {
    id: "cs-abstract-interface",
    topic: "csharp",
    subtopic: "Types",
    level: "basic",
    mustKnow: true,
    question: "Abstract class vs interface — which do you pick?",
    answer: `- **Interface** — a contract. A type can implement many. No state. Since C# 8 it may carry default implementations, but still no instance fields.
- **Abstract class** — a partial implementation with shared state, constructors and protected members. Only one base class.

Choose an interface for a capability that unrelated types can have (\`IDisposable\`, \`IComparable\`). Choose an abstract class when implementations genuinely share code and identity ("is-a").

Practical tie-breaker: interfaces are far easier to mock in tests, which is why DI-heavy codebases lean on them.`,
    language: "csharp",
    code: `public interface IPaymentMethod          // capability
{
    bool CanHandle(string currency);
    Task<Receipt> ChargeAsync(decimal amount);
    string Describe() => GetType().Name;  // C# 8 default implementation
}

public abstract class PaymentProcessor    // shared behaviour + state
{
    protected readonly ILogger Logger;
    protected PaymentProcessor(ILogger logger) => Logger = logger;

    public async Task<Receipt> ProcessAsync(decimal amount)
    {
        Logger.LogInformation("Charging {Amount}", amount);
        return await ChargeCoreAsync(amount);      // template method
    }

    protected abstract Task<Receipt> ChargeCoreAsync(decimal amount);
}`,
    followUps: [
      {
        question: "Why did C# add default interface implementations?",
        answer:
          "To let a library add a member to a published interface without breaking every implementer. It is a versioning tool, not an invitation to put logic in interfaces.",
      },
      {
        question: "Can an abstract class have no abstract members?",
        answer:
          "Yes. It then exists purely to prevent direct instantiation while providing shared behaviour.",
      },
    ],
    tags: ["abstract", "interface", "design", "oop"],
  },
  {
    id: "cs-record-class-struct",
    topic: "csharp",
    subtopic: "Types",
    level: "intermediate",
    question: "What does a `record` give you over a class?",
    answer: `A \`record\` is a class (or \`record struct\`) with compiler-generated **value semantics**:

- \`Equals\`/\`GetHashCode\` comparing all properties instead of identity.
- A readable \`ToString()\`.
- \`with\` expressions for non-destructive mutation.
- Deconstruction and a primary constructor for positional records.

Use records for DTOs, messages, events and query results — anything defined by its data. Use a class where identity matters (an entity with an Id that persists across value changes).`,
    language: "csharp",
    code: `public record Address(string City, string Pin);

var a = new Address("Bhubaneswar", "751024");
var b = new Address("Bhubaneswar", "751024");
Console.WriteLine(a == b);            // True — value equality

var moved = a with { Pin = "751030" }; // copy with one change; a is unchanged

// A class would print False for the same comparison`,
    followUps: [
      {
        question: "Are records immutable?",
        answer:
          "Positional records generate `init`-only properties, so they are shallowly immutable by convention — but you can declare mutable properties, and a mutable object inside a record is still mutable.",
      },
    ],
    tags: ["record", "value equality", "dto", "immutability"],
  },
  {
    id: "cs-exception-handling",
    topic: "csharp",
    subtopic: "Errors",
    level: "intermediate",
    question: "What are the rules for exception handling you would enforce in review?",
    answer: `1. **Catch what you can handle.** A \`catch\` that logs and rethrows the same thing at every layer produces noise, not diagnostics.
2. **\`throw;\` not \`throw ex;\`** — the latter resets the stack trace to the rethrow point.
3. **Never swallow silently.** An empty catch hides the bug that will page you at 2 am.
4. **Do not use exceptions for control flow.** They are expensive and hide intent; return a result or use \`TryParse\`-style APIs.
5. **Preserve context** — wrap with an inner exception when adding domain meaning.
6. **Handle centrally in a web app** — exception middleware turns unhandled exceptions into a consistent ProblemDetails response.`,
    language: "csharp",
    code: `try
{
    await _payments.ChargeAsync(order);
}
catch (HttpRequestException ex) when (ex.StatusCode == HttpStatusCode.TooManyRequests)
{
    // Exception filter: only this case is handled here
    await _retry.ScheduleAsync(order);
}
catch (PaymentDeclinedException ex)
{
    throw new OrderFailedException($"Order {order.Id} could not be paid", ex); // keeps inner
}
// Anything else propagates to the middleware — deliberately`,
    followUps: [
      {
        question: "What is an exception filter (`when`) good for?",
        answer:
          "Deciding whether to handle without unwinding the stack. Because the filter runs before the stack unwinds, a debugger breaks at the original throw site — better diagnostics than catch-and-rethrow.",
      },
      {
        question: "How do you handle exceptions in a background service?",
        answer:
          "Wrap the loop body so one failure does not kill the service, log with context, and back off before retrying. An unhandled exception in `ExecuteAsync` stops the host silently in older versions.",
      },
    ],
    tags: ["exceptions", "error handling", "middleware"],
  },
  {
    id: "cs-thread-safety",
    topic: "csharp",
    subtopic: "Concurrency",
    level: "advanced",
    question: "How do you make shared state thread-safe in C#?",
    answer: `In order of preference:

1. **Do not share.** Immutable data and per-request instances need no synchronisation.
2. **Concurrent collections** — \`ConcurrentDictionary\`, \`ConcurrentQueue\`, \`Channel<T>\`.
3. **\`Interlocked\`** for single-variable counters and swaps — lock-free.
4. **\`lock\`** for short critical sections over a private readonly object.
5. **\`SemaphoreSlim\`** when you need to await inside the critical section — you cannot \`await\` inside \`lock\`.

Lock on a private object, never on \`this\`, a type, or a string: external code could take the same lock and deadlock you.`,
    language: "csharp",
    code: `private readonly object _gate = new();
private readonly SemaphoreSlim _asyncGate = new(1, 1);
private int _count;

void SyncIncrement() { lock (_gate) { _count++; } }

void LockFreeIncrement() => Interlocked.Increment(ref _count);

async Task AsyncCriticalSectionAsync()
{
    await _asyncGate.WaitAsync();
    try { await _store.SaveAsync(); }   // await inside lock{} would not compile
    finally { _asyncGate.Release(); }
}`,
    followUps: [
      {
        question: "What is a race condition versus a deadlock?",
        answer:
          "A race is two threads interleaving so the result depends on timing. A deadlock is two threads each holding what the other needs, so neither proceeds. Consistent lock ordering prevents most deadlocks.",
      },
      {
        question: "Why is `volatile` rarely the answer?",
        answer:
          "It only prevents certain compiler/CPU reorderings for a single field. It does not make compound operations such as `i++` atomic. Use `Interlocked` or a lock.",
      },
    ],
    tags: ["threading", "lock", "interlocked", "semaphore", "concurrency"],
  },
  {
    id: "cs-extension-generic-constraints",
    topic: "csharp",
    subtopic: "Language",
    level: "intermediate",
    question: "Explain generics constraints and why generics beat `object`.",
    answer: `Generics give **compile-time type safety without boxing**. Before generics, \`ArrayList\` stored \`object\`, so every value type was boxed and every read needed a cast that could fail at runtime.

Constraints tell the compiler what a type parameter can do:

- \`where T : class\` / \`struct\` — reference or value type
- \`where T : new()\` — has a public parameterless constructor
- \`where T : IComparable<T>\` — implements an interface
- \`where T : BaseType\` — derives from a base
- \`where T : notnull\`, \`unmanaged\`

Without a constraint you can only use \`object\` members.`,
    language: "csharp",
    code: `public static T Max<T>(T a, T b) where T : IComparable<T>
    => a.CompareTo(b) >= 0 ? a : b;      // CompareTo needs the constraint

public static TEntity Create<TEntity>() where TEntity : IEntity, new()
    => new TEntity { CreatedAt = DateTime.UtcNow };

// Extension method: static class, static method, "this" on the first parameter
public static class StringExtensions
{
    public static bool IsNullOrBlank(this string? value)
        => string.IsNullOrWhiteSpace(value);
}`,
    followUps: [
      {
        question: "What are covariance and contravariance?",
        answer:
          "`out T` (covariant) lets `IEnumerable<Dog>` be used as `IEnumerable<Animal>` — safe because you only read. `in T` (contravariant) lets `IComparer<Animal>` be used as `IComparer<Dog>` — safe because you only write. Both apply to interfaces and delegates, not classes.",
      },
    ],
    tags: ["generics", "constraints", "variance", "extension methods"],
  },
  {
    id: "cs-nullable-reference-types",
    topic: "csharp",
    subtopic: "Language",
    level: "intermediate",
    question: "What do nullable reference types actually change?",
    answer: `They are a **compile-time analysis**, not a runtime guarantee. With \`<Nullable>enable</Nullable>\`, \`string\` means "should not be null" and \`string?\` means "may be null"; the compiler warns when you dereference the latter without checking.

Nothing is enforced at runtime: a null can still arrive from JSON deserialisation, reflection, or a library compiled without the feature. So keep validating at trust boundaries.

The \`!\` null-forgiving operator silences the warning without proving anything — treat each use as a comment claiming "I know better", and be able to justify it.`,
    language: "csharp",
    code: `public class User
{
    public string Name { get; set; } = "";      // non-null: initialise it
    public string? MiddleName { get; set; }     // explicitly optional
}

void Print(User? user)
{
    // Console.WriteLine(user.Name);            // warning: may be null
    if (user is null) return;
    Console.WriteLine(user.Name);               // fine after the guard

    var length = user.MiddleName?.Length ?? 0;  // null-conditional + coalescing
}`,
    followUps: [
      {
        question: "How do you enable this on a large existing codebase?",
        answer:
          "Enable per file or per project with `#nullable enable`, fix warnings incrementally, and treat new code as strict. A big-bang switch produces thousands of warnings that get suppressed wholesale.",
      },
    ],
    tags: ["nullable", "null safety", "compiler"],
  },
];
