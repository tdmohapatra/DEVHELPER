/**
 * Synthetic test-data generator. All data is fake and clearly labelled — never real
 * personal information or PHI. Patient records use TEST_PATIENT_* / fake MRNs.
 */

export type EntityKind = "user" | "customer" | "patient" | "order" | "transaction" | "address" | "company";
export type ExportFormat = "json" | "csv" | "sql" | "xml";

export const ENTITIES: { value: EntityKind; label: string; table: string }[] = [
  { value: "user", label: "Users", table: "users" },
  { value: "customer", label: "Customers", table: "customers" },
  { value: "patient", label: "Patients (synthetic)", table: "patients" },
  { value: "order", label: "Orders", table: "orders" },
  { value: "transaction", label: "Transactions", table: "transactions" },
  { value: "address", label: "Addresses", table: "addresses" },
  { value: "company", label: "Companies", table: "companies" },
];

const FIRST = ["John", "Jane", "Alex", "Priya", "Wei", "Maria", "Omar", "Sara", "Liam", "Nina", "Raj", "Tara", "Sam", "Ivy"];
const LAST = ["Doe", "Smith", "Kumar", "Chen", "Garcia", "Khan", "Patel", "Jones", "Nguyen", "Rossi", "Das", "Lee"];
const DOMAINS = ["example.com", "test.dev", "sample.io", "mail.test"];
const STREETS = ["Main St", "Oak Ave", "Pine Rd", "Maple Dr", "Cedar Ln", "Elm Blvd"];
const CITIES = ["Springfield", "Riverton", "Fairview", "Lakewood", "Georgetown", "Madison"];
const STATUSES = ["pending", "paid", "shipped", "cancelled", "refunded"];
const COMPANY_SUFFIX = ["Labs", "Systems", "Technologies", "Solutions", "Works", "Group"];
const CURRENCIES = ["USD", "EUR", "INR", "GBP"];

const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
const int = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const money = (min: number, max: number) => Math.round((Math.random() * (max - min) + min) * 100) / 100;
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(int(1e8, 9e8)));

function phone(): string {
  // Fake, non-dialable pattern.
  return `+1-555-${String(int(100, 999))}-${String(int(1000, 9999))}`;
}
function pastDate(maxDaysAgo: number): string {
  const d = new Date(Date.now() - int(0, maxDaysAgo) * 86400000);
  return d.toISOString().slice(0, 10);
}

function makeRecord(kind: EntityKind, i: number): Record<string, unknown> {
  const first = pick(FIRST);
  const last = pick(LAST);
  const email = `${first.toLowerCase()}.${last.toLowerCase()}${i}@${pick(DOMAINS)}`;
  switch (kind) {
    case "user":
      return { id: i + 1, username: `${first.toLowerCase()}${int(10, 99)}`, email, firstName: first, lastName: last, active: Math.random() > 0.3, createdAt: pastDate(730) };
    case "customer":
      return { id: i + 1, name: `${first} ${last}`, email, phone: phone(), company: `${pick(LAST)} ${pick(COMPANY_SUFFIX)}`, since: pastDate(1500) };
    case "patient":
      // Synthetic only — no real PHI.
      return { patientId: `TEST_PATIENT_${String(i + 1).padStart(4, "0")}`, mrn: `TEST-MRN-${String(int(1000, 9999))}`, dob: pastDate(30000), gender: pick(["M", "F", "U"]), phone: "+1-555-XXX-XXXX" };
    case "order":
      return { orderId: `ORD-${int(10000, 99999)}`, userId: int(1, 500), total: money(5, 999), currency: pick(CURRENCIES), status: pick(STATUSES), placedAt: pastDate(365) };
    case "transaction":
      return { txnId: uuid(), amount: money(1, 5000), currency: pick(CURRENCIES), type: pick(["debit", "credit"]), status: pick(["ok", "failed", "pending"]), at: new Date(Date.now() - int(0, 1e7)).toISOString() };
    case "address":
      return { id: i + 1, line1: `${int(1, 9999)} ${pick(STREETS)}`, city: pick(CITIES), state: pick(["CA", "NY", "TX", "WA", "IL"]), zip: String(int(10000, 99999)), country: "US" };
    case "company":
      return { id: i + 1, name: `${pick(LAST)} ${pick(COMPANY_SUFFIX)}`, domain: `${pick(LAST).toLowerCase()}.${pick(DOMAINS)}`, employees: int(5, 5000), founded: int(1980, 2024) };
  }
}

export function generateRecords(kind: EntityKind, count: number): Record<string, unknown>[] {
  const n = Math.max(1, Math.min(1000, count));
  return Array.from({ length: n }, (_, i) => makeRecord(kind, i));
}

// ---- Exporters -------------------------------------------------------------

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function sqlValue(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  return `'${String(v).replace(/'/g, "''")}'`;
}

export function exportRecords(records: Record<string, unknown>[], format: ExportFormat, table: string): string {
  if (records.length === 0) return "";
  const cols = Object.keys(records[0]);

  switch (format) {
    case "json":
      return JSON.stringify(records, null, 2);
    case "csv":
      return [cols.join(","), ...records.map((r) => cols.map((c) => csvEscape(r[c])).join(","))].join("\n");
    case "sql":
      return records
        .map((r) => `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((c) => sqlValue(r[c])).join(", ")});`)
        .join("\n");
    case "xml":
      return [
        "<records>",
        ...records.map(
          (r) => "  <record>\n" + cols.map((c) => `    <${c}>${escapeXml(r[c])}</${c}>`).join("\n") + "\n  </record>",
        ),
        "</records>",
      ].join("\n");
  }
}

function escapeXml(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
