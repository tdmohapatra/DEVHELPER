/**
 * Interview preparation content model.
 *
 * A question is a self-contained revision card: the answer as Markdown, an optional code
 * example, an optional ASCII diagram, and the follow-ups an interviewer usually asks
 * next. Follow-ups matter more than breadth — most interviews fail on the second
 * question, not the first.
 */

export type TopicId =
  | "csharp"
  | "oop"
  | "dotnet"
  | "azure"
  | "database"
  | "messaging"
  | "programming"
  | "dsa"
  | "system-design"
  | "healthcare"
  | "devices"
  | "microservices"
  | "devops"
  | "ai"
  | "python-data"
  | "frontend";

export type Level = "basic" | "intermediate" | "advanced";

export interface FollowUp {
  question: string;
  answer: string;
}

export interface Question {
  id: string;
  topic: TopicId;
  /** Grouping inside a topic, e.g. "Collections" or "Concurrency". */
  subtopic: string;
  level: Level;
  question: string;
  /** Markdown. Headings, lists and inline code render; keep it tight. */
  answer: string;
  /** Language hint for the example, e.g. `csharp`, `sql`, `bash`. */
  language?: string;
  code?: string;
  /** ASCII diagram, rendered in a monospace block. */
  diagram?: string;
  followUps?: FollowUp[];
  tags: string[];
  /**
   * Tool ids this card can be practised in, e.g. `["hl7-toolkit", "device-link"]`.
   *
   * Reading about MLLP framing and watching a real <VT> go down a socket are not
   * the same act, and the gap between them is where the understanding is. The
   * card offers the tool; the tool offers the card back.
   */
  relatedTools?: string[];
  /** True for questions that come up in almost every interview on the topic. */
  mustKnow?: boolean;
}

export interface Topic {
  id: TopicId;
  label: string;
  description: string;
  /** Lucide icon name, resolved by the UI. */
  icon: string;
}

export const TOPICS: Topic[] = [
  { id: "csharp", label: "C#", description: "Language features, memory, async, collections", icon: "Code2" },
  { id: "oop", label: "OOP & Design", description: "Principles, SOLID, patterns", icon: "Boxes" },
  { id: "dotnet", label: ".NET", description: "ASP.NET Core, DI, EF Core, hosting", icon: "Layers" },
  { id: "azure", label: "Azure", description: "App hosting, storage, messaging, identity", icon: "Cloud" },
  { id: "database", label: "Databases", description: "SQL, indexing, transactions, tuning", icon: "Database" },
  { id: "messaging", label: "Messaging & Queues", description: "Kafka, RabbitMQ, Service Bus, patterns", icon: "MessagesSquare" },
  { id: "programming", label: "Programming", description: "Concurrency, testing, APIs, general craft", icon: "Braces" },
  { id: "dsa", label: "DSA", description: "Data structures, algorithms, complexity", icon: "Binary" },
  { id: "system-design", label: "System Design", description: "Scaling, consistency, architecture", icon: "Network" },
  { id: "python-data", label: "Python & Data", description: "Python, pandas, statistics, ML, data engineering", icon: "Binary" },
  { id: "frontend", label: "Angular", description: "Components, RxJS, change detection, forms", icon: "Code2" },
  { id: "ai", label: "AI & LLM", description: "Embeddings, RAG, agents, evaluation, guardrails", icon: "Bot" },
  { id: "devops", label: "Docker & Kubernetes", description: "Images, compose, pods, probes, delivery", icon: "Container" },
  { id: "microservices", label: "Microservices", description: "Boundaries, CQRS, saga, outbox, resilience", icon: "Boxes" },
  { id: "healthcare", label: "Healthcare Domain", description: "FHIR, HL7 v2, HIPAA, EHR, terminology", icon: "HeartPulse" },
  { id: "devices", label: "Medical Devices", description: "Gateways, MLLP, ASTM, DICOM, MQTT, IEEE 11073", icon: "Cable" },
];

export const LEVELS: { id: Level; label: string }[] = [
  { id: "basic", label: "Basic" },
  { id: "intermediate", label: "Intermediate" },
  { id: "advanced", label: "Advanced" },
];

export function topicById(id: TopicId): Topic | undefined {
  return TOPICS.find((t) => t.id === id);
}
