import { describe, expect, it } from "vitest";
import {
  ADJUSTMENT_GROUPS,
  claimBalance,
  claims,
  element,
  hierarchy,
  parseX12,
  readSeparators,
  remittance,
  SAMPLE_835,
  SAMPLE_837,
  segmentName,
  transactionSets,
  validateEnvelope,
  X12Error,
} from "./x12";

describe("readSeparators", () => {
  it("takes all four delimiters out of the ISA positionally", () => {
    const sep = readSeparators(SAMPLE_837);
    expect(sep).toEqual({ element: "*", component: ":", segment: "~", repetition: "^" });
  });

  it("reads whatever delimiters the file chose, not the common ones", () => {
    // Same ISA with | as the element separator, > as component and \n as terminator.
    const isa = SAMPLE_837.slice(0, 106).replace(/\*/g, "|").replace(/:~$/, ">\n");
    const sep = readSeparators(isa);
    expect(sep.element).toBe("|");
    expect(sep.component).toBe(">");
    expect(sep.segment).toBe("\n");
  });

  it("explains a short ISA rather than parsing it wrongly", () => {
    expect(() => readSeparators("ISA*00*x~")).toThrow(X12Error);
    expect(() => readSeparators("ISA*00*x~")).toThrow(/shorter than 106 characters/);
  });

  it("says so when there is no ISA at all", () => {
    expect(() => readSeparators("ST*837*0001~")).toThrow(/No ISA segment/);
  });
});

describe("parseX12", () => {
  const doc = parseX12(SAMPLE_837);

  it("splits into segments, numbering them for error reports", () => {
    expect(doc.segments[0].id).toBe("ISA");
    expect(doc.segments[0].position).toBe(1);
    expect(doc.segments.at(-1)!.id).toBe("IEA");
  });

  it("indexes elements the way X12 numbers them", () => {
    const clm = doc.segments.find((s) => s.id === "CLM")!;
    expect(element(clm, 1)).toBe("CLAIM001");
    expect(element(clm, 2)).toBe("250");
    expect(element(clm, 99)).toBe("");
  });

  it("ignores the line breaks a file may or may not have between segments", () => {
    const wrapped = SAMPLE_837.split("~").join("~\n");
    expect(parseX12(wrapped).segments.length).toBe(doc.segments.length);
  });

  it("ignores anything before the ISA, since files pick up BOMs and headers", () => {
    expect(parseX12(`﻿\n${SAMPLE_837}`).segments[0].id).toBe("ISA");
  });
});

describe("transactionSets", () => {
  it("groups ST through SE and names the transaction", () => {
    const [set] = transactionSets(parseX12(SAMPLE_837));
    expect(set.type).toBe("837");
    expect(set.control).toBe("0001");
    expect(set.version).toBe("005010X222A1");
    expect(set.label).toMatch(/claim/i);
    expect(set.segments[0].id).toBe("ST");
    expect(set.segments.at(-1)!.id).toBe("SE");
  });

  it("names an 835 as a remittance", () => {
    expect(transactionSets(parseX12(SAMPLE_835))[0].label).toMatch(/remittance/i);
  });

  it("keeps an unterminated set so the validator can report it", () => {
    const broken = SAMPLE_837.replace("SE*15*0001~", "");
    const sets = transactionSets(parseX12(broken));
    expect(sets).toHaveLength(1);
    expect(sets[0].segments.some((s) => s.id === "SE")).toBe(false);
  });
});

