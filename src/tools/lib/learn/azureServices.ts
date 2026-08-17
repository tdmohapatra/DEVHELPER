/**
 * The fifteen Azure services this kind of system is actually built from.
 *
 * The existing Azure deck covers concepts. This one is service by service, and
 * written to the question that gets asked in an interview and again on the job:
 * not "what is Key Vault" but "what does it change about your deployment, and
 * what goes wrong".
 */

import type { Question } from "./types";

export const AZURE_SERVICE_QUESTIONS: Question[] = [
  {
    id: "az-key-vault",
    topic: "azure",
    subtopic: "Identity",
    level: "intermediate",
    mustKnow: true,
    question: "How should an application use Key Vault?",
    answer:
      "Key Vault holds three things: **secrets** (strings), **keys** (asymmetric, usable without ever being exported) and **certificates**. Access is by managed identity plus RBAC — never a secret used to fetch secrets.\n\nThe two patterns:\n\n- **Key Vault references.** App Service and Container Apps resolve `@Microsoft.KeyVault(SecretUri=...)` in app settings at startup. The application code sees an ordinary configuration value and knows nothing about the vault. This is the right default.\n- **The SDK**, when you need to fetch at runtime — a rotating credential, or a secret chosen per tenant. Cache it, because the vault is rate-limited and a per-request fetch will hit the limit under load.\n\nWhat catches people:\n\n- **A reference is resolved at startup**, so rotating a secret needs a restart unless the app re-reads it.\n- **Soft delete and purge protection are on**, so a deleted vault name is reserved for days — which breaks a redeploy of the same infrastructure.\n- **Secrets are versioned.** Referencing without a version follows the latest; with a version, it pins. Pinning is safer for a deploy and worse for rotation.\n\nUse **keys**, not secrets, when the private material must never leave: signing and envelope encryption happen inside the vault.",
    followUps: [
      { question: "Where does a rotation actually break things?", answer: "Anywhere the old value was cached without a TTL, and anywhere two systems must be updated together. Design for both credentials being valid at once during a rotation window." },
    ],
    tags: ["key-vault", "secrets", "rotation", "configuration", "azure"],
    relatedTools: ["config-inspector", "environments"],
  },
  {
    id: "az-app-service",
    topic: "azure",
    subtopic: "Hosting",
    level: "basic",
    mustKnow: true,
    question: "What do you need to know about App Service to deploy safely?",
    answer:
      "- **Configuration precedence.** App settings *override* `appsettings.json`, and nested keys use `__` (`ConnectionStrings__Lab`). A setting you cannot find in the file is almost always here.\n- **Deployment slots.** Deploy to a staging slot, warm it, then swap. The swap is a routing change, so it is near-instant and reversible — swap back and you have rolled back.\n- **Slot-sticky settings.** Some settings must *not* travel with the swap (the slot's own connection string). Mark them sticky, or staging will point at production after the first swap.\n- **Always On.** Without it the app is unloaded when idle, and the first request after that pays the full cold start. Any app with a background service needs it.\n- **Health check path.** App Service will pull an unhealthy instance out of rotation, but only if you tell it what to call.\n- **Scale up vs out.** Up changes the plan tier; out adds instances. Out requires no instance-local state.\n\nThe most common production surprise is a swap that takes traffic before the app is warm. Warm the staging slot — hit it — before swapping.",
    followUps: [
      { question: "What breaks when you scale out?", answer: "In-memory caches, in-memory sessions, background jobs that assumed one instance, and any file written to local disk. Each becomes a distributed problem." },
    ],
    tags: ["app-service", "slots", "deployment", "configuration", "azure"],
    relatedTools: ["config-inspector"],
  },
  {
    id: "az-functions",
    topic: "azure",
    subtopic: "Hosting",
    level: "intermediate",
    question: "When is an Azure Function the right shape, and what are its traps?",
    answer:
      "Functions fit **event-shaped work**: a message arrives, a blob lands, a timer fires. Triggers and bindings remove the plumbing, and consumption billing means idle costs nothing.\n\nHosting plans, which is the decision that matters:\n\n- **Consumption** — scale to zero, cold starts, 5–10 minute execution cap, no VNet on the older plan.\n- **Premium** — pre-warmed instances, VNet integration, longer runs. The usual answer when a private endpoint is required, which in healthcare it usually is.\n- **App Service plan** — runs alongside an existing app on capacity you already pay for.\n\nTraps:\n\n- **Cold start** is a latency problem for anything user-facing and a *correctness* problem for a device host query that must answer in seconds.\n- **Scale-out fights your database.** A queue backlog can spawn a hundred instances and exhaust the connection pool. Cap `maxConcurrentCalls` and instance count.\n- **At-least-once** for queue triggers, so the handler must be idempotent. A poison message is retried and then dead-lettered — configure both.\n- **Use the isolated worker model** on .NET 8+. In-process is the legacy path.\n- **No shared state between invocations.** Static caches are per-instance and vanish unpredictably.",
    language: "csharp",
    code:
      "[Function(nameof(FileResult))]\npublic async Task FileResult(\n    [ServiceBusTrigger(\"results\", Connection = \"Bus\")] ServiceBusReceivedMessage message,\n    FunctionContext context)\n{\n    var result = message.Body.ToObjectFromJson<LabResult>();\n\n    // At-least-once: this must be safe to run twice for the same message.\n    await _store.UpsertAsync(result.FillerOrderNo, result.ObservationId, result);\n}\n\n// host.json: cap the fan-out so a backlog cannot exhaust the SQL connection pool\n// { \"extensions\": { \"serviceBus\": { \"maxConcurrentCalls\": 8 } } }",
    followUps: [
      { question: "Durable Functions — when?", answer: "When the work is a workflow with state: fan-out/fan-in, waiting for a human, or a saga with timeouts. It gives you orchestration without owning a scheduler." },
    ],
    tags: ["functions", "serverless", "triggers", "cold-start", "azure"],
  },
  {
    id: "az-service-bus",
    topic: "azure",
    subtopic: "Messaging",
    level: "intermediate",
    mustKnow: true,
    question: "Service Bus: queues, topics, sessions, peek-lock and dead-letter.",
    answer:
      "- **Queue** — one destination, competing consumers. **Topic + subscription** — one publish, many independent subscribers, each with its own filter and its own dead-letter queue.\n- **Peek-lock** (the default) — the message is invisible to others for a lock duration; you complete, abandon or dead-letter it. The lock **expires** if processing runs long, and the message reappears and is processed twice. Renew the lock for long work, or shorten the work.\n- **Sessions** give FIFO ordering *within a session id* and pin that session to one consumer. This is how you keep one patient's messages in order while processing different patients in parallel — the same idea as a Kafka partition key.\n- **Dead-letter queue** — automatic after max delivery attempts, on expiry, or explicitly with a reason. It is a real queue: browse it, fix, resubmit. A DLQ nobody monitors is a data-loss mechanism with extra steps.\n- **Duplicate detection** ignores repeat `MessageId`s within a window. Useful, not a substitute for an idempotent handler.\n- **Scheduled enqueue** delivers later, which is retry-with-backoff without a timer.\n\nPrefer Service Bus over Event Hubs when you want *work* semantics: per-message completion, DLQ, and ordering per session.",
    diagram:
      "  publisher ──▶ topic ─┬─ sub: emr        (filter: type = 'result')\n                       ├─ sub: billing    (filter: type = 'result')\n                       └─ sub: analytics  (all)\n                          each with its own DLQ\n\n  session id = patient 100234 ──▶ always the same consumer, in order",
    followUps: [
      { question: "What happens when the lock expires mid-processing?", answer: "Another consumer gets the message and does the work again. Renew the lock proactively, and make the handler idempotent so a race is harmless rather than a duplicate result." },
      { question: "Service Bus or Event Hubs?", answer: "Service Bus for commands and work with per-message handling; Event Hubs for high-volume telemetry streams you may want to replay." },
    ],
    tags: ["service-bus", "queues", "topics", "sessions", "dead-letter", "azure"],
    relatedTools: ["service-bus", "rabbitmq", "nats"],
  },
  {
    id: "az-event-hubs",
    topic: "azure",
    subtopic: "Messaging",
    level: "intermediate",
    question: "How do Event Hubs differ from Service Bus?",
    answer:
      "Event Hubs is a **log**, like Kafka. Service Bus is a **queue**.\n\n- Events are appended to **partitions** and kept for a retention period. Reading does not remove them — a consumer tracks its position with a **checkpoint** in storage.\n- A **consumer group** is an independent reader of the whole stream. Adding an analytics consumer does not disturb the existing one.\n- Throughput is measured in **throughput units** (or processing units on Premium), not messages.\n- There is **no per-message completion and no dead-letter**. If one event cannot be processed you either skip it, park it somewhere yourself, or stop the whole partition. That is the biggest practical difference.\n\nUse Event Hubs for device telemetry, audit streams and anything you may want to replay or feed to Stream Analytics. Use Service Bus when each message is a unit of work that must be individually completed, retried or dead-lettered.\n\nIt speaks the Kafka protocol, so a Kafka client can connect — useful when a component already exists.",
    followUps: [
      { question: "What happens if a consumer falls behind retention?", answer: "The events are gone. Alert on consumer lag against retention, not just on errors — this failure is silent until the data is unrecoverable." },
    ],
    tags: ["event-hubs", "streaming", "partitions", "checkpoint", "azure"],
  },
  {
    id: "az-sql",
    topic: "azure",
    subtopic: "Data",
    level: "intermediate",
    question: "What changes when SQL Server becomes Azure SQL?",
    answer:
      "- **Transient faults are normal.** The service moves your database between nodes for patching and failover, and your connection dies. Every connection needs retry — `EnableRetryOnFailure()` in EF Core, or Polly around ADO.NET. On-premises code that never retried will fail in Azure and look like a network problem.\n- **Sizing is DTU or vCore.** vCore is easier to reason about and lets you buy Hyperscale. Watch for **log rate** limits, not just CPU — a bulk insert that worked on a big server can be throttled by log throughput at a small tier.\n- **Elastic pools** share capacity across many small databases, which is the usual answer for database-per-tenant.\n- **No cross-database queries** the way you had them; treat each database as its own.\n- **Backups are automatic** with point-in-time restore, and restore creates a *new* database rather than overwriting.\n- **Auditing and Defender** are switches, and worth turning on for PHI.\n- **Private endpoint or firewall rules** — the default is a public endpoint, which is not what a hospital system should have.\n\nUse **Managed Instance** when you need SQL Agent, cross-database queries, CLR or Service Broker — the lift-and-shift path.",
    language: "csharp",
    code:
      "builder.Services.AddDbContext<LabContext>(o =>\n    o.UseSqlServer(connectionString, sql =>\n    {\n        // Not optional in Azure: nodes move, connections drop.\n        sql.EnableRetryOnFailure(maxRetryCount: 5,\n                                 maxRetryDelay: TimeSpan.FromSeconds(10),\n                                 errorNumbersToAdd: null);\n        sql.CommandTimeout(30);\n    }));",
    followUps: [
      { question: "Why can a retry not be wrapped around a transaction?", answer: "Because EF's execution strategy cannot retry a user-initiated transaction — it does not know how to redo the whole block. Wrap the transaction in the strategy explicitly with ExecuteAsync." },
    ],
    tags: ["azure-sql", "transient-faults", "retry", "elastic-pool", "azure"],
    relatedTools: ["database-toolkit"],
  },
  {
    id: "az-storage",
    topic: "azure",
    subtopic: "Data",
    level: "basic",
    question: "Blob storage: tiers, SAS tokens and lifecycle rules.",
    answer:
      "- **Tiers**: Hot (frequent), Cool (30 days+), Cold, Archive (offline, hours to rehydrate). Reading from Cool or Archive costs more, so a tier chosen for storage cost can cost more overall if the data is read.\n- **SAS tokens** grant time-boxed, scoped access to a blob without sharing the account key. Prefer a **user-delegation SAS**, signed with Entra credentials, so it can be revoked by removing the role — an account-key SAS can only be revoked by rotating the key, which breaks everything else.\n- **Lifecycle rules** move or delete blobs by age automatically. This is how retention policy becomes real rather than a document.\n- **Immutable storage** (WORM) with a time-based policy is how you satisfy a retention requirement that says the record cannot be altered.\n- **Soft delete and versioning** protect against the most common incident, which is your own code deleting the wrong thing.\n\nFor healthcare: private endpoint, no public access, encryption with a customer-managed key if the contract asks, and a SAS lifetime measured in minutes.",
    followUps: [
      { question: "How do you let a browser upload a large file safely?", answer: "Issue a short-lived, write-only user-delegation SAS for one blob path and let the client upload directly. Streaming it through your API wastes bandwidth and a request thread." },
    ],
    tags: ["blob", "storage", "sas", "lifecycle", "retention", "azure"],
  },
  {
    id: "az-app-insights",
    topic: "azure",
    subtopic: "Observability",
    level: "intermediate",
    mustKnow: true,
    question: "What does Application Insights give you, and how do you keep PHI out of it?",
    answer:
      "It collects **requests**, **dependencies** (SQL, HTTP, Service Bus calls), **exceptions**, **traces** (your logs) and **custom events/metrics**, and ties them together with an **operation id** — so one request and every downstream call it made are one view.\n\nWhat to do with it:\n\n- **Follow the operation id** to see the whole path. It flows automatically over HTTP via `traceparent`; check that it survives your queue hops, because that is where it usually breaks.\n- **Sampling** is on by default. Adaptive sampling drops successful telemetry under load, which is fine — but know that a count in the portal is an estimate, and `itemCount` is how you weight it back.\n- **Live Metrics** is unsampled, which makes it the right tool during a deployment.\n\nKeeping PHI out:\n\n- **Query strings and URL segments are captured**, so `/patients/100234` puts an MRN in telemetry. Use POST bodies or opaque ids for anything identifying.\n- **Exception messages** often contain the payload. Log ids and counts, never the record.\n- Add an **ITelemetryProcessor** to drop or mask what should not leave — and test it, because it is the only thing standing between a log statement and a compliance incident.",
    language: "kusto",
    code:
      "// Slowest dependencies for failing requests in the last hour\nrequests\n| where timestamp > ago(1h) and success == false\n| join kind=inner (dependencies | project operation_Id, target, name, duration) on operation_Id\n| summarize failures = count(), p95 = percentile(duration, 95) by target, name\n| order by failures desc",
    followUps: [
      { question: "Why is a count in the portal not exact?", answer: "Sampling. Multiply by itemCount to estimate the true figure, or turn sampling off for the specific telemetry you must count exactly." },
    ],
    tags: ["application-insights", "telemetry", "sampling", "phi", "azure"],
    relatedTools: ["kql-pad", "trace-explorer", "log-viewer"],
  },
  {
    id: "az-kql",
    topic: "azure",
    subtopic: "Observability",
    level: "intermediate",
    mustKnow: true,
    question: "Write a KQL query, and explain the pipeline model.",
    answer:
      "KQL is a **pipeline**: start with a table, pipe it through operators, each taking a table and returning one. Read it top to bottom.\n\nThe operators that cover most work:\n\n- `where` filter — **put the time filter first**, always; it is what makes the query cheap.\n- `project` / `extend` — choose and compute columns.\n- `summarize ... by ...` — aggregate. `bin(timestamp, 5m)` buckets time.\n- `join kind=inner|leftouter` — combine tables on a key.\n- `parse` — pull fields out of a text message.\n- `top`, `order by`, `render timechart`.\n\nThe habits that matter: filter before you join, aggregate before you render, and remember that string columns are case-sensitive unless you use `=~`.",
    language: "kusto",
    code:
      "// Result-filing rate per interface, five-minute buckets, with error rate\nlet window = 6h;\ntraces\n| where timestamp > ago(window)\n| where customDimensions.Category == \"ResultFiling\"\n| extend iface = tostring(customDimensions.Interface),\n         ok    = tobool(customDimensions.Filed)\n| summarize filed = countif(ok), failed = countif(not(ok))\n          by iface, bin(timestamp, 5m)\n| extend errorRate = todouble(failed) / (filed + failed)\n| order by timestamp desc\n| render timechart",
    followUps: [
      { question: "Why filter on time first?", answer: "Log Analytics partitions by time. A query without a time filter scans everything, costs accordingly, and may be refused." },
      { question: "How do you turn a query into an alert?", answer: "Save it as a log alert rule with a threshold and evaluation frequency. Alert on the symptom — filing rate at zero — rather than on CPU." },
    ],
    tags: ["kql", "log-analytics", "azure-monitor", "queries", "alerting"],
    relatedTools: ["kql-pad", "log-viewer"],
  },
  {
    id: "az-containers",
    topic: "azure",
    subtopic: "Hosting",
    level: "intermediate",
    question: "AKS or Container Apps — how do you choose?",
    answer:
      "**Container Apps** is managed Kubernetes with the Kubernetes taken away: deploy a container, get revisions, scale-to-zero, KEDA-based scaling on a queue length, Dapr if you want it, and ingress. You do not run a control plane, patch nodes or debug CNI.\n\n**AKS** is the real thing: your nodes, your cluster upgrades, your networking, your operators. You take it when you need what it gives — DaemonSets, custom operators, GPU nodes, service mesh, strict network policy, or a platform team that already runs clusters.\n\nThe honest rule: **choose Container Apps unless you can name the Kubernetes feature you need.** A cluster is a permanent operational commitment — upgrades every few months, node images, certificates — and one team running one cluster for three services is a bad trade.\n\nFor a device gateway there is a third answer worth remembering: it may need to run **on-premises**, inside the hospital network, because the devices are there. That is a container on a small server or IoT Edge, not a cloud service at all.",
    followUps: [
      { question: "What does KEDA do?", answer: "Scales on external signals — queue length, Kafka lag, cron — rather than only CPU. It is what makes scale-to-zero useful for a worker." },
    ],
    tags: ["aks", "container-apps", "kubernetes", "hosting", "azure"],
  },
  {
    id: "az-apim",
    topic: "azure",
    subtopic: "Integration",
    level: "intermediate",
    question: "What is API Management for, and what does a policy do?",
    answer:
      "APIM is a managed gateway in front of your APIs. Its value is the things you would otherwise build once per service: subscription keys, quotas and throttling, JWT validation, IP filtering, response caching, request and response transformation, mock responses, and a developer portal with generated documentation.\n\n**Policies** are the mechanism — an XML pipeline per API or operation, with `inbound`, `backend`, `outbound` and `on-error` stages. They run at the gateway, so a rule applies to every consumer without redeploying a service.\n\nWhere it earns its cost: exposing an API to *external* consumers — a partner lab, a hospital's integration team — where you need per-consumer keys, quotas and a contract. Where it does not: internal service-to-service traffic, which pays a hop for features it does not use.\n\nThe caution: policies are code that lives outside your repository unless you deliberately export them. Keep them in source control and deploy them with the API, or you will have production behaviour nobody can find.",
    language: "xml",
    code:
      "<inbound>\n  <validate-jwt header-name=\"Authorization\" failed-validation-httpcode=\"401\">\n    <openid-config url=\"https://login.microsoftonline.com/{tenant}/v2.0/.well-known/openid-configuration\" />\n    <audiences><audience>api://fhir-gateway</audience></audiences>\n    <required-claims>\n      <claim name=\"scp\" match=\"any\"><value>Observation.read</value></claim>\n    </required-claims>\n  </validate-jwt>\n  <rate-limit-by-key calls=\"100\" renewal-period=\"60\"\n                     counter-key=\"@(context.Subscription.Id)\" />\n  <set-header name=\"traceparent\" exists-action=\"skip\">\n    <value>@(context.RequestId.ToString())</value>\n  </set-header>\n</inbound>",
    followUps: [
      { question: "Should APIM hold business logic?", answer: "No, for the same reason a gateway should not: it becomes a component you cannot deploy independently and cannot test properly." },
    ],
    tags: ["apim", "gateway", "policies", "throttling", "azure"],
    relatedTools: ["api-tester"],
  },
  {
    id: "az-data-factory",
    topic: "azure",
    subtopic: "Data",
    level: "intermediate",
    question: "When is Data Factory the right tool rather than writing code?",
    answer:
      "Data Factory is managed ETL/ELT: **pipelines** of **activities**, run on an **integration runtime**, moving and transforming data on a schedule or a trigger.\n\nIt wins when the work is *movement with connectors* — pull from SFTP, an on-premises SQL Server, a REST API and a blob container, land it in a warehouse, on a schedule, with retries, monitoring and lineage you did not write.\n\nCode wins when the work is *logic*. Clinical mapping rules, terminology lookups, deduplication with domain rules — these belong in a tested service, not in a visual pipeline nobody can unit test.\n\nThe piece that matters in this domain: a **self-hosted integration runtime** runs inside the hospital network and pulls from systems that will never be exposed to the internet. That is often the only viable way to reach an on-premises LIS.\n\nThe honest failure mode: pipelines grow logic until they are an untestable, un-reviewable application. Keep transformation in code that a test can call, and let ADF do the moving.",
    followUps: [
      { question: "ADF or Synapse pipelines or Fabric?", answer: "Largely the same engine with different packaging. Choose by what the rest of the estate uses; the pipeline concepts transfer." },
    ],
    tags: ["data-factory", "etl", "integration-runtime", "pipelines", "azure"],
  },
  {
    id: "az-openai",
    topic: "azure",
    subtopic: "AI",
    level: "intermediate",
    question: "What is different about Azure OpenAI compared with calling a public API?",
    answer:
      "- **The data stays in your tenant and region**, is not used for training, and is covered by your existing agreements — which is what makes it usable with health data at all, subject to the same de-identification discipline.\n- **Deployments, not models.** You deploy a model under a name and call that name. Quota is per deployment, per region, measured in tokens per minute, and it is the thing that will limit you first.\n- **Content filters** run on input and output, and can block a legitimate clinical text — a note about self-harm, for example. You must handle a filtered response as a normal outcome, not an exception, and you can request adjusted filters for clinical use.\n- **Entra ID auth** with a managed identity, instead of an API key in configuration.\n- **Private endpoints**, so the traffic never leaves the virtual network.\n\nOperationally: handle `429` with backoff, watch token usage as a cost *and* a capacity metric, and pin the model version — a silent upgrade changes outputs, and your evaluation set is what tells you it happened.",
    followUps: [
      { question: "Does Azure OpenAI make it compliant for PHI?", answer: "It makes the platform acceptable. De-identification, minimum necessary, audit and the clinical-safety story are still yours." },
      { question: "Why pin the model version?", answer: "Because an upgrade changes behaviour underneath you. Pin, then move deliberately with an evaluation run to compare." },
    ],
    tags: ["azure-openai", "deployments", "quota", "content-filter", "azure"],
    relatedTools: ["healthcare-deidentifier"],
  },
  {
    id: "az-health-data-services",
    topic: "azure",
    subtopic: "Healthcare",
    level: "advanced",
    question: "What is Azure Health Data Services, and what does MedTech do?",
    answer:
      "A managed set of health-specific services in one workspace:\n\n- **FHIR service** — a managed FHIR R4 server with Entra auth, SMART on FHIR support, `$export` to storage, and versioned history. It removes the year you would otherwise spend building a compliant FHIR server.\n- **DICOM service** — DICOMweb (QIDO/WADO/STOW) over managed storage, so imaging is HTTP rather than the classic protocol.\n- **MedTech service** — device telemetry into FHIR Observations. You give it two mappings: a **device mapping** (how to read the incoming JSON — where the device id, timestamp and values are) and a **FHIR mapping** (how to shape the Observation, including the LOINC code). It ingests from Event Hubs.\n\nWhy MedTech matters here: it is exactly the device-to-record pipeline, as a managed service. Telemetry lands on Event Hubs, MedTech normalises and writes Observations, and the FHIR service serves them to applications.\n\nWhat you still own: getting data to Event Hubs in the first place — the gateway, the protocol translation, the buffering — and the mappings, which are where the clinical meaning lives.",
    diagram:
      "  device ──▶ gateway ──▶ Event Hubs ──▶ MedTech ──▶ FHIR service ──▶ app\n                            (yours)      device map     Observations\n                                         + FHIR map",
    followUps: [
      { question: "Is a managed FHIR server always right?", answer: "For storing and serving standard resources, usually. If your data does not fit FHIR resources or you need heavy custom query, a purpose-built store with a FHIR facade may serve better." },
    ],
    tags: ["health-data-services", "fhir", "medtech", "dicom", "azure"],
    relatedTools: ["fhir-toolkit", "device-link"],
  },
  {
    id: "az-networking",
    topic: "azure",
    subtopic: "Networking",
    level: "advanced",
    question: "Why does a healthcare deployment end up private, and what does that involve?",
    answer:
      "Because hospital security reviews do not accept PaaS services on public endpoints, and often will not accept data leaving a network boundary at all.\n\nWhat that means in practice:\n\n- **Private endpoints.** Each PaaS resource — SQL, Storage, Key Vault, Service Bus — gets a private IP inside your VNet. Its public endpoint is then disabled.\n- **Private DNS zones.** The service's hostname must resolve to the private IP. When it does not, the symptom is a connection that works from the portal and fails from the app — and the cause is DNS every time.\n- **VNet integration** for the compute side: App Service or Functions Premium, Container Apps, or AKS. Consumption-plan Functions cannot do this, which quietly rules them out.\n- **Hybrid connectivity** to the hospital itself: VPN or ExpressRoute, or a self-hosted agent inside their network pulling outbound.\n- **Egress control.** Firewall or NAT gateway with a fixed outbound IP, because the other side will want to allow-list it.\n\nBudget for it early. Retrofitting private networking onto a running system is a project, not a setting, and it is usually discovered during a security review two weeks before go-live.",
    followUps: [
      { question: "What is the most common private-endpoint failure?", answer: "DNS. The app resolves the public name, gets the public IP, and the firewall blocks it. Check resolution from inside the VNet first, always." },
    ],
    tags: ["private-endpoint", "vnet", "dns", "networking", "azure"],
  },
];
