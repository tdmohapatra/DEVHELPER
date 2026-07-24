import yaml from "js-yaml";

export interface YamlValidation {
  valid: boolean;
  error?: string;
}

export function validateYaml(input: string): YamlValidation {
  if (!input.trim()) return { valid: false, error: "Input is empty" };
  try {
    yaml.load(input);
    return { valid: true };
  } catch (e) {
    return { valid: false, error: (e as Error).message };
  }
}

/** Normalize/format YAML by round-tripping through the parser. */
export function formatYaml(input: string, indent = 2): string {
  const doc = yaml.load(input);
  return yaml.dump(doc, { indent, lineWidth: 120, noRefs: true }).trimEnd();
}

export function yamlToJson(input: string, indent = 2): string {
  const doc = yaml.load(input);
  return JSON.stringify(doc, null, indent);
}

export function jsonToYaml(input: string, indent = 2): string {
  const obj = JSON.parse(input);
  return yaml.dump(obj, { indent, lineWidth: 120, noRefs: true }).trimEnd();
}
