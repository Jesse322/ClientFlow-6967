import { useState, useRef } from "react";
import * as XLSX from "xlsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Upload, Download, AlertTriangle, CheckCircle2, Loader2, FileSpreadsheet, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ImportWarning {
  sheet: string;
  row: number;
  message: string;
}

interface ImportRow {
  [key: string]: string | number | null | undefined;
}

interface ImportPayload {
  clients: ImportRow[];
  teamMembers: ImportRow[];
  openItems: ImportRow[];
  deliverables: ImportRow[];
}

interface ImportResult {
  imported: { clients: number; teamMembers: number; openItems: number; deliverables: number };
  warnings: ImportWarning[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}

function sheetToRows(wb: XLSX.WorkBook, name: string): ImportRow[] {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json<ImportRow>(ws, { defval: null });
}

function downloadTemplate() {
  const wb = XLSX.utils.book_new();

  // Clients sheet
  const clientData = [
    ["Client Name", "Renewal Date", "Funding Strategy", "Company Size", "Location", "Revenue", "Medical Carrier/TPA", "Ancillary Carrier", "RxDC Complete", "Intake Notes"],
    ["Acme Corp", "2026-01-01", "Self Funded", "100-499", "Chicago, IL", "250000", "BCBS", "Guardian", "No", "Key client, handles 3 subsidiaries"],
    ["Beta Inc", "2026-03-15", "Fully Insured", "50-99", "Austin, TX", "", "UnitedHealth", "", "Yes", ""],
  ];
  const clientWs = XLSX.utils.aoa_to_sheet(clientData);
  clientWs["!cols"] = clientData[0].map((h) => ({ wch: Math.max(h.length + 2, 16) }));
  XLSX.utils.book_append_sheet(wb, clientWs, "Clients");

  // Team Members sheet
  const teamData = [
    ["Full Name", "Role", "Phone", "Email"],
    ["Jane Smith", "Account Manager", "312-555-1234", "jane@opco.com"],
    ["Bob Johnson", "Service Lead", "312-555-5678", "bob@opco.com"],
  ];
  const teamWs = XLSX.utils.aoa_to_sheet(teamData);
  teamWs["!cols"] = teamData[0].map((h) => ({ wch: Math.max(h.length + 2, 18) }));
  XLSX.utils.book_append_sheet(wb, teamWs, "Team Members");

  // Open Items sheet
  const openData = [
    ["Open Item Name", "Client Name", "Status", "Priority", "Due Date", "Begin Date", "Type", "Notes"],
    ["Schedule renewal meeting", "Acme Corp", "Not Started", "High", "2026-03-01", "", "Meeting", "Q1 priority"],
    ["Collect census data", "Beta Inc", "In Progress", "Medium", "2026-02-15", "2026-01-01", "Document", ""],
  ];
  const openWs = XLSX.utils.aoa_to_sheet(openData);
  openWs["!cols"] = openData[0].map((h) => ({ wch: Math.max(h.length + 2, 18) }));
  XLSX.utils.book_append_sheet(wb, openWs, "Open Items");

  // Deliverables sheet
  const delivData = [
    ["Deliverable Name", "Client Name", "Status", "Type", "Deadline", "Renewal Phase", "Notes"],
    ["Benefits Summary", "Acme Corp", "Not Started", "Document", "2026-03-15", "Pre-Renewal", ""],
    ["Renewal Presentation", "Acme Corp", "Not Started", "Presentation", "2026-04-01", "Renewal", ""],
  ];
  const delivWs = XLSX.utils.aoa_to_sheet(delivData);
  delivWs["!cols"] = delivData[0].map((h) => ({ wch: Math.max(h.length + 2, 18) }));
  XLSX.utils.book_append_sheet(wb, delivWs, "Deliverables");

  XLSX.writeFile(wb, "OpCo_Import_Template.xlsx");
}

type Step = "upload" | "preview" | "done";

export function ImportModal({ open, onClose, onDone }: Props) {
  const [step, setStep] = useState<Step>("upload");
  const [payload, setPayload] = useState<ImportPayload | null>(null);
  const [warnings, setWarnings] = useState<ImportWarning[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setStep("upload");
    setPayload(null);
    setWarnings([]);
    setResult(null);
    setFileName("");
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function parseFile(file: File) {
    setLoading(true);
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });

      // Support both xlsx (multi-sheet) and csv (single sheet, treat as clients)
      let parsed: ImportPayload;
      if (file.name.endsWith(".csv")) {
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<ImportRow>(ws, { defval: null });
        // Try to detect which sheet it is based on first column header
        const firstKey = rows[0] ? Object.keys(rows[0])[0] : "";
        parsed = {
          clients: firstKey === "Client Name" ? rows : [],
          teamMembers: firstKey === "Full Name" ? rows : [],
          openItems: firstKey === "Open Item Name" ? rows : [],
          deliverables: firstKey === "Deliverable Name" ? rows : [],
        };
      } else {
        parsed = {
          clients: sheetToRows(wb, "Clients"),
          teamMembers: sheetToRows(wb, "Team Members"),
          openItems: sheetToRows(wb, "Open Items"),
          deliverables: sheetToRows(wb, "Deliverables"),
        };
      }

      // Filter blank rows
      parsed.clients = parsed.clients.filter((r) => r["Client Name"] && String(r["Client Name"]).trim());
      parsed.teamMembers = parsed.teamMembers.filter((r) => r["Full Name"] && String(r["Full Name"]).trim());
      parsed.openItems = parsed.openItems.filter((r) => r["Open Item Name"] && String(r["Open Item Name"]).trim());
      parsed.deliverables = parsed.deliverables.filter((r) => r["Deliverable Name"] && String(r["Deliverable Name"]).trim());

      // Preview validation
      const res = await fetch("/api/import/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const data = await res.json();
      setWarnings(data.warnings || []);
      setPayload(parsed);
      setStep("preview");
    } catch (e: any) {
      toast.error("Failed to parse file: " + e.message);
    } finally {
      setLoading(false);
    }
  }

