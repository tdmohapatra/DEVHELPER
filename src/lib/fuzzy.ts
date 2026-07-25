/**
 * Lightweight fuzzy subsequence matcher for the command palette.
 *
 * Every query character must appear in order in the target. Score rewards matches at the
 * start of the string, at word boundaries (space/-/_/:/./ and camelCase), and contiguous
 * runs — so "jf" ranks "JSON Formatter" highly. Returns null when there is no subsequence.
 */

export interface FuzzyResult {
  score: number;
  positions: number[];
}

const BOUNDARY = new Set([" ", "-", "_", ":", "/", ".", "\\"]);

export function fuzzyMatch(query: string, text: string): FuzzyResult | null {
  const q = query.toLowerCase().trim();
  if (!q) return { score: 0, positions: [] };
  const lower = text.toLowerCase();

  let qi = 0;
  let score = 0;
  let prevMatch = -2;
  const positions: number[] = [];

  for (let i = 0; i < text.length && qi < q.length; i++) {
    if (lower[i] !== q[qi]) continue;
    let bonus = 1;
    if (i === 0) bonus += 10;
    else if (BOUNDARY.has(text[i - 1])) bonus += 7;
    else if (text[i] !== lower[i] && text[i - 1] === lower[i - 1]) bonus += 6; // camelCase boundary
    if (prevMatch === i - 1) bonus += 5; // contiguous
    score += bonus;
    positions.push(i);
    prevMatch = i;
    qi++;
  }

  if (qi < q.length) return null; // not all query chars matched in order
  // Prefer earlier first match and tighter overall length.
  score -= positions[0] * 0.2 + (text.length - q.length) * 0.05;
  return { score, positions };
}

/**
 * Score a tool by the best match across name / keywords / description. Highlight positions
 * are returned only when the name itself matched (so the visible label can be highlighted).
 */
export function scoreTool(query: string, name: string, keywords: string[], description = ""): FuzzyResult | null {
  if (!query.trim()) return { score: 0, positions: [] };
  const nm = fuzzyMatch(query, name);
  let score = nm ? nm.score * 3 : 0;
  const positions = nm ? nm.positions : [];
  for (const k of keywords) {
    const r = fuzzyMatch(query, k);
    if (r) score = Math.max(score, r.score);
  }
  const dm = fuzzyMatch(query, description);
  if (dm) score = Math.max(score, dm.score * 0.5);
  return score > 0 ? { score, positions } : null;
}
