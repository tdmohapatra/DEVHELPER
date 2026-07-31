/**
 * Dynamic variables — `{{$guid}}`, `{{$timestamp}}` and friends.
 *
 * Every request that creates something needs a fresh id, and every signed request needs a
 * current timestamp. Typing those by hand is the small friction that makes an API client
 * annoying, so they are generated at send time like Postman does.
 *
 * Each generator is resolved independently per occurrence, so two `{{$guid}}` in one body
 * produce two different ids — which is what a "create two records" request needs.
 */

export interface DynamicVar {
  name: string;
  description: string;
  example: string;
}

/** Injectable clock and randomness, so the generators can be tested deterministically. */
export interface DynamicContext {
  now: () => number;
  random: () => number;
}

const defaultContext: DynamicContext = { now: () => Date.now(), random: () => Math.random() };

const ALPHABET = "abcdefghijklmnopqrstuvwxyz";

function randomHex(ctx: DynamicContext, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += Math.floor(ctx.random() * 16).toString(16);
  return out;
}

/** RFC 4122 version 4 shape, built from the injected randomness. */
function guid(ctx: DynamicContext): string {
  const s = randomHex(ctx, 32).split("");
  s[12] = "4";
  s[16] = ((parseInt(s[16], 16) & 0x3) | 0x8).toString(16);
  const hex = s.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

type Generator = (ctx: DynamicContext, arg?: string) => string;

const GENERATORS: Record<string, Generator> = {
  guid: (ctx) => guid(ctx),
  uuid: (ctx) => guid(ctx),
  timestamp: (ctx) => String(Math.floor(ctx.now() / 1000)),
  epoch: (ctx) => String(ctx.now()),
  isoTimestamp: (ctx) => new Date(ctx.now()).toISOString(),
  randomInt: (ctx, arg) => {
    // `{{$randomInt:1-100}}` narrows the range; the default matches Postman's 0–1000.
    const range = /^(-?\d+)-(-?\d+)$/.exec(arg ?? "");
    const min = range ? Number(range[1]) : 0;
    const max = range ? Number(range[2]) : 1000;
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    return String(lo + Math.floor(ctx.random() * (hi - lo + 1)));
  },
  randomAlpha: (ctx, arg) => {
    const length = Number(arg) > 0 ? Number(arg) : 8;
    let out = "";
    for (let i = 0; i < length; i++) out += ALPHABET[Math.floor(ctx.random() * ALPHABET.length)];
    return out;
  },
  randomEmail: (ctx) => `${GENERATORS.randomAlpha(ctx, "8")}@example.com`,
  randomBoolean: (ctx) => (ctx.random() < 0.5 ? "false" : "true"),
};

export const DYNAMIC_VARS: DynamicVar[] = [
  { name: "$guid", description: "A new UUID v4", example: "3f1a…-…" },
  { name: "$uuid", description: "Alias of $guid", example: "3f1a…-…" },
  { name: "$timestamp", description: "Unix time in seconds", example: "1735689600" },
  { name: "$epoch", description: "Unix time in milliseconds", example: "1735689600000" },
  { name: "$isoTimestamp", description: "Current time, ISO 8601", example: "2026-07-31T09:00:00.000Z" },
  { name: "$randomInt", description: "Integer 0–1000, or $randomInt:1-100", example: "742" },
  { name: "$randomAlpha", description: "Letters, 8 by default, or $randomAlpha:16", example: "kdmqzrpa" },
  { name: "$randomEmail", description: "An address at example.com", example: "kdmqzrpa@example.com" },
  { name: "$randomBoolean", description: "true or false", example: "true" },
];

/** True when a name is a dynamic variable rather than an environment one. */
export function isDynamicVar(name: string): boolean {
  return name.startsWith("$") && Object.prototype.hasOwnProperty.call(GENERATORS, name.slice(1).split(":")[0]);
}

/**
 * Replace dynamic placeholders in a string. Environment variables are untouched — they
 * are substituted separately, so an unresolved `{{token}}` can still be reported.
 */
export function resolveDynamic(input: string, ctx: DynamicContext = defaultContext): string {
  return input.replace(/\{\{\s*\$([\w]+)(?::([^}]*))?\s*\}\}/g, (match, name: string, arg?: string) => {
    const generator = GENERATORS[name];
    return generator ? generator(ctx, arg) : match;
  });
}