  async function runImport() {
    if (!payload) return;
    setLoading(true);
    try {
      const res = await fetch("/api/import/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data: ImportResult = await res.json();
      if ((data as any).error) throw new Error((data as any).error);
      setResult(data);
      setStep("done");
      onDone();
    } catch (e: any) {
      toast.error("Import failed: " + e.message);
    } finally {
      setLoading(false);
    }
  }

  const total = payload
    ? payload.clients.length + payload.teamMembers.length + payload.openItems.length + payload.deliverables.length
    : 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-xl bg-slate-900 border-slate-700 text-white">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-sky-400" />
            Import Data
          </DialogTitle>
        </DialogHeader>

        {/* STEP 1: Upload */}
        {step === "upload" && (
          <div className="space-y-4">
            <p className="text-sm text-slate-400">
              Download the Excel template, fill it out, then upload it here to bulk-import clients, team members, open items, and deliverables.
            </p>

            <Button
              variant="outline"
              className="w-full border-slate-600 text-slate-200 hover:bg-slate-800 gap-2"
              onClick={downloadTemplate}
            >
              <Download className="w-4 h-4" />
              Download Excel Template
            </Button>

            <div
              className={cn(
                "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
                dragOver ? "border-sky-500 bg-sky-500/10" : "border-slate-600 hover:border-slate-500"
              )}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const file = e.dataTransfer.files[0];
                if (file) parseFile(file);
              }}
            >
              {loading ? (
                <Loader2 className="w-8 h-8 text-sky-400 animate-spin mx-auto mb-2" />
              ) : (
                <Upload className="w-8 h-8 text-slate-500 mx-auto mb-2" />
              )}
              <p className="text-sm text-slate-400">
                {loading ? "Parsing file..." : "Drop your .xlsx or .csv file here, or click to browse"}
              </p>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.csv"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) parseFile(f); }}
              />
            </div>
          </div>
        )}

        {/* STEP 2: Preview */}
        {step === "preview" && payload && (
          <div className="space-y-4">
            <div className="text-sm text-slate-300 flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-sky-400 shrink-0" />
              <span className="truncate font-medium">{fileName}</span>
              <button onClick={reset} className="ml-auto text-slate-500 hover:text-slate-300">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Counts */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Clients", count: payload.clients.length },
                { label: "Team Members", count: payload.teamMembers.length },
                { label: "Open Items", count: payload.openItems.length },
                { label: "Deliverables", count: payload.deliverables.length },
              ].map(({ label, count }) => (
                <div key={label} className="bg-slate-800 rounded-lg px-3 py-2 flex justify-between items-center">
                  <span className="text-xs text-slate-400">{label}</span>
                  <span className={cn("text-sm font-semibold", count > 0 ? "text-white" : "text-slate-600")}>{count}</span>
                </div>
              ))}
            </div>

            {/* Warnings */}
            {warnings.length > 0 && (
              <div className="bg-amber-950/40 border border-amber-700/50 rounded-lg p-3 space-y-1 max-h-40 overflow-y-auto">
                <p className="text-xs font-medium text-amber-400 flex items-center gap-1 mb-2">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {warnings.length} warning{warnings.length > 1 ? "s" : ""} — rows with issues will be skipped
                </p>
                {warnings.map((w, i) => (
                  <p key={i} className="text-xs text-amber-300/80">
                    {w.sheet} row {w.row}: {w.message}
                  </p>
                ))}
              </div>
            )}

            {total === 0 && (
              <p className="text-sm text-slate-500 text-center">No valid rows found. Check that your file uses the template format.</p>
            )}

            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1 border-slate-600 text-slate-300 hover:bg-slate-800" onClick={reset} disabled={loading}>
                Back
              </Button>
              <Button
                className="flex-1 bg-sky-600 hover:bg-sky-500 text-white gap-2"
                onClick={runImport}
                disabled={loading || total === 0}
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Import {total} Record{total !== 1 ? "s" : ""}
              </Button>
            </div>
          </div>
        )}

        {/* STEP 3: Done */}
        {step === "done" && result && (
          <div className="space-y-4 text-center py-2">
            <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto" />
            <div>
              <p className="text-white font-semibold text-lg">Import complete!</p>
              <p className="text-slate-400 text-sm mt-1">Your data has been imported successfully.</p>
            </div>

            <div className="grid grid-cols-2 gap-2 text-left">
              {[
                { label: "Clients", count: result.imported.clients },
                { label: "Team Members", count: result.imported.teamMembers },
                { label: "Open Items", count: result.imported.openItems },
                { label: "Deliverables", count: result.imported.deliverables },
              ].map(({ label, count }) => (
                <div key={label} className="bg-slate-800 rounded-lg px-3 py-2 flex justify-between items-center">
                  <span className="text-xs text-slate-400">{label}</span>
                  <span className="text-sm font-semibold text-emerald-400">{count}</span>
                </div>
              ))}
            </div>

            {result.warnings.length > 0 && (
              <p className="text-xs text-amber-400">{result.warnings.length} row{result.warnings.length > 1 ? "s" : ""} skipped due to validation errors.</p>
            )}

            <Button className="w-full bg-sky-600 hover:bg-sky-500 text-white" onClick={handleClose}>
              Done
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
