/**
 * Finding PHI in the places it leaks, rather than in the prompt.
 *
 * [[phi.ts]] guards the one path where data leaves deliberately — an AI prompt.
 * This is the other half: the places it leaks by accident, which is nearly
 * always one of three.
 *
 * **Log files.** Somebody logged the request body once, to debug an interface,
 * and never took it out. The line is in an aggregator with a year's retention
 * and a dozen people's access.
 *
 * **Database columns.** A staging table with a `notes` column that was supposed
 * to hold a status and holds a discharge summary; a `comments` column somebody
 * pastes a name into. The column name says nothing, so nobody looks.
 *
 * **Exports and fixtures.** The CSV mailed to a supplier "for testing", the
 * test fixture built by copying a real message.
 *
 * The scanning is the same detector either way, so the useful work here is the
 * shape of the *report*. Two ideas do the heavy lifting:
 *
 * - **A location, not a count.** "Three MRNs in this file" is unactionable;
 *   `orders.log:8842` is a line somebody can go and delete. Byte offsets are
 *   converted to line and column, and a redacted excerpt travels with each hit
 *   so a ticket can quote it without repeating the disclosure.
 * - **Columns are judged by proportion, not by presence.** One value in a
 *   million that looks like a phone number is a false positive. Ninety per cent
 *   of a column looking like an MRN means the column *is* MRNs whatever it is
 *   called — and that is the finding worth acting on.
 */

import { detectPhi, KIND_LABEL, type PhiFinding, type PhiKind } from "./phi";

// ---------------------------------------------------------------------------
// Locating a finding
// ---------------------------------------------------------------------------

export interface Hit {
  kind: PhiKind;
  label: string;
  line: number;
  column: number;
  /** The line with the value replaced, so a report never repeats the leak. */
  excerpt: string;
  certain: boolean;
  reason: string;
}

