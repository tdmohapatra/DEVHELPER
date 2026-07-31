/**
 * Advanced FHIR R4 handling: bundle analysis, reference resolution, deeper validation,
 * search building and public test servers.
 *
 * Developer/integration utility only — NOT clinical software. Validation here is
 * structural, not a conformance statement: it catches the mistakes that break an
 * integration, and says nothing about clinical safety or profile conformance.
 */

import { queryJsonPath } from "./jsonPath";

// ---- Required elements -----------------------------------------------------

/**
 * Elements R4 marks as 1..1 on the resources this tool works with. Kept short and
 * checkable rather than attempting the full specification.
 */
const REQUIRED_ELEMENTS: Record<string, string[]> = {
  Patient: [],
  Observation: ["status", "code"],
  Encounter: ["status", "class"],
  Condition: ["subject"],
  Procedure: ["status", "subject"],
  MedicationRequest: ["status", "intent", "subject"],
  DiagnosticReport: ["status", "code"],
  AllergyIntolerance: ["patient"],
  Immunization: ["status", "vaccineCode", "patient", "occurrenceDateTime"],
  Bundle: ["type"],
  Practitioner: [],
  Organization: [],
  Medication: [],
};

/** Values R4 allows for the status elements most often typed by hand. */
const STATUS_VALUES: Record<string, string[]> = {
  Observation: ["registered", "preliminary", "final", "amended", "corrected", "cancelled", "entered-in-error", "unknown"],
  Encounter: ["planned", "arrived", "triaged", "in-progress", "onleave", "finished", "cancelled", "entered-in-error", "unknown"],
  MedicationRequest: ["active", "on-hold", "cancelled", "completed", "entered-in-error", "stopped", "draft", "unknown"],
  DiagnosticReport: ["registered", "partial", "preliminary", "final", "amended", "corrected", "appended", "cancelled", "entered-in-error", "unknown"],
  Procedure: ["preparation", "in-progress", "not-done", "on-hold", "stopped", "completed", "entered-in-error", "unknown"],
};

const BUNDLE_TYPES = ["document", "message", "transaction", "transaction-response", "batch", "batch-response", "history", "searchset", "collection"];

export interface FhirIssue {
  severity: "error" | "warning";
  message: string;
  /** JSON path of the element concerned. */
  location?: string;
}

const DATE_RE = /^\d{4}(-\d{2}(-\d{2})?)?$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** Structural validation of one resource. */
export function validateFhirResource(resource: unknown, path = "$"): FhirIssue[] {
  const issues: FhirIssue[] = [];
  if (!resource || typeof resource !== "object") {
    return [{ severity: "error", message: "Not a JSON object", location: path }];
  }
  const obj = resource as Record<string, unknown>;
  const type = obj.resourceType;

  if (typeof type !== "string" || !type) {
    return [{ severity: "error", message: "Missing 'resourceType'", location: `${path}.resourceType` }];
  }

  const required = REQUIRED_ELEMENTS[type];
  if (!required) {
    issues.push({ severity: "warning", message: `No validation rules known for ${type}`, location: path });
  } else {
    for (const element of required) {
      if (obj[element] === undefined) {
        issues.push({ severity: "error", message: `${type} requires '${element}'`, location: `${path}.${element}` });
      }
    }
  }

  const allowed = STATUS_VALUES[type];
  if (allowed && typeof obj.status === "string" && !allowed.includes(obj.status)) {
    issues.push({
      severity: "error",
      message: `'${obj.status}' is not a valid ${type}.status — expected one of ${allowed.slice(0, 5).join(", ")}…`,
      location: `${path}.status`,
    });
  }

  if (type === "Bundle" && typeof obj.type === "string" && !BUNDLE_TYPES.includes(obj.type)) {
    issues.push({ severity: "error", message: `'${obj.type}' is not a valid Bundle.type`, location: `${path}.type` });
  }

  if (typeof obj.birthDate === "string" && !DATE_RE.test(obj.birthDate)) {
    issues.push({ severity: "error", message: `birthDate must be YYYY, YYYY-MM or YYYY-MM-DD — got "${obj.birthDate}"`, location: `${path}.birthDate` });
  }

  for (const key of ["effectiveDateTime", "recordedDate", "authoredOn", "occurrenceDateTime", "issued"]) {
    const value = obj[key];
    if (typeof value === "string" && !DATETIME_RE.test(value)) {
      issues.push({ severity: "error", message: `${key} must be a full dateTime with a timezone — got "${value}"`, location: `${path}.${key}` });
    }
  }

  // A coding without a system cannot be interpreted by a receiver.
  for (const coding of findCodings(obj)) {
    if (coding.code && !coding.system) {
      issues.push({ severity: "warning", message: `Coding "${coding.code}" has no 'system', so the code is ambiguous`, location: path });
    }
  }

  return issues;
}

