import type { Question } from "./types";

/** Second batch: .NET and Azure. */
export const DOTNET_EXTRA: Question[] = [
  {
    id: "net2-kestrel-hosting",
    topic: "dotnet",
    subtopic: "Hosting",
    level: "intermediate",
    question: "What is Kestrel, and why is a reverse proxy usually in front of it?",
    answer: `Kestrel is the cross-platform HTTP server built into ASP.NET Core. It is fast and can be exposed directly, but a reverse proxy (IIS, Nginx, YARP, Azure Front Door) is common because it adds:

- TLS termination and certificate management
- Request buffering, protecting against slow-client attacks
- Host-based routing, static file serving, compression
- Load balancing and health-based removal

When behind a proxy, add \`UseForwardedHeaders\` — otherwise \`Request.Scheme\` says http and \`RemoteIpAddress\` is the proxy, which breaks redirect URLs, rate limiting and audit logs.`,
    language: "csharp",
    code: `builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    o.KnownNetworks.Clear();     // trust only your proxy; empty means trust configured ones
    o.KnownProxies.Clear();
});

app.UseForwardedHeaders();       // must be before anything that reads scheme or client IP`,
    followUps: [
      {
        question: "Why is trusting all forwarded headers dangerous?",
        answer: "A client can forge `X-Forwarded-For`, spoofing its IP to bypass rate limiting or IP allow-lists. Only trust the proxies you actually run.",
      },
    ],
    tags: ["kestrel", "reverse proxy", "forwarded headers", "hosting"],
  },
  {
    id: "net2-minimal-vs-controllers",
    topic: "dotnet",
    subtopic: "ASP.NET Core",
    level: "intermediate",
    question: "Minimal APIs or controllers?",
    answer: `**Minimal APIs** — less ceremony, faster startup, everything visible in one place. Good for small services, internal endpoints, and anything where the endpoint is a thin shell over a handler.

**Controllers** — conventions, model binding attributes, filters, and structure that scales across a large team and many endpoints. Better when you want cross-cutting behaviour applied by convention.

They are not exclusive — both can live in one app. The real answer in an interview: choose by team size and endpoint count, and be consistent within a service.`,
    language: "csharp",
    code: `// Minimal, grouped, with filters and typed results
var orders = app.MapGroup("/orders").RequireAuthorization().WithTags("Orders");

orders.MapGet("/{id:int}", async Task<Results<Ok<OrderDto>, NotFound>> (int id, IOrderService svc) =>
    await svc.FindAsync(id) is { } order ? TypedResults.Ok(order) : TypedResults.NotFound());

orders.MapPost("/", async (CreateOrder cmd, IOrderService svc) =>
    TypedResults.Created($"/orders/{await svc.CreateAsync(cmd)}"));`,
    tags: ["minimal api", "controllers", "typedresults", "aspnetcore"],
  },
  {
    id: "net2-model-validation",
    topic: "dotnet",
    subtopic: "ASP.NET Core",
    level: "basic",
    question: "How do you validate input in ASP.NET Core?",
    answer: `Layers, because each catches different mistakes:

1. **Data annotations** (\`[Required]\`, \`[Range]\`, \`[EmailAddress]\`) — automatic 400 with \`ProblemDetails\` for controllers with \`[ApiController]\`.
2. **FluentValidation** — for rules that need conditions, cross-field checks or dependencies. Testable in isolation.
3. **Domain invariants** — the last line: a constructor that refuses to build an invalid object. Never rely only on the API layer, because messages, jobs and tests bypass it.

Return **422** for semantically invalid input and **400** for malformed input, and never echo back the raw exception.`,
    language: "csharp",
    code: `public class CreateOrderValidator : AbstractValidator<CreateOrder>
{
    public CreateOrderValidator(IProductCatalog catalog)
    {
        RuleFor(x => x.CustomerId).NotEmpty();
        RuleFor(x => x.Lines).NotEmpty().WithMessage("An order needs at least one line");
        RuleForEach(x => x.Lines).ChildRules(l =>
        {
            l.RuleFor(x => x.Quantity).GreaterThan(0);
            l.RuleFor(x => x.Sku).MustAsync(async (sku, ct) => await catalog.ExistsAsync(sku, ct))
                                 .WithMessage("Unknown SKU");
        });
    }
}`,
    tags: ["validation", "fluentvalidation", "problemdetails", "422"],
  },
  {
    id: "net2-ef-migrations",
    topic: "dotnet",
    subtopic: "EF Core",
    level: "intermediate",
    question: "How do EF Core migrations work in a real deployment?",
    answer: `\`dotnet ef migrations add\` diffs the model against the last snapshot and generates Up/Down code. \`database update\` applies pending ones and records them in \`__EFMigrationsHistory\`.

Production practice:

- **Do not call \`Database.Migrate()\` at app startup** in a multi-instance deployment — several instances race, and the app needs schema-altering permissions it should not have.
- Generate an **idempotent SQL script** (\`--idempotent\`) and run it as a deployment step, reviewed like code.
- Keep migrations **additive** so the previous version keeps working (expand/contract).
- Never edit an applied migration; add a new one.`,
    language: "bash",
    code: `dotnet ef migrations add AddCustomerFullName
dotnet ef migrations script --idempotent --output migrate.sql   # reviewed, run by the pipeline

# What actually ran
SELECT * FROM __EFMigrationsHistory ORDER BY MigrationId DESC;`,
    followUps: [
      {
        question: "How do you handle a migration that needs data movement?",
        answer: "Put the data step in its own migration or a batched script — a single UPDATE across millions of rows locks the table and blows the transaction log.",
      },
    ],
    tags: ["ef core", "migrations", "deployment", "idempotent script"],
  },
  {
    id: "net2-transactions-ef",
    topic: "dotnet",
    subtopic: "EF Core",
    level: "advanced",
    question: "How do transactions work with EF Core?",
    answer: `\`SaveChanges\` is already atomic: all tracked changes go in one transaction. You only need an explicit transaction when several \`SaveChanges\` calls, or raw SQL plus EF work, must commit together.

Points interviewers probe:

- **Do not hold a transaction across an HTTP call** — it pins a connection and holds locks for the remote system's latency.
- **Execution strategies and retries** — with \`EnableRetryOnFailure\`, a manual transaction must be wrapped in \`CreateExecutionStrategy().ExecuteAsync\`, or the retry cannot replay it.
- **Isolation level** — the default follows the provider; set it explicitly when it matters.`,
    language: "csharp",
    code: `var strategy = db.Database.CreateExecutionStrategy();

await strategy.ExecuteAsync(async () =>
{
    await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted);

    db.Orders.Add(order);
    await db.SaveChangesAsync();

    await db.Database.ExecuteSqlInterpolatedAsync(
        $"UPDATE Stock SET Qty = Qty - {qty} WHERE Sku = {sku} AND Qty >= {qty}");

    await tx.CommitAsync();
});`,
    tags: ["ef core", "transaction", "execution strategy", "isolation"],
  },
  {
    id: "net2-concurrency-token",
    topic: "dotnet",
    subtopic: "EF Core",
    level: "intermediate",
    question: "How do you handle two users editing the same row?",
    answer: `Optimistic concurrency: add a \`rowversion\`/\`timestamp\` column as a concurrency token. EF includes it in the WHERE clause of the UPDATE; if zero rows are affected, someone else changed the row and EF throws \`DbUpdateConcurrencyException\`.

Then choose a resolution policy deliberately:

- **Store wins** — reload and tell the user their view was stale.
- **Client wins** — overwrite (rarely correct).
- **Merge** — reconcile field by field, ideally letting the user decide.

Silent last-write-wins is the default if you do nothing, and it loses data invisibly.`,
    language: "csharp",
    code: `public class Product
{
    public int Id { get; set; }
    public decimal Price { get; set; }
    [Timestamp] public byte[] RowVersion { get; set; } = default!;
}

try
{
    await db.SaveChangesAsync();
}
catch (DbUpdateConcurrencyException ex)
{
    var entry = ex.Entries.Single();
    var current = await entry.GetDatabaseValuesAsync();     // what is really stored now
    if (current is null) return Results.NotFound("It was deleted by someone else");

    entry.OriginalValues.SetValues(current);                 // let the user retry against fresh data
    return Results.Conflict(current.ToObject());
}`,
    tags: ["concurrency", "rowversion", "optimistic", "conflict"],
  },
  {
    id: "net2-serialization",
    topic: "dotnet",
    subtopic: "APIs",
    level: "intermediate",
    question: "What should you know about `System.Text.Json`?",
    answer: `- It is **case-insensitive on read only if configured**; ASP.NET Core enables camelCase naming and case-insensitive binding by default, plain \`JsonSerializer\` does not.
- **Fields are ignored** unless \`IncludeFields\` is set; only public properties serialise.
- **Cycles throw** unless you set \`ReferenceHandler.IgnoreCycles\` — the classic EF navigation-property error.
- **\`JsonSerializerOptions\` is expensive**: cache one static instance, do not build it per call.
- **Polymorphism** needs \`[JsonDerivedType]\` (or a custom converter); it does not serialise derived types through a base reference by default.
- Source generators (\`JsonSerializerContext\`) remove reflection for AOT and speed.`,
    language: "csharp",
    code: `private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
{
    ReferenceHandler = ReferenceHandler.IgnoreCycles,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
};

[JsonDerivedType(typeof(CardPayment), "card")]
[JsonDerivedType(typeof(UpiPayment), "upi")]
public abstract record Payment(decimal Amount);`,
    tags: ["json", "serialization", "system.text.json", "polymorphism"],
  },
  {
    id: "net2-middleware-exception",
    topic: "dotnet",
    subtopic: "ASP.NET Core",
    level: "intermediate",
    question: "How do you produce consistent error responses?",
    answer: `Use one exception handler and map exception types to status codes there, so no controller repeats try/catch.

- \`IExceptionHandler\` (.NET 8) or \`UseExceptionHandler\` middleware.
- Return **ProblemDetails** (RFC 7807): \`type\`, \`title\`, \`status\`, \`detail\`, \`instance\`, plus a correlation id so support can find the log.
- **Never leak internals** — no stack traces or SQL in production responses.
- Log at the boundary with full detail; return the sanitised version.`,
    language: "csharp",
    code: `public class GlobalExceptionHandler(ILogger<GlobalExceptionHandler> log) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext ctx, Exception ex, CancellationToken ct)
    {
        var (status, title) = ex switch
        {
            ValidationException      => (StatusCodes.Status422UnprocessableEntity, "Validation failed"),
            KeyNotFoundException     => (StatusCodes.Status404NotFound, "Not found"),
            UnauthorizedAccessException => (StatusCodes.Status403Forbidden, "Forbidden"),
            _                        => (StatusCodes.Status500InternalServerError, "Unexpected error")
        };

        log.LogError(ex, "Unhandled {Status} on {Path}", status, ctx.Request.Path);

        await Results.Problem(
            title: title,
            statusCode: status,
            extensions: new Dictionary<string, object?> { ["traceId"] = Activity.Current?.Id }
        ).ExecuteAsync(ctx);

        return true;
    }
}`,
    tags: ["error handling", "problemdetails", "iexceptionhandler", "rfc7807"],
  },
  {
    id: "net2-health-checks",
    topic: "dotnet",
    subtopic: "Operations",
    level: "intermediate",
    question: "How should health checks be designed?",
    answer: `Two distinct probes, and conflating them causes outages:

- **Liveness** — is the process healthy enough to keep running? Must **not** check dependencies: if the database is down and liveness fails, the orchestrator restarts every pod, turning a dependency outage into a full outage.
- **Readiness** — can it serve traffic *right now*? Checks critical dependencies, so a pod is removed from rotation while it warms up or loses its database.

Keep checks cheap and time-limited. A health endpoint that runs a heavy query becomes a self-inflicted load test at every probe interval.`,
    language: "csharp",
    code: `builder.Services.AddHealthChecks()
    .AddCheck("self", () => HealthCheckResult.Healthy(), tags: ["live"])
    .AddSqlServer(connectionString, name: "sql", tags: ["ready"])
    .AddRedis(redisConnection, name: "redis", tags: ["ready"]);

app.MapHealthChecks("/health/live",  new() { Predicate = c => c.Tags.Contains("live") });
app.MapHealthChecks("/health/ready", new() { Predicate = c => c.Tags.Contains("ready") });`,
    tags: ["health checks", "liveness", "readiness", "kubernetes"],
  },
  {
    id: "net2-signalr",
    topic: "dotnet",
    subtopic: "Real-time",
    level: "intermediate",
    question: "What does SignalR give you over raw WebSockets?",
    answer: `- **Transport fallback** — WebSockets where available, Server-Sent Events or long polling otherwise, negotiated automatically.
- **RPC-style hubs** — call client methods by name with typed arguments, rather than hand-rolling a message envelope.
- **Groups and users** — broadcast to a logical set without tracking connections yourself.
- **Backplane** — Redis or Azure SignalR Service so a message sent on one server reaches connections held by another. This is the part people forget when scaling out.
- **Reconnection** with state.

The cost is a protocol only SignalR clients speak, which matters if third parties must connect.`,
    language: "csharp",
    code: `public class OrdersHub : Hub
{
    public Task Subscribe(string customerId) =>
        Groups.AddToGroupAsync(Context.ConnectionId, $"customer:{customerId}");
}

// From anywhere in the app
await _hub.Clients.Group($"customer:{id}").SendAsync("OrderShipped", new { orderId });

// Scale-out: without this, only clients on the same server receive it
builder.Services.AddSignalR().AddStackExchangeRedis(redisConnection);`,
    tags: ["signalr", "websocket", "backplane", "real-time", "scale-out"],
  },
  {
    id: "net2-performance-profiling",
    topic: "dotnet",
    subtopic: "Performance",
    level: "advanced",
    question: "An endpoint is slow. How do you find out why in .NET?",
    answer: `1. **Confirm where the time goes** — Application Insights end-to-end view, or the dependency durations in a trace. Most "slow code" is a slow query or a remote call.
2. **Measure, do not guess** — \`dotnet-counters\` for live counters (GC, thread pool queue, exceptions/sec), \`dotnet-trace\` for a CPU profile, \`dotnet-gcdump\`/\`dotnet-dump\` for memory.
3. **Common causes**: N+1 queries, missing index, sync-over-async starving the pool, excessive allocations causing Gen 2 collections, chatty HTTP calls in a loop, serialising huge payloads.
4. **Benchmark the fix** with BenchmarkDotNet if it is CPU-bound, not with a stopwatch in Debug.`,
    language: "bash",
    code: `dotnet-counters monitor -p <pid> System.Runtime Microsoft.AspNetCore.Hosting
# watch: ThreadPool Queue Length, Gen 2 GC count, Exception Count, Requests/sec

dotnet-trace collect -p <pid> --profile cpu-sampling
dotnet-gcdump collect -p <pid>     # then compare two dumps for growth`,
    tags: ["profiling", "dotnet-counters", "benchmarkdotnet", "performance"],
  },
  {
    id: "net2-blazor",
    topic: "dotnet",
    subtopic: "Web",
    level: "basic",
    question: "Blazor Server vs Blazor WebAssembly?",
    answer: `- **Blazor Server** — the component runs on the server; the browser holds a SignalR connection and receives DOM diffs. Tiny download, full .NET on the server, immediate access to the database. Costs: a live connection per user (memory and scale), latency on every interaction, and it stops working offline.
- **Blazor WebAssembly** — the app downloads the .NET runtime and runs in the browser. Works offline, scales like static files, no per-user server state. Costs: larger initial download, slower startup, and the browser cannot hold secrets or touch the database directly.
- **Blazor United (.NET 8)** — render modes per component, mixing both plus static server rendering.

Choose Server for internal line-of-business apps on a good network; WebAssembly for public apps and offline capability.`,
    tags: ["blazor", "webassembly", "signalr", "rendering"],
  },
  {
    id: "net2-source-generators",
    topic: "dotnet",
    subtopic: "Runtime",
    level: "advanced",
    question: "What are source generators and where do they help?",
    answer: `They run during compilation and add C# source to the compilation — no reflection at runtime, no build steps of your own.

Real uses you have probably already consumed: \`System.Text.Json\` serialisation contexts, \`LoggerMessage\` for allocation-free logging, regex source generation, and \`ObservableProperty\` in MVVM toolkits.

The payoff is startup time, throughput and AOT compatibility — reflection is the main thing that stops an app being trimmed or published Native AOT.`,
    language: "csharp",
    code: `// Generated logging: no boxing, no format parsing at runtime
public static partial class Log
{
    [LoggerMessage(Level = LogLevel.Warning, Message = "Retry {Attempt} for {Url}")]
    public static partial void Retrying(ILogger logger, int attempt, string url);
}

// Compile-time regex, no runtime parse or IL emit
[GeneratedRegex(@"^\\d{6}$")]
private static partial Regex PinCode();`,
    tags: ["source generator", "aot", "loggermessage", "performance"],
  },
];

