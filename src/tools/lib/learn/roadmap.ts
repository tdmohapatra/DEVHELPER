/**
 * The skill roadmap: what to learn, in what order, and to what depth.
 *
 * A question bank tells you what exists. It does not tell you what to do on a
 * Tuesday evening with two hours. This module is the missing half — a ranked
 * list with a target depth and a reason for each rank, so revision follows a
 * plan rather than whatever happens to be at the top of the list.
 *
 * The ordering is deliberately opinionated and deliberately uneven: the top ten
 * are the ones that decide an offer, and the last five are worth recognising
 * rather than mastering. Treating every skill equally is the mistake this
 * exists to prevent.
 *
 * Each skill points at the topic that teaches it and the DevHelper tools that
 * practise it, which is what lets the app answer "where do I do this?" as well
 * as "what is it?".
 */

import type { TopicId } from "./types";

/** How much this skill decides the outcome. */
export type Band = "critical" | "important" | "useful";

export interface Skill {
  /** Rank across the whole roadmap, 1 = learn this first. */
  rank: number;
  name: string;
  band: Band;
  /** Depth worth reaching, 1–5. Five means "can design it and defend the design". */
  target: number;
  /** Why it earns this rank. */
  why: string;
  /** The topic whose cards teach it. */
  topic: TopicId;
  /** Tool ids that let you practise it rather than only read about it. */
  tools?: string[];
}

/**
 * The ranked list.
 *
 * The top four are the engineering core that every senior interview tests. Five
 * and six are the healthcare specialisation that separates this profile from
 * every other .NET developer applying — which is why they outrank Azure.
 */
export const SKILLS: Skill[] = [
  { rank: 1, name: "C#", band: "critical", target: 5, why: "The core engineering skill everything else is expressed in.", topic: "csharp" },
  { rank: 2, name: "ASP.NET Core / .NET 8+", band: "critical", target: 5, why: "The main technical requirement in almost every interview for this profile.", topic: "dotnet", tools: ["api-tester", "openapi"] },
  { rank: 3, name: "Microservices", band: "critical", target: 5, why: "Senior roles are hiring for service boundaries and failure handling, not CRUD.", topic: "microservices", tools: ["trace-explorer", "debug-session"] },
  { rank: 4, name: "System Design", band: "critical", target: 5, why: "The round that decides seniority. Breadth plus one defensible opinion per topic.", topic: "system-design" },
  { rank: 5, name: "FHIR", band: "critical", target: 5, why: "The specialisation. Modern healthcare interoperability is FHIR, and few .NET developers know it well.", topic: "healthcare", tools: ["fhir-toolkit", "api-tester"] },
  { rank: 6, name: "HL7 v2", band: "critical", target: 4, why: "What hospitals actually run today. FHIR is the future; v2 is the payroll.", topic: "healthcare", tools: ["hl7-toolkit", "device-link"] },
  { rank: 7, name: "Azure", band: "critical", target: 4, why: "The cloud these roles deploy to; identity, messaging and observability matter most.", topic: "azure", tools: ["service-bus", "kql-pad", "config-inspector"] },
  { rank: 8, name: "SQL Server", band: "critical", target: 4, why: "Backend fundamentals. Indexing and transactions come up in every backend loop.", topic: "database", tools: ["database-toolkit", "sql-formatter"] },
  { rank: 9, name: "Kafka", band: "critical", target: 4, why: "The default answer for event-driven architecture; partitions and offsets get asked directly.", topic: "messaging", tools: ["nats", "rabbitmq"] },
  { rank: 10, name: "Redis", band: "critical", target: 4, why: "Caching and distributed locks — the two distributed-systems questions most likely to be practical.", topic: "messaging", tools: ["redis"] },

  { rank: 11, name: "Medical devices", band: "important", target: 4, why: "The other half of the specialisation: analysers, gateways and the protocols between them.", topic: "devices", tools: ["device-link", "astm-toolkit"] },
  { rank: 12, name: "DICOM", band: "important", target: 3, why: "Imaging is the part of healthcare integration most people never touch.", topic: "devices" },
  { rank: 13, name: "Docker", band: "important", target: 4, why: "How anything ships. Expect to be asked to reason about an image, not to write one.", topic: "devops", tools: ["docker"] },
  { rank: 14, name: "Kubernetes", band: "important", target: 3, why: "Required vocabulary for cloud roles; depth matters less than being able to reason about failure.", topic: "devops" },
  { rank: 15, name: "Healthcare security & HIPAA", band: "important", target: 3, why: "PHI handling is a hard requirement, and getting it wrong is the one mistake nobody forgives.", topic: "healthcare", tools: ["healthcare-deidentifier"] },
  { rank: 16, name: "Python", band: "important", target: 3, why: "The language of the data and AI half of the profile. Fluent, not expert.", topic: "python-data" },
  { rank: 17, name: "LLM / GenAI", band: "important", target: 4, why: "The current differentiator. Being able to build and evaluate is rarer than being able to prompt.", topic: "ai", tools: ["error-explainer", "code-explainer"] },
  { rank: 18, name: "RAG", band: "important", target: 4, why: "The pattern healthcare AI actually uses, because the answer has to cite a source.", topic: "ai" },

  { rank: 19, name: "Angular", band: "useful", target: 3, why: "An existing skill worth maintaining, not growing. It keeps full-stack roles open.", topic: "frontend" },
  { rank: 20, name: "Machine learning", band: "useful", target: 3, why: "Understand the vocabulary and the failure modes. Do not try to become a research engineer.", topic: "python-data" },
  { rank: 21, name: "Data engineering", band: "useful", target: 3, why: "Pipelines and data quality — a useful secondary skill next to the MBA.", topic: "python-data" },
  { rank: 22, name: "AI agents", band: "useful", target: 3, why: "Future-facing. Worth being able to describe honestly, including where they fail.", topic: "ai" },
  { rank: 23, name: "DICOM networking", band: "useful", target: 2, why: "Concepts first: association, C-ECHO, C-STORE. Depth only if a role needs it.", topic: "devices" },
  { rank: 24, name: "IEEE 11073", band: "useful", target: 2, why: "Deep device specialisation. Recognise it and know what problem it solves.", topic: "devices" },
  { rank: 25, name: "MQTT", band: "useful", target: 3, why: "How modern devices talk to a gateway; small, learnable in an evening.", topic: "devices", tools: ["device-link"] },
];

