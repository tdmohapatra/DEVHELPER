import type { Question } from "./types";

/** ASP.NET Core, hosting, EF Core and the runtime questions asked of .NET developers. */
export const DOTNET_QUESTIONS: Question[] = [
  {
    id: "net-middleware-pipeline",
    topic: "dotnet",
    subtopic: "ASP.NET Core",
    level: "intermediate",
    mustKnow: true,
    question: "Explain the ASP.NET Core middleware pipeline. Why does order matter?",
    answer: `Every request passes through a chain of middleware. Each component may act **before** calling \`next()\`, **after** it, or short-circuit and never call it at all.

Order is behaviour, not style:

- \`UseExceptionHandler\` must be first, or it cannot catch what happens later.
- \`UseRouting\` must precede \`UseAuthorization\`, because authorisation needs the matched endpoint's policies.
- \`UseAuthentication\` must precede \`UseAuthorization\` — you cannot authorise an unknown user.
- \`UseCors\` must run before anything that writes a response.
- \`UseStaticFiles\` early short-circuits static requests before the expensive stages.`,
    language: "csharp",
    code: `var app = builder.Build();

app.UseExceptionHandler("/error");   // outermost: catches everything after it
app.UseHttpsRedirection();
app.UseStaticFiles();                // short-circuits for files
app.UseRouting();                    // decides which endpoint matches
app.UseCors("default");
app.UseAuthentication();             // who are you?
app.UseAuthorization();              // are you allowed?
app.MapControllers();                // terminal: runs the endpoint

// Custom middleware
app.Use(async (context, next) =>
{
    var sw = Stopwatch.StartNew();
    await next();                          // everything downstream
    logger.LogInformation("{Path} took {Ms}ms", context.Request.Path, sw.ElapsedMilliseconds);
});`,
    diagram: `Request  ->  Exception  ->  Static  ->  Routing  ->  Auth  ->  Endpoint
                 |            |           |           |          |
Response <-------+------------+-----------+-----------+----------+
            (each stage sees the response on the way back out)`,
    followUps: [
      {
        question: "`Use`, `Run` and `Map` — what is the difference?",
        answer:
          "`Use` adds a stage that may call `next`. `Run` is terminal and never calls `next`. `Map` branches the pipeline on a path prefix.",
      },
      {
        question: "How do you write middleware that needs a scoped service?",
        answer:
          "Middleware constructors are singleton-scoped, so inject scoped services into the `InvokeAsync` method parameters instead — the framework resolves them per request.",
      },
    ],
    tags: ["middleware", "pipeline", "aspnetcore", "order"],
  },
  {
    id: "net-di-lifetimes",
    topic: "dotnet",
    subtopic: "DI",
    level: "intermediate",
    mustKnow: true,
    question: "What goes wrong with the wrong DI lifetime?",
    answer: `- **Scoped into singleton (captive dependency)** — the singleton holds the first request's instance forever. With \`DbContext\` this means a shared, eventually broken connection and cross-request data leakage. The default \`ValidateScopes\` in development throws on this.
- **Singleton holding mutable state** — must be thread-safe; a plain \`Dictionary\` field will corrupt under load.
- **Transient for something expensive** — a new HTTP handler or connection per resolution exhausts resources.
- **\`DbContext\` as singleton** — it is not thread-safe and tracks entities forever; memory grows until restart.

Rule: \`DbContext\` scoped, stateless helpers singleton, everything else scoped unless proven otherwise.`,
    language: "csharp",
    code: `// This throws at startup in Development because of scope validation
services.AddSingleton<OrderCache>();          // depends on AppDbContext (scoped)

// Correct: take a factory and open a scope per unit of work
public class OrderCache(IServiceScopeFactory scopes, IMemoryCache cache)
{
    public async Task<Order?> GetAsync(int id) =>
        await cache.GetOrCreateAsync($"o:{id}", async _ =>
        {
            using var scope = scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            return await db.Orders.FindAsync(id);
        });
}`,
    followUps: [
      {
        question: "How does `IHttpClientFactory` fit in?",
        answer:
          "It pools and rotates `HttpMessageHandler` instances, solving both socket exhaustion (from disposing clients) and stale DNS (from one static client). Typed clients also give a natural place for Polly retry policies.",
      },
    ],
    tags: ["di", "lifetime", "captive dependency", "dbcontext"],
  },
  {
    id: "net-ef-tracking",
    topic: "dotnet",
    subtopic: "EF Core",
    level: "intermediate",
    mustKnow: true,
    question: "What is change tracking in EF Core, and when do you turn it off?",
    answer: `\`DbContext\` keeps a snapshot of every entity it loads so \`SaveChanges\` can work out the UPDATE statements. That costs memory and CPU proportional to the number of entities loaded.

Turn it off for read-only queries with \`AsNoTracking()\` — typically a large win on list and report endpoints.

Keep tracking when you intend to modify and save. Never share a \`DbContext\` between threads or requests: it is not thread-safe, and its tracked set grows without bound.`,
    language: "csharp",
    code: `// Read-only: no snapshots, less memory, faster
var products = await db.Products
    .AsNoTracking()
    .Where(p => p.IsActive)
    .Select(p => new ProductDto(p.Id, p.Name, p.Price))   // project early
    .ToListAsync();

// Tracked: EF works out the UPDATE for you
var order = await db.Orders.FindAsync(id);
order!.Status = OrderStatus.Shipped;
await db.SaveChangesAsync();`,
    followUps: [
      {
        question: "What is the N+1 query problem in EF Core and how do you spot it?",
        answer:
          "Loading a list, then lazily loading a navigation per row — 1 + N round trips. Spot it by logging SQL or watching the query count. Fix with `Include`, a projection that pulls what you need, or `AsSplitQuery` when a single join explodes rows.",
      },
      {
        question: "`Include` vs projection?",
        answer:
          "`Include` loads whole related entities; a `Select` projection loads only the columns you use and is usually faster. Projection also avoids accidental over-fetching in an API response.",
      },
    ],
    tags: ["ef core", "tracking", "asnotracking", "n+1", "performance"],
  },
  {
    id: "net-middleware-vs-filter",
    topic: "dotnet",
    subtopic: "ASP.NET Core",
    level: "advanced",
    question: "Middleware, filters, or an endpoint — where does cross-cutting logic belong?",
    answer: `- **Middleware** — everything HTTP-level and endpoint-agnostic: logging, exception handling, headers, CORS, correlation IDs. It runs before routing knows what will handle the request.
- **Filters (MVC)** — logic that needs MVC context: model state, action arguments, the action result. Authorization, resource, action, exception and result filters run in a defined order.
- **Endpoint filters (minimal APIs)** — the lighter equivalent for minimal endpoints.

Choose middleware when the logic applies to every request; a filter when it needs to know about the action or its model.`,
    language: "csharp",
    code: `// Filter: needs to inspect the bound model, so middleware is the wrong layer
public class ValidateModelAttribute : ActionFilterAttribute
{
    public override void OnActionExecuting(ActionExecutingContext context)
    {
        if (!context.ModelState.IsValid)
            context.Result = new BadRequestObjectResult(context.ModelState);
    }
}

// Minimal API endpoint filter
app.MapPost("/orders", (OrderDto dto) => Results.Ok())
   .AddEndpointFilter(async (ctx, next) =>
   {
       var dto = ctx.GetArgument<OrderDto>(0);
       return dto.Total <= 0 ? Results.BadRequest("Total must be positive") : await next(ctx);
   });`,
    followUps: [
      {
        question: "In what order do MVC filters run?",
        answer:
          "Authorization → Resource → Model binding → Action → Exception (on failure) → Result. Each has a before/after half, nested like the middleware pipeline.",
      },
    ],
    tags: ["middleware", "filters", "minimal api", "cross-cutting"],
  },
  {
    id: "net-configuration-options",
    topic: "dotnet",
    subtopic: "Hosting",
    level: "intermediate",
    question: "How does configuration work, and what are the IOptions variants?",
    answer: `Configuration is layered; later providers override earlier ones. Typical order: \`appsettings.json\` → \`appsettings.{Environment}.json\` → user secrets (Development) → environment variables → command line.

Binding options:

- **\`IOptions<T>\`** — resolved once, singleton. Never sees later changes.
- **\`IOptionsSnapshot<T>\`** — recomputed per request (scoped). Picks up file changes.
- **\`IOptionsMonitor<T>\`** — singleton with change notifications; the only one usable inside a singleton or background service that must react to changes.

Never put secrets in \`appsettings.json\`. Use user secrets locally and Key Vault or environment variables in production.`,
    language: "csharp",
    code: `builder.Services.AddOptions<SmtpOptions>()
    .Bind(builder.Configuration.GetSection("Smtp"))
    .ValidateDataAnnotations()
    .Validate(o => o.Port > 0, "Port must be positive")
    .ValidateOnStart();                 // fail at startup, not at first email

public class Mailer(IOptionsMonitor<SmtpOptions> options)
{
    public Task SendAsync()
    {
        var current = options.CurrentValue;   // reflects the latest configuration
        return Task.CompletedTask;
    }
}`,
    followUps: [
      {
        question: "How do environment variables map onto nested settings?",
        answer:
          'Double underscore is the separator: `Smtp__Port=25` binds to `Smtp:Port`. That is how container and App Service settings override JSON.',
      },
    ],
    tags: ["configuration", "ioptions", "secrets", "hosting"],
  },
  {
    id: "net-hosted-service",
    topic: "dotnet",
    subtopic: "Hosting",
    level: "intermediate",
    question: "How do you run background work in ASP.NET Core?",
    answer: `Implement \`BackgroundService\` (an \`IHostedService\`) and register it. The host starts it with the app and signals a \`CancellationToken\` on shutdown.

What interviewers look for:

- **Honour the token** — pass it to every await, so shutdown is not blocked.
- **Never let the loop throw** — an unhandled exception stops the service; wrap the body.
- **Create a scope per iteration** — the service itself is a singleton and cannot hold a \`DbContext\`.
- **Back off on failure** rather than spinning.

For work that must survive restarts, a queue plus a worker beats an in-process timer.`,
    language: "csharp",
    code: `public class OutboxPublisher(IServiceScopeFactory scopes, ILogger<OutboxPublisher> log)
    : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = scopes.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                await PublishPendingAsync(db, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;                                   // normal shutdown
            }
            catch (Exception ex)
            {
                log.LogError(ex, "Outbox publish failed");  // keep the service alive
            }

            await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
        }
    }
}`,
    followUps: [
      {
        question: "What happens if two instances of the app run this service?",
        answer:
          "Both process the same work. You need a distributed lock, a leased queue message, or `SELECT ... FOR UPDATE SKIP LOCKED` semantics so only one instance takes each item.",
      },
    ],
    tags: ["background service", "ihostedservice", "worker", "cancellation"],
  },
  {
    id: "net-authentication-authorization",
    topic: "dotnet",
    subtopic: "Security",
    level: "intermediate",
    question: "How do authentication and authorisation work in ASP.NET Core?",
    answer: `**Authentication** establishes identity — a \`ClaimsPrincipal\` built from a JWT, cookie or external provider. **Authorisation** decides what that identity may do.

Authorisation styles, weakest to strongest:

1. \`[Authorize]\` — any authenticated user.
2. \`[Authorize(Roles = "Admin")]\` — role claim check. Coarse and hard to evolve.
3. **Policies** — named requirements evaluated by handlers. Preferred: the rule lives in one place and can combine claims, resource state and external data.
4. **Resource-based** — \`IAuthorizationService.AuthorizeAsync(user, document, "CanEdit")\` when the answer depends on the specific object.`,
    language: "csharp",
    code: `builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        o.Authority = "https://login.microsoftonline.com/<tenant>/v2.0";
        o.TokenValidationParameters = new() { ValidateAudience = true, ValidAudience = "api://orders" };
    });

builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("CanApprovePayments", policy =>
        policy.RequireAuthenticatedUser()
              .RequireClaim("department", "finance")
              .RequireAssertion(ctx => ctx.User.HasClaim("limit", "high")));
});

[Authorize(Policy = "CanApprovePayments")]
[HttpPost("approve")]
public Task<IActionResult> Approve(Guid id) => ...;`,
    followUps: [
      {
        question: "Where should a JWT be validated — gateway or service?",
        answer:
          "Validate signature and audience at the service too. A gateway check alone means anything that reaches the service directly (another pod, a misrouted call) is trusted implicitly.",
      },
      {
        question: "Why not store JWTs in localStorage?",
        answer:
          "Any XSS can read it. An HttpOnly, Secure, SameSite cookie cannot be read by script; pair it with anti-forgery protection for state-changing requests.",
      },
    ],
    tags: ["auth", "jwt", "policy", "claims", "security"],
  },
  {
    id: "net-core-vs-framework",
    topic: "dotnet",
    subtopic: "Runtime",
    level: "basic",
    question: ".NET Framework, .NET Core, .NET 5+ — what is the difference?",
    answer: `- **.NET Framework (≤4.8)** — Windows-only, ships with the OS, still supported but closed to new features. Legacy WebForms/WCF-era applications live here.
- **.NET Core (1–3.1)** — the cross-platform rewrite: side-by-side versions, self-contained deployment, much faster.
- **.NET 5+** — the unified continuation of .NET Core (the "Core" was dropped from the name). Even numbers are LTS (6, 8, 10), odd numbers are STS with a shorter support window.

Migration reality: ASP.NET Core is not a drop-in replacement for ASP.NET MVC — hosting, configuration, DI and startup all differ. WCF server-side and WebForms have no direct port.`,
    followUps: [
      {
        question: "What is .NET Standard and is it still relevant?",
        answer:
          "A specification of APIs a library can target so it runs on multiple runtimes. Mostly historical now: for new libraries target `net8.0`, and only use `netstandard2.0` if you must support .NET Framework consumers.",
      },
    ],
    tags: ["runtime", "framework", "migration", "lts"],
  },
  {
    id: "net-rest-api-design",
    topic: "dotnet",
    subtopic: "APIs",
    level: "intermediate",
    mustKnow: true,
    question: "What makes a well-designed REST API?",
    answer: `- **Nouns, not verbs**: \`POST /orders\`, not \`POST /createOrder\`.
- **Correct status codes**: 200 ok, 201 created (+ \`Location\`), 204 no content, 400 validation, 401 unauthenticated, 403 unauthorised, 404 missing, 409 conflict, 422 semantic failure, 429 rate limited, 500 unexpected.
- **Consistent errors** — RFC 7807 \`ProblemDetails\` in ASP.NET Core.
- **Pagination on every collection**, with a stable sort. Offset paging is simple; keyset paging survives inserts.
- **Versioning** decided up front — URL (\`/v1/\`), header, or media type.
- **Idempotency** for POST where retries are possible: an \`Idempotency-Key\` header the server records.`,
    language: "csharp",
    code: `[HttpPost]
[ProducesResponseType(typeof(OrderDto), StatusCodes.Status201Created)]
[ProducesResponseType(StatusCodes.Status400BadRequest)]
public async Task<IActionResult> Create(CreateOrder command, CancellationToken ct)
{
    var result = await _orders.CreateAsync(command, ct);
    if (result.IsFailure)
        return Problem(title: "Order rejected", detail: result.Error, statusCode: 422);

    return CreatedAtAction(nameof(GetById), new { id = result.Value.Id }, result.Value);
}

// Keyset pagination: stable when rows are inserted between pages
// GET /orders?after=2026-07-31T09:00:00Z&limit=50`,
    followUps: [
      {
        question: "PUT vs PATCH vs POST?",
        answer:
          "PUT replaces the whole resource and is idempotent. PATCH applies a partial change. POST creates or triggers and is not idempotent unless you add an idempotency key.",
      },
      {
        question: "How do you version without breaking clients?",
        answer:
          "Add, never remove or repurpose. New optional fields are safe; changing a field's meaning is not. When a breaking change is unavoidable, run both versions until clients migrate.",
      },
    ],
    tags: ["rest", "api design", "status codes", "versioning", "pagination"],
  },
  {
    id: "net-logging-observability",
    topic: "dotnet",
    subtopic: "Diagnostics",
    level: "intermediate",
    question: "How would you make a .NET service observable in production?",
    answer: `Three signals, and a way to join them.

- **Structured logs** — \`ILogger\` with message templates, never string interpolation, so fields stay queryable.
- **Metrics** — counters, gauges and histograms via \`System.Diagnostics.Metrics\`; scraped by Prometheus or Azure Monitor.
- **Traces** — \`ActivitySource\`/OpenTelemetry spans that follow a request across services.

Join them with a **correlation ID** propagated through W3C \`traceparent\`, logged on every entry.`,
    language: "csharp",
    code: `// Templates keep OrderId as a queryable field, not part of the text
logger.LogInformation("Order {OrderId} shipped to {City}", order.Id, order.City);
// NOT: logger.LogInformation($"Order {order.Id} shipped");   // unqueryable

// Scope adds fields to every log inside the block
using (logger.BeginScope(new Dictionary<string, object> { ["CorrelationId"] = correlationId }))
{
    await _shipping.ShipAsync(order);
}

builder.Services.AddOpenTelemetry()
    .WithTracing(t => t.AddAspNetCoreInstrumentation().AddHttpClientInstrumentation().AddOtlpExporter())
    .WithMetrics(m => m.AddAspNetCoreInstrumentation().AddRuntimeInstrumentation());`,
    followUps: [
      {
        question: "What do you do about log volume and cost?",
        answer:
          "Log levels per namespace, sampling for high-volume traces, and keeping debug detail behind a switch you can raise at runtime. Errors and business events always; per-item chatter rarely.",
      },
    ],
    tags: ["logging", "opentelemetry", "metrics", "tracing", "observability"],
  },
  {
    id: "net-caching",
    topic: "dotnet",
    subtopic: "Performance",
    level: "intermediate",
    question: "What caching options does .NET give you, and what are the risks?",
    answer: `- **\`IMemoryCache\`** — in-process, fastest, per-instance. Behind a load balancer each instance has its own copy, so entries can disagree.
- **\`IDistributedCache\`** (Redis, SQL Server) — shared across instances, survives restarts, costs a network hop and serialisation.
- **Response caching / output caching** — caches whole responses at the HTTP layer.
- **HybridCache** (.NET 9) — combines in-process and distributed with stampede protection built in.

Risks to name: **stale data** (choose expiry deliberately), **cache stampede** (many misses at once hammering the origin), and **unbounded growth** (always set a size limit or expiry).`,
    language: "csharp",
    code: `// Stampede protection: one caller computes, the rest wait
private static readonly SemaphoreSlim _gate = new(1, 1);

public async Task<Product?> GetAsync(int id)
{
    if (_cache.TryGetValue<Product>(id, out var hit)) return hit;

    await _gate.WaitAsync();
    try
    {
        if (_cache.TryGetValue(id, out hit)) return hit;         // re-check after waiting
        var product = await _db.Products.FindAsync(id);
        _cache.Set(id, product, new MemoryCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(10),
            Size = 1
        });
        return product;
    }
    finally { _gate.Release(); }
}`,
    followUps: [
      {
        question: "How do you invalidate a cache correctly?",
        answer:
          "Prefer short expiry over manual invalidation where staleness is tolerable. Where it is not, invalidate on write, and in a distributed system publish the invalidation so every instance drops its copy.",
      },
    ],
    tags: ["caching", "redis", "memorycache", "stampede", "performance"],
  },
  {
    id: "net-testing",
    topic: "dotnet",
    subtopic: "Testing",
    level: "intermediate",
    question: "How do you structure tests for a .NET service?",
    answer: `- **Unit tests** — one class, dependencies faked. Fast, numerous, no I/O.
- **Integration tests** — \`WebApplicationFactory<T>\` boots the real pipeline in memory; use Testcontainers for a real database rather than an in-memory provider that behaves differently.
- **Contract tests** — verify the API shape consumers rely on.

Practices worth naming: arrange-act-assert, one behaviour per test, no logic in tests, deterministic data (inject a clock rather than calling \`DateTime.Now\`), and testing behaviour rather than implementation so refactoring does not break the suite.`,
    language: "csharp",
    code: `public class OrdersApiTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient _client;

    public OrdersApiTests(WebApplicationFactory<Program> factory) =>
        _client = factory.WithWebHostBuilder(b => b.ConfigureServices(s =>
        {
            s.RemoveAll<IPaymentGateway>();
            s.AddSingleton<IPaymentGateway, FakePaymentGateway>();   // only the boundary is faked
        })).CreateClient();

    [Fact]
    public async Task Rejects_an_order_with_no_lines()
    {
        var response = await _client.PostAsJsonAsync("/orders", new { lines = Array.Empty<object>() });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }
}`,
    followUps: [
      {
        question: "Why avoid the EF in-memory provider for tests?",
        answer:
          "It is not a relational database: no real SQL translation, no constraints, different transaction and concurrency behaviour. Tests pass while production fails. Use SQLite in-memory for speed or a container for fidelity.",
      },
    ],
    tags: ["testing", "xunit", "integration", "webapplicationfactory", "testcontainers"],
  },
];
