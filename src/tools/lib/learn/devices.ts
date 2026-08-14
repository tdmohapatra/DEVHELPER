/**
 * Medical device integration cards.
 *
 * Device work is where healthcare software stops being a web application. The
 * peer is a machine that was designed in 2004, cannot be upgraded, has no
 * retry logic worth the name, and is attached to a patient. That constraint —
 * not the protocol syntax — is what these cards are about.
 *
 * Most of them can be practised in Device Link, which is the point: the
 * difference between reading that MLLP has no length prefix and watching a
 * reader stall on a missing one is the entire lesson.
 */

import type { Question } from "./types";

export const DEVICE_QUESTIONS: Question[] = [
  {
    id: "dev-gateway",
    topic: "devices",
    subtopic: "Architecture",
    level: "basic",
    mustKnow: true,
    question: "What is a device gateway, and why can devices not talk to the LIS directly?",
    answer:
      "A gateway sits between the devices and the clinical system and does the work no device does for itself:\n\n- **Protocol translation** — ASTM, proprietary serial, HL7, MQTT, a vendor SDK, all arriving in different shapes and leaving as one.\n- **Buffering.** The LIS goes down for maintenance; the analyser keeps running. Something has to hold those results, and the analyser will not.\n- **Identity.** A device knows a sample barcode, not a patient. The gateway resolves it against the order.\n- **Normalisation.** Local test codes to LOINC, device units to canonical units, device flags to standard abnormal flags.\n- **A single security boundary.** Devices sit on a segmented network and cannot be patched; the gateway is the only thing that crosses.\n\nWithout it, every device becomes a bespoke integration in the LIS, and every LIS outage becomes lost results.",
    diagram:
      "  analyser ─serial──┐\n  analyser ─TCP─────┼─▶ gateway ─┬─ buffer (disk queue)\n  monitor  ─MQTT────┘            ├─ normalise (codes, units)\n                                 ├─ resolve identity (barcode → order)\n                                 └─▶ HL7 ORU ──▶ LIS / EMR",
    followUps: [
      { question: "Where should the buffer live?", answer: "On disk, on the gateway, surviving a restart. An in-memory queue loses exactly the results you most need — the ones produced while the upstream was down." },
      { question: "Should the gateway ever drop data?", answer: "No. It may refuse to accept more, and it may alert loudly, but silently discarding a patient result is not an option. Fill the disk and shout." },
    ],
    tags: ["gateway", "architecture", "buffering", "integration"],
    relatedTools: ["device-link"],
  },
  {
    id: "dev-astm-e1381",
    topic: "devices",
    subtopic: "ASTM",
    level: "intermediate",
    mustKnow: true,
    question: "Explain the ASTM E1381 handshake and framing.",
    answer:
      "E1381 is the low-level transport; E1394 is the record content that travels inside it. The handshake is a strict, half-duplex conversation:\n\n1. **Establishment** — the sender transmits `<ENQ>`. The receiver replies `<ACK>` to grant the line, or `<NAK>` if it is not ready.\n2. **Transfer** — one frame at a time: `<STX>` FN text `<ETX|ETB>` C1 C2 `<CR><LF>`. The receiver replies `<ACK>` for a good frame or `<NAK>` to demand it again.\n3. **Termination** — `<EOT>` releases the line.\n\nThe details that bite:\n\n- **Frame numbers cycle 1–7 then 0**, across the whole session, not per record.\n- **The checksum** is the 8-bit sum of everything from the frame number through the terminating `<ETX>`/`<ETB>`, as two upper-case hex digits.\n- **`<ETB>` means \"more to come\"** — a record longer than 240 characters is split, and only the final frame carries `<ETX>`.\n- **A NAK means resend that frame byte for byte.** Rebuilding it is how an off-by-one in the frame number gets in.\n- **Contention**: if both ends send `<ENQ>` at once, one must yield, or the link deadlocks.\n- **Six retries** and then give up, with timeouts around 15 seconds.",
    diagram:
      "  sender                receiver\n    │ ──── <ENQ> ────────▶ │\n    │ ◀──── <ACK> ──────── │\n    │ ─ <STX>1H|...<ETX>c1c2<CR><LF> ─▶ │\n    │ ◀──── <ACK> ──────── │\n    │ ─ <STX>2R|...<ETX>c1c2<CR><LF> ─▶ │\n    │ ◀──── <NAK> ──────── │  (resend frame 2, unchanged)\n    │ ─ <STX>2R|...<ETX>c1c2<CR><LF> ─▶ │\n    │ ◀──── <ACK> ──────── │\n    │ ──── <EOT> ────────▶ │",
    followUps: [
      { question: "Why is the frame text capped at 240 characters?", answer: "So a NAK costs one small retransmission rather than a whole record, on a link with no error correction of its own." },
      { question: "What happens if you ACK a frame you did not understand?", answer: "The sender moves on and the result is lost. NAK is not an error path to avoid — it is the only way to ask for the data again." },
    ],
    tags: ["astm", "e1381", "framing", "checksum", "serial"],
    relatedTools: ["astm-toolkit", "device-link"],
  },
  {
    id: "dev-astm-e1394",
    topic: "devices",
    subtopic: "ASTM",
    level: "intermediate",
    question: "What do the ASTM E1394 record types mean?",
    answer:
      "Records are `|`-delimited, one letter identifying the type, in a fixed hierarchy:\n\n- **H** — header. Sender, receiver, version, timestamp. Also declares the delimiters, like MSH does in HL7.\n- **P** — patient. Repeats per patient in the message.\n- **O** — order (test request) for that patient.\n- **R** — result for that order. This is where the number is.\n- **C** — comment. Attaches to whatever preceded it.\n- **Q** — query, when the analyser asks the LIS what to run.\n- **L** — terminator. Always last.\n\nSequence numbers restart within their parent: patient 1's orders are 1, 2, 3, and patient 2's orders start again at 1.\n\nThe field that matters most is the test identifier in `R-3`, usually `^^^CODE` — a manufacturer's local code that has to be mapped to LOINC before the result means anything outside that lab.",
    language: "text",
    code:
      "H|\\^&|||Analyser^1.0|||||LIS||P|1|20260814093000\nP|1||100234||PATEL^ANJALI||19880412|F\nO|1|ACC55012||^^^CBC|R||20260814092000\nR|1|^^^HGB|13.2|g/dL|12.0-15.5|N||F||20260814093000\nR|2|^^^WBC|7.4|10*3/uL|4.0-11.0|N||F||20260814093000\nL|1|N",
    followUps: [
      { question: "How do you know whether a result is final?", answer: "The result status field — F final, P preliminary, C correction. Same discipline as HL7 OBX-11: a preliminary must never overwrite a final." },
    ],
    tags: ["astm", "e1394", "records", "lis", "results"],
    relatedTools: ["astm-toolkit"],
  },
  {
    id: "dev-serial",
    topic: "devices",
    subtopic: "Serial",
    level: "basic",
    mustKnow: true,
    question: "What do you need to know about RS-232 to connect an analyser?",
    answer:
      "You need five settings, and getting any of them wrong produces garbage rather than an error:\n\n- **Baud** — 9600 is the common default; 19200 and 38400 appear.\n- **Data bits** — 8 normally, but **7 is still common on lab analysers**, which matters because ASTM is ASCII and fits in 7.\n- **Parity** — none with 8 data bits, even with 7. \"7-E-1\" and \"8-N-1\" are the two configurations you will meet.\n- **Stop bits** — 1 almost always.\n- **Flow control** — usually none; some devices want XON/XOFF, very few want RTS/CTS.\n\nThe practical traps:\n\n- **A wrong data-bit setting looks like corrupted text**, not a failure. Every eighth character is mangled and checksums fail.\n- **Cabling.** A null-modem cable crosses TX and RX; a straight-through does not. Both exist in every hospital drawer and they look identical.\n- **Serial-over-TCP converters** (Moxa and similar) are extremely common — the analyser is serial, but you connect to an IP address. Same protocol, different transport.\n- **The port is exclusive.** One process holds it; a stray terminal session blocks your service.",
    diagram:
      "  analyser ──RS-232──▶ [Moxa converter] ──TCP──▶ gateway\n  8-N-1 or 7-E-1                       :4001",
    followUps: [
      { question: "How do you tell a wrong baud rate from a wrong parity?", answer: "A wrong baud gives you consistent nonsense from the first byte; a wrong parity or data-bit count gives you mostly-readable text with scattered wrong characters." },
    ],
    tags: ["serial", "rs232", "baud", "parity", "hardware"],
    relatedTools: ["device-link"],
  },
  {
    id: "dev-mllp-stream",
    topic: "devices",
    subtopic: "MLLP",
    level: "intermediate",
    mustKnow: true,
    question: "Why is 'read the socket, parse the message' wrong for MLLP?",
    answer:
      "Because TCP is a byte stream with no message boundaries. One `read()` may give you:\n\n- half a message,\n- one message,\n- one and a half messages,\n- two whole messages,\n\nand which one you get depends on packet sizes, timing and the sender's buffering — none of which you control, and all of which differ between your test bench and a hospital network.\n\nThe correct shape is an accumulating reader: append every read to a buffer, then repeatedly extract complete `<VT>…<FS><CR>` frames from the front of it, leaving the remainder for next time.\n\nWhat else the reader owes you:\n\n- **Discard and report bytes before the first `<VT>`.** That is either a previous message's tail after a reconnect or a peer speaking a different protocol; silently eating it hides both.\n- **A size cap.** No length prefix means a lost `<FS>` would otherwise buffer for ever.\n- **Tolerate a bare `<FS>`** with no `<CR>` — several devices send it, and refusing means refusing results that are otherwise fine.",
    diagram:
      "  read 1: <VT>MSH|^~\\&|LIS|LA          ← incomplete, keep\n  read 2: B|EMR|...<FS><CR><VT>MSH|    ← one complete + start of next\n  read 3: ...<FS><CR>                  ← completes the second\n\n  buffer ──▶ [extract frames] ──▶ 2 messages, remainder \"\"",
    followUps: [
      { question: "What is the single highest-value test here?", answer: "Two messages in one read. Trivial to write, constant in production, and a surprising number of interfaces drop the second one." },
    ],
    tags: ["mllp", "tcp", "streaming", "framing", "parsing"],
    relatedTools: ["device-link"],
  },
  {
    id: "dev-unidirectional",
    topic: "devices",
    subtopic: "Architecture",
    level: "basic",
    question: "What is the difference between a unidirectional and a bidirectional device interface?",
    answer:
      "**Unidirectional** — the device only sends results. Somebody loads the worklist on the analyser by hand, and your software receives whatever comes out. Simple, and the source of transcription errors.\n\n**Bidirectional** — the device also receives orders. Two flavours:\n\n- **Download**: the LIS pushes the worklist ahead of time. The analyser knows what to run for each barcode.\n- **Host query**: the analyser scans a barcode and *asks* the LIS what to run, right then. This avoids a stale worklist but puts your system on the critical path — the answer has to come back in seconds or the sample is skipped.\n\nBidirectional is worth the effort because it removes the manual step where a sample gets the wrong tests. It is also where the hard requirements live: a host query is a synchronous, latency-bounded call in a system that is otherwise asynchronous.",
    followUps: [
      { question: "What do you do when a host query times out?", answer: "Fail visibly and let the analyser fall back to its default panel or park the sample. Guessing what to run is worse than not running it." },
    ],
    tags: ["bidirectional", "host-query", "worklist", "lis"],
    relatedTools: ["device-link"],
  },
  {
    id: "dev-mqtt",
    topic: "devices",
    subtopic: "MQTT",
    level: "intermediate",
    mustKnow: true,
    question: "Explain MQTT: topics, QoS, retained messages and last will.",
    answer:
      "MQTT is a lightweight publish/subscribe protocol over TCP, designed for devices with little power and worse networks.\n\n- **Topics** are hierarchical strings: `hospital/ward3/bed12/vitals/spo2`. Subscribers use wildcards — `+` for one level, `#` for the rest. There is no topic registry; the hierarchy *is* the schema, so design it as one.\n- **QoS 0** at most once — fire and forget. **QoS 1** at least once — acknowledged, may duplicate. **QoS 2** exactly once — a four-step handshake, expensive, and rarely worth it. For vitals, QoS 1 plus an idempotent consumer beats QoS 2.\n- **Retained message** — the broker keeps the last message on a topic and gives it to every new subscriber immediately. This is how a dashboard shows the current value the moment it connects, instead of waiting for the next reading.\n- **Last will and testament** — a message the broker publishes *on your behalf* if you disconnect ungracefully. This is how a device is marked offline within seconds rather than by a timeout somewhere else.\n- **Clean session / persistent session** — whether the broker remembers your subscriptions and queues messages while you are away.\n\nSecurity is not optional here: TLS, per-device credentials or certificates, and topic-level authorisation so a bed cannot publish as another bed.",
    language: "csharp",
    code:
      "var options = new MqttClientOptionsBuilder()\n    .WithTcpServer(\"broker.hospital.local\", 8883)\n    .WithTlsOptions(o => o.UseTls())\n    .WithCredentials(deviceId, deviceSecret)\n    .WithWillTopic($\"devices/{deviceId}/status\")\n    .WithWillPayload(\"offline\")\n    .WithWillRetain(true)                 // new subscribers see \"offline\" at once\n    .WithWillQualityOfServiceLevel(MqttQualityOfServiceLevel.AtLeastOnce)\n    .WithCleanSession(false)              // keep my subscriptions across reconnects\n    .Build();",
    followUps: [
      { question: "Why does topic design matter so much?", answer: "Authorisation and routing are both by topic. A flat topic per device makes 'every SpO2 in ward 3' impossible without subscribing to everything." },
      { question: "MQTT or AMQP for devices?", answer: "MQTT for constrained devices and unreliable links; AMQP (Service Bus) for service-to-service work where you want queues, dead-letter and transactions." },
    ],
    tags: ["mqtt", "iot", "qos", "pubsub", "telemetry"],
    relatedTools: ["device-link"],
  },
  {
    id: "dev-telemetry",
    topic: "devices",
    subtopic: "Telemetry",
    level: "intermediate",
    question: "How is continuous device telemetry different from a discrete lab result?",
    answer:
      "A lab result is one number, produced once, that someone will act on and that must never be lost. Telemetry from a monitor is a heart rate every second, for days, of which almost every individual point is disposable — but the *shape* matters and a gap is clinically meaningful.\n\nThat difference drives every design decision:\n\n- **Volume.** One monitor at 1 Hz is 86,400 points a day. A hundred beds is 8.6 million. Row-per-reading in a relational table stops working quickly; you want a time-series store or aggregation on write.\n- **Loss tolerance.** Dropping one SpO2 sample is acceptable; dropping a potassium result is not. Do not build one pipeline with the strictest guarantee for both.\n- **Aggregation.** Keep full resolution briefly, then downsample — but keep the alarms and the anomalies at full resolution, because those are the ones a review will ask about.\n- **A gap is data.** Record disconnections explicitly. A flat line and \"no sensor attached\" look identical in a chart, and mean opposite things.\n- **Time.** The device's clock is wrong. Record both the device timestamp and the receipt timestamp, and never quietly replace one with the other.",
    followUps: [
      { question: "Should telemetry become FHIR Observations?", answer: "Not one per sample. Summarise — a periodic mean, or a sampled-data Observation covering a window. One Observation per second is a denial-of-service on your own FHIR server." },
    ],
    tags: ["telemetry", "time-series", "monitoring", "volume", "design"],
  },
  {
    id: "dev-time",
    topic: "devices",
    subtopic: "Telemetry",
    level: "intermediate",
    mustKnow: true,
    question: "Why is device time a recurring source of incidents?",
    answer:
      "Because devices keep their own clocks, those clocks are set by hand, and nobody notices they are wrong until the data is used.\n\nWhat actually happens:\n\n- The analyser is an hour out because nobody moved it for daylight saving, so results appear to arrive before they were ordered.\n- The device sends a local time with no offset, and your parser is in a different zone. `2026-08-14 09:20` is not a moment — it is a moment *somewhere*.\n- The device's clock drifts, so a series of readings is not monotonic.\n\nThe rules that prevent it:\n\n- **Record both times.** The device's timestamp and the moment you received it. Never overwrite one with the other; a gap between them is diagnostic.\n- **Never parse a bare local timestamp as UTC or as local by default** — decide per interface, write it down, and test it. `new Date(\"2026-08-14 09:20\")` in JavaScript is local time, which is how a UTC feed silently shifts by hours.\n- **Order by receipt when you must be safe**, by device time when you must be accurate, and know which you are doing.\n- **Alert on skew.** If a device is more than a few minutes out, that is an operational problem to fix, not a number to correct in code.",
    language: "csharp",
    code:
      "// HL7 timestamps may or may not carry an offset. Losing that distinction is the bug.\nstatic DateTimeOffset ParseHl7(string value, TimeZoneInfo deviceZone)\n{\n    // 20260814093000+0530  → unambiguous\n    if (DateTimeOffset.TryParseExact(value, \"yyyyMMddHHmmsszzz\",\n            CultureInfo.InvariantCulture, DateTimeStyles.None, out var withOffset))\n        return withOffset;\n\n    // 20260814093000 → local to the device, and only the interface config knows where that is\n    var naive = DateTime.ParseExact(value, \"yyyyMMddHHmmss\",\n        CultureInfo.InvariantCulture, DateTimeStyles.None);\n    return new DateTimeOffset(naive, deviceZone.GetUtcOffset(naive));\n}",
    followUps: [
      { question: "Should you correct a device's timestamp in code?", answer: "No. Store what it said, store when you got it, and raise an operational alert. Silent correction destroys the evidence that the device is misconfigured." },
    ],
    tags: ["time", "timezone", "timestamps", "hl7", "bugs"],
    relatedTools: ["unix-timestamp", "device-link"],
  },
  {
    id: "dev-ieee11073",
    topic: "devices",
    subtopic: "Standards",
    level: "advanced",
    question: "What problem does IEEE 11073 solve?",
    answer:
      "It defines a **device information model** so that a pulse oximeter from any manufacturer describes itself the same way: the same object structure, the same nomenclature codes for \"SpO2\" and \"pulse rate\", the same units, the same way of reporting a measurement's validity.\n\nThe problem it solves is the one every gateway hits: without it, each device is a bespoke mapping, and adding a fourth vendor means writing a fourth translator.\n\nWhat to know:\n\n- **11073-10101** is the nomenclature — the code list for measurements and units.\n- **11073-20601** is the personal-health profile (Bluetooth glucose meters, weighing scales, thermometers).\n- **SDC** (11073-20701 and friends) is the newer service-oriented profile for point-of-care devices talking over IP, with discovery and remote control.\n\nIn practice: expect it in personal-health devices and in modern SDC-capable monitors; expect a proprietary protocol and a hand-written mapping everywhere else. Recognising it and knowing what it is for is the useful level here.",
    followUps: [
      { question: "How does it relate to FHIR?", answer: "It models the device and its measurements; FHIR carries them into the record. A gateway maps 11073 nomenclature codes to LOINC on Observations." },
    ],
    tags: ["ieee-11073", "sdc", "standards", "nomenclature", "devices"],
  },
  {
    id: "dev-dicom-network",
    topic: "devices",
    subtopic: "Imaging",
    level: "advanced",
    question: "How does classic DICOM networking work — association, C-ECHO, C-STORE, C-FIND?",
    answer:
      "DICOM's classic protocol is connection-oriented and negotiated, unlike anything else in this space.\n\n- **AE Title** — every participant has an Application Entity title, a short name. The sender's and receiver's AE titles must be configured on *both* sides; a mismatch is the most common failure, and it presents as \"association rejected\".\n- **Association** — before any data moves, the two ends negotiate which SOP classes (what operations, on what objects) and which transfer syntaxes (how pixels are encoded) they both support. If they share no transfer syntax, the association succeeds and the transfer fails.\n- **C-ECHO** — the DICOM ping. Proves AE titles, port and association negotiation all work. Always the first test.\n- **C-STORE** — send an instance to a peer. This is how a modality pushes images to PACS.\n- **C-FIND** — query for studies matching criteria. **C-MOVE** asks a peer to send matching instances *to a third party*, which is why C-MOVE needs the destination AE to be configured in advance and is a firewall problem.\n\n**DICOMweb** replaces all of this with HTTP — QIDO-RS to query, WADO-RS to retrieve, STOW-RS to store — and is what you should prefer for anything new.",
    diagram:
      "  modality ──associate──▶ PACS      negotiate SOP classes + transfer syntaxes\n           ──C-STORE────▶            push images\n  viewer   ──C-FIND─────▶            find studies\n           ──C-MOVE─────▶            \"send them to AE:VIEWER\"  ← needs prior config\n\n  DICOMweb: GET /studies?PatientID=100234   (QIDO-RS)\n            GET /studies/{uid}              (WADO-RS)\n            POST /studies                   (STOW-RS)",
    followUps: [
      { question: "Why does C-MOVE cause firewall problems?", answer: "The recipient is a third party, so the PACS opens a new connection to it. Nothing about that fits a simple outbound firewall rule. C-GET and DICOMweb avoid it." },
    ],
    tags: ["dicom", "c-store", "c-find", "dicomweb", "pacs"],
  },
  {
    id: "dev-failure-modes",
    topic: "devices",
    subtopic: "Reliability",
    level: "advanced",
    mustKnow: true,
    question: "What are the failure modes of a device interface, and how do you handle each?",
    answer:
      "- **Upstream down.** Buffer to disk, keep accepting from the device, alert. Never drop.\n- **Device sends garbage.** Quarantine the message with the raw bytes, do not stall the link, and alert with a sample. A parser that throws and kills the connection turns one bad message into an outage.\n- **Duplicate results.** Expected, not exceptional. Deduplicate on a natural key, not on message id.\n- **Half-open TCP.** The socket looks alive and nothing arrives. Only an application-level heartbeat or a receive timeout detects it; TCP keepalive defaults are measured in hours.\n- **Device reboots mid-session.** Frame numbers restart, an ENQ arrives mid-transfer. Reset the state machine on ENQ rather than treating it as a protocol error.\n- **Clock skew.** Record both timestamps, alert on drift.\n- **Slow consumer.** Your own database is the back-pressure source; the analyser cannot be told to wait. Decouple ingestion from processing with a queue.\n- **Silent success.** The worst one: the link is fine, results are parsed, and nothing is filed because an order lookup fails. Monitor *filed results per hour*, not just connection state.",
    followUps: [
      { question: "What single monitor catches the most incidents?", answer: "Time since the last result per device. It catches a dead link, a wedged parser, a stuck queue and a silent lookup failure with one alert." },
    ],
    tags: ["reliability", "failure", "monitoring", "operations", "design"],
    relatedTools: ["device-link", "log-viewer"],
  },
  {
    id: "dev-simulator",
    topic: "devices",
    subtopic: "Testing",
    level: "intermediate",
    mustKnow: true,
    question: "How do you develop against a device you do not have?",
    answer:
      "You simulate the device, and you make the simulator behave badly on purpose.\n\n- **Own both ends.** A listener that ACKs and a sender that transmits proves the transport path without the analyser.\n- **Capture a real session once** — every byte, with timings — and replay it. Real captures contain the odd empty field, the vendor's non-standard segment and the encoding surprise your synthetic message will never have.\n- **Simulate the failures**, because these are what production consists of: NAK every third frame, drop the connection mid-message, send two messages in one packet, send a truncated one, send the same result twice, go silent for a minute.\n- **Replay at the original timing** when testing throughput or timeouts; instantly when testing parsing.\n- **De-identify at capture time**, so the corpus can live in the repository.\n\nA simulator that only produces valid messages tests the path you already knew worked.",
    followUps: [
      { question: "Is a vendor simulator good enough?", answer: "For happy-path conformance, yes. They rarely misbehave, which is where the interesting bugs are — write your own for the failure cases." },
    ],
    tags: ["testing", "simulator", "replay", "quality"],
    relatedTools: ["device-link", "astm-toolkit"],
  },
  {
    id: "dev-security",
    topic: "devices",
    subtopic: "Reliability",
    level: "advanced",
    question: "How do you secure a device network when the devices cannot be secured?",
    answer:
      "You accept that the device is the weak point and put the controls around it.\n\n- **Assume no patching.** A device is validated as a medical device; changing its OS can invalidate that. Many run software that has been unsupported for years.\n- **Segment the network.** Devices on their own VLAN, no internet access, no lateral path to clinical systems. The gateway is the only thing that crosses, and it is the only thing you harden.\n- **Plain protocols stay inside the segment.** MLLP and ASTM have no authentication and no encryption; treat the segment as the security boundary and use TLS the moment traffic leaves it.\n- **Authenticate at the gateway**, not the device. The device cannot hold a credential safely; the gateway can.\n- **Allow-list.** A gateway should accept connections only from the addresses it expects, and reject the rest loudly.\n- **Log the operational facts** — which device connected, when, how much it sent — and keep PHI out of those logs.\n- **Physical access is real.** A serial port in a corridor is an attack surface that no firewall rule addresses.",
    followUps: [
      { question: "Is MLLP over TLS a solution?", answer: "It helps when traffic crosses a network boundary, and plenty of engines support it. It does not authenticate the device, which is why the segment and the allow-list still matter." },
    ],
    tags: ["security", "network", "segmentation", "devices", "risk"],
  },
  {
    id: "dev-barcode",
    topic: "devices",
    subtopic: "Architecture",
    level: "basic",
    question: "How does a sample get from a barcode to the right patient?",
    answer:
      "The barcode is almost never the patient id. It is the **accession number** — an identifier for *this specimen*, issued when the sample is registered.\n\nThe chain is: patient → order (placer id) → accession (specimen) → device run → result.\n\nThe analyser reads the accession, runs the tests, and reports the result against that accession. Your gateway resolves accession back to order, and order back to patient. Nothing in the device knows who the patient is, and that is deliberate — a device that never holds patient identity is a device that cannot leak it.\n\nWhat goes wrong:\n\n- **A result for an unknown accession.** Common and normal — the result arrived before the order was filed, or the sample was run twice. Park it in a holding area and retry the lookup; do not discard it, and do not guess.\n- **Recycled accession numbers.** Some labs reuse them yearly. Include the date in the key or you will match a result to last year's order.\n- **Manually keyed samples** with a typo, matching a real accession that belongs to someone else. This is the argument for check digits.",
    followUps: [
      { question: "How long should an unmatched result be held?", answer: "Long enough to cover the ordering delay — hours, not minutes — with an operational queue a human can see. Silent expiry loses a patient result." },
    ],
    tags: ["barcode", "accession", "specimen", "identity", "workflow"],
    relatedTools: ["device-link", "trace-explorer"],
  },
  {
    id: "dev-qc",
    topic: "devices",
    subtopic: "Reliability",
    level: "intermediate",
    question: "What is QC data, and why must you not file it as a patient result?",
    answer:
      "Quality-control samples are known materials the lab runs to prove the analyser is calibrated. They come down the *same interface* as patient results, in the same message shape.\n\nIf you file them as patient results you have invented a haemoglobin for a patient who does not exist — or worse, for one who does, if the QC sample carries a reused identifier.\n\nHow to tell them apart:\n\n- **HL7**: `OBR-11` (specimen action code) or the order control code marks QC; some labs use a dedicated patient id such as `QC` or a reserved MRN range.\n- **ASTM**: the record often carries a QC flag, or the patient record is empty with a control identifier in the order.\n- **Vendor-specific**: many analysers simply use a magic patient id, which is only documented in an appendix.\n\nThe rule: **default to rejecting what you cannot positively identify as a patient result**, and make unmatched messages visible. Filing something as clinical data because you did not recognise it is the wrong default in this domain.",
    followUps: [
      { question: "Should QC data be stored at all?", answer: "Yes — separately. It is how the lab proves the analyser was in control when a patient sample ran, and an audit will ask for it." },
    ],
    tags: ["qc", "quality-control", "safety", "lis", "filtering"],
  },
  {
    id: "dev-hl7-vs-astm",
    topic: "devices",
    subtopic: "Architecture",
    level: "intermediate",
    question: "An analyser offers both ASTM and HL7. Which do you choose?",
    answer:
      "**HL7 over MLLP**, if the implementation is complete — and check that it is, because vendor HL7 is often a thin wrapper written later and less tested than the ASTM path that has shipped for fifteen years.\n\nWhy HL7 when it is real:\n\n- One protocol across your estate instead of two.\n- Richer, better-specified structure for orders and results.\n- ACK semantics that distinguish accept from application errors.\n- Everything downstream already speaks it.\n\nWhy you might still pick ASTM:\n\n- The vendor's ASTM is the mature path and their HL7 drops fields.\n- The device is serial-only, where ASTM's framing and retry actually earn their keep.\n- The site already runs ASTM and consistency beats elegance.\n\nThe deciding question is not which standard is better. It is which of the vendor's two implementations is better, and the only way to know is to run both and compare what arrives.",
    followUps: [
      { question: "How do you compare them quickly?", answer: "Run the same sample through both interfaces and diff the parsed result — fields present, codes used, statuses. The gaps show up immediately." },
    ],
    tags: ["astm", "hl7", "vendor", "decision", "integration"],
    relatedTools: ["device-link", "astm-toolkit", "hl7-toolkit"],
  },
];