export interface TrackItem {
  name: string;
  /** What you have to be able to say about it. */
  must: string;
  band: Band;
}

export interface Track {
  id: string;
  label: string;
  /** Why this grouping is worth studying as a block. */
  intent: string;
  topic: TopicId;
  items: TrackItem[];
}

/**
 * The four blocks worth studying as a unit rather than card by card.
 *
 * A track is a checklist for a conversation: if you can say the `must` line for
 * every item, you can hold that part of an interview.
 */
export const TRACKS: Track[] = [
  {
    id: "healthcare",
    label: "Healthcare domain",
    intent: "The part that separates this profile from thousands of .NET developers.",
    topic: "healthcare",
    items: [
      { name: "Patient, provider, payer", must: "Who the three parties are and why every data model has all three.", band: "critical" },
      { name: "EHR vs EMR", must: "EMR is one organisation's record; EHR follows the patient across organisations.", band: "critical" },
      { name: "HIS, LIS, RIS, PACS", must: "Which system owns which data, and which one you integrate with for a lab result.", band: "important" },
      { name: "HIPAA, PHI, PII", must: "What counts as PHI, the minimum-necessary rule, and why logs are the usual leak.", band: "critical" },
      { name: "FHIR", must: "Resources, references, Bundles, search, and when to use it over v2.", band: "critical" },
      { name: "HL7 v2", must: "MSH, message types, ACK, MLLP framing, and why Z-segments exist.", band: "critical" },
      { name: "DICOM", must: "Study/series/instance, tags, and that the image and its metadata are one file.", band: "important" },
      { name: "Device gateway", must: "Why a gateway exists at all: protocol translation, buffering and identity.", band: "critical" },
      { name: "Telemetry", must: "Continuous device data versus discrete results, and what that does to storage.", band: "critical" },
      { name: "MQTT", must: "Topics, QoS levels, retained messages, last will.", band: "important" },
      { name: "IEEE 11073", must: "A device information model, so a pulse oximeter means the same thing everywhere.", band: "useful" },
      { name: "OAuth2 / OIDC", must: "Authorization code + PKCE, what a scope is, and what the token actually proves.", band: "critical" },
      { name: "SMART on FHIR", must: "OAuth2 profiled for health apps: launch context, scopes like patient/*.read.", band: "important" },
      { name: "ICD-10, SNOMED CT, LOINC", must: "Which is diagnosis, which is clinical meaning, which is the lab test — and why LOINC mapping is the hard part.", band: "important" },
    ],
  },
  {
    id: "azure",
    label: "Azure services that matter",
    intent: "Not every service — the fifteen this kind of system is built from.",
    topic: "azure",
    items: [
      { name: "App Service", must: "Deployment, slots, and configuration precedence over appsettings.", band: "critical" },
      { name: "Azure Functions", must: "Triggers and bindings, isolated worker, and the cold-start trade-off.", band: "critical" },
      { name: "Azure SQL", must: "DTU/vCore, elastic pools, and how transient faults must be retried.", band: "critical" },
      { name: "Storage Account", must: "Blob tiers, SAS tokens, and lifecycle rules for retention.", band: "critical" },
      { name: "Service Bus", must: "Queues vs topics, sessions for ordering, peek-lock, dead-letter.", band: "critical" },
      { name: "Event Hubs", must: "Partitions, consumer groups, checkpointing — Kafka's shape with an Azure face.", band: "important" },
      { name: "Key Vault", must: "Secrets, keys, certificates, references from App Configuration, rotation.", band: "critical" },
      { name: "Entra ID", must: "Managed identity over connection strings, app registrations, RBAC scope.", band: "critical" },
      { name: "Application Insights", must: "Requests, dependencies, exceptions, and the operation id that ties them together.", band: "critical" },
      { name: "Azure Monitor / KQL", must: "Writing a KQL query against traces, and why sampling changes what you see.", band: "critical" },
      { name: "AKS", must: "When a cluster is worth its operational cost, and when Container Apps is not.", band: "important" },
      { name: "Container Apps", must: "Managed containers with scale-to-zero, without owning a control plane.", band: "important" },
      { name: "API Management", must: "Gateway, subscription keys, throttling policies, mTLS to the backend.", band: "important" },
      { name: "Azure Data Factory", must: "Pipeline, activity, integration runtime, and where it beats writing code.", band: "important" },
      { name: "Azure OpenAI", must: "Deployments, quota, content filters, and that data stays in the tenant.", band: "important" },
    ],
  },
  {
    id: "distributed",
    label: "Distributed systems",
    intent: "The block that decides the senior band. Each item is a question you will be asked outright.",
    topic: "microservices",
    items: [
      { name: "Microservices", must: "When to split and — harder — when not to.", band: "critical" },
      { name: "API gateway", must: "Routing, auth termination, and why it must not hold business logic.", band: "critical" },
      { name: "CQRS", must: "Separating the read model from the write model, and the staleness it buys.", band: "critical" },
      { name: "Saga", must: "A distributed transaction as compensating steps, choreography vs orchestration.", band: "critical" },
      { name: "Outbox", must: "Why writing to the database and the broker in one step is impossible without it.", band: "critical" },
      { name: "Idempotency", must: "At-least-once delivery means duplicates; the consumer must make them harmless.", band: "critical" },
      { name: "Kafka", must: "Partitions give ordering per key, offsets give position, consumer groups give parallelism.", band: "critical" },
      { name: "Redis", must: "Cache-aside, TTL, and why a distributed lock needs a fencing token.", band: "critical" },
      { name: "Retry", must: "Exponential backoff with jitter, and only for transient faults.", band: "critical" },
      { name: "Circuit breaker", must: "Fail fast when a dependency is down, so the failure does not spread.", band: "critical" },
      { name: "Rate limiting", must: "Token bucket vs fixed window, and where the limit belongs.", band: "important" },
      { name: "Load balancing", must: "L4 vs L7, health checks, and sticky sessions as a smell.", band: "important" },
      { name: "Sharding", must: "Choosing a shard key you will not regret, and what cross-shard queries cost.", band: "important" },
      { name: "Event-driven architecture", must: "Async workflows, and the debugging cost you accept for the decoupling.", band: "critical" },
      { name: "CAP theorem", must: "Under a partition you pick consistency or availability — and you will be partitioned.", band: "critical" },
      { name: "Consistency", must: "Strong vs eventual, and how to explain eventual to a clinician.", band: "critical" },
      { name: "Observability", must: "Logs, metrics and traces, and which question each one answers.", band: "critical" },
    ],
  },
  {
    id: "ai",
    label: "AI and data",
    intent: "Engineering plus healthcare plus AI is the combination. Depth in the middle, not the ends.",
    topic: "ai",
    items: [
      { name: "Python", must: "Comfortable reading and writing it; comprehensions, virtualenvs, typing.", band: "important" },
      { name: "NumPy", must: "Arrays and vectorised operations, and why loops are the slow way.", band: "useful" },
      { name: "Pandas", must: "DataFrame, groupby, merge, and handling missing data honestly.", band: "important" },
      { name: "SQL", must: "Window functions and CTEs — the analytic half of SQL, not just CRUD.", band: "critical" },
      { name: "Statistics", must: "Distribution, variance, correlation vs causation, base rates.", band: "important" },
      { name: "ML fundamentals", must: "Train/validate/test, overfitting, and which metric matters for imbalanced data.", band: "important" },
      { name: "LLM fundamentals", must: "Tokens, context window, temperature, and what the model cannot know.", band: "critical" },
      { name: "Embeddings", must: "Text as a vector, cosine similarity, and that similar is not the same as relevant.", band: "critical" },
      { name: "Vector databases", must: "ANN indexes, metadata filters, and hybrid search with keywords.", band: "important" },
      { name: "RAG", must: "Chunking, retrieval, reranking, citation — and where each step fails.", band: "critical" },
      { name: "Function calling", must: "The model chooses a tool and its arguments; you still validate them.", band: "important" },
      { name: "AI agents", must: "A loop with tools and a stopping condition, plus why they fail on long tasks.", band: "useful" },
      { name: "Prompt & context engineering", must: "What goes in the window, in what order, and what to leave out.", band: "critical" },
      { name: "Evaluation", must: "A test set with expected answers, and measuring changes rather than guessing.", band: "important" },
      { name: "Guardrails", must: "Input and output checks; refusing is a feature in a clinical setting.", band: "important" },
      { name: "Healthcare AI", must: "De-identify before the prompt leaves, cite the source, and never present a model as a diagnosis.", band: "critical" },
    ],
  },
];

/** Skills in a band, in rank order. */
export const skillsByBand = (band: Band): Skill[] => SKILLS.filter((s) => s.band === band);

/** The skills a topic teaches, best-ranked first. */
export const skillsForTopic = (topic: TopicId): Skill[] => SKILLS.filter((s) => s.topic === topic);

/** Every tool named anywhere in the roadmap, de-duplicated. */
export function roadmapTools(): string[] {
  return [...new Set(SKILLS.flatMap((s) => s.tools ?? []))].sort();
}

/**
 * What to study next: the highest-ranked skill whose topic is not yet mostly
 * known. Rank order is the whole point — without it, revision drifts to
 * whatever is most comfortable.
 */
export function nextSkill(knownFraction: (topic: TopicId) => number, threshold = 0.7): Skill | undefined {
  return [...SKILLS].sort((a, b) => a.rank - b.rank).find((s) => knownFraction(s.topic) < threshold);
}

/** A one-line summary of how far through the roadmap a topic's study has got. */
export function bandLabel(band: Band): string {
  return band === "critical" ? "Decides the offer" : band === "important" ? "Sets you apart" : "Worth recognising";
}