function findCodings(obj: unknown, depth = 0): { code?: string; system?: string }[] {
  if (depth > 6 || !obj || typeof obj !== "object") return [];
  const out: { code?: string; system?: string }[] = [];
  if (Array.isArray(obj)) {
    for (const item of obj) out.push(...findCodings(item, depth + 1));
    return out;
  }
  const record = obj as Record<string, unknown>;
  if (Array.isArray(record.coding)) {
    for (const c of record.coding as Record<string, unknown>[]) {
      out.push({ code: typeof c.code === "string" ? c.code : undefined, system: typeof c.system === "string" ? c.system : undefined });
    }
  }
  for (const value of Object.values(record)) {
    if (value && typeof value === "object") out.push(...findCodings(value, depth + 1));
  }
  return out;
}

// ---- Bundle analysis -------------------------------------------------------

export interface BundleEntrySummary {
  index: number;
  resourceType: string;
  id?: string;
  fullUrl?: string;
  /** Request method and URL, for transaction and batch bundles. */
  request?: string;
  issues: FhirIssue[];
}

export interface BundleAnalysis {
  type: string;
  total?: number;
  entryCount: number;
  counts: { resourceType: string; count: number }[];
  entries: BundleEntrySummary[];
  /** References that point outside the bundle. */
  unresolved: { from: string; reference: string }[];
  /** fullUrl values used more than once. */
  duplicateUrls: string[];
  issues: FhirIssue[];
}

export class FhirParseError extends Error {}

/**
 * Break a bundle down: what is in it, whether entries validate, and whether the
 * references between them resolve. A transaction that references a resource it does not
 * contain is the classic failure, and the server error for it is unhelpful.
 */
export function analyzeBundle(input: string): BundleAnalysis {
  let bundle: Record<string, unknown>;
  try {
    bundle = JSON.parse(input);
  } catch (e) {
    throw new FhirParseError(`Not valid JSON: ${(e as Error).message}`);
  }
  if (bundle?.resourceType !== "Bundle") throw new FhirParseError("Not a Bundle — 'resourceType' must be \"Bundle\"");

  const rawEntries = Array.isArray(bundle.entry) ? (bundle.entry as Record<string, unknown>[]) : [];
  const entries: BundleEntrySummary[] = rawEntries.map((entry, index) => {
    const resource = entry.resource as Record<string, unknown> | undefined;
    const request = entry.request as Record<string, unknown> | undefined;
    return {
      index,
      resourceType: (resource?.resourceType as string) ?? "(none)",
      id: resource?.id as string | undefined,
      fullUrl: entry.fullUrl as string | undefined,
      request: request ? `${request.method ?? "?"} ${request.url ?? ""}`.trim() : undefined,
      issues: resource ? validateFhirResource(resource, `$.entry[${index}].resource`) : [{ severity: "error" as const, message: "Entry has no resource", location: `$.entry[${index}]` }],
    };
  });

  // Everything the bundle can satisfy: Type/id, fullUrl, and urn:uuid identities.
  const contained = new Set<string>();
  rawEntries.forEach((entry) => {
    const resource = entry.resource as Record<string, unknown> | undefined;
    if (resource?.resourceType && resource.id) contained.add(`${resource.resourceType}/${resource.id}`);
    if (typeof entry.fullUrl === "string") contained.add(entry.fullUrl);
  });

  const unresolved: { from: string; reference: string }[] = [];
  rawEntries.forEach((entry, index) => {
    const resource = entry.resource;
    if (!resource) return;
    for (const reference of collectReferences(resource)) {
      // Absolute URLs point at another server and are not the bundle's problem.
      if (/^https?:\/\//i.test(reference)) continue;
      if (!contained.has(reference)) {
        unresolved.push({ from: `$.entry[${index}].resource`, reference });
      }
    }
  });

  const urlCounts = new Map<string, number>();
  for (const entry of rawEntries) {
    if (typeof entry.fullUrl === "string") urlCounts.set(entry.fullUrl, (urlCounts.get(entry.fullUrl) ?? 0) + 1);
  }

  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.resourceType, (counts.get(entry.resourceType) ?? 0) + 1);

  const issues = validateFhirResource(bundle);
  const type = (bundle.type as string) ?? "";
  if ((type === "transaction" || type === "batch") && rawEntries.some((e) => !e.request)) {
    issues.push({ severity: "error", message: `A ${type} Bundle requires 'request' on every entry`, location: "$.entry" });
  }

  return {
    type,
    total: typeof bundle.total === "number" ? bundle.total : undefined,
    entryCount: rawEntries.length,
    counts: [...counts.entries()].map(([resourceType, count]) => ({ resourceType, count })).sort((a, b) => b.count - a.count),
    entries,
    unresolved,
    duplicateUrls: [...urlCounts.entries()].filter(([, n]) => n > 1).map(([url]) => url),
    issues,
  };
}

