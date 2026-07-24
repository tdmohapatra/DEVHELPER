/**
 * FHIR R4 helpers — developer/integration utility only, NOT clinical software.
 */

export const FHIR_R4_RESOURCES = [
  "Patient", "Observation", "Encounter", "Practitioner", "Organization",
  "Medication", "MedicationRequest", "DiagnosticReport", "Condition",
  "Procedure", "AllergyIntolerance", "Immunization", "Bundle",
] as const;

export interface FhirValidation {
  valid: boolean;
  resourceType?: string;
  knownResource: boolean;
  errors: string[];
}

export function validateFhir(input: string): FhirValidation {
  const errors: string[] = [];
  let obj: any;
  try {
    obj = JSON.parse(input);
  } catch (e) {
    return { valid: false, knownResource: false, errors: [(e as Error).message] };
  }
  const resourceType: string | undefined = obj?.resourceType;
  if (!resourceType) errors.push("Missing required 'resourceType' property");
  const knownResource = !!resourceType && (FHIR_R4_RESOURCES as readonly string[]).includes(resourceType);

  // Light per-resource sanity checks.
  if (resourceType === "Bundle" && obj.type === undefined) errors.push("Bundle missing 'type'");
  if (resourceType === "Observation" && obj.status === undefined) errors.push("Observation missing 'status'");

  return { valid: errors.length === 0, resourceType, knownResource, errors };
}

export interface FhirSummary {
  resourceType: string;
  id?: string;
  fields: { label: string; value: string }[];
}

function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Extract a few human-friendly fields for common resources. */
export function summarizeFhir(input: string): FhirSummary | null {
  let obj: any;
  try {
    obj = JSON.parse(input);
  } catch {
    return null;
  }
  const rt = obj?.resourceType;
  if (!rt) return null;
  const fields: { label: string; value: string }[] = [];
  const add = (label: string, value: string) => value && fields.push({ label, value });

  switch (rt) {
    case "Patient": {
      const name = obj.name?.[0];
      add("Name", name ? `${(name.given ?? []).join(" ")} ${name.family ?? ""}`.trim() : "");
      add("Gender", str(obj.gender));
      add("Birth Date", str(obj.birthDate));
      add("Identifiers", (obj.identifier ?? []).map((i: any) => i.value).join(", "));
      break;
    }
    case "Observation":
      add("Status", str(obj.status));
      add("Code", str(obj.code?.text ?? obj.code?.coding?.[0]?.display));
      add("Value", str(obj.valueQuantity ? `${obj.valueQuantity.value} ${obj.valueQuantity.unit ?? ""}` : obj.valueString));
      break;
    case "Encounter":
      add("Status", str(obj.status));
      add("Class", str(obj.class?.code));
      break;
    default:
      Object.entries(obj)
        .filter(([k]) => k !== "resourceType")
        .slice(0, 5)
        .forEach(([k, v]) => add(k, str(v).slice(0, 80)));
  }
  return { resourceType: rt, id: obj.id, fields };
}