export const AZURE_EXTRA: Question[] = [
  {
    id: "az2-function-triggers",
    topic: "azure",
    subtopic: "Compute",
    level: "intermediate",
    question: "What triggers and bindings do Azure Functions support, and what are the gotchas?",
    answer: `Triggers: HTTP, Timer, Queue/Blob/Table Storage, Service Bus, Event Hub, Event Grid, Cosmos DB change feed, Durable orchestrations.

Gotchas that come up in interviews:

- **At-least-once** for queue triggers, so handlers must be idempotent.
- **Poison queues** — after five failures the message moves to \`<queue>-poison\`; nothing drains it unless you build that.
- **Blob trigger latency** — polling-based and can take minutes on the Consumption plan; use Event Grid triggers for prompt reaction.
- **Cold start** on Consumption; Premium or Always-On avoids it.
- **Scale-out means concurrency** — a Function scaled to 100 instances can overwhelm a database that only tolerates 50 connections.`,
    language: "csharp",
    code: `[Function("ProcessOrder")]
public async Task Run(
    [ServiceBusTrigger("orders", Connection = "sb")] ServiceBusReceivedMessage message,
    FunctionContext context)
{
    var order = message.Body.ToObjectFromJson<OrderPlaced>();
    // MessageId is stable across redeliveries — use it for idempotency
    if (await _seen.AlreadyProcessedAsync(message.MessageId)) return;
    await _handler.HandleAsync(order);
}`,
    tags: ["azure functions", "triggers", "poison queue", "idempotency", "cold start"],
  },
  {
    id: "az2-durable-functions",
    topic: "azure",
    subtopic: "Compute",
    level: "advanced",
    question: "What problem do Durable Functions solve?",
    answer: `They give **stateful, long-running workflows** on a serverless platform: the orchestrator's progress is checkpointed, so it can wait hours for a human approval or an external event without holding a running instance.

Patterns: function chaining, fan-out/fan-in, async HTTP API with a status endpoint, human interaction with timeout, and eternal orchestrations.

The constraint people fail to mention: orchestrator code must be **deterministic** — it is replayed from history on every resume. No \`DateTime.Now\`, no \`Guid.NewGuid()\`, no direct I/O, no random. Use the context's equivalents; do all real work in activity functions.`,
    language: "csharp",
    code: `[Function(nameof(OrderOrchestrator))]
public static async Task<string> Run([OrchestrationTrigger] TaskOrchestrationContext context)
{
    var order = context.GetInput<Order>()!;

    await context.CallActivityAsync("ReserveStock", order);

    // Deterministic time and timers, because this code is replayed
    var deadline = context.CurrentUtcDateTime.AddHours(24);
    var approval = context.WaitForExternalEvent<bool>("Approved");
    var timer = context.CreateTimer(deadline, CancellationToken.None);

    if (approval == await Task.WhenAny(approval, timer))
        return await context.CallActivityAsync<string>("Ship", order);

    await context.CallActivityAsync("ReleaseStock", order);   // compensate
    return "expired";
}`,
    tags: ["durable functions", "orchestration", "determinism", "saga"],
  },
  {
    id: "az2-cosmos-partition",
    topic: "azure",
    subtopic: "Storage",
    level: "advanced",
    question: "How do you choose a Cosmos DB partition key?",
    answer: `The single most consequential decision, and it cannot be changed on an existing container.

A good key:

1. **Spreads writes evenly** — high cardinality, no dominant value.
2. **Matches the common query filter**, so reads stay in one partition instead of fanning out.
3. **Keeps a logical partition under 20 GB** — the hard limit.

Bad keys: a country code (skew), a boolean (two partitions), a timestamp for write-heavy data (all writes land in today's partition).

If reads and writes want different keys, duplicate the data into a second container with the other key — cheaper than cross-partition fan-out at scale.

**RU/s** is the currency: every operation costs request units, and a cross-partition query costs many.`,
    followUps: [
      {
        question: "What is a synthetic partition key?",
        answer: "Concatenating fields (`tenantId-yyyyMM`) to raise cardinality or bound partition size. It fixes both skew and the 20 GB limit at the cost of slightly more complex queries.",
      },
    ],
    tags: ["cosmos db", "partition key", "ru", "hot partition"],
  },
  {
    id: "az2-storage-lifecycle",
    topic: "azure",
    subtopic: "Storage",
    level: "basic",
    question: "How do you control Blob Storage costs?",
    answer: `- **Access tiers** — Hot (frequent), Cool (30 days+), Cold (90 days+), Archive (180 days+, retrieval takes hours). Price falls, retrieval cost and latency rise.
- **Lifecycle management rules** move blobs between tiers or delete them automatically by age or last access.
- **Redundancy** — LRS is cheapest; ZRS, GRS and RA-GRS cost more for zone or region protection. Do not buy GRS for data you can regenerate.
- **Soft delete and versioning** protect against mistakes but keep paying for the old bytes; set a retention window.
- Delete **incomplete multipart uploads**, which are invisible in the portal but billed.`,
    tags: ["blob storage", "tiers", "lifecycle", "cost", "redundancy"],
  },
  {
    id: "az2-apim",
    topic: "azure",
    subtopic: "Integration",
    level: "intermediate",
    question: "What does API Management add in front of your APIs?",
    answer: `A policy layer between clients and backends:

- **Security** — validate JWTs, IP filtering, subscription keys, mutual TLS, hide backend URLs.
- **Traffic control** — rate limits and quotas per product or subscription, throttling per key.
- **Transformation** — rewrite URLs, headers and payloads; expose a stable contract while backends change.
- **Caching** at the gateway.
- **Versioning and revisions** with a developer portal.

The trade: another hop, another thing to configure and pay for, and policy logic that lives outside your repository unless you manage it as code.`,
    language: "text",
    code: `<inbound>
  <validate-jwt header-name="Authorization" failed-validation-httpcode="401">
    <openid-config url="https://login.microsoftonline.com/{tenant}/v2.0/.well-known/openid-configuration" />
    <required-claims><claim name="aud"><value>api://orders</value></claim></required-claims>
  </validate-jwt>
  <rate-limit-by-key calls="100" renewal-period="60" counter-key="@(context.Subscription.Id)" />
  <set-header name="X-Correlation-Id" exists-action="skip">
    <value>@(Guid.NewGuid().ToString())</value>
  </set-header>
</inbound>`,
    tags: ["api management", "gateway", "rate limit", "jwt", "policies"],
  },
  {
    id: "az2-redis-cache",
    topic: "azure",
    subtopic: "Data",
    level: "intermediate",
    question: "What should you watch for when using Azure Cache for Redis?",
    answer: `- **It is a shared, single-threaded server** — one \`KEYS *\` or a huge \`HGETALL\` blocks every other client. Use \`SCAN\`, and keep values small.
- **Connection multiplexer is expensive**: create one \`ConnectionMultiplexer\` per application and reuse it. Creating one per request is the classic outage.
- **Timeouts under load** usually mean thread pool starvation on the *client*, not a slow Redis.
- **Eviction policy** — set \`maxmemory-policy\` deliberately (\`allkeys-lru\` for a cache; \`noeviction\` will start refusing writes).
- **Persistence and failover** — a standard tier failover drops connections; the client must retry.
- Do not treat it as a database: it is a cache unless you have accepted the durability trade.`,
    language: "csharp",
    code: `// One multiplexer, shared, thread-safe
builder.Services.AddSingleton<IConnectionMultiplexer>(_ =>
    ConnectionMultiplexer.Connect(new ConfigurationOptions
    {
        EndPoints = { "cache.redis.cache.windows.net:6380" },
        Ssl = true,
        AbortOnConnectFail = false,          // keep retrying rather than failing at startup
        ConnectRetry = 3
    }));`,
    tags: ["redis", "cache", "multiplexer", "eviction", "timeouts"],
  },
  {
    id: "az2-multi-region",
    topic: "azure",
    subtopic: "Reliability",
    level: "advanced",
    question: "How would you make a service survive a region outage?",
    answer: `Decide the target first — RTO and RPO drive the cost.

- **Active-passive** — deploy to a second region, replicate data (geo-replication, Cosmos multi-region, SQL failover groups), keep it warm. Front Door or Traffic Manager fails over on health. Cheaper; failover takes minutes and needs practice.
- **Active-active** — both regions serve traffic. Near-zero failover, but you must solve write conflicts, data residency and cross-region latency.

Everything stateful needs a plan: database replication and failover, storage redundancy (RA-GRS/GZRS), queue contents, cache warm-up, and DNS TTLs low enough to actually move traffic.

Then **test it** — an untested failover plan is a hypothesis.`,
    tags: ["multi-region", "failover", "front door", "rpo", "rto"],
  },
  {
    id: "az2-cost-management",
    topic: "azure",
    subtopic: "Operations",
    level: "intermediate",
    question: "How do you keep Azure costs under control?",
    answer: `- **Tag everything** by owner, environment and cost centre, so spend can be attributed at all.
- **Right-size** — most over-spend is oversized App Service plans, SQL tiers bought for a peak that never comes, and dev environments running at night.
- **Reserved instances / savings plans** for steady workloads: substantial discount for a commitment.
- **Autoscale down**, and stop non-production resources out of hours.
- **Watch egress and cross-region traffic** — easy to build a chatty architecture that pays per byte.
- **Budgets and alerts** at subscription and resource-group level, plus Advisor recommendations.
- **Log volume** is a frequent surprise: sampling and retention settings on App Insights matter.`,
    tags: ["cost", "tagging", "reserved instances", "budgets", "finops"],
  },
  {
    id: "az2-blue-green",
    topic: "azure",
    subtopic: "DevOps",
    level: "intermediate",
    question: "How do you deploy without downtime on Azure?",
    answer: `- **Deployment slots** (App Service) — deploy to staging, warm it up, run smoke tests, then **swap**. The swap is a routing change, and swapping back is the rollback.
- **Blue/green** — two environments, switch traffic at Front Door or Traffic Manager.
- **Canary / traffic splitting** — send 5% to the new version, watch error rate and latency, ramp up. Container Apps and Front Door support weighted routing.
- **Feature flags** — deploy the code dark and enable it separately, which decouples release from deploy entirely.

For all of them: migrations must be backward compatible, and the app must tolerate both versions running at once.`,
    followUps: [
      {
        question: "Why warm up the slot before swapping?",
        answer: "The first requests pay JIT, cache and connection-pool startup. Swapping cold moves that cost onto real users, which looks exactly like a failed deployment.",
      },
    ],
    tags: ["deployment", "slots", "blue green", "canary", "feature flags"],
  },
  {
    id: "az2-entra-oauth",
    topic: "azure",
    subtopic: "Identity",
    level: "advanced",
    question: "Which OAuth 2.0 flow do you use for what?",
    answer: `- **Authorization Code + PKCE** — anything with a user: web apps, SPAs, mobile. PKCE replaces the client secret for public clients.
- **Client Credentials** — service to service, no user. The daemon/background job flow.
- **On-Behalf-Of** — an API calling another API *as the signed-in user*, exchanging the incoming token for a downstream one.
- **Device Code** — input-constrained devices (CLI, TV).
- **Implicit and ROPC** — deprecated; mention them only to say you would not use them.

Related detail worth knowing: **access token** for calling APIs, **ID token** for authenticating the user in the client, **refresh token** to get new access tokens without re-prompting.`,
    diagram: `On-Behalf-Of

 User -> [SPA] --access token (aud: API-A)--> [API A]
                                               |  exchange token
                                               v
                                            [Entra ID]
                                               |  new token (aud: API-B)
                                               v
                                            [API B]   <- still knows who the user is`,
    tags: ["oauth", "entra id", "pkce", "on-behalf-of", "tokens"],
  },
  {
    id: "az2-storage-queue-scaling",
    topic: "azure",
    subtopic: "Messaging",
    level: "intermediate",
    question: "How does Service Bus handle competing consumers and locks?",
    answer: `A message received in PeekLock mode is invisible to other consumers for the **lock duration** (30 s default, renewable). Then:

- **Complete** — removed.
- **Abandon** — released immediately, delivery count increments.
- **Dead-letter** — moved to the DLQ.
- **Lock expiry** — the message reappears, and if your handler is still working, a second consumer processes it concurrently. That is the subtle bug: slow handlers cause duplicate processing.

So either keep handlers shorter than the lock, renew the lock (\`MaxAutoLockRenewalDuration\`), or make handlers idempotent — usually all three.`,
    language: "csharp",
    code: `var options = new ServiceBusProcessorOptions
{
    MaxConcurrentCalls = 10,
    PrefetchCount = 20,
    AutoCompleteMessages = false,
    MaxAutoLockRenewalDuration = TimeSpan.FromMinutes(5)   // long handlers keep their lock
};`,
    tags: ["service bus", "peeklock", "lock duration", "competing consumers"],
  },
  {
    id: "az2-infrastructure-as-code",
    topic: "azure",
    subtopic: "DevOps",
    level: "intermediate",
    question: "Why infrastructure as code, and Bicep or Terraform?",
    answer: `IaC makes environments reproducible, reviewable and recoverable. Clicking in the portal produces infrastructure nobody can recreate after an incident.

- **Bicep** — Azure-native, no state file (ARM tracks it), day-one support for new resource types, simple for Azure-only estates.
- **Terraform** — multi-cloud, a large provider ecosystem, an explicit state file that must be stored and locked remotely, and a strong plan/apply workflow.

Either way: modules for reuse, one parameter file per environment, plan output reviewed in the pull request, and no manual portal changes — drift is what makes IaC stop being true.`,
    tags: ["iac", "bicep", "terraform", "arm", "drift"],
  },
];
