/**
 * Clinical code systems — validating, explaining and crosswalking them.
 *
 * **No code set is bundled here, and that is deliberate.**
 *
 * - **CPT** is copyrighted by the AMA and needs a licence to redistribute.
 * - **SNOMED CT** needs an affiliate licence (free in member countries, still a
 *   licence).
 * - **LOINC** is free but its licence has terms, and the table is large.
 * - **ICD-10-CM** *is* public domain (CMS publishes it), but it is ~70,000 rows
 *   and shipping it would dwarf the application.
 *
 * So this validates **structure**, which is a property of the code itself and
 * needs no table: the format, what each position means, and the check digit
 * where the system has one. For descriptions and crosswalks you import your own
 * file — which is also the honest arrangement, because the mapping from your
 * local codes to a standard is yours and is not in anybody's published table.
 *
 * What that buys in practice: "is 0042T a real CPT code?" cannot be answered
 * here, but "is `99213` shaped like an ICD-10 code?" (no, it is CPT-shaped),
 * "did this SNOMED id come through the interface intact?" (the check digit
 * says), "is this NDC the 10-digit form off the bottle or the 11-digit form the
 * claim wants?" and "which of the 400 codes in this feed have no local
 * mapping?" (the crosswalk report) all can.
 */

// ---------------------------------------------------------------------------
// Systems
// ---------------------------------------------------------------------------

export type CodeSystem = "icd10cm" | "icd10pcs" | "cpt" | "hcpcs" | "loinc" | "snomed" | "ndc" | "rxnorm";

export interface SystemInfo {
  id: CodeSystem;
  label: string;
  /** The URI a FHIR Coding.system should carry. */
  uri: string;
  /** Who owns it, and what that means for shipping the table. */
  licence: string;
  shape: string;
}

export const SYSTEMS: SystemInfo[] = [
  {
    id: "icd10cm",
    label: "ICD-10-CM (diagnosis)",
    uri: "http://hl7.org/fhir/sid/icd-10-cm",
    licence: "Public domain — published by CMS/NCHS. Free to redistribute; not bundled here only because it is ~70,000 rows.",
    shape: "Letter, two digits, then up to four more characters after a dot: E11.9, S72.001A",
  },
  {
    id: "icd10pcs",
    label: "ICD-10-PCS (procedure)",
    uri: "http://www.cms.gov/Medicare/Coding/ICD10",
    licence: "Public domain — published by CMS.",
    shape: "Exactly seven alphanumeric characters, no dot; each position is a fixed axis: 0DTJ0ZZ",
  },
  {
    id: "cpt",
    label: "CPT (procedure)",
    uri: "http://www.ama-assn.org/go/cpt",
    licence: "Copyright AMA. A licence is required to redistribute the code set — this tool never ships it and cannot tell you whether a code exists.",
    shape: "Five digits (99213), or four digits and a letter for Category II (F) and III (T): 0042T",
  },
  {
    id: "hcpcs",
    label: "HCPCS Level II",
    uri: "http://terminology.hl7.org/CodeSystem/HCPCS",
    licence: "Public domain — published by CMS.",
    shape: "One letter then four digits: J1885",
  },
  {
    id: "loinc",
    label: "LOINC (observation)",
    uri: "http://loinc.org",
    licence: "Free under the LOINC licence, which must be accepted. Not bundled.",
    shape: "Digits, a hyphen, then one check digit: 718-7",
  },
  {
    id: "snomed",
    label: "SNOMED CT",
    uri: "http://snomed.info/sct",
    licence: "Requires an affiliate licence (free in member countries — India is not one). Never bundled.",
    shape: "6–18 digits, ending in a Verhoeff check digit: 271649006",
  },
  {
    id: "ndc",
    label: "NDC (drug)",
    uri: "http://hl7.org/fhir/sid/ndc",
    licence: "Public domain — published by the FDA.",
    shape: "Labeler-product-package, 10 digits as 4-4-2, 5-3-2 or 5-4-1, or 11 digits as 5-4-2",
  },
  {
    id: "rxnorm",
    label: "RxNorm (RXCUI)",
    uri: "http://www.nlm.nih.gov/research/umls/rxnorm",
    licence: "Free from the NLM with a UMLS licence.",
    shape: "A plain number, no check digit: 1049502",
  },
];

