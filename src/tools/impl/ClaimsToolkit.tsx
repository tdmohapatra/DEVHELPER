import { useMemo, useState } from "react";
import { AlertTriangle, Banknote, FileStack, Info, Layers, ListTree } from "lucide-react";
import { ToolShell } from "@/components/ToolShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { CopyButton } from "@/components/CopyButton";
import { cn } from "@/lib/utils";
import {
  ADJUSTMENT_GROUPS,
  claimBalance,
  claims,
  hierarchy,
  parseX12,
  remittance,
  SAMPLE_835,
  SAMPLE_837,
  segmentName,
  transactionSets,
  validateEnvelope,
  type HlNode,
  type X12Issue,
} from "@/tools/lib/x12";

type Tab = "segments" | "claim" | "remit";

const TABS: { id: Tab; label: string; icon: typeof Layers }[] = [
  { id: "segments", label: "Envelope", icon: Layers },
  { id: "claim", label: "Claim (837)", icon: ListTree },
  { id: "remit", label: "Remittance (835)", icon: Banknote },
];

const money = (n: number) => n.toFixed(2);

export function ClaimsToolkit() {
  const [text, setText] = useState(SAMPLE_837);
  const [tab, setTab] = useState<Tab>("segments");

  const parsed = useMemo(() => {
    try {
      const doc = parseX12(text);
      return { doc, error: "" };
    } catch (e) {
      return { doc: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [text]);

  const doc = parsed.doc;
  const sets = useMemo(() => (doc ? transactionSets(doc) : []), [doc]);
  const envelopeIssues = useMemo(() => (doc ? validateEnvelope(doc) : []), [doc]);
  const tree = useMemo(() => (doc ? hierarchy(doc.segments) : { roots: [], issues: [] }), [doc]);
  const claimList = useMemo(() => (doc ? claims(doc.segments, doc.separators) : []), [doc]);
  const remit = useMemo(() => (doc ? remittance(doc.segments, doc.separators) : null), [doc]);

  const balanceIssues = claimList.map(claimBalance).filter((i): i is X12Issue => !!i);
  const allIssues = [...envelopeIssues, ...tree.issues, ...balanceIssues, ...(tab === "remit" && remit ? remit.issues : [])];
  const errors = allIssues.filter((i) => i.level === "error");

  return (
    <ToolShell
      toolId="claims-toolkit"
      title="Claims Toolkit (X12 EDI)"
      description="837 claims, 835 remittances and the envelope rules a clearinghouse checks before it reads anything."
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => { setText(SAMPLE_837); setTab("claim"); }}>
          <FileStack className="size-3.5" /> Sample 837
        </Button>
        <Button size="sm" variant="outline" onClick={() => { setText(SAMPLE_835); setTab("remit"); }}>
          <Banknote className="size-3.5" /> Sample 835
        </Button>
        {doc && (
          <>
            <Badge variant="outline">{doc.segments.length} segments</Badge>
            {sets.map((s) => (
              <Badge key={s.control} variant="secondary" title={s.label}>
                {s.type} {s.version && <span className="ml-1 opacity-70">{s.version}</span>}
              </Badge>
            ))}
            <Badge variant={errors.length ? "destructive" : "success"}>
              {errors.length ? `${errors.length} error(s)` : "envelope ok"}
            </Badge>
            <span className="mono text-[10px] text-muted-foreground">
              delimiters: element {JSON.stringify(doc.separators.element)} · component {JSON.stringify(doc.separators.component)} · segment{" "}
              {JSON.stringify(doc.separators.segment)}
            </span>
          </>
        )}
        <CopyButton className="ml-auto" value={text} />
      </div>

      <Textarea mono className="h-32" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />

      {parsed.error && (
        <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{parsed.error}</div>
      )}

      {doc && (
        <>
          {allIssues.length > 0 && (
            <div className="mt-3 flex flex-col gap-1 rounded-md border border-warning/40 bg-warning/5 p-2">
              {allIssues.map((issue, i) => (
                <p key={i} className="text-[11px]">
                  {issue.level === "error" ? (
                    <AlertTriangle className="mr-1 inline size-3 text-destructive" />
                  ) : issue.level === "warn" ? (
                    <AlertTriangle className="mr-1 inline size-3 text-warning" />
                  ) : (
                    <Info className="mr-1 inline size-3 text-muted-foreground" />
                  )}
                  {issue.segment && <b>{issue.segment}{issue.position ? ` #${issue.position}` : ""}: </b>}
                  {issue.message}
                </p>
              ))}
            </div>
          )}

          <div className="mt-3 mb-3 flex flex-wrap gap-1 border-b border-border">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 text-sm",
                  tab === t.id ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <t.icon className="size-3.5" /> {t.label}
              </button>
            ))}
          </div>

          {tab === "segments" && (
            <div className="max-h-[55vh] overflow-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 border-b border-border bg-card text-left text-muted-foreground">
                  <tr>
                    {["#", "Segment", "Name", "Elements"].map((c) => (
                      <th key={c} className="whitespace-nowrap px-2 py-1 font-medium">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {doc.segments.map((segment) => (
                    <tr key={segment.position} className="hover:bg-secondary/40">
                      <td className="px-2 py-1 text-muted-foreground">{segment.position}</td>
                      <td className="mono px-2 py-1 font-medium">{segment.id}</td>
                      <td className="px-2 py-1 text-muted-foreground">{segmentName(segment.id)}</td>
                      <td className="mono px-2 py-1">
                        {segment.elements.map((value, i) => (
                          <span key={i} className="mr-2 whitespace-nowrap">
                            <span className="text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                            {value ? `=${value}` : ""}
                          </span>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === "claim" && (
            <div className="flex flex-col gap-3">
              <div className="rounded-md border border-border p-3">
                <p className="mb-2 text-xs font-medium">Hierarchy</p>
                {tree.roots.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No HL segments — this is not an 837, or it is a fragment.</p>
                ) : (
                  <div className="flex flex-col gap-0.5 text-[11px]">{tree.roots.map((node) => <HlRow key={node.id} node={node} depth={0} />)}</div>
                )}
                <p className="mt-2 text-[10px] text-muted-foreground">
                  A claim hangs off whichever level is current, so a wrong parent attaches it to the wrong patient — which
                  validates perfectly and pays the wrong person.
                </p>
              </div>

              {claimList.length === 0 ? (
                <p className="text-sm text-muted-foreground">No CLM segments.</p>
              ) : (
                claimList.map((claim) => (
                  <div key={claim.id} className="rounded-md border border-border">
                    <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
                      <b className="mono">{claim.id}</b>
                      <Badge variant="outline" className="text-[9px]">{money(claim.charge)}</Badge>
                      {claim.facility && <Badge variant="secondary" className="text-[9px]">place {claim.facility}</Badge>}
                      {claim.diagnoses.length > 0 && (
                        <span className="text-muted-foreground">dx {claim.diagnoses.join(", ")}</span>
                      )}
                    </div>
                    <table className="w-full text-xs">
                      <tbody className="divide-y divide-border">
                        {claim.lines.map((line, i) => (
                          <tr key={i}>
                            <td className="mono px-3 py-1">{line.procedure}</td>
                            <td className="px-3 py-1 text-right">{money(line.charge)}</td>
                            <td className="px-3 py-1 text-muted-foreground">{line.units} unit(s)</td>
                          </tr>
                        ))}
                        <tr className="bg-secondary/30">
                          <td className="px-3 py-1 font-medium">Lines total</td>
                          <td className="px-3 py-1 text-right font-medium">
                            {money(claim.lines.reduce((n, l) => n + l.charge, 0))}
                          </td>
                          <td className="px-3 py-1 text-muted-foreground">CLM02 says {money(claim.charge)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === "remit" && remit && (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                <Tile label="Paid (BPR02)" value={money(remit.totalPaid)} />
                <Tile label="Method" value={remit.method || "—"} />
                <Tile label="Payer" value={remit.payer || "—"} />
                <Tile label="Payee" value={remit.payee || "—"} />
                <Tile label="Trace" value={remit.trace || "—"} />
              </div>

              {remit.claims.length === 0 ? (
                <p className="text-sm text-muted-foreground">No CLP segments — this is not an 835.</p>
              ) : (
                <div className="rounded-md border border-border">
                  <table className="w-full text-xs">
                    <thead className="border-b border-border text-left text-muted-foreground">
                      <tr>
                        {["Claim", "Status", "Charged", "Paid", "Patient owes", "Payer control", "Adjustments"].map((c) => (
                          <th key={c} className="whitespace-nowrap px-3 py-1 font-medium">{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {remit.claims.map((claim) => (
                        <tr key={claim.id} className="hover:bg-secondary/40">
                          <td className="mono px-3 py-1">{claim.id}</td>
                          <td className={cn("px-3 py-1", claim.status === "4" && "text-destructive")}>{claim.statusLabel}</td>
                          <td className="px-3 py-1 text-right">{money(claim.charged)}</td>
                          <td className="px-3 py-1 text-right">{money(claim.paid)}</td>
                          <td className="px-3 py-1 text-right">{money(claim.patientResponsibility)}</td>
                          <td className="mono px-3 py-1 text-muted-foreground">{claim.payerControl}</td>
                          <td className="px-3 py-1">
                            {claim.adjustments.map((a, i) => (
                              <span key={i} className="mr-2 whitespace-nowrap" title={a.groupLabel}>
                                <Badge variant={a.group === "PR" ? "warning" : "secondary"} className="text-[9px]">{a.group}</Badge>{" "}
                                {a.reason} {money(a.amount)}
                              </span>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {remit.providerAdjustments.length > 0 && (
                <div className="rounded-md border border-border p-3">
                  <p className="text-xs font-medium">Provider-level adjustments (PLB)</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    These belong to no claim — a takeback from an earlier remittance, interest, a penalty. They are why the
                    cheque never equals the sum of the claims, and why posting staff spend the afternoon looking for the
                    difference.
                  </p>
                  <table className="mt-2 w-full text-xs">
                    <tbody className="divide-y divide-border">
                      {remit.providerAdjustments.map((adjustment, i) => (
                        <tr key={i}>
                          <td className="mono px-1 py-1">{adjustment.reason}</td>
                          <td className="px-1 py-1 text-right">{money(adjustment.amount)}</td>
                        </tr>
                      ))}
                      <tr className="bg-secondary/30">
                        <td className="px-1 py-1 font-medium">Claims paid − PLB</td>
                        <td className="px-1 py-1 text-right font-medium">
                          {money(remit.claims.reduce((n, c) => n + c.paid, 0) - remit.providerAdjustments.reduce((n, a) => n + a.amount, 0))}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}

              <div className="rounded-md border border-border p-3 text-[11px]">
                <p className="font-medium">Adjustment group codes</p>
                <p className="mt-1 text-muted-foreground">
                  The group decides who owes the money, which is the most consequential thing in an 835. The reason codes
                  themselves (CARC/RARC) are maintained by WPC and are not reproduced here.
                </p>
                <ul className="mt-2 flex flex-col gap-0.5">
                  {Object.entries(ADJUSTMENT_GROUPS).map(([code, label]) => (
                    <li key={code}>
                      <b className="mono">{code}</b> — {label}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </>
      )}
    </ToolShell>
  );
}

function HlRow({ node, depth }: { node: HlNode; depth: number }) {
  return (
    <>
      <div style={{ paddingLeft: depth * 16 }} className="flex items-center gap-2">
        <span className="mono text-muted-foreground">HL{node.id}</span>
        <Badge variant="outline" className="text-[9px]">{node.code}</Badge>
        <span>{node.label}</span>
        <span className="text-[10px] text-muted-foreground">#{node.position}</span>
      </div>
      {node.children.map((child) => (
        <HlRow key={child.id} node={child} depth={depth + 1} />
      ))}
    </>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="truncate text-sm font-medium" title={value}>{value}</div>
    </div>
  );
}
