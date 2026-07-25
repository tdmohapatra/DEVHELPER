/**
 * Cron expression parsing, matching and next-run computation.
 *
 * Supports standard 5-field (minute hour day-of-month month day-of-week) and 6-field
 * (with leading seconds) expressions, with `*`, ranges `a-b`, steps `*​/n` and `a-b/n`,
 * lists `a,b,c`, and month/day names. Day-of-month + day-of-week use Vixie-cron OR
 * semantics when both are restricted. No external dependencies.
 */

export interface CronField {
  values: Set<number>;
  star: boolean;
  raw: string;
}

export interface Cron {
  second?: CronField;
  minute: CronField;
  hour: CronField;
  dom: CronField;
  month: CronField;
  dow: CronField;
  hasSeconds: boolean;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function nameToNum(token: string, names: string[], base: number): string {
  const i = names.indexOf(token.toLowerCase().slice(0, 3));
  return i >= 0 ? String(i + base) : token;
}

/** Parse a single cron field into the set of matching numbers. Throws on invalid input. */
export function parseField(raw: string, min: number, max: number, names?: string[]): CronField {
  const star = raw === "*" || /^\*\/\d+$/.test(raw);
  const values = new Set<number>();

  for (const part of raw.split(",")) {
    let [rangePart, stepPart] = part.split("/");
    const step = stepPart ? Number(stepPart) : 1;
    if (stepPart !== undefined && (!Number.isInteger(step) || step <= 0)) throw new Error(`Invalid step in "${part}"`);

    let lo: number, hi: number;
    if (rangePart === "*") {
      lo = min; hi = max;
    } else if (rangePart.includes("-")) {
      const [a, b] = rangePart.split("-");
      lo = Number(names ? nameToNum(a, names, min) : a);
      hi = Number(names ? nameToNum(b, names, min) : b);
    } else {
      lo = Number(names ? nameToNum(rangePart, names, min) : rangePart);
      hi = stepPart !== undefined ? max : lo;
    }
    // Day-of-week (max 6): accept 7 as Sunday (0).
    if (max === 6) { if (lo === 7) lo = 0; if (hi === 7) hi = 0; }
    if (!Number.isInteger(lo) || !Number.isInteger(hi)) throw new Error(`Invalid value in "${part}"`);

    if (lo < min || hi > max || lo > hi) throw new Error(`"${part}" out of range ${min}-${max}`);
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  if (values.size === 0) throw new Error(`Empty field "${raw}"`);
  return { values, star, raw };
}

/** Parse a full cron expression (5 or 6 fields). Throws with a clear message on error. */
export function parseCron(expr: string): Cron {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5 && fields.length !== 6) {
    throw new Error(`Expected 5 or 6 fields, got ${fields.length}`);
  }
  const hasSeconds = fields.length === 6;
  const off = hasSeconds ? 1 : 0;
  return {
    hasSeconds,
    second: hasSeconds ? parseField(fields[0], 0, 59) : undefined,
    minute: parseField(fields[off], 0, 59),
    hour: parseField(fields[off + 1], 0, 23),
    dom: parseField(fields[off + 2], 1, 31),
    month: parseField(fields[off + 3], 1, 12, MONTHS),
    dow: parseField(fields[off + 4], 0, 6, DAYS),
  };
}

/** Does a given date satisfy the cron expression? */
export function matches(date: Date, cron: Cron): boolean {
  if (cron.hasSeconds && cron.second && !cron.second.values.has(date.getSeconds())) return false;
  if (!cron.minute.values.has(date.getMinutes())) return false;
  if (!cron.hour.values.has(date.getHours())) return false;
  if (!cron.month.values.has(date.getMonth() + 1)) return false;

  const domMatch = cron.dom.values.has(date.getDate());
  const dowMatch = cron.dow.values.has(date.getDay());
  if (!cron.dom.star && !cron.dow.star) return domMatch || dowMatch;
  if (!cron.dom.star) return domMatch;
  if (!cron.dow.star) return dowMatch;
  return true;
}

/** Compute the next `count` run times at or after `from` (exclusive of `from`). */
export function nextRuns(cron: Cron, from: Date, count = 5): Date[] {
  const runs: Date[] = [];
  const stepMs = cron.hasSeconds ? 1000 : 60_000;
  // Align to the next step boundary.
  const d = new Date(from.getTime());
  if (cron.hasSeconds) d.setMilliseconds(0);
  else { d.setSeconds(0, 0); }
  d.setTime(d.getTime() + stepMs);

  const maxIter = cron.hasSeconds ? 400_000 : 600_000; // ~4.6 days of seconds / ~1.1 years of minutes
  let t = d.getTime();
  for (let i = 0; i < maxIter && runs.length < count; i++) {
    const cur = new Date(t);
    if (matches(cur, cron)) runs.push(cur);
    t += stepMs;
  }
  return runs;
}

/** Best-effort human summary of a cron expression. */
export function describeCron(cron: Cron): string {
  const list = (f: CronField, unit: string) => (f.star ? `every ${unit}` : `${unit} ${[...f.values].sort((a, b) => a - b).join(", ")}`);
  const parts = [
    cron.hasSeconds ? list(cron.second!, "second") : null,
    list(cron.minute, "minute"),
    list(cron.hour, "hour"),
    cron.dom.star ? null : `day-of-month ${[...cron.dom.values].sort((a, b) => a - b).join(", ")}`,
    cron.month.star ? null : `month ${[...cron.month.values].sort((a, b) => a - b).join(", ")}`,
    cron.dow.star ? null : `weekday ${[...cron.dow.values].sort((a, b) => a - b).map((d) => DAYS[d]).join(", ")}`,
  ].filter(Boolean);
  return parts.join(" · ");
}