/** Every `reference` string anywhere in a resource. */
export function collectReferences(obj: unknown, depth = 0): string[] {
  if (depth > 8 || !obj || typeof obj !== "object") return [];
  if (Array.isArray(obj)) return obj.flatMap((item) => collectReferences(item, depth + 1));
  const record = obj as Record<string, unknown>;
  const out: string[] = [];
  if (typeof record.reference === "string") out.push(record.reference);
  for (const value of Object.values(record)) {
    if (value && typeof value === "object") out.push(...collectReferences(value, depth + 1));
  }
  return out;
}

// ---- Extraction ------------------------------------------------------------

export interface TableColumn {
  header: string;
  /** JSONPath evaluated against each resource. */
  path: string;
}

/** Flatten resources into rows — the shape needed to paste into a spreadsheet. */
export function extractTable(resources: unknown[], columns: TableColumn[]): string[][] {
  return resources.map((resource) =>
    columns.map((column) => {
      try {
        const matches = queryJsonPath(resource, column.path);
        if (matches.length === 0) return "";
        const value = matches.length === 1 ? matches[0].value : matches.map((m) => m.value);
        return typeof value === "string" ? value : JSON.stringify(value);
      } catch {
        return "";
      }
    }),
  );
}

/** Resources inside a bundle, or the single resource itself. */
export function resourcesOf(input: string): Record<string, unknown>[] {
  const parsed = JSON.parse(input);
  if (parsed?.resourceType === "Bundle" && Array.isArray(parsed.entry)) {
    return (parsed.entry as Record<string, unknown>[]).map((e) => e.resource as Record<string, unknown>).filter(Boolean);
  }
  return parsed?.resourceType ? [parsed] : [];
}

/** Default columns per resource type, so the table is useful before configuring it. */
export const DEFAULT_COLUMNS: Record<string, TableColumn[]> = {
  Patient: [
    { header: "id", path: "$.id" },
    { header: "family", path: "$.name[0].family" },
    { header: "given", path: "$.name[0].given[0]" },
    { header: "gender", path: "$.gender" },
    { header: "birthDate", path: "$.birthDate" },
  ],
  Observation: [
    { header: "id", path: "$.id" },
    { header: "status", path: "$.status" },
    { header: "code", path: "$.code.coding[0].code" },
    { header: "display", path: "$.code.coding[0].display" },
    { header: "value", path: "$.valueQuantity.value" },
    { header: "unit", path: "$.valueQuantity.unit" },
  ],
  Encounter: [
    { header: "id", path: "$.id" },
    { header: "status", path: "$.status" },
    { header: "class", path: "$.class.code" },
    { header: "subject", path: "$.subject.reference" },
  ],
};

export function toCsv(headers: string[], rows: string[][]): string {
  const escape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [headers.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))].join("\n");
}

// ---- Search ----------------------------------------------------------------

export interface FhirServer {
  id: string;
  name: string;
  baseUrl: string;
  description: string;
}

/** Public R4 sandboxes, each verified to answer an unauthenticated search. */
export const FHIR_SERVERS: FhirServer[] = [
  {
    id: "hapi",
    name: "HAPI FHIR (R4)",
    baseUrl: "https://hapi.fhir.org/baseR4",
    description: "The reference public sandbox. Open read and write; data is shared and periodically reset.",
  },
  {
    id: "firely",
    name: "Firely Server",
    baseUrl: "https://server.fire.ly",
    description: "Firely's public R4 endpoint.",
  },
  {
    id: "smart-r4",
    name: "SMART Health IT (R4)",
    baseUrl: "https://r4.smarthealthit.org",
    description: "SMART's sandbox, populated with synthetic patients — good for realistic searches.",
  },
  {
    id: "smart-launch",
    name: "SMART launch sandbox",
    baseUrl: "https://launch.smarthealthit.org/v/r4/fhir",
    description: "The SMART App Launch sandbox, same synthetic dataset.",
  },
];

export interface SearchParam {
  name: string;
  value: string;
  enabled: boolean;
}

/** Common search parameters, offered per resource type. */
export const COMMON_SEARCH_PARAMS: Record<string, string[]> = {
  Patient: ["_id", "identifier", "name", "family", "given", "birthdate", "gender", "address-city", "_count", "_sort"],
  Observation: ["patient", "subject", "code", "category", "date", "status", "value-quantity", "_count", "_sort"],
  Encounter: ["patient", "status", "class", "date", "_count"],
  Condition: ["patient", "clinical-status", "code", "onset-date", "_count"],
  MedicationRequest: ["patient", "status", "intent", "authoredon", "_count"],
  DiagnosticReport: ["patient", "code", "date", "status", "_count"],
};

/** Build a search URL from a base, resource type and parameters. */
export function buildSearchUrl(baseUrl: string, resourceType: string, params: SearchParam[]): string {
  const base = baseUrl.replace(/\/+$/, "");
  const query = params
    .filter((p) => p.enabled && p.name.trim() && p.value.trim())
    .map((p) => `${encodeURIComponent(p.name.trim())}=${encodeURIComponent(p.value.trim())}`)
    .join("&");
  return `${base}/${resourceType}${query ? `?${query}` : ""}`;
}
