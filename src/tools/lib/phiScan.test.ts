import { describe, expect, it } from "vitest";
import {
  CERTAIN_RATIO,
  LIKELY_RATIO,
  MAX_HITS,
  scanColumn,
  scanRows,
  scanText,
  selectCandidates,
  summarise,
  TEXT_EXTENSIONS,
  toMarkdown,
} from "./phiScan";

describe("scanText", () => {
  const log = [
    "2026-08-17 10:30:00 INFO  starting interface",
    "2026-08-17 10:30:01 DEBUG request body: MRN: 100234 for priya@hospital.in",
    "2026-08-17 10:30:02 INFO  ok",
  ].join("\n");

  const scan = scanText("orders.log", log);

  it("gives a line number, which is what makes a finding actionable", () => {
    const mrn = scan.hits.find((h) => h.kind === "mrn")!;
    expect(mrn.line).toBe(2);
    expect(mrn.column).toBeGreaterThan(1);
  });

  it("masks the value in the excerpt, so a report does not repeat the leak", () => {
    const mrn = scan.hits.find((h) => h.kind === "mrn")!;
    expect(mrn.excerpt).toContain("[MRN]");
    expect(mrn.excerpt).not.toContain("100234");
    for (const hit of scan.hits) expect(hit.excerpt).not.toContain("priya@hospital.in");
  });

  it("counts every kind it found", () => {
    expect(scan.counts.mrn).toBe(1);
    expect(scan.counts.email).toBe(1);
    expect(scan.lines).toBe(3);
  });

  it("finds nothing in a log that leaks nothing", () => {
    const clean = scanText("clean.log", "INFO started\nINFO ok\nERROR queue empty");
    expect(clean.hits).toEqual([]);
    expect(clean.counts).toEqual({});
  });

  it("locates a hit on the first line, where the offset maths is easiest to get wrong", () => {
    const first = scanText("x", "MRN: 100234\nsecond line");
    expect(first.hits[0].line).toBe(1);
    expect(first.hits[0].column).toBe(6);
  });

  it("locates a hit on the last line of a file with no trailing newline", () => {
    const last = scanText("x", "one\ntwo\nMRN: 100234");
    expect(last.hits[0].line).toBe(3);
  });

  it("handles CRLF without counting the carriage return as a column", () => {
    const crlf = scanText("x", "one\r\nMRN: 100234\r\nthree");
    expect(crlf.hits[0].line).toBe(2);
    expect(crlf.hits[0].column).toBe(6);
  });

  it("caps the hits it keeps but still counts them all", () => {
    const many = Array.from({ length: MAX_HITS + 20 }, (_, i) => `MRN: A${1000 + i}`).join("\n");
    const scan2 = scanText("big.log", many);
    expect(scan2.hits).toHaveLength(MAX_HITS);
    expect(scan2.counts.mrn).toBe(MAX_HITS + 20);
    expect(scan2.truncated).toMatch(new RegExp(`first ${MAX_HITS}`));
  });

  it("trims a long line down to something quotable", () => {
    const padding = "x".repeat(500);
    const scan3 = scanText("x", `${padding} MRN: 100234 ${padding}`);
    expect(scan3.hits[0].excerpt.length).toBeLessThan(200);
    expect(scan3.hits[0].excerpt.startsWith("…")).toBe(true);
    expect(scan3.hits[0].excerpt.endsWith("…")).toBe(true);
  });
});

describe("scanColumn", () => {
  const mrns = Array.from({ length: 20 }, (_, i) => `MRN: 10023${i}`);

  it("calls a column that is the field, the field", () => {
    const scan = scanColumn("col_a", mrns);
    expect(scan.verdict).toBe("certain");
    expect(scan.ratio).toBe(1);
    expect(scan.dominant).toBe("mrn");
    expect(scan.message).toMatch(/whatever it is called/);
  });

  it("flags a free-text column with PHI scattered through it", () => {
    const notes = [...Array(6).fill("MRN: 100234 called back"), ...Array(14).fill("patient collected results")];
    const scan = scanColumn("notes", notes);
    expect(scan.ratio).toBeGreaterThanOrEqual(LIKELY_RATIO);
    expect(scan.verdict).toBe("likely");
    expect(scan.message).toMatch(/a spot check misses it/);
  });

  it("treats a couple of matches as possible false positives rather than a finding", () => {
    const values = [...Array(1).fill("call 555-123-4567"), ...Array(40).fill("ok")];
    const scan = scanColumn("status", values);
    expect(scan.verdict).toBe("occasional");
    expect(scan.message).toMatch(/false positives/);
  });

  it("is clear about a column with nothing in it", () => {
    const scan = scanColumn("status", ["ok", "failed", "pending"]);
    expect(scan.verdict).toBe("clear");
    expect(scan.ratio).toBe(0);
  });

  it("does not clear a column whose name says what it holds", () => {
    // The sample may be unrepresentative; the name rarely lies.
    const scan = scanColumn("patient_mrn", ["", "", ""]);
    expect(scan.verdict).toBe("occasional");
    expect(scan.message).toMatch(/column name says what it holds/);
  });

  it("ignores nulls and blanks when working out the proportion", () => {
    const scan = scanColumn("col", ["MRN: 100234", null, undefined, "  ", "MRN: 100235"]);
    expect(scan.sampled).toBe(2);
    expect(scan.ratio).toBe(1);
  });

  it("uses the thresholds it publishes", () => {
    expect(LIKELY_RATIO).toBeLessThan(CERTAIN_RATIO);
    const atCertain = scanColumn("c", [...Array(8).fill("MRN: 100234"), ...Array(2).fill("ok")]);
    expect(atCertain.ratio).toBeCloseTo(CERTAIN_RATIO);
    expect(atCertain.verdict).toBe("certain");
  });
});

