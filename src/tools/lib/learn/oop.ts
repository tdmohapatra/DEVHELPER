import type { Question } from "./types";

/** OOP principles, SOLID and the design patterns that actually come up. */
export const OOP_QUESTIONS: Question[] = [
  {
    id: "oop-four-pillars",
    topic: "oop",
    subtopic: "Principles",
    level: "basic",
    mustKnow: true,
    question: "Explain the four pillars of OOP with a real example.",
    answer: `- **Encapsulation** — state is private; behaviour is the public surface. Invariants stay valid because nothing can reach in and break them.
- **Abstraction** — expose *what* a thing does, hide *how*. Callers depend on a contract, not an implementation.
- **Inheritance** — reuse and specialise an existing type ("is-a"). The weakest pillar; composition is usually better.
- **Polymorphism** — one call site, many behaviours, chosen at runtime by the actual type.

The interview follow-up is almost always "give an example from your own code" — have one ready.`,
    language: "csharp",
    code: `// Encapsulation: the balance cannot go negative because nothing can set it directly
public class Account
{
    private decimal _balance;                       // hidden state
    public decimal Balance => _balance;             // read-only view

    public void Withdraw(decimal amount)
    {
        if (amount <= 0) throw new ArgumentOutOfRangeException(nameof(amount));
        if (amount > _balance) throw new InvalidOperationException("Insufficient funds");
        _balance -= amount;                         // invariant enforced in one place
    }
}

// Abstraction + polymorphism
public interface INotifier { Task SendAsync(string message); }
public class EmailNotifier : INotifier { /* ... */ }
public class SmsNotifier   : INotifier { /* ... */ }

// One call site, behaviour depends on the runtime type
foreach (var notifier in notifiers) await notifier.SendAsync("Order shipped");`,
    followUps: [
      {
        question: "Why is inheritance considered the weakest pillar?",
        answer:
          "It binds a subclass to its base class's implementation forever. A change in the base ripples into every subclass, and deep hierarchies become impossible to reason about. Composition gives the same reuse with a seam you can replace.",
      },
      {
        question: "Difference between overloading and overriding?",
        answer:
          "Overloading is compile-time: several methods, same name, different parameters. Overriding is runtime: a subclass replaces a `virtual`/`abstract` member. Only overriding is polymorphism.",
      },
    ],
    tags: ["oop", "encapsulation", "polymorphism", "inheritance", "abstraction"],
  },
  {
    id: "oop-solid",
    topic: "oop",
    subtopic: "SOLID",
    level: "intermediate",
    mustKnow: true,
    question: "Walk through SOLID with a concrete violation and fix for each.",
    answer: `**S — Single Responsibility.** A class has one reason to change. An \`OrderService\` that also formats emails and writes files changes for three unrelated reasons.

**O — Open/Closed.** Open to extension, closed to modification. A \`switch\` over payment types that grows with every new type should become a set of strategy implementations.

**L — Liskov Substitution.** A subtype must be usable wherever the base is, without surprises. \`Square : Rectangle\` breaks it: setting Width changes Height, violating the base's contract.

**I — Interface Segregation.** Many small interfaces beat one fat one. If implementers throw \`NotImplementedException\` for half the members, the interface is too big.

**D — Dependency Inversion.** Depend on abstractions, and let the high-level policy own the abstraction. The domain defines \`IOrderRepository\`; the data layer implements it — so the dependency arrow points inward.`,
    language: "csharp",
    code: `// Open/Closed violation — every new method edits this method
public decimal Fee(string type) => type switch
{
    "card"  => 2.5m,
    "upi"   => 0m,
    _       => throw new NotSupportedException()
};

// Fixed: adding a method means adding a class, not editing one
public interface IPaymentMethod
{
    string Code { get; }
    decimal Fee(decimal amount);
}
public class UpiPayment  : IPaymentMethod { public string Code => "upi";  public decimal Fee(decimal a) => 0m; }
public class CardPayment : IPaymentMethod { public string Code => "card"; public decimal Fee(decimal a) => a * 0.025m; }

public class Checkout
{
    private readonly IReadOnlyDictionary<string, IPaymentMethod> _methods;
    public Checkout(IEnumerable<IPaymentMethod> methods) => _methods = methods.ToDictionary(m => m.Code);
    public decimal Fee(string code, decimal amount) => _methods[code].Fee(amount);
}`,
    diagram: `Dependency Inversion — the arrow points inward

  [ API layer ]          [ Infrastructure ]
        |                        |
        v                        v
  +---------------------------------------+
  |            Domain / Core              |
  |   defines IOrderRepository (contract)  |
  +---------------------------------------+
        ^                        |
        |  implements            |
  [ EF Core repository ] <-------+`,
    followUps: [
      {
        question: "Is SOLID always right?",
        answer:
          "No. Applied dogmatically it produces one-method classes and interfaces with a single implementation, which is harder to read than the code it replaced. Apply it where change is actually expected.",
      },
      {
        question: "Give a Liskov violation you have seen in real code.",
        answer:
          "A read-only collection inheriting a mutable one and throwing on `Add`. Callers holding the base type break at runtime. The fix is to split the hierarchy so the read-only type does not claim to support mutation.",
      },
    ],
    tags: ["solid", "srp", "ocp", "lsp", "isp", "dip", "design"],
  },
  {
    id: "oop-composition-inheritance",
    topic: "oop",
    subtopic: "Design",
    level: "intermediate",
    question: "Why prefer composition over inheritance?",
    answer: `Inheritance is compile-time, permanent and total: you take the base class's entire surface and its future changes. Composition is runtime, partial and replaceable.

Symptoms that inheritance was the wrong choice: subclasses overriding members to do nothing, \`if (this is SomeSubtype)\` checks, and a base class that keeps growing "protected helpers" for one subclass.

Use inheritance when the relationship is genuinely "is-a" **and** the base is designed for it (documented extension points, \`virtual\` where intended). Otherwise inject the behaviour.`,
    language: "csharp",
    code: `// Inheritance: Report is stuck with PdfRenderer forever
public class PdfReport : PdfRenderer { }

// Composition: the renderer is chosen at runtime and easily faked in tests
public class Report
{
    private readonly IRenderer _renderer;
    public Report(IRenderer renderer) => _renderer = renderer;
    public byte[] Produce(ReportData data) => _renderer.Render(data);
}`,
    followUps: [
      {
        question: "What is the fragile base class problem?",
        answer:
          "A harmless-looking change in a base class silently breaks subclasses — for example the base starts calling its own virtual method internally, so an override now runs at an unexpected time.",
      },
    ],
    tags: ["composition", "inheritance", "design", "coupling"],
  },
  {
    id: "oop-patterns-common",
    topic: "oop",
    subtopic: "Patterns",
    level: "intermediate",
    mustKnow: true,
    question: "Which design patterns do you actually use, and when?",
    answer: `Name the ones you can defend:

- **Strategy** — swap an algorithm at runtime (pricing rules, retry policies). The most useful pattern in business code.
- **Factory / Abstract Factory** — creation logic that is non-trivial or depends on input.
- **Repository** — collection-like access to persistence. Useful over raw ADO.NET; often redundant over EF Core, which is already a repository plus unit of work.
- **Unit of Work** — one transaction across several repositories. \`DbContext\` is this.
- **Decorator** — add behaviour (caching, logging, retry) without touching the class. DI containers make this trivial.
- **Mediator** — decouple request from handler (MediatR); useful in CQRS, easy to overuse.
- **Observer** — events, notifications, message subscriptions.
- **Singleton** — one instance; in modern .NET this is a DI lifetime, not a hand-written static.`,
    language: "csharp",
    code: `// Decorator: caching added without changing the real repository
public class CachedProductRepository : IProductRepository
{
    private readonly IProductRepository _inner;
    private readonly IMemoryCache _cache;

    public CachedProductRepository(IProductRepository inner, IMemoryCache cache)
        => (_inner, _cache) = (inner, cache);

    public Task<Product?> GetAsync(int id) =>
        _cache.GetOrCreateAsync($"product:{id}", entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(5);
            return _inner.GetAsync(id);
        })!;
}

// Registration: consumers keep asking for IProductRepository
services.AddScoped<ProductRepository>();
services.AddScoped<IProductRepository>(sp =>
    new CachedProductRepository(sp.GetRequiredService<ProductRepository>(),
                                sp.GetRequiredService<IMemoryCache>()));`,
    followUps: [
      {
        question: "Why is Singleton often called an anti-pattern?",
        answer:
          "The hand-written static kind hides a global dependency, makes tests order-dependent, and is hard to replace. A singleton *lifetime* in a DI container keeps the single instance while staying injectable and replaceable.",
      },
      {
        question: "Is Repository over EF Core worth it?",
        answer:
          "Only if you need to hide EF from the domain, swap the store, or constrain queries. Otherwise it usually adds a layer that just forwards calls and leaks `IQueryable` anyway.",
      },
    ],
    tags: ["patterns", "strategy", "decorator", "repository", "factory"],
  },
  {
    id: "oop-dependency-injection",
    topic: "oop",
    subtopic: "Design",
    level: "intermediate",
    mustKnow: true,
    question: "What problem does dependency injection solve, and what are the lifetimes?",
    answer: `DI removes the \`new\` from the class that uses a dependency, so what it depends on can be chosen, replaced or faked from outside. That is what makes unit testing possible without a database.

.NET lifetimes:

- **Transient** — a new instance per resolution. Cheap, stateless services.
- **Scoped** — one per scope; in ASP.NET Core, per HTTP request. \`DbContext\` belongs here.
- **Singleton** — one for the process lifetime. Must be thread-safe.

The dangerous combination is a **captive dependency**: injecting a scoped service into a singleton keeps the first scope's instance alive forever. A \`DbContext\` captured by a singleton is a classic production bug.`,
    language: "csharp",
    code: `services.AddSingleton<IClock, SystemClock>();          // stateless, shared
services.AddScoped<IOrderRepository, OrderRepository>();  // per request
services.AddTransient<IEmailBuilder, EmailBuilder>();     // per resolution

// Wrong: singleton captures a scoped DbContext for the life of the process
services.AddSingleton<ReportCache>();   // ReportCache(DbContext ctx)  <-- captive

// Right: resolve a scope when the work happens
public class ReportCache(IServiceScopeFactory scopeFactory)
{
    public async Task RefreshAsync()
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        // ... use db within this scope only
    }
}`,
    followUps: [
      {
        question: "Constructor injection vs service locator?",
        answer:
          "Constructor injection makes dependencies explicit and compile-checked. A service locator (`provider.GetService<T>()` sprinkled about) hides them, so you cannot tell what a class needs without reading its body.",
      },
      {
        question: "How do you inject something into a background service that needs a scope?",
        answer:
          "Inject `IServiceScopeFactory` and create a scope per unit of work. `IHostedService` itself is a singleton, so scoped services cannot be constructor-injected into it.",
      },
    ],
    tags: ["di", "ioc", "lifetimes", "testing"],
  },
  {
    id: "oop-immutability-encapsulation",
    topic: "oop",
    subtopic: "Design",
    level: "advanced",
    question: "How do you keep an object's invariants safe?",
    answer: `1. **Validate in the constructor** and refuse to build an invalid object. An object that cannot be constructed invalid never needs defensive checks later.
2. **Do not expose setters** for anything the class must control.
3. **Return copies or read-only views** of internal collections — otherwise a caller can \`Add\` behind your back.
4. **Prefer immutability**: an object that never changes cannot be corrupted, and is thread-safe for free.
5. **Keep behaviour with data.** An anaemic model with public setters and logic elsewhere has no invariants to protect.`,
    language: "csharp",
    code: `public class Order
{
    private readonly List<OrderLine> _lines = new();

    public Order(CustomerId customer, IEnumerable<OrderLine> lines)
    {
        if (!lines.Any()) throw new ArgumentException("An order needs at least one line");
        Customer = customer;
        _lines.AddRange(lines);
    }

    public CustomerId Customer { get; }

    // Callers can read but not mutate the internal list
    public IReadOnlyList<OrderLine> Lines => _lines;

    public decimal Total => _lines.Sum(l => l.Amount);   // derived, never stale
}`,
    followUps: [
      {
        question: "What is an anaemic domain model?",
        answer:
          "Classes that are just property bags, with all behaviour in 'service' classes. It is procedural code wearing OOP clothing — invariants live nowhere, so every service must re-check them.",
      },
    ],
    tags: ["invariants", "immutability", "encapsulation", "ddd"],
  },
  {
    id: "oop-equality",
    topic: "oop",
    subtopic: "Principles",
    level: "intermediate",
    question: "How do you implement equality correctly?",
    answer: `Rules \`Equals\` must satisfy: reflexive, symmetric, transitive, consistent, and \`x.Equals(null)\` is false.

If you override \`Equals\`, you **must** override \`GetHashCode\` — equal objects must have equal hash codes, or dictionary and set lookups silently fail to find them.

Base the hash on the same fields as equality, and only on fields that do not change while the object is used as a key.

In modern C#, prefer a \`record\` and let the compiler generate all of it.`,
    language: "csharp",
    code: `public sealed class Money : IEquatable<Money>
{
    public decimal Amount { get; }
    public string Currency { get; }

    public Money(decimal amount, string currency) => (Amount, Currency) = (amount, currency);

    public bool Equals(Money? other) =>
        other is not null && Amount == other.Amount && Currency == other.Currency;

    public override bool Equals(object? obj) => Equals(obj as Money);

    public override int GetHashCode() => HashCode.Combine(Amount, Currency);

    public static bool operator ==(Money? a, Money? b) => Equals(a, b);
    public static bool operator !=(Money? a, Money? b) => !Equals(a, b);
}

// Equivalent, generated for you:
public record Money2(decimal Amount, string Currency);`,
    followUps: [
      {
        question: "What breaks if `GetHashCode` changes while an object is a dictionary key?",
        answer:
          "The entry lands in the wrong bucket, so lookups miss it and the item becomes unreachable while still occupying the dictionary. Use immutable keys.",
      },
    ],
    tags: ["equality", "gethashcode", "record", "value object"],
  },
  {
    id: "oop-cohesion-coupling",
    topic: "oop",
    subtopic: "Design",
    level: "basic",
    question: "What are cohesion and coupling, and how do you judge them in review?",
    answer: `**Cohesion** — how related the members of a class are. High cohesion means everything in the class serves one purpose.

**Coupling** — how much one component depends on another's details. Low coupling means you can change one without touching the other.

The goal is high cohesion, low coupling. Practical review signals:

- A class name containing "Manager", "Helper" or "Util" usually means low cohesion — it accumulates unrelated code.
- A constructor with eight dependencies means the class does too much.
- Reaching through objects (\`a.B.C.D.Do()\`) is tight coupling — the Law of Demeter violation.
- \`new\`-ing a concrete dependency inside a method couples you to it permanently.`,
    followUps: [
      {
        question: "Is low coupling always better?",
        answer:
          "Not unconditionally. Every abstraction added to decouple has a cost in indirection. Decouple where change is likely or where a test seam is needed; leave stable, internal relationships direct.",
      },
    ],
    tags: ["cohesion", "coupling", "review", "design"],
  },
];
