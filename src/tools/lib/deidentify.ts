/**
 * Local-only detection and de-identification of common sensitive data patterns.
 * Regex-based, best-effort — for developer/integration workflows, not a compliance tool.
 * Nothing is ever transmitted.
 */

export type PiiType = "email" | "phone" | "ssn" | "mrn" | "date" | "ipv4";
export type RedactMode = "label" | "mask" | "pseudo";

interface PatternDef {
  type: PiiType;
  label: string;
  regex: RegExp;
}

// Order matters: more specific patterns first so they win overlapping matches.
const PATTERNS: PatternDef[] = [
  { type: "email", label: "Email", regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { type: "ssn", label: "SSN", regex: /\b\d{3}-\d{2}-\d{4}\b/g },
  { type: "mrn", label: "MRN", regex: /\b(?:MRN|mrn)[:\s#-]*([A-Za-z0-9-]{4,})/g },
  { type: "date", label: "Date", regex: /\b(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/g },
  { type: "ipv4", label: "IPv4", regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  { type: "phone", label: "Phone", regex: /\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g },
];

export interface Finding {
  type: PiiType;
  label: string;
  value: string;
  start: number;
  end: number;
}

/** Find sensitive spans, resolving overlaps in favour of the earlier/more-specific pattern. */
export function detectPii(text: string): Finding[] {
  const found: Finding[] = [];
  for (const p of PATTERNS) {
    p.regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = p.regex.exec(text)) !== null) {
      const value = m[0];
      const start = m.index;
      const end = start + value.length;
      // Skip if this span overlaps one already claimed by an earlier pattern.
      if (found.some((f) => start < f.end && end > f.start)) continue;
      found.push({ type: p.type, label: p.label, value, start, end });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

export interface PiiSummary {
  total: number;
  byType: Record<string, number>;
}
export function summarize(findings: Finding[]): PiiSummary {
  const byType: Record<string, number> = {};
  findings.forEach((f) => (byType[f.label] = (byType[f.label] ?? 0) + 1));
  return { total: findings.length, byType };
}

function maskValue(v: string): string {
  return v.replace(/[A-Za-z0-9]/g, "X");
}

/** Replace detected spans according to the chosen mode. */
export function deidentify(text: string, mode: RedactMode): string {
  const findings = detectPii(text);
  const counters: Record<string, number> = {};
  const next = (t: PiiType) => (counters[t] = (counters[t] ?? 0) + 1);

  // Replace from the end so indices stay valid.
  let out = text;
  for (const f of [...findings].reverse()) {
    let replacement: string;
    if (mode === "label") {
      replacement = `[${f.label.toUpperCase()}]`;
    } else if (mode === "mask") {
      replacement = maskValue(f.value);
    } else {
      const n = String(next(f.type)).padStart(3, "0");
      replacement =
        f.type === "email" ? `user${n}@example.com`
        : f.type === "phone" ? "+1-555-XXX-XXXX"
        : f.type === "ssn" ? "XXX-XX-XXXX"
        : f.type === "mrn" ? `TEST-MRN-${n}`
        : f.type === "ipv4" ? "0.0.0.0"
        : `[DATE-${n}]`;
    }
    out = out.slice(0, f.start) + replacement + out.slice(f.end);
  }
  return out;
}