describe("scanRows", () => {
  it("scans each column and puts the worst first", () => {
    const scans = scanRows(
      ["status", "mrn_col"],
      [
        ["ok", "MRN: 100234"],
        ["ok", "MRN: 100235"],
      ],
    );
    expect(scans[0].column).toBe("mrn_col");
    expect(scans[0].verdict).toBe("certain");
    expect(scans[1].column).toBe("status");
  });

  it("copes with ragged rows", () => {
    const scans = scanRows(["a", "b"], [["x"], ["y", "MRN: 100234"]]);
    expect(scans).toHaveLength(2);
  });
});

describe("selectCandidates", () => {
  const entries = [
    { path: "/logs", name: "logs", is_dir: true, size: 0 },
    { path: "/logs/orders.log", name: "orders.log", is_dir: false, size: 5000 },
    { path: "/logs/big.log", name: "big.log", is_dir: false, size: 900000 },
    { path: "/logs/photo.png", name: "photo.png", is_dir: false, size: 100 },
    { path: "/logs/empty.log", name: "empty.log", is_dir: false, size: 0 },
  ];

  it("takes the text files, biggest first", () => {
    const { chosen } = selectCandidates(entries);
    expect(chosen.map((c) => c.name)).toEqual(["big.log", "orders.log"]);
  });

  it("says why it skipped each of the others", () => {
    const { skipped } = selectCandidates(entries);
    expect(skipped).toEqual([
      { name: "photo.png", why: "not a text extension" },
      { name: "empty.log", why: "empty" },
    ]);
  });

  it("caps the file count and says which fell outside it", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ path: `/p${i}`, name: `f${i}.log`, is_dir: false, size: 10 }));
    const { chosen, skipped } = selectCandidates(many, 2);
    expect(chosen).toHaveLength(2);
    expect(skipped.filter((s) => /cap/.test(s.why))).toHaveLength(3);
  });

  it("covers the extensions an integration actually produces", () => {
    for (const ext of [".log", ".hl7", ".edi", ".csv", ".json", ".har"]) expect(TEXT_EXTENSIONS).toContain(ext);
  });
});

describe("summarise and toMarkdown", () => {
  const scans = [
    scanText("a.log", "MRN: 100234\nMRN: 100235"),
    scanText("b.log", "nothing here"),
    scanText("c.log", "priya@hospital.in"),
  ];
  const summary = summarise(scans);

  it("counts sources, findings and kinds", () => {
    expect(summary.sources).toBe(3);
    expect(summary.withFindings).toBe(2);
    expect(summary.total).toBe(3);
    expect(summary.counts.mrn).toBe(2);
    expect(summary.counts.email).toBe(1);
  });

  it("orders sources by how much is in them", () => {
    expect(summary.worst[0].source).toBe("a.log");
  });

  it("writes a report with locations and no identifiers in it", () => {
    const markdown = toMarkdown(scans, summary);
    expect(markdown).toContain("a.log:1");
    expect(markdown).toContain("| MRN | 2 |");
    expect(markdown).not.toContain("100234");
    expect(markdown).not.toContain("priya@hospital.in");
    expect(markdown).toMatch(/contains no identifiers/);
  });

  it("leaves clean sources out of the body", () => {
    expect(toMarkdown(scans, summary)).not.toContain("## b.log");
  });

  it("says so plainly when there is nothing to report", () => {
    const clean = [scanText("x.log", "all fine")];
    expect(toMarkdown(clean, summarise(clean))).toContain("0 finding(s) across 0 of 1 source(s)");
  });
});
