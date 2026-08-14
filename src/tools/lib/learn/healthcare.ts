/**
 * Healthcare domain cards: the vocabulary, the standards, and the rules.
 *
 * This is the deck that separates a .NET developer from a healthcare .NET
 * developer. It is written for someone who already builds systems, so it skips
 * "what is an API" and spends its space on the things that are genuinely
 * different: that identity is federated and messy, that the legacy format is
 * not going away, and that a mistake with PHI is not a bug you quietly fix.
 *
 * Where a card can be practised rather than read, it names the tool.
 */

import type { Question } from "./types";

export const HEALTHCARE_QUESTIONS: Question[] = [
  {
    id: "hc-parties",
    topic: "healthcare",
    subtopic: "Domain basics",
    level: "basic",
    mustKnow: true,
    question: "Who are the patient, the provider and the payer, and why does every healthcare data model carry all three?",
    answer:
      "**Patient** — the person receiving care. **Provider** — the clinician or organisation giving it (a doctor, a lab, a hospital). **Payer** — whoever settles the bill (an insurer, a government scheme, or the patient).\n\nEvery clinical event has all three because the same event answers three different questions: *what happened to me*, *what did I do and am I accountable for*, and *what is this going to cost and who owes it*. A design that models only the patient cannot produce a claim; one that models only the encounter cannot answer \"which of my patients is overdue\".\n\nIn FHIR these are `Patient`, `Practitioner`/`Organization` and `Coverage`, and the event that ties them is `Encounter` or `Claim`.",
    followUps: [
      { question: "Where does this break in practice?", answer: "The same human is often several records — one per hospital, per lab, per insurer. Identity resolution across organisations is the hardest unglamorous problem in the domain." },
      { question: "Is the payer relevant outside the US?", answer: "Yes, but it looks different: government schemes, corporate insurance, or self-pay. The role exists even when the billing is simple." },
    ],
    tags: ["patient", "provider", "payer", "domain", "basics"],
  },
  {
    id: "hc-ehr-emr",
    topic: "healthcare",
    subtopic: "Domain basics",
    level: "basic",
    mustKnow: true,
    question: "What is the difference between an EMR and an EHR?",
    answer:
      "An **EMR** (Electronic Medical Record) is one organisation's chart for a patient — what this hospital knows and did. An **EHR** (Electronic Health Record) is designed to follow the patient *across* organisations, so a discharge summary from one hospital is visible at the next.\n\nThe distinction matters to an integrator because it decides who owns identity. Inside an EMR the patient id is authoritative and stable. Across an EHR nothing is: you are matching on name, date of birth and identifiers that different systems format differently, and you will be wrong sometimes.\n\nIn practice most products marketed as EHRs are EMRs with an interface engine attached.",
    followUps: [
      { question: "What makes cross-organisation matching hard?", answer: "No shared key, transliterated names, dates entered as the local format, and duplicates created in a hurry at registration. Probabilistic matching with a review queue is the usual answer." },
    ],
    tags: ["ehr", "emr", "identity", "basics"],
  },
  {
    id: "hc-hospital-systems",
    topic: "healthcare",
    subtopic: "Domain basics",
    level: "basic",
    question: "What are HIS, LIS, RIS and PACS, and which one do you integrate with for a lab result?",
    answer:
      "- **HIS** — Hospital Information System. Admissions, beds, billing, the patient master index. The source of *who the patient is*.\n- **LIS** — Laboratory Information System. Orders, specimens, analysers, results. The source of *lab results*.\n- **RIS** — Radiology Information System. Imaging orders, scheduling, reports.\n- **PACS** — Picture Archiving and Communication System. The images themselves, in DICOM.\n\nFor a lab result you integrate with the **LIS**: the HIS sends an order (ORM/OMG), the LIS returns the result (ORU). RIS and PACS split the same way — the RIS holds the report text, PACS holds the pixels.\n\nThe integration mistake is assuming one system owns everything. Ask which system is authoritative for each field before designing anything.",
    diagram:
      "  HIS ──order (ORM)──▶ LIS ──▶ analyser\n   ▲                    │\n   └───result (ORU)──────┘\n\n  HIS ──order──▶ RIS ──▶ modality ──images──▶ PACS\n                  │                              ▲\n                  └──────report───────────────────┘",
    followUps: [
      { question: "Where does a device gateway sit?", answer: "Between the analyser or modality and the LIS/RIS, translating the device's protocol into HL7 and buffering when the upstream is down." },
    ],
    tags: ["his", "lis", "ris", "pacs", "integration"],
    relatedTools: ["device-link", "hl7-toolkit"],
  },
  {
    id: "hc-phi",
    topic: "healthcare",
    subtopic: "Security & privacy",
    level: "basic",
    mustKnow: true,
    question: "What counts as PHI, and where does it usually leak?",
    answer:
      "**PHI** is health information that can be tied to an individual. It is not only the diagnosis — the identifiers travelling with it count too: name, address, dates more precise than a year, phone, email, MRN, insurance number, device serial numbers, full-face images, and any other unique identifier. Health data plus *any* of those is PHI.\n\nIt leaks in the places nobody reviews:\n\n- **Logs.** `_logger.LogInformation(\"Processing {@Message}\", hl7)` writes an entire patient record to disk and, in a cloud deployment, to a log service.\n- **Exception messages** and stack traces that include the payload.\n- **Test data** copied from production \"just to reproduce it\".\n- **Support tickets and screenshots.**\n- **LLM prompts** — the newest one, and the easiest to do by accident.\n\nThe rule that catches most of this is *minimum necessary*: send the smallest set of fields that does the job.",
    language: "csharp",
    code:
      "// Leaks the whole message into the log sink\n_logger.LogInformation(\"Received {Message}\", raw);\n\n// Logs what you need to debug the interface, and nothing about the patient\n_logger.LogInformation(\n    \"Received {Type} control id {ControlId} from {Sender}, {Segments} segments\",\n    msh.MessageType, msh.ControlId, msh.SendingApplication, message.Segments.Count);",
    followUps: [
      { question: "Is a de-identified record still PHI?", answer: "Not if it is genuinely de-identified, but that bar is higher than deleting the name. Dates, rare diagnoses and small geographies re-identify people surprisingly easily." },
      { question: "What about the minimum-necessary rule?", answer: "Disclose only what the recipient needs. A billing system does not need the clinical note; a results portal does not need the insurance number." },
    ],
    tags: ["phi", "pii", "hipaa", "privacy", "logging"],
    relatedTools: ["healthcare-deidentifier", "log-viewer"],
  },
  {
    id: "hc-hipaa",
    topic: "healthcare",
    subtopic: "Security & privacy",
    level: "intermediate",
    mustKnow: true,
    question: "What does HIPAA actually require of a system you build?",
    answer:
      "HIPAA is a US law, but its requirements have become the default shape of health-data controls everywhere. What it means in engineering terms:\n\n- **Access control** — unique user identity, role-based access, and automatic logoff. No shared accounts.\n- **Audit controls** — a record of who looked at which patient, when. This is the requirement most often missed, and it is the one auditors check first.\n- **Integrity** — the record cannot be altered undetectably. Append-only history, not `UPDATE`.\n- **Transmission security** — TLS in transit; a plain MLLP socket across a hospital network is common and is a finding.\n- **Encryption at rest** — and key management that is not \"in the config file\".\n- **BAA** — a Business Associate Agreement with every vendor that touches PHI, cloud providers included.\n- **Breach notification** — you must be able to say *whose* data was exposed, which requires the audit trail you did not build.\n\nEquivalents elsewhere: India's DPDP Act, the EU's GDPR plus national health law, the UK's DSP Toolkit.",
    followUps: [
      { question: "Does using Azure make you compliant?", answer: "No. Azure signs a BAA and gives you compliant infrastructure; the access control, audit trail and minimum-necessary discipline are still yours to build." },
      { question: "What is the difference between the Privacy Rule and the Security Rule?", answer: "Privacy governs use and disclosure of PHI in any form; Security governs the technical and physical safeguards for electronic PHI specifically." },
    ],
    tags: ["hipaa", "compliance", "audit", "security"],
  },
  {
    id: "hc-fhir-what",
    topic: "healthcare",
    subtopic: "FHIR",
    level: "basic",
    mustKnow: true,
    question: "What is FHIR, and what are its building blocks?",
    answer:
      "FHIR (Fast Healthcare Interoperability Resources) is a REST API and data model for health data. Its unit is the **resource** — `Patient`, `Observation`, `Encounter`, `Condition`, `MedicationRequest` — each with a stable id, a JSON (or XML) representation, and a URL.\n\nThe pieces worth knowing:\n\n- **Resource** — one thing, identified by `/Patient/123`.\n- **Reference** — how resources point at each other: `\"subject\": { \"reference\": \"Patient/123\" }`.\n- **Bundle** — several resources in one payload; `searchset` for results, `transaction` for an all-or-nothing write.\n- **Search** — `GET /Observation?patient=123&code=http://loinc.org|718-7&date=ge2026-01-01`.\n- **Profile** — a national or vendor narrowing of a resource (US Core, IPS). Real conformance is always against a profile, never against base FHIR.\n- **Extension** — the sanctioned way to add a field, because the base resource cannot be edited.\n\nR4 is the version in production almost everywhere; R5 exists and is not what you will be integrating with.",
    language: "json",
    code:
      "{\n  \"resourceType\": \"Observation\",\n  \"id\": \"hgb-1\",\n  \"status\": \"final\",\n  \"code\": {\n    \"coding\": [{ \"system\": \"http://loinc.org\", \"code\": \"718-7\", \"display\": \"Hemoglobin\" }]\n  },\n  \"subject\": { \"reference\": \"Patient/100234\" },\n  \"effectiveDateTime\": \"2026-08-14T09:20:00+05:30\",\n  \"valueQuantity\": {\n    \"value\": 13.2,\n    \"unit\": \"g/dL\",\n    \"system\": \"http://unitsofmeasure.org\",\n    \"code\": \"g/dL\"\n  },\n  \"referenceRange\": [{ \"low\": { \"value\": 12.0 }, \"high\": { \"value\": 15.5 } }]\n}",
    followUps: [
      { question: "Why is the code a system plus a code, not a string?", answer: "\"Hemoglobin\" means nothing to a machine and is spelled differently everywhere. The system URL says which dictionary the code comes from, which is what makes it comparable across organisations." },
      { question: "What is a contained resource?", answer: "A resource with no independent existence, embedded inside its parent. Useful for something like a one-off specimen, and a trap if you later need to reference it." },
    ],
    tags: ["fhir", "rest", "resource", "bundle", "r4"],
    relatedTools: ["fhir-toolkit", "api-tester"],
  },
  {
    id: "hc-fhir-search",
    topic: "healthcare",
    subtopic: "FHIR",
    level: "intermediate",
    mustKnow: true,
    question: "How does FHIR search work, and what do _include, modifiers and chaining do?",
    answer:
      "Search is `GET /[Resource]?param=value`, returning a `Bundle` of type `searchset`.\n\n- **Prefixes** on ordered values: `date=ge2026-01-01`, `value-quantity=gt13`.\n- **Token parameters** take `system|code`: `code=http://loinc.org|718-7`. Leaving the system off matches any system, which is usually a bug.\n- **Modifiers**: `name:contains=pat`, `identifier:not=...`, `subject:missing=true`.\n- **Chaining** searches through a reference: `Observation?subject.name=Patel`.\n- **Reverse chaining**: `Patient?_has:Observation:patient:code=718-7` — patients who have such an observation.\n- **`_include` / `_revinclude`** pull related resources into the same Bundle, which is how you avoid N+1 round trips: `Observation?_include=Observation:subject`.\n- **Paging** is by `link` entries with `relation: next`. Never build the next URL yourself.\n\nThe performance trap: a server only supports the parameters its `CapabilityStatement` declares, and an unsupported parameter is *ignored*, not rejected — so a filter you thought was applied silently was not.",
    language: "bash",
    code:
      "# Haemoglobin results for one patient this year, with the patient inline\ncurl -H 'Accept: application/fhir+json' \\\n  'https://fhir.example.org/Observation?\\\npatient=100234&\\\ncode=http://loinc.org|718-7&\\\ndate=ge2026-01-01&\\\n_include=Observation:subject&\\\n_sort=-date&_count=50'",
    followUps: [
      { question: "How do you know what a server supports?", answer: "`GET /metadata` returns its CapabilityStatement, listing resources, interactions and search parameters. Read it before designing against a server." },
      { question: "Why is _count not a guarantee?", answer: "It is a hint. Servers may return fewer, and must be followed by the next link rather than by incrementing an offset." },
    ],
    tags: ["fhir", "search", "include", "chaining", "paging"],
    relatedTools: ["fhir-toolkit", "api-tester"],
  },
  {
    id: "hc-fhir-bundle",
    topic: "healthcare",
    subtopic: "FHIR",
    level: "intermediate",
    question: "What is the difference between a transaction Bundle and a batch Bundle?",
    answer:
      "Both POST a set of entries to the server root. The difference is atomicity.\n\n- **`batch`** — the entries are independent. Some may succeed and some may fail; you get a response entry per request with its own status.\n- **`transaction`** — all or nothing. If any entry fails the whole bundle is rolled back.\n\nA transaction also supports two things a batch does not: internal references (`urn:uuid:...`) so entries can point at each other before ids exist, and **conditional** operations — `ifNoneExist` for create, or a request URL with search parameters for update, which is how you get an upsert.\n\nUse a transaction when the resources only make sense together: a patient, the encounter and its observations from one lab report.",
    language: "json",
    code:
      "{\n  \"resourceType\": \"Bundle\",\n  \"type\": \"transaction\",\n  \"entry\": [\n    {\n      \"fullUrl\": \"urn:uuid:pat-1\",\n      \"resource\": { \"resourceType\": \"Patient\", \"identifier\": [{ \"system\": \"urn:mrn\", \"value\": \"100234\" }] },\n      \"request\": {\n        \"method\": \"POST\",\n        \"url\": \"Patient\",\n        \"ifNoneExist\": \"identifier=urn:mrn|100234\"\n      }\n    },\n    {\n      \"resource\": {\n        \"resourceType\": \"Observation\",\n        \"status\": \"final\",\n        \"subject\": { \"reference\": \"urn:uuid:pat-1\" }\n      },\n      \"request\": { \"method\": \"POST\", \"url\": \"Observation\" }\n    }\n  ]\n}",
    followUps: [
      { question: "What does ifNoneExist do exactly?", answer: "Creates only if the search finds nothing. If it finds one match the server returns that one; if it finds several it fails. It is the standard idempotent create." },
    ],
    tags: ["fhir", "bundle", "transaction", "idempotency"],
    relatedTools: ["fhir-toolkit"],
  },
  {
    id: "hc-fhir-vs-v2",
    topic: "healthcare",
    subtopic: "FHIR",
    level: "intermediate",
    mustKnow: true,
    question: "When would you choose HL7 v2 over FHIR — and why is v2 still everywhere?",
    answer:
      "Choose **v2** when you are integrating with what exists: an LIS, an analyser, a hospital interface engine. It is event-driven, push-based, and every vendor already speaks it. Choose **FHIR** for anything new that needs to be *queried* — an app, a portal, a report, an API for a partner.\n\nv2 survives because it is not a failure. It solved the real problem — a hospital's systems telling each other that something happened — cheaply, in the 1980s, and it still does. FHIR is better at a different problem: reading data on demand over the web with modern auth.\n\nMost real systems run both, with an interface engine translating. Being able to explain *that* rather than \"v2 is legacy\" is what a healthcare interview is checking.",
    diagram:
      "  analyser ──ASTM──▶ gateway ──HL7 v2 (MLLP)──▶ interface engine\n                                                       │\n                                                       ├──▶ LIS / HIS\n                                                       └──FHIR──▶ apps, portal, partners",
    followUps: [
      { question: "Can you translate v2 to FHIR automatically?", answer: "Partially. The unambiguous fields map cleanly (PID→Patient, OBX→Observation); the rest needs local knowledge because v2 lets each site use fields differently. A wrong mapping is worse than an absent one." },
    ],
    tags: ["fhir", "hl7", "integration", "strategy"],
    relatedTools: ["hl7-toolkit", "fhir-toolkit"],
  },
  {
    id: "hc-v2-anatomy",
    topic: "healthcare",
    subtopic: "HL7 v2",
    level: "basic",
    mustKnow: true,
    question: "Explain the anatomy of an HL7 v2 message.",
    answer:
      "A message is **segments** separated by carriage returns. Each segment starts with a three-letter name and is split into **fields** by `|`, **components** by `^`, **repetitions** by `~`, and **subcomponents** by `&`. `\\` escapes.\n\n`MSH` is always first and declares the separators in its own first two fields — `MSH-1` is the field separator, `MSH-2` is the other four characters. That is why a parser must read the separators from the message rather than assume them.\n\nKey MSH fields: sending application/facility (3,4), receiving (5,6), timestamp (7), **message type** (9, e.g. `ORU^R01`), **control id** (10 — the id you ACK), processing id (11), version (12).\n\nCommon segments: `PID` patient, `PV1` visit, `ORC` order control, `OBR` order/observation request, `OBX` one result, `NTE` note, `MSA` acknowledgement.\n\nField numbering starts at 1 *after* the segment name — except in MSH, where the separator counts as MSH-1. This off-by-one is the single most common v2 bug.",
    language: "text",
    code:
      "MSH|^~\\&|LIS|LAB|EMR|HOSP|20260814093000||ORU^R01|MSG0001|P|2.5\rPID|1||100234^^^HOSP^MR||PATEL^ANJALI||19880412|F\rOBR|1|ORD9001|ACC55012|CBC^Complete Blood Count^L\rOBX|1|NM|718-7^Hemoglobin^LN||13.2|g/dL|12.0-15.5|N|||F",
    followUps: [
      { question: "What is a Z-segment?", answer: "A site-specific segment (Z followed by two letters) for data the standard has no place for. Legal, universal, and the reason no two v2 interfaces are identical." },
      { question: "Why does OBX-5 vary in type?", answer: "OBX-2 declares the value type — NM numeric, ST string, TX text, CE coded. The parser must branch on it rather than assume a number." },
    ],
    tags: ["hl7", "v2", "msh", "obx", "parsing"],
    relatedTools: ["hl7-toolkit"],
  },
  {
    id: "hc-v2-ack",
    topic: "healthcare",
    subtopic: "HL7 v2",
    level: "intermediate",
    mustKnow: true,
    question: "What do AA, AE and AR mean, and what is the difference between an accept ACK and an application ACK?",
    answer:
      "The ACK carries an `MSA` segment: `MSA|<code>|<control id of the original>`.\n\n- **AA** — Application Accept. Processed successfully.\n- **AE** — Application Error. Understood, but something is wrong with the content: send it again fixed.\n- **AR** — Application Reject. Cannot process it at all: wrong type, wrong version, not for me. Resending unchanged will not help.\n\nThe distinction that matters in design is **accept ACK versus application ACK** (`MSH-15`/`MSH-16`). An accept ACK says \"I have the bytes and will not lose them\"; an application ACK says \"I have processed it\". Enhanced mode lets the receiver return the accept ACK immediately and the application ACK later.\n\nIf you send only an application ACK, your sender is blocked for as long as your processing takes — which is how a slow database ends up stalling an analyser in the lab.",
    diagram:
      "  original ──▶ receiver\n              │  MSA|AA   accepted and processed\n              │  MSA|AE   error — fix and resend\n              └  MSA|AR   rejected — resending will not help",
    followUps: [
      { question: "What do you do with an AE in production?", answer: "Dead-letter it with the reason and alert. Automatic retry of an AE loops for ever, because the content is what is wrong." },
      { question: "Which control id goes in MSA-2?", answer: "The original message's MSH-10, not a new one. That is the only thing tying the ACK to what it acknowledges." },
    ],
    tags: ["hl7", "ack", "msa", "error-handling"],
    relatedTools: ["hl7-toolkit", "device-link"],
  },
  {
    id: "hc-v2-mllp",
    topic: "healthcare",
    subtopic: "HL7 v2",
    level: "intermediate",
    mustKnow: true,
    question: "What is MLLP, and what goes wrong with it?",
    answer:
      "MLLP (Minimal Lower Layer Protocol) is how v2 travels over TCP. One message is wrapped:\n\n`<VT>` (0x0B) … message … `<FS>` (0x1C) `<CR>` (0x0D)\n\nThat is the entire protocol. Everything that goes wrong follows from how little it is:\n\n- **It is a stream, not a datagram.** One `read()` can return half a message, or two messages, or one and a half. A reader that treats a read as a message works on the bench and loses results in production.\n- **No length prefix**, so a lost `<FS>` means the reader waits for ever. You need a size cap and a timeout.\n- **No built-in security.** Plain TCP across a hospital network; TLS is bolted on (MLLPS) or tunnelled.\n- **Nagle's algorithm** will hold the trailing `<FS><CR>` waiting for more data. Set `TCP_NODELAY`.\n- **One in flight at a time** in classic mode: send, wait for the ACK, then send the next. Pipelining without agreement corrupts the pairing.",
    language: "csharp",
    code:
      "// The reader has to accumulate, not assume\nconst byte VT = 0x0B, FS = 0x1C, CR = 0x0D;\nvar buffer = new List<byte>();\n\nwhile ((read = await stream.ReadAsync(chunk)) > 0)\n{\n    buffer.AddRange(chunk[..read]);\n\n    int end;\n    while ((end = IndexOfFrameEnd(buffer)) >= 0)   // finds FS followed by CR\n    {\n        var start = buffer.IndexOf(VT);\n        var message = Encoding.UTF8.GetString(buffer.ToArray(), start + 1, end - start - 1);\n        buffer.RemoveRange(0, end + 2);\n        await HandleAsync(message);\n    }\n\n    if (buffer.Count > MaxMessageBytes) throw new ProtocolException(\"No frame end; is the peer speaking MLLP?\");\n}",
    followUps: [
      { question: "How do you test an MLLP interface without the other system?", answer: "Run both ends yourself: a listener that auto-ACKs and a client that sends. DevHelper's Device Link does exactly this, including sending AE/AR to see whether your side handles a rejection." },
    ],
    tags: ["hl7", "mllp", "tcp", "framing", "integration"],
    relatedTools: ["device-link", "hl7-toolkit"],
  },
  {
    id: "hc-v2-messages",
    topic: "healthcare",
    subtopic: "HL7 v2",
    level: "intermediate",
    question: "Which HL7 v2 message types will you actually meet, and what triggers them?",
    answer:
      "The type is `MSH-9` as `message^trigger`:\n\n- **ADT** — admit/discharge/transfer, and the source of patient demographics. `A01` admit, `A03` discharge, `A04` register, `A08` update, `A40` merge two patient records.\n- **ORM^O01** / **OMG^O19** — a new order (older and newer forms).\n- **ORU^R01** — an observation result. The lab and device workhorse.\n- **SIU** — scheduling.\n- **MDM** — documents (a report, a discharge summary).\n- **DFT** — billing detail.\n- **ACK** — the acknowledgement.\n\n`A08` and `A40` are the ones that cause incidents. An update rewrites demographics you may have cached, and a merge tells you two patient ids are one person — if you ignore it, you will keep filing results under a record that no longer exists.",
    followUps: [
      { question: "Why do some sites send A08 for everything?", answer: "Because it is safe for the sender: a generic update always applies. It pushes the cost onto the receiver, who must diff to find out what actually changed." },
    ],
    tags: ["hl7", "adt", "oru", "orm", "triggers"],
    relatedTools: ["hl7-toolkit"],
  },
  {
    id: "hc-terminology",
    topic: "healthcare",
    subtopic: "Terminology",
    level: "intermediate",
    mustKnow: true,
    question: "ICD-10, SNOMED CT and LOINC — which is which, and why is mapping the hard part?",
    answer:
      "- **ICD-10** — diagnoses, for billing and statistics. Coarse, hierarchical, jurisdiction-flavoured (ICD-10-CM in the US).\n- **SNOMED CT** — clinical meaning, for recording what a clinician actually means. Enormous, a proper ontology with relationships, licensed per country.\n- **LOINC** — *observations*: which test was performed, and in what units. This is the lab and device one.\n\nThe hard part is that no source system speaks them natively. An analyser sends `HGB`, a second analyser sends `HB`, the LIS calls it `CBC-HGB`, and all three mean LOINC `718-7`. Every integration therefore carries a local-code-to-standard-code map, maintained by a human, that is never complete.\n\nA production-grade mapper needs three things nobody builds at first: a record of *which* codes are unmapped, a reason each mapping was made, and a way to change one without rewriting history.",
    diagram:
      "  analyser \"HGB\"  ─┐\n  LIS \"CBC-HGB\"   ─┼──▶ local map ──▶ LOINC 718-7 (Hemoglobin [Mass/volume] in Blood)\n  partner \"HB\"    ─┘                        │\n                                            └──▶ comparable across organisations",
    followUps: [
      { question: "Why not map to SNOMED for lab results?", answer: "SNOMED can express the concept, but LOINC also fixes the specimen, the method and the units — which is what makes two results comparable." },
      { question: "What is a value set?", answer: "A named subset of codes valid in one place, e.g. \"observation statuses accepted by this interface\". FHIR profiles bind elements to value sets." },
    ],
    tags: ["loinc", "snomed", "icd-10", "terminology", "mapping"],
    relatedTools: ["medical-text-utility", "hl7-toolkit"],
  },
  {
    id: "hc-oauth",
    topic: "healthcare",
    subtopic: "Identity & access",
    level: "intermediate",
    mustKnow: true,
    question: "Explain OAuth2 and OIDC, and what the access token actually proves.",
    answer:
      "**OAuth2** is authorisation: it issues an **access token** that says a client may do certain things on behalf of someone. **OIDC** is a layer on top for authentication: it adds an **id token**, a JWT describing *who* signed in.\n\nThe flow to know is **authorization code with PKCE**: the client sends the user to the identity provider, gets a short-lived code back on a registered redirect, then exchanges the code plus a proof key for tokens. PKCE stops a stolen code being redeemed by anyone else, and it is now recommended for confidential clients too, not only mobile.\n\nWhat the access token proves: that *this* issuer authenticated someone at some point and granted *these* scopes to *this* client for *this* audience, until it expires. It proves nothing about the current state of that user — which is why revocation is a hard problem and why token lifetimes are short.\n\nValidate: signature against the issuer's JWKS, `iss`, `aud`, `exp`/`nbf`, and the scopes. Skipping `aud` is how a token minted for another API gets accepted by yours.",
    language: "csharp",
    code:
      "builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)\n    .AddJwtBearer(o =>\n    {\n        o.Authority = \"https://login.microsoftonline.com/<tenant>/v2.0\";\n        o.TokenValidationParameters = new TokenValidationParameters\n        {\n            ValidateIssuer = true,\n            ValidateAudience = true,          // the check most often left off\n            ValidAudience = \"api://fhir-gateway\",\n            ValidateLifetime = true,\n            ClockSkew = TimeSpan.FromSeconds(30),\n        };\n    });",
    followUps: [
      { question: "Why not use the implicit flow?", answer: "It returns tokens in the URL fragment, where they land in browser history and logs. It is deprecated; use authorization code with PKCE." },
      { question: "What is the difference between a scope and a role?", answer: "A scope is what the client may ask for; a role is what the user is. Both usually have to be checked — the client being allowed does not mean this user is." },
    ],
    tags: ["oauth2", "oidc", "jwt", "identity", "security"],
    relatedTools: ["jwt-decoder", "api-tester"],
  },
  {
    id: "hc-smart",
    topic: "healthcare",
    subtopic: "Identity & access",
    level: "advanced",
    question: "What is SMART on FHIR, and what does launch context mean?",
    answer:
      "SMART on FHIR is OAuth2 profiled for health apps, so the same app can be launched from any conforming EHR.\n\nIts additions:\n\n- **Scopes with a clinical shape**: `patient/Observation.read`, `user/*.read`, `system/Patient.read`. The prefix says whose data — the patient in context, everything this user can see, or backend access with no user at all.\n- **Launch context**: an **EHR launch** starts inside the EHR, which passes a `launch` parameter; the token response then carries context such as `patient`, `encounter` and `need_patient_banner`. A **standalone launch** starts from the app, and the user picks the patient.\n- **Discovery** at `/.well-known/smart-configuration`, listing the authorize and token endpoints and the capabilities supported.\n- **Backend services** use `client_credentials` with a signed JWT assertion, for server-to-server jobs with no human present.\n\nThe practical point: the token tells the app *which patient is on screen*, so it never has to ask — and must never assume it can read another.",
    followUps: [
      { question: "Why does the app need need_patient_banner?", answer: "So it knows whether the host EHR is already showing who the patient is. Two banners is a safety problem, not a cosmetic one." },
    ],
    tags: ["smart-on-fhir", "oauth2", "scopes", "launch", "fhir"],
    relatedTools: ["jwt-decoder", "fhir-toolkit"],
  },
  {
    id: "hc-consent",
    topic: "healthcare",
    subtopic: "Security & privacy",
    level: "advanced",
    question: "How do you design an audit trail that survives an actual audit?",
    answer:
      "The requirement is to answer, months later: *who saw which patient's data, when, and why*. That is harder than it sounds because the interesting accesses are reads, and reads are what applications do not log.\n\nWhat works:\n\n- **Log at the point of authorisation**, not in the UI. One place decides access; that is the place that knows the answer.\n- **Record subject, actor, action, outcome, purpose and time.** FHIR has `AuditEvent` for exactly this shape; use it or something like it.\n- **Append-only storage**, separate from the application database, with its own retention. If an application bug can rewrite the audit trail, it is not one.\n- **Log the query, not the result.** \"Searched Patient by name=PAT*\" is the useful record; storing the returned records duplicates the PHI you are trying to protect.\n- **Break-glass** — emergency access is a real requirement. Allow it, mark it loudly, and review every use.\n\nThe test: pick a patient at random and produce their access history in under an hour. If you cannot, you do not have an audit trail.",
    followUps: [
      { question: "Should the audit log contain PHI?", answer: "As little as possible — identifiers, not content. It has to be retained for years and read by people who are not clinicians." },
    ],
    tags: ["audit", "hipaa", "auditevent", "compliance", "design"],
  },
  {
    id: "hc-interface-engine",
    topic: "healthcare",
    subtopic: "Integration practice",
    level: "intermediate",
    question: "What does an interface engine do, and why does every hospital have one?",
    answer:
      "An interface engine (Mirth Connect, Rhapsody, InterSystems, Cloverleaf) sits between systems and does four things:\n\n1. **Transport** — speaks MLLP, files, SFTP, HTTP, database polling, all at once.\n2. **Translation** — v2 to v2 (because two vendors use the fields differently), v2 to FHIR, HL7 to a proprietary API.\n3. **Routing** — one inbound result fans out to the EMR, the billing system, the data warehouse and the portal.\n4. **Resilience** — queues, retries and a replay of yesterday's messages when a downstream was down.\n\nHospitals have one because the alternative is N×M point-to-point interfaces, each with its own retry logic and its own outage. The engine turns that into N+M.\n\nWhat it does *not* give you is understanding: an engine will happily route a message whose meaning your system gets wrong. Mapping is still a human decision.",
    diagram:
      "  Without an engine            With an engine\n  LIS ─┬─▶ EMR                 LIS ─┐          ┌─▶ EMR\n       ├─▶ billing             RIS ─┼─▶ engine ┼─▶ billing\n       └─▶ warehouse           HIS ─┘          └─▶ warehouse\n  (N x M interfaces)                  (N + M)",
    followUps: [
      { question: "Where do you put business logic — engine or service?", answer: "In the service. Logic in channel scripts is invisible to source control, hard to test and impossible to reason about at three in the morning." },
    ],
    tags: ["interface-engine", "mirth", "routing", "integration", "architecture"],
    relatedTools: ["device-link", "hl7-toolkit"],
  },
  {
    id: "hc-idempotent-results",
    topic: "healthcare",
    subtopic: "Integration practice",
    level: "advanced",
    mustKnow: true,
    question: "The same ORU arrives twice. What should your system do, and how do you make that true?",
    answer:
      "It must file one result, not two — and if the second copy differs, the later one must win without erasing the fact that the first existed.\n\nDuplicates are not an edge case here. A sender that does not get an ACK in time resends; an interface engine replays a queue after an outage; an operator reprocesses yesterday's file. At-least-once is the delivery guarantee you actually have.\n\nWhat makes it safe:\n\n- **A natural key.** For a lab result, filler order number (OBR-3) plus observation identifier (OBX-3) plus sub-id (OBX-4). `MSH-10` is *not* it — a resend may carry a new control id.\n- **Upsert on that key**, comparing `OBX-11` result status: a corrected result (`C`) supersedes a final one (`F`), and a preliminary (`P`) must never overwrite a final.\n- **Keep the history.** Amended results are clinically important; overwriting hides that the number changed after someone acted on it.\n- **Record the message id you processed** so you can answer \"did we get it?\" without inspecting the data.",
    language: "sql",
    code:
      "-- One row per (order, analyte, sub-id); later status wins, history preserved\nMERGE INTO Result AS target\nUSING (SELECT @FillerOrderNo AS FillerOrderNo, @ObsId AS ObsId, @SubId AS SubId,\n              @Value AS Value, @Status AS Status, @ObservedAt AS ObservedAt) AS src\n   ON target.FillerOrderNo = src.FillerOrderNo\n  AND target.ObsId        = src.ObsId\n  AND target.SubId        = src.SubId\nWHEN MATCHED AND src.Status <> 'P' AND src.ObservedAt >= target.ObservedAt THEN\n  UPDATE SET Value = src.Value, Status = src.Status, ObservedAt = src.ObservedAt\nWHEN NOT MATCHED THEN\n  INSERT (FillerOrderNo, ObsId, SubId, Value, Status, ObservedAt)\n  VALUES (src.FillerOrderNo, src.ObsId, src.SubId, src.Value, src.Status, src.ObservedAt);",
    followUps: [
      { question: "Why not deduplicate on a hash of the whole message?", answer: "Because a resend often differs in the timestamp or control id while meaning the same result — and a genuine correction differs in the value while needing to be applied." },
    ],
    tags: ["idempotency", "oru", "duplicates", "hl7", "design"],
    relatedTools: ["hl7-toolkit", "database-toolkit"],
  },
  {
    id: "hc-units",
    topic: "healthcare",
    subtopic: "Integration practice",
    level: "intermediate",
    question: "Why are units and reference ranges a safety issue, not a formatting one?",
    answer:
      "Because the same number means different things in different units, and a clinician reading a portal has no way to tell which one your pipeline assumed.\n\nGlucose is the standard example: 100 mg/dL is normal, 100 mmol/L is not survivable. Haemoglobin, creatinine and calcium all have the same split between conventional and SI units.\n\nWhat this means for design:\n\n- **Never store a bare number.** Store value *plus* unit, and prefer UCUM codes (`mg/dL`, `mmol/L`) over free text where `mg/dl`, `MG/DL` and `mgs%` all appear.\n- **Convert explicitly, per analyte**, because the factor depends on molecular weight — there is no generic mg/dL to mmol/L conversion.\n- **Carry the reference range from the source.** Ranges differ by analyser, by age and by sex; a range you hard-code is wrong for someone.\n- **Carry the abnormal flag** (`OBX-8`) rather than recomputing it. The lab decided it, and the lab is accountable for it.\n\nIf a conversion is not certain, show the original value and unit and refuse to convert. An unconverted result is an inconvenience; a wrongly converted one is a clinical incident.",
    followUps: [
      { question: "What is UCUM?", answer: "Unified Code for Units of Measure — a formal syntax so units are machine-comparable. FHIR Quantity uses it via system http://unitsofmeasure.org." },
    ],
    tags: ["units", "ucum", "reference-range", "safety", "loinc"],
    relatedTools: ["fhir-toolkit", "hl7-toolkit"],
  },
  {
    id: "hc-patient-matching",
    topic: "healthcare",
    subtopic: "Integration practice",
    level: "advanced",
    question: "How do you match a patient across two systems that share no identifier?",
    answer:
      "You do it probabilistically, and you design for being wrong in both directions.\n\n- **Deterministic first.** If both sides carry a national id, an MRN from the same assigning authority, or an insurance number, use it. `PID-3` is a repeating field with an assigning authority for exactly this reason — `100234^^^HOSP^MR` is not the same id as `100234^^^LAB^MR`.\n- **Then probabilistic.** Score across name (phonetic, transliteration-aware), date of birth, sex, address, phone. Weight by how discriminating each field is: a shared date of birth means much more than a shared surname.\n- **Three outcomes, not two.** Auto-match above a threshold, auto-reject below one, and a *human review queue* in between. A system with only a threshold quietly merges two people.\n- **A false merge is far worse than a false split.** Merging two patients puts one person's results in another's chart. Design the thresholds accordingly, and make unmerge possible.\n- **Handle A40 merges** from upstream, and keep the old identifier resolvable afterwards.",
    followUps: [
      { question: "What is an MPI?", answer: "A Master Patient Index — the service that owns this matching and issues an enterprise id. Buying one is usually right; the hard part is data quality, not the algorithm." },
    ],
    tags: ["patient-matching", "mpi", "identity", "pid", "design"],
  },
  {
    id: "hc-dicom-basics",
    topic: "healthcare",
    subtopic: "Imaging",
    level: "intermediate",
    question: "What is DICOM, and how is a study structured?",
    answer:
      "DICOM is both a file format and a network protocol for medical imaging. The file is unusual in that the pixels and the metadata are the *same* file — a DICOM object is a list of tagged attributes, one of which happens to be the image data.\n\nThe hierarchy:\n\n- **Patient** → **Study** (one visit for one purpose, `StudyInstanceUID`) → **Series** (one acquisition, `SeriesInstanceUID`) → **Instance** (one image or frame, `SOPInstanceUID`).\n\nThose three UIDs are globally unique and are the join keys for everything. Tags are `(group,element)` pairs: `(0010,0010)` PatientName, `(0008,0060)` Modality, `(0020,000D)` StudyInstanceUID.\n\nTwo consequences that catch people out:\n\n- **The metadata contains PHI**, in the file, embedded — and sometimes burnt into the pixels themselves on ultrasound and screenshots. De-identifying DICOM means both.\n- **Transfer syntax matters.** The same image can be raw, JPEG lossless or JPEG 2000; a receiver that does not negotiate the right syntax gets nothing useful.",
    diagram:
      "  Patient\n   └── Study        (0020,000D)  one visit, e.g. \"CT chest\"\n        └── Series  (0020,000E)  one acquisition/sequence\n             └── Instance (0008,0018)  one image",
    followUps: [
      { question: "What is DICOMweb?", answer: "The HTTP form: QIDO-RS to query, WADO-RS to retrieve, STOW-RS to store. Much easier to work with than the classic protocol, and what Azure's DICOM service exposes." },
    ],
    tags: ["dicom", "imaging", "pacs", "uid", "phi"],
  },
  {
    id: "hc-privacy-by-design",
    topic: "healthcare",
    subtopic: "Security & privacy",
    level: "advanced",
    question: "You need to send patient data to an LLM. What has to happen first?",
    answer:
      "Assume the prompt leaves the building, is logged somewhere, and may be read by a human. Every control follows from that.\n\n1. **De-identify before the call, not inside the provider.** Strip names, MRNs, dates finer than the year, addresses, phone numbers, device serials. Do it in code you can test, and show the operator exactly what was removed.\n2. **Verify the residue.** Run the de-identified text through the detector a second time and refuse to send if anything matches. A de-identifier that cannot fail closed is decoration.\n3. **Know where it runs.** Azure OpenAI keeps data in your tenant and region and does not train on it; a public API endpoint is a different legal question and needs a BAA.\n4. **Log what you sent**, redacted, so you can answer what left.\n5. **Never present output as clinical advice.** Cite sources, mark it as generated, keep a human in the loop, and make refusal an acceptable answer.\n\nThe engineering point: this is a pipeline stage with tests, not a policy document.",
    diagram:
      "  note ──▶ de-identify ──▶ verify residue ──▶ prompt ──▶ model\n              │                    │                          │\n              └─ report removed    └─ block on any match      └─ cite + mark generated",
    followUps: [
      { question: "Is a de-identified note still risky?", answer: "Yes. Rare diagnoses, unusual ages and small locations re-identify people. Combine de-identification with contractual and access controls rather than relying on it alone." },
    ],
    tags: ["ai", "phi", "de-identification", "llm", "compliance"],
    relatedTools: ["healthcare-deidentifier", "error-explainer"],
  },
  {
    id: "hc-order-lifecycle",
    topic: "healthcare",
    subtopic: "Integration practice",
    level: "intermediate",
    mustKnow: true,
    question: "Walk through the lifecycle of a lab order from request to result.",
    answer:
      "1. **Order placed** in the HIS/EMR. It gets a *placer* order number — the ordering system's id.\n2. **ORM/OMG sent** to the LIS. The LIS assigns a *filler* order number, its own id. Both travel together from here on; confusing them is a classic bug.\n3. **Specimen collected**, labelled with an accession number, and received in the lab.\n4. **Analyser runs it** — the LIS downloads the worklist to the device, or the device queries by barcode (host query).\n5. **Result returns** from the analyser over ASTM or a proprietary protocol, into the LIS.\n6. **Technologist validates.** Preliminary (`P`) results may be released; final (`F`) requires validation.\n7. **ORU^R01 to the EMR**, filed against the original order.\n8. **Correction** later becomes another ORU with status `C`, which must supersede, not duplicate.\n\nThe three ids — placer, filler, accession — are what makes tracing an order possible. A system that keeps only one of them cannot answer \"where is my result?\".",
    diagram:
      "  EMR ──ORM (placer #)──▶ LIS ──worklist──▶ analyser\n   ▲                        │                     │\n   │                        │◀───ASTM result──────┘\n   └───ORU (filler #, accession, status F)───┘",
    followUps: [
      { question: "What is a host query?", answer: "The analyser asks the LIS what to run for the barcode it just scanned, rather than being told in advance. It avoids a stale worklist but needs the LIS to answer within seconds." },
    ],
    tags: ["order", "oru", "orm", "lis", "workflow"],
    relatedTools: ["device-link", "trace-explorer"],
  },
  {
    id: "hc-testing-interfaces",
    topic: "healthcare",
    subtopic: "Integration practice",
    level: "intermediate",
    question: "How do you test a healthcare interface when you cannot touch production and have no device?",
    answer:
      "- **Own both ends.** Run a listener that ACKs and a sender that transmits, so the protocol path is exercised without the other party. This catches framing, encoding and ACK-pairing faults, which are most of them.\n- **Keep a corpus of real messages**, de-identified once, checked into the repository. Synthetic messages agree with your parser by construction; real ones have the Z-segments, the empty fields and the odd encodings that break it.\n- **Test the failures deliberately.** Send an AE and an AR and see whether your side dead-letters or loops. Kill the connection mid-message. Send two messages in one packet. Send a truncated one.\n- **Replay a captured session** at its original timing against your parser.\n- **Assert on meaning, not bytes.** \"Patient 100234 has a haemoglobin of 13.2 g/dL, status final\" survives a vendor changing an optional field; a byte-for-byte comparison does not.\n\nDe-identify the corpus once, at capture time. A repository of real PHI is a breach waiting for a public mirror.",
    followUps: [
      { question: "What is the highest-value single test?", answer: "Two messages arriving in one TCP read. It is trivial to write, it happens constantly in production, and a surprising number of interfaces silently drop the second one." },
    ],
    tags: ["testing", "interfaces", "hl7", "quality"],
    relatedTools: ["device-link", "healthcare-deidentifier", "hl7-toolkit"],
  },
];