describe("validateEnvelope", () => {
  const validate = (text: string) => validateEnvelope(parseX12(text));

  it("passes a well-formed interchange", () => {
    expect(validate(SAMPLE_837).filter((i) => i.level === "error")).toEqual([]);
    expect(validate(SAMPLE_835).filter((i) => i.level === "error")).toEqual([]);
  });

  it("catches the interchange control number not matching", () => {
    const bad = SAMPLE_837.replace("IEA*1*000000001~", "IEA*1*000000009~");
    expect(validate(bad).some((i) => /ISA13 is 000000001 but IEA02 is 000000009/.test(i.message))).toBe(true);
  });

  it("catches a wrong segment count, and says the count is inclusive", () => {
    const bad = SAMPLE_837.replace("SE*15*0001~", "SE*14*0001~");
    const issue = validate(bad).find((i) => /SE01 says 14/.test(i.message));
    expect(issue).toBeTruthy();
    expect(issue!.message).toMatch(/ST to SE inclusive/);
  });

  it("catches the transaction control number not matching", () => {
    const bad = SAMPLE_837.replace("SE*15*0001~", "SE*15*0002~");
    expect(validate(bad).some((i) => /ST02 is 0001 but SE02 is 0002/.test(i.message))).toBe(true);
  });

  it("catches the group control number not matching", () => {
    const bad = SAMPLE_837.replace("GE*1*1~", "GE*1*2~");
    expect(validate(bad).some((i) => /GS06 is 1 but GE02 is 2/.test(i.message))).toBe(true);
  });

  it("catches a group and transaction that disagree about what this file is", () => {
    // GS01 HP carries an 835, not an 837.
    const bad = SAMPLE_837.replace("GS*HC*", "GS*HP*");
    expect(validate(bad).some((i) => /envelope and the content disagree/.test(i.message))).toBe(true);
  });

  it("catches a miscounted transaction set", () => {
    const bad = SAMPLE_837.replace("GE*1*1~", "GE*2*1~");
    expect(validate(bad).some((i) => /GE01 says 2 transaction set/.test(i.message))).toBe(true);
  });

  it("warns when test data is marked production", () => {
    const bad = SAMPLE_837.replace("*0*P*:~", "*0*X*:~");
    expect(validate(bad).some((i) => i.level === "warn" && /P \(production\) or T \(test\)/.test(i.message))).toBe(true);
  });

  it("reports an unclosed interchange", () => {
    const bad = SAMPLE_837.replace("IEA*1*000000001~", "");
    expect(validate(bad).some((i) => /not closed/.test(i.message))).toBe(true);
  });
});

describe("hierarchy", () => {
  const doc = parseX12(SAMPLE_837);

  it("builds the billing provider → subscriber tree", () => {
    const { roots, issues } = hierarchy(doc.segments);
    expect(roots).toHaveLength(1);
    expect(roots[0].code).toBe("20");
    expect(roots[0].label).toMatch(/Information source/);
    expect(roots[0].children).toHaveLength(1);
    expect(roots[0].children[0].code).toBe("22");
    expect(issues).toEqual([]);
  });

  it("reports an orphan rather than silently dropping it", () => {
    const bad = parseX12(SAMPLE_837.replace("HL*2*1*22*0~", "HL*2*9*22*0~"));
    const { issues, roots } = hierarchy(bad.segments);
    expect(issues.some((i) => /names parent 9, which does not exist/.test(i.message))).toBe(true);
    expect(roots).toHaveLength(2);
  });

  it("reports HL04 disagreeing with the tree in both directions", () => {
    const noChildren = parseX12(SAMPLE_837.replace("HL*1**20*1~", "HL*1**20*0~"));
    expect(hierarchy(noChildren.segments).issues.some((i) => /HL04=0 \(no children\)/.test(i.message))).toBe(true);

    const claimsChildren = parseX12(SAMPLE_837.replace("HL*2*1*22*0~", "HL*2*1*22*1~"));
    expect(hierarchy(claimsChildren.segments).issues.some((i) => /HL04=1/.test(i.message))).toBe(true);
  });

  it("reports duplicate level ids, since children attach to the first", () => {
    const bad = parseX12(SAMPLE_837.replace("HL*2*1*22*0~", "HL*1*1*22*0~"));
    expect(hierarchy(bad.segments).issues.some((i) => /share the id 1/.test(i.message))).toBe(true);
  });
});

