/**
 * LLM and applied-AI cards.
 *
 * Written for an engineer building with models, not for someone training them.
 * The valuable skill in this profile is not knowing how attention works; it is
 * knowing what the model cannot know, how retrieval fails, how to measure a
 * change, and where the line is in a clinical setting.
 */

import type { Question } from "./types";

export const AI_QUESTIONS: Question[] = [
  {
    id: "ai-fundamentals",
    topic: "ai",
    subtopic: "LLM fundamentals",
    level: "basic",
    mustKnow: true,
    question: "Tokens, context window, temperature — what does an engineer need to know?",
    answer:
      "- **Tokens** are the model's units, roughly ¾ of a word in English and far worse for code, JSON and non-Latin scripts. You are billed per token and limited per token, so token count is a capacity metric, not trivia.\n- **The context window** is everything the model can see: system prompt, history, retrieved documents and the answer it is generating. It is a budget you spend, and when you run out something has to be dropped — decide *what*, deliberately, rather than letting a truncation do it for you.\n- **Temperature** controls sampling randomness. Near 0 for extraction, classification and anything you will parse; higher only for genuinely creative text. `top_p` does a similar job by trimming the candidate set; change one, not both.\n- **The model has no memory.** Every call is stateless; the \"conversation\" is you resending the history. That is why a long chat gets expensive and eventually truncates.\n- **It cannot know** anything after its training cut-off, anything private, or what it did last time. Everything else has to arrive in the context window.\n\nThe practical consequence: most quality problems are context problems, not model problems.",
    followUps: [
      { question: "Why does temperature 0 not guarantee identical output?", answer: "Batching and floating-point non-determinism on the provider's side still vary slightly. Treat it as low variance, not as a hash function." },
      { question: "What is the first thing to check when output degrades?", answer: "Whether the context is being silently truncated. It fails quietly and looks like the model getting worse." },
    ],
    tags: ["llm", "tokens", "context-window", "temperature", "fundamentals"],
  },
  {
    id: "ai-embeddings",
    topic: "ai",
    subtopic: "Retrieval",
    level: "intermediate",
    mustKnow: true,
    question: "What is an embedding, and what does cosine similarity actually tell you?",
    answer:
      "An embedding is a vector of floats representing a piece of text's meaning, produced by a model trained so that related texts land near each other. Similarity is normally **cosine** — the angle between two vectors, ignoring magnitude.\n\nWhat it tells you: these two texts are *about* similar things.\n\nWhat it does **not** tell you:\n\n- **Similar is not relevant.** \"The patient has no history of diabetes\" and \"the patient has diabetes\" are extremely close in embedding space and clinically opposite. Negation is the classic failure, and it is a serious one in this domain.\n- **Similar is not correct.** Retrieval will happily return a plausible passage that does not answer the question.\n\nRules that follow:\n\n- **Embed with the same model at index and query time.** Different models produce incomparable spaces, so a model upgrade means re-embedding everything.\n- **Chunk size drives quality.** Too small and there is no context; too large and the signal is diluted. Paragraph-sized chunks with a little overlap, split on structure rather than character count, is the usual starting point.\n- **Store the source with the vector** — document, section, date — because you will need to cite it and to filter on it.",
    language: "python",
    code:
      "import numpy as np\n\ndef cosine(a: np.ndarray, b: np.ndarray) -> float:\n    return float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b)))\n\n# The failure worth internalising:\n# \"no history of diabetes\" and \"history of diabetes\" score ~0.95.\n# Retrieval alone cannot tell them apart — a reranker or the model reading\n# the passage has to.",
    followUps: [
      { question: "How do you handle negation in a clinical corpus?", answer: "Do not rely on the vector. Keep the passage intact so the model reads the negation, use a reranker that sees the query and the passage together, and prefer structured data where it exists." },
    ],
    tags: ["embeddings", "cosine", "vectors", "retrieval", "chunking"],
  },
  {
    id: "ai-vector-db",
    topic: "ai",
    subtopic: "Retrieval",
    level: "intermediate",
    question: "What does a vector database give you that a table of floats does not?",
    answer:
      "**Approximate nearest-neighbour search at scale.** Exact search is a full scan — fine for ten thousand vectors, hopeless for ten million. ANN indexes (HNSW, IVF) trade a little recall for orders of magnitude in speed.\n\nWhat else matters when choosing:\n\n- **Metadata filtering.** \"Nearest chunks *from this patient's records, since January*\" is the query you actually need. Whether the filter is applied before or after the ANN search changes both correctness and speed — post-filtering can return nothing at all when the filter is selective.\n- **Hybrid search.** Combining vector similarity with keyword (BM25) matching, usually via reciprocal rank fusion. Keywords catch exact identifiers, drug names and codes that embeddings blur; vectors catch paraphrase. Hybrid beats either alone on almost every real corpus.\n- **Updates and deletes.** Some indexes rebuild rather than update, which matters when a record must be removed on request.\n- **Multi-tenancy and access control**, which in this domain is not optional: a retrieval that crosses patients is a breach.\n\nAnd know when you do not need one. Postgres with `pgvector`, or Azure AI Search, covers a great deal — and one fewer system to operate is worth real money.",
    followUps: [
      { question: "What is reciprocal rank fusion?", answer: "Score each document by 1/(k + rank) in each result list and add them. It merges keyword and vector rankings without needing the two scores to be on a comparable scale." },
    ],
    tags: ["vector-database", "ann", "hnsw", "hybrid-search", "filtering"],
  },
  {
    id: "ai-rag",
    topic: "ai",
    subtopic: "RAG",
    level: "intermediate",
    mustKnow: true,
    question: "Walk through a RAG pipeline and say where each stage fails.",
    answer:
      "**Ingest** → chunk → embed → index. **Query** → embed → retrieve → rerank → assemble context → generate → cite.\n\nWhere each stage fails:\n\n- **Chunking** — split mid-table or mid-sentence and the chunk is meaningless. Split on structure: headings, sections, records.\n- **Retrieval** — the answer is not in the top k, so nothing downstream can save it. This is the most common cause of a bad answer, and the easiest to miss because the model still produces something confident.\n- **Reranking** — skipping it is why relevant-looking chunks beat relevant ones. A cross-encoder that reads query and passage together is far more accurate than cosine, and only has to run on the top 50.\n- **Context assembly** — too many chunks and the answer is buried; models attend less well to the middle of a long context. Fewer, better chunks beat more.\n- **Generation** — the model answers from its own knowledge when retrieval was empty. Instruct it to say it does not know, and *test that it does*.\n- **Citation** — without it nobody can check the answer, and in a clinical setting an uncheckable answer is worthless.\n\nThe diagnostic that matters: measure **retrieval** separately from **generation**. If the right chunk was not retrieved, no amount of prompt tuning will fix the answer.",
    diagram:
      "  ingest:  documents ─▶ chunk ─▶ embed ─▶ index (+ metadata)\n  query:   question ─▶ embed ─▶ retrieve k=50 ─▶ rerank ─▶ top 5\n                                                     │\n                        prompt = system + top 5 + question\n                                                     ▼\n                                          generate ─▶ answer + citations\n\n  measure retrieval (was the right chunk there?) apart from\n  generation (given it, was the answer right?)",
    followUps: [
      { question: "How do you evaluate retrieval on its own?", answer: "Build a set of questions with the passage that answers each one, and measure recall@k. If recall@5 is 60%, your ceiling on answer quality is 60%, whatever the prompt says." },
      { question: "When is RAG the wrong tool?", answer: "When the answer needs aggregation over many records — \"how many patients had X last month\". That is a query, not a retrieval. Generate SQL or call an API instead." },
    ],
    tags: ["rag", "retrieval", "reranking", "citations", "evaluation"],
  },
  {
    id: "ai-healthcare-rag",
    topic: "ai",
    subtopic: "RAG",
    level: "advanced",
    mustKnow: true,
    question: "What is different about RAG over clinical documents?",
    answer:
      "- **Retrieval must be access-scoped.** The filter is not an optimisation, it is the security boundary: a query may only see documents this user may see, for this patient. Apply it in the search, never after generation.\n- **De-identify what leaves.** If the model is external, the chunk in the prompt is PHI leaving your control. De-identify, verify the residue, and log what was sent — redacted.\n- **Negation and uncertainty carry meaning.** \"Rule out sepsis\" is not a diagnosis of sepsis. Keep enough context in the chunk for the model to read the qualifier, and do not summarise it away in ingestion.\n- **Time matters.** A medication list from 2019 is wrong, not merely old. Filter and rank by recency, and show the date beside every citation.\n- **Never present output as clinical advice.** Cite the source document, mark it as generated, and design for a clinician verifying it rather than trusting it.\n- **Refusal is a feature.** \"I could not find this in the record\" is the correct answer far more often than in other domains, and it must be tested for explicitly.\n\nThe honest framing: the useful product is usually *finding and summarising what is already in the record with a citation*, not answering clinical questions.",
    followUps: [
      { question: "Where does the audit trail fit?", answer: "Log the question, the documents retrieved and the answer shown, tied to the user. It is a data access — the same as opening the chart, and it belongs in the same audit trail." },
    ],
    tags: ["rag", "healthcare", "phi", "safety", "citations"],
    relatedTools: ["healthcare-deidentifier"],
  },
  {
    id: "ai-prompt-engineering",
    topic: "ai",
    subtopic: "Prompting",
    level: "intermediate",
    mustKnow: true,
    question: "What actually improves a prompt?",
    answer:
      "In rough order of effect:\n\n1. **Give it the information.** Most bad answers are missing context, not bad instructions.\n2. **Say what the output must look like** — a JSON schema, a field list, an example. Then validate it, because the model may still deviate.\n3. **Show one or two examples** (few-shot). More useful than any amount of adjectives, especially for a format.\n4. **Say what to do when it cannot answer.** Without an explicit escape hatch the model invents something, because that is what it is optimised to do.\n5. **Put the instruction where it is read.** Models attend most to the start and end of a long context; instructions buried in the middle get diluted.\n6. **Ask for reasoning only when it helps.** It improves multi-step problems and wastes tokens on extraction. Never parse an answer out of free-form reasoning — ask for structure separately.\n7. **Keep the system prompt stable** and version it. It is code: changing it changes behaviour for every user at once.\n\nWhat does not work: politeness, threats, insisting it is an expert, or repeating \"IMPORTANT\" in capitals. If a rule matters, enforce it in code — validate the output, do not hope.",
    language: "csharp",
    code:
      "// Structure the request; validate the response. Hope is not a parser.\nvar system = \"\"\"\n    You extract lab values from clinical text.\n    Return JSON matching the schema exactly. No prose.\n    If a value is absent, omit the field. Never infer a value that is not stated.\n    \"\"\";\n\nvar response = await client.GetChatCompletionsAsync(new ChatCompletionsOptions\n{\n    DeploymentName = \"gpt-4o-2024-11-20\",     // pinned: an upgrade changes behaviour\n    Temperature = 0,\n    ResponseFormat = ChatCompletionsResponseFormat.JsonObject,\n    Messages = { new ChatRequestSystemMessage(system), new ChatRequestUserMessage(note) },\n});\n\nif (!TryValidate(response.Value.Choices[0].Message.Content, out var extracted, out var errors))\n    return Retry(errors);   // the schema is enforced here, not in the prompt",
    followUps: [
      { question: "Why pin the model version?", answer: "Because a silent upgrade changes outputs, and your evaluation set is the only thing that will tell you it happened. Pin, then move deliberately with a comparison run." },
    ],
    tags: ["prompting", "few-shot", "json", "validation", "context"],
  },
  {
    id: "ai-function-calling",
    topic: "ai",
    subtopic: "Tools",
    level: "intermediate",
    question: "How does function calling work, and what must you still do yourself?",
    answer:
      "You describe the tools available — name, description, JSON-schema parameters. The model, instead of answering, returns a **request to call one** with arguments. You execute it, return the result, and the model continues with that result in context.\n\nWhat the model is doing is choosing *what to call and with what*. What it is **not** doing is executing anything, checking permissions, or guaranteeing valid arguments.\n\nSo you still own:\n\n- **Validation.** The arguments are model output. Validate against the schema and against your domain rules before touching anything.\n- **Authorisation.** Check that *this user* may perform this call. The model has no idea who is asking.\n- **Idempotency and confirmation.** Anything that writes should be idempotent, and anything destructive should require explicit human confirmation.\n- **Tool design.** Few, well-named, narrowly-scoped tools work far better than one `run_query` that can do anything. The description is the prompt the model uses to choose.\n- **Timeouts and failure text.** Return an error the model can act on — \"no patient with that id\" — not a stack trace.\n\nIn healthcare the rule is simple: read tools can be automatic; write tools need a human.",
    followUps: [
      { question: "How is this different from an agent?", answer: "Function calling is one turn. An agent is a loop of them with a goal and a stopping condition, which is where the compounding failure comes from." },
    ],
    tags: ["function-calling", "tools", "validation", "authorisation"],
  },
  {
    id: "ai-agents",
    topic: "ai",
    subtopic: "Tools",
    level: "advanced",
    question: "What is an AI agent, and why do they fail on long tasks?",
    answer:
      "An agent is a loop: the model chooses a tool, the tool runs, the result goes back into context, repeat until a stopping condition. That is the entire idea; everything else is engineering around it.\n\nWhy long tasks fail:\n\n- **Errors compound.** At 95% reliability per step, twenty steps is a 36% chance of success. Long autonomous chains are the wrong shape for anything important.\n- **Context fills.** Every observation is added, the window fills, early instructions are truncated, and behaviour drifts mid-task.\n- **No convergence check.** Without a step limit and a stopping condition, an agent will loop on the same failing action for ever.\n- **Bad recovery.** A tool error is one more token in the context; the model may retry identically, or invent that it succeeded.\n\nWhat makes them work: **few steps, checkpoints, and a human at anything irreversible.** Prefer a fixed workflow with model-powered steps over an autonomous agent whenever the flow is known — it is more reliable, cheaper and debuggable. Reserve agents for genuinely open-ended tasks.\n\nAnd instrument the loop: log every step, tool call, argument and result. An agent you cannot replay is one you cannot debug.",
    followUps: [
      { question: "When is an agent clearly the right choice?", answer: "When the sequence genuinely cannot be known in advance — open-ended investigation or search — and the cost of a wrong step is low and reversible." },
    ],
    tags: ["agents", "loops", "reliability", "tools", "design"],
  },
  {
    id: "ai-evaluation",
    topic: "ai",
    subtopic: "Quality",
    level: "advanced",
    mustKnow: true,
    question: "How do you evaluate an LLM feature?",
    answer:
      "With a **test set**, like any other system. Vibes do not survive a model upgrade.\n\n1. **Build a golden set** — 50 to 200 real inputs with expected outputs. Real ones, not invented: invented cases agree with your assumptions.\n2. **Choose a metric per task.** Extraction → field-level precision and recall. Classification → confusion matrix, and per-class, because the rare class is the one that matters. RAG → recall@k for retrieval and faithfulness for generation, measured separately. Free text → an LLM judge with a rubric, calibrated against human ratings on a sample.\n3. **Run it in CI** and compare against the previous version. The purpose is to detect a *change*, which is what a prompt edit or a model upgrade produces.\n4. **Track cost and latency** alongside quality — they are part of the trade.\n5. **Keep a regression set** of everything that has ever failed in production. That set only grows, and it is the most valuable thing you will build.\n\nThe rule worth stating: **if you cannot measure it, you cannot safely change the prompt.** Every prompt edit is a deployment with no test coverage otherwise.",
    language: "python",
    code:
      "# Extraction eval: per-field precision and recall over a golden set\nfrom collections import Counter\n\ndef score(predicted: dict, expected: dict) -> Counter:\n    c = Counter()\n    for field in set(predicted) | set(expected):\n        p, e = predicted.get(field), expected.get(field)\n        if p is not None and e is not None and p == e: c[\"tp\"] += 1\n        elif p is not None and p != e:                 c[\"fp\"] += 1\n        elif e is not None and p is None:              c[\"fn\"] += 1\n    return c\n\ntotals = sum((score(run(case.input), case.expected) for case in golden), Counter())\nprecision = totals[\"tp\"] / (totals[\"tp\"] + totals[\"fp\"])\nrecall    = totals[\"tp\"] / (totals[\"tp\"] + totals[\"fn\"])\n# Fail CI if either drops more than a point against the recorded baseline.",
    followUps: [
      { question: "Is an LLM judge trustworthy?", answer: "Usefully, with care: give it a rubric, ask for a score with a reason, and check it against human ratings on a sample. It is biased toward long, confident answers, so control for that." },
    ],
    tags: ["evaluation", "golden-set", "metrics", "regression", "ci"],
  },
  {
    id: "ai-guardrails",
    topic: "ai",
    subtopic: "Quality",
    level: "advanced",
    question: "What guardrails does a production LLM feature need?",
    answer:
      "**On the way in:**\n\n- **PHI de-identification** if the model is external, with verification of what remains.\n- **Prompt-injection defence.** Any text you retrieved — a document, an email, a web page — may contain instructions aimed at the model. Keep untrusted content clearly separated from instructions, never let retrieved text grant permissions, and treat tool arguments derived from it as hostile input.\n- **Input limits.** Size, rate, and cost per user.\n\n**On the way out:**\n\n- **Schema validation** for anything structured. Retry once with the error, then fail — do not paper over it.\n- **Grounding check** for RAG: does the answer actually appear in the retrieved sources? An unsupported claim should be dropped or flagged.\n- **Refusal handling.** A blocked or refused response is a normal outcome to handle, not an exception to log and ignore.\n- **A hard boundary on advice.** In a clinical product, output is information with a citation, never a recommendation.\n\n**Around the whole thing:** a kill switch, a cost cap, and enough logging (redacted) to reconstruct what happened. Every one of these is ordinary engineering; none of it is model-specific.",
    followUps: [
      { question: "Why is prompt injection so hard to fix?", answer: "The model sees one stream of text; instructions and data are not separable at the level it operates on. Mitigation is architectural — least privilege on tools and a human before anything irreversible — not a clever prompt." },
    ],
    tags: ["guardrails", "prompt-injection", "validation", "safety", "grounding"],
    relatedTools: ["healthcare-deidentifier"],
  },
  {
    id: "ai-fine-tune",
    topic: "ai",
    subtopic: "Strategy",
    level: "advanced",
    question: "Prompting, RAG or fine-tuning — how do you choose?",
    answer:
      "Try them in this order, and stop as soon as it works:\n\n1. **Prompting** — the model has the capability and just needs instruction and format. Instant to change, free to revert.\n2. **RAG** — the model lacks *knowledge*: your documents, your data, anything after the cut-off. Knowledge changes without retraining, and you get citations.\n3. **Fine-tuning** — the model lacks *behaviour*: a consistent format, a domain style, a classification boundary examples cannot convey. It needs hundreds to thousands of examples, it must be redone when the base model changes, and it does **not** teach facts reliably.\n\nThe common mistake is fine-tuning to add knowledge. It bakes information into weights where it cannot be updated, cited or removed — the exact opposite of what a clinical system needs.\n\nA fourth option people skip: **do not use a model at all.** Extraction with a regex, a lookup table or a deterministic parser is cheaper, faster, testable and auditable. Use the model where the input is genuinely unstructured language.",
    followUps: [
      { question: "What about small local models?", answer: "For classification and extraction on a fixed domain they can match a large model at a fraction of the cost — and they can run inside the hospital network, which sometimes settles the question on its own." },
    ],
    tags: ["fine-tuning", "rag", "prompting", "strategy", "cost"],
  },
  {
    id: "ai-cost",
    topic: "ai",
    subtopic: "Strategy",
    level: "intermediate",
    question: "How do you control the cost and latency of an LLM feature?",
    answer:
      "- **Measure tokens per request**, in and out, per feature. Cost is a function you can compute, not a mystery on an invoice.\n- **Shrink the context.** The prompt is usually the expensive half. Fewer, better-retrieved chunks beat more; trim history; summarise rather than resend.\n- **Cache.** Exact-match caching for repeated questions, and **prompt caching** where the provider supports it — a long stable system prompt is charged much less on a hit.\n- **Route by difficulty.** A small model for classification and extraction, a large one only for hard generation. Most volume is easy.\n- **Stream** for perceived latency. Time-to-first-token is what a user feels.\n- **Batch** anything offline; batch APIs are substantially cheaper.\n- **Cap it.** Per-user and per-day limits, with a circuit breaker. Without one, a retry loop against a paid API is an unbounded bill.\n\nAnd measure at the p95, not the mean. Model latency is long-tailed, and the tail is what times out.",
    followUps: [
      { question: "Where does the cost usually hide?", answer: "In retrieved context resent on every turn of a conversation, and in a debug log that quietly stores every prompt and response." },
    ],
    tags: ["cost", "latency", "caching", "routing", "streaming"],
  },
  {
    id: "ai-ml-basics",
    topic: "ai",
    subtopic: "ML fundamentals",
    level: "intermediate",
    question: "What ML fundamentals should an engineer be able to discuss?",
    answer:
      "- **Train / validation / test.** Fit on train, tune on validation, touch test once. Tuning against test is how a model that scores 0.95 fails in production.\n- **Overfitting** — memorising the training set. The signature is training performance far above validation performance.\n- **Leakage** — a feature that encodes the answer. In healthcare it is everywhere: a treatment code that only exists once the diagnosis was made, a timestamp that only occurs for admitted patients. Leakage produces suspiciously good results, and suspicious is the tell.\n- **Class imbalance.** With 1% positives, predicting \"no\" always scores 99% accuracy. Use precision, recall, F1 and PR-AUC — never accuracy — and know which error is worse. In screening, a false negative is a missed disease.\n- **The threshold is a product decision**, not a modelling one. It trades false positives against false negatives, and only the clinician can say which costs more.\n- **Calibration** — does a predicted 0.8 mean it happens 80% of the time? Uncalibrated probabilities cannot support a clinical decision.\n- **Drift.** The population changes, an analyser is replaced, coding practice shifts. A model that is not monitored is decaying.",
    followUps: [
      { question: "Why is accuracy the wrong metric for a rare disease?", answer: "Because a model that never predicts it is highly accurate and completely useless. Precision, recall and PR-AUC describe the behaviour that matters." },
    ],
    tags: ["machine-learning", "overfitting", "leakage", "imbalance", "metrics"],
  },
  {
    id: "ai-structured-output",
    topic: "ai",
    subtopic: "Tools",
    level: "intermediate",
    mustKnow: true,
    question: "How do you get reliable structured output from a model?",
    answer:
      "Treat the model as an untrusted service returning untrusted JSON, and build the same defences you would for any other.\n\n1. **Ask for a schema, and enforce it at the API level** where the provider supports constrained decoding (`response_format` with a JSON schema, or a tool definition). That is far stronger than asking politely in the prompt, because the tokens that would break the schema are never sampled.\n2. **Validate anyway.** Schema-valid does not mean domain-valid: a date in the future, a haemoglobin of 400, a code that is not in your value set.\n3. **Retry once with the error text.** Models correct well when told precisely what was wrong. Retrying blindly repeats the mistake.\n4. **Then fail loudly.** A second failure is a real failure — surface it, do not substitute a default. A silently defaulted clinical field is worse than an error.\n5. **Omit rather than guess.** Instruct that a missing value is left out, never inferred. Otherwise the model helpfully invents a plausible number, which in this domain is the worst possible failure mode.\n6. **Keep the raw response** alongside the parsed one, so a parsing dispute can be settled.\n\nThe underlying rule: the prompt is a request, the schema is a contract, and only code can enforce a contract.",
    language: "csharp",
    code:
      "// Schema at the API level, domain rules in code, one informed retry.\nfor (var attempt = 1; attempt <= 2; attempt++)\n{\n    var json = await CallModelAsync(note, lastError);\n\n    if (!TryDeserialize(json, out LabExtract? extract, out var schemaError))\n    { lastError = schemaError; continue; }\n\n    var problems = Validate(extract!);           // ranges, codes, dates — domain rules\n    if (problems.Count == 0) return extract!;\n\n    lastError = string.Join(\"; \", problems);\n}\n\nthrow new ExtractionFailedException(lastError);   // no silent default",
    followUps: [
      { question: "Why not just parse with a regex and move on?", answer: "Because a partially-parsed clinical record looks like a successful one. Either the whole object validates or the extraction failed." },
    ],
    tags: ["structured-output", "json-schema", "validation", "retry", "reliability"],
  },
  {
    id: "ai-healthcare-product",
    topic: "ai",
    subtopic: "Strategy",
    level: "advanced",
    mustKnow: true,
    question: "Which healthcare AI features are worth building, and which are traps?",
    answer:
      "**Worth building** — low clinical risk, clear value, verifiable output:\n\n- Summarising a long record *with citations*, so the clinician verifies rather than trusts.\n- Extracting structured data from unstructured text — a fax, a scanned referral, a free-text note — with a human confirming.\n- Mapping local codes to LOINC or SNOMED as a *suggestion* with a confidence and a reason.\n- Drafting documentation for a human to edit and sign.\n- Search over policies, protocols and past reports.\n- Coding support for billing, reviewed before submission.\n\n**Traps:**\n\n- Anything that reads as a diagnosis or a treatment recommendation. That is a regulated medical device in most jurisdictions, and the bar is clinical evidence, not a good demo.\n- Triage or prioritisation without validation — it is a clinical decision wearing a queue.\n- Autonomous action on the record. Draft, never commit.\n- Chatbots aimed at patients, which carry both clinical and legal exposure.\n\nThe pattern that separates the two: **the human stays accountable, and the output is verifiable.** Everything in the first list can be checked in seconds against a cited source; nothing in the second can.",
    followUps: [
      { question: "When does a feature become a regulated device?", answer: "Broadly, when its output is intended to inform a clinical decision about a specific patient. Summarising with citations sits outside; suggesting a diagnosis does not. Get a regulatory opinion early — it changes the whole project." },
    ],
    tags: ["healthcare-ai", "product", "regulation", "risk", "strategy"],
  },
];