export const SYSTEM_BY_ID = Object.fromEntries(SYSTEMS.map((s) => [s.id, s])) as Record<CodeSystem, SystemInfo>;

// ---------------------------------------------------------------------------
// Check digits
// ---------------------------------------------------------------------------

// Verhoeff tables: the dihedral group D5 multiplication, the permutation, and
// the inverses. Verhoeff catches every single-digit error and every adjacent
// transposition, which is why SNOMED uses it — those are exactly the two errors
// a human retyping an 18-digit id makes.
const D5 = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const PERM = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

/** True when the digits end in a valid Verhoeff check digit (SNOMED CT ids do). */
export function verhoeffValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let c = 0;
  const reversed = digits.split("").reverse();
  for (let i = 0; i < reversed.length; i++) {
    c = D5[c][PERM[i % 8][Number(reversed[i])]];
  }
  return c === 0;
}

/** The Verhoeff check digit for a body of digits, i.e. what should be appended. */
export function verhoeffDigit(body: string): number {
  let c = 0;
  const reversed = `${body}0`.split("").reverse();
  for (let i = 0; i < reversed.length; i++) {
    c = D5[c][PERM[i % 8][Number(reversed[i])]];
  }
  return [0, 4, 3, 2, 1, 5, 6, 7, 8, 9][c];
}

/**
 * The LOINC check digit — "mod 10, double add double".
 *
 * Same family as a credit-card Luhn, computed over the part before the hyphen.
 */
