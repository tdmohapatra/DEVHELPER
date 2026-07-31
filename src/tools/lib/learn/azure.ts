import type { Question } from "./types";

/** Azure questions for a .NET backend role: hosting, storage, messaging, identity, ops. */
export const AZURE_QUESTIONS: Question[] = [
  {
    id: "az-compute-choice",
    topic: "azure",
    subtopic: "Compute",
    level: "intermediate",
    mustKnow: true,
    question: "How do you choose between App Service, Functions, Container Apps and AKS?",
    answer: `Pick the least infrastructure that meets the requirement.

- **App Service** — a standard web app or API. Managed OS, easy slots, autoscale, custom domains. The default for a .NET web app.
- **Azure Functions** — event-driven and short-lived: queue triggers, timers, webhooks. Consumption plan scales to zero, but has cold starts and an execution time limit; Premium removes both.
- **Container Apps** — containers with autoscaling (including scale-to-zero via KEDA) and built-in ingress, without running Kubernetes. Good middle ground for microservices.
- **AKS** — full Kubernetes. Choose it when you genuinely need the control: custom networking, operators, service mesh, multi-tenant clusters. It brings real operational cost.

The interview answer they want: justify with requirements — traffic shape, cold-start tolerance, ops capacity — not with preference.`,
    diagram: `Control / effort                                    Managed / less effort
   AKS  <---  Container Apps  <---  App Service  <---  Functions
   |               |                     |                |
 full k8s      containers +          web apps,        event-driven,
 control       autoscale             slots, easy      scale to zero`,
    followUps: [
      {
        question: "What is a cold start and how do you mitigate it?",
        answer:
          "The delay when a scaled-to-zero instance must start before serving. Mitigate with the Premium plan (pre-warmed instances), Always On for App Service, or keeping a minimum replica count in Container Apps.",
      },
      {
        question: "How do deployment slots help?",
        answer:
          "Deploy to a staging slot, warm it, verify, then swap — the swap is near-instant and reversible. Slot-sticky settings keep environment-specific configuration attached to the slot rather than the code.",
      },
    ],
    tags: ["app service", "functions", "container apps", "aks", "compute"],
  },
  {
    id: "az-managed-identity",
    topic: "azure",
    subtopic: "Identity",
    level: "intermediate",
    mustKnow: true,
    question: "What is a managed identity and why is it better than a connection string?",
    answer: `A managed identity is a service principal Azure creates and rotates for your resource. Your code asks the platform for a token — there is **no secret in configuration at all**, so nothing to leak, rotate or check into git.

- **System-assigned** — tied to one resource, deleted with it.
- **User-assigned** — a standalone identity shared by several resources; survives redeployment.

\`DefaultAzureCredential\` makes this work identically in development (your Azure CLI or Visual Studio login) and in production (the managed identity), with no code change.`,
    language: "csharp",
    code: `// No keys anywhere: the platform issues the token
var credential = new DefaultAzureCredential();

var blob = new BlobServiceClient(new Uri("https://acct.blob.core.windows.net"), credential);
var secrets = new SecretClient(new Uri("https://kv.vault.azure.net/"), credential);

// SQL with Entra authentication — also no password
// Server=tcp:srv.database.windows.net;Database=app;Authentication=Active Directory Default;

// Grant it with RBAC, not with a key:
// az role assignment create --assignee <identity-id> \\
//    --role "Storage Blob Data Contributor" --scope <storage-resource-id>`,
    followUps: [
      {
        question: "What if the app must run outside Azure too?",
        answer:
          "`DefaultAzureCredential` falls back through a chain — environment variables, workload identity, managed identity, CLI, Visual Studio. On-premises you can supply a client secret or certificate through the environment without changing code.",
      },
      {
        question: "Key Vault or App Configuration?",
        answer:
          "Key Vault for secrets, certificates and keys, with access controlled by RBAC and audited. App Configuration for non-secret settings and feature flags, with labels per environment. They are often used together, with App Configuration holding Key Vault references.",
      },
    ],
    tags: ["managed identity", "key vault", "rbac", "security", "defaultazurecredential"],
  },
  {
    id: "az-storage-options",
    topic: "azure",
    subtopic: "Storage",
    level: "intermediate",
    question: "Blob, Table, Queue, File, Cosmos DB, SQL Database — which one?",
    answer: `- **Blob** — unstructured files: images, documents, backups, logs. Tiers hot/cool/cold/archive trade price against retrieval latency.
- **Queue Storage** — simple FIFO-ish queue, at-least-once, 7-day default TTL. Cheap; fewer features than Service Bus.
- **Table Storage** — cheap key-value at scale, partition key + row key. Superseded by Cosmos DB Table API for new work.
- **File Share** — SMB mount for lift-and-shift applications expecting a file system.
- **Azure SQL Database** — relational, transactions, joins; the default for line-of-business data.
- **Cosmos DB** — global distribution, single-digit ms reads, five consistency levels; expensive if the partition key is wrong.

The Cosmos question is really about **partition key** choice: it must spread load evenly *and* match how you query, or you get hot partitions and cross-partition fan-out.`,
    followUps: [
      {
        question: "What are the Cosmos DB consistency levels?",
        answer:
          "Strong, Bounded Staleness, Session, Consistent Prefix, Eventual. Session is the default and usually the right trade: a client reads its own writes, without the cost of global strong consistency.",
      },
      {
        question: "How do you give a client temporary access to one blob?",
        answer:
          "A user-delegation SAS: short-lived, scoped to the blob and permission, signed with an Entra credential rather than the account key.",
      },
    ],
    tags: ["blob", "cosmos", "storage", "sas", "partition key"],
  },
  {
    id: "az-service-bus-vs-queue",
    topic: "azure",
    subtopic: "Messaging",
    level: "intermediate",
    mustKnow: true,
    question: "Service Bus vs Storage Queue vs Event Hub vs Event Grid?",
    answer: `- **Storage Queue** — simplest queue, at-least-once, no ordering guarantee, no topics. Cheap and fine for basic work offloading.
- **Service Bus** — enterprise messaging: topics/subscriptions, sessions (FIFO per session), dead-letter queues, duplicate detection, transactions, scheduled delivery. The default for commands between services.
- **Event Hubs** — high-throughput event *streaming* (millions/sec), partitioned log, consumers track offsets and can replay. Telemetry and ingestion pipelines.
- **Event Grid** — reactive event *routing* with push delivery and retries. React to "blob created", "resource changed"; near-instant, low volume per event.

The shape of the question: **commands to one handler → Service Bus. Streams for many readers → Event Hubs. Discrete notifications → Event Grid.**`,
    diagram: `Command  ->  [ Service Bus queue ]  ->  one handler (competing consumers)

Event    ->  [ Service Bus topic ]  -+-> subscription A (filtered)
                                      +-> subscription B

Stream   ->  [ Event Hub partitions ] -> consumer group 1 (offset)
                                       -> consumer group 2 (replay independently)`,
    followUps: [
      {
        question: "How does the dead-letter queue work in Service Bus?",
        answer:
          "A message that exceeds max delivery count, expires, or is explicitly dead-lettered moves to a sub-queue. Nothing drains it automatically — you need a process and an alert, or failures accumulate silently.",
      },
      {
        question: "How do you get ordered processing?",
        answer:
          "Service Bus sessions: messages with the same session id go to one consumer in order. In Event Hubs, ordering is per partition, so choose a partition key that groups what must stay ordered.",
      },
    ],
    tags: ["service bus", "event hub", "event grid", "queue", "messaging"],
  },
  {
    id: "az-app-config-secrets",
    topic: "azure",
    subtopic: "Operations",
    level: "basic",
    question: "How should configuration and secrets be handled across environments?",
    answer: `1. **Never in source control.** \`appsettings.json\` holds defaults and non-secrets only.
2. **Local development** — .NET user secrets, outside the repository.
3. **Deployed** — App Service configuration/environment variables for plain settings, Key Vault for secrets, referenced rather than copied.
4. **Feature flags** — App Configuration, so behaviour changes without redeploying.
5. **Rotate** — with managed identity there is usually nothing to rotate, which is the point.

Naming: environment variables use \`__\` for nesting (\`ConnectionStrings__Default\`), which is how the same code reads JSON locally and env vars in production.`,
    language: "csharp",
    code: `// Key Vault joins the configuration chain; secrets look like ordinary settings
builder.Configuration.AddAzureKeyVault(
    new Uri($"https://{vaultName}.vault.azure.net/"),
    new DefaultAzureCredential());

var conn = builder.Configuration.GetConnectionString("Default");   // from Key Vault in prod

// A secret named ConnectionStrings--Default maps to ConnectionStrings:Default`,
    followUps: [
      {
        question: "A secret leaked into git history. What now?",
        answer:
          "Rotate it first — removing the commit does not un-leak it, since clones and forks persist. Then purge history if the repository is private and small, and move the secret into Key Vault.",
      },
    ],
    tags: ["configuration", "key vault", "secrets", "feature flags"],
  },
  {
    id: "az-scaling",
    topic: "azure",
    subtopic: "Operations",
    level: "intermediate",
    question: "How do you scale an Azure web application?",
    answer: `**Scale up** (bigger instance) helps a CPU- or memory-bound single request. **Scale out** (more instances) helps concurrency and is the usual answer.

Scale-out requires the app to be **stateless**: no in-process session, no local files, no in-memory cache assumed to be shared. Move session to Redis, files to Blob, and accept that \`IMemoryCache\` is per instance.

Autoscale rules should use a metric that reflects the queue of work — CPU, HTTP queue length, or messages pending — with a cooldown so instances do not flap.

Beyond compute: read replicas or elastic pools for the database, CDN for static content, and caching to remove load rather than absorb it.`,
    diagram: `             +-------------------+
Client ----> |  Front Door / LB  |
             +---------+---------+
                       |
        +--------------+--------------+
        |              |              |
   [instance 1]   [instance 2]   [instance 3]     <- stateless, add/remove freely
        \\              |              /
         +-------------+-------------+
                       |
              [ Redis ]   [ SQL + read replica ]   <- shared state lives here`,
    followUps: [
      {
        question: "What breaks first when you scale out a typical .NET app?",
        answer:
          "In-memory session and caches (users see inconsistent data), local file writes, background timers running on every instance, and database connection limits multiplying by instance count.",
      },
    ],
    tags: ["scaling", "autoscale", "stateless", "redis", "load balancing"],
  },
  {
    id: "az-monitoring",
    topic: "azure",
    subtopic: "Operations",
    level: "intermediate",
    question: "How do you monitor and diagnose an Azure application?",
    answer: `**Application Insights** for application telemetry: requests, dependencies, exceptions, traces, custom events, and the end-to-end transaction view that joins them by operation id.

**Azure Monitor / Log Analytics** for platform metrics and logs, queried with KQL.

What to actually set up:

- Alerts on **symptoms users feel** — error rate, p95 latency, queue depth — not on CPU alone.
- **Availability tests** hitting a real endpoint.
- **Sampling** configured deliberately, or telemetry cost outgrows the app.
- **Correlation** — the operation id flows through HTTP headers automatically; make sure background work continues the trace.`,
    language: "text",
    code: `// Failed requests by operation, last hour (KQL)
requests
| where timestamp > ago(1h) and success == false
| summarize failures = count(), p95 = percentile(duration, 95) by name
| order by failures desc

// Dependency failures — usually the real cause of an API's errors
dependencies
| where timestamp > ago(1h) and success == false
| summarize count() by target, type, resultCode`,
    followUps: [
      {
        question: "How do you find which dependency made a request slow?",
        answer:
          "Open the end-to-end transaction for a slow request in Application Insights: it shows every dependency call with its duration, so a 2 s SQL call inside a 2.1 s request is obvious.",
      },
    ],
    tags: ["application insights", "kql", "monitoring", "alerts", "correlation"],
  },
  {
    id: "az-resilience",
    topic: "azure",
    subtopic: "Reliability",
    level: "advanced",
    question: "How do you make a cloud service resilient to transient failures?",
    answer: `Assume every remote call can fail, be slow, or be duplicated.

- **Retry with exponential backoff and jitter** — retry only transient failures (timeouts, 429, 503). Never retry a 400.
- **Circuit breaker** — after repeated failures, fail fast for a while instead of queueing work against a dead dependency.
- **Timeout** — every outbound call needs one; without it a slow dependency exhausts your threads.
- **Bulkhead** — cap concurrency per dependency so one slow service cannot consume the whole pool.
- **Idempotency** — retries mean the same message may arrive twice; make handlers safe to repeat.
- **Fallback** — degraded but useful (cached data, a default) beats an error page.

In .NET this is \`Microsoft.Extensions.Http.Resilience\` (Polly) wired into the HTTP client.`,
    language: "csharp",
    code: `builder.Services.AddHttpClient<PricingClient>(c => c.BaseAddress = new Uri(url))
    .AddStandardResilienceHandler(o =>
    {
        o.Retry.MaxRetryAttempts = 3;
        o.Retry.BackoffType = DelayBackoffType.Exponential;
        o.Retry.UseJitter = true;                     // avoids a synchronised retry storm
        o.AttemptTimeout.Timeout = TimeSpan.FromSeconds(5);
        o.CircuitBreaker.FailureRatio = 0.5;
        o.CircuitBreaker.MinimumThroughput = 10;
    });`,
    followUps: [
      {
        question: "Why does jitter matter?",
        answer:
          "Without it, every client that failed at the same moment retries at the same moment, producing a synchronised thundering herd that keeps the recovering service down.",
      },
      {
        question: "What is a retry storm and how do you avoid amplifying it?",
        answer:
          "Retries at several layers multiply: 3 retries at three layers is 27 calls. Retry at one layer, and let failures propagate quickly elsewhere.",
      },
    ],
    tags: ["resilience", "retry", "circuit breaker", "polly", "timeout"],
  },
  {
    id: "az-devops-pipeline",
    topic: "azure",
    subtopic: "DevOps",
    level: "intermediate",
    question: "What does a good CI/CD pipeline for a .NET service look like?",
    answer: `**CI** — on every push: restore, build with warnings as errors, run unit tests, run integration tests against a container, static analysis and dependency scanning, then publish a versioned artifact (or image) **once**.

**CD** — promote that same artifact through environments. Never rebuild per environment; configuration comes from the environment, not the build.

Deployment safety: staging slot + swap, or blue/green; run database migrations as a separate, backward-compatible step *before* the code that needs them; smoke test after deploy; keep a rollback that is one click.`,
    language: "yaml",
    code: `trigger: [main]

stages:
- stage: build
  jobs:
  - job: ci
    steps:
    - task: UseDotNet@2
      inputs: { version: '8.x' }
    - script: dotnet build -warnaserror -c Release
    - script: dotnet test --no-build -c Release --collect:"XPlat Code Coverage"
    - publish: $(Build.ArtifactStagingDirectory)   # the single artifact
      artifact: app

- stage: deploy_staging
  dependsOn: build
  jobs:
  - deployment: staging
    environment: staging          # approvals and checks attach here
    strategy:
      runOnce:
        deploy:
          steps:
          - script: dotnet ef database update      # expand-only migration
          - task: AzureWebApp@1
            inputs: { appName: 'orders-api', deployToSlotOrASE: true, slotName: 'staging' }`,
    followUps: [
      {
        question: "Where do database migrations belong in the pipeline?",
        answer:
          "A separate step before the application deploy, and only additive changes, so the currently running version keeps working. Destructive changes go in a later release once no old code remains.",
      },
    ],
    tags: ["ci/cd", "azure devops", "pipeline", "deployment", "migrations"],
  },
  {
    id: "az-networking-basics",
    topic: "azure",
    subtopic: "Networking",
    level: "advanced",
    question: "How do you keep Azure services off the public internet?",
    answer: `- **Private Endpoint** — gives a PaaS resource (SQL, Storage, Key Vault) a private IP inside your VNet; traffic never leaves the Microsoft backbone. Combine with disabling public network access.
- **Service Endpoint** — older, cheaper: keeps traffic on the backbone and lets the resource firewall trust a subnet, but the resource keeps its public IP.
- **VNet integration** — lets App Service or Functions make outbound calls into the VNet.
- **NSG / firewall rules** — restrict by subnet and port.
- **Front Door / Application Gateway with WAF** — the public entry point, with TLS termination and OWASP rules.

Also remember DNS: a private endpoint needs a private DNS zone, or the name still resolves to the public IP and the connection fails confusingly.`,
    followUps: [
      {
        question: "Private endpoint or service endpoint?",
        answer:
          "Private endpoint when you want the resource unreachable publicly and addressable privately, including from on-premises over VPN/ExpressRoute. Service endpoint when a subnet-level firewall rule is enough and cost matters.",
      },
    ],
    tags: ["networking", "private endpoint", "vnet", "waf", "security"],
  },
];
