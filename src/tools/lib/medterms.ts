/**
 * Medical abbreviation lookup — a developer/terminology convenience only.
 * NOT medical advice and NOT for clinical decision-making.
 */

export const ABBREVIATIONS: Record<string, string> = {
  SOB: "Shortness of Breath",
  Hx: "History",
  HTN: "Hypertension",
  CP: "Chest Pain",
  DM: "Diabetes Mellitus",
  Dx: "Diagnosis",
  Tx: "Treatment",
  Rx: "Prescription",
  Fx: "Fracture",
  Sx: "Symptoms",
  BP: "Blood Pressure",
  HR: "Heart Rate",
  RR: "Respiratory Rate",
  BMI: "Body Mass Index",
  CBC: "Complete Blood Count",
  ECG: "Electrocardiogram",
  EKG: "Electrocardiogram",
  MI: "Myocardial Infarction",
  COPD: "Chronic Obstructive Pulmonary Disease",
  CHF: "Congestive Heart Failure",
  CVA: "Cerebrovascular Accident",
  UTI: "Urinary Tract Infection",
  URI: "Upper Respiratory Infection",
  GERD: "Gastroesophageal Reflux Disease",
  CKD: "Chronic Kidney Disease",
  DVT: "Deep Vein Thrombosis",
  PE: "Pulmonary Embolism",
  ICU: "Intensive Care Unit",
  ER: "Emergency Room",
  OR: "Operating Room",
  NPO: "Nothing by Mouth",
  PRN: "As Needed",
  BID: "Twice a Day",
  TID: "Three Times a Day",
  QID: "Four Times a Day",
  PO: "By Mouth",
  IV: "Intravenous",
  IM: "Intramuscular",
  WNL: "Within Normal Limits",
  NAD: "No Acute Distress",
  SOAP: "Subjective, Objective, Assessment, Plan",
  ROS: "Review of Systems",
  PMH: "Past Medical History",
  FHx: "Family History",
  LOC: "Loss of Consciousness",
  N_V: "Nausea and Vomiting",
};

export interface AbbrHit {
  token: string;
  expansion: string;
  index: number;
}

/** Find known abbreviations in text (case-sensitive on the canonical form, whole words). */
export function findAbbreviations(text: string): AbbrHit[] {
  const hits: AbbrHit[] = [];
  const re = /\b[A-Za-z]{1,6}\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const token = m[0];
    const expansion = ABBREVIATIONS[token] ?? ABBREVIATIONS[token.toUpperCase()];
    if (expansion) hits.push({ token, expansion, index: m.index });
  }
  return hits;
}

/** Inline-expand: "Hx of HTN" → "Hx (History) of HTN (Hypertension)". */
export function expandInline(text: string): string {
  const hits = findAbbreviations(text);
  let out = text;
  for (const h of [...hits].reverse()) {
    out = out.slice(0, h.index + h.token.length) + ` (${h.expansion})` + out.slice(h.index + h.token.length);
  }
  return out;
}

export function lookup(abbr: string): string | undefined {
  return ABBREVIATIONS[abbr] ?? ABBREVIATIONS[abbr.toUpperCase()];
}
