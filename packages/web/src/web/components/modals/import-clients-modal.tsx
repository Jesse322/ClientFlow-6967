import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Upload, Download, CheckCircle2, XCircle, Loader2, AlertTriangle, X } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onClose: () => void;
  onImported?: () => void;
}

interface ParsedRow {
  "Client Name": string;
  "Location"?: string;
  "Funding Strategy"?: string;
  "Company Size"?: string;
  "Renewal Date"?: string;
  "Medical Carrier"?: string;
  "Ancillary Carrier"?: string;
  "Revenue"?: string;
  "Active"?: string;
}

interface ImportResult {
  name: string;
  status: "success" | "error";
  error?: string;
}

const TEMPLATE_HEADERS = [
  "Client Name",
  "Location",
  "Funding Strategy",
  "Company Size",
  "Renewal Date",
  "Medical Carrier",
  "Ancillary Carrier",
  "Revenue",
  "Active",
];

const FUNDING_OPTIONS = ["Fully Insured", "Level Funded", "Self Funded", "Captive"];
const SIZE_OPTIONS = ["1-50", "51-100", "101-250", "251-500", "500+"];

function parseCSV(text: string): ParsedRow[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.replace(/^"|"$/g, "").trim());
  const rows: ParsedRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].match(/(".*?"|[^,]+|(?<=,)(?=,)|(?<=,)$|^(?=,))/g) || [];
    const row: any = {};
    headers.forEach((h, idx) => {
      row[h] = (values[idx] || "").replace(/^"|"$/g, "").trim();
    });
    if (row["Client Name"]) rows.push(row);
  }
  return rows;
}

function downloadTemplate() {
  const sample = [
    TEMPLATE_HEADERS,
    ["Acme Corp", "Chicago, IL", "Fully Insured", "51-100", "2025-01-01", "BlueCross", "MetLife", "150000", "Yes"],
    ["Beta LLC", "Dallas, TX", "Self Funded", "101-250", "2025-06-15", "Aetna", "", "320000", "Yes"],
  ];
  const csv = sample.map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "client-import-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export function ImportClientsModal({ open, onClose, onImported }: Props) {
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<ImportResult[] | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setRows([]);
    setResults(null);
    setImporting(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function processFile(file: File) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseCSV(text);
      if (parsed.length === 0) {
        toast.error("No valid rows found. Make sure the file has a header row and at least one data row.");
        return;
      }
      setResults(null);
      setRows(parsed);
    };
    reader.readAsText(file);
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }

  async function runImport() {
    setImporting(true);
    const res: ImportResult[] = [];

    for (const row of rows) {
      try {
        const fields: any = {
          "Client Name": row["Client Name"],
        };
        if (row["Location"]) fields["Location"] = row["Location"];
        if (row["Funding Strategy"]) fields["Funding Strategy"] = row["Funding Strategy"];
        if (row["Company Size"]) fields["Company Size"] = row["Company Size"];
        if (row["Renewal Date"]) fields["Renewal Date"] = row["Renewal Date"];
        if (row["Medical Carrier"]) fields["Medical Carrier"] = row["Medical Carrier"];
        if (row["Ancillary Carrier"]) fields["Ancillary Carrier"] = row["Ancillary Carrier"];
        if (row["Revenue"]) fields["Revenue"] = parseFloat(row["Revenue"].replace(/[^0-9.]/g, "")) || undefined;
        fields["Active"] = !row["Active"] || row["Active"].toLowerCase() !== "no";

        const resp = await fetch("/api/clients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fields }),
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error((err as any).error || `HTTP ${resp.status}`);
        }
        res.push({ name: row["Client Name"], status: "success" });
      } catch (e: any) {
        res.push({ name: row["Client Name"], status: "error", error: e.message });
      }
    }

    setResults(res);
    setImporting(false);

    const succeeded = res.filter((r) => r.status === "success").length;
    if (succeeded > 0) {
      toast.success(`${succeeded} client${succeeded !== 1 ? "s" : ""} imported`);
      onImported?.();
    }
  }

  const succeeded = results?.filter((r) => r.status === "success").length ?? 0;
  const failed = results?.filter((r) => r.status === "error").length ?? 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Clients</DialogTitle>
        </DialogHeader>

        {/* Step 1 — no file yet */}
        {rows.length === 0 && !results && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 bg-sky-50 border border-sky-200 rounded-lg p-3 text-sm text-sky-700">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-sky-500" />
              <span>Upload a CSV file. Download the template below to get the correct column format.</span>
            </div>

            <button
              onClick={() => downloadTemplate()}
              className="flex items-center gap-2 text-sm text-sky-600 hover:text-sky-800 font-medium"
            >
              <Download className="w-4 h-4" /> Download CSV Template
            </button>

            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
                dragOver ? "border-sky-400 bg-sky-50" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
              }`}
            >
              <Upload className="w-8 h-8 mx-auto mb-3 text-slate-400" />
              <p className="text-sm font-medium text-slate-700">Drop a CSV file here, or click to browse</p>
              <p className="text-xs text-slate-400 mt-1">.csv files only</p>
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
            </div>
          </div>
        )}

        {/* Step 2 — preview rows */}
        {rows.length > 0 && !results && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-600"><span className="font-semibold text-slate-800">{rows.length}</span> rows ready to import</p>
              <button onClick={reset} className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"><X className="w-3 h-3" /> Clear</button>
            </div>

            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="overflow-x-auto max-h-64">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {TEMPLATE_HEADERS.map((h) => (
                        <th key={h} className="text-left px-3 py-2 font-medium text-slate-600 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.slice(0, 50).map((row, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        {TEMPLATE_HEADERS.map((h) => (
                          <td key={h} className="px-3 py-2 text-slate-700 whitespace-nowrap max-w-[160px] truncate">
                            {row[h as keyof ParsedRow] || <span className="text-slate-300">—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 50 && (
                <div className="px-3 py-2 bg-slate-50 border-t border-slate-200 text-xs text-slate-400">
                  Showing first 50 of {rows.length} rows
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={reset}>Back</Button>
              <Button onClick={runImport} disabled={importing} className="bg-sky-600 hover:bg-sky-700 text-white">
                {importing ? <><Loader2 className="w-4 h-4 animate-spin" /> Importing…</> : `Import ${rows.length} Client${rows.length !== 1 ? "s" : ""}`}
              </Button>
            </div>
          </div>
        )}

        {/* Step 3 — results */}
        {results && (
          <div className="space-y-4">
            <div className="flex gap-3">
              {succeeded > 0 && (
                <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-4 py-2 text-sm text-green-700">
                  <CheckCircle2 className="w-4 h-4" /> {succeeded} imported
                </div>
              )}
              {failed > 0 && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700">
                  <XCircle className="w-4 h-4" /> {failed} failed
                </div>
              )}
            </div>

            {failed > 0 && (
              <div className="border border-slate-200 rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-slate-600">Client</th>
                      <th className="text-left px-3 py-2 font-medium text-slate-600">Status</th>
                      <th className="text-left px-3 py-2 font-medium text-slate-600">Error</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {results.map((r, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2 text-slate-700">{r.name}</td>
                        <td className="px-3 py-2">
                          {r.status === "success"
                            ? <span className="text-green-600 font-medium">✓ OK</span>
                            : <span className="text-red-600 font-medium">✗ Error</span>}
                        </td>
                        <td className="px-3 py-2 text-slate-500">{r.error || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={reset}>Import More</Button>
              <Button onClick={handleClose} className="bg-sky-600 hover:bg-sky-700 text-white">Done</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
