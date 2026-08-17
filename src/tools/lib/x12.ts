/**
 * X12 EDI — the format US healthcare claims actually move in.
 *
 * HL7 carries the clinical message; X12 carries the money. An 837 is a claim, an
 * 835 is what the payer paid and why, a 270/271 is an eligibility question and
 * answer. They share one envelope and one set of rules, and almost every
 * rejection is a violation of those rules rather than anything clinical.
 *
 * Two things make X12 unusual to parse, and both are the source of the bugs:
 *
 * **The delimiters are in the data.** There is no fixed comma or pipe. The ISA
 * segment is exactly 106 characters of fixed width, and it is read positionally:
 * the 4th character is the element separator, the 105th is the component
 * separator, and whatever follows the ISA is the segment terminator. A file that
 * "looks fine" but is 105 or 107 characters at the ISA cannot be parsed by a
 * conforming reader at all — and that is the single commonest reason a
 * clearinghouse rejects a file it never got as far as reading.
 *
 * **The envelope counts itself.** ISA13 must equal IEA02, GS06 must equal GE02,
 * ST02 must equal SE02, and SE01 is the number of segments from ST to SE
 * inclusive. Nothing clinical depends on these, and every one of them is checked
 * before the payer looks at a single claim. They are also exactly what a
 * hand-built or hand-edited test file gets wrong.
 *
 * No code list is bundled — CARC and RARC come from WPC and are maintained
 * there. The five claim adjustment *group* codes are here because there are five
 * of them and the difference between CO and PR is money the patient owes versus
 * money nobody owes.
 */

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export interface Separators {
  element: string;
  component: string;
  segment: string;
  repetition: string;
}

export interface X12Segment {
  /** Segment id, e.g. `CLM`. */
  id: string;
  /** Elements, 1-based in X12 terms: `elements[0]` is CLM01. */
  elements: string[];
  /** Position in the file, 1-based — what an error report should cite. */
  position: number;
}

export interface X12Document {
  separators: Separators;
  segments: X12Segment[];
}

export class X12Error extends Error {}

export const DEFAULT_SEPARATORS: Separators = { element: "*", component: ":", segment: "~", repetition: "^" };

/**
 * Read the delimiters out of an ISA.
 *
 * Positional, because that is how the standard defines it — the ISA is the one
 * segment whose layout is fixed width rather than delimited, precisely so a
 * reader can bootstrap the delimiters from it.
 */
export function readSeparators(text: string): Separators {
  const isa = text.indexOf("ISA");
  if (isa === -1) throw new X12Error("No ISA segment. Every X12 interchange starts with one; without it the delimiters cannot be known.");

  const element = text[isa + 3];
  if (!element) throw new X12Error("The ISA is truncated before its first separator.");

  // ISA16 is the component separator and sits at offset 104; the terminator is
  // whatever follows it.
  const component = text[isa + 104];
  const terminator = text[isa + 105];
  if (!component || !terminator) {
    throw new X12Error(
      "The ISA is shorter than 106 characters. It is fixed width — every element is padded to its exact length — and a reader takes the component separator and the segment terminator from fixed offsets, so a short ISA cannot be parsed at all.",
    );
  }

  return {
    element,
    component,
    segment: terminator,
    // ISA11 is the repetition separator in 5010; in 4010 it held a standards id.
    repetition: text.slice(isa, isa + 104).split(element)[11] ?? "^",
  };
}

/** Split a document into segments. */
export function parseX12(text: string): X12Document {
  const separators = readSeparators(text);
  const start = text.indexOf("ISA");
  const body = text.slice(start);

  const segments: X12Segment[] = [];
  let position = 0;
  for (const raw of body.split(separators.segment)) {
    // Line breaks between segments are optional and common; they are not data.
    const trimmed = raw.replace(/[\r\n]/g, "").trim();
    if (!trimmed) continue;
    const parts = trimmed.split(separators.element);
    position++;
    segments.push({ id: parts[0].toUpperCase(), elements: parts.slice(1), position });
  }

  if (segments.length === 0) throw new X12Error("No segments found. Check the segment terminator — it is the character right after the ISA.");
  return { separators, segments };
}