describe("claims", () => {
  const doc = parseX12(SAMPLE_837);
  const [claim] = claims(doc.segments, doc.separators);

  it("reads the claim, its diagnoses and its service lines", () => {
    expect(claim.id).toBe("CLAIM001");
    expect(claim.charge).toBe(250);
    expect(claim.facility).toBe("11");
    expect(claim.diagnoses).toEqual(["E119 (ABK)"]);
    expect(claim.lines.map((l) => l.procedure)).toEqual(["99213", "80053"]);
    expect(claim.lines.map((l) => l.charge)).toEqual([150, 100]);
  });

  it("says nothing when the lines add up", () => {
    expect(claimBalance(claim)).toBeNull();
  });

  it("reports a claim whose lines do not add up to CLM02", () => {
    const bad = parseX12(SAMPLE_837.replace("CLM*CLAIM001*250*", "CLM*CLAIM001*300*"));
    const issue = claimBalance(claims(bad.segments, bad.separators)[0]);
    expect(issue?.level).toBe("error");
    expect(issue?.message).toMatch(/300\.00 in CLM02 but its service lines add up to 250\.00/);
    expect(issue?.message).toMatch(/reject the claim, not the line/);
  });

  it("compares money in cents rather than trusting floats", () => {
    const doc2 = parseX12(SAMPLE_837.replace("CLM*CLAIM001*250*", "CLM*CLAIM001*0.30*").replace("*150*UN", "*0.10*UN").replace("*100*UN", "*0.20*UN"));
    expect(claimBalance(claims(doc2.segments, doc2.separators)[0])).toBeNull();
  });
});

describe("remittance", () => {
  const doc = parseX12(SAMPLE_835);
  const result = remittance(doc.segments, doc.separators);

  it("reads the payment, the parties and the trace number", () => {
    expect(result.totalPaid).toBe(182.5);
    expect(result.method).toBe("ACH");
    expect(result.payer).toBe("BIG PAYER");
    expect(result.payee).toBe("CITY CLINIC");
    expect(result.trace).toBe("12345");
  });

  it("reads each claim payment and what the patient owes", () => {
    expect(result.claims).toHaveLength(1);
    const [claim] = result.claims;
    expect(claim.id).toBe("CLAIM001");
    expect(claim.statusLabel).toBe("processed as primary");
    expect(claim.charged).toBe(250);
    expect(claim.paid).toBe(200);
    expect(claim.patientResponsibility).toBe(50);
    expect(claim.payerControl).toBe("PAYERCTRL9");
  });

  it("reads the adjustment group, which decides who owes the money", () => {
    const [adjustment] = result.claims[0].adjustments;
    expect(adjustment.group).toBe("PR");
    expect(adjustment.amount).toBe(50);
    expect(adjustment.groupLabel).toMatch(/bill the patient/);
    expect(ADJUSTMENT_GROUPS.CO).toMatch(/Never bill the patient/);
  });

  it("reads PLB, which is why the cheque does not match the claims", () => {
    expect(result.providerAdjustments).toEqual([{ reason: "WO", amount: 17.5 }]);
  });

  it("reconciles the cheque against the claims plus PLB", () => {
    expect(result.issues.filter((i) => i.level === "error")).toEqual([]);
  });

  it("reports the shortfall when nothing explains it", () => {
    const bad = parseX12(SAMPLE_835.replace("PLB*1234567893*20261231*WO:REF123*17.5~", ""));
    const issue = remittance(bad.segments, bad.separators).issues.find((i) => /BPR02/.test(i.message));
    expect(issue?.level).toBe("error");
    expect(issue?.message).toMatch(/no PLB adjustments to explain/);
  });

  it("reports a claim where paid plus adjustments does not equal charged", () => {
    const bad = parseX12(SAMPLE_835.replace("CAS*PR*1*50~", "CAS*PR*1*10~"));
    expect(remittance(bad.segments, bad.separators).issues.some((i) => /does not balance/.test(i.message))).toBe(true);
  });

  it("notices a remittance with no payer named", () => {
    const bad = parseX12(SAMPLE_835.replace("N1*PR*BIG PAYER~", ""));
    expect(remittance(bad.segments, bad.separators).issues.some((i) => /does not name a payer/.test(i.message))).toBe(true);
  });
});

describe("segmentName", () => {
  it("names the segments that matter, and shrugs at the rest", () => {
    expect(segmentName("CLP")).toMatch(/Claim payment/);
    expect(segmentName("PLB")).toMatch(/Provider level/);
    expect(segmentName("ZZZ")).toBe("Segment");
  });
});