export function loincCheckDigit(body: string): number | null {
  if (!/^\d+$/.test(body)) return null;
  let sum = 0;
  const reversed = body.split("").reverse();
  for (let i = 0; i < reversed.length; i++) {
    let digit = Number(reversed[i]);
    // Doubling starts at the digit adjacent to the check digit.
    if (i % 2 === 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return (10 - (sum % 10)) % 10;
}

// ---------------------------------------------------------------------------
// ICD-10-CM structure
// ---------------------------------------------------------------------------

/**
 * The ICD-10-CM chapters, by the code range each covers.
 *
 * Twenty-two rows of public-domain fact, and enough to say what a code is
 * *about* without the 70,000-row table. Someone reading a feed of diagnoses
 * mostly wants "these are all injuries", not each description.
 */
export const ICD10_CHAPTERS: { from: string; to: string; title: string }[] = [
  { from: "A00", to: "B99", title: "Certain infectious and parasitic diseases" },
  { from: "C00", to: "D49", title: "Neoplasms" },
  { from: "D50", to: "D89", title: "Diseases of the blood and blood-forming organs, and certain immune disorders" },
  { from: "E00", to: "E89", title: "Endocrine, nutritional and metabolic diseases" },
  { from: "F01", to: "F99", title: "Mental, behavioural and neurodevelopmental disorders" },
  { from: "G00", to: "G99", title: "Diseases of the nervous system" },
  { from: "H00", to: "H59", title: "Diseases of the eye and adnexa" },
  { from: "H60", to: "H95", title: "Diseases of the ear and mastoid process" },
  { from: "I00", to: "I99", title: "Diseases of the circulatory system" },
  { from: "J00", to: "J99", title: "Diseases of the respiratory system" },
  { from: "K00", to: "K95", title: "Diseases of the digestive system" },
  { from: "L00", to: "L99", title: "Diseases of the skin and subcutaneous tissue" },
  { from: "M00", to: "M99", title: "Diseases of the musculoskeletal system and connective tissue" },
  { from: "N00", to: "N99", title: "Diseases of the genitourinary system" },
  { from: "O00", to: "O9A", title: "Pregnancy, childbirth and the puerperium" },
  { from: "P00", to: "P96", title: "Certain conditions originating in the perinatal period" },
  { from: "Q00", to: "Q99", title: "Congenital malformations, deformations and chromosomal abnormalities" },
  { from: "R00", to: "R99", title: "Symptoms, signs and abnormal findings, not elsewhere classified" },
  { from: "S00", to: "T88", title: "Injury, poisoning and certain other consequences of external causes" },
  { from: "U00", to: "U85", title: "Codes for special purposes (including U07.1, COVID-19)" },
  { from: "V00", to: "Y99", title: "External causes of morbidity" },
  { from: "Z00", to: "Z99", title: "Factors influencing health status and contact with health services" },
];

/** The chapter a three-character ICD-10 category falls in. */
export function icd10Chapter(code: string): string | null {
  const category = code.trim().toUpperCase().replace(/\./g, "").slice(0, 3);
  if (category.length < 3) return null;
  for (const chapter of ICD10_CHAPTERS) {
    if (category >= chapter.from && category <= chapter.to) return chapter.title;
  }
  return null;
}

// ---------------------------------------------------------------------------
// NDC
// ---------------------------------------------------------------------------

/**
 * An NDC in its 11-digit form.
 *
 * The same drug is printed 4-4-2 on the bottle and stored 5-4-2 in the claim,
 * and the conversion is a zero-pad of whichever segment is short. Doing it by
 * string length rather than by segment — which is the obvious-looking shortcut —
 * pads the wrong place and silently identifies a different product.
 */
export function normalizeNdc(code: string): string | null {
  const parts = code.trim().split("-");
  if (parts.length !== 3) {
    const digits = code.replace(/\D/g, "");
    // With no segment markers an 11-digit code is already normalised; a 10-digit
    // one is ambiguous and must not be guessed at.
    return digits.length === 11 ? digits : null;
  }
  const [labeler, product, pack] = parts;
  if (!/^\d+$/.test(labeler + product + pack)) return null;
  if (labeler.length > 5 || product.length > 4 || pack.length > 2) return null;
  return labeler.padStart(5, "0") + product.padStart(4, "0") + pack.padStart(2, "0");
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface CodeIssue {
  level: "error" | "warn" | "info";
  message: string;
}

export interface CodeReport {
  system: CodeSystem;
  input: string;
  /** The code as the system would store it. */
  normalized: string;
  /** Structurally possible. Says nothing about whether the code exists. */
  valid: boolean;
  issues: CodeIssue[];
  /** What each part of the code means, when the structure says. */
  parts: { label: string; value: string; note?: string }[];
}

/**
 * Validate one code's structure.
 *
 * `valid` means "this could be a code in that system", never "this code exists"
 * — existence needs the table, which is not here. Every report says so where it
 * matters, because the difference is the whole reason a claim gets rejected
 * after the format check passed.
 */
export function validateCode(system: CodeSystem, input: string): CodeReport {
  const raw = input.trim();
  const issues: CodeIssue[] = [];
  const parts: CodeReport["parts"] = [];
  let normalized = raw.toUpperCase();
  let valid = true;

  const fail = (message: string) => {
    issues.push({ level: "error", message });
    valid = false;
  };

  switch (system) {
    case "icd10cm": {
      normalized = raw.toUpperCase().replace(/\s/g, "");
      /*
       * Any letter opens a category. It is tempting to exclude the rare ones,
       * but every exclusion here was wrong: U07.1 is COVID-19, I10 is
       * hypertension and O80 is delivery. Which letters are *used* is a fact
       * about the CMS table, not about the structure.
       */
      const m = /^([A-Z])(\d)([\dAB])\.?([0-9A-Z]{0,4})$/.exec(normalized);
      if (!m) {
        fail("Not an ICD-10-CM shape. It is a letter, two digits — the third character may also be A or B, as in C4A and O9A — then up to four more characters, optionally after a dot.");
        break;
      }
      const [, letter, d1, d2, rest] = m;
      const category = `${letter}${d1}${d2}`;
      normalized = rest ? `${category}.${rest}` : category;
      parts.push({ label: "Category", value: category, note: icd10Chapter(category) ?? undefined });
      if (rest) {
        parts.push({ label: "Etiology / site / severity", value: rest.slice(0, 3) });
        if (rest.length === 4) {
          const extension = rest[3];
          parts.push({
            label: "7th character",
            value: extension,
            note:
              extension === "A" ? "initial encounter"
              : extension === "D" ? "subsequent encounter"
              : extension === "S" ? "sequela"
              : "extension — meaning depends on the category",
          });
        }
      }
      if (/^[ST]/.test(category) && rest.length < 4) {
        issues.push({
          level: "warn",
          message: "Injury and poisoning codes (S and T) usually require a 7th character. Without it the claim is likely to be rejected as incomplete.",
        });
      }
      issues.push({ level: "info", message: "Structure only — whether this code exists needs the CMS table, which is not bundled." });
      break;
    }

    case "icd10pcs": {
      normalized = raw.toUpperCase().replace(/[\s.]/g, "");
      if (!/^[0-9A-HJ-NP-Z]{7}$/.test(normalized)) {
        fail("ICD-10-PCS is exactly seven alphanumeric characters with no dot. The letters I and O are never used, to avoid confusion with 1 and 0.");
        break;
      }
      const axes = ["Section", "Body system", "Root operation", "Body part", "Approach", "Device", "Qualifier"];
      normalized.split("").forEach((c, i) => parts.push({ label: `${i + 1}. ${axes[i]}`, value: c }));
      issues.push({ level: "info", message: "Every position is an independent axis, so a PCS code is built rather than looked up." });
      break;
    }

    case "cpt": {
      normalized = raw.toUpperCase().replace(/\s/g, "");
      if (/^\d{5}$/.test(normalized)) {
        parts.push({ label: "Category I", value: normalized, note: "A procedure or service in the main code set." });
      } else if (/^\d{4}[FTUM]$/.test(normalized)) {
        const suffix = normalized[4];
        parts.push({
          label: suffix === "F" ? "Category II" : suffix === "T" ? "Category III" : "Category",
          value: normalized,
          note:
            suffix === "F" ? "A performance-measurement code. Optional for reimbursement — it tracks quality, not payment."
            : suffix === "T" ? "An emerging-technology code. Payers frequently deny these, which is usually the reason a claim came back."
            : "Suffixed code.",
        });
      } else {
        fail("CPT is five digits, or four digits and a category letter (0042T, 0001F).");
        break;
      }
      issues.push({
        level: "warn",
        message: "CPT is copyrighted by the AMA. This checks the shape only — the code set is not bundled and cannot be, so whether this code exists is not knowable here.",
      });
      break;
    }

    case "hcpcs": {
      normalized = raw.toUpperCase().replace(/\s/g, "");
      if (!/^[A-V]\d{4}$/.test(normalized)) {
        fail("HCPCS Level II is one letter (A–V) followed by four digits: J1885.");
        break;
      }
      parts.push({ label: "Section", value: normalized[0], note: hcpcsSection(normalized[0]) });
      parts.push({ label: "Code", value: normalized.slice(1) });
      break;
    }

    case "loinc": {
      normalized = raw.replace(/\s/g, "");
      const m = /^(\d{1,7})-(\d)$/.exec(normalized);
      if (!m) {
        fail("LOINC is digits, a hyphen, then a single check digit: 718-7.");
        break;
      }
      const [, body, check] = m;
      const expected = loincCheckDigit(body);
      parts.push({ label: "Code", value: body });
      parts.push({ label: "Check digit", value: check });
      if (expected !== null && expected !== Number(check)) {
        fail(`The check digit is wrong — ${body} should end in -${expected}. A single mistyped digit or a transposition is what this catches.`);
      }
      break;
    }

    case "snomed": {
      normalized = raw.replace(/\s/g, "");
      if (!/^\d{6,18}$/.test(normalized)) {
        fail("A SNOMED CT identifier is 6 to 18 digits with no separators.");
        break;
      }
      if (normalized.startsWith("0")) fail("A SNOMED identifier never starts with a zero.");
      if (!verhoeffValid(normalized)) {
        fail(`The Verhoeff check digit does not match — ${normalized.slice(0, -1)} should end in ${verhoeffDigit(normalized.slice(0, -1))}. This catches any single wrong digit and any swapped pair, which is exactly how a long id gets corrupted in transit.`);
        break;
      }
      // The two digits before the check digit say what kind of identifier it is.
      const partition = normalized.slice(-3, -1);
      parts.push({ label: "Identifier", value: normalized });
      parts.push({
        label: "Partition",
        value: partition,
        note:
          partition === "00" || partition === "10" ? "a concept id"
          : partition === "01" || partition === "11" ? "a description id — this names a concept, it is not the concept"
          : partition === "02" || partition === "12" ? "a relationship id"
          : "unrecognised partition",
      });
      if (partition === "01" || partition === "11") {
        issues.push({
          level: "warn",
          message: "This is a description id, not a concept id. Sending it where a concept is expected resolves to the wrong thing or to nothing.",
        });
      }
      issues.push({ level: "info", message: "The check digit is right, so the id is intact. Whether the concept exists needs the SNOMED release, which needs a licence." });
      break;
    }

    case "ndc": {
      const eleven = normalizeNdc(raw);
      if (!eleven) {
        fail("An NDC is three digit segments (4-4-2, 5-3-2, 5-4-1 or 5-4-2). Without the hyphens a 10-digit code is ambiguous — the same digits are a different product depending on which segment is short.");
        break;
      }
      normalized = eleven;
      parts.push({ label: "Labeler", value: eleven.slice(0, 5), note: "who makes or repackages it" });
      parts.push({ label: "Product", value: eleven.slice(5, 9), note: "strength, dosage form, formulation" });
      parts.push({ label: "Package", value: eleven.slice(9), note: "package size and type" });
      if (raw.includes("-") && raw.replace(/\D/g, "").length === 10) {
        issues.push({ level: "info", message: `Normalised from the 10-digit form on the label to the 11-digit form claims use: ${eleven}.` });
      }
      break;
    }

    case "rxnorm": {
      normalized = raw.replace(/\s/g, "");
      if (!/^\d{1,8}$/.test(normalized)) {
        fail("An RXCUI is a plain number.");
        break;
      }
      issues.push({ level: "info", message: "RxNorm has no check digit, so a mistyped RXCUI is a different, valid-looking drug. Verify against the API rather than by eye." });
      break;
    }
  }

  return { system, input: raw, normalized, valid, issues, parts };
}

function hcpcsSection(letter: string): string {
  const sections: Record<string, string> = {
    A: "transport, medical and surgical supplies",
    B: "enteral and parenteral therapy",
    C: "outpatient PPS",
    E: "durable medical equipment",
    G: "temporary procedures and professional services",
    J: "drugs administered other than orally",
    K: "temporary codes for DME contractors",
    L: "orthotics and prosthetics",
    P: "pathology and laboratory",
    Q: "temporary codes",
    R: "diagnostic radiology services",
    S: "temporary national codes (non-Medicare)",
    T: "state Medicaid agency codes",
    V: "vision and hearing services",
  };
  return sections[letter] ?? "section";
}

/**
 * Guess which system a code belongs to.
 *
 * Guessing is genuinely useful — a feed arrives with a bare code and no system
 * URI far more often than it should — but it is a guess, and the ambiguity is
 * real: five digits are equally a CPT code and part of an NDC. Ordered so the
 * unambiguous shapes win.
 */
export function detectSystem(code: string): CodeSystem | null {
  const value = code.trim().toUpperCase();
  if (/^\d{1,7}-\d$/.test(value)) return "loinc";
  if (/^[A-Z]\d[\dAB](\.[0-9A-Z]{1,4})?$/.test(value)) return "icd10cm";
  if (/^[A-V]\d{4}$/.test(value)) return "hcpcs";
  if (/^\d{4}[FT]$/.test(value)) return "cpt";
  if (/^\d+-\d+-\d+$/.test(value)) return "ndc";
  if (/^\d{6,18}$/.test(value) && verhoeffValid(value)) return "snomed";
  if (/^[0-9A-HJ-NP-Z]{7}$/.test(value) && /\d/.test(value)) return "icd10pcs";
  if (/^\d{5}$/.test(value)) return "cpt";
  return null;
}

// ---------------------------------------------------------------------------
// Crosswalk
// ---------------------------------------------------------------------------

export interface CrosswalkEntry {
  local: string;
  standard: string;
  system?: CodeSystem;
  description?: string;
}

export interface CrosswalkReport {
  mapped: { local: string; entry: CrosswalkEntry; report: CodeReport | null }[];
  /** Local codes in the feed that the table has no row for. */
  unmapped: string[];
  /** Table rows whose target code fails its own structure check. */
  invalidTargets: { entry: CrosswalkEntry; report: CodeReport }[];
  /** Table rows nothing in the feed used. */
  unused: CrosswalkEntry[];
}

/**
 * Parse a crosswalk table: `local, standard[, system[, description]]` per line.
 *
 * Deliberately the simplest format that a hospital analyst can produce from a
 * spreadsheet without help. A blank or `#` line is a comment.
 */
export function parseCrosswalk(text: string): CrosswalkEntry[] {
  const entries: CrosswalkEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const cells = trimmed.split(",").map((c) => c.trim());
    // Skip a header row rather than mapping "local code" to "standard code".
    if (/^local/i.test(cells[0]) && /^(standard|target|code)/i.test(cells[1] ?? "")) continue;
    const [local, standard, system, description] = cells;
    if (!local || !standard) continue;
    const known = SYSTEMS.find((s) => s.id === (system ?? "").toLowerCase());
    entries.push({ local, standard, system: known?.id ?? (detectSystem(standard) ?? undefined), description });
  }
  return entries;
}

/**
 * Run a feed of local codes through a crosswalk.
 *
 * The unmapped list is the deliverable. Everyone building an interface discovers
 * on go-live day that the table covers the codes someone thought of, and the
 * feed contains four hundred others.
 */
export function applyCrosswalk(codes: string[], entries: CrosswalkEntry[]): CrosswalkReport {
  const byLocal = new Map(entries.map((e) => [e.local.toUpperCase(), e]));
  const used = new Set<string>();
  const mapped: CrosswalkReport["mapped"] = [];
  const unmapped: string[] = [];

  for (const code of codes) {
    const key = code.trim().toUpperCase();
    if (!key) continue;
    const entry = byLocal.get(key);
    if (!entry) {
      if (!unmapped.includes(code.trim())) unmapped.push(code.trim());
      continue;
    }
    used.add(key);
    mapped.push({ local: code.trim(), entry, report: entry.system ? validateCode(entry.system, entry.standard) : null });
  }

  const invalidTargets: CrosswalkReport["invalidTargets"] = [];
  for (const entry of entries) {
    if (!entry.system) continue;
    const report = validateCode(entry.system, entry.standard);
    if (!report.valid) invalidTargets.push({ entry, report });
  }

  return {
    mapped,
    unmapped,
    invalidTargets,
    unused: entries.filter((e) => !used.has(e.local.toUpperCase())),
  };
}

/** Split a pasted feed into codes: one per line, or comma/space separated. */
export function splitCodes(text: string): string[] {
  return text
    .split(/[\r\n,;\t]+/)
    .map((c) => c.trim())
    .filter(Boolean);
}

/** A FHIR Coding for a validated code, ready to paste into a resource. */
export function toFhirCoding(report: CodeReport, display?: string): string {
  return JSON.stringify(
    { system: SYSTEM_BY_ID[report.system].uri, code: report.normalized, ...(display ? { display } : {}) },
    null,
    2,
  );
}