/** One element, 1-based as X12 numbers them: `element(seg, 4)` is CLM04. */
export function element(segment: X12Segment | undefined, index: number): string {
  return segment?.elements[index - 1] ?? "";
}

/** One component of an element, 1-based: `component(seg, 5, 1)` is NM103. */
export function component(segment: X12Segment | undefined, index: number, sub: number, separators: Separators): string {
  return element(segment, index).split(separators.component)[sub - 1] ?? "";
}

// ---------------------------------------------------------------------------
// Transaction sets
// ---------------------------------------------------------------------------

export interface TransactionSet {
  /** ST01 — the transaction set identifier, e.g. `837`. */
  type: string;
  /** ST02 — the control number, which SE02 must repeat. */
  control: string;
  /** ST03 in 5010: the implementation convention, e.g. `005010X222A1`. */
  version: string;
  label: string;
  segments: X12Segment[];
}

const TRANSACTION_LABELS: Record<string, string> = {
  "837": "Health care claim",
  "835": "Health care claim payment / advice (remittance)",
  "270": "Eligibility, coverage or benefit inquiry",
  "271": "Eligibility, coverage or benefit response",
  "276": "Health care claim status request",
  "277": "Health care claim status response",
  "278": "Health care services review (prior authorisation)",
  "834": "Benefit enrolment and maintenance",
  "820": "Payroll deducted and other group premium payment",
  "999": "Implementation acknowledgment",
  "997": "Functional acknowledgment",
};

/** The transaction sets in a document, each ST through its SE. */
export function transactionSets(doc: X12Document): TransactionSet[] {
  const sets: TransactionSet[] = [];
  let current: X12Segment[] | null = null;

  for (const segment of doc.segments) {
    if (segment.id === "ST") {
      current = [segment];
      continue;
    }
    if (!current) continue;
    current.push(segment);
    if (segment.id === "SE") {
      const st = current[0];
      const type = element(st, 1);
      sets.push({
        type,
        control: element(st, 2),
        version: element(st, 3),
        label: TRANSACTION_LABELS[type] ?? "Unknown transaction set",
        segments: current,
      });
      current = null;
    }
  }

  // An ST with no SE is itself the finding; keep it so the validator can say so.
  if (current) {
    const st = current[0];
    sets.push({
      type: element(st, 1),
      control: element(st, 2),
      version: element(st, 3),
      label: TRANSACTION_LABELS[element(st, 1)] ?? "Unknown transaction set",
      segments: current,
    });
  }

  return sets;
}

/**
 * Which transaction sets a functional group is allowed to carry.
 *
 * GS01 and ST01 disagreeing is a rejection at the envelope, before any content
 * is read — and it is easy to do when a file is assembled from templates.
 */
const GS_TO_ST: Record<string, string[]> = {
  HC: ["837"],
  HP: ["835"],
  HS: ["270"],
  HB: ["271"],
  HR: ["276"],
  HN: ["277"],
  HI: ["278"],
  BE: ["834"],
  RA: ["820"],
  FA: ["997", "999"],
};

// ---------------------------------------------------------------------------
// Envelope validation
// ---------------------------------------------------------------------------

export interface X12Issue {
  level: "error" | "warn" | "info";
  segment?: string;
  position?: number;
  message: string;
}

/**
 * The envelope rules, which is what a clearinghouse checks first.
 *
 * Every one of these is arithmetic or equality — no clinical judgement, nothing
 * that needs a code list — and every one of them is a rejection when it fails.
 */
