/** Unix timestamp / date conversion helpers. */

export interface ParsedTimestamp {
  date: Date;
  detectedUnit: "seconds" | "milliseconds";
}

/** Detect whether a numeric timestamp is in seconds or milliseconds and parse it. */
export function parseUnixTimestamp(value: string): ParsedTimestamp {
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) throw new Error("Not a valid integer timestamp");
  const num = Number(trimmed);
  // Values with 13+ digits are milliseconds; ~10 digits are seconds.
  const detectedUnit = Math.abs(num) >= 1e12 ? "milliseconds" : "seconds";
  const ms = detectedUnit === "milliseconds" ? num : num * 1000;
  const date = new Date(ms);
  if (isNaN(date.getTime())) throw new Error("Timestamp out of range");
  return { date, detectedUnit };
}

export interface TimeView {
  unixSeconds: number;
  unixMillis: number;
  iso: string;
  utc: string;
  local: string;
  ist: string;
  relative: string;
}

function inZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

/** Relative time such as "2 minutes ago" / "in 3 hours". */
export function relativeTime(date: Date, now: number = Date.now()): string {
  const diffSec = Math.round((date.getTime() - now) / 1000);
  const abs = Math.abs(diffSec);
  const units: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "second"],
    [3600, "minute"],
    [86400, "hour"],
    [2592000, "day"],
    [31536000, "month"],
    [Infinity, "year"],
  ];
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  let divisor = 1;
  let unit: Intl.RelativeTimeFormatUnit = "second";
  const boundaries: [number, number, Intl.RelativeTimeFormatUnit][] = [
    [60, 1, "second"],
    [3600, 60, "minute"],
    [86400, 3600, "hour"],
    [2592000, 86400, "day"],
    [31536000, 2592000, "month"],
    [Infinity, 31536000, "year"],
  ];
  for (const [limit, div, u] of boundaries) {
    if (abs < limit) {
      divisor = div;
      unit = u;
      break;
    }
  }
  void units;
  return rtf.format(Math.round(diffSec / divisor), unit);
}

export function buildTimeView(date: Date, now: number = Date.now()): TimeView {
  return {
    unixSeconds: Math.floor(date.getTime() / 1000),
    unixMillis: date.getTime(),
    iso: date.toISOString(),
    utc: inZone(date, "UTC") + " UTC",
    local: inZone(date, Intl.DateTimeFormat().resolvedOptions().timeZone),
    ist: inZone(date, "Asia/Kolkata") + " IST",
    relative: relativeTime(date, now),
  };
}
