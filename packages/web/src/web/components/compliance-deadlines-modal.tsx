import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatDate, cn } from "@/lib/utils";
import { ShieldCheck, Loader2, CheckCircle2, AlertTriangle, Info, RefreshCw } from "lucide-react";

interface ComplianceItem {
  name: string;
  type: string;
  deadline: string;
  notes: string;
  selfOrLevelFunded?: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  clientId: string;
  clientName: string;
  renewalDate?: string;
  fundingStrategy?: string;
  companySize?: string;
  onCreated: () => void;
}

const TYPE_COLORS: Record<string, string> = {
  IRS:   "bg-purple-50 text-purple-700 border-purple-200",
  ERISA: "bg-indigo-50 text-indigo-700 border-indigo-200",
  CMS:   "bg-cyan-50 text-cyan-700 border-cyan-200",
};

function nextRenewalDate(str: string): Date {
  const d = new Date(str);
  const today = new Date();
  while (d <= today) d.setFullYear(d.getFullYear() + 1);
  return d;
}
function addDays(d: Date, n: number): Date { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function addMonths(d: Date, n: number): Date { const r = new Date(d); r.setMonth(r.getMonth() + n); return r; }
function iso(d: Date): string { return d.toISOString().split("T")[0]; }

function buildPreview(renewalDate: string, fundingStrategy: string, companySize: string): (ComplianceItem & { excluded?: string })[] {
  const renewal = nextRenewalDate(renewalDate);
  const pyEnd = addDays(renewal, -1);
  const isSelfOrLevel = ["Self Funded", "Level Funded"].includes(fundingStrategy);
  const smallPlan = ["1-49", "50-99"].includes(companySize);
  const nonALE = companySize === "1-49";
  const acaYear = pyEnd.getFullYear() + 1;
  const f5500 = addMonths(pyEnd, 7);

  const items: (ComplianceItem & { excluded?: string })[] = [
    {
      name: "Wrap Document / SPD Review", type: "ERISA",
      deadline: iso(addDays(renewal, -60)), notes: "60 days before plan year start",
    },
    {
      name: "SBC Distribution", type: "ERISA",
      deadline: iso(addDays(renewal, -60)), notes: "60 days before plan year start",
    },
    {
      name: "CMS Medicare Part D — Creditable Coverage Notice", type: "CMS",
      deadline: iso(addDays(renewal, -60)), notes: "60 days before plan year start",
    },
    {
      name: "CHIP Notice", type: "ERISA",
      deadline: iso(addDays(renewal, -45)), notes: "With open enrollment materials",
    },
    {
      name: "HIPAA Annual Privacy Notice", type: "ERISA",
      deadline: iso(addDays(renewal, -30)), notes: "30 days before plan year start",
    },
    {
      name: "CMS Medicare Part D — Annual Disclosure to CMS", type: "CMS",
      deadline: iso(addDays(renewal, 60)), notes: "Within 60 days after plan year start",
    },
    {
      name: "Form 5500 Filing", type: "ERISA",
      deadline: iso(f5500), notes: "7 months after plan year end",
      ...(smallPlan ? { excluded: `Not required — small plan exemption (${companySize} employees)` } : {}),
    },
    {
      name: "Form 5500 Extended Deadline", type: "ERISA",
      deadline: iso(addMonths(addDays(f5500, 15), 2)), notes: "2.5-month automatic extension",
      ...(smallPlan ? { excluded: `Not required — small plan exemption (${companySize} employees)` } : {}),
    },
    {
      name: "Summary Annual Report (SAR)", type: "ERISA",
      deadline: iso(addMonths(pyEnd, 9)), notes: "9 months after plan year end",
      ...(smallPlan ? { excluded: `Not required — small plan exemption (${companySize} employees)` } : {}),
    },
    {
      name: "ACA 1095-C Distribution to Employees", type: "IRS",
      deadline: iso(new Date(acaYear, 2, 1)), notes: `March 1, ${acaYear}`,
      ...(nonALE ? { excluded: "Not required — applies to ALEs (50+ FTEs) only" } : {}),
      ...(companySize === "50-99" ? { notes: `March 1, ${acaYear} — verify ALE status` } : {}),
    },
    {
      name: "ACA 1094-C Electronic Filing", type: "IRS",
      deadline: iso(new Date(acaYear, 2, 31)), notes: `March 31, ${acaYear}`,
      ...(nonALE ? { excluded: "Not required — applies to ALEs (50+ FTEs) only" } : {}),
    },
    {
      name: "RxDC Reporting", type: "CMS",
      deadline: iso(new Date(pyEnd.getFullYear() + 1, 5, 1)), notes: `June 1, ${pyEnd.getFullYear() + 1}`,
    },
    ...(isSelfOrLevel ? [{
      name: "PCORI Fee Filing (Form 720)", type: "IRS" as const,
      deadline: iso(new Date(pyEnd.getFullYear() + 1, 6, 31)),
      notes: `July 31 — ${fundingStrategy} plans only`,
      selfOrLevelFunded: true,
    }] : []),
  ];

  return items.sort((a, b) => a.deadline.localeCompare(b.deadline));
}

export function ComplianceDeadlinesModal({
  open, onClose, clientId, clientName, renewalDate, fundingStrategy, companySize, onCreated,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [count, setCount] = useState(0);
  const [existingCount, setExistingCount] = useState(0);
  const [showOverridePrompt, setShowOverridePrompt] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const preview = useMemo(() => {
    if (!renewalDate) return [];
    return buildPreview(renewalDate, fundingStrategy || "Fully Insured", companySize || "");
  }, [renewalDate, fundingStrategy, companySize]);

  const includedCount = preview.filter((i) => !i.excluded).length;
  const excludedCount = preview.filter((i) => i.excluded).length;
  const isSelfOrLevel = ["Self Funded", "Level Funded"].includes(fundingStrategy || "");
  const smallPlan = ["1-49", "50-99"].includes(companySize || "");
  const nonALE = companySize === "1-49";
  const nextRenewal = renewalDate ? nextRenewalDate(renewalDate) : null;

  const doGenerate = async (overwrite: boolean) => {
    setLoading(true);
    setShowOverridePrompt(false);
    try {
      const res = await fetch("/api/generate-compliance-deadlines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, renewalDate, fundingStrategy, companySize, overwrite }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (data.requiresConfirm) {
        setExistingCount(data.existingCount);
        setShowOverridePrompt(true);
        return;
      }
      setCount(data.created);
      setDone(true);
      onCreated();
    } catch (e: any) {
      alert("Error: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setDone(false);
    setCount(0);
    setShowOverridePrompt(false);
    setExistingCount(0);
    setExpandedIdx(null);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-lg max-h-[88vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-violet-500" />
            Generate Compliance Deadlines
          </DialogTitle>
        </DialogHeader>

        {done ? (
          <div className="py-10 text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
            <p className="text-lg font-semibold text-slate-800">Compliance Deadlines Created!</p>
            <p className="text-slate-500 text-sm mt-1">{count} deadlines added for {clientName}</p>
          </div>
        ) : showOverridePrompt ? (
          <div className="py-4 space-y-4">
            <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3.5">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-800">Existing compliance deadlines found</p>
                <p className="text-sm text-amber-700 mt-0.5">
                  {clientName} already has <strong>{existingCount} compliance deliverable{existingCount !== 1 ? "s" : ""}</strong>.
                  Overwriting will delete them and create a fresh filtered set.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={handleClose}>Cancel</Button>
              <Button
                variant="outline"
                className="flex-1 border-amber-300 text-amber-700 hover:bg-amber-50"
                onClick={() => doGenerate(true)}
                disabled={loading}
              >
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Overwrite
              </Button>
            </div>
          </div>
        ) : !renewalDate ? (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-700 flex gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            No renewal date set for this client. Please edit the client first.
          </div>
        ) : (
          <>
            {/* Client context */}
            <div className="text-sm text-slate-500 -mt-1 flex flex-wrap gap-x-3 gap-y-1">
              <span>Client: <strong className="text-slate-700">{clientName}</strong></span>
              <span>Next renewal: <strong className="text-sky-600">{formatDate(nextRenewal!.toISOString().split("T")[0])}</strong></span>
              <span>Funding: <strong className={cn("font-medium", isSelfOrLevel ? "text-violet-600" : "text-slate-700")}>{fundingStrategy || "Fully Insured"}</strong></span>
              {companySize && <span>Size: <strong className="text-slate-700">{companySize}</strong></span>}
            </div>

            {/* Applied filter notices */}
            <div className="space-y-1.5">
              {isSelfOrLevel && (
                <div className="flex items-center gap-2 bg-violet-50 border border-violet-200 rounded-lg px-3 py-2 text-xs text-violet-700">
                  <Info className="w-3.5 h-3.5 shrink-0" />
                  PCORI fee filing included — applies to {fundingStrategy} plans.
                </div>
              )}
              {smallPlan && (
                <div className="flex items-center gap-2 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2 text-xs text-sky-700">
                  <Info className="w-3.5 h-3.5 shrink-0" />
                  Form 5500, SAR &amp; extension excluded — small plan exemption ({companySize} employees).
                </div>
              )}
              {nonALE && (
                <div className="flex items-center gap-2 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2 text-xs text-sky-700">
                  <Info className="w-3.5 h-3.5 shrink-0" />
                  ACA 1094/1095-C excluded — not an Applicable Large Employer (under 50 FTEs).
                </div>
              )}
            </div>

            {/* Preview list */}
            <div className="flex-1 overflow-y-auto border border-slate-100 rounded-xl divide-y divide-slate-50 min-h-0">
              {preview.map((item, i) => (
                <div key={i} className={cn(item.excluded && "opacity-40")}>
                  <button
                    onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <p className={cn("text-sm font-medium truncate", item.excluded ? "text-slate-400 line-through" : "text-slate-800")}>
                        {item.name}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {item.excluded ? item.excluded : formatDate(item.deadline)}
                      </p>
                    </div>
                    <span className={cn(
                      "text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0",
                      item.excluded ? "bg-slate-100 text-slate-400 border-slate-200" : (TYPE_COLORS[item.type] || "bg-slate-100 text-slate-500 border-slate-200")
                    )}>
                      {item.type}
                    </span>
                  </button>
                  {expandedIdx === i && !item.excluded && (
                    <div className="px-4 pb-3 bg-slate-50/60">
                      <p className="text-xs text-slate-600 leading-relaxed">{item.notes}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <p className="text-xs text-slate-400 text-center">
              <span className="text-slate-600 font-medium">{includedCount}</span> will be created
              {excludedCount > 0 && <> · <span className="text-slate-400">{excludedCount} excluded (not applicable)</span></>}
              {" "} · Tap any row for details
            </p>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={() => doGenerate(false)} disabled={loading} className="bg-violet-600 hover:bg-violet-700 text-white">
                {loading
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating…</>
                  : <><ShieldCheck className="w-4 h-4 mr-2" /> Generate {includedCount} Deadlines</>
                }
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
