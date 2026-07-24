/** Substitute {{VAR}} placeholders using a variable map. Unknown vars are left intact. */
export function interpolate(input: string, vars: Record<string, string>): string {
  return input.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : match,
  );
}

/** List the variable names referenced by a string. */
export function usedVariables(input: string): string[] {
  const names = new Set<string>();
  for (const m of input.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)) names.add(m[1]);
  return [...names];
}

/** True if the string still contains unresolved {{VAR}} placeholders. */
export function hasUnresolved(input: string, vars: Record<string, string>): boolean {
  return usedVariables(input).some((n) => !Object.prototype.hasOwnProperty.call(vars, n));
}
