import { XMLParser, XMLBuilder, XMLValidator } from "fast-xml-parser";

const PARSE_OPTS = { ignoreAttributes: false, attributeNamePrefix: "@_", parseAttributeValue: true };

export interface XmlValidation {
  valid: boolean;
  error?: string;
}

export function validateXml(input: string): XmlValidation {
  if (!input.trim()) return { valid: false, error: "Input is empty" };
  const result = XMLValidator.validate(input, { allowBooleanAttributes: true });
  if (result === true) return { valid: true };
  return { valid: false, error: result.err.msg + (result.err.line ? ` (line ${result.err.line})` : "") };
}

export function formatXml(input: string, indent = 2): string {
  const parsed = new XMLParser(PARSE_OPTS).parse(input);
  const builder = new XMLBuilder({ ...PARSE_OPTS, format: true, indentBy: " ".repeat(indent) });
  return builder.build(parsed).trimEnd();
}

export function minifyXml(input: string): string {
  const parsed = new XMLParser(PARSE_OPTS).parse(input);
  const builder = new XMLBuilder({ ...PARSE_OPTS, format: false });
  return builder.build(parsed).trim();
}

export function xmlToJson(input: string, indent = 2): string {
  const parsed = new XMLParser(PARSE_OPTS).parse(input);
  return JSON.stringify(parsed, null, indent);
}

export function jsonToXml(input: string, indent = 2): string {
  const obj = JSON.parse(input);
  const builder = new XMLBuilder({ ...PARSE_OPTS, format: true, indentBy: " ".repeat(indent) });
  return builder.build(obj).trimEnd();
}