export function validateEnvelope(doc: X12Document): X12Issue[] {
  const issues: X12Issue[] = [];
  const find = (id: string) => doc.segments.filter((s) => s.id === id);

  const isa = find("ISA")[0];
  const iea = find("IEA")[0];
  const gsList = find("GS");
  const geList = find("GE");

  if (!isa) issues.push({ level: "error", message: "No ISA. The interchange has no envelope." });
  if (!iea) issues.push({ level: "error", segment: "IEA", message: "No IEA. The interchange is not closed, and a receiver will wait for more data or reject the file." });

  if (isa && iea) {
    const sent = element(isa, 13);
    const closed = element(iea, 2);
    if (sent !== closed) {
      issues.push({
        level: "error",
        segment: "IEA",
        position: iea.position,
        message: `ISA13 is ${sent} but IEA02 is ${closed}. The interchange control number must match at both ends.`,
      });
    }
    const groupCount = Number(element(iea, 1));
    if (Number.isFinite(groupCount) && groupCount !== gsList.length) {
      issues.push({
        level: "error",
        segment: "IEA",
        position: iea.position,
        message: `IEA01 says ${groupCount} functional group(s); the file contains ${gsList.length}.`,
      });
    }
    if (element(isa, 15) && !["P", "T"].includes(element(isa, 15))) {
      issues.push({ level: "warn", segment: "ISA", message: `ISA15 is "${element(isa, 15)}" — it should be P (production) or T (test). Sending test data marked P is how a test claim gets adjudicated.` });
    }
  }

  gsList.forEach((gs, i) => {
    const ge = geList[i];
    if (!ge) {
      issues.push({ level: "error", segment: "GS", position: gs.position, message: "This functional group has no GE, so it is never closed." });
      return;
    }
    if (element(gs, 6) !== element(ge, 2)) {
      issues.push({
        level: "error",
        segment: "GE",
        position: ge.position,
        message: `GS06 is ${element(gs, 6)} but GE02 is ${element(ge, 2)}. The group control number must match.`,
      });
    }
  });

  const sets = transactionSets(doc);
  const geCount = Number(element(geList[0], 1));
  if (geList.length === 1 && Number.isFinite(geCount) && geCount !== sets.length) {
    issues.push({
      level: "error",
      segment: "GE",
      message: `GE01 says ${geCount} transaction set(s); the group contains ${sets.length}.`,
    });
  }

  const functional = element(gsList[0], 1);
  if (functional && sets.length > 0) {
    const allowed = GS_TO_ST[functional];
    if (allowed && !allowed.includes(sets[0].type)) {
      issues.push({
        level: "error",
        segment: "GS",
        message: `GS01 is "${functional}", which carries ${allowed.join("/")}, but the transaction set is ${sets[0].type}. The envelope and the content disagree.`,
      });
    }
  }

  for (const set of sets) {
    const se = set.segments.find((s) => s.id === "SE");
    if (!se) {
      issues.push({ level: "error", segment: "ST", message: `Transaction set ${set.control} has no SE and is never closed.` });
      continue;
    }
    if (element(se, 2) !== set.control) {
      issues.push({
        level: "error",
        segment: "SE",
        position: se.position,
        message: `ST02 is ${set.control} but SE02 is ${element(se, 2)}. The transaction control number must match.`,
      });
    }
    const declared = Number(element(se, 1));
    // The count is inclusive of both ST and SE, which is the part people get wrong.
    const actual = set.segments.length;
    if (Number.isFinite(declared) && declared !== actual) {
      issues.push({
        level: "error",
        segment: "SE",
        position: se.position,
        message: `SE01 says ${declared} segments; there are ${actual}. The count runs from ST to SE inclusive — off-by-one here is almost always a forgotten ST or SE.`,
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// 837 structure
// ---------------------------------------------------------------------------

export interface HlNode {
  /** HL01 — this level's id. */
  id: string;
  /** HL02 — the parent's id, empty at the top. */
  parent: string;
  /** HL03 — what kind of level this is. */
  code: string;
  label: string;
  /** HL04 — whether child levels follow. */
  hasChildren: boolean;
  position: number;
  children: HlNode[];
}

const HL_LEVELS: Record<string, string> = {
  "20": "Information source (the payer or the billing entity)",
  "21": "Information receiver",
  "22": "Subscriber",
  "23": "Dependent",
  "19": "Provider of service",
};

/**
 * The HL hierarchy of an 837, as a tree.
 *
 * An 837 is not a flat list of claims: billing provider → subscriber →
 * dependent, each an HL segment pointing at its parent by id. A claim hangs off
 * whichever level is current, so getting the tree wrong attaches the claim to
 * the wrong patient — which validates perfectly and pays the wrong person.
 */
export function hierarchy(segments: X12Segment[]): { roots: HlNode[]; issues: X12Issue[] } {
  const nodes = new Map<string, HlNode>();
  const order: HlNode[] = [];
  const issues: X12Issue[] = [];

  for (const segment of segments) {
    if (segment.id !== "HL") continue;
    const node: HlNode = {
      id: element(segment, 1),
      parent: element(segment, 2),
      code: element(segment, 3),
      label: HL_LEVELS[element(segment, 3)] ?? `Level ${element(segment, 3)}`,
      hasChildren: element(segment, 4) === "1",
      position: segment.position,
      children: [],
    };
    if (nodes.has(node.id)) {
      issues.push({ level: "error", segment: "HL", position: segment.position, message: `Two HL segments share the id ${node.id}. Children attach to whichever is found first.` });
    }
    nodes.set(node.id, node);
    order.push(node);
  }

  const roots: HlNode[] = [];
  for (const node of order) {
    if (!node.parent) {
      roots.push(node);
      continue;
    }
    const parent = nodes.get(node.parent);
    if (!parent) {
      issues.push({
        level: "error",
        segment: "HL",
        position: node.position,
        message: `HL ${node.id} names parent ${node.parent}, which does not exist. Everything under it is orphaned.`,
      });
      roots.push(node);
      continue;
    }
    parent.children.push(node);
  }

  for (const node of order) {
    if (node.hasChildren && node.children.length === 0) {
      issues.push({ level: "warn", segment: "HL", position: node.position, message: `HL ${node.id} sets HL04=1 (child levels follow) but nothing names it as a parent.` });
    }
    if (!node.hasChildren && node.children.length > 0) {
      issues.push({ level: "warn", segment: "HL", position: node.position, message: `HL ${node.id} sets HL04=0 (no children) but ${node.children.length} level(s) name it as parent.` });
    }
  }

  return { roots, issues };
}

export interface ClaimSummary {
  /** CLM01 — the submitter's claim id, which every later enquiry uses. */
  id: string;
  /** CLM02 — total charge. */
  charge: number;
  /** Place of service, from CLM05. */
  facility: string;
  diagnoses: string[];
  lines: { procedure: string; charge: number; units: string; position: number }[];
  position: number;
}

/** The claims in an 837, with their service lines. */
export function claims(segments: X12Segment[], separators: Separators): ClaimSummary[] {
  const out: ClaimSummary[] = [];
  let current: ClaimSummary | null = null;

  for (const segment of segments) {
    if (segment.id === "CLM") {
      current = {
        id: element(segment, 1),
        charge: Number(element(segment, 2)) || 0,
        facility: component(segment, 5, 1, separators),
        diagnoses: [],
        lines: [],
        position: segment.position,
      };
      out.push(current);
      continue;
    }
    if (!current) continue;
    if (segment.id === "HI") {
      // Each element is qualifier:code — ABK is the principal diagnosis in 5010.
      for (const raw of segment.elements) {
        const [qualifier, code] = raw.split(separators.component);
        if (code) current.diagnoses.push(`${code}${qualifier ? ` (${qualifier})` : ""}`);
      }
    }
    if (segment.id === "SV1" || segment.id === "SV2") {
      current.lines.push({
        procedure: component(segment, segment.id === "SV1" ? 1 : 2, segment.id === "SV1" ? 2 : 2, separators) || element(segment, 1),
        charge: Number(element(segment, segment.id === "SV1" ? 2 : 3)) || 0,
        units: element(segment, segment.id === "SV1" ? 4 : 5),
        position: segment.position,
      });
    }
  }

  return out;
}

/** Does the claim total match the sum of its lines? A rejection when it does not. */
export function claimBalance(claim: ClaimSummary): X12Issue | null {
  if (claim.lines.length === 0) return null;
  const sum = claim.lines.reduce((n, l) => n + l.charge, 0);
  // Money, so compare in cents rather than trusting float equality.
  if (Math.round(sum * 100) === Math.round(claim.charge * 100)) return null;
  return {
    level: "error",
    segment: "CLM",
    position: claim.position,
    message: `Claim ${claim.id} totals ${claim.charge.toFixed(2)} in CLM02 but its service lines add up to ${sum.toFixed(2)}. The payer will reject the claim, not the line.`,
  };
}

// ---------------------------------------------------------------------------
// 835 remittance
// ---------------------------------------------------------------------------

/**
 * The five claim adjustment group codes.
 *
 * Five rows, and the difference between them is who owes the money — which is
 * the single most consequential thing in an 835. CARC and RARC reason codes are
 * maintained by WPC and are not reproduced here.
 */
export const ADJUSTMENT_GROUPS: Record<string, string> = {
  CO: "Contractual obligation — the provider wrote this off. Never bill the patient for it.",
  PR: "Patient responsibility — deductible, co-insurance or co-pay. This is what you bill the patient.",
  OA: "Other adjustment — usually a coordination-of-benefits amount another payer handles.",
  PI: "Payer initiated reduction — the payer decided this is not payable and not the patient's either.",
  CR: "Correction and reversal — this line adjusts a previously reported payment.",
};

export interface ClaimPayment {
  /** CLP01 — the claim id as submitted, which ties this back to the 837. */
  id: string;
  /** CLP02 — the status the payer assigned. */
  status: string;
  statusLabel: string;
  charged: number;
  paid: number;
  patientResponsibility: number;
  /** CLP07 — the payer's own claim control number, quoted in any appeal. */
  payerControl: string;
  adjustments: { group: string; groupLabel: string; reason: string; amount: number }[];
  position: number;
}

const CLAIM_STATUS: Record<string, string> = {
  "1": "processed as primary",
  "2": "processed as secondary",
  "3": "processed as tertiary",
  "4": "denied",
  "19": "processed as primary, forwarded to another payer",
  "20": "processed as secondary, forwarded",
  "21": "processed as tertiary, forwarded",
  "22": "reversal of a previous payment",
  "23": "not our claim, forwarded",
  "25": "predetermination — pricing only, no payment",
};

export interface Remittance {
  /** BPR02 — the total actually moved. */
  totalPaid: number;
  /** BPR04 — how it moved: CHK, ACH, NON. */
  method: string;
  payer: string;
  payee: string;
  /** TRN02 — the trace number the bank reference matches. */
  trace: string;
  claims: ClaimPayment[];
  /** PLB — adjustments outside any claim, which is why the cheque never matches. */
  providerAdjustments: { reason: string; amount: number }[];
  issues: X12Issue[];
}

/**
 * Read an 835 as a payment posting would.
 *
 * The reconciliation that matters: the sum of what was paid per claim does not
 * equal the cheque, because PLB carries provider-level adjustments — a takeback
 * from a previous remittance, an interest payment, a penalty — that belong to no
 * claim at all. Posting staff chase that difference constantly, and it is
 * arithmetic that can simply be shown.
 */
export function remittance(segments: X12Segment[], separators: Separators): Remittance {
  const issues: X12Issue[] = [];
  const bpr = segments.find((s) => s.id === "BPR");
  const trn = segments.find((s) => s.id === "TRN");

  let payer = "";
  let payee = "";
  let seenPayer = false;
  const claimsOut: ClaimPayment[] = [];
  const providerAdjustments: Remittance["providerAdjustments"] = [];
  let current: ClaimPayment | null = null;

  for (const segment of segments) {
    if (segment.id === "N1") {
      const qualifier = element(segment, 1);
      const name = element(segment, 2);
      // PR is the payer, PE the payee — the same segment id for both.
      if (qualifier === "PR") {
        payer = name;
        seenPayer = true;
      } else if (qualifier === "PE") payee = name;
      continue;
    }

    if (segment.id === "CLP") {
      const status = element(segment, 2);
      current = {
        id: element(segment, 1),
        status,
        statusLabel: CLAIM_STATUS[status] ?? `status ${status}`,
        charged: Number(element(segment, 3)) || 0,
        paid: Number(element(segment, 4)) || 0,
        patientResponsibility: Number(element(segment, 5)) || 0,
        payerControl: element(segment, 7),
        adjustments: [],
        position: segment.position,
      };
      claimsOut.push(current);
      continue;
    }

    if (segment.id === "CAS" && current) {
      const group = element(segment, 1);
      // CAS repeats reason/amount/quantity in threes, up to six times.
      for (let i = 2; i <= 17; i += 3) {
        const reason = element(segment, i);
        const amount = Number(element(segment, i + 1));
        if (!reason || !Number.isFinite(amount) || amount === 0) continue;
        current.adjustments.push({
          group,
          groupLabel: ADJUSTMENT_GROUPS[group] ?? `group ${group}`,
          reason,
          amount,
        });
      }
      continue;
    }

    if (segment.id === "PLB") {
      // PLB repeats reason/amount in pairs from element 3.
      for (let i = 3; i < segment.elements.length; i += 2) {
        const reason = element(segment, i).split(separators.component)[0];
        const amount = Number(element(segment, i + 1));
        if (!reason || !Number.isFinite(amount)) continue;
        providerAdjustments.push({ reason, amount });
      }
    }
  }

  const totalPaid = Number(element(bpr, 2)) || 0;
  const sumClaims = claimsOut.reduce((n, c) => n + c.paid, 0);
  // PLB amounts are signed the other way round: a positive PLB reduces the payment.
  const sumPlb = providerAdjustments.reduce((n, a) => n + a.amount, 0);
  const reconciled = Math.round((sumClaims - sumPlb) * 100) === Math.round(totalPaid * 100);

  if (!reconciled) {
    issues.push({
      level: providerAdjustments.length > 0 ? "warn" : "error",
      segment: "BPR",
      message:
        `BPR02 is ${totalPaid.toFixed(2)}, claims add up to ${sumClaims.toFixed(2)}` +
        (providerAdjustments.length > 0 ? `, and PLB adjustments account for ${sumPlb.toFixed(2)} of the difference — leaving ${(sumClaims - sumPlb - totalPaid).toFixed(2)} unexplained.` : ". There are no PLB adjustments to explain the difference."),
    });
  }

  if (!seenPayer) issues.push({ level: "warn", segment: "N1", message: "No N1*PR — the remittance does not name a payer." });

  for (const claim of claimsOut) {
    const adjusted = claim.adjustments.reduce((n, a) => n + a.amount, 0);
    if (Math.round((claim.paid + adjusted) * 100) !== Math.round(claim.charged * 100)) {
      issues.push({
        level: "warn",
        segment: "CLP",
        position: claim.position,
        message: `Claim ${claim.id}: charged ${claim.charged.toFixed(2)}, paid ${claim.paid.toFixed(2)}, adjustments ${adjusted.toFixed(2)} — which does not balance. Every cent of a charge should be paid or adjusted away.`,
      });
    }
  }

  return { totalPaid, method: element(bpr, 4), payer, payee, trace: element(trn, 2), claims: claimsOut, providerAdjustments, issues };
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

const SEGMENT_NAMES: Record<string, string> = {
  ISA: "Interchange control header",
  GS: "Functional group header",
  ST: "Transaction set header",
  BHT: "Beginning of hierarchical transaction",
  HL: "Hierarchical level",
  NM1: "Individual or organisational name",
  N1: "Party identification",
  N3: "Address",
  N4: "City, state, postal code",
  REF: "Reference identification",
  PER: "Administrative contact",
  PRV: "Provider information",
  SBR: "Subscriber information",
  DMG: "Demographic information",
  CLM: "Claim information",
  DTP: "Date or time period",
  HI: "Health care diagnosis code",
  SV1: "Professional service line",
  SV2: "Institutional service line",
  LX: "Service line number",
  BPR: "Beginning segment for payment order",
  TRN: "Trace number",
  CLP: "Claim payment information",
  CAS: "Claim adjustment",
  SVC: "Service payment information",
  PLB: "Provider level adjustment",
  AMT: "Monetary amount",
  QTY: "Quantity",
  MIA: "Inpatient adjudication information",
  MOA: "Outpatient adjudication information",
  EQ: "Eligibility or benefit inquiry",
  EB: "Eligibility or benefit information",
  SE: "Transaction set trailer",
  GE: "Functional group trailer",
  IEA: "Interchange control trailer",
};

export function segmentName(id: string): string {
  return SEGMENT_NAMES[id] ?? "Segment";
}

/** A sample interchange, so the tool does something before anything is pasted. */
export const SAMPLE_837 = [
  "ISA*00*          *00*          *ZZ*SUBMITTER      *ZZ*RECEIVER       *260817*1030*^*00501*000000001*0*P*:~",
  "GS*HC*SUBMITTER*RECEIVER*20260817*1030*1*X*005010X222A1~",
  "ST*837*0001*005010X222A1~",
  "BHT*0019*00*244579*20260817*1030*CH~",
  "NM1*41*2*LAB SERVICES*****46*SUBMITTER~",
  "HL*1**20*1~",
  "NM1*85*2*CITY CLINIC*****XX*1234567893~",
  "HL*2*1*22*0~",
  "SBR*P*18*******CI~",
  "NM1*IL*1*SHARMA*PRIYA****MI*MEMBER123~",
  "CLM*CLAIM001*250***11:B:1*Y*A*Y*Y~",
  "HI*ABK:E119~",
  "LX*1~",
  "SV1*HC:99213*150*UN*1***1~",
  "LX*2~",
  "SV1*HC:80053*100*UN*1***1~",
  "SE*15*0001~",
  "GE*1*1~",
  "IEA*1*000000001~",
].join("");

export const SAMPLE_835 = [
  "ISA*00*          *00*          *ZZ*PAYER          *ZZ*PROVIDER       *260817*1030*^*00501*000000002*0*P*:~",
  "GS*HP*PAYER*PROVIDER*20260817*1030*1*X*005010X221A1~",
  "ST*835*0001~",
  "BPR*I*182.5*C*ACH*CCP*01*999999999*DA*123456*1512345678**01*888888888*DA*987654*20260817~",
  "TRN*1*12345*1512345678~",
  "N1*PR*BIG PAYER~",
  "N1*PE*CITY CLINIC*XX*1234567893~",
  "LX*1~",
  "CLP*CLAIM001*1*250*200*50*12*PAYERCTRL9*11~",
  "CAS*PR*1*50~",
  "SVC*HC:99213*150*120**1~",
  "SVC*HC:80053*100*80**1~",
  "PLB*1234567893*20261231*WO:REF123*17.5~",
  "SE*12*0001~",
  "GE*1*1~",
  "IEA*1*000000002~",
].join("");
