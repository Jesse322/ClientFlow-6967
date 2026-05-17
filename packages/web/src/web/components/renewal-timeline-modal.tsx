import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CalendarDays, CheckCircle2, Loader2, Sparkles, AlertTriangle, RefreshCw } from "lucide-react";
import { formatDate } from "@/lib/utils";

const PREVIEW_ITEMS = [
  { label: "Pre-Renewal Meeting",                        offset: -140, phase: "Pre-Renewal",    responsibility: "USI / Client" },
  { label: "Request Employee Census",                    offset: -120, phase: "Pre-Renewal",    responsibility: "USI" },
  { label: "Receive Employee Census",                    offset: -106, phase: "Pre-Renewal",    responsibility: "USI / Client" },
  { label: "Carrier Renewals Due",                       offset: -92,  phase: "Marketing",      responsibility: "Carriers" },
  { label: "Request for Proposal Sent to Market",        offset: -92,  phase: "Marketing",      responsibility: "USI" },
  { label: "Proposals Received from Market",             offset: -78,  phase: "Marketing",      responsibility: "USI" },
  { label: "Renewal / Analysis Meeting",                 offset: -64,  phase: "Marketing",      responsibility: "USI / Client" },
  { label: "Carrier / Benefit Decisions Due",            offset: -57,  phase: "Implementation", responsibility: "Client" },
  { label: "Enrollment Material",                        offset: -43,  phase: "Implementation", responsibility: "USI" },
  { label: "Employee Meetings",                          offset: -43,  phase: "Implementation", responsibility: "USI" },
  { label: "Open Enrollment Paperwork Complete",         offset: -29,  phase: "Implementation", responsibility: "USI / Client" },
  { label: "Enrollment Complete",                        offset: -22,  phase: "Implementation", responsibility: "USI" },
  { label: "Post-Renewal Meeting",                       offset: +47,  phase: "Post-Renewal",   responsibility: "USI / Client" },
  { label: "Population Health Management Strategy",      offset: +47,  phase: "Post-Renewal",   responsibility: "USI" },
  { label: "Creditable Coverage Reminder",               offset: +47,  phase: "Post-Renewal",   responsibility: "USI / Client" },
  { label: "Creditable Coverage Notification to CMS",    offset: +59,  phase: "Post-Renewal",   responsibility: "Client" },
];

const PHASE_COLORS: Record<string, string> = {
  "Pre-Renewal":    "bg-blue-100 text-blue-700",
  "Marketing":      "bg-cyan-100 text-cyan-700",
  "Implementation": "bg-teal-100 text-teal-700",
  "Post-Renewal":   "bg-emerald-100 text-emerald-700",
};

function nextRenewalDate(renewalDateStr: string): Date {
  const d = new Date(renewalDateStr);
  const today = new Date();
  while (d <= today) d.setFullYear(d.getFullYear() + 1);
  return d;
}
function offsetDate(renewal: string, days: number): string {
  const d = nextRenewalDate(renewal);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

interface Props {
  open: boolean;
  onClose: () => void;
  clientId: string;
  clientName: string;
  renewalDate?: string;
  onCreated: () => void;
}

export function RenewalTimelineModal({ open, onClose, clientId, clientName, renewalDate, onCreated }: Props) {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [count, setCount] = useState(0);
  const [existingCount, setExistingCount] = useState(0);
  const [showOverridePrompt, setShowOverridePrompt] = useState(false);

  const doGenerate = async (overwrite: boolean) => {
    setLoading(true);
    setShowOverridePrompt(false);
    try {
      const res = await fetch("/api/generate-renewal-timeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, renewalDate, overwrite }),
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
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-sky-500" />
            Generate Renewal Timeline
          </DialogTitle>
        </DialogHeader>

        {done ? (
          <div className="py-8 text-center">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
            <p className="text-lg font-semibold text-slate-800">Timeline Created!</p>
            <p className="text-slate-500 text-sm mt-1">{count} deliverables added for {clientName}</p>
          </div>
        ) : showOverridePrompt ? (
          <div className="py-4 space-y-4">
            <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3.5">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-800">Existing timeline found</p>
                <p className="text-sm text-amber-700 mt-0.5">
                  {clientName} already has <strong>{existingCount} renewal timeline deliverable{existingCount !== 1 ? "s" : ""}</strong>. 
                  Overwriting will delete them and create a fresh set.
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
        ) : (
          <>
            {!renewalDate ? (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-700">
                ⚠️ No renewal date set. Please edit the client first.
              </div>
            ) : (
              <>
                <div className="text-sm text-slate-500 -mt-1">
                  Creates <strong className="text-slate-700">{PREVIEW_ITEMS.length} deliverables</strong> for{" "}
                  <strong className="text-slate-700">{clientName}</strong> targeting their upcoming renewal.
                  {renewalDate && (
                    <span className="text-sky-600 font-medium"> Next renewal: {formatDate(nextRenewalDate(renewalDate).toISOString().split("T")[0])}</span>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto border border-slate-100 rounded-lg p-2 max-h-72 space-y-0.5">
                  {PREVIEW_ITEMS.map((item) => (
                    <div key={item.label} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-50">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-700 truncate">{item.label}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {renewalDate && <p className="text-xs text-slate-400">{formatDate(offsetDate(renewalDate, item.offset))}</p>}
                          <p className="text-xs text-slate-300">{item.responsibility}</p>
                        </div>
                      </div>
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 ${PHASE_COLORS[item.phase] || "bg-slate-100 text-slate-500"}`}>
                        {item.phase}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={() => doGenerate(false)} disabled={loading || !renewalDate} className="bg-sky-600 hover:bg-sky-700 text-white">
                {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating…</> : <><CalendarDays className="w-4 h-4 mr-2" /> Generate {PREVIEW_ITEMS.length} Deliverables</>}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