/** Line starts, so an offset can be turned into a line and column. */
function lineIndex(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

function lineOf(starts: number[], offset: number): { line: number; column: number } {
  // Binary search: a log file has hundreds of thousands of lines and a scan has
  // as many findings, so a linear walk per finding is quadratic.
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (starts[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return { line: low + 1, column: offset - starts[low] + 1 };
}

/** How much of a line to keep either side of a hit. */
const EXCERPT_RADIUS = 60;

/**
 * One finding, located and made safe to quote.
 *
 * The excerpt matters more than it looks: a scan report is pasted into a ticket,
 * and a report that quotes the MRN it found has moved the disclosure rather than
 * fixed it.
 *
 * Every finding inside the excerpt window is masked, not just the one being
 * located. Masking only its own value leaves the neighbours visible — and on a
 * logged request body the neighbours are the email address and the name sitting
 * a few characters further along, which is precisely the case this is for.
 */
export function locate(text: string, starts: number[], finding: PhiFinding, all: PhiFinding[] = [finding]): Hit {
  const { line, column } = lineOf(starts, finding.start);
  const lineStart = starts[line - 1];
  const lineEnd = text.indexOf("\n", lineStart);
  const whole = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);

  const at = finding.start - lineStart;
  const from = Math.max(0, at - EXCERPT_RADIUS);
  const to = Math.min(whole.length, at + finding.value.length + EXCERPT_RADIUS);

  // Replace from the end so the earlier offsets stay valid.
  const windowStart = lineStart + from;
  const windowEnd = lineStart + to;
  const inside = all
    .filter((f) => f.start < windowEnd && f.end > windowStart)
    .sort((a, b) => b.start - a.start);

  let masked = whole.slice(from, to);
  for (const other of inside) {
    const relStart = Math.max(0, other.start - windowStart);
    const relEnd = Math.min(masked.length, other.end - windowStart);
    masked = `${masked.slice(0, relStart)}[${other.kind.toUpperCase()}]${masked.slice(relEnd)}`;
  }

  return {
    kind: finding.kind,
    label: KIND_LABEL[finding.kind],
    line,
    column,
    excerpt: `${from > 0 ? "…" : ""}${masked.trim()}${to < whole.length ? "…" : ""}`,
    certain: finding.certain,
    reason: finding.reason,
  };
}

// ---------------------------------------------------------------------------
// Scanning text
// ---------------------------------------------------------------------------

export interface TextScan {
  /** File path, table name, whatever identifies the source. */
  source: string;
  bytes: number;
  lines: number;
  hits: Hit[];
  counts: Partial<Record<PhiKind, number>>;
  /** Set when the scan stopped early. */
  truncated?: string;
}

/** The most hits to keep for one source. Beyond this the answer is "yes, lots". */
export const MAX_HITS = 500;

export function scanText(source: string, text: string): TextScan {
  const starts = lineIndex(text);
  const findings = detectPhi(text);
  const hits: Hit[] = [];
  const counts: Partial<Record<PhiKind, number>> = {};

  for (const finding of findings) {
    counts[finding.kind] = (counts[finding.kind] ?? 0) + 1;
    if (hits.length < MAX_HITS) hits.push(locate(text, starts, finding, findings));
  }

  return {
    source,
    bytes: text.length,
    lines: starts.length,
    hits,
    counts,
    truncated: findings.length > MAX_HITS ? `Showing the first ${MAX_HITS} of ${findings.length} findings.` : undefined,
  };
}

// ---------------------------------------------------------------------------
// Scanning columns
// ---------------------------------------------------------------------------

export interface ColumnScan {
  column: string;
  /** How many sampled values were examined. */
  sampled: number;
  /** How many of them contained anything identifying. */
  matched: number;
  /** matched / sampled, 0–1. */
  ratio: number;
  /** The kind that dominates the column, when one does. */
  dominant?: PhiKind;
  counts: Partial<Record<PhiKind, number>>;
  verdict: "clear" | "occasional" | "likely" | "certain";
  message: string;
}

/**
 * The proportion above which a column is the thing rather than merely contains it.
 *
 * Chosen deliberately low. A `notes` column that is 30% names is not a column of
 * names, but it is absolutely a column that must not leave the building — and
 * the whole reason free-text columns are dangerous is that the PHI is sparse
 * enough for a spot check to miss.
 */
export const LIKELY_RATIO = 0.3;
export const CERTAIN_RATIO = 0.8;

/** A column name that is a declaration of intent, whatever the data looks like. */
const REVEALING_NAMES = /(^|_)(mrn|uhid|ssn|aadhaar|dob|birth|patient|name|surname|forename|address|phone|mobile|email|notes?|comments?|remarks?|diagnosis|nhs)($|_)/i;

export function scanColumn(column: string, values: unknown[]): ColumnScan {
  const counts: Partial<Record<PhiKind, number>> = {};
  let matched = 0;
  let sampled = 0;

  for (const raw of values) {
    if (raw === null || raw === undefined) continue;
    const text = String(raw);
    if (!text.trim()) continue;
    sampled++;
    const findings = detectPhi(text);
    if (findings.length === 0) continue;
    matched++;
    for (const finding of findings) counts[finding.kind] = (counts[finding.kind] ?? 0) + 1;
  }

  const ratio = sampled === 0 ? 0 : matched / sampled;
  const entries = Object.entries(counts) as [PhiKind, number][];
  const dominant = entries.sort((a, b) => b[1] - a[1])[0]?.[0];
  const named = REVEALING_NAMES.test(column);

  let verdict: ColumnScan["verdict"] = "clear";
  if (ratio >= CERTAIN_RATIO) verdict = "certain";
  else if (ratio >= LIKELY_RATIO) verdict = "likely";
  else if (matched > 0) verdict = "occasional";

  let message: string;
  if (verdict === "certain") {
    message = `${Math.round(ratio * 100)}% of sampled values are ${KIND_LABEL[dominant!].toLowerCase()}. This column is that field, whatever it is called.`;
  } else if (verdict === "likely") {
    message = `${Math.round(ratio * 100)}% of sampled values contain something identifying. A free-text column with PHI scattered through it is the hardest kind to clean, because a spot check misses it.`;
  } else if (verdict === "occasional") {
    message = `${matched} of ${sampled} sampled values matched. That is low enough to be false positives — check the examples before acting.`;
  } else if (named) {
    message = "Nothing matched in the sample, but the column name says what it holds. Either the sample missed it or the column is empty here — neither means it is safe in production.";
  } else {
    message = "Nothing identifying in the sample.";
  }

  // A revealing name lifts an otherwise-clear column to something worth a look:
  // the sample can be unrepresentative, the name rarely lies.
  if (named && verdict === "clear") verdict = "occasional";

  return { column, sampled, matched, ratio, dominant, counts, verdict, message };
}

/** Scan a result set, one column at a time. */
export function scanRows(columns: string[], rows: unknown[][]): ColumnScan[] {
  return columns
    .map((column, i) => scanColumn(column, rows.map((row) => row[i])))
    .sort((a, b) => b.ratio - a.ratio || a.column.localeCompare(b.column));
}

// ---------------------------------------------------------------------------
// Choosing what to scan
// ---------------------------------------------------------------------------

/** Extensions worth reading as text. Anything else is skipped rather than mangled. */
export const TEXT_EXTENSIONS = [
  ".log", ".txt", ".csv", ".tsv", ".json", ".ndjson", ".xml", ".hl7", ".dat", ".edi", ".x12",
  ".yml", ".yaml", ".sql", ".md", ".config", ".ini", ".env", ".har", ".out", ".err",
];

export interface Candidate {
  path: string;
  name: string;
  size: number;
}

/**
 * Which files in a listing are worth opening.
 *
 * Size matters as much as extension: a 4 GB log cannot be read into a string,
 * and reading its tail is both what the Rust side already does and, in practice,
 * what you want — the recent entries are the ones still in retention.
 */
export function selectCandidates(
  entries: { path: string; name: string; is_dir: boolean; size: number }[],
  maxFiles = 200,
): { chosen: Candidate[]; skipped: { name: string; why: string }[] } {
  const chosen: Candidate[] = [];
  const skipped: { name: string; why: string }[] = [];

  for (const entry of entries) {
    if (entry.is_dir) continue;
    const lower = entry.name.toLowerCase();
    if (!TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
      skipped.push({ name: entry.name, why: "not a text extension" });
      continue;
    }
    if (entry.size === 0) {
      skipped.push({ name: entry.name, why: "empty" });
      continue;
    }
    if (chosen.length >= maxFiles) {
      skipped.push({ name: entry.name, why: `over the ${maxFiles}-file cap` });
      continue;
    }
    chosen.push({ path: entry.path, name: entry.name, size: entry.size });
  }

  // Biggest first: a log with PHI in it is usually the big one.
  chosen.sort((a, b) => b.size - a.size);
  return { chosen, skipped };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export interface ScanSummary {
  sources: number;
  withFindings: number;
  total: number;
  counts: Partial<Record<PhiKind, number>>;
  /** Sources ordered by how much was found in them. */
  worst: { source: string; total: number }[];
}

export function summarise(scans: TextScan[]): ScanSummary {
  const counts: Partial<Record<PhiKind, number>> = {};
  let total = 0;
  const worst: { source: string; total: number }[] = [];

  for (const scan of scans) {
    const scanTotal = Object.values(scan.counts).reduce((n, v) => n + (v ?? 0), 0);
    total += scanTotal;
    if (scanTotal > 0) worst.push({ source: scan.source, total: scanTotal });
    for (const [kind, n] of Object.entries(scan.counts)) {
      counts[kind as PhiKind] = (counts[kind as PhiKind] ?? 0) + (n ?? 0);
    }
  }

  worst.sort((a, b) => b.total - a.total);
  return { sources: scans.length, withFindings: worst.length, total, counts, worst: worst.slice(0, 20) };
}

/**
 * The scan as Markdown, safe to paste anywhere.
 *
 * Deliberately carries excerpts with the values already masked and no raw
 * values at all. A report that quotes what it found has moved the disclosure
 * into the ticket system, where it will outlive the log line it came from.
 */
export function toMarkdown(scans: TextScan[], summary: ScanSummary): string {
  const lines: string[] = [];
  lines.push("# PHI scan");
  lines.push("");
  lines.push(`${summary.total} finding(s) across ${summary.withFindings} of ${summary.sources} source(s).`);
  lines.push("");
  if (summary.total > 0) {
    lines.push("| Kind | Count |");
    lines.push("| --- | --- |");
    for (const [kind, n] of Object.entries(summary.counts).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))) {
      lines.push(`| ${KIND_LABEL[kind as PhiKind]} | ${n} |`);
    }
    lines.push("");
  }

  for (const scan of scans) {
    if (scan.hits.length === 0) continue;
    lines.push(`## ${scan.source}`);
    lines.push("");
    for (const hit of scan.hits.slice(0, 50)) {
      lines.push(`- \`${scan.source}:${hit.line}\` — **${hit.label}**${hit.certain ? "" : " (pattern match)"}: \`${hit.excerpt}\``);
    }
    if (scan.hits.length > 50) lines.push(`- …and ${scan.hits.length - 50} more.`);
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("Values are masked in every excerpt above; this report contains no identifiers. Detection is best-effort — it cannot recognise a name in prose and does not know local identifier formats.");
  return lines.join("\n");
}
